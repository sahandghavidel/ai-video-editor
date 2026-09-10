import { spawn } from 'child_process';
import path from 'path';
import { access, unlink, writeFile } from 'fs/promises';

export const DUBBED_AUDIO_SCENE_BATCH_SIZE = 30000;

const AUDIO_SAMPLE_RATE = 48000;
const AUDIO_CHANNELS = 2;
const AUDIO_BITRATE = '192k';
const DEFAULT_FFMPEG_TIMEOUT_MS = 60 * 60 * 1000;

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

async function runFfmpeg(args: string[]): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const child = spawn('ffmpeg', args, {
      stdio: ['ignore', 'ignore', 'pipe'],
    });
    let stderr = '';
    let settled = false;

    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      child.kill('SIGKILL');
      reject(
        new Error(`ffmpeg timed out after ${DEFAULT_FFMPEG_TIMEOUT_MS}ms`),
      );
    }, DEFAULT_FFMPEG_TIMEOUT_MS);

    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
      if (stderr.length > 20_000) {
        stderr = stderr.slice(-20_000);
      }
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
        resolve();
        return;
      }

      reject(
        new Error(
          `ffmpeg failed with code ${code}${stderr.trim() ? `: ${stderr.trim().slice(-2000)}` : ''}`,
        ),
      );
    });
  });
}

/**
 * Concatenate one ordered group of scene WAV inputs and encode it to the same
 * M4A format used by the cross-video dubbed-audio merge.
 *
 * Inputs must be local WAV files so FFmpeg's concat demuxer can read them
 * sequentially without opening thousands of files at once. This helper only
 * deletes temporary files that it creates itself; it never deletes an input.
 */
export async function createDubbedAudioM4aBatch(options: {
  inputPaths: string[];
  videoId: number;
  batchIndex: number;
}): Promise<string> {
  const { inputPaths, videoId, batchIndex } = options;

  if (inputPaths.length === 0) {
    throw new Error('Cannot create a dubbed-audio batch without scene audio');
  }

  if (inputPaths.length > DUBBED_AUDIO_SCENE_BATCH_SIZE) {
    throw new Error(
      `Dubbed-audio batch ${batchIndex} contains ${inputPaths.length} inputs; maximum is ${DUBBED_AUDIO_SCENE_BATCH_SIZE}`,
    );
  }

  const batchWavPath = makeTempPath(
    `video_${videoId}_dubbed_audio_batch_${batchIndex}`,
    'wav',
  );
  const concatListPath = makeTempPath(
    `video_${videoId}_dubbed_audio_batch_${batchIndex}_concat`,
    'txt',
  );
  const batchM4aPath = makeTempPath(
    `video_${videoId}_dubbed_audio_batch_${batchIndex}`,
    'm4a',
  );

  try {
    const listContent = inputPaths
      .map((inputPath) => `file '${inputPath}'`)
      .join('\n');
    await writeFile(concatListPath, listContent, 'utf8');

    await runFfmpeg([
      '-y',
      '-f',
      'concat',
      '-safe',
      '0',
      '-i',
      concatListPath,
      '-vn',
      '-map_metadata',
      '-1',
      '-map_chapters',
      '-1',
      '-c:a',
      'pcm_s16le',
      '-ar',
      String(AUDIO_SAMPLE_RATE),
      '-ac',
      String(AUDIO_CHANNELS),
      '-rf64',
      'auto',
      batchWavPath,
    ]);
    await access(batchWavPath);

    await runFfmpeg([
      '-y',
      '-i',
      batchWavPath,
      '-vn',
      '-map_metadata',
      '-1',
      '-map_chapters',
      '-1',
      '-c:a',
      'aac',
      '-b:a',
      AUDIO_BITRATE,
      '-ar',
      String(AUDIO_SAMPLE_RATE),
      '-ac',
      String(AUDIO_CHANNELS),
      '-threads',
      '0',
      batchM4aPath,
    ]);
    await access(batchM4aPath);

    return batchM4aPath;
  } catch (error) {
    await safeUnlink(batchM4aPath);
    throw error;
  } finally {
    await safeUnlink(concatListPath);
    await safeUnlink(batchWavPath);
  }
}

