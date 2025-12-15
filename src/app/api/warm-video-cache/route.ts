import { NextRequest, NextResponse } from 'next/server';
import { ensureVideoCached } from '@/utils/video-cache';

export const runtime = 'nodejs';

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json().catch(() => null)) as {
      videoUrl?: unknown;
    } | null;
    const videoUrl = typeof body?.videoUrl === 'string' ? body.videoUrl : '';

    if (!videoUrl || videoUrl.length > 5000) {
      return NextResponse.json(
        { success: false, error: 'Invalid videoUrl' },
        { status: 400 }
      );
    }

    // Keep a short-ish TTL; this is a best-effort cache.
    await ensureVideoCached(videoUrl, { maxAgeMs: 30 * 60 * 1000 });

    return NextResponse.json({ success: true });
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : typeof error === 'string'
        ? error
        : 'Failed to warm cache';
    return NextResponse.json(
      { success: false, error: message },
      { status: 500 }
    );
  }
}
