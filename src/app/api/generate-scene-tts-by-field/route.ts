import { NextRequest, NextResponse } from 'next/server';
import { Agent } from 'undici';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 900;

const SCENES_TABLE_ID = '714';
const SCENE_VIDEO_LINK_FIELD_KEY = 'field_6889';
const FIELD_KEY_REGEX = /^field_\d+$/;
const TTS_PROVIDER_FETCH_DISPATCHER = new Agent({
  headersTimeout: 0,
  bodyTimeout: 0,
});

type TtsProvider = 'chatterbox' | 'fish-s2-pro' | 'omnivoice';
type BaserowRow = Record<string, unknown>;

type BaserowListResponse = {
  results?: BaserowRow[];
  next?: string | null;
};

type SceneTtsFailure = {
  sceneId: number;
  error: string;
};

class BaserowRequestError extends Error {
  status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = 'BaserowRequestError';
    this.status = status;
  }
}

function isBaserowAuthError(error: unknown): error is BaserowRequestError {
  return (
    error instanceof BaserowRequestError &&
    (error.status === 401 || error.status === 403)
  );
}

function parsePositiveInt(value: unknown): number | null {
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

function parseNumberish(value: unknown): number {
  if (typeof value === 'number') {
    return value;
  }

  if (typeof value === 'string') {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : Number.NaN;
  }

  return Number.NaN;
}

function parseBoolean(value: unknown, fallback: boolean): boolean {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return value !== 0;
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    if (['1', 'true', 'yes', 'on'].includes(normalized)) return true;
    if (['0', 'false', 'no', 'off'].includes(normalized)) return false;
  }

  return fallback;
}

function getSceneOrderValue(scene: BaserowRow): number {
  const fromStart = parseNumberish(scene.field_6896);
  if (Number.isFinite(fromStart)) {
    return fromStart;
  }

  const fromOrder = parseNumberish(scene.order);
  if (Number.isFinite(fromOrder)) {
    return fromOrder;
  }

  const fromId = parseNumberish(scene.id);
  if (Number.isFinite(fromId)) {
    return fromId;
  }

  return 0;
}

function extractUrl(raw: unknown): string {
  if (typeof raw === 'string') {
    return raw.trim();
  }

  if (!raw) {
    return '';
  }

  if (Array.isArray(raw)) {
    for (const item of raw) {
      const next = extractUrl(item);
      if (next) return next;
    }
    return '';
  }

  if (typeof raw === 'object') {
    const obj = raw as Record<string, unknown>;
    const nestedFile =
      obj.file && typeof obj.file === 'object'
        ? (obj.file as Record<string, unknown>)
        : null;

    const candidates = [
      obj.url,
      obj.value,
      obj.name,
      obj.text,
      nestedFile?.url,
    ];

    for (const candidate of candidates) {
      if (typeof candidate === 'string' && candidate.trim()) {
        return candidate.trim();
      }
    }
  }

  return '';
}

function asFieldKey(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!FIELD_KEY_REGEX.test(trimmed)) return null;
  return trimmed;
}

function resolveProvider(value: unknown): TtsProvider {
  if (
    value === 'fish-s2-pro' ||
    value === 'omnivoice' ||
    value === 'chatterbox'
  ) {
    return value;
  }

  return 'omnivoice';
}

function resolveTtsPath(provider: TtsProvider): string {
  if (provider === 'fish-s2-pro') {
    return '/api/generate-tts-fish';
  }

  if (provider === 'omnivoice') {
    return '/api/generate-tts-omnivoice';
  }

  return '/api/generate-tts';
}

let cachedToken: string | null = null;
let cachedTokenExpiry = 0;

