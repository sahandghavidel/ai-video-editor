import { spawn } from 'child_process';
import { createWriteStream } from 'fs';
import { mkdir } from 'fs/promises';
import path from 'path';
import { Readable } from 'stream';
import { pipeline } from 'stream/promises';
import type { ReadableStream as WebReadableStream } from 'stream/web';

export type HyperFramesVideoCut = {
  sceneId: number;
  startTime: number;
  endTime: number;
  duration: number;
};

type FFprobeStream = {
  codec_type?: string;
  duration?: string | number;
  width?: number;
  height?: number;
  avg_frame_rate?: string;
  r_frame_rate?: string;
};

type FFprobeOutput = {
  streams?: FFprobeStream[];
  format?: { duration?: string | number };
};

function run(command: string, args: string[]) {
  return new Promise<{ stdout: string; stderr: string }>((resolve, reject) => {
    const child = spawn(command, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => (stdout += String(chunk)));
    child.stderr.on('data', (chunk) => (stderr += String(chunk)));
    child.once('error', reject);
    child.once('close', (code) => {
      if (code === 0) resolve({ stdout, stderr });
      else reject(new Error(`${command} failed (${code}): ${stderr.slice(0, 4000)}`));
    });
  });
}

async function download(url: string, outputPath: string) {
  const response = await fetch(url);
  if (!response.ok || !response.body) {
    throw new Error(`Video download failed (${response.status})`);
  }
  await pipeline(
    Readable.fromWeb(response.body as unknown as WebReadableStream),
    createWriteStream(outputPath),
  );
}

async function probe(filePath: string): Promise<FFprobeOutput> {
  const { stdout } = await run('ffprobe', [
    '-v',
    'error',
    '-print_format',
    'json',
    '-show_format',
    '-show_streams',
    filePath,
  ]);
  return JSON.parse(stdout) as FFprobeOutput;
}

function videoStream(probeResult: FFprobeOutput) {
  const stream = probeResult.streams?.find(
    (candidate) => candidate.codec_type === 'video',
  );
  if (!stream) throw new Error('Video stream is missing');
  return stream;
}

function duration(probeResult: FFprobeOutput) {
  const streamDuration = Number(videoStream(probeResult).duration);
  const formatDuration = Number(probeResult.format?.duration);
  const value =
    Number.isFinite(streamDuration) && streamDuration > 0
      ? streamDuration
      : formatDuration;
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error('Video duration is unavailable');
  }
  return value;
}

function totalDuration(probeResult: FFprobeOutput) {
  const candidates = [
    probeResult.format?.duration,
    ...(probeResult.streams ?? []).map((stream) => stream.duration),
  ]
    .map(Number)
    .filter((value) => Number.isFinite(value) && value > 0);
  if (!candidates.length) throw new Error('Media duration is unavailable');
  return Math.max(...candidates);
}

function parseFrameRate(value?: string) {
  if (!value) return null;
  const [numerator, denominator = '1'] = value.split('/').map(Number);
  const result = numerator / denominator;
  return Number.isFinite(result) && result > 0 ? result : null;
}

function frameRate(probeResult: FFprobeOutput) {
  const stream = videoStream(probeResult);
  const value =
    parseFrameRate(stream.r_frame_rate) ??
    parseFrameRate(stream.avg_frame_rate);
  if (!value) throw new Error('Video frame rate is unavailable');
  return value;
}

function dimensions(probeResult: FFprobeOutput) {
  const stream = videoStream(probeResult);
  const width = Number(stream.width);
  const height = Number(stream.height);
  if (!(width > 0) || !(height > 0)) {
    throw new Error('Video dimensions are unavailable');
  }
  return { width, height };
}

function hasAudio(probeResult: FFprobeOutput) {
  return Boolean(
    probeResult.streams?.some((stream) => stream.codec_type === 'audio'),
  );
}

function buildAtempoChain(speed: number) {
  if (!Number.isFinite(speed) || speed <= 0) {
    throw new Error('Invalid audio speed factor');
  }
  const factors: number[] = [];
  let remaining = speed;
  while (remaining > 2 + 1e-9) {
    factors.push(2);
    remaining /= 2;
  }
  while (remaining < 0.5 - 1e-9) {
    factors.push(0.5);
    remaining /= 0.5;
  }
  if (Math.abs(remaining - 1) > 1e-6) factors.push(remaining);
  return factors.length
    ? factors.map((factor) => `atempo=${factor.toFixed(8)}`).join(',')
    : 'anull';
}

