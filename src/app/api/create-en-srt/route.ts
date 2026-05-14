import { NextRequest, NextResponse } from 'next/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Toggle: when true, build EN SRT using scene Duration (field_6884)
// instead of calculating/using Final Video Duration (field_7107).
const USE_ORIGINAL_VIDEO_DURATION = false;

const ORIGINAL_DURATION_FIELD_KEY = 'field_6884';

type CreateEnSrtRequest = {
  videoId?: unknown;
  sceneIds?: unknown;
};

type ErrorPayload = {
  error?: unknown;
};

function normalizeSceneIds(raw: unknown): number[] {
  if (!Array.isArray(raw)) return [];

  const ids = raw
    .map((id) => Number(id))
    .filter((id) => Number.isFinite(id) && id > 0)
    .map((id) => Math.floor(id));

  return Array.from(new Set(ids));
}

async function readErrorMessage(response: Response): Promise<string> {
  const text = await response.text().catch(() => '');

  if (!text) return `Request failed with status ${response.status}`;

  try {
    const parsed = JSON.parse(text) as ErrorPayload;
    if (typeof parsed?.error === 'string' && parsed.error.trim()) {
      return parsed.error.trim();
    }
  } catch {
    // ignore JSON parse failures and fall back to raw text
  }

  return text.slice(0, 3000);
}

export async function POST(request: NextRequest) {
  try {
    const body = (await request
      .json()
      .catch(() => null)) as CreateEnSrtRequest | null;

    const videoId = Number(body?.videoId);
    if (!Number.isFinite(videoId) || videoId <= 0) {
      return NextResponse.json(
        { error: 'videoId is required and must be a positive number' },
        { status: 400 },
      );
    }

    const sceneIds = normalizeSceneIds(body?.sceneIds);
    if (sceneIds.length === 0) {
      return NextResponse.json(
        {
          error:
            'sceneIds is required and must be a non-empty array of positive ids',
        },
        { status: 400 },
      );
    }

    const baseUrl = new URL(request.url).origin;

    let durationResult: Record<string, unknown> | null = null;

    if (!USE_ORIGINAL_VIDEO_DURATION) {
      const durationResponse = await fetch(
        `${baseUrl}/api/calculate-final-video-durations`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ sceneIds }),
          cache: 'no-store',
        },
      );

      if (!durationResponse.ok) {
        const message = await readErrorMessage(durationResponse);
        return NextResponse.json(
          {
            error: `Duration calculation failed: ${message}`,
            step: 'calculate-final-video-durations',
          },
          { status: durationResponse.status || 500 },
        );
      }

      durationResult = (await durationResponse
        .json()
        .catch(() => null)) as Record<string, unknown> | null;
    }

    const srtResponse = await fetch(`${baseUrl}/api/generate-duration-srt`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        videoId,
        durationFieldKey: USE_ORIGINAL_VIDEO_DURATION
          ? ORIGINAL_DURATION_FIELD_KEY
          : undefined,
      }),
      cache: 'no-store',
    });

    if (!srtResponse.ok) {
      const message = await readErrorMessage(srtResponse);
      return NextResponse.json(
        {
          error: `SRT generation failed: ${message}`,
          step: 'generate-duration-srt',
          durationResult,
        },
        { status: srtResponse.status || 500 },
      );
    }

    const srtResult = (await srtResponse.json().catch(() => null)) as Record<
      string,
      unknown
    > | null;

    return NextResponse.json({
      ok: true,
      videoId,
      sceneIds,
      usingOriginalVideoDuration: USE_ORIGINAL_VIDEO_DURATION,
      durationResult,
      srtResult,
    });
  } catch (error) {
    console.error('[create-en-srt] error:', error);
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 },
    );
  }
}
