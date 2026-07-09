import { mkdir, writeFile } from 'fs/promises';
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
