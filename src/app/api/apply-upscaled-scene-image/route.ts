// Apply the Upscaled Image for Scene (field_7095) as a full-frame overlay on top of
// the current final scene video (field_6886).
//
// Requirements:
// - If no upscaled image exists -> return a warning error
// - If the final video already has ANY "applied" output (image/video) -> skip and warn
// - Output overwrites field_6886 (so it participates in existing workflows)

import os from 'os';
import path from 'path';
import { mkdir, rm } from 'fs/promises';
import { createWriteStream } from 'fs';
import { pipeline } from 'stream/promises';
import { Readable } from 'stream';
import type { ReadableStream as WebReadableStream } from 'stream/web';
import { spawn } from 'child_process';

import { uploadToMinio } from '@/utils/ffmpeg-direct';

type BaserowRow = {
  id: number;
  [key: string]: unknown;
};

export const runtime = 'nodejs';
export const maxDuration = 3600;
export const dynamic = 'force-dynamic';

const SCENES_TABLE_ID = 714;
const FINAL_VIDEO_FIELD_KEY = 'field_6886';
const UPSCALED_IMAGE_FIELD_KEY = 'field_7095';

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

function runSpawnCapture(
  command: string,
  args: string[],
): Promise<{ stdout: string; stderr: string; code: number }> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';

    child.stdout.on('data', (d) => (stdout += String(d)));
    child.stderr.on('data', (d) => (stderr += String(d)));
    child.on('error', reject);
    child.on('close', (code) => resolve({ stdout, stderr, code: code ?? -1 }));
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
  const parse = (v?: string | number) => {
    if (typeof v === 'number') return v;
    if (typeof v === 'string') {
      const n = Number(v);
      return Number.isFinite(n) ? n : Number.NaN;
    }
    return Number.NaN;
  };

  const streamDuration = probe.streams?.find(
    (s) => s.codec_type === 'video',
  )?.duration;
  const d1 = parse(streamDuration);
  const d2 = parse(probe.format?.duration);
  const d = Number.isFinite(d1) ? d1 : d2;
  if (!Number.isFinite(d) || d <= 0)
    throw new Error('Unable to determine video duration');
  return d;
}

function getVideoDimensions(probe: FFprobeOutput): {
  width: number;
  height: number;
} {
  const v = probe.streams?.find((s) => s.codec_type === 'video');
  const w =
    typeof v?.width === 'number' && Number.isFinite(v.width) ? v.width : NaN;
  const h =
    typeof v?.height === 'number' && Number.isFinite(v.height) ? v.height : NaN;
  if (!Number.isFinite(w) || !Number.isFinite(h) || w <= 0 || h <= 0) {
    throw new Error('Unable to determine video width/height');
  }
  return { width: w, height: h };
}

function isAlreadyAppliedForScene(
  finalVideoUrl: string,
  sceneId: number,
): boolean {
  try {
    const pathname = new URL(finalVideoUrl).pathname;
    const filename = pathname.split('/').filter(Boolean).pop() ?? '';
    if (!filename) return false;

    // Matches outputs we generate:
    // - scene_<sceneId>_applied_*.mp4
    // - video_<linkedId>_scene_<sceneId>_applied_*.mp4
    const direct = new RegExp(`(^|_)scene_${sceneId}_applied_`, 'i');
    return direct.test(filename);
  } catch {
    return false;
  }
}

async function downloadToFile(url: string, outPath: string) {
  const res = await fetch(url);
  if (!res.ok || !res.body) {
    const t = await res.text().catch(() => '');
    throw new Error(`Failed to download (${res.status}) ${t}`);
  }
  const nodeStream = Readable.fromWeb(res.body as unknown as WebReadableStream);
  await pipeline(nodeStream, createWriteStream(outPath));
  return {
    contentType: res.headers.get('content-type') || '',
  };
}

function extFromContentType(ct: string): string {
  const lower = ct.toLowerCase();
  if (lower.includes('png')) return 'png';
  if (lower.includes('jpeg') || lower.includes('jpg')) return 'jpg';
  if (lower.includes('webp')) return 'webp';
  if (lower.includes('gif')) return 'gif';
  return 'png';
}

