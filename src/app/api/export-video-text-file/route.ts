import {
  parseVideoExportId,
  sanitizeExportFileName,
  writeTextToVideoExportDir,
} from '@/lib/local-video-export';

export const runtime = 'nodejs';

export async function POST(req: Request) {
  try {
    const body = (await req.json().catch(() => null)) as {
      videoId?: unknown;
      fileName?: unknown;
      text?: unknown;
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

    const fileName =
      typeof body?.fileName === 'string'
        ? sanitizeExportFileName(body.fileName, 'text-export.txt')
        : 'text-export.txt';
    const text = typeof body?.text === 'string' ? body.text : '';

    if (!text.trim()) {
      return Response.json({ error: 'text is required' }, { status: 400 });
    }

    const filePath = await writeTextToVideoExportDir(videoId, fileName, text);

    return Response.json({ ok: true, filePath });
  } catch (error) {
    console.error('Error exporting text file:', error);
    return Response.json(
      {
        error: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 },
    );
  }
}