async function getJWTToken(forceRefresh = false): Promise<string> {
  const baserowUrl = process.env.BASEROW_API_URL;
  const email = process.env.BASEROW_EMAIL;
  const password = process.env.BASEROW_PASSWORD;

  if (!baserowUrl || !email || !password) {
    throw new Error('Missing Baserow configuration');
  }

  if (
    !forceRefresh &&
    cachedToken &&
    Date.now() < cachedTokenExpiry - 300_000
  ) {
    return cachedToken;
  }

  const response = await fetch(`${baserowUrl}/user/token-auth/`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
    cache: 'no-store',
  });

  if (!response.ok) {
    const errorText = await response.text().catch(() => '');
    throw new Error(`Authentication failed: ${response.status} ${errorText}`);
  }

  const payload = (await response.json().catch(() => null)) as {
    token?: unknown;
  } | null;
  const token = typeof payload?.token === 'string' ? payload.token.trim() : '';

  if (!token) {
    throw new Error('Authentication succeeded but token is missing');
  }

  cachedToken = token;
  cachedTokenExpiry = Date.now() + 50 * 60 * 1000;
  return token;
}

async function baserowGetJson<T>(
  baserowUrl: string,
  token: string,
  pathName: string,
): Promise<T> {
  const response = await fetch(`${baserowUrl}${pathName}`, {
    method: 'GET',
    headers: {
      Authorization: `JWT ${token}`,
    },
    cache: 'no-store',
  });

  if (!response.ok) {
    const errorText = await response.text().catch(() => '');
    throw new BaserowRequestError(
      `Baserow GET failed (${response.status}) ${errorText}`,
      response.status,
    );
  }

  return (await response.json()) as T;
}

