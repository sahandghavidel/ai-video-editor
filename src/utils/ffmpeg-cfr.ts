import { spawn } from 'child_process';
import path from 'path';
import { readFile, access, unlink } from 'fs/promises';

const FFMPEG_TIMEOUT_MS = 600000; // 10 minutes
const FFMPEG_STDERR_TAIL_MAX_CHARS = 8000;

function appendTail(current: string, chunk: string, maxChars: number): string {
  const combined = `${current}${chunk}`;
  return combined.length > maxChars
    ? combined.slice(combined.length - maxChars)
    : combined;
}

function formatCommandForLog(command: string, args: string[]): string {
  const formattedArgs = args.map((arg) => {
    if (/\s/.test(arg)) {
      return `"${arg.replace(/"/g, '\\"')}"`;
    }
    return arg;
  });

  return [command, ...formattedArgs].join(' ');
}

async function runFfmpegStreaming(args: string[]): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    let settled = false;
    let stderrTail = '';

    const ffmpegProcess = spawn('ffmpeg', args, {
      stdio: ['ignore', 'ignore', 'pipe'],
    });

    const timeoutHandle = setTimeout(() => {
      ffmpegProcess.kill('SIGTERM');

      const forcedKillTimeout = setTimeout(() => {
        ffmpegProcess.kill('SIGKILL');
      }, 5000);
      forcedKillTimeout.unref();

      const trimmedTail = stderrTail.trim();

      finalize(
        new Error(
          trimmedTail
            ? `FFmpeg timed out after ${FFMPEG_TIMEOUT_MS}ms. stderr tail:\n${trimmedTail}`
            : `FFmpeg timed out after ${FFMPEG_TIMEOUT_MS}ms`,
        ),
      );
    }, FFMPEG_TIMEOUT_MS);

    const finalize = (error?: Error) => {
      if (settled) {
        return;
      }

      settled = true;
      clearTimeout(timeoutHandle);

      if (error) {
        reject(error);
        return;
      }

      resolve();
    };

    ffmpegProcess.stderr?.on('data', (chunk: Buffer | string) => {
      stderrTail = appendTail(
        stderrTail,
        chunk.toString(),
        FFMPEG_STDERR_TAIL_MAX_CHARS,
      );
    });

    ffmpegProcess.on('error', (error) => {
      finalize(new Error(`Failed to start FFmpeg: ${error.message}`));
    });

    ffmpegProcess.on('close', (code, signal) => {
      if (code === 0) {
        finalize();
        return;
      }

      const closeReason = signal
        ? `FFmpeg exited due to signal ${signal}`
        : `FFmpeg exited with code ${code ?? 'unknown'}`;
      const trimmedTail = stderrTail.trim();

      finalize(
        new Error(
          trimmedTail
            ? `${closeReason}. stderr tail:\n${trimmedTail}`
            : closeReason,
        ),
      );
    });
  });
}

export interface ConvertToCFROptions {
  inputUrl: string;
  outputPath?: string;
  framerate?: number; // Target framerate (default: 30)
}

/**
 * Convert video to Constant Frame Rate (CFR) using FFmpeg
 */
export async function convertToCFR(
  options: ConvertToCFROptions,
): Promise<string> {
  const { inputUrl, outputPath, framerate = 30 } = options;

  // Create a unique output filename
  const outputFileName =
    outputPath ||
    `cfr_${Date.now()}_${Math.random().toString(36).substr(2, 9)}.mp4`;
  const fullOutputPath = path.resolve('/tmp', outputFileName);

  try {
    console.log(`Starting CFR conversion for: ${inputUrl}`);
    console.log(`Target framerate: ${framerate}fps`);

    // FFmpeg command to convert to CFR
    // -r sets the framerate
    // -vsync cfr forces constant frame rate
    // -pix_fmt yuv420p ensures compatibility
    const cfrArgs = [
      '-y',
      '-i',
      inputUrl,
      '-r',
      framerate.toString(),
      '-vsync',
      'cfr',
      '-pix_fmt',
      'yuv420p',
      '-c:v',
      'libx264',
      '-preset',
      'medium',
      '-crf',
      '20',
      '-c:a',
      'aac',
      '-b:a',
      '128k',
      '-ar',
      '48000',
      '-ac',
      '2',
      fullOutputPath,
    ];

    const cfrCommandString = formatCommandForLog('ffmpeg', cfrArgs);
    console.log(`Running CFR conversion command: ${cfrCommandString}`);

    const execStartTime = Date.now();
    await runFfmpegStreaming(cfrArgs);

    const execEndTime = Date.now();
    console.log(`CFR conversion completed in ${execEndTime - execStartTime}ms`);

    // Check if output file exists
    await access(fullOutputPath);

    console.log(`CFR video saved to: ${fullOutputPath}`);
    return fullOutputPath;
  } catch (error) {
    console.error('CFR conversion failed:', error);

    // Clean up output file if it exists
    try {
      await unlink(fullOutputPath);
    } catch {
      // Ignore cleanup errors
    }

    throw new Error(
      `CFR conversion failed: ${
        error instanceof Error ? error.message : 'Unknown error'
      }`,
    );
  }
}

