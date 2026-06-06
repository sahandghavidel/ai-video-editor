import { NextRequest, NextResponse } from 'next/server';
import { fitFinalDurationWithUpload } from '@/utils/ffmpeg-fit-duration';
import { getBaserowToken, buildAuthHeader } from '@/lib/baserow-auth';

export const runtime = 'nodejs';

const DEFAULT_SCENES_TABLE_ID = 714;

function parsePositiveInteger(value: unknown): number | null {
  const parsed =
    typeof value === 'number'
      ? value
      : typeof value === 'string'
        ? Number(value)
        : Number.NaN;

  if (!Number.isInteger(parsed) || parsed <= 0) {
    return null;
  }

  return parsed;
}

function parsePositiveNumber(value: unknown): number | null {
  const parsed =
    typeof value === 'number'
      ? value
      : typeof value === 'string'
        ? Number(value)
        : Number.NaN;

  if (!Number.isFinite(parsed) || parsed <= 0) {
    return null;
  }

  return parsed;
}

function getScenesTableId(): number {
  const fromEnv = Number(process.env.BASEROW_SCENES_TABLE_ID);
  if (Number.isInteger(fromEnv) && fromEnv > 0) {
    return fromEnv;
  }
  return DEFAULT_SCENES_TABLE_ID;
}

async function updateSceneWithFittedVideoUrl(
  sceneId: number,
  fittedVideoUrl: string,
): Promise<void> {
  const baserowUrl = process.env.BASEROW_API_URL;
  if (!baserowUrl) {
    throw new Error('Missing BASEROW_API_URL');
  }

  const token = await getBaserowToken();
  const tableId = getScenesTableId();

  const response = await fetch(
    `${baserowUrl}/database/rows/table/${tableId}/${sceneId}/`,
    {
      method: 'PATCH',
      headers: {
        ...buildAuthHeader(token),
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        field_6886: fittedVideoUrl,
      }),
    },
  );

  if (!response.ok) {
    const errorText = await response.text().catch(() => '');
    throw new Error(
      `Failed to update scene with fitted URL: ${response.status} ${errorText}`,
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json().catch(() => null)) as {
      sceneId?: unknown;
      videoId?: unknown;
      videoUrl?: unknown;
      targetDurationSec?: unknown;
      muteAudio?: unknown;
    } | null;

    const sceneId = parsePositiveInteger(body?.sceneId);
    if (!sceneId) {
      return NextResponse.json(
        { error: 'sceneId must be a positive integer' },
        { status: 400 },
      );
    }

    const videoUrl =
      typeof body?.videoUrl === 'string' ? body.videoUrl.trim() : '';
    if (!videoUrl) {
      return NextResponse.json(
        { error: 'videoUrl is required' },
        { status: 400 },
      );
    }

    const targetDurationSec = parsePositiveNumber(body?.targetDurationSec);
    if (!targetDurationSec) {
      return NextResponse.json(
        { error: 'targetDurationSec must be a positive number' },
        { status: 400 },
      );
    }

    const muteAudio = body?.muteAudio === true;
    const videoId =
      typeof body?.videoId === 'string' || typeof body?.videoId === 'number'
        ? body.videoId
        : undefined;

    const processingStart = Date.now();
    console.log(
      `[FIT_DURATION] Scene ${sceneId}: starting precise fit to ${targetDurationSec}s`,
    );

    const result = await fitFinalDurationWithUpload({
      inputUrl: videoUrl,
      targetDurationSec,
      sceneId,
      videoId,
      muteAudio,
      toleranceSec: 0.001,
      maxCorrectionPasses: 2,
      cleanup: true,
    });

    await updateSceneWithFittedVideoUrl(sceneId, result.uploadUrl);

    const processingTimeMs = Date.now() - processingStart;

    return NextResponse.json({
      message: 'Final video duration fitted successfully',
      videoUrl: result.uploadUrl,
      processingTimeMs,
      sourceDurationSecBeforeCfr: result.sourceDurationSecBeforeCfr,
      sourceDurationSecAfterPreparation:
        result.sourceDurationSecAfterPreparation,
      outputDurationSec: result.outputDurationSec,
      targetDurationSec,
      targetDurationFrameAlignedSec: result.targetDurationFrameAlignedSec,
      residualSec: result.residualSec,
      residualFrameAlignedSec: result.residualFrameAlignedSec,
      passes: result.passes,
      appliedSpeeds: result.appliedSpeeds,
      correctionFps: result.correctionFps,
      targetFrameCount: result.targetFrameCount,
      outputFrameCount: result.outputFrameCount,
      frameDeltaApplied: result.frameDeltaApplied,
      frameDeltaRemaining: result.frameDeltaRemaining,
      frameCorrectionApplied: result.frameCorrectionApplied,
      cfrApplied: result.cfrApplied,
      cfrFramerate: result.cfrFramerate,
      vfrDetected: result.vfrDetected,
      muteAudio,
    });
  } catch (error) {
    console.error('Error fitting final video duration:', error);
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : 'Unknown error occurred',
      },
      { status: 500 },
    );
  }
}
