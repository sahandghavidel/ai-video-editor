import { spawn } from 'child_process';
import { createWriteStream } from 'fs';
import { mkdir, rm } from 'fs/promises';
import os from 'os';
import path from 'path';
import { Readable } from 'stream';
import { pipeline } from 'stream/promises';
import type { ReadableStream as WebReadableStream } from 'stream/web';

import { getBaserowToken, buildAuthHeader } from '@/lib/baserow-auth';
import { uploadToMinio } from '@/utils/ffmpeg-direct';

export const runtime = 'nodejs';
export const maxDuration = 3600;
export const dynamic = 'force-dynamic';

type BaserowRow = {
  id: number;
  [key: string]: unknown;
};

type FFprobeStream = {
  codec_type?: string;
  width?: number;
  height?: number;
  duration?: string | number;
};

type FFprobeOutput = {
  streams?: FFprobeStream[];
  format?: { duration?: string | number };
};

const SCENES_TABLE_ID = 714;
const FINAL_VIDEO_FIELD_KEY = 'field_6886';
const HYPERFRAMES_VIDEO_FIELD_KEY = 'field_7368';

function runSpawnCapture(
  command: string,
  args: string[],
): Promise<{ stdout: string; stderr: string; code: number }> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';

    child.stdout.on('data', (data) => (stdout += String(data)));
    child.stderr.on('data', (data) => (stderr += String(data)));
    child.on('error', reject);
    child.on('close', (code) =>
      resolve({ stdout, stderr, code: code ?? -1 }),
    );
  });
}

async function probeVideo(inputPath: string): Promise<FFprobeOutput> {
  const { stdout, stderr, code } = await runSpawnCapture('ffprobe', [
    '-v',
    'quiet',
    '-print_format',
    'json',
    '-show_format',
    '-show_streams',
    inputPath,
  ]);
  if (code !== 0) {
    throw new Error(`ffprobe failed (exit ${code}): ${stderr.slice(0, 2000)}`);
  }
  return (JSON.parse(stdout) ?? {}) as FFprobeOutput;
}

function parseDurationSeconds(probe: FFprobeOutput): number {
  const values = [
    probe.format?.duration,
    ...(probe.streams ?? []).map((stream) => stream.duration),
  ]
    .map((value) => Number(value))
    .filter((value) => Number.isFinite(value) && value > 0);
  const duration = values.length > 0 ? Math.max(...values) : Number.NaN;
  if (!Number.isFinite(duration) || duration <= 0) {
    throw new Error('Unable to determine video duration');
  }
  return duration;
}

function getVideoDimensions(probe: FFprobeOutput) {
  const video = probe.streams?.find((stream) => stream.codec_type === 'video');
  const width = Number(video?.width);
  const height = Number(video?.height);
  if (!(width > 0) || !(height > 0)) {
    throw new Error('Unable to determine final video dimensions');
  }
  return { width, height };
}

function getUrlField(scene: BaserowRow, fieldKey: string): string {
  const value = scene[fieldKey];
  return typeof value === 'string' ? value.trim() : String(value ?? '').trim();
}

function isHttpUrl(value: string): boolean {
  return value.startsWith('http://') || value.startsWith('https://');
}

function isAlreadyApplied(finalVideoUrl: string, sceneId: number): boolean {
  try {
    const filename = new URL(finalVideoUrl).pathname.split('/').pop() ?? '';
    return new RegExp(`(^|_)scene_${sceneId}_hf_applied_`, 'i').test(filename);
  } catch {
    return false;
  }
}

async function downloadToFile(url: string, outputPath: string) {
  const response = await fetch(url);
  if (!response.ok || !response.body) {
    const text = await response.text().catch(() => '');
    throw new Error(`Failed to download video (${response.status}) ${text}`);
  }
  await pipeline(
    Readable.fromWeb(response.body as unknown as WebReadableStream),
    createWriteStream(outputPath),
  );
}

async function getScene(sceneId: number): Promise<BaserowRow> {
  const baserowUrl = process.env.BASEROW_API_URL?.replace(/\/+$/, '');
  if (!baserowUrl) throw new Error('Missing Baserow URL');
  const token = await getBaserowToken();
  const response = await fetch(
    `${baserowUrl}/database/rows/table/${SCENES_TABLE_ID}/${sceneId}/`,
    {
      headers: { ...buildAuthHeader(token) },
      cache: 'no-store',
    },
  );
  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new Error(`Baserow GET failed: ${response.status} ${text}`);
  }
  return (await response.json()) as BaserowRow;
}

async function saveFinalVideo(sceneId: number, videoUrl: string) {
  const baserowUrl = process.env.BASEROW_API_URL?.replace(/\/+$/, '');
  if (!baserowUrl) throw new Error('Missing Baserow URL');
  const token = await getBaserowToken();
  const response = await fetch(
    `${baserowUrl}/database/rows/table/${SCENES_TABLE_ID}/${sceneId}/`,
    {
      method: 'PATCH',
      headers: {
        ...buildAuthHeader(token),
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ [FINAL_VIDEO_FIELD_KEY]: videoUrl }),
    },
  );
  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new Error(`Baserow PATCH failed: ${response.status} ${text}`);
  }
}

