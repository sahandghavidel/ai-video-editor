import { NextRequest, NextResponse } from 'next/server';
import { parseSrtSegments } from '@/utils/captions-parser';
import { loadTtsAudioReferencesStore } from '@/lib/ttsAudioReferencesStore';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const VIDEOS_TABLE_ID = '713';
const SCENES_TABLE_ID = '714';

const SCENE_VIDEO_LINK_FIELD_KEY = 'field_6889';
const SCENE_DURATION_FIELD_KEY = 'field_7107';
const SCENE_SENTENCE_EN_FIELD_KEY = 'field_6890';
const SCENE_SENTENCE_FA_FIELD_KEY = 'field_7110';
const SCENE_DUBBED_FA_FIELD_KEY = 'field_7111';

const VIDEO_SRT_EN_FIELD_KEY = 'field_6872';
const VIDEO_SRT_FA_FIELD_KEY = 'field_7112';

const GENERATE_SCENE_TTS_BY_FIELD_ROUTE = '/api/generate-scene-tts-by-field';
const DEFAULT_FA_REFERENCE_AUDIO_FILENAME = 'fa.wav';
const DEFAULT_FA_REFERENCE_TEXT = '';

const MAX_TIMESTAMP_DELTA_SEC = 0.05;

type BaserowRow = Record<string, unknown>;

type BaserowListResponse = {
  results?: BaserowRow[];
  next?: string | null;
};

type TimestampMismatch = {
  cueIndex: number;
  enStart: number;
  enEnd: number;
  faStart: number;
  faEnd: number;
};

type ResolvedAudioReference = {
  id: string | null;
  filename: string;
  referenceText: string;
  source: 'store-default-fa' | 'store-first-fa' | 'fallback';
};

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

function parsePositiveNumber(value: unknown): number | null {
  const parsed =
    typeof value === 'number'
      ? value
      : typeof value === 'string'
        ? Number(value)
        : Number.NaN;

  if (!Number.isFinite(parsed) || parsed <= 0) {
    return null;
  }

  return parsed;
}

