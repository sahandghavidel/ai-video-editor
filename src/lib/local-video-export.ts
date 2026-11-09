import { copyFile, link, lstat, mkdir, readdir, rename, rm, writeFile } from 'fs/promises';
import path from 'path';
import { randomUUID } from 'crypto';
import { getLanguageDisplayName } from '@/utils/languageNames';

export const LOCAL_VIDEO_EXPORT_BASE_DIR =
  '/Users/sahand/Desktop/Videos/Courses/Videos';

export function parseVideoExportId(value: unknown): number {
  const videoId = typeof value === 'number' ? value : Number(value);

  if (!Number.isFinite(videoId) || videoId <= 0) {
    throw new Error('videoId is required');
  }

  return Math.floor(videoId);
}

export function sanitizeExportFileName(
  rawName: string,
  fallbackName = 'exported-file',
): string {
  const cleaned = (rawName || '')
    .replace(/[<>:"/\\|?*\x00-\x1F]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/\.+$/g, '');

  return cleaned || fallbackName;
}

function cleanTitleLine(line: string): string {
  return line
    .replace(/^\s*\d+\)\s*/, '')
    .replace(/^\s*[-*•]\s*/, '')
    .trim();
}

export function getVideoExportTitle(rawTitleField: unknown, videoId: number): string {
  const raw = typeof rawTitleField === 'string' ? rawTitleField : '';
  const candidates = raw.split('\n').map(cleanTitleLine).filter(Boolean);

  return sanitizeExportFileName(candidates[0] || '', `video_${videoId}`);
}

export function getExtensionFromUrlOrType(url: string, contentType: string): string {
  const lowerType = contentType.toLowerCase();
  if (lowerType.includes('audio/wav')) return '.wav';
  if (lowerType.includes('audio/mpeg')) return '.mp3';
  if (lowerType.includes('audio/mp3')) return '.mp3';
  if (lowerType.includes('audio/mp4')) return '.m4a';
  if (lowerType.includes('audio/x-m4a')) return '.m4a';
  if (lowerType.includes('video/mp4')) return '.mp4';
  if (lowerType.includes('video/webm')) return '.webm';
  if (lowerType.includes('video/quicktime')) return '.mov';
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
    // Keep the generic extension if URL parsing fails.
  }

  return '.bin';
}

export function getLanguageExportName(languageCode: string): string {
  const displayName = getLanguageDisplayName(languageCode);
  const regionMatch = displayName.match(/^(.+?)\s+-\s+(.+)$/);

  const name = regionMatch
    ? `${regionMatch[1].trim()} (${regionMatch[2].trim()})`
    : displayName;
  return sanitizeExportFileName(name, languageCode.toUpperCase());
}

export function getVideoExportDir(videoId: number): string {
  return path.join(LOCAL_VIDEO_EXPORT_BASE_DIR, String(videoId));
}

export function getNamedVideoExportDirName(
  videoId: number,
  title: string,
): string {
  const stableVideoId = parseVideoExportId(videoId);
  const prefix = `${stableVideoId}--`;
  const sanitizedTitle = sanitizeExportFileName(
    title,
    `video_${stableVideoId}`,
  );
  const titleByteLimit = 240 - Buffer.byteLength(prefix, 'utf8');
  let safeTitle = '';

  for (const character of sanitizedTitle) {
    if (Buffer.byteLength(safeTitle + character, 'utf8') > titleByteLimit) {
      break;
    }
    safeTitle += character;
  }

  safeTitle = safeTitle.trim().replace(/^\.+|\.+$/g, '').trim();
  if (!safeTitle) {
    safeTitle = `video_${stableVideoId}`;
  }

  return `${prefix}${safeTitle}`;
}

export async function resolveNamedVideoExportDir(
  videoId: number,
  title: string,
  baseDir = LOCAL_VIDEO_EXPORT_BASE_DIR,
): Promise<string> {
  const stableVideoId = parseVideoExportId(videoId);
  const desiredName = getNamedVideoExportDirName(stableVideoId, title);
  const desiredDir = path.join(baseDir, desiredName);
  const legacyName = String(stableVideoId);
  const namedPrefix = `${stableVideoId}--`;

  await mkdir(baseDir, { recursive: true });

  const entries = await readdir(baseDir, { withFileTypes: true });
  const matchingDirectories = entries.filter(
    (entry) =>
      entry.isDirectory() &&
      (entry.name === legacyName || entry.name.startsWith(namedPrefix)),
  );

  if (matchingDirectories.length > 1) {
    throw new Error(
      `Multiple export folders found for video ${stableVideoId}; resolve them before exporting`,
    );
  }

  const existingDirectory = matchingDirectories[0];
  if (!existingDirectory) {
    try {
      await mkdir(desiredDir);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST' ||
          !(await lstat(desiredDir)).isDirectory()) throw error;
    }
    return desiredDir;
  }

  const existingDir = path.join(baseDir, existingDirectory.name);
  if (existingDirectory.name !== desiredName) {
    try {
      await rename(existingDir, desiredDir);
    } catch (error) {
      // Another language may have just renamed the same legacy folder.
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT' ||
          !(await lstat(desiredDir)).isDirectory()) throw error;
    }
  }

  return desiredDir;
}

export async function ensureVideoExportDir(videoId: number): Promise<string> {
  const exportDir = getVideoExportDir(videoId);
  await mkdir(exportDir, { recursive: true });
  return exportDir;
}

export async function writeBufferToVideoExportDir(
  videoId: number,
  fileName: string,
  data: ArrayBuffer | Uint8Array | Buffer,
): Promise<string> {
  const exportDir = await ensureVideoExportDir(videoId);
  const safeFileName = sanitizeExportFileName(fileName);
  const filePath = path.join(exportDir, safeFileName);
  const buffer =
    data instanceof ArrayBuffer
      ? Buffer.from(new Uint8Array(data))
      : Buffer.from(data);

  await writeFile(filePath, buffer);
  return filePath;
}