async function getJWTToken(): Promise<string> {
  const baserowUrl = process.env.BASEROW_API_URL;
  const email = process.env.BASEROW_EMAIL;
  const password = process.env.BASEROW_PASSWORD;

  if (!baserowUrl || !email || !password) {
    throw new Error('Missing Baserow configuration');
  }

  const response = await fetch(`${baserowUrl}/user/token-auth/`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });

  if (!response.ok) {
    const errorText = await response.text().catch(() => '');
    throw new Error(`Authentication failed: ${response.status} ${errorText}`);
  }

  const data = (await response.json().catch(() => null)) as {
    token?: string;
  } | null;
  if (!data?.token) throw new Error('Authentication failed: missing token');
  return data.token;
}

async function baserowGetJson<T>(pathName: string) {
  const baserowUrl = process.env.BASEROW_API_URL;
  if (!baserowUrl) throw new Error('Missing Baserow URL');

  const token = await getJWTToken();
  const res = await fetch(`${baserowUrl}${pathName}`, {
    method: 'GET',
    headers: { Authorization: `JWT ${token}` },
  });

  if (!res.ok) {
    const t = await res.text().catch(() => '');
    throw new Error(`Baserow GET failed: ${res.status} ${t}`);
  }

  return (await res.json()) as T;
}

