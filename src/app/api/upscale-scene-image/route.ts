import { writeFile, unlink, mkdir, access } from 'fs/promises';
import path from 'path';
import { uploadToMinio } from '@/utils/ffmpeg-cfr';
import { execFile } from 'child_process';
import { promisify } from 'util';

export const runtime = 'nodejs';

const execFileAsync = promisify(execFile);

type BaserowRow = {
  id: number;
  [key: string]: unknown;
};

const SCENES_TABLE_ID = 714;
const SOURCE_IMAGE_FIELD_KEY = 'field_7094'; // Image for Scene (7094)
const UPSCALED_IMAGE_FIELD_KEY = 'field_7095'; // Upscaled Image for Scene (7095)

const REAL_ESRGAN_WEIGHTS_URLS: Record<2 | 4, string> = {
  4: 'https://github.com/xinntao/Real-ESRGAN/releases/download/v0.1.0/RealESRGAN_x4plus.pth',
  // Real-ESRGAN provides a native x2 model; we use it when the user asks for 2x.
  2: 'https://github.com/xinntao/Real-ESRGAN/releases/download/v0.2.1/RealESRGAN_x2plus.pth',
};

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

async function baserowGetJson<T>(
  pathName: string,
  query?: Record<string, string>,
) {
  const baserowUrl = process.env.BASEROW_API_URL;
  if (!baserowUrl) {
    throw new Error('Missing Baserow URL');
  }

  const token = await getJWTToken();
  const url = new URL(`${baserowUrl}${pathName}`);
  if (query) {
    for (const [key, value] of Object.entries(query)) {
      url.searchParams.set(key, value);
    }
  }

  const res = await fetch(url.toString(), {
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
  if (!baserowUrl) {
    throw new Error('Missing Baserow URL');
  }

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

function extractImageUrl(field: unknown): string | null {
  if (typeof field === 'string' && field.trim()) return field;

  if (Array.isArray(field) && field.length > 0) {
    const first = field[0] as unknown;
    if (typeof first === 'string' && first.trim()) return first;
    if (first && typeof first === 'object') {
      const obj = first as {
        url?: unknown;
        image_url?: unknown;
        link?: unknown;
      };
      const candidate = obj.url ?? obj.image_url ?? obj.link;
      if (typeof candidate === 'string' && candidate.trim()) return candidate;
    }
  }

  if (field && typeof field === 'object') {
    const obj = field as { url?: unknown; image_url?: unknown; link?: unknown };
    const candidate = obj.url ?? obj.image_url ?? obj.link;
    if (typeof candidate === 'string' && candidate.trim()) return candidate;
  }

  return null;
}

async function ensureFileDownloaded(url: string, filePath: string) {
  try {
    await access(filePath);
    return;
  } catch {
    // download
  }

  const res = await fetch(url);
  if (!res.ok) {
    const t = await res.text().catch(() => '');
    throw new Error(`Failed to download file: ${res.status} ${t}`);
  }

  const buf = Buffer.from(await res.arrayBuffer());
  await writeFile(filePath, buf);
}

export async function POST(req: Request) {
  let inputPath = '';
  let outputPath = '';

  try {
    const body = (await req.json().catch(() => null)) as {
      sceneId?: unknown;
      scale?: unknown;
    } | null;

    const sceneId =
      typeof body?.sceneId === 'number' ? body.sceneId : Number(body?.sceneId);

    if (!Number.isFinite(sceneId) || sceneId <= 0) {
      return Response.json({ error: 'Scene ID is required' }, { status: 400 });
    }

    const requestedScaleRaw =
      typeof body?.scale === 'number' ? body.scale : Number(body?.scale);
    const requestedScale: 2 | 3 | 4 =
      requestedScaleRaw === 2 ? 2 : requestedScaleRaw === 3 ? 3 : 4;

    // Fetch current scene.
    const currentScene = await baserowGetJson<BaserowRow>(
      `/database/rows/table/${SCENES_TABLE_ID}/${sceneId}/`,
    );

    const sourceUrl = extractImageUrl(currentScene[SOURCE_IMAGE_FIELD_KEY]);

    if (!sourceUrl) {
      return Response.json(
        {
          error:
            'Scene is missing Image for Scene (7094); generate/upload an image first',
        },
        { status: 400 },
      );
    }

    // Download source image.
    const imgRes = await fetch(sourceUrl);
    if (!imgRes.ok) {
      const t = await imgRes.text().catch(() => '');
      throw new Error(`Failed to download source image: ${imgRes.status} ${t}`);
    }

    const imgBuf = Buffer.from(await imgRes.arrayBuffer());
    inputPath = path.resolve(
      '/tmp',
      `scene_${sceneId}_image_${Date.now()}.png`,
    );
    await writeFile(inputPath, imgBuf);

    // Ensure weights exist.
    const weightsDir = path.resolve('/tmp', 'realesrgan-weights');
    await mkdir(weightsDir, { recursive: true });
    const modelScale: 2 | 4 = requestedScale === 2 ? 2 : 4;
    const weightsFilename =
      modelScale === 2 ? 'RealESRGAN_x2plus.pth' : 'RealESRGAN_x4plus.pth';
    const weightsPath = path.join(weightsDir, weightsFilename);
    await ensureFileDownloaded(
      REAL_ESRGAN_WEIGHTS_URLS[modelScale],
      weightsPath,
    );

    // Run python upscaler (MPS).
    outputPath = path.resolve(
      '/tmp',
      `scene_${sceneId}_upscaled_x${requestedScale}_${Date.now()}.png`,
    );

    const pythonPath = path.resolve(process.cwd(), 'parakeet-env/bin/python');
    const scriptPath = path.resolve(
      process.cwd(),
      'scripts/upscale_image_mps.py',
    );

    const { stdout, stderr } = await execFileAsync(
      pythonPath,
      [
        scriptPath,
        '--input',
        inputPath,
        '--output',
        outputPath,
        '--weights',
        weightsPath,
        '--device',
        'mps',
        '--tile-size',
        '512',
        '--tile-pad',
        '10',
        ...(requestedScale === 3 ? ['--target-scale', '3'] : []),
      ],
      {
        timeout: 15 * 60 * 1000,
        maxBuffer: 50 * 1024 * 1024,
      },
    );

    if (stderr) {
      console.log('[UPSCALE] stderr:', stderr);
    }
    if (stdout) {
      console.log('[UPSCALE] stdout:', stdout);
    }

    // Upload to MinIO + save to Baserow.
    const uploadUrl = await uploadToMinio(
      outputPath,
      `scene_${sceneId}_upscaled_x${requestedScale}_${Date.now()}.png`,
      'image/png',
    );

    await baserowPatchJson(
      `/database/rows/table/${SCENES_TABLE_ID}/${sceneId}/`,
      {
        [UPSCALED_IMAGE_FIELD_KEY]: uploadUrl,
      },
    );

    return Response.json({
      success: true,
      imageUrl: uploadUrl,
      sourceUrl,
      scale: requestedScale,
    });
  } catch (error) {
    console.error('[UPSCALE] Failed:', error);
    return Response.json(
      {
        error: error instanceof Error ? error.message : 'Upscale failed',
      },
      { status: 500 },
    );
  } finally {
    // Best-effort cleanup.
    if (inputPath) {
      try {
        await unlink(inputPath);
      } catch {
        // ignore
      }
    }
    if (outputPath) {
      try {
        await unlink(outputPath);
      } catch {
        // ignore
      }
    }
  }
}