export async function POST(request: Request) {
  let temporaryDirectory: string | null = null;

  try {
    const body = (await request.json().catch(() => null)) as {
      sceneId?: unknown;
    } | null;
    const sceneId = Number(body?.sceneId);
    if (!Number.isFinite(sceneId) || sceneId <= 0) {
      return Response.json({ error: 'Scene ID is required' }, { status: 400 });
    }

    const scene = await getScene(sceneId);
    const finalVideoUrl = getUrlField(scene, FINAL_VIDEO_FIELD_KEY);
    const hyperFramesVideoUrl = getUrlField(
      scene,
      HYPERFRAMES_VIDEO_FIELD_KEY,
    );

    if (!isHttpUrl(finalVideoUrl)) {
      return Response.json(
        { error: `Scene is missing a valid ${FINAL_VIDEO_FIELD_KEY} URL` },
        { status: 400 },
      );
    }
    if (isAlreadyApplied(finalVideoUrl, sceneId)) {
      return Response.json(
        {
          alreadyApplied: true,
          sceneId,
          videoUrl: finalVideoUrl,
          message: 'HyperFrames video is already applied for this scene',
        },
        { status: 409 },
      );
    }
    if (!isHttpUrl(hyperFramesVideoUrl)) {
      return Response.json(
        {
          error: `Scene is missing a valid ${HYPERFRAMES_VIDEO_FIELD_KEY} URL. Render HF first.`,
        },
        { status: 400 },
      );
    }

    temporaryDirectory = path.join(
      os.tmpdir(),
      `apply-hyperframes-${sceneId}-${Date.now()}`,
    );
    await mkdir(temporaryDirectory, { recursive: true });
    const finalPath = path.join(temporaryDirectory, 'final.mp4');
    const hyperFramesPath = path.join(temporaryDirectory, 'hyperframes.mp4');
    const outputPath = path.join(temporaryDirectory, 'output.mp4');

    await Promise.all([
      downloadToFile(finalVideoUrl, finalPath),
      downloadToFile(hyperFramesVideoUrl, hyperFramesPath),
    ]);

    const [finalProbe, hyperFramesProbe] = await Promise.all([
      probeVideo(finalPath),
      probeVideo(hyperFramesPath),
    ]);
    const finalDuration = parseDurationSeconds(finalProbe);
    const hyperFramesDuration = parseDurationSeconds(hyperFramesProbe);
    const { width, height } = getVideoDimensions(finalProbe);
    const speed = hyperFramesDuration / finalDuration;
    if (!Number.isFinite(speed) || speed <= 0) {
      throw new Error('Invalid HyperFrames duration ratio');
    }

    const filterComplex = [
      '[0:v]setpts=PTS-STARTPTS[base]',
      `[1:v]scale=${width}:${height}:force_original_aspect_ratio=decrease,pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2,setsar=1,setpts=PTS/${speed.toFixed(8)},trim=0:${finalDuration.toFixed(6)},tpad=stop_mode=clone:stop_duration=0.25,setpts=PTS-STARTPTS[hf]`,
      `[base][hf]overlay=0:0:repeatlast=1,trim=0:${finalDuration.toFixed(6)},setpts=PTS-STARTPTS[vout]`,
    ].join(';');

    const { stderr, code } = await runSpawnCapture('ffmpeg', [
      '-hide_banner',
      '-loglevel',
      'error',
      '-i',
      finalPath,
      '-i',
      hyperFramesPath,
      '-filter_complex',
      filterComplex,
      '-map',
      '[vout]',
      '-map',
      '0:a?',
      '-t',
      finalDuration.toFixed(6),
      '-c:v',
      'libx264',
      '-preset',
      'medium',
      '-crf',
      '20',
      '-pix_fmt',
      'yuv420p',
      '-c:a',
      'copy',
      '-movflags',
      '+faststart',
      outputPath,
    ]);
    if (code !== 0) {
      throw new Error(`ffmpeg failed (exit ${code}): ${stderr.slice(0, 4000)}`);
    }

    const filename = `scene_${sceneId}_hf_applied_${Date.now()}.mp4`;
    const videoUrl = await uploadToMinio(outputPath, filename, 'video/mp4');
    await saveFinalVideo(sceneId, videoUrl);

    return Response.json({
      sceneId,
      videoUrl,
      finalVideoUrl,
      hyperFramesVideoUrl,
      finalDuration,
      hyperFramesDuration,
      speed,
      filename,
    });
  } catch (error) {
    console.error('apply-hyperframes-video failed:', error);
    return Response.json(
      {
        error:
          error instanceof Error
            ? error.message
            : 'Failed to apply HyperFrames video',
      },
      { status: 500 },
    );
  } finally {
    if (temporaryDirectory) {
      await rm(temporaryDirectory, { recursive: true, force: true }).catch(
        () => undefined,
      );
    }
  }
}