async function baserowPatchJson<T>(
  pathName: string,
  body: Record<string, unknown>,
) {
  const baserowUrl = process.env.BASEROW_API_URL;
  if (!baserowUrl) throw new Error('Missing Baserow URL');

  const token = await getJWTToken();
  const res = await fetch(`${baserowUrl}${pathName}`, {
    method: 'PATCH',
    headers: {
      Authorization: `JWT ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const t = await res.text().catch(() => '');
    throw new Error(`Baserow PATCH failed: ${res.status} ${t}`);
  }

  return (await res.json().catch(() => null)) as T;
}

function extractLinkedVideoId(field: unknown): number | null {
  const tryExtractId = (obj: unknown): number | null => {
    if (!obj || typeof obj !== 'object') return null;
    if (!('id' in obj)) return null;
    const rawId = (obj as { id?: unknown }).id;
    if (typeof rawId === 'number' && Number.isFinite(rawId)) return rawId;
    if (typeof rawId === 'string') {
      const n = Number(rawId);
      return Number.isFinite(n) ? n : null;
    }
    return null;
  };

  if (typeof field === 'number' && Number.isFinite(field)) return field;
  if (typeof field === 'string') {
    const n = Number(field);
    return Number.isFinite(n) ? n : null;
  }

  if (Array.isArray(field) && field.length > 0) {
    const first = field[0] as unknown;
    if (typeof first === 'number' && Number.isFinite(first)) return first;
    if (typeof first === 'string') {
      const n = Number(first);
      return Number.isFinite(n) ? n : null;
    }
    const extracted = tryExtractId(first);
    if (extracted) return extracted;
  }

  const extracted = tryExtractId(field);
  if (extracted) return extracted;

  return null;
}

export async function POST(req: Request) {
  let tempDir: string | null = null;

  try {
    const body = (await req.json().catch(() => null)) as {
      sceneId?: unknown;
    } | null;
    const sceneId =
      typeof body?.sceneId === 'number' ? body.sceneId : Number(body?.sceneId);

    if (!Number.isFinite(sceneId) || sceneId <= 0) {
      return Response.json({ error: 'Scene ID is required' }, { status: 400 });
    }

    const scene = await baserowGetJson<BaserowRow>(
      `/database/rows/table/${SCENES_TABLE_ID}/${sceneId}/`,
    );

    const finalVideoUrlRaw = scene[FINAL_VIDEO_FIELD_KEY];
    const finalVideoUrl =
      typeof finalVideoUrlRaw === 'string'
        ? finalVideoUrlRaw.trim()
        : String(finalVideoUrlRaw ?? '').trim();

    if (
      !finalVideoUrl ||
      !(
        finalVideoUrl.startsWith('http://') ||
        finalVideoUrl.startsWith('https://')
      )
    ) {
      return Response.json(
        {
          error: `Scene is missing a valid final video URL in ${FINAL_VIDEO_FIELD_KEY}`,
        },
        { status: 400 },
      );
    }

    if (isAlreadyAppliedForScene(finalVideoUrl, sceneId)) {
      return Response.json(
        {
          alreadyApplied: true,
          sceneId,
          videoUrl: finalVideoUrl,
          message: 'Already applied (image/video) for this scene',
        },
        { status: 409 },
      );
    }

    const upscaledRaw = scene[UPSCALED_IMAGE_FIELD_KEY];
    const upscaledUrl =
      typeof upscaledRaw === 'string'
        ? upscaledRaw.trim()
        : String(upscaledRaw ?? '').trim();

    if (
      !upscaledUrl ||
      !(upscaledUrl.startsWith('http://') || upscaledUrl.startsWith('https://'))
    ) {
      return Response.json(
        {
          error: `No upscaled image found for this scene in ${UPSCALED_IMAGE_FIELD_KEY} (Upscaled Image for Scene 7095). Please click Upscale first.`,
        },
        { status: 400 },
      );
    }

    tempDir = path.join(
      os.tmpdir(),
      `apply-upscaled-image-${sceneId}-${Date.now()}`,
    );
    await mkdir(tempDir, { recursive: true });

    const finalPath = path.join(tempDir, 'final.mp4');
    const overlayBase = path.join(tempDir, 'overlay');

    await downloadToFile(finalVideoUrl, finalPath);
    const overlayDl = await downloadToFile(upscaledUrl, `${overlayBase}.bin`);
    const overlayExt = extFromContentType(overlayDl.contentType);
    const overlayPath = `${overlayBase}.${overlayExt}`;

    // Rename the downloaded overlay into a more FFmpeg-friendly extension.
    // (We just download twice with different target names to avoid fs.rename in edge cases.)
    await downloadToFile(upscaledUrl, overlayPath);

    const finalProbe = await probeVideo(finalPath);
    const finalDuration = parseDurationSeconds(finalProbe);
    const { width: outW, height: outH } = getVideoDimensions(finalProbe);

    const outPath = path.join(tempDir, 'out.mp4');

    // Full-frame "cover" scaling: make the overlay fill the whole frame.
    const filterComplex = [
      `[1:v]scale=${outW}:${outH}:force_original_aspect_ratio=increase,crop=${outW}:${outH},setsar=1,format=rgba[ov]`,
      `[0:v][ov]overlay=0:0:shortest=1:repeatlast=1[vout]`,
    ].join(';');

    const ffmpegArgs = [
      '-hide_banner',
      '-loglevel',
      'error',
      '-i',
      finalPath,
      '-loop',
      '1',
      '-i',
      overlayPath,
      '-filter_complex',
      filterComplex,
      '-map',
      '[vout]',
      // Keep original audio (if any)
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
      'aac',
      '-b:a',
      '192k',
      '-movflags',
      '+faststart',
      outPath,
    ];

    const { stderr, code } = await runSpawnCapture('ffmpeg', ffmpegArgs);
    if (code !== 0) {
      throw new Error(`ffmpeg failed (exit ${code}): ${stderr.slice(0, 4000)}`);
    }

    const linkedVideoId = extractLinkedVideoId(scene['field_6889']);
    const timestamp = Date.now();
    const filename = linkedVideoId
      ? `video_${linkedVideoId}_scene_${sceneId}_applied_img_${timestamp}.mp4`
      : `scene_${sceneId}_applied_img_${timestamp}.mp4`;

    const uploadUrl = await uploadToMinio(outPath, filename, 'video/mp4');

    await baserowPatchJson<BaserowRow>(
      `/database/rows/table/${SCENES_TABLE_ID}/${sceneId}/`,
      {
        [FINAL_VIDEO_FIELD_KEY]: uploadUrl,
      },
    );

    return Response.json({
      sceneId,
      videoUrl: uploadUrl,
      finalVideoUrl,
      upscaledImageUrl: upscaledUrl,
      finalDuration,
      filename,
    });
  } catch (error) {
    console.error('apply-upscaled-scene-image failed:', error);
    return Response.json(
      {
        error:
          error instanceof Error
            ? error.message
            : 'Failed to apply upscaled image',
      },
      { status: 500 },
    );
  } finally {
    if (tempDir) {
      try {
        await rm(tempDir, { recursive: true, force: true });
      } catch {
        // ignore
      }
    }
  }
}
