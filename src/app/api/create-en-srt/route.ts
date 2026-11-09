import { NextRequest, NextResponse } from 'next/server';
import { Agent, fetch as undiciFetch } from 'undici';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Toggle: when true, build EN SRT using scene Duration (field_6884)
// instead of calculating/using Final Video Duration (field_7107).
const USE_ORIGINAL_VIDEO_DURATION = false;

const DURATION_REQUEST_TIMEOUT_MS = 15 * 60 * 1000;
const durationRequestDispatcher = new Agent({
  headersTimeout: DURATION_REQUEST_TIMEOUT_MS,
  bodyTimeout: DURATION_REQUEST_TIMEOUT_MS,
});

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

async function readErrorMessage(response: {
  status: number;
  text(): Promise<string>;
}): Promise<string> {
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
      const durationResponse = await undiciFetch(
        `${baseUrl}/api/calculate-final-video-durations`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ sceneIds, allowOriginalDurationFallback: true }),
          cache: 'no-store',
          dispatcher: durationRequestDispatcher,
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

      const missingDurationIds =
        (durationResult?.scenesWithoutAnyDuration as number[]) ?? [];
      const failed = (durationResult?.failedCount as number) ?? 0;

      if (missingDurationIds.length > 0 || failed > 0) {
        const failures = (durationResult?.failures as { sceneId: number }[]) ?? [];
        const failedScenes = failures.slice(0, 20).map(({ sceneId }) => sceneId);

        return NextResponse.json(
          {
            error: `Cannot create EN SRT for videoId ${videoId}: ${missingDurationIds.length} scene(s) have no video and no usable duration in 7107 or 6884 (sceneIds: ${missingDurationIds.slice(0, 20).join(', ')}${missingDurationIds.length > 20 ? '...' : ''}), ${failed} scene(s) failed during duration calculation${failedScenes.length ? ` (sceneIds: ${failedScenes.join(', ')})` : ''}`,
            step: 'calculate-final-video-durations',
            durationResult,
          },
          { status: 400 },
        );
      }
    }

    const srtResponse = await fetch(`${baseUrl}/api/generate-duration-srt`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        videoId,
        allowOriginalDurationFallback: !USE_ORIGINAL_VIDEO_DURATION,
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