/** Concatenate one ordered group of scene WAV inputs into a temporary WAV. */
export async function createDubbedAudioWavBatch(options: {
  inputPaths: string[];
  videoId: number;
  batchIndex: number;
}): Promise<string> {
  const { inputPaths, videoId, batchIndex } = options;

  if (inputPaths.length === 0) {
    throw new Error('Cannot create a dubbed-audio WAV batch without scene audio');
  }

  if (inputPaths.length > DUBBED_AUDIO_SCENE_BATCH_SIZE) {
    throw new Error(
      `Dubbed-audio WAV batch ${batchIndex} contains ${inputPaths.length} inputs; maximum is ${DUBBED_AUDIO_SCENE_BATCH_SIZE}`,
    );
  }

  const batchWavPath = makeTempPath(
    `video_${videoId}_dubbed_audio_wav_batch_${batchIndex}`,
    'wav',
  );
  const concatListPath = makeTempPath(
    `video_${videoId}_dubbed_audio_wav_batch_${batchIndex}_concat`,
    'txt',
  );

  try {
    const listContent = inputPaths
      .map((inputPath) => `file '${inputPath}'`)
      .join('\n');
    await writeFile(concatListPath, listContent, 'utf8');

    await runFfmpeg([
      '-y',
      '-f',
      'concat',
      '-safe',
      '0',
      '-i',
      concatListPath,
      '-vn',
      '-map_metadata',
      '-1',
      '-map_chapters',
      '-1',
      '-c:a',
      'pcm_s16le',
      '-ar',
      String(AUDIO_SAMPLE_RATE),
      '-ac',
      String(AUDIO_CHANNELS),
      '-rf64',
      'auto',
      batchWavPath,
    ]);
    await access(batchWavPath);

    return batchWavPath;
  } catch (error) {
    await safeUnlink(batchWavPath);
    throw error;
  } finally {
    await safeUnlink(concatListPath);
  }
}

/** Concatenate consistently encoded M4A batches without another re-encode. */
export async function concatenateDubbedAudioM4aBatches(options: {
  batchPaths: string[];
  videoId: number;
}): Promise<string> {
  const { batchPaths, videoId } = options;

  if (batchPaths.length === 0) {
    throw new Error('No dubbed-audio M4A batches to concatenate');
  }

  if (batchPaths.length === 1) {
    return batchPaths[0];
  }

  const concatListPath = makeTempPath(
    `video_${videoId}_dubbed_audio_m4a_concat`,
    'txt',
  );
  const outputPath = makeTempPath(`video_${videoId}_final_dubbed_audio`, 'm4a');

  try {
    const listContent = batchPaths
      .map((batchPath) => `file '${batchPath}'`)
      .join('\n');
    await writeFile(concatListPath, listContent, 'utf8');

    await runFfmpeg([
      '-y',
      '-f',
      'concat',
      '-safe',
      '0',
      '-i',
      concatListPath,
      '-c',
      'copy',
      outputPath,
    ]);
    await access(outputPath);

    return outputPath;
  } catch (error) {
    await safeUnlink(outputPath);
    throw error;
  } finally {
    await safeUnlink(concatListPath);
  }
}

/** Concatenate consistently encoded WAV batches into one RF64-capable WAV. */
export async function concatenateDubbedAudioWavBatches(options: {
  batchPaths: string[];
  videoId: number;
}): Promise<string> {
  const { batchPaths, videoId } = options;

  if (batchPaths.length === 0) {
    throw new Error('No dubbed-audio WAV batches to concatenate');
  }

  if (batchPaths.length === 1) {
    return batchPaths[0];
  }

  const concatListPath = makeTempPath(
    `video_${videoId}_dubbed_audio_wav_concat`,
    'txt',
  );
  const outputPath = makeTempPath(`video_${videoId}_final_dubbed_audio`, 'wav');

  try {
    const listContent = batchPaths
      .map((batchPath) => `file '${batchPath}'`)
      .join('\n');
    await writeFile(concatListPath, listContent, 'utf8');

    await runFfmpeg([
      '-y',
      '-f',
      'concat',
      '-safe',
      '0',
      '-i',
      concatListPath,
      '-vn',
      '-map_metadata',
      '-1',
      '-map_chapters',
      '-1',
      '-c:a',
      'pcm_s16le',
      '-ar',
      String(AUDIO_SAMPLE_RATE),
      '-ac',
      String(AUDIO_CHANNELS),
      '-rf64',
      'auto',
      outputPath,
    ]);
    await access(outputPath);

    return outputPath;
  } catch (error) {
    await safeUnlink(outputPath);
    throw error;
  } finally {
    await safeUnlink(concatListPath);
  }
}