function parseNumberish(value: unknown): number {
  if (typeof value === 'number') return value;

  if (typeof value === 'string') {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : Number.NaN;
  }

  return Number.NaN;
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

function normalizeForLooseCompare(value: string): string {
  return String(value)
    .toLowerCase()
    .replace(/[\u200c\u200f\u202a-\u202e]/g, ' ')
    .replace(/[\p{P}\p{S}]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function collectTimestampMismatches(
  en: Array<{ start: number; end: number }>,
  fa: Array<{ start: number; end: number }>,
): TimestampMismatch[] {
  const mismatches: TimestampMismatch[] = [];

  for (let i = 0; i < en.length; i += 1) {
    const enCue = en[i];
    const faCue = fa[i];

    const startDelta = Math.abs(enCue.start - faCue.start);
    const endDelta = Math.abs(enCue.end - faCue.end);

    if (
      startDelta > MAX_TIMESTAMP_DELTA_SEC ||
      endDelta > MAX_TIMESTAMP_DELTA_SEC
    ) {
      mismatches.push({
        cueIndex: i + 1,
        enStart: enCue.start,
        enEnd: enCue.end,
        faStart: faCue.start,
        faEnd: faCue.end,
      });
    }
  }

  return mismatches;
}

function shouldIncludeSceneForDurationSrt(scene: BaserowRow): boolean {
  const duration = parsePositiveNumber(scene[SCENE_DURATION_FIELD_KEY]);
  const sentence = String(scene[SCENE_SENTENCE_EN_FIELD_KEY] ?? '').trim();
  return Boolean(duration) && sentence.length > 0;
}

async function resolveFaAudioReference(): Promise<ResolvedAudioReference> {
  try {
    const { entries } = await loadTtsAudioReferencesStore();

    const faEntries = entries.filter(
      (entry) =>
        entry.enabled &&
        entry.language.toLowerCase() === 'fa' &&
        entry.filename.trim().length > 0,
    );

    if (faEntries.length > 0) {
      const defaultEntry = faEntries.find((entry) => entry.isDefault);
      if (defaultEntry) {
        return {
          id: defaultEntry.id,
          filename: defaultEntry.filename,
          referenceText: defaultEntry.referenceText,
          source: 'store-default-fa',
        };
      }

      const firstEntry = faEntries[0];
      return {
        id: firstEntry.id,
        filename: firstEntry.filename,
        referenceText: firstEntry.referenceText,
        source: 'store-first-fa',
      };
    }
  } catch (error) {
    console.warn(
      '[create-dubbed-fa] Failed to load audio references store. Falling back to static FA reference.',
      error,
    );
  }

  return {
    id: null,
    filename: DEFAULT_FA_REFERENCE_AUDIO_FILENAME,
    referenceText: DEFAULT_FA_REFERENCE_TEXT,
    source: 'fallback',
  };
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
    throw new Error(`Baserow GET failed (${response.status}) ${errorText}`);
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
    throw new Error(
      `Baserow PATCH failed for table ${tableId} row ${rowId} (${response.status}) ${errorText}`,
    );
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

async function fetchTextFromUrl(url: string): Promise<string> {
  const response = await fetch(url, {
    method: 'GET',
    cache: 'no-store',
  });

  if (!response.ok) {
    const errorText = await response.text().catch(() => '');
    throw new Error(
      `Failed to fetch SRT URL (${response.status}) ${errorText}`,
    );
  }

  return await response.text();
}

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json().catch(() => null)) as {
      videoId?: unknown;
    } | null;

    const videoId = parsePositiveInt(body?.videoId);
    if (!videoId) {
      return NextResponse.json(
        { error: 'videoId must be a positive integer' },
        { status: 400 },
      );
    }

    const baserowUrl = process.env.BASEROW_API_URL;
    if (!baserowUrl) {
      return NextResponse.json(
        { error: 'Missing BASEROW_API_URL' },
        { status: 500 },
      );
    }

    const token = await getJWTToken();

    const videoRow = await baserowGetJson<BaserowRow>(
      baserowUrl,
      token,
      `/database/rows/table/${VIDEOS_TABLE_ID}/${videoId}/`,
    );

    const srtEnUrl = extractUrl(videoRow[VIDEO_SRT_EN_FIELD_KEY]);
    const srtFaUrl = extractUrl(videoRow[VIDEO_SRT_FA_FIELD_KEY]);

    if (!srtEnUrl) {
      return NextResponse.json(
        {
          error: `Selected video is missing srt_en URL (${VIDEO_SRT_EN_FIELD_KEY})`,
        },
        { status: 400 },
      );
    }

    if (!srtFaUrl) {
      return NextResponse.json(
        {
          error: `Selected video is missing srt_fa URL (${VIDEO_SRT_FA_FIELD_KEY})`,
        },
        { status: 400 },
      );
    }

    const [srtEnContent, srtFaContent] = await Promise.all([
      fetchTextFromUrl(srtEnUrl),
      fetchTextFromUrl(srtFaUrl),
    ]);

    const enCues = parseSrtSegments(srtEnContent);
    const faCues = parseSrtSegments(srtFaContent);

    if (enCues.length === 0) {
      return NextResponse.json(
        {
          error: `srt_en (${VIDEO_SRT_EN_FIELD_KEY}) could not be parsed into cues`,
        },
        { status: 400 },
      );
    }

    if (faCues.length === 0) {
      return NextResponse.json(
        {
          error: `srt_fa (${VIDEO_SRT_FA_FIELD_KEY}) could not be parsed into cues`,
        },
        { status: 400 },
      );
    }

    if (enCues.length !== faCues.length) {
      return NextResponse.json(
        {
          error:
            'srt_en and srt_fa cue counts do not match. Please ensure both SRT files have the same cues.',
          enCueCount: enCues.length,
          faCueCount: faCues.length,
        },
        { status: 400 },
      );
    }

    const timestampMismatches = collectTimestampMismatches(enCues, faCues);
    if (timestampMismatches.length > 0) {
      return NextResponse.json(
        {
          error:
            'srt_en and srt_fa timestamps are not aligned cue-by-cue. Please align FA SRT timestamps with EN SRT first.',
          mismatchCount: timestampMismatches.length,
          sampleMismatches: timestampMismatches.slice(0, 10),
          maxAllowedDeltaSec: MAX_TIMESTAMP_DELTA_SEC,
        },
        { status: 400 },
      );
    }

    const scenes = await fetchAllScenesForVideo(baserowUrl, token, videoId);
    if (scenes.length === 0) {
      return NextResponse.json(
        { error: `No scenes found for video ${videoId}` },
        { status: 404 },
      );
    }

    const eligibleScenes = [...scenes]
      .sort((a, b) => getSceneOrderValue(a) - getSceneOrderValue(b))
      .filter((scene) => shouldIncludeSceneForDurationSrt(scene));

    if (eligibleScenes.length !== enCues.length) {
      return NextResponse.json(
        {
          error:
            'Scene count eligible for En SRT mapping does not match SRT cue count. Regenerate En SRT and retry.',
          eligibleSceneCount: eligibleScenes.length,
          enCueCount: enCues.length,
          faCueCount: faCues.length,
        },
        { status: 400 },
      );
    }

    const enSceneTextMismatchSceneIds: number[] = [];
    let updatedCount = 0;
    let unchangedCount = 0;

    for (let i = 0; i < eligibleScenes.length; i += 1) {
      const scene = eligibleScenes[i];
      const sceneId = parsePositiveInt(scene.id);
      if (!sceneId) continue;

      const enCue = enCues[i];
      const faCue = faCues[i];
      const currentSceneEn = String(
        scene[SCENE_SENTENCE_EN_FIELD_KEY] ?? '',
      ).trim();
      const nextSceneFa = String(faCue.text ?? '').trim();
      const currentSceneFa = String(
        scene[SCENE_SENTENCE_FA_FIELD_KEY] ?? '',
      ).trim();

      if (
        normalizeForLooseCompare(currentSceneEn) !==
        normalizeForLooseCompare(enCue.text)
      ) {
        enSceneTextMismatchSceneIds.push(sceneId);
      }

      if (!nextSceneFa || nextSceneFa === currentSceneFa) {
        unchangedCount += 1;
        continue;
      }

      await baserowPatchRow(baserowUrl, token, SCENES_TABLE_ID, sceneId, {
        [SCENE_SENTENCE_FA_FIELD_KEY]: nextSceneFa,
      });

      updatedCount += 1;
    }

    const selectedFaReference = await resolveFaAudioReference();

    const step2Response = await fetch(
      `${request.nextUrl.origin}${GENERATE_SCENE_TTS_BY_FIELD_ROUTE}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          videoId,
          sourceTextFieldKey: SCENE_SENTENCE_FA_FIELD_KEY,
          destinationAudioFieldKey: SCENE_DUBBED_FA_FIELD_KEY,
          provider: 'omnivoice',
          referenceAudioFilename: selectedFaReference.filename,
          skipIfDestinationExists: false,
          ttsSettings: {
            provider: 'omnivoice',
            reference_audio_filename: selectedFaReference.filename,
            omniVoice: {
              referenceText: selectedFaReference.referenceText,
              language: 'fa',
              deviceMap: 'mps',
              dtype: 'float32',
              numStep: 64,
              speed: 1,
            },
          },
        }),
      },
    );

    const step2Payload = (await step2Response.json().catch(() => null)) as {
      ok?: unknown;
      error?: unknown;
      failureCount?: unknown;
      failures?: unknown;
      generatedCount?: unknown;
      skippedNoTextCount?: unknown;
      skippedExistingCount?: unknown;
      skippedSceneFilterCount?: unknown;
      skippedInvalidSceneIdCount?: unknown;
      provider?: unknown;
      providerPath?: unknown;
    } | null;

    if (!step2Response.ok || step2Payload?.ok !== true) {
      const failurePreview = Array.isArray(step2Payload?.failures)
        ? step2Payload.failures
            .slice(0, 5)
            .map((item) => {
              if (!item || typeof item !== 'object') return '';
              const row = item as { sceneId?: unknown; error?: unknown };
              return `scene ${String(row.sceneId ?? 'n/a')}: ${String(
                row.error ?? 'unknown error',
              )}`;
            })
            .filter(Boolean)
            .join(' | ')
        : '';

      const message =
        typeof step2Payload?.error === 'string' && step2Payload.error.trim()
          ? step2Payload.error.trim()
          : `Step 2 FA TTS generation failed (${step2Response.status})`;

      throw new Error(
        failurePreview ? `${message} — ${failurePreview}` : message,
      );
    }

    return NextResponse.json({
      ok: true,
      step: 'step-1-map-srt-fa-and-step-2-generate-dubbed-fa',
      videoId,
      step1: {
        srtEnField: VIDEO_SRT_EN_FIELD_KEY,
        srtFaField: VIDEO_SRT_FA_FIELD_KEY,
        sentenceFaField: SCENE_SENTENCE_FA_FIELD_KEY,
        enCueCount: enCues.length,
        faCueCount: faCues.length,
        eligibleSceneCount: eligibleScenes.length,
        updatedCount,
        unchangedCount,
        enSceneTextMismatchCount: enSceneTextMismatchSceneIds.length,
        enSceneTextMismatchSceneIds: enSceneTextMismatchSceneIds.slice(0, 20),
      },
      step2: {
        sourceTextField: SCENE_SENTENCE_FA_FIELD_KEY,
        dubbedFaField: SCENE_DUBBED_FA_FIELD_KEY,
        referenceAudioFilename: selectedFaReference.filename,
        referenceAudioReferenceId: selectedFaReference.id,
        referenceAudioSource: selectedFaReference.source,
        referenceTextLength: selectedFaReference.referenceText.length,
        provider:
          typeof step2Payload?.provider === 'string'
            ? step2Payload.provider
            : 'omnivoice',
        providerPath:
          typeof step2Payload?.providerPath === 'string'
            ? step2Payload.providerPath
            : '/api/generate-tts-omnivoice',
        generatedCount: Number(step2Payload?.generatedCount ?? 0),
        skippedNoTextCount: Number(step2Payload?.skippedNoTextCount ?? 0),
        skippedExistingCount: Number(step2Payload?.skippedExistingCount ?? 0),
        skippedSceneFilterCount: Number(
          step2Payload?.skippedSceneFilterCount ?? 0,
        ),
        skippedInvalidSceneIdCount: Number(
          step2Payload?.skippedInvalidSceneIdCount ?? 0,
        ),
        failureCount: Number(step2Payload?.failureCount ?? 0),
      },
    });
  } catch (error) {
    console.error('[create-dubbed-fa] error:', error);
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 },
    );
  }
}