/**
 * Upload a file to MinIO storage
 */
export async function uploadToMinio(
  filePath: string,
  filename?: string,
  contentType: string = 'video/mp4',
): Promise<string> {
  try {
    const minioBaseUrl = process.env.MINIO_BASE_URL?.trim();
    const minioBucket = process.env.MINIO_BUCKET?.trim();
    if (!minioBaseUrl || !minioBucket) {
      throw new Error(
        'Missing MinIO configuration. Set MINIO_BASE_URL and MINIO_BUCKET in .env.local',
      );
    }

    // Read the file as Buffer (which works with fetch)
    const fileBuffer = await readFile(filePath);

    // Generate filename if not provided
    const finalFilename =
      filename ||
      `cfr_${Date.now()}_${Math.random().toString(36).substr(2, 9)}.mp4`;

    // MinIO configuration
    const uploadUrl = `${minioBaseUrl.replace(/\/+$/, '')}/${minioBucket}/${finalFilename}`;

    // Upload to MinIO using direct HTTP PUT (convert Buffer to Uint8Array)
    const uploadResponse = await fetch(uploadUrl, {
      method: 'PUT',
      headers: {
        'Content-Type': contentType,
      },
      body: new Uint8Array(fileBuffer),
    });

    if (!uploadResponse.ok) {
      const errorText = await uploadResponse.text();
      console.error('MinIO upload error:', errorText);
      throw new Error(`MinIO upload error: ${uploadResponse.status}`);
    }

    return uploadUrl;
  } catch (error) {
    console.error('Error uploading to MinIO:', error);
    throw new Error(
      `MinIO upload failed: ${
        error instanceof Error ? error.message : 'Unknown error'
      }`,
    );
  }
}

/**
 * Complete workflow: CFR conversion + MinIO upload + local cleanup
 */
export async function convertToCFRWithUpload(
  options: ConvertToCFROptions & {
    videoId?: string;
    sceneId?: string;
    cleanup?: boolean;
  },
): Promise<{ localPath: string; uploadUrl: string }> {
  const { videoId, sceneId, cleanup = true, ...cfrOptions } = options;

  let localPath: string | null = null;

  try {
    // Step 1: Convert to CFR using FFmpeg
    localPath = await convertToCFR(cfrOptions);

    // Step 2: Generate filename for upload
    const timestamp = Date.now();
    const filename =
      videoId && sceneId
        ? `video_${videoId}_scene_${sceneId}_cfr_${timestamp}.mp4`
        : videoId
          ? `video_${videoId}_cfr_${timestamp}.mp4`
          : `cfr_${timestamp}.mp4`;

    // Step 3: Upload to MinIO
    const uploadUrl = await uploadToMinio(localPath, filename, 'video/mp4');

    // Step 4: Cleanup local file if requested
    if (cleanup && localPath) {
      try {
        await unlink(localPath);
        console.log(`Cleaned up local CFR file: ${localPath}`);
      } catch (cleanupError) {
        console.warn(`Failed to cleanup local file: ${cleanupError}`);
      }
    }

    return {
      localPath: cleanup ? '' : localPath,
      uploadUrl,
    };
  } catch (error) {
    // Cleanup on error
    if (localPath) {
      try {
        await unlink(localPath);
      } catch {
        // Ignore cleanup errors
      }
    }

    throw error;
  }
}
