import { NextRequest, NextResponse } from 'next/server';
import { Agent } from 'undici';
import { spawn } from 'child_process';
import path from 'path';
import { access, unlink } from 'fs/promises';
import { uploadToMinio } from '@/utils/ffmpeg-direct';

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

const AUDIO_SAMPLE_RATE = 48000;
const AUDIO_CHANNELS = 2;
const TIME_DECIMALS = 6;
const SPEED_DECIMALS = 12;
const DEFAULT_FFMPEG_TIMEOUT_MS = 10 * 60 * 1000;
const DEFAULT_FFPROBE_TIMEOUT_MS = 2 * 60 * 1000;
const SCENE_DURATION_TOLERANCE_SEC = 1 / AUDIO_SAMPLE_RATE;
const SCENE_MAX_TEMPO_PASSES = 10;
const SCENE_COARSE_TOLERANCE_SAMPLES = 8;
const SCENE_FINE_TOLERANCE_SAMPLES = 2;
const SCENE_FINAL_TOLERANCE_SAMPLES = 1;
const SCENE_COARSE_MAX_TEMPO_PASSES = 8;
const SCENE_FINE_MAX_TEMPO_PASSES = 8;
const SCENE_VERIFY_MAX_TEMPO_PASSES = 4;
const SAVE_FITTED_AUDIO_AS_WAV = true;
const FIT_DEBUG_LOGS = false;
const LONGER_ADAPTIVE_UNDERSHOOT_MIN_SEC = 0.02;
const LONGER_ADAPTIVE_UNDERSHOOT_MAX_SEC = 0.12;
const LONGER_ADAPTIVE_UNDERSHOOT_RATIO = 0.35;

type TtsProvider = 'chatterbox' | 'fish-s2-pro' | 'omnivoice';
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

type SceneTtsFailure = {
  sceneId: number;
  error: string;
};

function logFitInfo(event: string, details?: Record<string, unknown>): void {
  if (!FIT_DEBUG_LOGS) return;
  if (details) {
    console.log(`[fit-debug] ${event}`, details);
    return;
  }
  console.log(`[fit-debug] ${event}`);
}