export async function writeBufferToResolvedVideoExportDir(
  exportDir: string,
  fileName: string,
  data: ArrayBuffer | Uint8Array | Buffer,
): Promise<string> {
  const resolvedBaseDir = path.resolve(LOCAL_VIDEO_EXPORT_BASE_DIR);
  const resolvedExportDir = path.resolve(exportDir);

  if (path.dirname(resolvedExportDir) !== resolvedBaseDir) {
    throw new Error('Invalid video export directory');
  }

  const safeFileName = sanitizeExportFileName(fileName);
  const filePath = path.join(resolvedExportDir, safeFileName);
  const buffer =
    data instanceof ArrayBuffer
      ? Buffer.from(new Uint8Array(data))
      : Buffer.from(data);

  await writeFile(filePath, buffer);
  return filePath;
}

export async function writeTextToVideoExportDir(
  videoId: number,
  fileName: string,
  text: string,
): Promise<string> {
  return writeBufferToVideoExportDir(
    videoId,
    fileName,
    Buffer.from(text, 'utf8'),
  );
}

export async function writeTextToResolvedVideoExportDir(
  exportDir: string,
  fileName: string,
  text: string,
): Promise<string> {
  return writeBufferToResolvedVideoExportDir(
    exportDir,
    fileName,
    Buffer.from(text, 'utf8'),
  );
}

type MediaExport = { path: string; status: 'present' | 'saved' };

function mediaDestination(dir: string, fileName: string): string {
  const destination = path.resolve(dir, sanitizeExportFileName(fileName));
  if (path.dirname(path.resolve(dir)) !== path.resolve(LOCAL_VIDEO_EXPORT_BASE_DIR) ||
      path.dirname(destination) !== path.resolve(dir)) {
    throw new Error('Invalid video export destination');
  }
  return destination;
}

async function existingMedia(destination: string): Promise<MediaExport | undefined> {
  try {
    if (!(await lstat(destination)).isFile()) {
      throw new Error(`Export destination is not a regular file: ${destination}`);
    }
    return { path: destination, status: 'present' };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
    throw error;
  }
}

/** Publish complete media without replacing a file created by another export. */
export async function saveMediaIfMissing(
  dir: string, fileName: string, writeTemp: (tempPath: string) => Promise<void>,
): Promise<MediaExport> {
  const destination = mediaDestination(dir, fileName);
  const existing = await existingMedia(destination);
  if (existing) return existing;
  const tempPath = path.join(dir, `.media-${randomUUID()}.tmp`);
  try {
    await writeTemp(tempPath);
    try {
      await link(tempPath, destination);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
      const concurrentFile = await existingMedia(destination);
      if (!concurrentFile) throw error;
      return concurrentFile;
    }
    return { path: destination, status: 'saved' };
  } finally {
    await rm(tempPath, { force: true });
  }
}

export async function exportRemoteMedia(
  dir: string, name: string, url: string, inferExtension = false,
): Promise<MediaExport> {
  const urlExtension = getExtensionFromUrlOrType(url, '');
  if (!inferExtension || urlExtension !== '.bin') {
    const candidate = inferExtension ? name + urlExtension : name;
    const present = await existingMedia(mediaDestination(dir, candidate));
    if (present) return present;
  }
  if (!url) throw new Error('no stored source URL');
  const response = await fetch(url, { cache: 'no-store' });
  try {
    if (!response.ok) throw new Error(`Download returned HTTP ${response.status}`);
    const fileName = inferExtension
      ? name + getExtensionFromUrlOrType(url, response.headers.get('content-type') || '')
      : name;
    return await saveMediaIfMissing(dir, fileName, async tempPath => {
      if (!response.body) throw new Error('Empty download');
      await writeFile(tempPath, response.body as unknown as AsyncIterable<Uint8Array>, { flag: 'wx' });
    });
  } finally {
    if (!response.bodyUsed) await response.body?.cancel().catch(() => {});
  }
}

export async function saveTranslatedAsset(
  videoId: number,
  rawTitle: unknown,
  language: string,
  asset: { srt: ArrayBuffer } | { audioPath: string; extension: 'wav' | 'm4a' },
): Promise<MediaExport | { warning: string }> {
  const name = getLanguageExportName(language);
  const fileName = 'srt' in asset ? `${name}.srt` : `${name} - audio.${asset.extension}`;
  try {
    const dir = await resolveNamedVideoExportDir(videoId, getVideoExportTitle(rawTitle, videoId));
    return await saveMediaIfMissing(dir, fileName, tempPath =>
      'srt' in asset ? writeFile(tempPath, Buffer.from(asset.srt)) : copyFile(asset.audioPath, tempPath),
    );
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    const warning = `Video ${videoId}: local copy of ${fileName} failed: ${reason}. Retry with Export All.`;
    console.warn(warning);
    return { warning };
  }
}

export async function recoverTranslatedFile(
  videoId: number, title: unknown, language: string, kind: 'subtitle' | 'audio', url: string,
) {
  const name = getLanguageExportName(language);
  const fileName = kind === 'subtitle' ? `${name}.srt` : `${name} - audio`;
  try {
    const dir = await resolveNamedVideoExportDir(videoId, getVideoExportTitle(title, videoId));
    const result = await exportRemoteMedia(dir, fileName, url, kind === 'audio');
    return { path: result.path, status: result.status === 'saved' ? 'recovered' : 'present' };
  } catch (error) {
    return { warning: `${fileName}: ${error instanceof Error ? error.message : String(error)}` };
  }
}
