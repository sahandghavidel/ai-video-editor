import { NextRequest, NextResponse } from 'next/server';
import { spawn } from 'child_process';
import path from 'path';
import { access, unlink } from 'fs/promises';
import { uploadToMinio } from '@/utils/ffmpeg-direct';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const VIDEOS_TABLE_ID = '713';
const SCENES_TABLE_ID = '714';

const SCENE_VIDEO_LINK_FIELD_KEY = 'field_6889';
const SCENE_TTS_FIELD_KEY = 'field_6891';
const SCENE_DURATION_FIELD_KEY = 'field_6884';
const SCENE_DUBBED_EN_FIELD_KEY = 'field_7108';
const SCENE_SENTENCE_FIELD_KEY = 'field_6890';

const VIDEO_FINAL_DUBBED_AUDIO_FIELD_KEY = 'field_7109';
const VIDEO_UPLOADED_DURATION_FIELD_KEY = 'field_6909';

const AUDIO_SAMPLE_RATE = 48000;
const AUDIO_CHANNELS = 2;

const TIME_DECIMALS = 6;
const SPEED_DECIMALS = 12;

const DEFAULT_FFMPEG_TIMEOUT_MS = 10 * 60 * 1000;
const DEFAULT_FFPROBE_TIMEOUT_MS = 2 * 60 * 1000;
const SCENE_DURATION_TOLERANCE_SEC = 1 / AUDIO_SAMPLE_RATE;
const SCENE_DURATION_TOLERANCE_SAMPLES = Math.max(
  1,
  Math.round(SCENE_DURATION_TOLERANCE_SEC * AUDIO_SAMPLE_RATE),
);
const SCENE_MAX_TEMPO_PASSES = 10;
const SCENE_COARSE_TOLERANCE_SAMPLES = 6;
const SCENE_FINE_TOLERANCE_SAMPLES = 2;
const SCENE_FINAL_TOLERANCE_SAMPLES = 1;
const SCENE_COARSE_MAX_TEMPO_PASSES = 4;
const SCENE_FINE_MAX_TEMPO_PASSES = 0;
const SCENE_VERIFY_MAX_TEMPO_PASSES = 0;
const LONGER_ADAPTIVE_UNDERSHOOT_MIN_SEC = 0.005;
const LONGER_ADAPTIVE_UNDERSHOOT_MAX_SEC = 0.03;
const LONGER_ADAPTIVE_UNDERSHOOT_RATIO = 0.05;
const ENABLE_SCENE_DURATION_FIT = true;

type BaserowRow = Record<string, unknown>;

type BaserowListResponse = {
  results?: BaserowRow[];
  next?: string | null;
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
  format?: {
    duration?: string | number;
  };
  streams?: FFprobeStream[];
};

type AudioProbeMetrics = {
  durationSec: number;
  sampleRate: number;
  sampleCount: number;
};

type SceneJob = {
  sceneId: number;
  orderValue: number;
  audioUrl: string | null;
  source: 'tts' | 'silence' | 'existing';
  targetDurationSec: number;
};

type SceneProcessResult = {
  sceneId: number;
  orderValue: number;
  source: 'tts' | 'silence' | 'existing';
  targetDurationSec: number;
  inputDurationSec: number;
  outputDurationSec: number;
  outputSampleCount: number;
  speedApplied: number;
  dubbedEnUrl: string;
  localAdjustedPath: string;
};

type FinalMergeCorrectionMode = 'none' | 'pad-silence' | 'trim-end';

