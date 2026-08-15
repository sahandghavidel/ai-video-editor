import { mkdir, readdir, rename, writeFile } from 'fs/promises';
import path from 'path';

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
    await mkdir(desiredDir);
    return desiredDir;
  }

  const existingDir = path.join(baseDir, existingDirectory.name);
  if (existingDirectory.name !== desiredName) {
    await rename(existingDir, desiredDir);
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
