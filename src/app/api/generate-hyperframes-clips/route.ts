import { mkdtemp, rm } from 'fs/promises';
import os from 'os';
import path from 'path';

import { buildAuthHeader, getBaserowToken } from '@/lib/baserow-auth';
import {
  createAlignedHyperFramesCuts,
  type HyperFramesVideoCut,
} from '@/lib/hyperframes-video-separation';
import { uploadToMinio } from '@/utils/ffmpeg-direct';

export const runtime = 'nodejs';
export const maxDuration = 3600;
export const dynamic = 'force-dynamic';

const SCENES_TABLE_ID = 714;
const HYPERFRAMES_VIDEO_FIELD_KEY = 'field_7368';

function isHttpUrl(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    (value.startsWith('http://') || value.startsWith('https://'))
  );
}

function normalizeCuts(value: unknown): HyperFramesVideoCut[] {
  if (!Array.isArray(value)) return [];
  const sceneIds = new Set<number>();
  return value
    .map((entry): HyperFramesVideoCut | null => {
      if (!entry || typeof entry !== 'object') return null;
      const record = entry as Record<string, unknown>;
      const sceneId = Number(record.sceneId);
      const startTime = Number(record.startTime);
      const endTime = Number(record.endTime);
      const duration = Number(record.duration);
      if (
        !Number.isInteger(sceneId) ||
        sceneId <= 0 ||
        sceneIds.has(sceneId) ||
        !Number.isFinite(startTime) ||
        !Number.isFinite(endTime) ||
        !Number.isFinite(duration) ||
        startTime < 0 ||
        endTime <= startTime ||
        duration <= 0 ||
        Math.abs(endTime - startTime - duration) > 0.002
      ) {
        return null;
      }
      sceneIds.add(sceneId);
      return { sceneId, startTime, endTime, duration };
    })
    .filter((cut): cut is HyperFramesVideoCut => cut !== null)
    .sort((a, b) => a.startTime - b.startTime);
}

async function saveClipUrl(
  sceneId: number,
  clipUrl: string,
  baserowUrl: string,
  token: string,
) {
  const response = await fetch(
    `${baserowUrl}/database/rows/table/${SCENES_TABLE_ID}/${sceneId}/`,
    {
      method: 'PATCH',
      headers: {
        ...buildAuthHeader(token),
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ [HYPERFRAMES_VIDEO_FIELD_KEY]: clipUrl }),
    },
  );
  if (!response.ok) {
    const detail = await response.text().catch(() => '');
    throw new Error(
      `Could not save HyperFrames clip for scene ${sceneId}: ${response.status} ${detail}`,
    );
  }
}

export async function POST(request: Request) {
  let workingDirectory: string | null = null;
  try {
    const body = (await request.json().catch(() => null)) as {
      finalSourceUrl?: unknown;
      hyperFramesSourceUrl?: unknown;
      cuts?: unknown;
    } | null;
    if (!isHttpUrl(body?.finalSourceUrl)) {
      return Response.json({ error: 'Final source URL is required' }, { status: 400 });
    }
    if (!isHttpUrl(body?.hyperFramesSourceUrl)) {
      return Response.json(
        { error: 'HyperFrames source URL is required' },
        { status: 400 },
      );
    }
    const cuts = normalizeCuts(body?.cuts);
    if (!cuts.length) {
      return Response.json(
        { error: 'At least one valid HyperFrames cut is required' },
        { status: 400 },
      );
    }

    const baserowUrl = process.env.BASEROW_API_URL?.replace(/\/+$/, '');
    if (!baserowUrl) throw new Error('Missing Baserow URL');
    const token = await getBaserowToken();
    workingDirectory = await mkdtemp(
      path.join(os.tmpdir(), 'separate-hyperframes-'),
    );

    const aligned = await createAlignedHyperFramesCuts({
      finalSourceUrl: body.finalSourceUrl,
      hyperFramesSourceUrl: body.hyperFramesSourceUrl,
      cuts,
      workingDirectory,
    });

    const uploadedClips: Array<{ sceneId: number; clipUrl: string }> = [];
    for (const output of aligned.outputs) {
      const filename =
        `hyperframes_scene_${output.sceneId}_segment_` +
        `${Date.now()}_${Math.random().toString(36).slice(2, 8)}.mp4`;
      const clipUrl = await uploadToMinio(
        output.outputPath,
        filename,
        'video/mp4',
      );
      uploadedClips.push({ sceneId: output.sceneId, clipUrl });
    }

    for (const clip of uploadedClips) {
      await saveClipUrl(clip.sceneId, clip.clipUrl, baserowUrl, token);
    }

    return Response.json({
      success: true,
      clips: uploadedClips,
      finalDuration: aligned.finalDuration,
      hyperFramesDuration: aligned.hyperFramesDuration,
      alignedDuration: aligned.targetDuration,
      stretchFactor: aligned.stretchFactor,
      frameRate: aligned.frameRate,
    });
  } catch (error) {
    console.error('generate-hyperframes-clips failed:', error);
    return Response.json(
      {
        error:
          error instanceof Error
            ? error.message
            : 'Failed to generate HyperFrames clips',
      },
      { status: 500 },
    );
  } finally {
    if (workingDirectory) {
      await rm(workingDirectory, { recursive: true, force: true }).catch(
        () => undefined,
      );
    }
  }
}