type FinalMergeCorrectionResult = {
  localPath: string;
  outputDurationSec: number;
  outputSamples: number;
  targetDurationSec: number;
  targetSamples: number;
  correctionPasses: number;
  correctionMode: FinalMergeCorrectionMode;
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

function isTransientBaserowError(error: unknown): boolean {
  if (error instanceof BaserowRequestError) {
    return [408, 425, 429, 500, 502, 503, 504].includes(error.status);
  }

  if (!(error instanceof Error)) {
    return false;
  }

  const message = error.message.toLowerCase();
  return (
    error.name === 'TypeError' ||
    message.includes('fetch failed') ||
    message.includes('network') ||
    message.includes('socket') ||
    message.includes('timed out') ||
    message.includes('econnreset') ||
    message.includes('enotfound') ||
    message.includes('etimedout')
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
  if (typeof value === 'number') {
    return value;
  }
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

function isSceneEmptyForDub(scene: BaserowRow): boolean {
  const sentenceText = String(scene[SCENE_SENTENCE_FIELD_KEY] ?? '').trim();

  return sentenceText === '';
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

function clampNumber(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function computeAdaptiveUndershootSamples(options: {
  overageSamples: number;
  sampleRate: number;
  targetSamples: number;
}): { undershootSamples: number; undershootSec: number } {
  const { overageSamples, sampleRate, targetSamples } = options;

  if (!Number.isInteger(overageSamples) || overageSamples <= 0) {
    return { undershootSamples: 0, undershootSec: 0 };
  }

  const minSamples = Math.max(
    1,
    secondsToSamples(LONGER_ADAPTIVE_UNDERSHOOT_MIN_SEC, sampleRate),
  );
  const maxSamples = Math.max(
    minSamples,
    secondsToSamples(LONGER_ADAPTIVE_UNDERSHOOT_MAX_SEC, sampleRate),
  );

  const rawSamples = Math.max(
    1,
    Math.round(overageSamples * LONGER_ADAPTIVE_UNDERSHOOT_RATIO),
  );

  const boundedSamples = clampNumber(rawSamples, minSamples, maxSamples);
  const maxAllowedByTarget = Math.max(
    1,
    targetSamples - SCENE_FINAL_TOLERANCE_SAMPLES,
  );
  const undershootSamples = Math.min(boundedSamples, maxAllowedByTarget);

  return {
    undershootSamples,
    undershootSec: roundDurationSeconds(
      samplesToSeconds(undershootSamples, sampleRate),
    ),
  };
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

function buildAtempoChain(speed: number): string {
  if (!Number.isFinite(speed) || speed <= 0) {
    throw new Error(`Invalid tempo speed: ${speed}`);
  }

  const filters: string[] = [];
  let remaining = speed;

  while (remaining > 2.0) {
    filters.push('atempo=2.0');
    remaining /= 2.0;
  }

  while (remaining < 0.5) {
    filters.push('atempo=0.5');
    remaining /= 0.5;
  }

  if (Math.abs(remaining - 1.0) > 1e-9) {
    filters.push(`atempo=${remaining.toFixed(SPEED_DECIMALS)}`);
  }

  return filters.length > 0 ? filters.join(',') : 'anull';
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
    // Best-effort cleanup.
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

      if (code === 0) {
        resolve({ stdout, stderr });
        return;
      }

      const stderrTail = stderr.trim().slice(-2000);
      reject(
        new Error(
          `${command} failed with code ${code}${stderrTail ? `: ${stderrTail}` : ''}`,
        ),
      );
    });
  });
}

async function probeMediaDurationSeconds(input: string): Promise<number> {
  const metrics = await probeAudioMetrics(input);
  return metrics.durationSec;
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

  const durationSec = roundDurationSeconds(
    samplesToSeconds(sampleCount, sampleRate),
  );

  return {
    durationSec,
    sampleRate,
    sampleCount,
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

async function patchSceneDubbedEnWithAuthRetry(options: {
  baserowUrl: string;
  token: string;
  sceneId: number;
  dubbedEnUrl: string;
}): Promise<string> {
  const { baserowUrl, token, sceneId, dubbedEnUrl } = options;

  const patchPayload = {
    [SCENE_DUBBED_EN_FIELD_KEY]: dubbedEnUrl,
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
    if (isTransientBaserowError(error)) {
      console.warn(
        `[create-dubbed-en] Transient Baserow error while saving scene ${sceneId}. Retrying once...`,
      );

      await baserowPatchRow(
        baserowUrl,
        token,
        SCENES_TABLE_ID,
        sceneId,
        patchPayload,
      );

      return token;
    }

    if (!isBaserowAuthError(error)) {
      throw error;
    }

    console.warn(
      `[create-dubbed-en] Baserow auth expired while saving scene ${sceneId}. Refreshing token and retrying once...`,
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

async function patchFinalDubbedEnWithAuthRetry(options: {
  baserowUrl: string;
  token: string;
  videoId: number;
  finalDubbedAudioUrl: string;
}): Promise<string> {
  const { baserowUrl, token, videoId, finalDubbedAudioUrl } = options;

  const patchPayload = {
    [VIDEO_FINAL_DUBBED_AUDIO_FIELD_KEY]: finalDubbedAudioUrl,
  };

  try {
    await baserowPatchRow(
      baserowUrl,
      token,
      VIDEOS_TABLE_ID,
      videoId,
      patchPayload,
    );
    return token;
  } catch (error) {
    if (isTransientBaserowError(error)) {
      console.warn(
        `[create-dubbed-en] Transient Baserow error while saving final dubbed audio for video ${videoId}. Retrying once...`,
      );

      await baserowPatchRow(
        baserowUrl,
        token,
        VIDEOS_TABLE_ID,
        videoId,
        patchPayload,
      );

      return token;
    }

    if (!isBaserowAuthError(error)) {
      throw error;
    }

    console.warn(
      `[create-dubbed-en] Baserow auth expired while saving final dubbed audio for video ${videoId}. Refreshing token and retrying once...`,
    );

    const refreshedToken = await getJWTToken(true);
    await baserowPatchRow(
      baserowUrl,
      refreshedToken,
      VIDEOS_TABLE_ID,
      videoId,
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

async function fetchVideoRowById(
  baserowUrl: string,
  token: string,
  videoId: number,
): Promise<BaserowRow> {
  return baserowGetJson<BaserowRow>(
    baserowUrl,
    token,
    `/database/rows/table/${VIDEOS_TABLE_ID}/${videoId}/`,
  );
}

async function normalizeAudioToWavLocal(options: {
  sceneId: number;
  videoId: number;
  inputAudioUrl: string;
}): Promise<string> {
  const { sceneId, videoId, inputAudioUrl } = options;

  const outputPath = makeTempPath(
    `video_${videoId}_scene_${sceneId}_dubbed_en_fit_normalized`,
    'wav',
  );

  await runCommand(
    'ffmpeg',
    [
      '-y',
      '-i',
      inputAudioUrl,
      '-vn',
      '-map_metadata',
      '-1',
      '-map_chapters',
      '-1',
      '-filter_complex',
      `[0:a]aformat=sample_fmts=fltp:sample_rates=${AUDIO_SAMPLE_RATE}:channel_layouts=stereo,asetpts=N/SR/TB[aout]`,
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

async function appendSilenceToAudioLocal(options: {
  sceneId: number;
  videoId: number;
  inputPath: string;
  silenceSamples: number;
}): Promise<string> {
  const { sceneId, videoId, inputPath, silenceSamples } = options;

  if (!Number.isInteger(silenceSamples) || silenceSamples <= 0) {
    throw new Error(`Invalid silence sample count: ${silenceSamples}`);
  }

  const silenceDurationSec = samplesToSeconds(
    silenceSamples,
    AUDIO_SAMPLE_RATE,
  );

  const outputPath = makeTempPath(
    `video_${videoId}_scene_${sceneId}_dubbed_en_fit_silence`,
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
      `[0:a]aformat=sample_fmts=s16:sample_rates=${AUDIO_SAMPLE_RATE}:channel_layouts=stereo,asetpts=N/SR/TB[a0];[1:a]aformat=sample_fmts=s16:sample_rates=${AUDIO_SAMPLE_RATE}:channel_layouts=stereo,asetpts=N/SR/TB[a1];[a0][a1]concat=n=2:v=0:a=1[aout]`,
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

async function appendSilenceSamplesToAudioLocal(options: {
  videoId: number;
  inputPath: string;
  silenceSamples: number;
  outputPrefix: string;
}): Promise<string> {
  const { videoId, inputPath, silenceSamples, outputPrefix } = options;

  if (!Number.isInteger(silenceSamples) || silenceSamples <= 0) {
    throw new Error(`Invalid silence sample count: ${silenceSamples}`);
  }

  const silenceDurationSec = samplesToSeconds(
    silenceSamples,
    AUDIO_SAMPLE_RATE,
  );

  const outputPath = makeTempPath(`${outputPrefix}_${videoId}`, 'wav');

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

async function trimAudioToSampleCountLocal(options: {
  inputPath: string;
  targetSamples: number;
  outputPrefix: string;
}): Promise<string> {
  const { inputPath, targetSamples, outputPrefix } = options;

  if (!Number.isInteger(targetSamples) || targetSamples <= 0) {
    throw new Error(`Invalid target sample count: ${targetSamples}`);
  }

  const outputPath = makeTempPath(outputPrefix, 'wav');

  await runCommand(
    'ffmpeg',
    [
      '-y',
      '-i',
      inputPath,
      '-vn',
      '-map_metadata',
      '-1',
      '-map_chapters',
      '-1',
      '-filter_complex',
      `[0:a]aformat=sample_fmts=s16:sample_rates=${AUDIO_SAMPLE_RATE}:channel_layouts=stereo,atrim=start_sample=0:end_sample=${targetSamples},asetpts=N/SR/TB[aout]`,
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

async function fitMergedAudioToTargetDurationWithPadTrimLocal(options: {
  inputPath: string;
  videoId: number;
  targetDurationSec: number;
}): Promise<FinalMergeCorrectionResult> {
  const { inputPath, videoId, targetDurationSec } = options;
  const normalizedTargetDurationSec = roundDurationSeconds(targetDurationSec);
  const targetSamples = secondsToSamples(
    normalizedTargetDurationSec,
    AUDIO_SAMPLE_RATE,
  );
  const initialMetrics = await probeAudioMetrics(inputPath);
  const deltaSamples = initialMetrics.sampleCount - targetSamples;

  if (deltaSamples === 0) {
    return {
      localPath: inputPath,
      outputDurationSec: initialMetrics.durationSec,
      outputSamples: initialMetrics.sampleCount,
      targetDurationSec: normalizedTargetDurationSec,
      targetSamples,
      correctionPasses: 0,
      correctionMode: 'none',
    };
  }

  const correctionMode: FinalMergeCorrectionMode =
    deltaSamples < 0 ? 'pad-silence' : 'trim-end';

  const correctedPath =
    deltaSamples < 0
      ? await appendSilenceSamplesToAudioLocal({
          videoId,
          inputPath,
          silenceSamples: Math.abs(deltaSamples),
          outputPrefix: `video_${videoId}_dubbed_en_merge_pad`,
        })
      : await trimAudioToSampleCountLocal({
          inputPath,
          targetSamples,
          outputPrefix: `video_${videoId}_dubbed_en_merge_trim`,
        });

  try {
    const finalMetrics = await probeAudioMetrics(correctedPath);
    if (finalMetrics.sampleCount !== targetSamples) {
      throw new Error(
        `Unable to align merged audio exactly to uploaded video duration. targetSamples=${targetSamples}, actualSamples=${finalMetrics.sampleCount}`,
      );
    }

    return {
      localPath: correctedPath,
      outputDurationSec: finalMetrics.durationSec,
      outputSamples: finalMetrics.sampleCount,
      targetDurationSec: normalizedTargetDurationSec,
      targetSamples,
      correctionPasses: 1,
      correctionMode,
    };
  } catch (error) {
    await safeUnlink(correctedPath);
    throw error;
  }
}

async function tempoMatchAudioToDurationLocal(options: {
  sceneId: number;
  videoId: number;
  inputPath: string;
  targetSamples: number;
  outputPrefix: string;
  toleranceSamples?: number;
  maxPasses?: number;
}): Promise<{
  localPath: string;
  outputDurationSec: number;
  outputSamples: number;
  speedApplied: number;
}> {
  const {
    sceneId,
    videoId,
    inputPath,
    targetSamples,
    outputPrefix,
    toleranceSamples = SCENE_DURATION_TOLERANCE_SAMPLES,
    maxPasses = SCENE_MAX_TEMPO_PASSES,
  } = options;

  if (!Number.isInteger(targetSamples) || targetSamples <= 0) {
    throw new Error(`Invalid target sample count: ${targetSamples}`);
  }

  let currentPath = inputPath;
  const initialMetrics = await probeAudioMetrics(inputPath);
  let currentSamples = initialMetrics.sampleCount;
  let currentSampleRate = initialMetrics.sampleRate;
  let cumulativeSpeedApplied = 1;
  const generatedPassPaths: string[] = [];

  try {
    for (let passIndex = 1; passIndex <= maxPasses; passIndex += 1) {
      const deltaSamples = currentSamples - targetSamples;
      if (Math.abs(deltaSamples) <= toleranceSamples) {
        break;
      }

      const passSpeedApplied = currentSamples / targetSamples;
      if (!Number.isFinite(passSpeedApplied) || passSpeedApplied <= 0) {
        throw new Error(
          `Invalid scene tempo speed on pass ${passIndex}: ${passSpeedApplied}`,
        );
      }

      const filterParts: string[] = [
        `aformat=sample_fmts=fltp:sample_rates=${AUDIO_SAMPLE_RATE}:channel_layouts=stereo`,
      ];

      if (Math.abs(passSpeedApplied - 1) > 1e-9) {
        filterParts.push(buildAtempoChain(passSpeedApplied));
      }

      filterParts.push('asetpts=N/SR/TB');

      const passOutputPath = makeTempPath(
        `${outputPrefix}_${videoId}_${sceneId}_pass_${passIndex}`,
        'wav',
      );

      await runCommand(
        'ffmpeg',
        [
          '-y',
          '-i',
          currentPath,
          '-vn',
          '-map_metadata',
          '-1',
          '-map_chapters',
          '-1',
          '-filter_complex',
          `[0:a]${filterParts.join(',')}[aout]`,
          '-map',
          '[aout]',
          '-c:a',
          'pcm_s16le',
          '-ar',
          String(AUDIO_SAMPLE_RATE),
          '-ac',
          String(AUDIO_CHANNELS),
          passOutputPath,
        ],
        DEFAULT_FFMPEG_TIMEOUT_MS,
      );

      await access(passOutputPath);
      const passMetrics = await probeAudioMetrics(passOutputPath);

      generatedPassPaths.push(passOutputPath);
      cumulativeSpeedApplied *= passSpeedApplied;

      const previousSamples = currentSamples;

      if (currentPath !== inputPath) {
        await safeUnlink(currentPath);
      }

      currentPath = passOutputPath;
      currentSamples = passMetrics.sampleCount;
      currentSampleRate = passMetrics.sampleRate;

      if (currentSamples === previousSamples) {
        break;
      }
    }
  } catch (error) {
    for (const generatedPath of generatedPassPaths) {
      if (generatedPath !== currentPath) {
        await safeUnlink(generatedPath);
      }
    }
    throw error;
  }

  return {
    localPath: currentPath,
    outputDurationSec: roundDurationSeconds(
      samplesToSeconds(currentSamples, currentSampleRate),
    ),
    outputSamples: currentSamples,
    speedApplied: cumulativeSpeedApplied,
  };
}

async function fitSceneAudioToDurationLocal(options: {
  sceneId: number;
  videoId: number;
  inputAudioUrl: string;
  targetDurationSec: number;
}): Promise<{
  localPath: string;
  inputDurationSec: number;
  outputDurationSec: number;
  speedApplied: number;
}> {
  const { sceneId, videoId, inputAudioUrl, targetDurationSec } = options;
  const normalizedTargetDurationSec = roundDurationSeconds(targetDurationSec);
  const targetSamples = secondsToSamples(
    normalizedTargetDurationSec,
    AUDIO_SAMPLE_RATE,
  );

  const cleanupPaths = new Set<string>();

  try {
    const normalizedInputPath = await normalizeAudioToWavLocal({
      sceneId,
      videoId,
      inputAudioUrl,
    });
    cleanupPaths.add(normalizedInputPath);

    const inputMetrics = await probeAudioMetrics(normalizedInputPath);
    const inputDurationSec = roundDurationSeconds(
      samplesToSeconds(inputMetrics.sampleCount, inputMetrics.sampleRate),
    );

    if (!ENABLE_SCENE_DURATION_FIT) {
      cleanupPaths.delete(normalizedInputPath);
      return {
        localPath: normalizedInputPath,
        inputDurationSec,
        outputDurationSec: inputDurationSec,
        speedApplied: 1,
      };
    }

    let workingPath = normalizedInputPath;
    let cumulativeSpeedApplied = 1;

    const stageTemplates: Array<{
      outputPrefix: string;
      toleranceSamples: number;
      maxPasses: number;
    }> = [
      {
        outputPrefix: 'dubbed_en_fit_tempo_coarse',
        toleranceSamples: SCENE_COARSE_TOLERANCE_SAMPLES,
        maxPasses: SCENE_COARSE_MAX_TEMPO_PASSES,
      },
      {
        outputPrefix: 'dubbed_en_fit_tempo_fine',
        toleranceSamples: SCENE_FINE_TOLERANCE_SAMPLES,
        maxPasses: SCENE_FINE_MAX_TEMPO_PASSES,
      },
      {
        outputPrefix: 'dubbed_en_fit_tempo_verify',
        toleranceSamples: SCENE_FINAL_TOLERANCE_SAMPLES,
        maxPasses: SCENE_VERIFY_MAX_TEMPO_PASSES,
      },
    ];

    const runTempoStages = async (
      stageVariant: string,
      desiredTargetSamples: number,
    ): Promise<{ sampleCount: number; sampleRate: number }> => {
      for (const stageTemplate of stageTemplates) {
        if (stageTemplate.maxPasses <= 0) {
          continue;
        }

        const stageResult = await tempoMatchAudioToDurationLocal({
          sceneId,
          videoId,
          inputPath: workingPath,
          targetSamples: desiredTargetSamples,
          outputPrefix: `${stageTemplate.outputPrefix}_${stageVariant}`,
          toleranceSamples: stageTemplate.toleranceSamples,
          maxPasses: stageTemplate.maxPasses,
        });

        cumulativeSpeedApplied *= stageResult.speedApplied;

        if (stageResult.localPath !== workingPath) {
          await safeUnlink(workingPath);
          cleanupPaths.delete(workingPath);
          cleanupPaths.add(stageResult.localPath);
          workingPath = stageResult.localPath;
        }

        if (
          Math.abs(stageResult.outputSamples - desiredTargetSamples) <=
          SCENE_FINAL_TOLERANCE_SAMPLES
        ) {
          break;
        }
      }

      const metrics = await probeAudioMetrics(workingPath);
      return {
        sampleCount: metrics.sampleCount,
        sampleRate: metrics.sampleRate,
      };
    };

    if (inputMetrics.sampleCount < targetSamples) {
      const silenceSamples = targetSamples - inputMetrics.sampleCount;
      const withSilencePath = await appendSilenceToAudioLocal({
        sceneId,
        videoId,
        inputPath: workingPath,
        silenceSamples,
      });
      cleanupPaths.add(withSilencePath);

      if (withSilencePath !== workingPath) {
        await safeUnlink(workingPath);
        cleanupPaths.delete(workingPath);
        workingPath = withSilencePath;
      }

      await runTempoStages('after-shorter-silence', targetSamples);
    } else if (inputMetrics.sampleCount > targetSamples) {
      const adaptiveUndershoot = computeAdaptiveUndershootSamples({
        overageSamples: inputMetrics.sampleCount - targetSamples,
        sampleRate: inputMetrics.sampleRate,
        targetSamples,
      });

      const undershootTargetSamples = Math.max(
        SCENE_FINAL_TOLERANCE_SAMPLES,
        targetSamples - adaptiveUndershoot.undershootSamples,
      );

      let postUndershootMetrics = await runTempoStages(
        'longer-adaptive-undershoot',
        undershootTargetSamples,
      );

      if (postUndershootMetrics.sampleCount >= targetSamples) {
        postUndershootMetrics = await runTempoStages(
          'longer-adaptive-fallback-exact',
          targetSamples,
        );
      }

      if (postUndershootMetrics.sampleCount < targetSamples) {
        const silenceSamples =
          targetSamples - postUndershootMetrics.sampleCount;
        const withSilencePath = await appendSilenceToAudioLocal({
          sceneId,
          videoId,
          inputPath: workingPath,
          silenceSamples,
        });
        cleanupPaths.add(withSilencePath);

        if (withSilencePath !== workingPath) {
          await safeUnlink(workingPath);
          cleanupPaths.delete(workingPath);
          workingPath = withSilencePath;
        }
      }
    }

    const finalMetrics = await probeAudioMetrics(workingPath);
    const outputDurationSec = roundDurationSeconds(
      samplesToSeconds(finalMetrics.sampleCount, finalMetrics.sampleRate),
    );

    cleanupPaths.delete(workingPath);

    return {
      localPath: workingPath,
      inputDurationSec,
      outputDurationSec,
      speedApplied: cumulativeSpeedApplied,
    };
  } catch (error) {
    for (const filePath of cleanupPaths) {
      await safeUnlink(filePath);
    }
    throw error;
  }
}

async function createSilenceAudioToDurationLocal(options: {
  sceneId: number;
  videoId: number;
  targetDurationSec: number;
}): Promise<{
  localPath: string;
  inputDurationSec: number;
  outputDurationSec: number;
  speedApplied: number;
}> {
  const { sceneId, videoId, targetDurationSec } = options;
  const roundedTargetDurationSec = roundDurationSeconds(targetDurationSec);

  if (
    !Number.isFinite(roundedTargetDurationSec) ||
    roundedTargetDurationSec <= 0
  ) {
    throw new Error(
      `Invalid target duration for silence generation: ${targetDurationSec}`,
    );
  }

  const targetSamples = secondsToSamples(
    roundedTargetDurationSec,
    AUDIO_SAMPLE_RATE,
  );
  const sampleAlignedTargetDurationSec = roundDurationSeconds(
    samplesToSeconds(targetSamples, AUDIO_SAMPLE_RATE),
  );

  const outputPath = makeTempPath(
    `video_${videoId}_scene_${sceneId}_dubbed_en_silence_local`,
    'wav',
  );

  await runCommand(
    'ffmpeg',
    [
      '-y',
      '-f',
      'lavfi',
      '-i',
      `anullsrc=sample_rate=${AUDIO_SAMPLE_RATE}:channel_layout=stereo`,
      '-vn',
      '-map_metadata',
      '-1',
      '-map_chapters',
      '-1',
      '-filter_complex',
      `[0:a]aformat=sample_fmts=fltp:sample_rates=${AUDIO_SAMPLE_RATE}:channel_layouts=stereo,atrim=0:${formatSeconds(sampleAlignedTargetDurationSec)},asetpts=N/SR/TB[aout]`,
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
  const outputDurationSec = await probeMediaDurationSeconds(outputPath);

  return {
    localPath: outputPath,
    inputDurationSec: sampleAlignedTargetDurationSec,
    outputDurationSec,
    speedApplied: 1,
  };
}

async function concatenateAudiosLocal(
  inputPaths: string[],
  videoId: number,
): Promise<string> {
  if (inputPaths.length === 0) {
    throw new Error('No scene dubbed audios to merge');
  }

  const outputPath = makeTempPath(
    `video_${videoId}_dubbed_en_merged_local`,
    'wav',
  );

  const inputArgs = inputPaths.flatMap((filePath) => ['-i', filePath]);
  const concatInputPads = inputPaths.map((_, index) => `[${index}:a]`).join('');
  const filterComplex = `${concatInputPads}concat=n=${inputPaths.length}:v=0:a=1,aformat=sample_fmts=fltp:sample_rates=${AUDIO_SAMPLE_RATE}:channel_layouts=stereo[aout]`;

  await runCommand(
    'ffmpeg',
    [
      '-y',
      ...inputArgs,
      '-vn',
      '-map_metadata',
      '-1',
      '-map_chapters',
      '-1',
      '-filter_complex',
      filterComplex,
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

export async function POST(request: NextRequest) {
  const tempFiles: string[] = [];

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

    let token = await getJWTToken();

    let videoRow: BaserowRow;
    try {
      videoRow = await fetchVideoRowById(baserowUrl, token, videoId);
    } catch (error) {
      if (isBaserowAuthError(error)) {
        console.warn(
          `[create-dubbed-en] Baserow auth expired while loading video ${videoId}. Refreshing token and retrying once...`,
        );

        token = await getJWTToken(true);
        videoRow = await fetchVideoRowById(baserowUrl, token, videoId);
      } else if (isTransientBaserowError(error)) {
        console.warn(
          `[create-dubbed-en] Transient Baserow error while loading video ${videoId}. Retrying once...`,
        );

        videoRow = await fetchVideoRowById(baserowUrl, token, videoId);
      } else {
        throw error;
      }
    }
    const uploadedVideoDurationSecRaw = parsePositiveNumber(
      videoRow[VIDEO_UPLOADED_DURATION_FIELD_KEY],
    );

    if (!uploadedVideoDurationSecRaw) {
      return NextResponse.json(
        {
          error: `Video ${videoId} is missing valid Uploaded Video Duration (${VIDEO_UPLOADED_DURATION_FIELD_KEY})`,
        },
        { status: 400 },
      );
    }

    const uploadedVideoDurationSec = roundDurationSeconds(
      uploadedVideoDurationSecRaw,
    );
    const uploadedVideoDurationSamples = secondsToSamples(
      uploadedVideoDurationSec,
      AUDIO_SAMPLE_RATE,
    );

    let scenesRaw: BaserowRow[];
    try {
      scenesRaw = await fetchAllScenesForVideo(baserowUrl, token, videoId);
    } catch (error) {
      if (isBaserowAuthError(error)) {
        console.warn(
          `[create-dubbed-en] Baserow auth expired while loading scenes for video ${videoId}. Refreshing token and retrying once...`,
        );

        token = await getJWTToken(true);
        scenesRaw = await fetchAllScenesForVideo(baserowUrl, token, videoId);
      } else if (isTransientBaserowError(error)) {
        console.warn(
          `[create-dubbed-en] Transient Baserow error while loading scenes for video ${videoId}. Retrying once...`,
        );

        scenesRaw = await fetchAllScenesForVideo(baserowUrl, token, videoId);
      } else {
        throw error;
      }
    }

    if (scenesRaw.length === 0) {
      return NextResponse.json(
        { error: `No scenes found for video ${videoId}` },
        { status: 404 },
      );
    }

    const sortedScenes = [...scenesRaw].sort(
      (a, b) => getSceneOrderValue(a) - getSceneOrderValue(b),
    );

    const validationErrors: string[] = [];
    const sceneJobs: SceneJob[] = [];

    for (const scene of sortedScenes) {
      const sceneId = parsePositiveInt(scene.id);
      const orderValue = getSceneOrderValue(scene);

      if (!sceneId) {
        validationErrors.push('Encountered a scene with invalid ID');
        continue;
      }

      const targetDurationSec = parsePositiveNumber(
        scene[SCENE_DURATION_FIELD_KEY],
      );
      if (!targetDurationSec) {
        validationErrors.push(
          `Scene ${sceneId} is missing valid Duration (${SCENE_DURATION_FIELD_KEY})`,
        );
        continue;
      }

      const existingDubbedEnUrl = extractUrl(scene[SCENE_DUBBED_EN_FIELD_KEY]);
      if (existingDubbedEnUrl) {
        sceneJobs.push({
          sceneId,
          orderValue,
          audioUrl: existingDubbedEnUrl,
          source: 'existing',
          targetDurationSec,
        });
        continue;
      }

      const audioUrl = extractUrl(scene[SCENE_TTS_FIELD_KEY]);
      const isEmptyScene = isSceneEmptyForDub(scene);

      if (!audioUrl) {
        if (isEmptyScene) {
          sceneJobs.push({
            sceneId,
            orderValue,
            audioUrl: null,
            source: 'silence',
            targetDurationSec,
          });
          continue;
        }

        validationErrors.push(
          `Scene ${sceneId} is non-empty but missing EN TTS audio (${SCENE_TTS_FIELD_KEY})`,
        );
        continue;
      }

      sceneJobs.push({
        sceneId,
        orderValue,
        audioUrl,
        source: 'tts',
        targetDurationSec,
      });
    }

    if (validationErrors.length > 0) {
      return NextResponse.json(
        {
          error:
            'Cannot start dubbing batch because some non-empty scenes are missing required fields',
          details: validationErrors,
        },
        { status: 400 },
      );
    }

    const sceneResults: SceneProcessResult[] = [];

    for (const job of sceneJobs) {
      if (job.source === 'existing') {
        const existingDubbedEnUrl = job.audioUrl || '';
        const sampleCount = secondsToSamples(
          job.targetDurationSec,
          AUDIO_SAMPLE_RATE,
        );
        const durationSec = roundDurationSeconds(
          samplesToSeconds(sampleCount, AUDIO_SAMPLE_RATE),
        );

        sceneResults.push({
          sceneId: job.sceneId,
          orderValue: job.orderValue,
          source: 'existing',
          targetDurationSec: job.targetDurationSec,
          inputDurationSec: durationSec,
          outputDurationSec: durationSec,
          outputSampleCount: sampleCount,
          speedApplied: 1,
          dubbedEnUrl: existingDubbedEnUrl,
          localAdjustedPath: existingDubbedEnUrl,
        });
        continue;
      }

      const fitted =
        job.source === 'silence'
          ? await createSilenceAudioToDurationLocal({
              sceneId: job.sceneId,
              videoId,
              targetDurationSec: job.targetDurationSec,
            })
          : await fitSceneAudioToDurationLocal({
              sceneId: job.sceneId,
              videoId,
              inputAudioUrl: job.audioUrl || '',
              targetDurationSec: job.targetDurationSec,
            });

      tempFiles.push(fitted.localPath);

      const fittedMetrics = await probeAudioMetrics(fitted.localPath);

      const sceneFilename =
        job.source === 'silence'
          ? `video_${videoId}_scene_${job.sceneId}_dubbed_en_silence_${Date.now()}.wav`
          : `video_${videoId}_scene_${job.sceneId}_dubbed_en_${Date.now()}.wav`;
      const dubbedEnUrl = await uploadToMinio(
        fitted.localPath,
        sceneFilename,
        'audio/wav',
      );

      token = await patchSceneDubbedEnWithAuthRetry({
        baserowUrl,
        token,
        sceneId: job.sceneId,
        dubbedEnUrl,
      });

      sceneResults.push({
        sceneId: job.sceneId,
        orderValue: job.orderValue,
        source: job.source,
        targetDurationSec: job.targetDurationSec,
        inputDurationSec: fitted.inputDurationSec,
        outputDurationSec: fittedMetrics.durationSec,
        outputSampleCount: fittedMetrics.sampleCount,
        speedApplied: fitted.speedApplied,
        dubbedEnUrl,
        localAdjustedPath: fitted.localPath,
      });
    }

    const expectedMergedSamples = sceneResults.reduce(
      (sum, item) => sum + item.outputSampleCount,
      0,
    );

    if (
      !Number.isInteger(expectedMergedSamples) ||
      expectedMergedSamples <= 0
    ) {
      return NextResponse.json(
        {
          error: 'Unable to determine expected merged sample count',
        },
        { status: 500 },
      );
    }

    const expectedMergedDurationSec = roundDurationSeconds(
      samplesToSeconds(expectedMergedSamples, AUDIO_SAMPLE_RATE),
    );

    let mergedLocalPath = await concatenateAudiosLocal(
      sceneResults
        .sort((a, b) => a.orderValue - b.orderValue)
        .map((result) => result.localAdjustedPath),
      videoId,
    );

    if (!tempFiles.includes(mergedLocalPath)) {
      tempFiles.push(mergedLocalPath);
    }

    const mergedCorrectionResult =
      await fitMergedAudioToTargetDurationWithPadTrimLocal({
        inputPath: mergedLocalPath,
        videoId,
        targetDurationSec: uploadedVideoDurationSec,
      });

    mergedLocalPath = mergedCorrectionResult.localPath;

    if (!tempFiles.includes(mergedLocalPath)) {
      tempFiles.push(mergedLocalPath);
    }

    const mergedMetrics = await probeAudioMetrics(mergedLocalPath);

    const finalFilename = `video_${videoId}_final_dubbed_audio_${Date.now()}.wav`;
    const finalDubbedAudioUrl = await uploadToMinio(
      mergedLocalPath,
      finalFilename,
      'audio/wav',
    );

    token = await patchFinalDubbedEnWithAuthRetry({
      baserowUrl,
      token,
      videoId,
      finalDubbedAudioUrl,
    });

    return NextResponse.json({
      ok: true,
      videoId,
      processedSceneCount: sceneResults.length,
      skippedExistingSceneCount: sceneResults.filter(
        (s) => s.source === 'existing',
      ).length,
      silenceSceneCount: sceneResults.filter((s) => s.source === 'silence')
        .length,
      ttsSceneCount: sceneResults.filter((s) => s.source === 'tts').length,
      sceneDubbedField: SCENE_DUBBED_EN_FIELD_KEY,
      finalDubbedField: VIDEO_FINAL_DUBBED_AUDIO_FIELD_KEY,
      expectedMergedSamples,
      expectedMergedDurationSec,
      uploadedVideoDurationField: VIDEO_UPLOADED_DURATION_FIELD_KEY,
      uploadedVideoDurationSec,
      uploadedVideoDurationSamples,
      mergedOutputSamples: mergedMetrics.sampleCount,
      mergedOutputDurationSec: mergedMetrics.durationSec,
      mergedOutputDeltaSamples:
        mergedMetrics.sampleCount - expectedMergedSamples,
      mergedOutputDeltaSamplesToUploadedVideo:
        mergedMetrics.sampleCount - uploadedVideoDurationSamples,
      mergeCorrectionMode: mergedCorrectionResult.correctionMode,
      mergeCorrectionPasses: mergedCorrectionResult.correctionPasses,
      sceneDurationFitApplied: ENABLE_SCENE_DURATION_FIT,
      finalDubbedAudioUrl,
      scenes: sceneResults
        .sort((a, b) => a.orderValue - b.orderValue)
        .map((sceneResult) => ({
          sceneId: sceneResult.sceneId,
          orderValue: sceneResult.orderValue,
          source: sceneResult.source,
          targetDurationSec: sceneResult.targetDurationSec,
          inputDurationSec: sceneResult.inputDurationSec,
          outputDurationSec: sceneResult.outputDurationSec,
          outputSampleCount: sceneResult.outputSampleCount,
          speedApplied: sceneResult.speedApplied,
          dubbedEnUrl: sceneResult.dubbedEnUrl,
        })),
    });
  } catch (error) {
    console.error('[create-dubbed-en] error:', error);
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 },
    );
  } finally {
    for (const filePath of tempFiles) {
      await safeUnlink(filePath);
    }
  }
}