async function baserowPatchRow(
  baserowUrl: string,
  token: string,
  tableId: string,
  rowId: number,
  patch: Record<string, unknown>,
): Promise<void> {
  const response = await fetch(
    `${baserowUrl}/database/rows/table/${tableId}/${rowId}/`,
    {
      method: 'PATCH',
      headers: {
        Authorization: `JWT ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(patch),
      cache: 'no-store',
    },
  );

  if (!response.ok) {
    const errorText = await response.text().catch(() => '');
    throw new BaserowRequestError(
      `Baserow PATCH failed for table ${tableId} row ${rowId} (${response.status}) ${errorText}`,
      response.status,
    );
  }
}

async function patchSceneAudioWithAuthRetry(options: {
  baserowUrl: string;
  token: string;
  sceneId: number;
  destinationAudioFieldKey: string;
  audioUrl: string;
}): Promise<string> {
  const { baserowUrl, token, sceneId, destinationAudioFieldKey, audioUrl } =
    options;

  const patchPayload = {
    [destinationAudioFieldKey]: audioUrl,
  };

  try {
    await baserowPatchRow(
      baserowUrl,
      token,
      SCENES_TABLE_ID,
      sceneId,
      patchPayload,
    );

    return token;
  } catch (error) {
    if (!isBaserowAuthError(error)) {
      throw error;
    }

    console.warn(
      `[generate-scene-tts-by-field] Baserow auth expired while saving scene ${sceneId}. Refreshing token and retrying once...`,
    );

    const refreshedToken = await getJWTToken(true);

    await baserowPatchRow(
      baserowUrl,
      refreshedToken,
      SCENES_TABLE_ID,
      sceneId,
      patchPayload,
    );

    return refreshedToken;
  }
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
    const params = new URLSearchParams();
    params.set(`filter__${SCENE_VIDEO_LINK_FIELD_KEY}__equal`, String(videoId));
    params.set('size', String(pageSize));
    params.set('page', String(page));

    const pathName = `/database/rows/table/${SCENES_TABLE_ID}/?${params.toString()}`;

    const json = await baserowGetJson<BaserowListResponse>(
      baserowUrl,
      token,
      pathName,
    );

    const results = Array.isArray(json.results) ? json.results : [];
    all.push(...results);

    if (!json.next || results.length === 0) {
      break;
    }

    page += 1;
  }

  return all;
}

async function generateSceneTts(options: {
  origin: string;
  providerPath: string;
  text: string;
  sceneId: number;
  videoId: number;
  referenceAudioFilename?: string;
  ttsSettings?: Record<string, unknown>;
}): Promise<string> {
  const {
    origin,
    providerPath,
    text,
    sceneId,
    videoId,
    referenceAudioFilename,
    ttsSettings,
  } = options;

  const payload: Record<string, unknown> = {
    text,
    sceneId,
    videoId,
  };

  if (referenceAudioFilename) {
    payload.referenceAudioFilename = referenceAudioFilename;
  }

  if (ttsSettings && typeof ttsSettings === 'object') {
    payload.ttsSettings = ttsSettings;
  }

  const providerRequestInit: RequestInit & { dispatcher: Agent } = {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
    cache: 'no-store',
    dispatcher: TTS_PROVIDER_FETCH_DISPATCHER,
  };

  const response = await fetch(`${origin}${providerPath}`, providerRequestInit);

  const json = (await response.json().catch(() => null)) as {
    error?: unknown;
    audioUrl?: unknown;
  } | null;

  if (!response.ok) {
    const message =
      typeof json?.error === 'string' && json.error.trim()
        ? json.error.trim()
        : `TTS provider failed (${response.status})`;
    throw new Error(message);
  }

  const audioUrl =
    typeof json?.audioUrl === 'string' ? json.audioUrl.trim() : '';
  if (!audioUrl) {
    throw new Error('TTS provider returned empty audioUrl');
  }

  return audioUrl;
}

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json().catch(() => null)) as {
      videoId?: unknown;
      sourceTextFieldKey?: unknown;
      destinationAudioFieldKey?: unknown;
      provider?: unknown;
      referenceAudioFilename?: unknown;
      ttsSettings?: unknown;
      skipIfDestinationExists?: unknown;
      failFastOnSaveError?: unknown;
      onlySceneIds?: unknown;
    } | null;

    const videoId = parsePositiveInt(body?.videoId);
    if (!videoId) {
      return NextResponse.json(
        { error: 'videoId must be a positive integer' },
        { status: 400 },
      );
    }

    const sourceTextFieldKey = asFieldKey(body?.sourceTextFieldKey);
    if (!sourceTextFieldKey) {
      return NextResponse.json(
        {
          error:
            'sourceTextFieldKey is required and must be a Baserow field key (e.g., field_7110)',
        },
        { status: 400 },
      );
    }

    const destinationAudioFieldKey = asFieldKey(body?.destinationAudioFieldKey);
    if (!destinationAudioFieldKey) {
      return NextResponse.json(
        {
          error:
            'destinationAudioFieldKey is required and must be a Baserow field key (e.g., field_7111)',
        },
        { status: 400 },
      );
    }

    if (sourceTextFieldKey === destinationAudioFieldKey) {
      return NextResponse.json(
        {
          error:
            'sourceTextFieldKey and destinationAudioFieldKey must be different fields',
        },
        { status: 400 },
      );
    }

    const provider = resolveProvider(body?.provider);
    const providerPath = resolveTtsPath(provider);

    const referenceAudioFilename =
      typeof body?.referenceAudioFilename === 'string'
        ? body.referenceAudioFilename.trim()
        : '';

    const ttsSettings =
      body?.ttsSettings && typeof body.ttsSettings === 'object'
        ? (body.ttsSettings as Record<string, unknown>)
        : undefined;

    const skipIfDestinationExists = parseBoolean(
      body?.skipIfDestinationExists,
      true,
    );
    const failFastOnSaveError = parseBoolean(body?.failFastOnSaveError, true);

    const onlySceneIdSet = Array.isArray(body?.onlySceneIds)
      ? new Set(
          body.onlySceneIds
            .map((id) => parsePositiveInt(id))
            .filter((id): id is number => typeof id === 'number'),
        )
      : null;

    const baserowUrl = process.env.BASEROW_API_URL;
    if (!baserowUrl) {
      return NextResponse.json(
        { error: 'Missing BASEROW_API_URL' },
        { status: 500 },
      );
    }

    let token = await getJWTToken();

    let scenes: BaserowRow[];
    try {
      scenes = await fetchAllScenesForVideo(baserowUrl, token, videoId);
    } catch (error) {
      if (!isBaserowAuthError(error)) {
        throw error;
      }

      console.warn(
        '[generate-scene-tts-by-field] Baserow auth expired while loading scenes. Refreshing token and retrying once...',
      );

      token = await getJWTToken(true);
      scenes = await fetchAllScenesForVideo(baserowUrl, token, videoId);
    }

    if (scenes.length === 0) {
      return NextResponse.json(
        { error: `No scenes found for video ${videoId}` },
        { status: 404 },
      );
    }

    const orderedScenes = [...scenes].sort(
      (a, b) => getSceneOrderValue(a) - getSceneOrderValue(b),
    );

    const failures: SceneTtsFailure[] = [];
    let generatedCount = 0;
    let skippedNoTextCount = 0;
    let skippedExistingCount = 0;
    let skippedSceneFilterCount = 0;
    let skippedInvalidSceneIdCount = 0;
    let abortedOnSaveFailure = false;
    let abortedSceneId: number | null = null;

    for (const scene of orderedScenes) {
      const sceneId = parsePositiveInt(scene.id);
      if (!sceneId) {
        skippedInvalidSceneIdCount += 1;
        continue;
      }

      if (
        onlySceneIdSet &&
        onlySceneIdSet.size > 0 &&
        !onlySceneIdSet.has(sceneId)
      ) {
        skippedSceneFilterCount += 1;
        continue;
      }

      const text = String(scene[sourceTextFieldKey] ?? '').trim();
      if (!text) {
        skippedNoTextCount += 1;
        continue;
      }

      const existingAudioUrl = extractUrl(scene[destinationAudioFieldKey]);
      if (skipIfDestinationExists && existingAudioUrl) {
        skippedExistingCount += 1;
        continue;
      }

      try {
        const audioUrl = await generateSceneTts({
          origin: request.nextUrl.origin,
          providerPath,
          text,
          sceneId,
          videoId,
          referenceAudioFilename: referenceAudioFilename || undefined,
          ttsSettings,
        });

        try {
          token = await patchSceneAudioWithAuthRetry({
            baserowUrl,
            token,
            sceneId,
            destinationAudioFieldKey,
            audioUrl,
          });

          generatedCount += 1;
        } catch (saveError) {
          const saveMessage =
            saveError instanceof Error ? saveError.message : 'Unknown error';

          failures.push({
            sceneId,
            error: saveMessage,
          });

          if (failFastOnSaveError) {
            abortedOnSaveFailure = true;
            abortedSceneId = sceneId;
            console.error(
              `[generate-scene-tts-by-field] Fail-fast: stopping batch after save failure on scene ${sceneId}: ${saveMessage}`,
            );
            break;
          }
        }
      } catch (error) {
        failures.push({
          sceneId,
          error: error instanceof Error ? error.message : 'Unknown error',
        });
      }
    }

    return NextResponse.json({
      ok: failures.length === 0 && !abortedOnSaveFailure,
      videoId,
      provider,
      providerPath,
      sourceTextFieldKey,
      destinationAudioFieldKey,
      referenceAudioFilename: referenceAudioFilename || null,
      skipIfDestinationExists,
      failFastOnSaveError,
      abortedOnSaveFailure,
      abortedSceneId,
      requestedSceneCount: orderedScenes.length,
      generatedCount,
      skippedNoTextCount,
      skippedExistingCount,
      skippedSceneFilterCount,
      skippedInvalidSceneIdCount,
      failureCount: failures.length,
      failures: failures.slice(0, 30),
    });
  } catch (error) {
    console.error('[generate-scene-tts-by-field] error:', error);
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 },
    );
  }
}
