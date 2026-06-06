import { NextRequest, NextResponse } from 'next/server';
import { spawn } from 'child_process';
import path from 'path';
import { access, unlink } from 'fs/promises';
import { uploadToMinio } from '@/utils/ffmpeg-direct';
import { getBaserowToken, buildAuthHeader } from '@/lib/baserow-auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 900;

const VIDEOS_TABLE_ID = '713';
const SCENES_TABLE_ID = '714';
const SCENE_VIDEO_LINK_FIELD_KEY = 'field_6889';
const FIELD_KEY_REGEX = /^field_\d+$/;

const AUDIO_SAMPLE_RATE = 48000;
const AUDIO_CHANNELS = 2;
const TIME_DECIMALS = 9;
const DEFAULT_FFMPEG_TIMEOUT_MS = 10 * 60 * 1000;
const DEFAULT_FFPROBE_TIMEOUT_MS = 2 * 60 * 1000;
const MERGE_ALIGNMENT_MAX_PASSES = 4;

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

type SceneMergeJob = {
  sceneId: number;
  orderValue: number;
  audioUrl: string;
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

function asFieldKey(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!FIELD_KEY_REGEX.test(trimmed)) return null;
  return trimmed;
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

  const sampleCandidates: number[] = [];

  const nbSamples = parsePositiveRoundedInt(audioStream?.nb_samples);
  if (nbSamples) {
    sampleCandidates.push(nbSamples);
  }

  const durationTs = parseNumberish(audioStream?.duration_ts);
  const timeBase = parseTimeBase(audioStream?.time_base);
  if (Number.isFinite(durationTs) && durationTs > 0 && timeBase) {
    const durationFromTsSec = durationTs * timeBase;
    if (Number.isFinite(durationFromTsSec) && durationFromTsSec > 0) {
      sampleCandidates.push(secondsToSamples(durationFromTsSec, sampleRate));
    }
  }

  const streamDurationSec = parseNumberish(audioStream?.duration);
  if (Number.isFinite(streamDurationSec) && streamDurationSec > 0) {
    sampleCandidates.push(secondsToSamples(streamDurationSec, sampleRate));
  }

  const formatDurationSec = parseNumberish(parsed.format?.duration);
  if (Number.isFinite(formatDurationSec) && formatDurationSec > 0) {
    sampleCandidates.push(secondsToSamples(formatDurationSec, sampleRate));
  }

  const sampleCount =
    sampleCandidates.length > 0 ? Math.max(...sampleCandidates) : Number.NaN;
  if (!Number.isFinite(sampleCount) || sampleCount <= 0) {
    throw new Error('Unable to determine media duration via ffprobe');
  }

  const durationSec = roundDurationSeconds(
    samplesToSeconds(Math.round(sampleCount), sampleRate),
  );

  return {
    durationSec,
    sampleRate,
    sampleCount: Math.round(sampleCount),
  };
}

