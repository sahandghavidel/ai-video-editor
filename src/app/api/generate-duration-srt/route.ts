import { NextRequest, NextResponse } from 'next/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const VIDEOS_TABLE_ID = '713';
const SCENES_TABLE_ID = '714';
const VIDEO_CAPTIONS_URL_FIELD_KEY = 'field_6872';
const SCENE_VIDEO_LINK_FIELD_KEY = 'field_6889';
const SCENE_SENTENCE_FIELD_KEY = 'field_6890';
const SCENE_DURATION_FIELD_KEY = 'field_7107';

type BaserowRow = Record<string, unknown>;

type BaserowListResponse = {
  results?: BaserowRow[];
  next?: string | null;
};

function parseNumberish(value: unknown): number {
  if (typeof value === 'number') return value;
  if (typeof value === 'string') {
    const n = Number(value);
    return Number.isFinite(n) ? n : Number.NaN;
  }
  return Number.NaN;
}

function formatSrtTime(totalSeconds: number): string {
  const safe = Math.max(0, Number.isFinite(totalSeconds) ? totalSeconds : 0);
  const hours = Math.floor(safe / 3600);
  const minutes = Math.floor((safe % 3600) / 60);
  const seconds = Math.floor(safe % 60);
  const ms = Math.floor((safe - Math.floor(safe)) * 1000);

  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(
    2,
    '0',
  )}:${String(seconds).padStart(2, '0')},${String(ms).padStart(3, '0')}`;
}

function getSceneOrderValue(scene: BaserowRow): number {
  const start = parseNumberish(scene.field_6896);
  if (Number.isFinite(start)) return start;

  const order = parseNumberish(scene.order);
  if (Number.isFinite(order)) return order;

  const id = parseNumberish(scene.id);
  return Number.isFinite(id) ? id : 0;
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
    token?: unknown;
  } | null;
  if (typeof data?.token !== 'string' || !data.token.trim()) {
    throw new Error('Authentication failed: missing token');
  }

  return data.token;
}

async function fetchAllScenesForVideo(
  baserowUrl: string,
  token: string,
  videoId: number,
): Promise<BaserowRow[]> {
  const all: BaserowRow[] = [];
  const pageSize = 200;
  let page = 1;

  while (true) {
    const url = new URL(
      `${baserowUrl}/database/rows/table/${SCENES_TABLE_ID}/`,
    );
    url.searchParams.set(
      `filter__${SCENE_VIDEO_LINK_FIELD_KEY}__equal`,
      String(videoId),
    );
    url.searchParams.set('size', String(pageSize));
    url.searchParams.set('page', String(page));

    const res = await fetch(url.toString(), {
      method: 'GET',
      headers: { Authorization: `JWT ${token}` },
      cache: 'no-store',
    });

    if (!res.ok) {
      const t = await res.text().catch(() => '');
      throw new Error(`Failed to fetch scenes (${res.status}) ${t}`);
    }

    const json = (await res
      .json()
      .catch(() => null)) as BaserowListResponse | null;
    const results = Array.isArray(json?.results) ? json.results : [];
    all.push(...results);

    if (!json?.next || results.length === 0) {
      break;
    }

    page += 1;
  }

  return all;
}

async function patchVideoCaptionsUrl(
  baserowUrl: string,
  token: string,
  videoId: number,
  captionsUrl: string,
): Promise<void> {
  const res = await fetch(
    `${baserowUrl}/database/rows/table/${VIDEOS_TABLE_ID}/${videoId}/`,
    {
      method: 'PATCH',
      headers: {
        Authorization: `JWT ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        [VIDEO_CAPTIONS_URL_FIELD_KEY]: captionsUrl,
      }),
    },
  );

  if (!res.ok) {
    const t = await res.text().catch(() => '');
    throw new Error(`Failed to save captions URL (${res.status}) ${t}`);
  }
}

async function uploadSrtToMinio(filename: string, srtContent: string) {
  const bucket = 'nca-toolkit';
  const uploadUrl = `http://host.docker.internal:9000/${bucket}/${filename}`;

  const uploadResponse = await fetch(uploadUrl, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/x-subrip',
    },
    body: srtContent,
  });

  if (!uploadResponse.ok) {
    const errorText = await uploadResponse.text().catch(() => '');
    throw new Error(
      `MinIO upload error: ${uploadResponse.status} ${errorText}`,
    );
  }

  return uploadUrl;
}

function buildSrtFromScenes(scenes: BaserowRow[]): {
  srt: string;
  totalScenes: number;
  includedScenes: number;
  skippedNoDuration: number;
  skippedNoSentence: number;
} {
  const sortedScenes = [...scenes].sort(
    (a, b) => getSceneOrderValue(a) - getSceneOrderValue(b),
  );

  let cursor = 0;
  let cueIndex = 1;
  let skippedNoDuration = 0;
  let skippedNoSentence = 0;
  const lines: string[] = [];

  for (const scene of sortedScenes) {
    const duration = parseNumberish(scene[SCENE_DURATION_FIELD_KEY]);
    const sentence = String(scene[SCENE_SENTENCE_FIELD_KEY] ?? '').trim();

    if (!Number.isFinite(duration) || duration <= 0) {
      skippedNoDuration += 1;
      continue;
    }

    const start = cursor;
    const end = cursor + duration;
    cursor = end;

    if (!sentence) {
      skippedNoSentence += 1;
      continue;
    }

    lines.push(String(cueIndex));
    lines.push(`${formatSrtTime(start)} --> ${formatSrtTime(end)}`);
    lines.push(sentence);
    lines.push('');
    cueIndex += 1;
  }

  return {
    srt: lines.join('\n').trim() + '\n',
    totalScenes: sortedScenes.length,
    includedScenes: cueIndex - 1,
    skippedNoDuration,
    skippedNoSentence,
  };
}

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json().catch(() => null)) as {
      videoId?: unknown;
    } | null;

    const videoId = Number(body?.videoId);
    if (!Number.isFinite(videoId) || videoId <= 0) {
      return NextResponse.json(
        { error: 'videoId is required and must be a positive number' },
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
    const scenes = await fetchAllScenesForVideo(baserowUrl, token, videoId);

    if (scenes.length === 0) {
      return NextResponse.json(
        { error: `No scenes found for video ${videoId}` },
        { status: 404 },
      );
    }

    const srtResult = buildSrtFromScenes(scenes);
    if (!srtResult.srt.trim()) {
      return NextResponse.json(
        {
          error:
            'SRT content is empty. Ensure scene durations (7107) and sentences (6890) exist.',
        },
        { status: 400 },
      );
    }

    const filename = `video_${videoId}_final_captions_${Date.now()}.srt`;
    const srtUrl = await uploadSrtToMinio(filename, srtResult.srt);

    await patchVideoCaptionsUrl(baserowUrl, token, videoId, srtUrl);

    return NextResponse.json({
      ok: true,
      videoId,
      srtUrl,
      filename,
      ...srtResult,
      savedField: VIDEO_CAPTIONS_URL_FIELD_KEY,
    });
  } catch (error) {
    console.error('[generate-duration-srt] error:', error);
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 },
    );
  }
}
