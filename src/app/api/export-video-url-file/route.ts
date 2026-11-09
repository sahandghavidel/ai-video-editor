import {
  parseVideoExportId,
  resolveNamedVideoExportDir,
  sanitizeExportFileName,
  ensureVideoExportDir,
  exportRemoteMedia,
} from '@/lib/local-video-export';

export const runtime = 'nodejs';

function hasExtension(fileName: string): boolean {
  return /\.[a-zA-Z0-9]+$/.test(fileName);
}

export async function POST(req: Request) {
  try {
    const body = (await req.json().catch(() => null)) as {
      videoId?: unknown;
      url?: unknown;
      fileName?: unknown;
      title?: unknown;
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

    const name = sanitizeExportFileName(rawFileName);
    const title = typeof body?.title === 'string' ? body.title.trim() : '';
    const dir = title ? await resolveNamedVideoExportDir(videoId, title) : await ensureVideoExportDir(videoId);
    const result = await exportRemoteMedia(dir, name, url, !hasExtension(name));
    return Response.json({ ok: true, filePath: result.path, status: result.status });
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