async function normalizeAudioToWavLocal(options: {
  sceneId: number;
  videoId: number;
  inputAudioUrl: string;
}): Promise<{ localPath: string; metrics: AudioProbeMetrics }> {
  const { sceneId, videoId, inputAudioUrl } = options;

  const outputPath = makeTempPath(
    `video_${videoId}_scene_${sceneId}_merge_normalized`,
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
  const metrics = await probeAudioMetrics(outputPath);

  return {
    localPath: outputPath,
    metrics,
  };
}

async function concatenateAudiosLocal(
  inputPaths: string[],
  videoId: number,
): Promise<string> {
  if (inputPaths.length === 0) {
    throw new Error('No scene dubbed audios to merge');
  }

  if (inputPaths.length === 1) {
    return inputPaths[0];
  }

  const outputPath = makeTempPath(
    `video_${videoId}_dubbed_audio_merged`,
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

async function appendSilenceSamplesToAudioLocal(options: {
  videoId: number;
  inputPath: string;
  silenceSamples: number;
  passIndex: number;
}): Promise<string> {
  const { videoId, inputPath, silenceSamples, passIndex } = options;

  if (!Number.isInteger(silenceSamples) || silenceSamples <= 0) {
    throw new Error(`Invalid silence sample count: ${silenceSamples}`);
  }

  const silenceDurationSec = samplesToSeconds(
    silenceSamples,
    AUDIO_SAMPLE_RATE,
  );

  const outputPath = makeTempPath(
    `video_${videoId}_dubbed_audio_merged_align_pad_${passIndex}`,
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

async function trimAudioToSampleCountLocal(options: {
  videoId: number;
  inputPath: string;
  targetSamples: number;
  passIndex: number;
}): Promise<string> {
  const { videoId, inputPath, targetSamples, passIndex } = options;

  if (!Number.isInteger(targetSamples) || targetSamples <= 0) {
    throw new Error(`Invalid target sample count: ${targetSamples}`);
  }

  const targetDurationSec = samplesToSeconds(targetSamples, AUDIO_SAMPLE_RATE);

  const outputPath = makeTempPath(
    `video_${videoId}_dubbed_audio_merged_align_trim_${passIndex}`,
    'wav',
  );

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
      `[0:a]aformat=sample_fmts=fltp:sample_rates=${AUDIO_SAMPLE_RATE}:channel_layouts=stereo,atrim=0:${formatSeconds(targetDurationSec)},asetpts=N/SR/TB[aout]`,
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

async function alignMergedAudioToExpectedSamplesLocal(options: {
  videoId: number;
  inputPath: string;
  expectedSamples: number;
}): Promise<{
  localPath: string;
  finalMetrics: AudioProbeMetrics;
  finalDeltaSamples: number;
  correctionPasses: number;
}> {
  const { videoId, inputPath, expectedSamples } = options;

  if (!Number.isInteger(expectedSamples) || expectedSamples <= 0) {
    throw new Error(`Invalid expected sample count: ${expectedSamples}`);
  }

  let currentPath = inputPath;
  let correctionPasses = 0;

  for (
    let passIndex = 1;
    passIndex <= MERGE_ALIGNMENT_MAX_PASSES;
    passIndex += 1
  ) {
    const metrics = await probeAudioMetrics(currentPath);
    const deltaSamples = metrics.sampleCount - expectedSamples;

    if (deltaSamples === 0) {
      return {
        localPath: currentPath,
        finalMetrics: metrics,
        finalDeltaSamples: 0,
        correctionPasses,
      };
    }

    const nextPath =
      deltaSamples < 0
        ? await appendSilenceSamplesToAudioLocal({
            videoId,
            inputPath: currentPath,
            silenceSamples: Math.abs(deltaSamples),
            passIndex,
          })
        : await trimAudioToSampleCountLocal({
            videoId,
            inputPath: currentPath,
            targetSamples: expectedSamples,
            passIndex,
          });

    correctionPasses += 1;

    if (currentPath !== inputPath) {
      await safeUnlink(currentPath);
    }

    currentPath = nextPath;
  }

  const finalMetrics = await probeAudioMetrics(currentPath);
  const finalDeltaSamples = finalMetrics.sampleCount - expectedSamples;

  return {
    localPath: currentPath,
    finalMetrics,
    finalDeltaSamples,
    correctionPasses,
  };
}

async function baserowGetJson<T>(
  baserowUrl: string,
  token: string,
  pathName: string,
): Promise<T> {
  const response = await fetch(`${baserowUrl}${pathName}`, {
    method: 'GET',
    headers: {
      ...buildAuthHeader(token),
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
        ...buildAuthHeader(token),
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

async function patchVideoAudioWithAuthRetry(options: {
  baserowUrl: string;
  token: string;
  videoId: number;
  destinationVideoAudioFieldKey: string;
  audioUrl: string;
}): Promise<string> {
  const {
    baserowUrl,
    token,
    videoId,
    destinationVideoAudioFieldKey,
    audioUrl,
  } = options;

  const patchPayload = {
    [destinationVideoAudioFieldKey]: audioUrl,
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
    if (!isBaserowAuthError(error)) {
      throw error;
    }

    console.warn(
      `[merge-dubbed-audio-by-field] Baserow auth expired while saving video ${videoId}. Refreshing token and retrying once...`,
    );

    const refreshedToken = await getBaserowToken(true);
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

export async function POST(request: NextRequest) {
  const tempFiles: string[] = [];

  try {
    const body = (await request.json().catch(() => null)) as {
      videoId?: unknown;
      sourceSceneAudioFieldKey?: unknown;
      destinationVideoAudioFieldKey?: unknown;
      sceneDurationFieldKey?: unknown;
      requireAudioForDurationScenes?: unknown;
      skipIfDestinationExists?: unknown;
      language?: unknown;
    } | null;

    const videoId = parsePositiveInt(body?.videoId);
    if (!videoId) {
      return NextResponse.json(
        { error: 'videoId must be a positive integer' },
        { status: 400 },
      );
    }

    const sourceSceneAudioFieldKey = asFieldKey(body?.sourceSceneAudioFieldKey);
    if (!sourceSceneAudioFieldKey) {
      return NextResponse.json(
        {
          error:
            'sourceSceneAudioFieldKey is required and must be a Baserow field key (e.g., field_7111)',
        },
        { status: 400 },
      );
    }

    const destinationVideoAudioFieldKey = asFieldKey(
      body?.destinationVideoAudioFieldKey,
    );
    if (!destinationVideoAudioFieldKey) {
      return NextResponse.json(
        {
          error:
            'destinationVideoAudioFieldKey is required and must be a Baserow field key (e.g., field_7113)',
        },
        { status: 400 },
      );
    }

    const sceneDurationFieldKeyRaw = body?.sceneDurationFieldKey;
    const hasSceneDurationFieldKeyInput =
      sceneDurationFieldKeyRaw !== undefined &&
      sceneDurationFieldKeyRaw !== null &&
      !(
        typeof sceneDurationFieldKeyRaw === 'string' &&
        sceneDurationFieldKeyRaw.trim().length === 0
      );

    const sceneDurationFieldKey = hasSceneDurationFieldKeyInput
      ? asFieldKey(sceneDurationFieldKeyRaw)
      : null;

    if (hasSceneDurationFieldKeyInput && !sceneDurationFieldKey) {
      return NextResponse.json(
        {
          error:
            'sceneDurationFieldKey must be a Baserow field key (e.g., field_6884) when provided',
        },
        { status: 400 },
      );
    }

    const requireAudioForDurationScenes = parseBoolean(
      body?.requireAudioForDurationScenes,
      true,
    );
    const skipIfDestinationExists = parseBoolean(
      body?.skipIfDestinationExists,
      false,
    );

    const baserowUrl = process.env.BASEROW_API_URL;
    if (!baserowUrl) {
      return NextResponse.json(
        { error: 'Missing BASEROW_API_URL' },
        { status: 500 },
      );
    }

    let token = await getBaserowToken();

    let videoRow: BaserowRow;
    try {
      videoRow = await baserowGetJson<BaserowRow>(
        baserowUrl,
        token,
        `/database/rows/table/${VIDEOS_TABLE_ID}/${videoId}/`,
      );
    } catch (error) {
      if (!isBaserowAuthError(error)) {
        throw error;
      }

      token = await getBaserowToken(true);
      videoRow = await baserowGetJson<BaserowRow>(
        baserowUrl,
        token,
        `/database/rows/table/${VIDEOS_TABLE_ID}/${videoId}/`,
      );
    }

    const existingDestinationAudioUrl = extractUrl(
      videoRow[destinationVideoAudioFieldKey],
    );

    if (skipIfDestinationExists && existingDestinationAudioUrl) {
      return NextResponse.json({
        ok: true,
        skippedExistingDestinationAudio: true,
        videoId,
        destinationVideoAudioFieldKey,
        existingDestinationAudioUrl,
      });
    }

    let scenes: BaserowRow[];
    try {
      scenes = await fetchAllScenesForVideo(baserowUrl, token, videoId);
    } catch (error) {
      if (!isBaserowAuthError(error)) {
        throw error;
      }

      token = await getBaserowToken(true);
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

    const mergeJobs: SceneMergeJob[] = [];
    const missingAudioSceneIds: number[] = [];
    let skippedInvalidSceneIdCount = 0;
    let skippedNoDurationCount = 0;
    let skippedNoAudioCount = 0;

    for (const scene of orderedScenes) {
      const sceneId = parsePositiveInt(scene.id);
      if (!sceneId) {
        skippedInvalidSceneIdCount += 1;
        continue;
      }

      if (sceneDurationFieldKey) {
        const durationSec = parsePositiveNumber(scene[sceneDurationFieldKey]);
        if (!durationSec) {
          skippedNoDurationCount += 1;
          continue;
        }
      }

      const audioUrl = extractUrl(scene[sourceSceneAudioFieldKey]);
      if (!audioUrl) {
        if (requireAudioForDurationScenes) {
          missingAudioSceneIds.push(sceneId);
        } else {
          skippedNoAudioCount += 1;
        }
        continue;
      }

      mergeJobs.push({
        sceneId,
        orderValue: getSceneOrderValue(scene),
        audioUrl,
      });
    }

    if (missingAudioSceneIds.length > 0) {
      return NextResponse.json(
        {
          error:
            'Some required scenes are missing dubbed audio URL and cannot be merged',
          sourceSceneAudioFieldKey,
          missingAudioSceneCount: missingAudioSceneIds.length,
          missingAudioSceneIds: missingAudioSceneIds.slice(0, 100),
        },
        { status: 400 },
      );
    }

    if (mergeJobs.length === 0) {
      return NextResponse.json(
        {
          error:
            'No scene audio URLs available to merge after applying current filters',
          sourceSceneAudioFieldKey,
          sceneDurationFieldKey,
          skippedInvalidSceneIdCount,
          skippedNoDurationCount,
          skippedNoAudioCount,
        },
        { status: 400 },
      );
    }

    let expectedMergedSamples = 0;
    const normalizedSceneInfos: Array<{
      sceneId: number;
      orderValue: number;
      sampleCount: number;
      durationSec: number;
      localPath: string;
    }> = [];

    for (const job of mergeJobs) {
      const normalized = await normalizeAudioToWavLocal({
        sceneId: job.sceneId,
        videoId,
        inputAudioUrl: job.audioUrl,
      });

      tempFiles.push(normalized.localPath);
      expectedMergedSamples += normalized.metrics.sampleCount;
      normalizedSceneInfos.push({
        sceneId: job.sceneId,
        orderValue: job.orderValue,
        sampleCount: normalized.metrics.sampleCount,
        durationSec: normalized.metrics.durationSec,
        localPath: normalized.localPath,
      });
    }

    const mergedLocalPath = await concatenateAudiosLocal(
      normalizedSceneInfos
        .sort((a, b) => a.orderValue - b.orderValue)
        .map((item) => item.localPath),
      videoId,
    );

    if (!tempFiles.includes(mergedLocalPath)) {
      tempFiles.push(mergedLocalPath);
    }

    const alignedMerged = await alignMergedAudioToExpectedSamplesLocal({
      videoId,
      inputPath: mergedLocalPath,
      expectedSamples: expectedMergedSamples,
    });

    if (!tempFiles.includes(alignedMerged.localPath)) {
      tempFiles.push(alignedMerged.localPath);
    }

    const languageSuffix =
      typeof body?.language === 'string' && body.language.trim()
        ? `${body.language.trim()}_`
        : '';
    const finalFilename = `video_${videoId}_merged_${languageSuffix}${sourceSceneAudioFieldKey}_${Date.now()}.wav`;
    const finalDubbedAudioUrl = await uploadToMinio(
      alignedMerged.localPath,
      finalFilename,
      'audio/wav',
    );

    token = await patchVideoAudioWithAuthRetry({
      baserowUrl,
      token,
      videoId,
      destinationVideoAudioFieldKey,
      audioUrl: finalDubbedAudioUrl,
    });

    const expectedMergedDurationSec = roundDurationSeconds(
      samplesToSeconds(expectedMergedSamples, AUDIO_SAMPLE_RATE),
    );

    return NextResponse.json({
      ok: true,
      videoId,
      sourceSceneAudioFieldKey,
      destinationVideoAudioFieldKey,
      sceneDurationFieldKey,
      mergedSceneCount: mergeJobs.length,
      skippedInvalidSceneIdCount,
      skippedNoDurationCount,
      skippedNoAudioCount,
      expectedMergedSamples,
      expectedMergedDurationSec,
      mergedOutputSamples: alignedMerged.finalMetrics.sampleCount,
      mergedOutputDurationSec: alignedMerged.finalMetrics.durationSec,
      mergedOutputDeltaSamples: alignedMerged.finalDeltaSamples,
      mergeCorrectionPasses: alignedMerged.correctionPasses,
      finalDubbedAudioUrl,
    });
  } catch (error) {
    console.error('[merge-dubbed-audio-by-field] error:', error);
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
