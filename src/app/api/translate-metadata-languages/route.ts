import { access } from 'fs/promises';
import path from 'path';
import { NextRequest, NextResponse } from 'next/server';

import { resolveOpenAIClient } from '@/lib/ai-provider';
import {
  ensureVideoExportDir,
  sanitizeExportFileName,
  writeTextToVideoExportDir,
} from '@/lib/local-video-export';
import { getLanguageDisplayName } from '@/utils/languageNames';

const ONLINE_BATCH_SIZE = 10;
const LOCAL_BATCH_SIZE = 1;
const MAX_ATTEMPTS = 2;
const REQUEST_TIMEOUT_MS = 180000;

type SavedLanguage = {
  languageCode: string;
  languageName: string;
  fileName: string;
  filePath: string;
};

type SkippedLanguage = {
  languageCode: string;
  languageName: string;
  fileName: string;
  reason: string;
};

type FailedLanguage = {
  languageCode: string;
  languageName: string;
  fileName: string;
  error: string;
};

function normalizeLanguageCode(value: unknown): string {
  if (typeof value !== 'string') return '';
  return value.trim().toLowerCase();
}

function parseLanguages(raw: unknown): string[] {
  const values = Array.isArray(raw) ? raw : [raw];
  const seen = new Set<string>();
  const languages: string[] = [];

  for (const value of values) {
    const languageCode = normalizeLanguageCode(value);
    if (!languageCode || seen.has(languageCode)) continue;
    seen.add(languageCode);
    languages.push(languageCode);
  }

  return languages;
}

