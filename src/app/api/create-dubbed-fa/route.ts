import { NextRequest, NextResponse } from 'next/server';
import { Agent } from 'undici';
import { spawn } from 'child_process';
import path from 'path';
import { access, unlink, writeFile } from 'fs/promises';
import { uploadToMinio } from '@/utils/ffmpeg-direct';
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
const SCENE_REFERENCE_SENTENCE_FALLBACK_FIELD_KEY = 'field_6890';
const VIDEO_FINAL_DUBBED_FA_FIELD_KEY = 'field_7113';

const DEFAULT_DUBBED_LANGUAGE = 'fa';
const FALLBACK_LANGUAGE_BASEROW_FIELDS: LanguageBaserowFields = {
  videoSrtFieldKey: 'field_7112',
  videoReferenceSrtFieldKey: 'field_6872',
  videoFinalDubbedAudioFieldKey: VIDEO_FINAL_DUBBED_FA_FIELD_KEY,
  sceneDurationFieldKey: 'field_7107',
  sceneReferenceSentenceFieldKey: 'field_6890',
  sceneTargetSentenceFieldKey: 'field_7110',
  sceneDubbedAudioFieldKey: 'field_7111',
};

const GENERATE_SCENE_TTS_BY_FIELD_ROUTE = '/api/generate-scene-tts-by-field';
const MERGE_DUBBED_AUDIO_BY_FIELD_ROUTE = '/api/merge-dubbed-audio-by-field';
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

const VIDEO_UPLOADED_DURATION_FIELD_KEY = 'field_6909';
const VIDEO_UPLOADED_URL_FIELD_KEY = 'field_6881';
const AUDIO_SAMPLE_RATE = 48000;
const AUDIO_CHANNELS = 2;
const TIME_DECIMALS = 6;
const DEFAULT_FFMPEG_TIMEOUT_MS = 10 * 60 * 1000;
const DEFAULT_FFPROBE_TIMEOUT_MS = 2 * 60 * 1000;

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

type FFprobeStream = {
  codec_type?: unknown;
  duration?: string | number;
  sample_rate?: string | number;
  nb_samples?: string | number;
  duration_ts?: string | number;
  time_base?: unknown;
};

type FFprobeOutput = {
  format?: { duration?: string | number };
  streams?: FFprobeStream[];
};

type AudioProbeMetrics = {
  durationSec: number;
  sampleRate: number;
  sampleCount: number;
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

function parseNumberish(value: unknown): number {
  if (typeof value === 'number') return value;

  if (typeof value === 'string') {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : Number.NaN;
  }

  return Number.NaN;
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

function formatSeconds(value: number): string {
  return value.toFixed(TIME_DECIMALS);
}

function roundDurationSeconds(value: number): number {
  if (!Number.isFinite(value)) return value;
  return Number(value.toFixed(TIME_DECIMALS));
}

function secondsToSamples(seconds: number, sampleRate: number): number {
  if (!Number.isFinite(seconds) || seconds <= 0) {
    throw new Error(
      `Invalid duration seconds for sample conversion: ${seconds}`,
    );
  }
  if (!Number.isInteger(sampleRate) || sampleRate <= 0) {
    throw new Error(`Invalid sample rate for sample conversion: ${sampleRate}`);
  }
  return Math.max(1, Math.round(seconds * sampleRate));
}

function samplesToSeconds(sampleCount: number, sampleRate: number): number {
  if (!Number.isInteger(sampleCount) || sampleCount <= 0) {
    throw new Error(
      `Invalid sample count for duration conversion: ${sampleCount}`,
    );
  }
  if (!Number.isInteger(sampleRate) || sampleRate <= 0) {
    throw new Error(
      `Invalid sample rate for duration conversion: ${sampleRate}`,
    );
  }
  return sampleCount / sampleRate;
}

function parseTimeBase(value: unknown): number | null {
  if (typeof value !== 'string') {
    return null;
  }
  const [numeratorRaw, denominatorRaw] = value.trim().split('/');
  if (!numeratorRaw || !denominatorRaw) {
    return null;
  }
  const numerator = Number(numeratorRaw);
  const denominator = Number(denominatorRaw);
  if (!Number.isFinite(numerator) || !Number.isFinite(denominator)) {
    return null;
  }
  if (denominator <= 0) {
    return null;
  }
  const timeBase = numerator / denominator;
  return Number.isFinite(timeBase) && timeBase > 0 ? timeBase : null;
}

function parsePositiveRoundedInt(value: unknown): number | null {
  const parsed = parseNumberish(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return null;
  }
  const rounded = Math.round(parsed);
  return rounded > 0 ? rounded : null;
}

function makeTempPath(prefix: string, extension: string): string {
  const safeExt = extension.replace(/^\./, '');
  return path.resolve(
    '/tmp',
    `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 10)}.${safeExt}`,
  );
}

async function safeUnlink(filePath?: string | null): Promise<void> {
  if (!filePath) return;
  try {
    await unlink(filePath);
  } catch {
    // Best-effort cleanup only.
  }
}

async function runCommand(
  command: string,
  args: string[],
  timeoutMs: number,
): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    let settled = false;

    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      child.kill('SIGKILL');
      reject(new Error(`${command} timed out after ${timeoutMs}ms`));
    }, timeoutMs);

    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
    });
    child.on('error', (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(error);
    });
    child.on('close', (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (code !== 0) {
        reject(
          new Error(
            `${command} exited with code ${code}: ${stderr.slice(0, 500)}`,
          ),
        );
      } else {
        resolve({ stdout, stderr });
      }
    });
  });
}

