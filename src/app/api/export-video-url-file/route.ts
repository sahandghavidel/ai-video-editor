import {
  parseVideoExportId,
  sanitizeExportFileName,
  writeBufferToVideoExportDir,
} from '@/lib/local-video-export';

export const runtime = 'nodejs';

function getExtensionFromUrlOrType(url: string, contentType: string): string {
  const lowerType = contentType.toLowerCase();
  if (lowerType.includes('audio/mp4')) return '.m4a';
  if (lowerType.includes('audio/mpeg')) return '.mp3';
  if (lowerType.includes('audio/wav')) return '.wav';
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
    // Use the fallback extension below if URL parsing fails.
  }

  return '.bin';
}

function hasExtension(fileName: string): boolean {
  return /\.[a-zA-Z0-9]+$/.test(fileName);
}

export async function POST(req: Request) {
  try {
    const body = (await req.json().catch(() => null)) as {
      videoId?: unknown;
      url?: unknown;
      fileName?: unknown;
    } | null;

    let videoId: number;
    try {
      videoId = parseVideoExportId(body?.videoId);
    } catch (error) {
      return Response.json(
        {
          error: error instanceof Error ? error.message : 'videoId is required',
        },
        { status: 400 },
      );
    }

    const url = typeof body?.url === 'string' ? body.url.trim() : '';
    if (!url) {
      return Response.json({ error: 'url is required' }, { status: 400 });
    }

    const rawFileName =
      typeof body?.fileName === 'string' ? body.fileName.trim() : 'exported-file';

    const response = await fetch(url, { cache: 'no-store' });
    if (!response.ok) {
      const t = await response.text().catch(() => '');
      return Response.json(
        { error: `Failed to fetch file (${response.status}): ${t}` },
        { status: 502 },
      );
    }

    const contentType =
      response.headers.get('content-type') || 'application/octet-stream';
    const safeBaseName = sanitizeExportFileName(rawFileName);
    const fileName = hasExtension(safeBaseName)
      ? safeBaseName
      : `${safeBaseName}${getExtensionFromUrlOrType(url, contentType)}`;
    const filePath = await writeBufferToVideoExportDir(
      videoId,
      fileName,
      await response.arrayBuffer(),
    );

    return Response.json({ ok: true, filePath });
  } catch (error) {
    console.error('Error exporting URL file:', error);
    return Response.json(
      {
        error: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 },
    );
  }
}
