import { exec } from 'child_process';
import { promisify } from 'util';
import path from 'path';
import { readFile, access, unlink } from 'fs/promises';

const execAsync = promisify(exec);

export interface TrimOptions {
  inputUrl: string;
  startTime: string;
  endTime: string;
  outputPath?: string;
  useHardwareAcceleration?: boolean;
  videoBitrate?: string;
}

export async function trimVideoWithFFmpeg(
  options: TrimOptions
): Promise<string> {
  const {
    inputUrl,
    startTime: startTimeStr,
    endTime: endTimeStr,
    outputPath,
    useHardwareAcceleration = true,
    videoBitrate = '6000k',
  } = options;

  // Create a unique output filename
  const outputFileName =
    outputPath ||
    `clip_${Date.now()}_${Math.random().toString(36).substr(2, 9)}.mp4`;
  const fullOutputPath = path.resolve('/tmp', outputFileName);

  // Try hardware acceleration first, then fallback to software
  const attempts = useHardwareAcceleration
    ? ['hardware', 'software']
    : ['software'];

  for (let i = 0; i < attempts.length; i++) {
    const attempt = attempts[i];
    const isHardware = attempt === 'hardware';

    try {
      console.log(
        `[FFMPEG] Attempt ${i + 1}/${attempts.length}: ${attempt} encoding`
      );

      // Calculate duration
      const duration = parseFloat(endTimeStr) - parseFloat(startTimeStr);

      // Build FFmpeg command
      const ffmpegCommand = [
        'ffmpeg',
        '-y', // Overwrite output file
        '-ss',
        startTimeStr, // Seek to start time BEFORE input (faster)
        '-i',
        `"${inputUrl}"`, // Input file
        '-t',
        duration.toString(), // Duration instead of end time
      ];

      // Add video encoding options
      if (isHardware) {
        ffmpegCommand.push(
          '-c:v',
          'h264_videotoolbox', // Hardware accelerated H.264 encoding
          '-b:v',
          videoBitrate, // Video bitrate (required for videotoolbox)
          '-allow_sw',
          '1', // Allow software fallback if hardware fails
          '-realtime',
          '0' // Disable realtime encoding for better quality
        );
      } else {
        ffmpegCommand.push(
          '-c:v',
          'libx264',
          '-preset',
          'medium',
          '-crf',
          '23'
        );
      }

      // Add audio encoding options
      ffmpegCommand.push(
        '-c:a',
        'aac',
        '-b:a',
        '128k',
        '-avoid_negative_ts',
        'make_zero',
        `"${fullOutputPath}"`
      );

      const commandString = ffmpegCommand.join(' ');
      console.log(`Executing FFmpeg command (${attempt}): ${commandString}`);
      const execStartTime = Date.now();

      const { stdout, stderr } = await execAsync(commandString, {
        timeout: 120000, // 2 minute timeout
      });

      const execEndTime = Date.now();
      console.log(
        `FFmpeg completed in ${
          execEndTime - execStartTime
        }ms (${attempt} encoding)`
      );

      if (stderr) {
        console.log('FFmpeg stderr:', stderr);
      }

      // Check if output file exists
      await access(fullOutputPath);

      return fullOutputPath;
    } catch (error) {
      console.error(`FFmpeg ${attempt} encoding failed:`, error);

      // Clean up output file if it exists
      try {
        await unlink(fullOutputPath);
      } catch (cleanupError) {
        // Ignore cleanup errors
      }

      // If this was the last attempt, throw the error
      if (i === attempts.length - 1) {
        throw new Error(
          `FFmpeg processing failed after ${attempts.length} attempts: ${
            error instanceof Error ? error.message : 'Unknown error'
          }`
        );
      }

      // Otherwise, continue to next attempt
      console.log(`Retrying with ${attempts[i + 1]} encoding...`);
    }
  }

  // This should never be reached, but just in case
  throw new Error('FFmpeg processing failed: No successful attempts');
}

export async function trimMultipleVideosWithFFmpeg(
  inputUrl: string,
  segments: Array<{ start: string; end: string; id: string }>,
  useHardwareAcceleration: boolean = true,
  videoBitrate: string = '6000k'
): Promise<string[]> {
  const results: string[] = [];

  for (const segment of segments) {
    try {
      const outputPath = await trimVideoWithFFmpeg({
        inputUrl,
        startTime: segment.start,
        endTime: segment.end,
        outputPath: `clip_${segment.id}_${Date.now()}.mp4`,
        useHardwareAcceleration,
        videoBitrate,
      });
      results.push(outputPath);
    } catch (error) {
      console.error(`Failed to process segment ${segment.id}:`, error);
      throw error;
    }
  }

  return results;
}

/**
 * Upload a file to MinIO storage using the same pattern as other endpoints
 */
export async function uploadToMinio(
  filePath: string,
  filename?: string,
  contentType: string = 'video/mp4'
): Promise<string> {
  try {
    // Read the file as Buffer (which works with fetch)
    const fileBuffer = await readFile(filePath);

    // Generate filename if not provided
    const finalFilename =
      filename ||
      `clip_${Date.now()}_${Math.random().toString(36).substr(2, 9)}.mp4`;

    // MinIO configuration (same as other endpoints)
    const bucket = 'nca-toolkit';
    const uploadUrl = `http://host.docker.internal:9000/${bucket}/${finalFilename}`;

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

    console.log(`Successfully uploaded to MinIO: ${uploadUrl}`);
    return uploadUrl;
  } catch (error) {
    console.error('Error uploading to MinIO:', error);
    throw new Error(
      `MinIO upload failed: ${
        error instanceof Error ? error.message : 'Unknown error'
      }`
    );
  }
}

/**
 * Complete workflow: FFmpeg trim + MinIO upload + local cleanup
 */
export async function createVideoClipWithUpload(
  options: TrimOptions & {
    sceneId?: string;
    cleanup?: boolean;
  }
): Promise<{ localPath: string; uploadUrl: string }> {
  const { sceneId, cleanup = true, ...trimOptions } = options;

  let localPath: string | null = null;

  try {
    // Step 1: Create the clip using FFmpeg
    localPath = await trimVideoWithFFmpeg(trimOptions);

    // Step 2: Generate filename for upload
    const timestamp = Date.now();
    const filename = sceneId
      ? `scene_${sceneId}_${timestamp}.mp4`
      : `clip_${timestamp}.mp4`;

    // Step 3: Upload to MinIO
    const uploadUrl = await uploadToMinio(localPath, filename, 'video/mp4');

    // Step 4: Cleanup local file if requested
    if (cleanup && localPath) {
      try {
        await unlink(localPath);
        console.log(`Cleaned up local file: ${localPath}`);
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
      } catch (cleanupError) {
        // Ignore cleanup errors
      }
    }

    throw error;
  }
}
