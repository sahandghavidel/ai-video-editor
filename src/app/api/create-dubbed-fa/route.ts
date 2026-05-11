import { NextRequest, NextResponse } from 'next/server';
import { Agent } from 'undici';
import { parseSrtSegments } from '@/utils/captions-parser';
import {
  loadTtsAudioReferencesStore,
  type LanguageBaserowFields,
} from '@/lib/ttsAudioReferencesStore';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 900;

const VIDEOS_TABLE_ID = '713';
const SCENES_TABLE_ID = '714';

const SCENE_VIDEO_LINK_FIELD_KEY = 'field_6889';
const SCENE_DURATION_FIELD_KEY_FOR_AUDIO_FIT = 'field_6884';

const DEFAULT_DUBBED_LANGUAGE = 'fa';
const FALLBACK_LANGUAGE_BASEROW_FIELDS: LanguageBaserowFields = {
  videoSrtFieldKey: 'field_7112',
  videoReferenceSrtFieldKey: 'field_6872',
  sceneDurationFieldKey: 'field_7107',
  sceneReferenceSentenceFieldKey: 'field_6890',
  sceneTargetSentenceFieldKey: 'field_7110',
  sceneDubbedAudioFieldKey: 'field_7111',
};

const GENERATE_SCENE_TTS_BY_FIELD_ROUTE = '/api/generate-scene-tts-by-field';
const DEFAULT_REFERENCE_AUDIO_FILENAME = 'fa.wav';
const DEFAULT_REFERENCE_TEXT = '';
const DEFAULT_DEVICE_MAP: 'mps' | 'cpu' | 'auto' = 'mps';
const DEFAULT_DTYPE: 'float16' | 'float32' | 'bfloat16' = 'float32';
const DEFAULT_NUM_STEP = 64;
const DEFAULT_SPEED = 1;
const STEP2_FETCH_DISPATCHER = new Agent({
  headersTimeout: 0,
  bodyTimeout: 0,
});

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
  language: string;
  referenceText: string;
  baserowFields: LanguageBaserowFields;
  deviceMap: 'mps' | 'cpu' | 'auto';
  dtype: 'float16' | 'float32' | 'bfloat16';
  numStep: number;
  speed: number;
  source: 'store-default-language' | 'store-first-language' | 'fallback';
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

function shouldIncludeSceneForDurationSrt(
  scene: BaserowRow,
  baserowFields: LanguageBaserowFields,
): boolean {
  const duration = parsePositiveNumber(
    scene[baserowFields.sceneDurationFieldKey],
  );
  const sentence = String(
    scene[baserowFields.sceneReferenceSentenceFieldKey] ?? '',
  ).trim();
  return Boolean(duration) && sentence.length > 0;
}

function normalizeLanguageCode(value: unknown): string {
  if (typeof value !== 'string') return DEFAULT_DUBBED_LANGUAGE;
  const normalized = value.trim().toLowerCase();
  return normalized || DEFAULT_DUBBED_LANGUAGE;
}

