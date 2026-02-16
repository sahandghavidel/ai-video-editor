// Enhance/upscale an existing Scene video (field_7098) using REAL-Video-Enhancer
// (Interpolation Factor 2x + AnimeSR), upload the enhanced video to MinIO,
// and overwrite Baserow field_7098.

import { mkdir, rm } from 'fs/promises';
import { createWriteStream, existsSync } from 'fs';
import path from 'path';
import os from 'os';
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
// Video enhancement can take a while.
export const maxDuration = 3600;
export const dynamic = 'force-dynamic';

const SCENES_TABLE_ID = 714;
const VIDEO_FIELD_KEY = 'field_7098'; // Video for Scene (7098)

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

  if (!data?.token) {
    throw new Error('Authentication failed: missing token');
  }

  return data.token;
}

async function baserowGetJson<T>(pathName: string) {
  const baserowUrl = process.env.BASEROW_API_URL;
  if (!baserowUrl) throw new Error('Missing Baserow URL');

  const token = await getJWTToken();

  const res = await fetch(`${baserowUrl}${pathName}`, {
    method: 'GET',
    headers: {
      Authorization: `JWT ${token}`,
    },
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

function getRveRoot(): string {
  const fromEnv = process.env.REAL_VIDEO_ENHANCER_ROOT;
  if (fromEnv && fromEnv.trim()) return fromEnv.trim();

  // Default to a folder inside this repo (preferred for "Option B")
  return path.join(process.cwd(), 'REAL-Video-Enhancer');
}

function getRvePython(rveRoot: string): string {
  const fromEnv = process.env.REAL_VIDEO_ENHANCER_PYTHON;
  if (fromEnv && fromEnv.trim()) return fromEnv.trim();

  // If a venv exists inside the enhancer folder, use it.
  const candidate1 = path.join(rveRoot, 'venv', 'bin', 'python');
  const candidate2 = path.join(rveRoot, 'venv', 'bin', 'python3');

  if (existsSync(candidate1)) return candidate1;
  if (existsSync(candidate2)) return candidate2;

  // Fall back to system python.
  return os.platform() === 'win32' ? 'python' : 'python3';
}

function getRvePaths(rveRoot: string) {
  const backendScript = path.join(rveRoot, 'backend', 'rve-backend.py');
  const modelsDir = path.join(rveRoot, 'models');

  const upscaleModel = process.env.REAL_VIDEO_ENHANCER_UPSCALE_MODEL
    ? process.env.REAL_VIDEO_ENHANCER_UPSCALE_MODEL.trim()
    : path.join(modelsDir, 'AnimeSR.pth');

  const interpolateModel = process.env.REAL_VIDEO_ENHANCER_INTERPOLATE_MODEL
    ? process.env.REAL_VIDEO_ENHANCER_INTERPOLATE_MODEL.trim()
    : path.join(modelsDir, 'rife46.pkl');

  const ffmpegPath = process.env.REAL_VIDEO_ENHANCER_FFMPEG
    ? process.env.REAL_VIDEO_ENHANCER_FFMPEG.trim()
    : path.join(rveRoot, 'bin', 'ffmpeg');

  return { backendScript, upscaleModel, interpolateModel, ffmpegPath };
}

function ensurePathExists(p: string, label: string) {
  if (!existsSync(p)) {
    throw new Error(
      `${label} not found at ${p}. Set REAL_VIDEO_ENHANCER_ROOT (and optional REAL_VIDEO_ENHANCER_* paths) to point at a valid REAL-Video-Enhancer install.`,
    );
  }
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

async function runRve(args: {
  python: string;
  backendScript: string;
  inputPath: string;
  outputPath: string;
  rveRoot: string;
  ffmpegPath: string;
  upscaleModel: string;
  interpolateModel: string;
  interpolateFactor: string;
  backend?: string;
  device?: string;
}): Promise<{ code: number; stdout: string; stderr: string }> {
  const cmdArgs = [
    args.backendScript,
    '--input',
    args.inputPath,
    '--output',
    args.outputPath,
    '--overwrite',
    '--ffmpeg_path',
    args.ffmpegPath,
    '--backend',
    args.backend ?? 'pytorch',
    '--device',
    args.device ?? (os.platform() === 'darwin' ? 'mps' : 'cpu'),
    '--upscale_model',
    args.upscaleModel,
    '--interpolate_model',
    args.interpolateModel,
    '--interpolate_factor',
    args.interpolateFactor,
  ];

  console.log('[enhance-scene-video] spawning enhancer', {
    python: args.python,
    backendScript: args.backendScript,
    ffmpegPath: args.ffmpegPath,
    device: args.device ?? (os.platform() === 'darwin' ? 'mps' : 'cpu'),
    backend: args.backend ?? 'pytorch',
    upscaleModel: args.upscaleModel,
    interpolateModel: args.interpolateModel,
    interpolateFactor: args.interpolateFactor,
  });

  return await new Promise((resolve, reject) => {
    const child = spawn(args.python, cmdArgs, {
      cwd: args.rveRoot,
      env: {
        ...process.env,
        PYTHONUNBUFFERED: '1',
      },
    });

    let stdout = '';
    let stderr = '';

    child.stdout.on('data', (d) => {
      const s = String(d);
      stdout += s;
      // keep logs visible
      process.stdout.write(s);
    });

    child.stderr.on('data', (d) => {
      const s = String(d);
      stderr += s;
      process.stderr.write(s);
    });

    child.on('error', (err) => reject(err));

    child.on('close', (code) => {
      resolve({ code: code ?? -1, stdout, stderr });
    });
  });
}

export async function POST(req: Request) {
  const startedAt = Date.now();
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

    const videoUrlRaw = scene[VIDEO_FIELD_KEY];
    const videoUrl =
      typeof videoUrlRaw === 'string'
        ? videoUrlRaw.trim()
        : String(videoUrlRaw ?? '').trim();

    if (
      !videoUrl ||
      !(videoUrl.startsWith('http://') || videoUrl.startsWith('https://'))
    ) {
      return Response.json(
        { error: `Scene is missing a valid video URL in ${VIDEO_FIELD_KEY}` },
        { status: 400 },
      );
    }

    const rveRoot = getRveRoot();
    const python = getRvePython(rveRoot);
    const { backendScript, upscaleModel, interpolateModel, ffmpegPath } =
      getRvePaths(rveRoot);

    ensurePathExists(rveRoot, 'REAL-Video-Enhancer root');
    ensurePathExists(backendScript, 'rve-backend.py');
    ensurePathExists(upscaleModel, 'Upscale model (AnimeSR)');
    ensurePathExists(interpolateModel, 'Interpolate model (RIFE)');
    ensurePathExists(ffmpegPath, 'ffmpeg binary');

    // Create a dedicated temp directory for this request.
    tempDir = path.join(os.tmpdir(), `rve_scene_${sceneId}_${Date.now()}`);
    await mkdir(tempDir, { recursive: true });

    const inputPath = path.join(tempDir, 'input.mp4');
    const outputPath = path.join(tempDir, 'output.mp4');

    console.log('[enhance-scene-video] downloading input video', {
      sceneId,
      videoUrl,
      inputPath,
    });
    await downloadToFile(videoUrl, inputPath);

    const rve = await runRve({
      python,
      backendScript,
      inputPath,
      outputPath,
      rveRoot,
      ffmpegPath,
      upscaleModel,
      interpolateModel,
      interpolateFactor: '2',
      backend: process.env.REAL_VIDEO_ENHANCER_BACKEND?.trim() || 'pytorch',
      device:
        process.env.REAL_VIDEO_ENHANCER_DEVICE?.trim() ||
        (os.platform() === 'darwin' ? 'mps' : 'cpu'),
    });

    if (rve.code !== 0) {
      const combined = (rve.stderr || rve.stdout || '').slice(0, 4000);
      // Common first-run issue: missing python deps.
      if (
        combined.includes('ModuleNotFoundError') &&
        combined.includes('cv2')
      ) {
        throw new Error(
          `REAL-Video-Enhancer failed (missing Python deps: cv2). Create a venv in REAL-Video-Enhancer/venv and install opencv-python(-headless) + torch, then retry. Raw: ${combined}`,
        );
      }
      throw new Error(
        `REAL-Video-Enhancer failed (exit ${rve.code}): ${combined}`,
      );
    }

    const linkedVideoId = extractLinkedVideoId(scene['field_6889']);
    const timestamp = Date.now();
    const filename = linkedVideoId
      ? `video_${linkedVideoId}_scene_${sceneId}_enhanced_${timestamp}.mp4`
      : `scene_${sceneId}_enhanced_${timestamp}.mp4`;

    console.log('[enhance-scene-video] uploading enhanced video to MinIO', {
      sceneId,
      filename,
    });
    const enhancedMinioUrl = await uploadToMinio(
      outputPath,
      filename,
      'video/mp4',
    );

    await baserowPatchJson<BaserowRow>(
      `/database/rows/table/${SCENES_TABLE_ID}/${sceneId}/`,
      {
        [VIDEO_FIELD_KEY]: enhancedMinioUrl,
      },
    );

    const durationMs = Date.now() - startedAt;

    return Response.json({
      sceneId,
      inputVideoUrl: videoUrl,
      videoUrl: enhancedMinioUrl,
      filename,
      durationMs,
      enhancer: {
        rveRoot,
        backendScript,
        python,
        upscaleModel,
        interpolateModel,
        ffmpegPath,
        interpolateFactor: 2,
      },
    });
  } catch (error) {
    console.error('enhance-scene-video failed:', error);
    return Response.json(
      {
        error:
          error instanceof Error ? error.message : 'Failed to enhance video',
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