function logFitError(event: string, details?: Record<string, unknown>): void {
  if (!FIT_DEBUG_LOGS) return;
  if (details) {
    console.error(`[fit-debug] ${event}`, details);
    return;
  }
  console.error(`[fit-debug] ${event}`);
}

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
}): Promise<string> {
  const { sceneId, videoId, inputAudioUrl } = options;
  const startedAt = Date.now();

  logFitInfo('normalizeAudioToWavLocal:start', {
    sceneId,
    videoId,
    inputAudioUrl,
    sampleRate: AUDIO_SAMPLE_RATE,
    channels: AUDIO_CHANNELS,
  });

  const outputPath = makeTempPath(
    `video_${videoId}_scene_${sceneId}_dubbed_fit_normalized`,
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

  logFitInfo('normalizeAudioToWavLocal:done', {
    sceneId,
    videoId,
    outputPath,
    elapsedMs: Date.now() - startedAt,
  });

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
  const startedAt = Date.now();

  logFitInfo('appendSilenceToAudioLocal:start', {
    sceneId,
    videoId,
    inputPath,
    silenceSamples,
    silenceDurationSec: roundDurationSeconds(silenceDurationSec),
  });

  const outputPath = makeTempPath(
    `video_${videoId}_scene_${sceneId}_dubbed_fit_silence`,
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

  logFitInfo('appendSilenceToAudioLocal:done', {
    sceneId,
    videoId,
    outputPath,
    elapsedMs: Date.now() - startedAt,
  });

  return outputPath;
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
    toleranceSamples = SCENE_FINE_TOLERANCE_SAMPLES,
    maxPasses = SCENE_MAX_TEMPO_PASSES,
  } = options;

  if (!Number.isInteger(targetSamples) || targetSamples <= 0) {
    throw new Error(`Invalid target sample count: ${targetSamples}`);
  }

  const startedAt = Date.now();
  let currentPath = inputPath;
  const initialMetrics = await probeAudioMetrics(inputPath);
  let currentSamples = initialMetrics.sampleCount;
  let currentSampleRate = initialMetrics.sampleRate;
  let cumulativeSpeedApplied = 1;
  const generatedPassPaths: string[] = [];
  let executedPasses = 0;
  let stopReason = 'not-set';

  logFitInfo('tempoMatchAudioToDurationLocal:start', {
    sceneId,
    videoId,
    inputPath,
    outputPrefix,
    targetSamples,
    targetDurationSec: roundDurationSeconds(
      samplesToSeconds(targetSamples, AUDIO_SAMPLE_RATE),
    ),
    initialSamples: currentSamples,
    initialDurationSec: initialMetrics.durationSec,
    toleranceSamples,
    maxPasses,
  });

  try {
    for (let passIndex = 1; passIndex <= maxPasses; passIndex += 1) {
      const deltaSamples = currentSamples - targetSamples;
      if (Math.abs(deltaSamples) <= toleranceSamples) {
        stopReason = 'within-tolerance-before-pass';
        break;
      }

      const passSpeedApplied = currentSamples / targetSamples;
      if (!Number.isFinite(passSpeedApplied) || passSpeedApplied <= 0) {
        throw new Error(
          `Invalid scene tempo speed on pass ${passIndex}: ${passSpeedApplied}`,
        );
      }

      logFitInfo('tempoMatchAudioToDurationLocal:pass-start', {
        sceneId,
        videoId,
        outputPrefix,
        passIndex,
        currentSamples,
        currentDurationSec: roundDurationSeconds(
          samplesToSeconds(currentSamples, currentSampleRate),
        ),
        targetSamples,
        deltaSamples,
        passSpeedApplied,
      });

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
      executedPasses += 1;

      logFitInfo('tempoMatchAudioToDurationLocal:pass-done', {
        sceneId,
        videoId,
        outputPrefix,
        passIndex,
        outputPath: passOutputPath,
        outputSamples: currentSamples,
        outputDurationSec: passMetrics.durationSec,
        deltaSamplesAfterPass: currentSamples - targetSamples,
        cumulativeSpeedApplied,
      });

      if (currentSamples === previousSamples) {
        stopReason = 'sample-count-unchanged';
        break;
      }
    }

    if (stopReason === 'not-set') {
      const finalDelta = currentSamples - targetSamples;
      stopReason =
        Math.abs(finalDelta) <= toleranceSamples
          ? 'within-tolerance-after-pass'
          : executedPasses >= maxPasses
            ? 'max-passes-reached'
            : 'loop-complete';
    }
  } catch (error) {
    logFitError('tempoMatchAudioToDurationLocal:error', {
      sceneId,
      videoId,
      outputPrefix,
      executedPasses,
      currentSamples,
      targetSamples,
      deltaSamples: currentSamples - targetSamples,
      message: error instanceof Error ? error.message : String(error),
    });

    for (const generatedPath of generatedPassPaths) {
      if (generatedPath !== currentPath) {
        await safeUnlink(generatedPath);
      }
    }
    throw error;
  }

  const finalDeltaSamples = currentSamples - targetSamples;
  const finalDurationSec = roundDurationSeconds(
    samplesToSeconds(currentSamples, currentSampleRate),
  );

  logFitInfo('tempoMatchAudioToDurationLocal:done', {
    sceneId,
    videoId,
    outputPrefix,
    executedPasses,
    stopReason,
    targetSamples,
    finalSamples: currentSamples,
    finalDeltaSamples,
    finalDurationSec,
    finalDeltaSec: roundDurationSeconds(finalDeltaSamples / currentSampleRate),
    elapsedMs: Date.now() - startedAt,
  });

  return {
    localPath: currentPath,
    outputDurationSec: finalDurationSec,
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
  const startedAt = Date.now();
  const normalizedTargetDurationSec = roundDurationSeconds(targetDurationSec);
  const targetSamples = secondsToSamples(
    normalizedTargetDurationSec,
    AUDIO_SAMPLE_RATE,
  );

  logFitInfo('fitSceneAudioToDurationLocal:start', {
    sceneId,
    videoId,
    inputAudioUrl,
    targetDurationSec: normalizedTargetDurationSec,
    targetSamples,
    method: 'wav-adaptive-undershoot-for-longer',
    stages: [
      {
        name: 'coarse',
        toleranceSamples: SCENE_COARSE_TOLERANCE_SAMPLES,
        maxPasses: SCENE_COARSE_MAX_TEMPO_PASSES,
      },
      {
        name: 'fine',
        toleranceSamples: SCENE_FINE_TOLERANCE_SAMPLES,
        maxPasses: SCENE_FINE_MAX_TEMPO_PASSES,
      },
      {
        name: 'verify',
        toleranceSamples: SCENE_FINAL_TOLERANCE_SAMPLES,
        maxPasses: SCENE_VERIFY_MAX_TEMPO_PASSES,
      },
    ],
    longerAdaptiveUndershoot: {
      minSec: LONGER_ADAPTIVE_UNDERSHOOT_MIN_SEC,
      maxSec: LONGER_ADAPTIVE_UNDERSHOOT_MAX_SEC,
      ratio: LONGER_ADAPTIVE_UNDERSHOOT_RATIO,
    },
  });

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

    let workingPath = normalizedInputPath;
    let cumulativeSpeedApplied = 1;

    const stageTemplates: Array<{
      name: string;
      outputPrefix: string;
      toleranceSamples: number;
      maxPasses: number;
    }> = [
      {
        name: 'coarse',
        outputPrefix: 'dubbed_fit_tempo_coarse',
        toleranceSamples: SCENE_COARSE_TOLERANCE_SAMPLES,
        maxPasses: SCENE_COARSE_MAX_TEMPO_PASSES,
      },
      {
        name: 'fine',
        outputPrefix: 'dubbed_fit_tempo_fine',
        toleranceSamples: SCENE_FINE_TOLERANCE_SAMPLES,
        maxPasses: SCENE_FINE_MAX_TEMPO_PASSES,
      },
      {
        name: 'verify',
        outputPrefix: 'dubbed_fit_tempo_verify',
        toleranceSamples: SCENE_FINAL_TOLERANCE_SAMPLES,
        maxPasses: SCENE_VERIFY_MAX_TEMPO_PASSES,
      },
    ];

    const runTempoStages = async (
      stageVariant: string,
      desiredTargetSamples: number,
    ): Promise<{ sampleCount: number; sampleRate: number }> => {
      let latestOutputSamples = Number.NaN;

      for (const stageTemplate of stageTemplates) {
        const stageName = `${stageTemplate.name}:${stageVariant}`;
        const stageOutputPrefix = `${stageTemplate.outputPrefix}_${stageVariant}`;

        logFitInfo('fitSceneAudioToDurationLocal:stage-start', {
          sceneId,
          videoId,
          stageName,
          stageOutputPrefix,
          stageToleranceSamples: stageTemplate.toleranceSamples,
          stageMaxPasses: stageTemplate.maxPasses,
          desiredTargetSamples,
          desiredTargetDurationSec: roundDurationSeconds(
            samplesToSeconds(desiredTargetSamples, AUDIO_SAMPLE_RATE),
          ),
          finalTargetSamples: targetSamples,
        });

        const stageResult = await tempoMatchAudioToDurationLocal({
          sceneId,
          videoId,
          inputPath: workingPath,
          targetSamples: desiredTargetSamples,
          outputPrefix: stageOutputPrefix,
          toleranceSamples: stageTemplate.toleranceSamples,
          maxPasses: stageTemplate.maxPasses,
        });

        cumulativeSpeedApplied *= stageResult.speedApplied;
        latestOutputSamples = stageResult.outputSamples;

        logFitInfo('fitSceneAudioToDurationLocal:stage-done', {
          sceneId,
          videoId,
          stageName,
          stageOutputPath: stageResult.localPath,
          stageOutputSamples: stageResult.outputSamples,
          stageOutputDurationSec: stageResult.outputDurationSec,
          stageDeltaSamplesToDesired:
            stageResult.outputSamples - desiredTargetSamples,
          stageDeltaSamplesToFinal: stageResult.outputSamples - targetSamples,
          stageSpeedApplied: stageResult.speedApplied,
          cumulativeSpeedApplied,
        });

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
          logFitInfo(
            'fitSceneAudioToDurationLocal:early-stop-final-tolerance',
            {
              sceneId,
              videoId,
              stageName,
              finalToleranceSamples: SCENE_FINAL_TOLERANCE_SAMPLES,
              currentDeltaSamplesToDesired:
                stageResult.outputSamples - desiredTargetSamples,
            },
          );
          break;
        }
      }

      const metrics = await probeAudioMetrics(workingPath);

      logFitInfo('fitSceneAudioToDurationLocal:stage-variant-done', {
        sceneId,
        videoId,
        stageVariant,
        latestOutputSamples,
        variantFinalSamples: metrics.sampleCount,
        variantFinalDurationSec: metrics.durationSec,
        variantDeltaSamplesToFinal: metrics.sampleCount - targetSamples,
      });

      return {
        sampleCount: metrics.sampleCount,
        sampleRate: metrics.sampleRate,
      };
    };

    const initialDeltaSamples = inputMetrics.sampleCount - targetSamples;
    logFitInfo('fitSceneAudioToDurationLocal:input-classification', {
      sceneId,
      videoId,
      inputSamples: inputMetrics.sampleCount,
      inputDurationSec,
      targetSamples,
      targetDurationSec: normalizedTargetDurationSec,
      deltaSamples: initialDeltaSamples,
      classification:
        initialDeltaSamples < 0
          ? 'shorter-needs-silence'
          : initialDeltaSamples > 0
            ? 'longer-needs-tempo-speedup'
            : 'exact-match',
    });

    if (inputMetrics.sampleCount < targetSamples) {
      const silenceSamples = targetSamples - inputMetrics.sampleCount;
      logFitInfo('fitSceneAudioToDurationLocal:append-silence-needed', {
        sceneId,
        videoId,
        silenceSamples,
        silenceDurationSec: roundDurationSeconds(
          samplesToSeconds(silenceSamples, AUDIO_SAMPLE_RATE),
        ),
      });

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

      logFitInfo('fitSceneAudioToDurationLocal:adaptive-undershoot-selected', {
        sceneId,
        videoId,
        overageSamples: inputMetrics.sampleCount - targetSamples,
        overageSec: roundDurationSeconds(
          (inputMetrics.sampleCount - targetSamples) / inputMetrics.sampleRate,
        ),
        undershootRatio: LONGER_ADAPTIVE_UNDERSHOOT_RATIO,
        undershootSamples: adaptiveUndershoot.undershootSamples,
        undershootSec: adaptiveUndershoot.undershootSec,
        undershootTargetSamples,
        undershootTargetDurationSec: roundDurationSeconds(
          samplesToSeconds(undershootTargetSamples, inputMetrics.sampleRate),
        ),
      });

      let postUndershootMetrics = await runTempoStages(
        'longer-adaptive-undershoot',
        undershootTargetSamples,
      );

      if (postUndershootMetrics.sampleCount >= targetSamples) {
        logFitInfo(
          'fitSceneAudioToDurationLocal:adaptive-undershoot-fallback-to-exact',
          {
            sceneId,
            videoId,
            postUndershootSamples: postUndershootMetrics.sampleCount,
            targetSamples,
            deltaSamples: postUndershootMetrics.sampleCount - targetSamples,
          },
        );

        postUndershootMetrics = await runTempoStages(
          'longer-adaptive-fallback-exact',
          targetSamples,
        );
      }

      if (postUndershootMetrics.sampleCount < targetSamples) {
        const silenceSamples =
          targetSamples - postUndershootMetrics.sampleCount;
        logFitInfo(
          'fitSceneAudioToDurationLocal:adaptive-undershoot-pad-final-silence',
          {
            sceneId,
            videoId,
            postUndershootSamples: postUndershootMetrics.sampleCount,
            targetSamples,
            silenceSamples,
            silenceDurationSec: roundDurationSeconds(
              silenceSamples / postUndershootMetrics.sampleRate,
            ),
          },
        );

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
      } else if (postUndershootMetrics.sampleCount > targetSamples) {
        logFitInfo(
          'fitSceneAudioToDurationLocal:adaptive-undershoot-still-long-after-fallback',
          {
            sceneId,
            videoId,
            postUndershootSamples: postUndershootMetrics.sampleCount,
            targetSamples,
            finalOverageSamples:
              postUndershootMetrics.sampleCount - targetSamples,
            finalOverageSec: roundDurationSeconds(
              (postUndershootMetrics.sampleCount - targetSamples) /
                postUndershootMetrics.sampleRate,
            ),
          },
        );
      }
    } else {
      logFitInfo(
        'fitSceneAudioToDurationLocal:exact-input-match-no-adjustment-needed',
        {
          sceneId,
          videoId,
          inputSamples: inputMetrics.sampleCount,
          targetSamples,
        },
      );
    }

    const finalMetrics = await probeAudioMetrics(workingPath);
    const outputDurationSec = roundDurationSeconds(
      samplesToSeconds(finalMetrics.sampleCount, finalMetrics.sampleRate),
    );
    const finalDeltaSamples = finalMetrics.sampleCount - targetSamples;

    logFitInfo('fitSceneAudioToDurationLocal:done', {
      sceneId,
      videoId,
      outputPath: workingPath,
      inputDurationSec,
      outputDurationSec,
      targetDurationSec: normalizedTargetDurationSec,
      inputSamples: inputMetrics.sampleCount,
      outputSamples: finalMetrics.sampleCount,
      targetSamples,
      finalDeltaSamples,
      finalDeltaSec: roundDurationSeconds(
        finalDeltaSamples / finalMetrics.sampleRate,
      ),
      cumulativeSpeedApplied,
      elapsedMs: Date.now() - startedAt,
    });

    cleanupPaths.delete(workingPath);

    return {
      localPath: workingPath,
      inputDurationSec,
      outputDurationSec,
      speedApplied: cumulativeSpeedApplied,
    };
  } catch (error) {
    logFitError('fitSceneAudioToDurationLocal:error', {
      sceneId,
      videoId,
      targetDurationSec: normalizedTargetDurationSec,
      targetSamples,
      message: error instanceof Error ? error.message : String(error),
      elapsedMs: Date.now() - startedAt,
    });

    for (const filePath of cleanupPaths) {
      await safeUnlink(filePath);
    }
    throw error;
  }
}

