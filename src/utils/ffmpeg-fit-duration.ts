import { spawn } from 'child_process';
import { access, unlink } from 'fs/promises';
import path from 'path';
import { convertToCFR } from '@/utils/ffmpeg-cfr';
import { uploadToMinio } from '@/utils/ffmpeg-direct';

interface FfprobeStream {
  codec_type?: string;
  duration?: string;
  avg_frame_rate?: string;
  r_frame_rate?: string;
}

interface FfprobeOutput {
  streams?: FfprobeStream[];
  format?: {
    duration?: string;
  };
}

export interface VideoTimingProbe {
  durationSec: number;
  avgFps: number | null;
  rFps: number | null;
  hasAudio: boolean;
  isLikelyVfr: boolean;
}

export interface FitDurationComputationOptions {
  inputUrl: string;
  targetDurationSec: number;
  muteAudio?: boolean;
  toleranceSec?: number;
  maxCorrectionPasses?: number;
}

export interface FitDurationComputationResult {
  localPath: string;
  sourceDurationSec: number;
  outputDurationSec: number;
  residualSec: number;
  passes: number;
  appliedSpeeds: number[];
  correctionFps: number;
  targetFrameCount: number;
  outputFrameCount: number;
  frameDeltaApplied: number;
  frameDeltaRemaining: number;
  frameCorrectionApplied: boolean;
  targetDurationFrameAlignedSec: number;
}

export interface FitFinalDurationWithUploadOptions {
  inputUrl: string;
  targetDurationSec: number;
  sceneId?: string | number;
  videoId?: string | number;
  muteAudio?: boolean;
  toleranceSec?: number;
  maxCorrectionPasses?: number;
  cleanup?: boolean;
}

export interface FitFinalDurationWithUploadResult extends FitDurationComputationResult {
  uploadUrl: string;
  cfrApplied: boolean;
  cfrFramerate: number | null;
  sourceDurationSecBeforeCfr: number;
  sourceDurationSecAfterPreparation: number;
  vfrDetected: boolean;
}

interface FrameCorrectionPassOptions {
  inputUrl: string;
  outputPath: string;
  targetFrameCount: number;
  correctionFps: number;
  frameDelta: number;
  hasAudio: boolean;
  muteAudio: boolean;
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

function parseFrameRate(rawRate?: string): number | null {
  if (!rawRate) return null;

  if (rawRate.includes('/')) {
    const [numRaw, denRaw] = rawRate.split('/');
    const num = Number(numRaw);
    const den = Number(denRaw);
    if (!Number.isFinite(num) || !Number.isFinite(den) || den === 0) {
      return null;
    }
    const value = num / den;
    return Number.isFinite(value) && value > 0 ? value : null;
  }

  const parsed = Number(rawRate);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function detectLikelyVfr(avgFps: number | null, rFps: number | null): boolean {
  if (!avgFps || !rFps) return false;

  const relDiff = Math.abs(avgFps - rFps) / Math.max(avgFps, rFps);
  return relDiff > 0.01;
}

function makeTempMp4Path(prefix: string): string {
  return path.resolve(
    '/tmp',
    `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 10)}.mp4`,
  );
}

function chooseFrameCorrectionFps(probe: VideoTimingProbe): number {
  const candidate = probe.avgFps ?? probe.rFps ?? 30;
  const clamped = Math.max(1, Math.min(120, candidate));
  return Number(clamped.toFixed(6));
}

async function runCommand(
  binary: string,
  args: string[],
  timeoutMs: number,
): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(binary, args, {
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';

    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString();
    });

    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
    });

    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      reject(new Error(`${binary} timed out after ${timeoutMs}ms`));
    }, timeoutMs);

    child.on('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });

    child.on('close', (code) => {
      clearTimeout(timer);

      if (code === 0) {
        resolve({ stdout, stderr });
        return;
      }

      const stderrTail = stderr.trim().slice(-1200);
      reject(
        new Error(
          `${binary} failed with code ${code}${
            stderrTail ? `: ${stderrTail}` : ''
          }`,
        ),
      );
    });
  });
}

async function safeUnlink(filePath?: string | null): Promise<void> {
  if (!filePath) return;
  try {
    await unlink(filePath);
  } catch {
    // Best-effort cleanup only.
  }
}

