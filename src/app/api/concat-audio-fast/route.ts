import { NextRequest, NextResponse } from 'next/server';
import { exec } from 'child_process';
import { promisify } from 'util';
import path from 'path';
import { unlink, writeFile } from 'fs/promises';
import { cpus } from 'os';
import { uploadToMinio } from '@/utils/ffmpeg-direct';

const execAsync = promisify(exec);

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 3600;

/**
 * Parallel audio concatenation with full CPU utilisation.
 *
 * Strategy (maximises multi-core usage):
 * 1. Download all input files in parallel (async I/O).
 * 2. Re-encode each file → local M4A chunk in its own FFmpeg process.
 *    Each process uses all cores via -threads 0, and we spawn them
 *    concurrently so total CPU usage ≈ numCores × numFiles (capped).
 * 3. Concat the local chunks with -c copy (fast, no re-encode).
 *
 * Outputs M4A because WAV 32-bit headers cap at ~4 GB.
 */

const CPU_COUNT = cpus().length;

type AudioUrlInput = string | { audio_url: string };

async function deleteFileFromMinio(fileUrl: string): Promise<boolean> {
  if (!fileUrl || typeof fileUrl !== 'string') return false;
  try {
    const response = await fetch(fileUrl, { method: 'DELETE' });
    if (response.ok) {
      console.log(`[AUDIO-CONCAT] Deleted old file: ${fileUrl}`);
      return true;
    }
    console.warn(
      `[AUDIO-CONCAT] Delete failed (${response.status}): ${fileUrl}`,
    );
    return false;
  } catch (error) {
    console.error(`[AUDIO-CONCAT] Error deleting ${fileUrl}:`, error);
    return false;
  }
}

/**
 * Download a remote file to a local path in parallel.
 */