async function encodeAudioToM4aLocal(options: {
  inputPath: string;
  outputPrefix: string;
}): Promise<string> {
  const { inputPath, outputPrefix } = options;
  const outputPath = makeTempPath(outputPrefix, 'm4a');

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
      `[0:a]aformat=sample_fmts=fltp:sample_rates=${AUDIO_SAMPLE_RATE}:channel_layouts=stereo,asetpts=N/SR/TB[aout]`,
      '-map',
      '[aout]',
      '-c:a',
      'aac',
      '-b:a',
      '192k',
      '-ar',
      String(AUDIO_SAMPLE_RATE),
      '-ac',
      String(AUDIO_CHANNELS),
      '-movflags',
      '+faststart',
      outputPath,
    ],
    DEFAULT_FFMPEG_TIMEOUT_MS,
  );

  await access(outputPath);
  return outputPath;
}

async function tempoMatchM4aToDurationLocal(options: {
  sceneId: number;
  videoId: number;
  inputPath: string;
  targetDurationSec: number;
  toleranceSec?: number;
  maxPasses?: number;
}): Promise<{
  localPath: string;
  outputDurationSec: number;
  speedApplied: number;
}> {
  const {
    sceneId,
    videoId,
    inputPath,
    targetDurationSec,
    toleranceSec = SCENE_DURATION_TOLERANCE_SEC,
    maxPasses = SCENE_MAX_TEMPO_PASSES,
  } = options;

  let currentPath = inputPath;
  let currentDurationSec = await probeMediaDurationSeconds(inputPath);
  let cumulativeSpeedApplied = 1;
  const generatedPassPaths: string[] = [];

  try {
    for (let passIndex = 1; passIndex <= maxPasses; passIndex += 1) {
      const deltaSec = currentDurationSec - targetDurationSec;
      if (Math.abs(deltaSec) <= toleranceSec) {
        break;
      }

      const passSpeedApplied = currentDurationSec / targetDurationSec;
      if (!Number.isFinite(passSpeedApplied) || passSpeedApplied <= 0) {
        throw new Error(
          `Invalid m4a tempo speed on pass ${passIndex}: ${passSpeedApplied}`,
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
        `video_${videoId}_scene_${sceneId}_dubbed_fit_upload_pass_${passIndex}`,
        'm4a',
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
          'aac',
          '-b:a',
          '192k',
          '-ar',
          String(AUDIO_SAMPLE_RATE),
          '-ac',
          String(AUDIO_CHANNELS),
          '-movflags',
          '+faststart',
          passOutputPath,
        ],
        DEFAULT_FFMPEG_TIMEOUT_MS,
      );

      await access(passOutputPath);
      const passOutputDurationSec =
        await probeMediaDurationSeconds(passOutputPath);

      generatedPassPaths.push(passOutputPath);
      cumulativeSpeedApplied *= passSpeedApplied;

      if (currentPath !== inputPath) {
        await safeUnlink(currentPath);
      }

      currentPath = passOutputPath;
      currentDurationSec = passOutputDurationSec;
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
    outputDurationSec: roundDurationSeconds(currentDurationSec),
    speedApplied: cumulativeSpeedApplied,
  };
}

async function fitAndUploadSceneAudio(options: {
  audioUrl: string;
  sceneId: number;
  videoId: number;
  targetDurationSec: number;
}): Promise<{
  uploadUrl: string;
  inputDurationSec: number;
  outputDurationSec: number;
  speedApplied: number;
}> {
  const { audioUrl, sceneId, videoId, targetDurationSec } = options;
  const startedAt = Date.now();

  logFitInfo('fitAndUploadSceneAudio:start', {
    sceneId,
    videoId,
    audioUrl,
    targetDurationSec,
    saveAsWav: SAVE_FITTED_AUDIO_AS_WAV,
  });

  let fittedLocalPath: string | null = null;
  let uploadLocalPath: string | null = null;

  try {
    const fitted = await fitSceneAudioToDurationLocal({
      sceneId,
      videoId,
      inputAudioUrl: audioUrl,
      targetDurationSec,
    });
    fittedLocalPath = fitted.localPath;

    logFitInfo('fitAndUploadSceneAudio:fitted-local-ready', {
      sceneId,
      videoId,
      fittedLocalPath,
      inputDurationSec: fitted.inputDurationSec,
      outputDurationSec: fitted.outputDurationSec,
      speedApplied: fitted.speedApplied,
    });

    if (SAVE_FITTED_AUDIO_AS_WAV) {
      const filename = `video_${videoId}_scene_${sceneId}_dubbed_fitted_${Date.now()}.wav`;

      logFitInfo('fitAndUploadSceneAudio:wav-upload-start', {
        sceneId,
        videoId,
        filename,
        contentType: 'audio/wav',
      });

      const uploadUrl = await uploadToMinio(
        fitted.localPath,
        filename,
        'audio/wav',
      );

      logFitInfo('fitAndUploadSceneAudio:wav-upload-done', {
        sceneId,
        videoId,
        uploadUrl,
        outputDurationSec: fitted.outputDurationSec,
        elapsedMs: Date.now() - startedAt,
      });

      return {
        uploadUrl,
        inputDurationSec: fitted.inputDurationSec,
        outputDurationSec: fitted.outputDurationSec,
        speedApplied: fitted.speedApplied,
      };
    }

    uploadLocalPath = await encodeAudioToM4aLocal({
      inputPath: fitted.localPath,
      outputPrefix: `video_${videoId}_scene_${sceneId}_dubbed_fit_upload`,
    });

    logFitInfo('fitAndUploadSceneAudio:m4a-encoded', {
      sceneId,
      videoId,
      uploadLocalPath,
    });

    const normalizedTargetDurationSec = roundDurationSeconds(targetDurationSec);
    const uploadCorrected = await tempoMatchM4aToDurationLocal({
      sceneId,
      videoId,
      inputPath: uploadLocalPath,
      targetDurationSec: normalizedTargetDurationSec,
    });

    if (uploadCorrected.localPath !== uploadLocalPath) {
      await safeUnlink(uploadLocalPath);
      uploadLocalPath = uploadCorrected.localPath;
    }

    logFitInfo('fitAndUploadSceneAudio:m4a-post-correction', {
      sceneId,
      videoId,
      correctedLocalPath: uploadLocalPath,
      correctedDurationSec: uploadCorrected.outputDurationSec,
      correctedSpeedApplied: uploadCorrected.speedApplied,
    });

    const filename = `video_${videoId}_scene_${sceneId}_dubbed_fitted_${Date.now()}.m4a`;
    const uploadUrl = await uploadToMinio(
      uploadLocalPath,
      filename,
      'audio/mp4',
    );

    logFitInfo('fitAndUploadSceneAudio:m4a-upload-done', {
      sceneId,
      videoId,
      uploadUrl,
      filename,
      outputDurationSec: uploadCorrected.outputDurationSec,
      elapsedMs: Date.now() - startedAt,
    });

    return {
      uploadUrl,
      inputDurationSec: fitted.inputDurationSec,
      outputDurationSec: uploadCorrected.outputDurationSec,
      speedApplied: fitted.speedApplied * uploadCorrected.speedApplied,
    };
  } catch (error) {
    logFitError('fitAndUploadSceneAudio:error', {
      sceneId,
      videoId,
      targetDurationSec,
      message: error instanceof Error ? error.message : String(error),
      elapsedMs: Date.now() - startedAt,
    });
    throw error;
  } finally {
    await safeUnlink(uploadLocalPath);
    await safeUnlink(fittedLocalPath);

    logFitInfo('fitAndUploadSceneAudio:cleanup', {
      sceneId,
      videoId,
      uploadLocalPath,
      fittedLocalPath,
    });
  }
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

  logFitInfo('generateSceneTts:start', {
    sceneId,
    videoId,
    providerPath,
    textLength: text.length,
    hasReferenceAudioFilename: Boolean(referenceAudioFilename),
    hasTtsSettings: Boolean(ttsSettings),
  });

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

    logFitError('generateSceneTts:error-response', {
      sceneId,
      videoId,
      providerPath,
      status: response.status,
      message,
    });

    throw new Error(message);
  }

  const audioUrl =
    typeof json?.audioUrl === 'string' ? json.audioUrl.trim() : '';
  if (!audioUrl) {
    logFitError('generateSceneTts:error-empty-audio-url', {
      sceneId,
      videoId,
      providerPath,
    });
    throw new Error('TTS provider returned empty audioUrl');
  }

  logFitInfo('generateSceneTts:done', {
    sceneId,
    videoId,
    providerPath,
    audioUrl,
  });

  return audioUrl;
}