export async function probeVideoTiming(
  inputUrl: string,
): Promise<VideoTimingProbe> {
  const { stdout } = await runCommand(
    'ffprobe',
    [
      '-v',
      'quiet',
      '-print_format',
      'json',
      '-show_format',
      '-show_streams',
      inputUrl,
    ],
    120000,
  );

  const probe = JSON.parse(stdout) as FfprobeOutput;
  const streams = Array.isArray(probe.streams) ? probe.streams : [];

  const videoStream = streams.find((stream) => stream.codec_type === 'video');
  if (!videoStream) {
    throw new Error('No video stream found in input');
  }

  const durationCandidates = [
    parsePositiveNumber(probe.format?.duration),
    parsePositiveNumber(videoStream.duration),
    ...streams.map((stream) => parsePositiveNumber(stream.duration)),
  ].filter((value): value is number => typeof value === 'number');

  if (durationCandidates.length === 0) {
    throw new Error('Could not determine input duration from ffprobe');
  }

  const durationSec = Math.max(...durationCandidates);
  const avgFps = parseFrameRate(videoStream.avg_frame_rate);
  const rFps = parseFrameRate(videoStream.r_frame_rate);

  return {
    durationSec,
    avgFps,
    rFps,
    hasAudio: streams.some((stream) => stream.codec_type === 'audio'),
    isLikelyVfr: detectLikelyVfr(avgFps, rFps),
  };
}

export function chooseAdaptiveCfrFramerate(probe: VideoTimingProbe): number {
  const base = probe.avgFps ?? probe.rFps ?? 30;
  const clamped = Math.max(1, Math.min(120, base));
  const nearestInt = Math.round(clamped);

  if (Math.abs(clamped - nearestInt) < 0.01) {
    return nearestInt;
  }

  return Number(clamped.toFixed(3));
}

export function shouldApplyConditionalCfr(probe: VideoTimingProbe): boolean {
  return probe.isLikelyVfr;
}

