import { access } from 'fs/promises';
import path from 'path';
import { NextRequest, NextResponse } from 'next/server';

import { resolveOpenAIClient, withOpenRouterNitro } from '@/lib/ai-provider';
import {
  resolveNamedVideoExportDir,
  sanitizeExportFileName,
  writeTextToResolvedVideoExportDir,
} from '@/lib/local-video-export';
import { getLanguageDisplayName } from '@/utils/languageNames';

const ONLINE_BATCH_SIZE = 10;
const LOCAL_BATCH_SIZE = 1;
const MAX_ATTEMPTS = 2;
const REQUEST_TIMEOUT_MS = 180000;

type MetadataInput = {
  title: string;
  description: string;
};

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

function stripCodeFences(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed.startsWith('```')) return trimmed;

  return trimmed
    .replace(/^```[a-zA-Z0-9_-]*\n?/, '')
    .replace(/```$/, '')
    .trim();
}

function parseModelJson(raw: string): unknown {
  const cleaned = stripCodeFences(raw);

  try {
    return JSON.parse(cleaned);
  } catch {
    const firstBrace = cleaned.indexOf('{');
    const lastBrace = cleaned.lastIndexOf('}');
    if (firstBrace >= 0 && lastBrace > firstBrace) {
      return JSON.parse(cleaned.slice(firstBrace, lastBrace + 1));
    }
    throw new Error('Model response is not valid JSON');
  }
}

function extractTimecodes(value: string): string[] {
  return value.match(/\b\d{1,2}:\d{2}(?::\d{2})?\b/g) || [];
}

function validateTranslation(
  parsed: unknown,
  sourceLines: string[],
): { title: string; description: string } {
  if (!parsed || typeof parsed !== 'object') {
    throw new Error('Model response must be a JSON object');
  }

  const candidate = parsed as {
    title?: unknown;
    descriptionLines?: unknown;
  };
  const title =
    typeof candidate.title === 'string' ? candidate.title.trim() : '';
  if (!title) {
    throw new Error('Model response is missing a translated title');
  }

  if (!Array.isArray(candidate.descriptionLines)) {
    throw new Error('Model response is missing descriptionLines');
  }
  if (candidate.descriptionLines.length !== sourceLines.length) {
    throw new Error(
      `Model changed the description line count (${sourceLines.length} expected, ${candidate.descriptionLines.length} returned)`,
    );
  }

  const translatedLines = candidate.descriptionLines.map((value, index) => {
    if (typeof value !== 'string') {
      throw new Error(`Description line ${index + 1} is not text`);
    }

    const sourceLine = sourceLines[index];
    if (!sourceLine) {
      if (value !== '') {
        throw new Error(`Model changed blank description line ${index + 1}`);
      }
      return '';
    }

    if (!value.trim()) {
      throw new Error(`Description line ${index + 1} is empty`);
    }

    const sourceTimecodes = extractTimecodes(sourceLine);
    const translatedTimecodes = extractTimecodes(value);
    if (
      sourceTimecodes.length !== translatedTimecodes.length ||
      sourceTimecodes.some(
        (timecode, timecodeIndex) =>
          timecode !== translatedTimecodes[timecodeIndex],
      )
    ) {
      throw new Error(
        `Model changed a timecode on description line ${index + 1}`,
      );
    }

    return value;
  });

  return {
    title,
    description: translatedLines.join('\n'),
  };
}

function buildTranslationPrompt(
  languageName: string,
  title: string,
  descriptionLines: string[],
): string {
  return `Translate this YouTube title and description into ${languageName}.

The descriptionLines array contains the complete YouTube description. Its timestamp heading and timestamp chapter lines are already included at the end.

Translation rules:
- Translate the title, normal description text, the "Timestamps" heading, and the human-readable chapter title after each numeric timecode.
- Keep every numeric timecode exactly unchanged.
- Keep brand names, product names, app names, company names, programming language names, technical terms, code, commands, file extensions, URLs, email addresses, hashtags, and identifiers unchanged when appropriate.
- Preserve the exact descriptionLines array length and order.
- Return an empty string for every input line that is empty. Never add, remove, combine, or split lines.
- Return only strict JSON with exactly these keys and no markdown:
{
  "title": "translated title",
  "descriptionLines": ["translated line", "", "translated timestamp heading", "00:00 - translated chapter"]
}

Input:
${JSON.stringify({ title, descriptionLines }, null, 2)}`;
}

