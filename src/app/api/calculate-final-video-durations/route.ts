import { NextRequest, NextResponse } from 'next/server';
import { getBaserowToken, buildAuthHeader } from '@/lib/baserow-auth';
import { probeVideoDurationSeconds } from '@/lib/ffprobe-video-duration';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const SCENES_TABLE_ID = '714';
const FINAL_VIDEO_FIELD_KEY = 'field_6886';
const FINAL_VIDEO_DURATION_FIELD_KEY = 'field_7107';

type BaserowRow = Record<string, unknown>;

function parseNumberish(value?: unknown): number {
  if (typeof value === 'number') return value;
  if (typeof value === 'string') {
    const number = Number(value);
    return Number.isFinite(number) ? number : Number.NaN;
  }
  return Number.NaN;
}

function extractUrl(raw: unknown): string {
  if (typeof raw === 'string') return raw.trim();
  if (!raw) return '';

  if (Array.isArray(raw) && raw.length > 0) {
    return extractUrl(raw[0]);
  }

  if (typeof raw === 'object') {
    const obj = raw as Record<string, unknown>;
    const url = obj.url ?? (obj.file as { url?: unknown } | undefined)?.url;
    if (typeof url === 'string') return url.trim();
  }

  return '';
}

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
    let skippedMissingFinalVideoUrlCount = 0;
    const durationsByScene: Record<string, number> = {};
    const failures: Array<{ sceneId: number; error: string }> = [];
    const scenesWithoutAnyDuration: number[] = [];

    for (const sceneId of sceneIds) {
      try {
        const row = await baserowGetSceneRow(baserowUrl, token, sceneId);
        const finalVideoUrl = extractUrl(row[FINAL_VIDEO_FIELD_KEY]);

        if (!finalVideoUrl) {
          skippedMissingFinalVideoUrlCount += 1;

          // Check if the scene already has a pre-existing duration.
          const existingDuration = parseNumberish(
            row[FINAL_VIDEO_DURATION_FIELD_KEY],
          );
          if (!Number.isFinite(existingDuration) || existingDuration <= 0) {
            scenesWithoutAnyDuration.push(sceneId);
          }

          continue;
        }

        const durationSeconds = await probeVideoDurationSeconds(finalVideoUrl);
        const roundedDuration = Number(durationSeconds.toFixed(6));
        durationsByScene[String(sceneId)] = roundedDuration;

        await baserowPatchSceneRow(baserowUrl, token, sceneId, {
          [FINAL_VIDEO_DURATION_FIELD_KEY]: roundedDuration,
        });

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