async function resolveLanguageAudioReference(
  requestedLanguage: string,
): Promise<ResolvedAudioReference> {
  const normalizedLanguage = normalizeLanguageCode(requestedLanguage);

  try {
    const { entries } = await loadTtsAudioReferencesStore();

    const languageEntries = entries.filter(
      (entry) =>
        entry.enabled &&
        entry.language.toLowerCase() === normalizedLanguage &&
        entry.filename.trim().length > 0,
    );

    if (languageEntries.length > 0) {
      const defaultEntry = languageEntries.find((entry) => entry.isDefault);
      if (defaultEntry) {
        return {
          id: defaultEntry.id,
          filename: defaultEntry.filename,
          language: defaultEntry.language,
          referenceText: defaultEntry.referenceText,
          baserowFields: defaultEntry.baserowFields,
          deviceMap: defaultEntry.deviceMap,
          dtype: defaultEntry.dtype,
          numStep: defaultEntry.numStep,
          speed: defaultEntry.speed,
          source: 'store-default-language',
        };
      }

      const firstEntry = languageEntries[0];
      return {
        id: firstEntry.id,
        filename: firstEntry.filename,
        language: firstEntry.language,
        referenceText: firstEntry.referenceText,
        baserowFields: firstEntry.baserowFields,
        deviceMap: firstEntry.deviceMap,
        dtype: firstEntry.dtype,
        numStep: firstEntry.numStep,
        speed: firstEntry.speed,
        source: 'store-first-language',
      };
    }
  } catch (error) {
    console.warn(
      '[create-dubbed-fa] Failed to load audio references store. Falling back to static language reference.',
      error,
    );
  }

  return {
    id: null,
    filename: DEFAULT_REFERENCE_AUDIO_FILENAME,
    language: normalizedLanguage,
    referenceText: DEFAULT_REFERENCE_TEXT,
    baserowFields: FALLBACK_LANGUAGE_BASEROW_FIELDS,
    deviceMap: DEFAULT_DEVICE_MAP,
    dtype: DEFAULT_DTYPE,
    numStep: DEFAULT_NUM_STEP,
    speed: DEFAULT_SPEED,
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
      language?: unknown;
    } | null;

    const videoId = parsePositiveInt(body?.videoId);
    if (!videoId) {
      return NextResponse.json(
        { error: 'videoId must be a positive integer' },
        { status: 400 },
      );
    }

    const requestedLanguage = normalizeLanguageCode(body?.language);
    const selectedLanguageReference =
      await resolveLanguageAudioReference(requestedLanguage);

    if (
      requestedLanguage !== DEFAULT_DUBBED_LANGUAGE &&
      selectedLanguageReference.source === 'fallback'
    ) {
      return NextResponse.json(
        {
          error: `No language preset found for '${requestedLanguage}'. Add one in Global TTS Settings → Manage Language Presets (including Baserow fields).`,
        },
        { status: 400 },
      );
    }

    const baserowFields = selectedLanguageReference.baserowFields;

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

    const srtReferenceUrl = extractUrl(
      videoRow[baserowFields.videoReferenceSrtFieldKey],
    );
    const srtTargetUrl = extractUrl(videoRow[baserowFields.videoSrtFieldKey]);

    if (!srtReferenceUrl) {
      return NextResponse.json(
        {
          error: `Selected video is missing reference SRT URL (${baserowFields.videoReferenceSrtFieldKey}) for language '${selectedLanguageReference.language}'.`,
        },
        { status: 400 },
      );
    }

    if (!srtTargetUrl) {
      return NextResponse.json(
        {
          error: `Selected video is missing target-language SRT URL (${baserowFields.videoSrtFieldKey}) for language '${selectedLanguageReference.language}'.`,
        },
        { status: 400 },
      );
    }

    const [srtEnContent, srtFaContent] = await Promise.all([
      fetchTextFromUrl(srtReferenceUrl),
      fetchTextFromUrl(srtTargetUrl),
    ]);

    const enCues = parseSrtSegments(srtEnContent);
    const faCues = parseSrtSegments(srtFaContent);

    if (enCues.length === 0) {
      return NextResponse.json(
        {
          error: `Reference SRT (${baserowFields.videoReferenceSrtFieldKey}) could not be parsed into cues`,
        },
        { status: 400 },
      );
    }

    if (faCues.length === 0) {
      return NextResponse.json(
        {
          error: `Target-language SRT (${baserowFields.videoSrtFieldKey}) could not be parsed into cues`,
        },
        { status: 400 },
      );
    }

    if (enCues.length !== faCues.length) {
      return NextResponse.json(
        {
          error:
            'Reference SRT and target-language SRT cue counts do not match. Please ensure both SRT files have the same cues.',
          referenceCueCount: enCues.length,
          targetCueCount: faCues.length,
          referenceSrtField: baserowFields.videoReferenceSrtFieldKey,
          targetSrtField: baserowFields.videoSrtFieldKey,
        },
        { status: 400 },
      );
    }

    const timestampMismatches = collectTimestampMismatches(enCues, faCues);
    if (timestampMismatches.length > 0) {
      return NextResponse.json(
        {
          error:
            'Reference SRT and target-language SRT timestamps are not aligned cue-by-cue. Please align target SRT timestamps with the reference SRT first.',
          mismatchCount: timestampMismatches.length,
          sampleMismatches: timestampMismatches.slice(0, 10),
          maxAllowedDeltaSec: MAX_TIMESTAMP_DELTA_SEC,
          referenceSrtField: baserowFields.videoReferenceSrtFieldKey,
          targetSrtField: baserowFields.videoSrtFieldKey,
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
      .filter((scene) =>
        shouldIncludeSceneForDurationSrt(scene, baserowFields),
      );

    if (eligibleScenes.length !== enCues.length) {
      return NextResponse.json(
        {
          error:
            'Scene count eligible for SRT mapping does not match SRT cue count. Check scene duration/reference sentence mappings and retry.',
          eligibleSceneCount: eligibleScenes.length,
          referenceCueCount: enCues.length,
          targetCueCount: faCues.length,
          sceneDurationField: baserowFields.sceneDurationFieldKey,
          sceneReferenceSentenceField:
            baserowFields.sceneReferenceSentenceFieldKey,
        },
        { status: 400 },
      );
    }

    const referenceSceneTextMismatchSceneIds: number[] = [];
    let updatedCount = 0;
    let unchangedCount = 0;

    for (let i = 0; i < eligibleScenes.length; i += 1) {
      const scene = eligibleScenes[i];
      const sceneId = parsePositiveInt(scene.id);
      if (!sceneId) continue;

      const enCue = enCues[i];
      const faCue = faCues[i];
      const currentSceneReference = String(
        scene[baserowFields.sceneReferenceSentenceFieldKey] ?? '',
      ).trim();
      const nextSceneTarget = String(faCue.text ?? '').trim();
      const currentSceneTarget = String(
        scene[baserowFields.sceneTargetSentenceFieldKey] ?? '',
      ).trim();

      if (
        normalizeForLooseCompare(currentSceneReference) !==
        normalizeForLooseCompare(enCue.text)
      ) {
        referenceSceneTextMismatchSceneIds.push(sceneId);
      }

      if (!nextSceneTarget || nextSceneTarget === currentSceneTarget) {
        unchangedCount += 1;
        continue;
      }

      await baserowPatchRow(baserowUrl, token, SCENES_TABLE_ID, sceneId, {
        [baserowFields.sceneTargetSentenceFieldKey]: nextSceneTarget,
      });

      updatedCount += 1;
    }

    const step2RequestInit: RequestInit & { dispatcher: Agent } = {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        videoId,
        sourceTextFieldKey: baserowFields.sceneTargetSentenceFieldKey,
        destinationAudioFieldKey: baserowFields.sceneDubbedAudioFieldKey,
        originalAudioFieldKey:
          baserowFields.sceneOriginalAudioFieldKey || undefined,
        sceneDurationFieldKey: SCENE_DURATION_FIELD_KEY_FOR_AUDIO_FIT,
        provider: 'omnivoice',
        referenceAudioFilename: selectedLanguageReference.filename,
        skipIfDestinationExists: true,
        failFastOnSaveError: true,
        fitAudioToSceneDuration: true,
        ttsSettings: {
          provider: 'omnivoice',
          reference_audio_filename: selectedLanguageReference.filename,
          omniVoice: {
            referenceText: selectedLanguageReference.referenceText,
            language: selectedLanguageReference.language,
            deviceMap: selectedLanguageReference.deviceMap,
            dtype: selectedLanguageReference.dtype,
            numStep: selectedLanguageReference.numStep,
            speed: selectedLanguageReference.speed,
          },
        },
      }),
      dispatcher: STEP2_FETCH_DISPATCHER,
    };

    const step2Response = await fetch(
      `${request.nextUrl.origin}${GENERATE_SCENE_TTS_BY_FIELD_ROUTE}`,
      step2RequestInit,
    );

    const step2Payload = (await step2Response.json().catch(() => null)) as {
      ok?: unknown;
      error?: unknown;
      failureCount?: unknown;
      failures?: unknown;
      generatedCount?: unknown;
      originalSavedCount?: unknown;
      skippedOriginalSaveCount?: unknown;
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
          : `Step 2 ${selectedLanguageReference.language} TTS generation failed (${step2Response.status})`;

      throw new Error(
        failurePreview ? `${message} — ${failurePreview}` : message,
      );
    }

    return NextResponse.json({
      ok: true,
      step: 'step-1-map-target-srt-and-step-2-generate-dubbed-audio',
      videoId,
      language: selectedLanguageReference.language,
      step1: {
        referenceSrtField: baserowFields.videoReferenceSrtFieldKey,
        targetSrtField: baserowFields.videoSrtFieldKey,
        sceneDurationField: baserowFields.sceneDurationFieldKey,
        sceneReferenceSentenceField:
          baserowFields.sceneReferenceSentenceFieldKey,
        sceneTargetSentenceField: baserowFields.sceneTargetSentenceFieldKey,
        referenceCueCount: enCues.length,
        targetCueCount: faCues.length,
        eligibleSceneCount: eligibleScenes.length,
        updatedCount,
        unchangedCount,
        referenceSceneTextMismatchCount:
          referenceSceneTextMismatchSceneIds.length,
        referenceSceneTextMismatchSceneIds:
          referenceSceneTextMismatchSceneIds.slice(0, 20),
      },
      step2: {
        sourceTextField: baserowFields.sceneTargetSentenceFieldKey,
        dubbedAudioField: baserowFields.sceneDubbedAudioFieldKey,
        originalAudioField: baserowFields.sceneOriginalAudioFieldKey ?? null,
        referenceAudioFilename: selectedLanguageReference.filename,
        referenceAudioReferenceId: selectedLanguageReference.id,
        referenceAudioSource: selectedLanguageReference.source,
        language: selectedLanguageReference.language,
        referenceTextLength: selectedLanguageReference.referenceText.length,
        deviceMap: selectedLanguageReference.deviceMap,
        dtype: selectedLanguageReference.dtype,
        numStep: selectedLanguageReference.numStep,
        speed: selectedLanguageReference.speed,
        baserowFields,
        provider:
          typeof step2Payload?.provider === 'string'
            ? step2Payload.provider
            : 'omnivoice',
        providerPath:
          typeof step2Payload?.providerPath === 'string'
            ? step2Payload.providerPath
            : '/api/generate-tts-omnivoice',
        generatedCount: Number(step2Payload?.generatedCount ?? 0),
        originalSavedCount: Number(step2Payload?.originalSavedCount ?? 0),
        skippedOriginalSaveCount: Number(
          step2Payload?.skippedOriginalSaveCount ?? 0,
        ),
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
