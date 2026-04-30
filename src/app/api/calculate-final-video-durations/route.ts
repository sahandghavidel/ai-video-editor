import { NextRequest, NextResponse } from 'next/server';
import { spawn } from 'child_process';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const SCENES_TABLE_ID = '714';
const FINAL_VIDEO_FIELD_KEY = 'field_6886';
const FINAL_VIDEO_DURATION_FIELD_KEY = 'field_7107';

type BaserowRow = Record<string, unknown>;

type FFprobeStream = {
  duration?: string | number;
};

type FFprobeOutput = {
  format?: { duration?: string | number };
  streams?: FFprobeStream[];
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

function parseNumberish(value?: string | number): number {
  if (typeof value === 'number') return value;
  if (typeof value === 'string') {
    const n = Number(value);
    return Number.isFinite(n) ? n : Number.NaN;
  }
  return Number.NaN;
}

async function probeVideoDurationSeconds(videoUrl: string): Promise<number> {
  const { stdout, stderr, code } = await runSpawnCapture('ffprobe', [
    '-v',
    'quiet',
    '-print_format',
    'json',
    '-show_format',
    '-show_streams',
    videoUrl,
  ]);

  if (code !== 0) {
    throw new Error(`ffprobe failed (${code}): ${stderr.slice(0, 2000)}`);
  }

  const probe = (JSON.parse(stdout) ?? {}) as FFprobeOutput;

  const candidates: number[] = [];
  const formatDuration = parseNumberish(probe.format?.duration);
  if (Number.isFinite(formatDuration) && formatDuration > 0) {
    candidates.push(formatDuration);
  }

  for (const stream of probe.streams ?? []) {
    const streamDuration = parseNumberish(stream.duration);
    if (Number.isFinite(streamDuration) && streamDuration > 0) {
      candidates.push(streamDuration);
    }
  }

  const duration = candidates.length > 0 ? Math.max(...candidates) : Number.NaN;
  if (!Number.isFinite(duration) || duration <= 0) {
    throw new Error('Unable to determine video duration');
  }

  return duration;
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
    const t = await response.text().catch(() => '');
    throw new Error(`Authentication failed: ${response.status} ${t}`);
  }

  const data = (await response.json().catch(() => null)) as {
    token?: unknown;
  } | null;
  const token = typeof data?.token === 'string' ? data.token : '';
  if (!token) throw new Error('Authentication failed: missing token');
  return token;
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
      headers: { Authorization: `JWT ${token}` },
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
        Authorization: `JWT ${token}`,
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

    const token = await getJWTToken();

    let updatedCount = 0;
    let skippedMissingFinalVideoUrlCount = 0;
    const failures: Array<{ sceneId: number; error: string }> = [];

    for (const sceneId of sceneIds) {
      try {
        const row = await baserowGetSceneRow(baserowUrl, token, sceneId);
        const finalVideoUrl = extractUrl(row[FINAL_VIDEO_FIELD_KEY]);

        if (!finalVideoUrl) {
          skippedMissingFinalVideoUrlCount += 1;
          continue;
        }

        const durationSeconds = await probeVideoDurationSeconds(finalVideoUrl);
        const roundedDuration = Number(durationSeconds.toFixed(2));

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
      failedCount: failures.length,
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
