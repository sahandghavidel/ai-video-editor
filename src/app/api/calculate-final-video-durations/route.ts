import { NextRequest, NextResponse } from 'next/server';
import { getBaserowToken, buildAuthHeader } from '@/lib/baserow-auth';
import { extractSceneVideoUrl, resolveFinalSceneDuration } from '@/lib/scene-srt-duration';
import { probeVideoDurationSeconds } from '@/lib/ffprobe-video-duration';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const SCENES_TABLE_ID = '714';
const FINAL_VIDEO_FIELD_KEY = 'field_6886';
const FINAL_VIDEO_DURATION_FIELD_KEY = 'field_7107';

type BaserowRow = Record<string, unknown>;

async function baserowGetSceneRow(
  baserowUrl: string,
  token: string,
  sceneId: number,
): Promise<BaserowRow> {
  const res = await fetch(
    `${baserowUrl}/database/rows/table/${SCENES_TABLE_ID}/${sceneId}/`,
    {
      method: 'GET',
      headers: { ...buildAuthHeader(token) },
      cache: 'no-store',
    },
  );

  if (!res.ok) {
    const t = await res.text().catch(() => '');
    throw new Error(`Fetch scene failed (${res.status}) ${t}`);
  }

  return (await res.json().catch(() => ({}))) as BaserowRow;
}

async function baserowPatchSceneRow(
  baserowUrl: string,
  token: string,
  sceneId: number,
  body: Record<string, unknown>,
): Promise<void> {
  const res = await fetch(
    `${baserowUrl}/database/rows/table/${SCENES_TABLE_ID}/${sceneId}/`,
    {
      method: 'PATCH',
      headers: {
        ...buildAuthHeader(token),
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    },
  );

  if (!res.ok) {
    const t = await res.text().catch(() => '');
    throw new Error(`Update scene failed (${res.status}) ${t}`);
  }
}

export async function POST(request: NextRequest) {
  try {
    const payload = (await request.json().catch(() => null)) as {
      sceneIds?: unknown;
      allowOriginalDurationFallback?: unknown;
    } | null;

    const sceneIdsRaw = payload?.sceneIds;
    if (!Array.isArray(sceneIdsRaw) || sceneIdsRaw.length === 0) {
      return NextResponse.json(
        { error: 'sceneIds is required and must be a non-empty array' },
        { status: 400 },
      );
    }

    const sceneIds = sceneIdsRaw
      .map((id) => Number(id))
      .filter((id) => Number.isFinite(id) && id > 0)
      .map((id) => Math.floor(id));

    if (sceneIds.length === 0) {
      return NextResponse.json(
        { error: 'No valid sceneIds provided' },
        { status: 400 },
      );
    }

    const baserowUrl = process.env.BASEROW_API_URL;
    if (!baserowUrl) {
      return NextResponse.json(
        { error: 'Missing Baserow URL' },
        { status: 500 },
      );
    }

    const token = await getBaserowToken();

    let updatedCount = 0;
    let copiedOriginalDurationCount = 0;
    let skippedMissingFinalVideoUrlCount = 0;
    const durationsByScene: Record<string, number> = {};
    const failures: Array<{ sceneId: number; error: string }> = [];
    const scenesWithoutAnyDuration: number[] = [];

    for (const sceneId of sceneIds) {
      try {
        const row = await baserowGetSceneRow(baserowUrl, token, sceneId);
        const finalVideoUrl = extractSceneVideoUrl(row[FINAL_VIDEO_FIELD_KEY]);

        let duration: number;
        if (finalVideoUrl) {
          const measured = await probeVideoDurationSeconds(finalVideoUrl);
          duration = Number(measured.toFixed(6));
        } else {
          if (Number.isFinite(resolveFinalSceneDuration(row, false))) {
            skippedMissingFinalVideoUrlCount += 1;
            continue;
          }

          duration = resolveFinalSceneDuration(
            row,
            payload?.allowOriginalDurationFallback === true,
          );
          if (!Number.isFinite(duration)) {
            skippedMissingFinalVideoUrlCount += 1;
            scenesWithoutAnyDuration.push(sceneId);
            continue;
          }
        }

        await baserowPatchSceneRow(baserowUrl, token, sceneId, {
          [FINAL_VIDEO_DURATION_FIELD_KEY]: duration,
        });
        durationsByScene[String(sceneId)] = duration;
        if (!finalVideoUrl) copiedOriginalDurationCount += 1;
        updatedCount += 1;
      } catch (error) {
        failures.push({
          sceneId,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    return NextResponse.json({
      ok: true,
      requestedCount: sceneIds.length,
      updatedCount,
      copiedOriginalDurationCount,
      skippedMissingFinalVideoUrlCount,
      durationsByScene,
      failedCount: failures.length,
      scenesWithoutAnyDuration,
      failures,
    });
  } catch (error) {
    console.error('[calculate-final-video-durations] error:', error);
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 },
    );
  }
}