function formatLanguageNameForFile(languageCode: string): string {
  const displayName = getLanguageDisplayName(languageCode);
  const regionMatch = displayName.match(/^(.+?)\s+-\s+(.+)$/);

  if (regionMatch) {
    return `${regionMatch[1].trim()} (${regionMatch[2].trim()})`;
  }

  return displayName;
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

function buildTranslationPrompt(languageName: string, metadataText: string): string {
  return `Translate the following text into ${languageName}.

Keep brand names, product names, app names, programming language names, file extensions, code terms, hashtags, and numeric timecodes unchanged when appropriate.

Translate the timestamp section too:
- Translate the "Timestamps" heading.
- For each timestamp line, keep only the numeric timecode unchanged.
- Translate the chapter title after the dash.
- Example: "00:34 - How to Download and Install" should become "00:34 - [translated chapter title]".

Preserve the exact section spacing:
- title first
- blank line
- description
- blank line
- hashtags if present
- blank line
- Timestamps
- timestamp lines

Only translate the human-readable natural language. Do not add explanations.

${metadataText}`;
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  let timeoutId: ReturnType<typeof setTimeout> | null = null;

  const timeout = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(() => {
      reject(new Error(`Timed out after ${Math.round(timeoutMs / 1000)} seconds`));
    }, timeoutMs);
  });

  try {
    return await Promise.race([promise, timeout]);
  } finally {
    if (timeoutId) clearTimeout(timeoutId);
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json().catch(() => null)) as {
      videoId?: unknown;
      languages?: unknown;
      metadataText?: unknown;
      model?: unknown;
      provider?: unknown;
      localEndpoint?: unknown;
      localApiKey?: unknown;
      localAdminApiKey?: unknown;
      preferFastProvider?: unknown;
    } | null;

    const videoId =
      typeof body?.videoId === 'number' ? body.videoId : Number(body?.videoId);

    if (!Number.isFinite(videoId) || videoId <= 0) {
      return NextResponse.json({ error: 'videoId is required' }, { status: 400 });
    }

    const metadataText =
      typeof body?.metadataText === 'string' ? body.metadataText.trim() : '';

    if (!metadataText) {
      return NextResponse.json(
        { error: 'metadataText is required' },
        { status: 400 },
      );
    }

    const languages = parseLanguages(body?.languages);
    if (languages.length === 0) {
      return NextResponse.json({ error: 'languages is required' }, { status: 400 });
    }

    const {
      client: openaiClient,
      provider,
      missingApiKey,
    } = resolveOpenAIClient(request, body);

    if (!openaiClient || missingApiKey) {
      return NextResponse.json(
        {
          error:
            provider === 'online'
              ? 'Missing OpenRouter API key. Set OPENROUTER_API_KEY in .env.local and restart the dev server.'
              : 'Failed to initialize local AI provider client.',
        },
        { status: 500 },
      );
    }

    const model =
      typeof body?.model === 'string' && body.model.trim().length > 0
        ? body.model.trim()
        : 'openai/gpt-4o-mini';
    const preferFastProvider =
      body?.preferFastProvider === true ||
      body?.preferFastProvider === 'true' ||
      body?.preferFastProvider === 1 ||
      body?.preferFastProvider === '1';
    const effectiveModel =
      preferFastProvider && provider === 'online' && !model.includes(':nitro')
        ? `${model}:nitro`
        : model;

    const exportDir = await ensureVideoExportDir(Math.floor(videoId));
    const batchSize = provider === 'local' ? LOCAL_BATCH_SIZE : ONLINE_BATCH_SIZE;
    const saved: SavedLanguage[] = [];
    const skipped: SkippedLanguage[] = [];
    const failedByLanguage = new Map<string, FailedLanguage>();

    let remaining = languages.slice();

    const translateOne = async (languageCode: string): Promise<void> => {
      const languageName = formatLanguageNameForFile(languageCode);
      const fileName = sanitizeExportFileName(`${languageName} - metadata.txt`);
      const filePath = path.join(exportDir, fileName);

      if (await fileExists(filePath)) {
        skipped.push({
          languageCode,
          languageName,
          fileName,
          reason: 'already exists',
        });
        failedByLanguage.delete(languageCode);
        return;
      }

      const prompt = buildTranslationPrompt(languageName, metadataText);

      const completion = await withTimeout(
        openaiClient.chat.completions.create({
          model: effectiveModel,
          messages: [
            {
              role: 'system',
              content:
                'You translate YouTube metadata while preserving exact spacing, numeric timecodes, hashtags, and protected technical terms. Translate timestamp headings and chapter titles. Return only the translated metadata text.',
            },
            {
              role: 'user',
              content: prompt,
            },
          ],
          temperature: 0.2,
        }),
        REQUEST_TIMEOUT_MS,
      );

      const translatedText = completion.choices[0]?.message?.content?.trim();
      if (!translatedText) {
        throw new Error('No translated metadata returned');
      }

      const writtenPath = await writeTextToVideoExportDir(
        Math.floor(videoId),
        fileName,
        translatedText,
      );

      saved.push({
        languageCode,
        languageName,
        fileName,
        filePath: writtenPath,
      });
      failedByLanguage.delete(languageCode);
    };

    for (let attempt = 1; attempt <= MAX_ATTEMPTS && remaining.length > 0; attempt += 1) {
      const pendingAfterAttempt: string[] = [];

      for (let start = 0; start < remaining.length; start += batchSize) {
        const batch = remaining.slice(start, start + batchSize);

        await Promise.all(
          batch.map(async (languageCode) => {
            try {
              await translateOne(languageCode);
            } catch (error) {
              const languageName = formatLanguageNameForFile(languageCode);
              const failed = {
                languageCode,
                languageName,
                fileName: sanitizeExportFileName(`${languageName} - metadata.txt`),
                error: error instanceof Error ? error.message : 'Unknown error',
              };
              failedByLanguage.set(languageCode, failed);
              pendingAfterAttempt.push(languageCode);
            }
          }),
        );
      }

      remaining = Array.from(new Set(pendingAfterAttempt));
    }

    return NextResponse.json({
      videoId: Math.floor(videoId),
      provider,
      model,
      effectiveModel,
      preferFastProvider,
      batchSize,
      exportDir,
      saved,
      skipped,
      failed: Array.from(failedByLanguage.values()),
    });
  } catch (error) {
    console.error('Error translating metadata:', error);
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 },
    );
  }
}
