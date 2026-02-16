// Apply the enhanced scene video (field_7098) on top of the current scene video (field_6886)
// while mixing audio from BOTH sources.
//
// Steps:
// 1) Ensure scene has a final video (field_6886) and an enhanced video (field_7098)
// 2) Probe both, get final duration + dimensions
// 3) Time-stretch enhanced video+audio to match final duration exactly
// 4) Overlay enhanced video over final video (full-frame)
// 5) Mix audio from final + enhanced
// 6) Upload to MinIO and overwrite field_6886

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
const ENHANCED_VIDEO_FIELD_KEY = 'field_7098';

function isAlreadyAppliedForScene(
  finalVideoUrl: string,
  sceneId: number,
): boolean {
  try {
    const pathname = new URL(finalVideoUrl).pathname;
    const filename = pathname.split('/').filter(Boolean).pop() ?? '';
    if (!filename) return false;

    // Matches outputs we generate here:
    // - scene_<sceneId>_applied_<ts>.mp4
    // - video_<linkedVideoId>_scene_<sceneId>_applied_<ts>.mp4
    const direct = new RegExp(`(^|_)scene_${sceneId}_applied_`, 'i');
    return direct.test(filename);
  } catch {
    return false;
  }
}

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

async function probeVideo(inputPathOrUrl: string): Promise<FFprobeOutput> {
  const { stdout, stderr, code } = await runSpawnCapture('ffprobe', [
    '-v',
    'quiet',
    '-print_format',
    'json',
    '-show_format',
    '-show_streams',
    inputPathOrUrl,
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

function hasAudioStream(probe: FFprobeOutput): boolean {
  return Boolean(probe.streams?.some((s) => s.codec_type === 'audio'));
}

function buildAtempoChain(speed: number): string {
  // atempo only supports 0.5..2.0 per filter.
  if (!Number.isFinite(speed) || speed <= 0)
    throw new Error('Invalid speed factor');

  const parts: number[] = [];
  let remaining = speed;

  while (remaining > 2.0 + 1e-9) {
    parts.push(2.0);
    remaining /= 2.0;
  }

  while (remaining < 0.5 - 1e-9) {
    parts.push(0.5);
    remaining /= 0.5;
  }

  // Clamp remainder into legal range (with tiny tolerance)
  const r = Math.max(0.5, Math.min(2.0, remaining));
  // Avoid identity atempo=1.0 clutter when speed is very close.
  if (Math.abs(r - 1.0) > 1e-6) parts.push(r);

  if (parts.length === 0) return 'anull';
  return parts.map((p) => `atempo=${p.toFixed(6)}`).join(',');
}

async function downloadToFile(url: string, outPath: string) {
  const res = await fetch(url);
  if (!res.ok || !res.body) {
    const t = await res.text().catch(() => '');
    throw new Error(`Failed to download video (${res.status}) ${t}`);
  }

  const nodeStream = Readable.fromWeb(res.body as unknown as WebReadableStream);
  await pipeline(nodeStream, createWriteStream(outPath));
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

    // Avoid applying multiple times on top of itself.
    if (isAlreadyAppliedForScene(finalVideoUrl, sceneId)) {
      return Response.json(
        {
          alreadyApplied: true,
          sceneId,
          videoUrl: finalVideoUrl,
          message: 'Already applied for this scene',
        },
        { status: 409 },
      );
    }

    const enhancedVideoUrlRaw = scene[ENHANCED_VIDEO_FIELD_KEY];
    const enhancedVideoUrl =
      typeof enhancedVideoUrlRaw === 'string'
        ? enhancedVideoUrlRaw.trim()
        : String(enhancedVideoUrlRaw ?? '').trim();

    if (
      !enhancedVideoUrl ||
      !(
        enhancedVideoUrl.startsWith('http://') ||
        enhancedVideoUrl.startsWith('https://')
      )
    ) {
      return Response.json(
        {
          error: `Scene is missing a valid enhanced video URL in ${ENHANCED_VIDEO_FIELD_KEY}. Generate + Enhance first.`,
        },
        { status: 400 },
      );
    }

    // Heuristic: ensure the enhanced URL looks like it came from our enhancer step.
    // (We name outputs *_enhanced_*.mp4)
    if (!enhancedVideoUrl.includes('_enhanced_')) {
      return Response.json(
        {
          error: `Video in ${ENHANCED_VIDEO_FIELD_KEY} does not look enhanced yet. Please click Enhance first (expected filename containing _enhanced_).`,
        },
        { status: 400 },
      );
    }

    tempDir = path.join(
      os.tmpdir(),
      `apply-enhanced-scene-${sceneId}-${Date.now()}`,
    );
    await mkdir(tempDir, { recursive: true });

    const finalPath = path.join(tempDir, 'final.mp4');
    const enhancedPath = path.join(tempDir, 'enhanced.mp4');
    const outPath = path.join(tempDir, 'out.mp4');

    console.log('[apply-enhanced-scene-video] downloading inputs', {
      sceneId,
      finalVideoUrl,
      enhancedVideoUrl,
    });

    await downloadToFile(finalVideoUrl, finalPath);
    await downloadToFile(enhancedVideoUrl, enhancedPath);

    const finalProbe = await probeVideo(finalPath);
    const enhancedProbe = await probeVideo(enhancedPath);

    const finalDuration = parseDurationSeconds(finalProbe);
    const enhancedDuration = parseDurationSeconds(enhancedProbe);
    const { width: outW, height: outH } = getVideoDimensions(finalProbe);

    const speed = enhancedDuration / finalDuration;
    if (!Number.isFinite(speed) || speed <= 0) {
      throw new Error('Invalid speed computed from durations');
    }

    const finalHasAudio = hasAudioStream(finalProbe);
    const enhancedHasAudio = hasAudioStream(enhancedProbe);

    // Build filter graph.
    // - Base video trimmed to final duration.
    // - Enhanced scaled+stretched to match final duration.
    // - Enhanced overlaid full frame.
    // - Audio mixed from both inputs (missing audio => silence).

    const aTempo = buildAtempoChain(speed);

    const baseVideo = `[0:v]trim=0:${finalDuration.toFixed(6)},setpts=PTS-STARTPTS[basev]`;
    const enhVideo = `[1:v]scale=${outW}:${outH}:force_original_aspect_ratio=decrease,pad=${outW}:${outH}:(ow-iw)/2:(oh-ih)/2,setsar=1,setpts=PTS/${speed.toFixed(8)},trim=0:${finalDuration.toFixed(6)},setpts=PTS-STARTPTS[enhv]`;
    const overlayV = `[basev][enhv]overlay=0:0:shortest=1:repeatlast=1[vout]`;

    // Audio: resample to 48k stereo for predictable mix.
    const outSr = 48000;
    const outChLayout = 'stereo';

    const baseA = finalHasAudio
      ? `[0:a]aresample=${outSr},aformat=channel_layouts=${outChLayout},atrim=0:${finalDuration.toFixed(6)},asetpts=N/SR/TB[a0]`
      : `anullsrc=r=${outSr}:cl=${outChLayout},atrim=0:${finalDuration.toFixed(6)},asetpts=N/SR/TB[a0]`;

    const enhA = enhancedHasAudio
      ? `[1:a]${aTempo},aresample=${outSr},aformat=channel_layouts=${outChLayout},atrim=0:${finalDuration.toFixed(6)},asetpts=N/SR/TB[a1]`
      : `anullsrc=r=${outSr}:cl=${outChLayout},atrim=0:${finalDuration.toFixed(6)},asetpts=N/SR/TB[a1]`;

    const mixA = `[a0][a1]amix=inputs=2:duration=first:dropout_transition=0:normalize=0,alimiter=limit=0.98[aout]`;

    const filterComplex = [
      baseVideo,
      enhVideo,
      overlayV,
      baseA,
      enhA,
      mixA,
    ].join(';');

    const ffmpegArgs = [
      '-hide_banner',
      '-loglevel',
      'error',
      '-i',
      finalPath,
      '-i',
      enhancedPath,
      '-filter_complex',
      filterComplex,
      '-map',
      '[vout]',
      '-map',
      '[aout]',
      // Ensure exact duration.
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

    console.log('[apply-enhanced-scene-video] ffmpeg', {
      sceneId,
      finalDuration,
      enhancedDuration,
      speed,
      finalHasAudio,
      enhancedHasAudio,
      outW,
      outH,
    });

    const { stderr, code } = await runSpawnCapture('ffmpeg', ffmpegArgs);
    if (code !== 0) {
      throw new Error(`ffmpeg failed (exit ${code}): ${stderr.slice(0, 4000)}`);
    }

    const linkedVideoId = extractLinkedVideoId(scene['field_6889']);
    const timestamp = Date.now();
    const filename = linkedVideoId
      ? `video_${linkedVideoId}_scene_${sceneId}_applied_${timestamp}.mp4`
      : `scene_${sceneId}_applied_${timestamp}.mp4`;

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
      enhancedVideoUrl,
      finalDuration,
      enhancedDuration,
      speed,
      filename,
    });
  } catch (error) {
    console.error('apply-enhanced-scene-video failed:', error);
    return Response.json(
      {
        error:
          error instanceof Error
            ? error.message
            : 'Failed to apply enhanced video',
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