export async function POST(request: NextRequest) {
  try {
    const requestStartedAt = Date.now();
    const fitDebugRunId = `fit-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

    const body = (await request.json().catch(() => null)) as {
      videoId?: unknown;
      sourceTextFieldKey?: unknown;
      destinationAudioFieldKey?: unknown;
      originalAudioFieldKey?: unknown;
      sceneDurationFieldKey?: unknown;
      provider?: unknown;
      referenceAudioFilename?: unknown;
      ttsSettings?: unknown;
      skipIfDestinationExists?: unknown;
      failFastOnSaveError?: unknown;
      fitAudioToSceneDuration?: unknown;
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

    const originalAudioFieldKeyRaw = body?.originalAudioFieldKey;
    const hasOriginalAudioFieldKeyInput =
      originalAudioFieldKeyRaw !== undefined &&
      originalAudioFieldKeyRaw !== null &&
      !(
        typeof originalAudioFieldKeyRaw === 'string' &&
        originalAudioFieldKeyRaw.trim().length === 0
      );

    const originalAudioFieldKey = hasOriginalAudioFieldKeyInput
      ? asFieldKey(originalAudioFieldKeyRaw)
      : null;

    if (hasOriginalAudioFieldKeyInput && !originalAudioFieldKey) {
      return NextResponse.json(
        {
          error:
            'originalAudioFieldKey must be a Baserow field key (e.g., field_7117) when provided',
        },
        { status: 400 },
      );
    }

    if (
      originalAudioFieldKey &&
      originalAudioFieldKey === destinationAudioFieldKey
    ) {
      return NextResponse.json(
        {
          error:
            'originalAudioFieldKey must be different from destinationAudioFieldKey',
        },
        { status: 400 },
      );
    }

    const saveOriginalAudioBeforeFit = Boolean(originalAudioFieldKey);

    const fitAudioToSceneDuration = parseBoolean(
      body?.fitAudioToSceneDuration,
      false,
    );

    const sceneDurationFieldKey = asFieldKey(body?.sceneDurationFieldKey);
    if (fitAudioToSceneDuration && !sceneDurationFieldKey) {
      return NextResponse.json(
        {
          error:
            'sceneDurationFieldKey is required when fitAudioToSceneDuration is enabled',
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

    logFitInfo('post:start', {
      fitDebugRunId,
      videoId,
      sourceTextFieldKey,
      destinationAudioFieldKey,
      originalAudioFieldKey,
      sceneDurationFieldKey,
      provider,
      providerPath,
      fitAudioToSceneDuration,
      saveOriginalAudioBeforeFit,
      skipIfDestinationExists,
      failFastOnSaveError,
      saveFittedAudioAsWav: SAVE_FITTED_AUDIO_AS_WAV,
      sceneToleranceSec: SCENE_DURATION_TOLERANCE_SEC,
      coarseToleranceSamples: SCENE_COARSE_TOLERANCE_SAMPLES,
      fineToleranceSamples: SCENE_FINE_TOLERANCE_SAMPLES,
      finalToleranceSamples: SCENE_FINAL_TOLERANCE_SAMPLES,
      coarseMaxPasses: SCENE_COARSE_MAX_TEMPO_PASSES,
      fineMaxPasses: SCENE_FINE_MAX_TEMPO_PASSES,
      verifyMaxPasses: SCENE_VERIFY_MAX_TEMPO_PASSES,
      filteredOnlySceneIdsCount: onlySceneIdSet?.size ?? 0,
    });

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

    logFitInfo('post:scenes-loaded', {
      fitDebugRunId,
      videoId,
      totalScenes: scenes.length,
    });

    const orderedScenes = [...scenes].sort(
      (a, b) => getSceneOrderValue(a) - getSceneOrderValue(b),
    );

    const failures: SceneTtsFailure[] = [];
    let generatedCount = 0;
    let skippedNoTextCount = 0;
    let skippedExistingCount = 0;
    let skippedSceneFilterCount = 0;
    let skippedInvalidSceneIdCount = 0;
    let skippedMissingDurationCount = 0;
    let fittedCount = 0;
    let originalSavedCount = 0;
    let skippedOriginalSaveCount = 0;
    let abortedOnSaveFailure = false;
    let abortedSceneId: number | null = null;

    for (const scene of orderedScenes) {
      const sceneId = parsePositiveInt(scene.id);
      if (!sceneId) {
        skippedInvalidSceneIdCount += 1;
        logFitInfo('post:scene-skip-invalid-scene-id', {
          fitDebugRunId,
          rawSceneId: scene.id,
        });
        continue;
      }

      const sceneStartedAt = Date.now();

      if (
        onlySceneIdSet &&
        onlySceneIdSet.size > 0 &&
        !onlySceneIdSet.has(sceneId)
      ) {
        skippedSceneFilterCount += 1;
        logFitInfo('post:scene-skip-scene-filter', {
          fitDebugRunId,
          sceneId,
        });
        continue;
      }

      const text = String(scene[sourceTextFieldKey] ?? '').trim();
      if (!text) {
        skippedNoTextCount += 1;
        logFitInfo('post:scene-skip-no-text', {
          fitDebugRunId,
          sceneId,
          sourceTextFieldKey,
        });
        continue;
      }

      const existingAudioUrl = extractUrl(scene[destinationAudioFieldKey]);
      if (skipIfDestinationExists && existingAudioUrl) {
        skippedExistingCount += 1;
        logFitInfo('post:scene-skip-existing-audio', {
          fitDebugRunId,
          sceneId,
          destinationAudioFieldKey,
          existingAudioUrl,
        });
        continue;
      }

      const targetDurationSec = fitAudioToSceneDuration
        ? (() => {
            const parsed = parsePositiveNumber(
              scene[sceneDurationFieldKey as string],
            );
            return parsed ? roundDurationSeconds(parsed) : null;
          })()
        : null;

      if (fitAudioToSceneDuration && !targetDurationSec) {
        skippedMissingDurationCount += 1;
        failures.push({
          sceneId,
          error: `Missing/invalid duration in ${sceneDurationFieldKey}`,
        });

        logFitInfo('post:scene-skip-missing-duration', {
          fitDebugRunId,
          sceneId,
          sceneDurationFieldKey,
          rawDuration: scene[sceneDurationFieldKey as string],
        });

        continue;
      }

      logFitInfo('post:scene-start', {
        fitDebugRunId,
        sceneId,
        textLength: text.length,
        targetDurationSec,
        targetSamples:
          targetDurationSec && fitAudioToSceneDuration
            ? secondsToSamples(targetDurationSec, AUDIO_SAMPLE_RATE)
            : null,
      });

      try {
        const generatedAudioUrl = await generateSceneTts({
          origin: request.nextUrl.origin,
          providerPath,
          text,
          sceneId,
          videoId,
          referenceAudioFilename: referenceAudioFilename || undefined,
          ttsSettings,
        });

        let audioUrl = generatedAudioUrl;

        logFitInfo('post:scene-tts-generated', {
          fitDebugRunId,
          sceneId,
          audioUrl: generatedAudioUrl,
        });

        if (saveOriginalAudioBeforeFit && originalAudioFieldKey) {
          try {
            token = await patchSceneAudioWithAuthRetry({
              baserowUrl,
              token,
              sceneId,
              destinationAudioFieldKey: originalAudioFieldKey,
              audioUrl: generatedAudioUrl,
            });

            originalSavedCount += 1;

            logFitInfo('post:scene-save-original-success', {
              fitDebugRunId,
              sceneId,
              originalAudioFieldKey,
              savedAudioUrl: generatedAudioUrl,
            });
          } catch (saveError) {
            const saveMessage =
              saveError instanceof Error ? saveError.message : 'Unknown error';

            failures.push({
              sceneId,
              error: `Failed to save original audio to ${originalAudioFieldKey}: ${saveMessage}`,
            });

            logFitError('post:scene-save-original-error', {
              fitDebugRunId,
              sceneId,
              originalAudioFieldKey,
              message: saveMessage,
              elapsedMs: Date.now() - sceneStartedAt,
            });

            if (failFastOnSaveError) {
              abortedOnSaveFailure = true;
              abortedSceneId = sceneId;
              console.error(
                `[generate-scene-tts-by-field] Fail-fast: stopping batch after original save failure on scene ${sceneId}: ${saveMessage}`,
              );
              break;
            }

            continue;
          }
        } else {
          skippedOriginalSaveCount += 1;
        }

        if (fitAudioToSceneDuration && targetDurationSec) {
          logFitInfo('post:scene-fit-start', {
            fitDebugRunId,
            sceneId,
            targetDurationSec,
            targetSamples: secondsToSamples(
              targetDurationSec,
              AUDIO_SAMPLE_RATE,
            ),
          });

          const fitted = await fitAndUploadSceneAudio({
            audioUrl,
            sceneId,
            videoId,
            targetDurationSec,
          });

          audioUrl = fitted.uploadUrl;
          fittedCount += 1;

          logFitInfo('post:scene-fit-done', {
            fitDebugRunId,
            sceneId,
            fittedUploadUrl: fitted.uploadUrl,
            inputDurationSec: fitted.inputDurationSec,
            outputDurationSec: fitted.outputDurationSec,
            targetDurationSec,
            durationDeltaSec: roundDurationSeconds(
              fitted.outputDurationSec - targetDurationSec,
            ),
            speedApplied: fitted.speedApplied,
          });
        }

        try {
          token = await patchSceneAudioWithAuthRetry({
            baserowUrl,
            token,
            sceneId,
            destinationAudioFieldKey,
            audioUrl,
          });

          generatedCount += 1;

          logFitInfo('post:scene-save-success', {
            fitDebugRunId,
            sceneId,
            destinationAudioFieldKey,
            savedAudioUrl: audioUrl,
            elapsedMs: Date.now() - sceneStartedAt,
          });
        } catch (saveError) {
          const saveMessage =
            saveError instanceof Error ? saveError.message : 'Unknown error';

          failures.push({
            sceneId,
            error: saveMessage,
          });

          logFitError('post:scene-save-error', {
            fitDebugRunId,
            sceneId,
            destinationAudioFieldKey,
            message: saveMessage,
            elapsedMs: Date.now() - sceneStartedAt,
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
        const message =
          error instanceof Error ? error.message : 'Unknown error';

        failures.push({
          sceneId,
          error: message,
        });

        logFitError('post:scene-error', {
          fitDebugRunId,
          sceneId,
          message,
          elapsedMs: Date.now() - sceneStartedAt,
        });
      }
    }

    logFitInfo('post:done', {
      fitDebugRunId,
      videoId,
      requestedSceneCount: orderedScenes.length,
      generatedCount,
      fittedCount,
      originalSavedCount,
      skippedOriginalSaveCount,
      skippedNoTextCount,
      skippedExistingCount,
      skippedMissingDurationCount,
      skippedSceneFilterCount,
      skippedInvalidSceneIdCount,
      failureCount: failures.length,
      abortedOnSaveFailure,
      abortedSceneId,
      elapsedMs: Date.now() - requestStartedAt,
    });

    return NextResponse.json({
      ok: failures.length === 0 && !abortedOnSaveFailure,
      videoId,
      provider,
      providerPath,
      sourceTextFieldKey,
      destinationAudioFieldKey,
      originalAudioFieldKey,
      sceneDurationFieldKey,
      saveOriginalAudioBeforeFit,
      referenceAudioFilename: referenceAudioFilename || null,
      skipIfDestinationExists,
      failFastOnSaveError,
      fitAudioToSceneDuration,
      abortedOnSaveFailure,
      abortedSceneId,
      requestedSceneCount: orderedScenes.length,
      generatedCount,
      fittedCount,
      originalSavedCount,
      skippedOriginalSaveCount,
      skippedNoTextCount,
      skippedExistingCount,
      skippedMissingDurationCount,
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