export async function createAlignedHyperFramesCuts(options: {
  finalSourceUrl: string;
  hyperFramesSourceUrl: string;
  cuts: HyperFramesVideoCut[];
  workingDirectory: string;
}) {
  const { finalSourceUrl, hyperFramesSourceUrl, cuts, workingDirectory } =
    options;
  await mkdir(workingDirectory, { recursive: true });
  const finalPath = path.join(workingDirectory, 'final-source.mp4');
  const hyperFramesPath = path.join(workingDirectory, 'hyperframes-source.mp4');
  const alignedPath = path.join(workingDirectory, 'hyperframes-aligned.mp4');

  await Promise.all([
    download(finalSourceUrl, finalPath),
    download(hyperFramesSourceUrl, hyperFramesPath),
  ]);

  const [finalProbe, hyperFramesProbe] = await Promise.all([
    probe(finalPath),
    probe(hyperFramesPath),
  ]);
  const finalDuration = totalDuration(finalProbe);
  const hyperFramesDuration = totalDuration(hyperFramesProbe);
  const targetDuration = Math.max(...cuts.map((cut) => cut.endTime));
  const finalFrameRate = frameRate(finalProbe);
  const finalDimensions = dimensions(finalProbe);
  const hyperFramesHasAudio = hasAudio(hyperFramesProbe);
  const frameTolerance = 1 / finalFrameRate + 0.005;

  if (Math.abs(targetDuration - finalDuration) > frameTolerance) {
    throw new Error(
      `Final cut map ends at ${targetDuration.toFixed(6)} but Final video ends at ${finalDuration.toFixed(6)}`,
    );
  }

  const stretchFactor = targetDuration / hyperFramesDuration;
  const audioTempo = hyperFramesDuration / targetDuration;
  const scale =
    `scale=w=${finalDimensions.width}:h=${finalDimensions.height}:` +
    `force_original_aspect_ratio=increase,crop=${finalDimensions.width}:${finalDimensions.height}`;
  const filters = [
    `[0:v]trim=0:${hyperFramesDuration.toFixed(6)},setpts=(PTS-STARTPTS)*${stretchFactor.toFixed(10)},${scale},fps=${finalFrameRate.toFixed(8)},tpad=stop_mode=clone:stop_duration=${(frameTolerance * 2).toFixed(8)},trim=0:${targetDuration.toFixed(6)},setpts=PTS-STARTPTS[v]`,
    ...(hyperFramesHasAudio
      ? [
          `[0:a]atrim=0:${hyperFramesDuration.toFixed(6)},asetpts=PTS-STARTPTS,${buildAtempoChain(audioTempo)},apad=pad_dur=0.25,atrim=0:${targetDuration.toFixed(6)},asetpts=PTS-STARTPTS[a]`,
        ]
      : []),
  ];
  await run('ffmpeg', [
    '-hide_banner',
    '-loglevel',
    'error',
    '-i',
    hyperFramesPath,
    '-filter_complex',
    filters.join(';'),
    '-map',
    '[v]',
    ...(hyperFramesHasAudio ? ['-map', '[a]'] : ['-an']),
    '-t',
    targetDuration.toFixed(6),
    '-c:v',
    'libx264',
    '-preset',
    'medium',
    '-crf',
    '14',
    '-pix_fmt',
    'yuv420p',
    ...(hyperFramesHasAudio ? ['-c:a', 'aac', '-b:a', '256k'] : []),
    '-movflags',
    '+faststart',
    alignedPath,
  ]);

  const alignedProbe = await probe(alignedPath);
  if (Math.abs(duration(alignedProbe) - targetDuration) > frameTolerance) {
    throw new Error('Aligned HyperFrames video duration does not match Final video');
  }

  const outputs: Array<HyperFramesVideoCut & { outputPath: string }> = [];
  for (const cut of cuts) {
    const outputPath = path.join(
      workingDirectory,
      `hyperframes-scene-${cut.sceneId}.mp4`,
    );
    const clipFilters = [
      `[0:v]trim=start=${cut.startTime.toFixed(6)}:end=${cut.endTime.toFixed(6)},setpts=PTS-STARTPTS[v]`,
      ...(hyperFramesHasAudio
        ? [
            `[0:a]atrim=start=${cut.startTime.toFixed(6)}:end=${cut.endTime.toFixed(6)},asetpts=PTS-STARTPTS[a]`,
          ]
        : []),
    ];
    await run('ffmpeg', [
      '-hide_banner',
      '-loglevel',
      'error',
      '-i',
      alignedPath,
      '-filter_complex',
      clipFilters.join(';'),
      '-map',
      '[v]',
      ...(hyperFramesHasAudio ? ['-map', '[a]'] : ['-an']),
      '-t',
      cut.duration.toFixed(6),
      '-c:v',
      'libx264',
      '-preset',
      'medium',
      '-crf',
      '14',
      '-pix_fmt',
      'yuv420p',
      ...(hyperFramesHasAudio ? ['-c:a', 'aac', '-b:a', '256k'] : []),
      '-movflags',
      '+faststart',
      outputPath,
    ]);

    const outputProbe = await probe(outputPath);
    if (Math.abs(duration(outputProbe) - cut.duration) > frameTolerance) {
      throw new Error(
        `HyperFrames clip for scene ${cut.sceneId} does not match its Final cut duration`,
      );
    }
    if (Math.abs(frameRate(outputProbe) - finalFrameRate) > 0.02) {
      throw new Error(
        `HyperFrames clip for scene ${cut.sceneId} does not match the Final frame rate`,
      );
    }
    const outputDimensions = dimensions(outputProbe);
    if (
      outputDimensions.width !== finalDimensions.width ||
      outputDimensions.height !== finalDimensions.height
    ) {
      throw new Error(
        `HyperFrames clip for scene ${cut.sceneId} does not match the Final dimensions`,
      );
    }
    outputs.push({ ...cut, outputPath });
  }

  return {
    outputs,
    finalDuration,
    hyperFramesDuration,
    targetDuration,
    stretchFactor,
    frameRate: finalFrameRate,
  };
}
