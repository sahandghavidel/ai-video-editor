import { NextRequest, NextResponse } from 'next/server';
import { parseFixTtsStatus } from '@/utils/fixTtsBatch';

export const runtime = 'nodejs';

const SCENES_TABLE_ID = '714';
const PAGE_SIZE = 200;

type BaserowSceneRow = Record<string, unknown> & {
  id?: unknown;
  order?: unknown;
  field_6886?: unknown;
  field_6890?: unknown;
  field_7096?: unknown;
};

function parsePositiveInt(value: unknown): number | null {
  const parsed =
    typeof value === 'number'
      ? value
      : typeof value === 'string'
        ? parseInt(value, 10)
        : Number.NaN;

  if (!Number.isFinite(parsed) || parsed <= 0) return null;
  return Math.floor(parsed);
}

const hasNonEmptyTextLikeValue = (value: unknown): boolean => {
  if (typeof value === 'string') {
    return value.trim().length > 0;
  }

  if (Array.isArray(value)) {
    return value.some((item) => hasNonEmptyTextLikeValue(item));
  }

  if (value && typeof value === 'object') {
    const rec = value as Record<string, unknown>;
    return hasNonEmptyTextLikeValue(
      rec.url ?? rec.value ?? rec.name ?? rec.text ?? rec.title,
    );
  }

  return false;
};

function isFixTtsEligibleScene(scene: BaserowSceneRow): boolean {
  const hasFinalVideo = hasNonEmptyTextLikeValue(scene.field_6886);
  const hasText = String(scene.field_6890 ?? '').trim().length > 0;
  return hasFinalVideo && hasText;
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

  if (!data || typeof data.token !== 'string' || !data.token.trim()) {
    throw new Error('Authentication response does not contain a valid token');
  }

  return data.token;
}

async function fetchScenesForVideo(
  baserowUrl: string,
  token: string,
  videoId: number,
): Promise<BaserowSceneRow[]> {
  const allScenes: BaserowSceneRow[] = [];
  let page = 1;

  while (true) {
    const response = await fetch(
      `${baserowUrl}/database/rows/table/${SCENES_TABLE_ID}/?filter__field_6889__equal=${videoId}&size=${PAGE_SIZE}&page=${page}`,
      {
        method: 'GET',
        headers: {
          Authorization: `JWT ${token}`,
        },
        cache: 'no-store',
      },
    );

    if (!response.ok) {
      const errorText = await response.text().catch(() => '');
      throw new Error(
        `Failed to fetch scenes page ${page}: ${response.status} ${errorText}`,
      );
    }

    const payload = (await response.json().catch(() => null)) as {
      results?: unknown;
      next?: unknown;
    } | null;

    const pageRows = Array.isArray(payload?.results)
      ? (payload.results as BaserowSceneRow[])
      : [];

    allScenes.push(...pageRows);

    if (!payload || payload.next === null || payload.next === undefined) {
      break;
    }

    page += 1;
  }

  return allScenes;
}

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json().catch(() => null)) as {
      videoId?: unknown;
    } | null;
    const videoId = parsePositiveInt(body?.videoId);

    if (videoId === null) {
      return NextResponse.json(
        { error: 'Invalid videoId. Expected a positive integer.' },
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
    const scenes = await fetchScenesForVideo(baserowUrl, token, videoId);

    const flaggedScenes = scenes
      .filter((scene) => parseFixTtsStatus(scene.field_7096) === 'true')
      .filter((scene) => isFixTtsEligibleScene(scene))
      .sort((a, b) => {
        const orderA = Number(a.order);
        const orderB = Number(b.order);
        if (Number.isFinite(orderA) && Number.isFinite(orderB)) {
          return orderA - orderB;
        }

        const idA = parsePositiveInt(a.id) ?? Number.MAX_SAFE_INTEGER;
        const idB = parsePositiveInt(b.id) ?? Number.MAX_SAFE_INTEGER;
        return idA - idB;
      });

    const flaggedSceneIds = flaggedScenes
      .map((scene) => parsePositiveInt(scene.id))
      .filter((id): id is number => id !== null);

    return NextResponse.json({
      videoId,
      scannedScenes: scenes.length,
      flaggedScenes,
      flaggedSceneIds,
      flaggedCount: flaggedScenes.length,
    });
  } catch (error) {
    console.error('Failed to fetch flagged scenes for Fix TTS:', error);
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : 'Failed to fetch flagged scenes',
      },
      { status: 500 },
    );
  }
}