function buildAtempoChain(speed: number): string {
  if (!Number.isFinite(speed) || speed <= 0) {
    throw new Error(`Invalid speed value: ${speed}`);
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

  if (Math.abs(remaining - 1.0) > 1e-6) {
    filters.push(`atempo=${remaining.toFixed(6)}`);
  }

  return filters.length > 0 ? filters.join(',') : 'anull';
}

interface FitPassOptions {
  inputUrl: string;
  outputPath: string;
  speed: number;
  targetDurationSec: number;
  hasAudio: boolean;
  muteAudio: boolean;
}

async function runFitPass(options: FitPassOptions): Promise<void> {
  const {
    inputUrl,
    outputPath,
    speed,
    targetDurationSec,
    hasAudio,
    muteAudio,
  } = options;

  const targetDurationLabel = targetDurationSec.toFixed(6);
  const speedLabel = speed.toFixed(10);

  const videoFilter = [
    `setpts=PTS/${speedLabel}`,
    'tpad=stop_mode=clone:stop_duration=0.25',
    `trim=0:${targetDurationLabel}`,
    'setpts=PTS-STARTPTS',
  ].join(',');

  const ffmpegArgs: string[] = ['-y', '-i', inputUrl];

  if (hasAudio) {
    const atempo = buildAtempoChain(speed);
    const audioParts = [atempo];

    if (muteAudio) {
      audioParts.push('volume=0');
    }

    audioParts.push(
      'apad=pad_dur=0.25',
      `atrim=0:${targetDurationLabel}`,
      'asetpts=N/SR/TB',
    );

    const audioFilter = audioParts.join(',');

    ffmpegArgs.push(
      '-filter_complex',
      `[0:v]${videoFilter}[v];[0:a]${audioFilter}[a]`,
      '-map',
      '[v]',
      '-map',
      '[a]',
      '-c:a',
      'aac',
      '-b:a',
      '128k',
      '-ac',
      '2',
    );
  } else {
    ffmpegArgs.push('-vf', videoFilter, '-map', '0:v:0');
  }

  ffmpegArgs.push(
    '-c:v',
    'libx264',
    '-preset',
    'medium',
    '-crf',
    '20',
    '-pix_fmt',
    'yuv420p',
    '-movflags',
    '+faststart',
    '-avoid_negative_ts',
    'make_zero',
    '-t',
    targetDurationLabel,
    outputPath,
  );

  await runCommand('ffmpeg', ffmpegArgs, 600000);
  await access(outputPath);
}

async function runFrameCorrectionPass(
  options: FrameCorrectionPassOptions,
): Promise<void> {
  const {
    inputUrl,
    outputPath,
    targetFrameCount,
    correctionFps,
    frameDelta,
    hasAudio,
    muteAudio,
  } = options;

  const fpsLabel = correctionFps.toFixed(6);
  const targetDurationSec = targetFrameCount / correctionFps;
  const targetDurationLabel = targetDurationSec.toFixed(6);
  const padDurationSec = frameDelta > 0 ? frameDelta / correctionFps : 0;
  const padDurationLabel = padDurationSec.toFixed(6);

  const videoParts: string[] = [];
  if (frameDelta > 0) {
    videoParts.push(`tpad=stop_mode=clone:stop_duration=${padDurationLabel}`);
  }
  videoParts.push(
    `fps=${fpsLabel}`,
    `trim=0:${targetDurationLabel}`,
    'setpts=PTS-STARTPTS',
  );

  const ffmpegArgs: string[] = ['-y', '-i', inputUrl];

  if (hasAudio) {
    const audioParts: string[] = [];
    if (frameDelta > 0) {
      audioParts.push(`apad=pad_dur=${padDurationLabel}`);
    }
    audioParts.push(`atrim=0:${targetDurationLabel}`, 'asetpts=N/SR/TB');
    if (muteAudio) {
      audioParts.push('volume=0');
    }

    ffmpegArgs.push(
      '-filter_complex',
      `[0:v]${videoParts.join(',')}[v];[0:a]${audioParts.join(',')}[a]`,
      '-map',
      '[v]',
      '-map',
      '[a]',
      '-c:a',
      'aac',
      '-b:a',
      '128k',
      '-ac',
      '2',
    );
  } else {
    ffmpegArgs.push('-vf', videoParts.join(','), '-map', '0:v:0');
  }

  ffmpegArgs.push(
    '-c:v',
    'libx264',
    '-preset',
    'medium',
    '-crf',
    '20',
    '-pix_fmt',
    'yuv420p',
    '-movflags',
    '+faststart',
    '-avoid_negative_ts',
    'make_zero',
    '-vsync',
    'cfr',
    '-r',
    fpsLabel,
    '-frames:v',
    String(targetFrameCount),
    outputPath,
  );

  await runCommand('ffmpeg', ffmpegArgs, 600000);
  await access(outputPath);
}

export async function fitVideoToDurationWithCorrection(
  options: FitDurationComputationOptions,
): Promise<FitDurationComputationResult> {
  const targetDurationSec = parsePositiveNumber(options.targetDurationSec);
  if (!targetDurationSec) {
    throw new Error('targetDurationSec must be a positive number');
  }

  const toleranceSec = Math.max(0.001, options.toleranceSec ?? 0.01);
  const maxCorrectionPasses = Math.max(
    0,
    Math.floor(options.maxCorrectionPasses ?? 1),
  );

  const sourceProbe = await probeVideoTiming(options.inputUrl);
  const sourceDurationSec = sourceProbe.durationSec;
  const correctionFps = chooseFrameCorrectionFps(sourceProbe);
  const targetFrameCount = Math.max(
    1,
    Math.round(targetDurationSec * correctionFps),
  );
  const targetDurationFrameAlignedSec = targetFrameCount / correctionFps;

  let currentInput = options.inputUrl;
  let currentProbe = sourceProbe;

  const passOutputs: string[] = [];
  const appliedSpeeds: number[] = [];

  let finalOutputPath = '';
  let finalOutputDurationSec = sourceDurationSec;
  let frameDeltaApplied = 0;
  let frameDeltaRemaining = 0;
  let frameCorrectionApplied = false;

  try {
    for (let passIndex = 0; passIndex <= maxCorrectionPasses; passIndex += 1) {
      const speed = currentProbe.durationSec / targetDurationFrameAlignedSec;
      if (!Number.isFinite(speed) || speed <= 0) {
        throw new Error(`Computed invalid speed: ${speed}`);
      }

      const outputPath = makeTempMp4Path(`fitdur_pass${passIndex + 1}`);

      await runFitPass({
        inputUrl: currentInput,
        outputPath,
        speed,
        targetDurationSec: targetDurationFrameAlignedSec,
        hasAudio: currentProbe.hasAudio,
        muteAudio: Boolean(options.muteAudio),
      });

      passOutputs.push(outputPath);
      appliedSpeeds.push(Number(speed.toFixed(8)));

      const outputProbe = await probeVideoTiming(outputPath);
      finalOutputDurationSec = outputProbe.durationSec;
      const residualSec =
        finalOutputDurationSec - targetDurationFrameAlignedSec;

      const isLastPass = passIndex >= maxCorrectionPasses;
      if (Math.abs(residualSec) <= toleranceSec || isLastPass) {
        finalOutputPath = outputPath;
        break;
      }

      currentInput = outputPath;
      currentProbe = outputProbe;
    }

    if (!finalOutputPath) {
      throw new Error('Unable to produce fitted output');
    }

    const preCorrectionOutputFrameCount = Math.round(
      finalOutputDurationSec * correctionFps,
    );
    frameDeltaApplied = targetFrameCount - preCorrectionOutputFrameCount;

    if (frameDeltaApplied !== 0) {
      const frameCorrectedOutputPath = makeTempMp4Path('fitdur_framefix');

      await runFrameCorrectionPass({
        inputUrl: finalOutputPath,
        outputPath: frameCorrectedOutputPath,
        targetFrameCount,
        correctionFps,
        frameDelta: frameDeltaApplied,
        hasAudio: currentProbe.hasAudio,
        muteAudio: Boolean(options.muteAudio),
      });

      passOutputs.push(frameCorrectedOutputPath);
      finalOutputPath = frameCorrectedOutputPath;
      frameCorrectionApplied = true;

      const correctedProbe = await probeVideoTiming(finalOutputPath);
      finalOutputDurationSec = correctedProbe.durationSec;
      currentProbe = correctedProbe;
    }

    const outputFrameCount = Math.round(finalOutputDurationSec * correctionFps);
    frameDeltaRemaining = targetFrameCount - outputFrameCount;

    for (const outputPath of passOutputs) {
      if (outputPath !== finalOutputPath) {
        await safeUnlink(outputPath);
      }
    }

    return {
      localPath: finalOutputPath,
      sourceDurationSec,
      outputDurationSec: finalOutputDurationSec,
      residualSec: finalOutputDurationSec - targetDurationSec,
      passes: appliedSpeeds.length,
      appliedSpeeds,
      correctionFps,
      targetFrameCount,
      outputFrameCount,
      frameDeltaApplied,
      frameDeltaRemaining,
      frameCorrectionApplied,
      targetDurationFrameAlignedSec,
    };
  } catch (error) {
    for (const outputPath of passOutputs) {
      await safeUnlink(outputPath);
    }
    throw error;
  }
}

export async function fitFinalDurationWithUpload(
  options: FitFinalDurationWithUploadOptions,
): Promise<FitFinalDurationWithUploadResult> {
  const targetDurationSec = parsePositiveNumber(options.targetDurationSec);
  if (!targetDurationSec) {
    throw new Error('targetDurationSec must be a positive number');
  }

  const cleanup = options.cleanup !== false;

  let cfrLocalPath: string | null = null;
  let fitLocalPath: string | null = null;

  try {
    const sourceProbe = await probeVideoTiming(options.inputUrl);
    const cfrFramerate = chooseAdaptiveCfrFramerate(sourceProbe);
    const cfrApplied = shouldApplyConditionalCfr(sourceProbe);

    let preparedInput = options.inputUrl;
    let preparedProbe = sourceProbe;

    if (cfrApplied) {
      cfrLocalPath = await convertToCFR({
        inputUrl: options.inputUrl,
        framerate: cfrFramerate,
      });

      preparedInput = cfrLocalPath;
      preparedProbe = await probeVideoTiming(preparedInput);
    }

    const fitResult = await fitVideoToDurationWithCorrection({
      inputUrl: preparedInput,
      targetDurationSec,
      muteAudio: options.muteAudio,
      toleranceSec: options.toleranceSec,
      maxCorrectionPasses: options.maxCorrectionPasses,
    });

    fitLocalPath = fitResult.localPath;

    const timestamp = Date.now();
    const targetTag = targetDurationSec.toFixed(3).replace('.', 'p');
    const cfrTag = cfrApplied
      ? `_cfr${String(cfrFramerate).replace('.', 'p')}`
      : '';

    const filename =
      options.videoId && options.sceneId
        ? `video_${options.videoId}_scene_${options.sceneId}_fitdur_${targetTag}s${cfrTag}_${timestamp}.mp4`
        : options.sceneId
          ? `scene_${options.sceneId}_fitdur_${targetTag}s${cfrTag}_${timestamp}.mp4`
          : `fitdur_${targetTag}s${cfrTag}_${timestamp}.mp4`;

    const uploadUrl = await uploadToMinio(
      fitResult.localPath,
      filename,
      'video/mp4',
    );

    if (cleanup) {
      await safeUnlink(fitLocalPath);
      fitLocalPath = null;

      await safeUnlink(cfrLocalPath);
      cfrLocalPath = null;
    }

    return {
      ...fitResult,
      localPath: cleanup ? '' : fitResult.localPath,
      uploadUrl,
      cfrApplied,
      cfrFramerate: cfrApplied ? cfrFramerate : null,
      sourceDurationSecBeforeCfr: sourceProbe.durationSec,
      sourceDurationSecAfterPreparation: preparedProbe.durationSec,
      vfrDetected: sourceProbe.isLikelyVfr,
    };
  } catch (error) {
    await safeUnlink(fitLocalPath);
    await safeUnlink(cfrLocalPath);
    throw error;
  }
}