async function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
): Promise<T> {
  let timeoutId: ReturnType<typeof setTimeout> | null = null;
  const timeout = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(() => {
      reject(
        new Error(`Timed out after ${Math.round(timeoutMs / 1000)} seconds`),
      );
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
      metadata?: unknown;
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
      return NextResponse.json(
        { error: 'videoId is required' },
        { status: 400 },
      );
    }

    const rawMetadata =
      body?.metadata && typeof body.metadata === 'object'
        ? (body.metadata as { title?: unknown; description?: unknown })
        : null;
    const metadata: MetadataInput = {
      title:
        typeof rawMetadata?.title === 'string' ? rawMetadata.title.trim() : '',
      description:
        typeof rawMetadata?.description === 'string'
          ? rawMetadata.description.trim()
          : '',
    };
    if (!metadata.title || !metadata.description) {
      return NextResponse.json(
        { error: 'metadata.title and metadata.description are required' },
        { status: 400 },
      );
    }

    const languages = parseLanguages(body?.languages);
    if (languages.length === 0) {
      return NextResponse.json(
        { error: 'languages is required' },
        { status: 400 },
      );
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
    const effectiveModel = withOpenRouterNitro(model, provider);

    const normalizedVideoId = Math.floor(videoId);
    const exportDir = await resolveNamedVideoExportDir(
      normalizedVideoId,
      metadata.title,
    );
    const batchSize =
      provider === 'local' ? LOCAL_BATCH_SIZE : ONLINE_BATCH_SIZE;
    const saved: SavedLanguage[] = [];
    const skipped: SkippedLanguage[] = [];
    const failedByLanguage = new Map<string, FailedLanguage>();
    const sourceLines = metadata.description
      .replace(/\r\n?/g, '\n')
      .split('\n');
    let remaining = languages.slice();

    const translateOne = async (languageCode: string): Promise<void> => {
      const languageName = formatLanguageNameForFile(languageCode);
      const fileName = sanitizeExportFileName(
        `${languageName} - metadata.json`,
      );
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

      const prompt = buildTranslationPrompt(
        languageName,
        metadata.title,
        sourceLines,
      );
      const basePayload = {
        model: effectiveModel,
        messages: [
          {
            role: 'system' as const,
            content:
              'You translate YouTube metadata and return only strict JSON. Preserve protected technical terms, exact numeric timecodes, line order, and blank lines.',
          },
          {
            role: 'user' as const,
            content: prompt,
          },
        ],
        temperature: 0.2,
      };

      const completion = await withTimeout(
        (async () => {
          try {
            return await openaiClient.chat.completions.create({
              ...basePayload,
              response_format: { type: 'json_object' },
            });
          } catch {
            return openaiClient.chat.completions.create(basePayload);
          }
        })(),
        REQUEST_TIMEOUT_MS,
      );

      const rawContent = completion.choices[0]?.message?.content?.trim();
      if (!rawContent) {
        throw new Error('No translated JSON metadata returned');
      }

      const translated = validateTranslation(
        parseModelJson(rawContent),
        sourceLines,
      );
      const output = {
        language: languageName,
        title: translated.title,
        description: translated.description,
      };
      const writtenPath = await writeTextToResolvedVideoExportDir(
        exportDir,
        fileName,
        `${JSON.stringify(output, null, 2)}\n`,
      );

      saved.push({
        languageCode,
        languageName,
        fileName,
        filePath: writtenPath,
      });
      failedByLanguage.delete(languageCode);
    };

    for (
      let attempt = 1;
      attempt <= MAX_ATTEMPTS && remaining.length > 0;
      attempt += 1
    ) {
      const pendingAfterAttempt: string[] = [];

      for (let start = 0; start < remaining.length; start += batchSize) {
        const batch = remaining.slice(start, start + batchSize);
        await Promise.all(
          batch.map(async (languageCode) => {
            try {
              await translateOne(languageCode);
            } catch (error) {
              const languageName = formatLanguageNameForFile(languageCode);
              failedByLanguage.set(languageCode, {
                languageCode,
                languageName,
                fileName: sanitizeExportFileName(
                  `${languageName} - metadata.json`,
                ),
                error: error instanceof Error ? error.message : 'Unknown error',
              });
              pendingAfterAttempt.push(languageCode);
            }
          }),
        );
      }

      remaining = Array.from(new Set(pendingAfterAttempt));
    }

    return NextResponse.json({
      videoId: normalizedVideoId,
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
    console.error('Error translating JSON metadata:', error);
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 },
    );
  }
}