async function downloadFile(url: string, localPath: string): Promise<void> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to download ${url}: ${response.status}`);
  }
  const buffer = Buffer.from(await response.arrayBuffer());
  await writeFile(localPath, buffer);
}

/**
 * Re-encode a single audio file to a local M4A chunk using all CPU cores.
 * Each invocation is a separate OS process, so running N of these in parallel
 * gives ~N × cores worth of CPU utilisation.
 */
async function reencodeToChunk(
  inputPath: string,
  outputPath: string,
  index: number,
): Promise<void> {
  const cmd = [
    'ffmpeg',
    '-y',
    '-i',
    `"${inputPath}"`,
    '-vn',
    '-map_metadata',
    '-1',
    '-map_chapters',
    '-1',
    '-c:a',
    'aac',
    '-b:a',
    '192k',
    '-ar',
    '48000',
    '-ac',
    '2',
    '-threads',
    '0',
    `"${outputPath}"`,
  ].join(' ');

  const start = Date.now();
  await execAsync(cmd, {
    timeout: 3_600_000,
    maxBuffer: 1024 * 1024 * 10,
  });
  console.log(
    `[AUDIO-CONCAT] Chunk ${index} re-encoded in ${Date.now() - start}ms`,
  );
}

/**
 * Concat local M4A files with -c copy (no re-encode, near-instant).
 */
async function concatLocalChunks(
  chunkPaths: string[],
  outputPath: string,
): Promise<void> {
  const timestamp = Date.now();
  const concatListPath = path.resolve('/tmp', `concat_list_${timestamp}.txt`);

  const listContent = chunkPaths.map((p) => `file '${p}'`).join('\n');
  await writeFile(concatListPath, listContent, 'utf8');

  try {
    const cmd = [
      'ffmpeg',
      '-y',
      '-f',
      'concat',
      '-safe',
      '0',
      '-i',
      `"${concatListPath}"`,
      '-c',
      'copy',
      `"${outputPath}"`,
    ].join(' ');

    await execAsync(cmd, {
      timeout: 600_000,
      maxBuffer: 1024 * 1024 * 10,
    });
  } finally {
    try {
      await unlink(concatListPath);
    } catch {
      // cleanup best-effort
    }
  }
}

export async function POST(request: NextRequest) {
  const tempFiles: string[] = [];

  try {
    const { audio_urls, id, old_merged_url } = await request.json();

    if (!audio_urls || !Array.isArray(audio_urls) || audio_urls.length === 0) {
      return NextResponse.json(
        { error: 'audio_urls array is required and must not be empty' },
        { status: 400 },
      );
    }

    const urls: string[] = audio_urls.map((item: AudioUrlInput) => {
      if (typeof item === 'string') return item;
      if (item.audio_url) return item.audio_url;
      throw new Error(
        'Each audio_urls item must be a string URL or { audio_url: string }',
      );
    });

    console.log(
      `[AUDIO-CONCAT] Starting parallel concat of ${urls.length} files (${CPU_COUNT} CPU cores)`,
    );

    if (old_merged_url && typeof old_merged_url === 'string') {
      await deleteFileFromMinio(old_merged_url);
    }

    const startTime = Date.now();
    const timestamp = Date.now();

    // Single file — return directly
    if (urls.length === 1) {
      return NextResponse.json({
        audioUrl: urls[0],
        id: id || `concat_audio_${timestamp}`,
        message: 'Single audio file, no concatenation needed',
        runTime: `${Date.now() - startTime}ms`,
        method: 'passthrough',
      });
    }

    // --- Step 1: Download all files in parallel ---
    console.log(
      `[AUDIO-CONCAT] Downloading ${urls.length} files in parallel...`,
    );
    const downloadStart = Date.now();

    const localInputPaths = urls.map((_, i) =>
      path.resolve(
        '/tmp',
        `concat_input_${timestamp}_${i}_${Math.random().toString(36).slice(2, 8)}`,
      ),
    );

    await Promise.all(
      urls.map((url, i) => downloadFile(url, localInputPaths[i])),
    );
    tempFiles.push(...localInputPaths);

    console.log(
      `[AUDIO-CONCAT] Downloads complete in ${Date.now() - downloadStart}ms`,
    );

    // --- Step 2: Re-encode each file in parallel (each uses all cores) ---
    console.log(
      `[AUDIO-CONCAT] Re-encoding ${urls.length} files in parallel (${CPU_COUNT} cores each)...`,
    );
    const encodeStart = Date.now();

    const chunkPaths = urls.map((_, i) =>
      path.resolve('/tmp', `concat_chunk_${timestamp}_${i}.m4a`),
    );

    // Spawn all FFmpeg processes concurrently — each one saturates all cores.
    // Total CPU usage ≈ min(CPU_COUNT, CPU_COUNT × urls.length).
    await Promise.all(
      localInputPaths.map((inputPath, i) =>
        reencodeToChunk(inputPath, chunkPaths[i], i),
      ),
    );
    tempFiles.push(...chunkPaths);

    console.log(
      `[AUDIO-CONCAT] All chunks re-encoded in ${Date.now() - encodeStart}ms`,
    );

    // --- Step 3: Concat chunks with -c copy (instant, no re-encode) ---
    const outputPath = path.resolve('/tmp', `concat_final_${timestamp}.m4a`);

    console.log(`[AUDIO-CONCAT] Concatenating ${chunkPaths.length} chunks...`);
    const concatStart = Date.now();

    await concatLocalChunks(chunkPaths, outputPath);
    tempFiles.push(outputPath);

    console.log(`[AUDIO-CONCAT] Concat done in ${Date.now() - concatStart}ms`);

    // --- Upload ---
    const audioFilename = `merged_audio_${id || 'unknown'}_${timestamp}.m4a`;
    const uploadUrl = await uploadToMinio(
      outputPath,
      audioFilename,
      'audio/mp4',
    );

    const elapsed = Date.now() - startTime;
    console.log(`[AUDIO-CONCAT] Done in ${elapsed}ms — ${uploadUrl}`);

    return NextResponse.json({
      audioUrl: uploadUrl,
      id: id || `concat_audio_${timestamp}`,
      message: `Successfully concatenated ${urls.length} audio files`,
      runTime: `${elapsed}ms`,
      method: 'parallel_reencode_concat',
    });
  } catch (error) {
    console.error('[AUDIO-CONCAT] Error:', error);
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : 'Unknown error occurred',
      },
      { status: 500 },
    );
  } finally {
    for (const filePath of tempFiles) {
      try {
        await unlink(filePath);
      } catch {
        // best-effort
      }
    }
  }
}