async function probeAudioMetrics(input: string): Promise<AudioProbeMetrics> {
  const { stdout } = await runCommand(
    'ffprobe',
    [
      '-v',
      'quiet',
      '-print_format',
      'json',
      '-show_format',
      '-show_streams',
      input,
    ],
    DEFAULT_FFPROBE_TIMEOUT_MS,
  );

  const parsed = (JSON.parse(stdout) ?? {}) as FFprobeOutput;
  const streams = Array.isArray(parsed.streams) ? parsed.streams : [];
  const audioStream =
    streams.find((stream) => stream?.codec_type === 'audio') ??
    streams[0] ??
    null;

  const sampleRate =
    parsePositiveInt(audioStream?.sample_rate) ?? AUDIO_SAMPLE_RATE;

  let sampleCount = parsePositiveRoundedInt(audioStream?.nb_samples);

  if (!sampleCount) {
    const durationTs = parseNumberish(audioStream?.duration_ts);
    const timeBase = parseTimeBase(audioStream?.time_base);
    if (Number.isFinite(durationTs) && durationTs > 0 && timeBase) {
      const durationFromTsSec = durationTs * timeBase;
      if (Number.isFinite(durationFromTsSec) && durationFromTsSec > 0) {
        sampleCount = secondsToSamples(durationFromTsSec, sampleRate);
      }
    }
  }

  if (!sampleCount) {
    const streamDurationSec = parseNumberish(audioStream?.duration);
    if (Number.isFinite(streamDurationSec) && streamDurationSec > 0) {
      sampleCount = secondsToSamples(streamDurationSec, sampleRate);
    }
  }

  if (!sampleCount) {
    const formatDurationSec = parseNumberish(parsed.format?.duration);
    if (Number.isFinite(formatDurationSec) && formatDurationSec > 0) {
      sampleCount = secondsToSamples(formatDurationSec, sampleRate);
    }
  }

  if (!sampleCount) {
    throw new Error('Unable to determine media duration via ffprobe');
  }

  const durationSec = samplesToSeconds(sampleCount, sampleRate);
  return {
    durationSec: roundDurationSeconds(durationSec),
    sampleRate,
    sampleCount,
  };
}

