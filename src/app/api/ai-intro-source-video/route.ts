import fs from 'fs';
import { Readable } from 'stream';
import { loadAiIntroContext } from '@/lib/ai-intro-overlay';
import { ensureVideoCached } from '@/utils/video-cache';

export const runtime = 'nodejs';

const CACHE_MAX_AGE_MS = 30 * 60 * 1000;

export async function GET(request: Request) {
  try {
    const sceneId = Number(new URL(request.url).searchParams.get('sceneId'));
    const context = await loadAiIntroContext(sceneId);
    const sourcePath = await ensureVideoCached(context.sourceVideoUrl, {
      maxAgeMs: CACHE_MAX_AGE_MS,
    });
    const stat = await fs.promises.stat(sourcePath);
    const range = request.headers.get('range');
    const commonHeaders = {
      'Accept-Ranges': 'bytes',
      'Cache-Control': 'private, no-store',
      'Content-Type': 'video/mp4',
    };

    if (range) {
      const match = /^bytes=(\d+)-(\d*)$/i.exec(range.trim());
      if (!match) {
        return new Response(null, {
          status: 416,
          headers: { ...commonHeaders, 'Content-Range': `bytes */${stat.size}` },
        });
      }
      const start = Number(match[1]);
      const requestedEnd = match[2] ? Number(match[2]) : stat.size - 1;
      const end = Math.min(stat.size - 1, requestedEnd);
      if (
        !Number.isInteger(start) ||
        !Number.isInteger(end) ||
        start < 0 ||
        end < start ||
        start >= stat.size
      ) {
        return new Response(null, {
          status: 416,
          headers: { ...commonHeaders, 'Content-Range': `bytes */${stat.size}` },
        });
      }
      const stream = fs.createReadStream(sourcePath, { start, end });
      return new Response(Readable.toWeb(stream) as ReadableStream, {
        status: 206,
        headers: {
          ...commonHeaders,
          'Content-Length': String(end - start + 1),
          'Content-Range': `bytes ${start}-${end}/${stat.size}`,
        },
      });
    }

    const stream = fs.createReadStream(sourcePath);
    return new Response(Readable.toWeb(stream) as ReadableStream, {
      status: 200,
      headers: {
        ...commonHeaders,
        'Content-Length': String(stat.size),
      },
    });
  } catch (error) {
    console.error('ai-intro-source-video error:', error);
    return Response.json(
      {
        error:
          error instanceof Error
            ? error.message
            : 'Failed to load the original video.',
      },
      { status: 500 },
    );
  }
}
