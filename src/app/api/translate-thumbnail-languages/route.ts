import { access } from 'fs/promises';
import path from 'path';

import {
  createGptImageToImageTask,
  extractUrlFromField,
  fetchGptImageResult,
  fetchOriginalVideoForThumbnail,
  THUMBNAIL_POLL_INTERVAL_MS,
} from '@/lib/thumbnail-generation';
import {
  ensureVideoExportDir,
  sanitizeExportFileName,
  writeBufferToVideoExportDir,
} from '@/lib/local-video-export';
import { getLanguageDisplayName } from '@/utils/languageNames';

const BATCH_SIZE = 10;
const BATCH_TIMEOUT_MS = 180000;
const MAX_ATTEMPTS = 2;

type LanguageTask = {
  languageCode: string;
  languageName: string;
  fileName: string;
  taskId: string;
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

const delay = (ms: number) =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

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

function buildTranslationPrompt(languageName: string): string {
  return `Translate only the human-readable thumbnail text into ${languageName}.

Preserve the original thumbnail design exactly: same layout, composition, colors, lighting, logo placement, character/object placement, typography style, text size, spacing, and 16:9 aspect ratio.

Do not translate brand names, product names, app names, company names, code terms, programming language names, acronyms, file extensions, or UI names. Keep terms like VS Code, Visual Studio Code, JavaScript, HTML, CSS, React, Next.js, Python, GitHub, API, CLI, terminal, and similar technical/product names in English.

Translate only the descriptive words around those protected terms. For example, "VS Code Tutorial for Beginners" should keep "VS Code" unchanged and translate only "Tutorial for Beginners".

Return one finished thumbnail image. Do not add extra text, captions, watermarks, or explanations.`;
}

function getExtensionFromUrlOrType(url: string, contentType: string): string {
  const lowerType = contentType.toLowerCase();
  if (lowerType.includes('image/png')) return '.png';
  if (lowerType.includes('image/jpeg')) return '.jpg';
  if (lowerType.includes('image/webp')) return '.webp';

  try {
    const pathname = new URL(url).pathname;
    const dot = pathname.lastIndexOf('.');
    if (dot > -1 && dot < pathname.length - 1) {
      const ext = pathname.slice(dot);
      if (/^\.[a-zA-Z0-9]+$/.test(ext)) return ext.toLowerCase();
    }
  } catch {
    // Keep the default extension when URL parsing fails.
  }

  return '.png';
}

async function fetchAsset(url: string): Promise<{
  data: ArrayBuffer;
  contentType: string;
}> {
  const res = await fetch(url, { cache: 'no-store' });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Failed to fetch translated thumbnail (${res.status}): ${text}`);
  }

  return {
    data: await res.arrayBuffer(),
    contentType: res.headers.get('content-type') || 'application/octet-stream',
  };
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function saveTranslatedThumbnail(
  videoId: number,
  languageName: string,
  imageUrl: string,
): Promise<SavedLanguage> {
  const asset = await fetchAsset(imageUrl);
  const ext = getExtensionFromUrlOrType(imageUrl, asset.contentType);
  const fileName = `${languageName} - Thumbnail${ext}`;
  const filePath = await writeBufferToVideoExportDir(videoId, fileName, asset.data);

  return {
    languageCode: '',
    languageName,
    fileName: sanitizeExportFileName(fileName),
    filePath,
  };
}

export async function POST(req: Request) {
  try {
    const body = (await req.json().catch(() => null)) as {
      videoId?: unknown;
      languages?: unknown;
    } | null;

    const videoId =
      typeof body?.videoId === 'number' ? body.videoId : Number(body?.videoId);

    if (!Number.isFinite(videoId) || videoId <= 0) {
      return Response.json({ error: 'videoId is required' }, { status: 400 });
    }

    const languages = parseLanguages(body?.languages);
    if (languages.length === 0) {
      return Response.json({ error: 'languages is required' }, { status: 400 });
    }

    const video = await fetchOriginalVideoForThumbnail(Math.floor(videoId));
    const selectedThumbnailUrl = extractUrlFromField(video.field_7100);

    if (!selectedThumbnailUrl) {
      return Response.json(
        { error: 'Selected thumbnail is missing. Choose or generate thumbnail 1 first.' },
        { status: 400 },
      );
    }

    const exportDir = await ensureVideoExportDir(Math.floor(videoId));
    const saved: SavedLanguage[] = [];
    const skipped: SkippedLanguage[] = [];
    const failedByLanguage = new Map<string, FailedLanguage>();

    let remaining = languages.slice();

    for (let attempt = 1; attempt <= MAX_ATTEMPTS && remaining.length > 0; attempt += 1) {
      const pendingAfterAttempt: string[] = [];

      for (let start = 0; start < remaining.length; start += BATCH_SIZE) {
        const batch = remaining.slice(start, start + BATCH_SIZE);
        const candidates = [];

        for (const languageCode of batch) {
          const languageName = formatLanguageNameForFile(languageCode);
          const fileBase = sanitizeExportFileName(`${languageName} - Thumbnail`);
          const existingFiles = [
            path.join(exportDir, `${fileBase}.png`),
            path.join(exportDir, `${fileBase}.jpg`),
            path.join(exportDir, `${fileBase}.jpeg`),
            path.join(exportDir, `${fileBase}.webp`),
          ];
          const exists = await Promise.all(existingFiles.map(fileExists));

          if (exists.some(Boolean)) {
            skipped.push({
              languageCode,
              languageName,
              fileName: `${fileBase}.*`,
              reason: 'already exists',
            });
            failedByLanguage.delete(languageCode);
          } else {
            candidates.push({ languageCode, languageName, fileName: `${fileBase}.png` });
          }
        }

        if (candidates.length === 0) continue;

        const started = await Promise.all(
          candidates.map(async (candidate): Promise<LanguageTask | FailedLanguage> => {
            try {
              const taskId = await createGptImageToImageTask(
                buildTranslationPrompt(candidate.languageName),
                selectedThumbnailUrl,
              );
              return { ...candidate, taskId };
            } catch (error) {
              return {
                ...candidate,
                error: error instanceof Error ? error.message : 'Unknown error',
              };
            }
          }),
        );

        const pending: LanguageTask[] = [];
        for (const result of started) {
          if ('taskId' in result) {
            pending.push(result);
          } else {
            failedByLanguage.set(result.languageCode, result);
            pendingAfterAttempt.push(result.languageCode);
          }
        }

        const startedAt = Date.now();

        while (pending.length > 0 && Date.now() - startedAt < BATCH_TIMEOUT_MS) {
          const pollResults = await Promise.all(
            pending.map(async (task) => {
              try {
                const pollResult = await fetchGptImageResult(task.taskId);
                return { task, pollResult };
              } catch (error) {
                return {
                  task,
                  error: error instanceof Error ? error.message : 'Unknown error',
                };
              }
            }),
          );

          for (const poll of pollResults) {
            const pendingIndex = pending.findIndex(
              (task) => task.taskId === poll.task.taskId,
            );
            if (pendingIndex === -1) continue;

            if ('error' in poll) {
              pending.splice(pendingIndex, 1);
              const failed = {
                languageCode: poll.task.languageCode,
                languageName: poll.task.languageName,
                fileName: poll.task.fileName,
                error: poll.error || 'Unknown error',
              };
              failedByLanguage.set(poll.task.languageCode, failed);
              pendingAfterAttempt.push(poll.task.languageCode);
              continue;
            }

            if (poll.pollResult.state === 'fail') {
              pending.splice(pendingIndex, 1);
              const failed = {
                languageCode: poll.task.languageCode,
                languageName: poll.task.languageName,
                fileName: poll.task.fileName,
                error: poll.pollResult.failMsg || 'Unknown GPT Image 2 failure',
              };
              failedByLanguage.set(poll.task.languageCode, failed);
              pendingAfterAttempt.push(poll.task.languageCode);
              continue;
            }

            if (poll.pollResult.imageUrl) {
              try {
                const savedLanguage = await saveTranslatedThumbnail(
                  Math.floor(videoId),
                  poll.task.languageName,
                  poll.pollResult.imageUrl,
                );
                saved.push({
                  ...savedLanguage,
                  languageCode: poll.task.languageCode,
                });
                failedByLanguage.delete(poll.task.languageCode);
              } catch (error) {
                const failed = {
                  languageCode: poll.task.languageCode,
                  languageName: poll.task.languageName,
                  fileName: poll.task.fileName,
                  error: error instanceof Error ? error.message : 'Unknown error',
                };
                failedByLanguage.set(poll.task.languageCode, failed);
                pendingAfterAttempt.push(poll.task.languageCode);
              }
              pending.splice(pendingIndex, 1);
            }
          }

          if (pending.length > 0) {
            await delay(THUMBNAIL_POLL_INTERVAL_MS);
          }
        }

        for (const task of pending) {
          const failed = {
            languageCode: task.languageCode,
            languageName: task.languageName,
            fileName: task.fileName,
            error: `Timed out after ${Math.round(BATCH_TIMEOUT_MS / 1000)} seconds`,
          };
          failedByLanguage.set(task.languageCode, failed);
          pendingAfterAttempt.push(task.languageCode);
        }
      }

      remaining = Array.from(new Set(pendingAfterAttempt));
    }

    return Response.json({
      videoId: Math.floor(videoId),
      exportDir,
      saved,
      skipped,
      failed: Array.from(failedByLanguage.values()),
    });
  } catch (error) {
    console.error('Error translating thumbnails:', error);
    return Response.json(
      {
        error: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 },
    );
  }
}