async function appendSilenceToAudioLocal(options: {
  videoId: number;
  inputPath: string;
  silenceDurationSec: number;
}): Promise<string> {
  const { videoId, inputPath, silenceDurationSec } = options;

  const outputPath = makeTempPath(
    `video_${videoId}_dubbed_audio_pad_to_video`,
    'wav',
  );

  await runCommand(
    'ffmpeg',
    [
      '-y',
      '-i',
      inputPath,
      '-f',
      'lavfi',
      '-t',
      formatSeconds(silenceDurationSec),
      '-i',
      `anullsrc=sample_rate=${AUDIO_SAMPLE_RATE}:channel_layout=stereo`,
      '-vn',
      '-map_metadata',
      '-1',
      '-map_chapters',
      '-1',
      '-filter_complex',
      `[0:a]aformat=sample_fmts=fltp:sample_rates=${AUDIO_SAMPLE_RATE}:channel_layouts=stereo,asetpts=N/SR/TB[a0];[1:a]aformat=sample_fmts=fltp:sample_rates=${AUDIO_SAMPLE_RATE}:channel_layouts=stereo,asetpts=N/SR/TB[a1];[a0][a1]concat=n=2:v=0:a=1[aout]`,
      '-map',
      '[aout]',
      '-c:a',
      'pcm_s16le',
      '-ar',
      String(AUDIO_SAMPLE_RATE),
      '-ac',
      String(AUDIO_CHANNELS),
      outputPath,
    ],
    DEFAULT_FFMPEG_TIMEOUT_MS,
  );

  await access(outputPath);
  return outputPath;
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

    const orderedScenes = [...scenes].sort(
      (a, b) => getSceneOrderValue(a) - getSceneOrderValue(b),
    );

    const sceneCandidates = orderedScenes.map((scene, idx) => ({
      scene,
      sceneId: parsePositiveInt(scene.id),
      normalizedReference: normalizeForLooseCompare(
        String(scene[SCENE_REFERENCE_SENTENCE_FALLBACK_FIELD_KEY] ?? ''),
      ),
      used: false,
      idx,
    }));

    const alignedPairs: Array<{
      scene: BaserowRow;
      enCue: (typeof enCues)[number];
      faCue: (typeof faCues)[number];
    }> = [];
    const missingCueMatches: Array<{ cueIndex: number; cueText: string }> = [];

    for (let i = 0; i < enCues.length; i += 1) {
      const enCue = enCues[i];
      const faCue = faCues[i];
      const normalizedCueText = normalizeForLooseCompare(enCue.text ?? '');

      if (!normalizedCueText) {
        missingCueMatches.push({ cueIndex: i + 1, cueText: enCue.text ?? '' });
        continue;
      }

      const match = sceneCandidates.find(
        (candidate) =>
          !candidate.used &&
          candidate.sceneId !== null &&
          candidate.normalizedReference.length > 0 &&
          candidate.normalizedReference === normalizedCueText,
      );

      if (!match) {
        missingCueMatches.push({ cueIndex: i + 1, cueText: enCue.text ?? '' });
        continue;
      }

      match.used = true;
      alignedPairs.push({ scene: match.scene, enCue, faCue });
    }

    if (alignedPairs.length !== enCues.length) {
      return NextResponse.json(
        {
          error:
            'Scene count eligible for SRT mapping does not match SRT cue count. Check scene duration/reference sentence mappings and retry.',
          details: [
            `Text-based mapping failed: matched=${alignedPairs.length}, cueCount=${enCues.length}, totalScenes=${orderedScenes.length}`,
            `Missing cue matches (first 20): ${missingCueMatches
              .slice(0, 20)
              .map((item) => `#${item.cueIndex}:${item.cueText.slice(0, 80)}`)
              .join(' | ')}`,
          ],
          matchedSceneCount: alignedPairs.length,
          referenceCueCount: enCues.length,
          targetCueCount: faCues.length,
          totalSceneCount: orderedScenes.length,
          missingCueMatchCount: missingCueMatches.length,
          missingCueMatchSample: missingCueMatches.slice(0, 20),
          sceneReferenceSentenceField:
            SCENE_REFERENCE_SENTENCE_FALLBACK_FIELD_KEY,
        },
        { status: 400 },
      );
    }

    const referenceSceneTextMismatchSceneIds: number[] = [];
    let updatedCount = 0;
    let unchangedCount = 0;

    for (let i = 0; i < alignedPairs.length; i += 1) {
      const scene = alignedPairs[i].scene;
      const sceneId = parsePositiveInt(scene.id);
      if (!sceneId) continue;

      const enCue = alignedPairs[i].enCue;
      const faCue = alignedPairs[i].faCue;
      const currentSceneReference = String(
        scene[SCENE_REFERENCE_SENTENCE_FALLBACK_FIELD_KEY] ?? '',
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
        language: selectedLanguageReference.language,
        sourceTextFieldKey: baserowFields.sceneTargetSentenceFieldKey,
        destinationAudioFieldKey: baserowFields.sceneDubbedAudioFieldKey,
        originalAudioFieldKey:
          baserowFields.sceneOriginalAudioFieldKey || undefined,
        createSilenceForEmptySentence: true,
        emptySentenceFieldKey: baserowFields.sceneReferenceSentenceFieldKey,
        sceneDurationFieldKey: SCENE_DURATION_FIELD_KEY_FOR_AUDIO_FIT,
        provider: 'omnivoice',
        referenceAudioFilename: selectedLanguageReference.filename,
        skipIfDestinationExists: true,
        failFastOnSaveError: false,
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
      failedSceneIds?: unknown;
      failuresByCategory?: unknown;
      generatedCount?: unknown;
      silentGeneratedCount?: unknown;
      originalSavedCount?: unknown;
      skippedOriginalSaveCount?: unknown;
      skippedNoTextCount?: unknown;
      skippedExistingCount?: unknown;
      skippedSceneFilterCount?: unknown;
      skippedInvalidSceneIdCount?: unknown;
      provider?: unknown;
      providerPath?: unknown;
    } | null;

    if (!step2Response.ok) {
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

    const step2FailureCount = Number(step2Payload?.failureCount ?? 0);
    const step2FailedSceneIds = Array.isArray(step2Payload?.failedSceneIds)
      ? step2Payload.failedSceneIds
          .map((value) => parsePositiveInt(value))
          .filter((value): value is number => Boolean(value))
      : Array.isArray(step2Payload?.failures)
        ? step2Payload.failures
            .map((item) => {
              if (!item || typeof item !== 'object') return null;
              const maybeSceneId = (item as { sceneId?: unknown }).sceneId;
              return parsePositiveInt(maybeSceneId);
            })
            .filter((value): value is number => Boolean(value))
        : [];

    if (step2FailureCount > 0 || step2Payload?.ok !== true) {
      return NextResponse.json(
        {
          error: `Step 2 ${selectedLanguageReference.language} TTS generation finished with ${step2FailureCount} failed scene(s). Merge skipped until all scenes succeed.`,
          step: 'step-2-generate-dubbed-audio',
          remediation: 'retry-failed-scenes',
          details: [
            `Retry failed scene IDs: ${step2FailedSceneIds.slice(0, 20).join(', ') || 'n/a'}`,
            'Transient database/provider errors are now auto-retried with backoff, but exhausted scenes still need retry.',
          ],
          step2: {
            ok: false,
            failureCount: step2FailureCount,
            failedSceneIds: step2FailedSceneIds,
            failuresByCategory:
              step2Payload?.failuresByCategory &&
              typeof step2Payload.failuresByCategory === 'object'
                ? step2Payload.failuresByCategory
                : {},
            generatedCount: Number(step2Payload?.generatedCount ?? 0),
            silentGeneratedCount: Number(
              step2Payload?.silentGeneratedCount ?? 0,
            ),
            originalSavedCount: Number(step2Payload?.originalSavedCount ?? 0),
            skippedOriginalSaveCount: Number(
              step2Payload?.skippedOriginalSaveCount ?? 0,
            ),
            skippedNoTextCount: Number(step2Payload?.skippedNoTextCount ?? 0),
            skippedExistingCount: Number(
              step2Payload?.skippedExistingCount ?? 0,
            ),
            skippedSceneFilterCount: Number(
              step2Payload?.skippedSceneFilterCount ?? 0,
            ),
            skippedInvalidSceneIdCount: Number(
              step2Payload?.skippedInvalidSceneIdCount ?? 0,
            ),
          },
        },
        { status: 502 },
      );
    }

    const configuredFinalDubbedAudioField =
      typeof baserowFields.videoFinalDubbedAudioFieldKey === 'string'
        ? baserowFields.videoFinalDubbedAudioFieldKey.trim()
        : '';

    const finalDubbedAudioFieldKey =
      configuredFinalDubbedAudioField ||
      (selectedLanguageReference.language === DEFAULT_DUBBED_LANGUAGE
        ? VIDEO_FINAL_DUBBED_FA_FIELD_KEY
        : '');

    if (!finalDubbedAudioFieldKey) {
      return NextResponse.json(
        {
          error: `Missing final dubbed audio destination field for language '${selectedLanguageReference.language}'. Set Video Final Dubbed Audio Field in Global TTS Settings → Manage Language Presets.`,
        },
        { status: 400 },
      );
    }

    const step3Response = await fetch(
      `${request.nextUrl.origin}${MERGE_DUBBED_AUDIO_BY_FIELD_ROUTE}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          videoId,
          sourceSceneAudioFieldKey: baserowFields.sceneDubbedAudioFieldKey,
          destinationVideoAudioFieldKey: finalDubbedAudioFieldKey,
          sceneDurationFieldKey: SCENE_DURATION_FIELD_KEY_FOR_AUDIO_FIT,
          requireAudioForDurationScenes: true,
          language: selectedLanguageReference.language,
        }),
        dispatcher: STEP2_FETCH_DISPATCHER,
      } as RequestInit & { dispatcher: Agent },
    );

    const step3Payload = (await step3Response.json().catch(() => null)) as {
      ok?: unknown;
      error?: unknown;
      missingAudioSceneIds?: unknown;
      mergedSceneCount?: unknown;
      expectedMergedDurationSec?: unknown;
      mergedOutputDurationSec?: unknown;
      mergedOutputDeltaSamples?: unknown;
      mergeCorrectionPasses?: unknown;
      finalDubbedAudioUrl?: unknown;
      destinationVideoAudioFieldKey?: unknown;
    } | null;

    if (!step3Response.ok || step3Payload?.ok !== true) {
      const missingAudioPreview = Array.isArray(
        step3Payload?.missingAudioSceneIds,
      )
        ? step3Payload.missingAudioSceneIds
            .slice(0, 10)
            .map((value) => String(value))
            .join(', ')
        : '';

      const message =
        typeof step3Payload?.error === 'string' && step3Payload.error.trim()
          ? step3Payload.error.trim()
          : `Step 3 merge/save final dubbed audio failed (${step3Response.status})`;

      throw new Error(
        missingAudioPreview
          ? `${message} — missing scene audio IDs: ${missingAudioPreview}`
          : message,
      );
    }

    // ── Step 4: Pad dubbed audio with silence if shorter than the full video ──

    const step4TempFiles: string[] = [];
    let step4VideoDurationSec = 0;
    let step4DubbedAudioDurationSec = 0;
    let step4SilencePaddedSec = 0;
    let step4FinalDubbedAudioUrl: string | null =
      typeof step3Payload?.finalDubbedAudioUrl === 'string'
        ? step3Payload.finalDubbedAudioUrl
        : null;

    try {
      // Resolve full video duration from Baserow (field_6909), probe if missing.
      let videoDurationSec = parsePositiveNumber(
        videoRow[VIDEO_UPLOADED_DURATION_FIELD_KEY],
      );

      if (!videoDurationSec) {
        const uploadedVideoUrl = extractUrl(
          videoRow[VIDEO_UPLOADED_URL_FIELD_KEY],
        );
        if (uploadedVideoUrl) {
          try {
            const probed = await probeAudioMetrics(uploadedVideoUrl);
            videoDurationSec = roundDurationSeconds(probed.durationSec);

            if (videoDurationSec && videoDurationSec > 0) {
              await baserowPatchRow(
                baserowUrl,
                token,
                VIDEOS_TABLE_ID,
                videoId,
                {
                  [VIDEO_UPLOADED_DURATION_FIELD_KEY]: videoDurationSec,
                },
              );
            }
          } catch (probeError) {
            console.warn(
              `[create-dubbed-fa] Step 4: Could not probe video duration for video ${videoId}:`,
              probeError,
            );
          }
        }
      }

      step4VideoDurationSec = videoDurationSec ?? 0;

      if (
        !videoDurationSec ||
        videoDurationSec <= 0 ||
        !step4FinalDubbedAudioUrl
      ) {
        console.warn(
          `[create-dubbed-fa] Step 4: Skipping — videoDurationSec=${videoDurationSec ?? 'null'}, finalDubbedAudioUrl=${step4FinalDubbedAudioUrl ?? 'null'}`,
        );
      } else {
        // Download merged dubbed audio to a temp file so we can probe & modify it locally.
        const downloadResponse = await fetch(step4FinalDubbedAudioUrl);
        if (!downloadResponse.ok) {
          throw new Error(
            `Step 4: Failed to download merged dubbed audio (${downloadResponse.status})`,
          );
        }

        const downloadedPath = makeTempPath(
          `video_${videoId}_dubbed_audio_step4_download`,
          'wav',
        );
        step4TempFiles.push(downloadedPath);

        const buffer = Buffer.from(await downloadResponse.arrayBuffer());
        await writeFile(downloadedPath, buffer);

        // Probe the downloaded audio.
        const dubbedMetrics = await probeAudioMetrics(downloadedPath);
        step4DubbedAudioDurationSec = dubbedMetrics.durationSec;

        const targetDurationSec = roundDurationSeconds(videoDurationSec);
        const targetSamples = secondsToSamples(
          targetDurationSec,
          dubbedMetrics.sampleRate,
        );
        const deltaSamples = dubbedMetrics.sampleCount - targetSamples;

        if (deltaSamples >= 0) {
          // Dubbed audio is already ≥ video duration — nothing to do.
          console.log(
            `[create-dubbed-fa] Step 4: Dubbed audio (${dubbedMetrics.durationSec}s) ≥ video (${targetDurationSec}s) — no padding needed.`,
          );
        } else {
          // Dubbed audio is shorter — append silence to reach video duration.
          const silenceDurationSec = samplesToSeconds(
            Math.abs(deltaSamples),
            dubbedMetrics.sampleRate,
          );

          console.log(
            `[create-dubbed-fa] Step 4: Dubbed audio (${dubbedMetrics.durationSec}s) < video (${targetDurationSec}s) — appending ${silenceDurationSec.toFixed(TIME_DECIMALS)}s of silence.`,
          );

          const paddedPath = await appendSilenceToAudioLocal({
            videoId,
            inputPath: downloadedPath,
            silenceDurationSec,
          });
          step4TempFiles.push(paddedPath);

          // Verify padded audio matches target.
          const paddedMetrics = await probeAudioMetrics(paddedPath);
          step4SilencePaddedSec = silenceDurationSec;

          // Re-upload padded audio and update Baserow.
          const paddedFilename = `video_${videoId}_merged_${selectedLanguageReference.language}_padded_to_video_${Date.now()}.wav`;
          const paddedUrl = await uploadToMinio(
            paddedPath,
            paddedFilename,
            'audio/wav',
          );

          await baserowPatchRow(baserowUrl, token, VIDEOS_TABLE_ID, videoId, {
            [finalDubbedAudioFieldKey]: paddedUrl,
          });

          step4FinalDubbedAudioUrl = paddedUrl;

          console.log(
            `[create-dubbed-fa] Step 4: Padded audio saved. Final duration: ${paddedMetrics.durationSec}s (target: ${targetDurationSec}s, delta: ${paddedMetrics.sampleCount - targetSamples} samples).`,
          );
        }
      }
    } catch (step4Error) {
      // Step 4 failure should not abort the overall pipeline — Steps 1–3 already succeeded.
      console.error(`[create-dubbed-fa] Step 4 error (non-fatal):`, step4Error);
    } finally {
      for (const filePath of step4TempFiles) {
        await safeUnlink(filePath);
      }
    }

    // ── Final response ──

    return NextResponse.json({
      ok: true,
      step: 'step-1-map-target-srt-and-step-2-generate-dubbed-audio-and-step-3-merge-save-final-dubbed-audio-and-step-4-pad-to-video-duration',
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
        eligibleSceneCount: alignedPairs.length,
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
        emptySentenceFieldForSilence:
          baserowFields.sceneReferenceSentenceFieldKey,
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
        silentGeneratedCount: Number(step2Payload?.silentGeneratedCount ?? 0),
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
      step3: {
        sourceSceneAudioField: baserowFields.sceneDubbedAudioFieldKey,
        destinationVideoAudioField: finalDubbedAudioFieldKey,
        mergedSceneCount: Number(step3Payload?.mergedSceneCount ?? 0),
        expectedMergedDurationSec: Number(
          step3Payload?.expectedMergedDurationSec ?? 0,
        ),
        mergedOutputDurationSec: Number(
          step3Payload?.mergedOutputDurationSec ?? 0,
        ),
        mergedOutputDeltaSamples: Number(
          step3Payload?.mergedOutputDeltaSamples ?? 0,
        ),
        mergeCorrectionPasses: Number(step3Payload?.mergeCorrectionPasses ?? 0),
        finalDubbedAudioUrl: step4FinalDubbedAudioUrl,
      },
      step4: {
        videoDurationSec: step4VideoDurationSec,
        dubbedAudioDurationSec: step4DubbedAudioDurationSec,
        silencePaddedSec: step4SilencePaddedSec,
        finalDubbedAudioUrl: step4FinalDubbedAudioUrl,
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
