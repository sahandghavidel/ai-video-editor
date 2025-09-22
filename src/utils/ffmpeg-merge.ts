import { exec } from 'child_process';
import { promisify } from 'util';
import path from 'path';
import { access, unlink, writeFile } from 'fs/promises';
import { uploadToMinio } from './ffmpeg-direct';

const execAsync = promisify(exec);

export interface ConcatenateOptions {
  videoUrls: string[];
  outputPath?: string;
  useHardwareAcceleration?: boolean;
  videoBitrate?: string;
}

/**
 * Fast video concatenation using FFmpeg with direct HTTP URLs
 * This approach directly uses HTTP URLs like the NCA toolkit
 */
export async function concatenateVideosWithFFmpeg(
  options: ConcatenateOptions
): Promise<string> {
  const {
    videoUrls,
    outputPath,
    useHardwareAcceleration = true,
    videoBitrate = '6000k',
  } = options;

  if (!videoUrls || videoUrls.length === 0) {
    throw new Error('At least one video URL is required for concatenation');
  }

  if (videoUrls.length === 1) {
    // If only one video, just return the URL (no concatenation needed)
    return videoUrls[0];
  }

  // Create a unique output filename
  const outputFileName =
    outputPath ||
    `merged_${Date.now()}_${Math.random().toString(36).substr(2, 9)}.mp4`;
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
        `[MERGE] Starting merge of ${videoUrls.length} videos using ${attempt} encoding`
      );

      // Build FFmpeg command with multiple inputs (direct HTTP URLs)
      const ffmpegCommand = ['ffmpeg', '-y']; // Overwrite output

      // Add all video URLs as inputs
      videoUrls.forEach((url) => {
        ffmpegCommand.push('-i', `"${url}"`);
      });

      // Build filter complex for concatenation
      // For n videos: [0:v][0:a][1:v][1:a]...[n-1:v][n-1:a]concat=n=n:v=1:a=1[outv][outa]
      const videoInputs = videoUrls
        .map((_, index) => `[${index}:v][${index}:a]`)
        .join('');
      const filterComplex = `"${videoInputs}concat=n=${videoUrls.length}:v=1:a=1[outv][outa]"`;

      ffmpegCommand.push('-filter_complex', filterComplex);
      ffmpegCommand.push('-map', '[outv]', '-map', '[outa]');
      if (isHardware) {
        ffmpegCommand.push(
          '-c:v',
          'h264_videotoolbox',
          '-b:v',
          videoBitrate,
          '-allow_sw',
          '1',
          '-realtime',
          '0'
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

      // Audio encoding (same as other functions for consistency)
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
      const execStartTime = Date.now();

      const { stdout, stderr } = await execAsync(commandString, {
        timeout: 300000, // 5 minute timeout for merging
        maxBuffer: 1024 * 1024 * 10, // 10MB buffer for large stderr output
      });

      const execEndTime = Date.now();
      console.log(
        `FFmpeg merge completed in ${
          execEndTime - execStartTime
        }ms (${attempt} encoding, ${videoUrls.length} videos)`
      );

      // Check if output file exists
      await access(fullOutputPath);

      return fullOutputPath;
    } catch (error) {
      console.error(`FFmpeg ${attempt} merge encoding failed:`, error);

      // Clean up output file if it exists
      try {
        await unlink(fullOutputPath);
      } catch (cleanupError) {
        // Ignore cleanup errors
      }

      // If this was the last attempt, throw the error
      if (i === attempts.length - 1) {
        throw new Error(
          `FFmpeg merge processing failed after ${attempts.length} attempts: ${
            error instanceof Error ? error.message : 'Unknown error'
          }`
        );
      }
    }
  }

  throw new Error('FFmpeg merge processing failed: No successful attempts');
}

/**
 * Complete workflow: FFmpeg concatenate + MinIO upload + local cleanup
 */
export async function concatenateVideosWithUpload(
  options: ConcatenateOptions & {
    sceneIds?: string[];
    cleanup?: boolean;
  }
): Promise<{ localPath: string; uploadUrl: string }> {
  const { sceneIds, cleanup = true, ...concatOptions } = options;

  let localPath: string | null = null;

  try {
    // Step 1: Concatenate the videos using FFmpeg
    localPath = await concatenateVideosWithFFmpeg(concatOptions);

    // Step 2: Generate filename for upload
    const timestamp = Date.now();
    const filename =
      sceneIds && sceneIds.length > 0
        ? `merged_scenes_${sceneIds.join('_')}_${timestamp}.mp4`
        : `merged_video_${timestamp}.mp4`;

    // Step 3: Upload to MinIO
    const uploadUrl = await uploadToMinio(localPath, filename, 'video/mp4');

    // Step 4: Cleanup local file if requested
    if (cleanup && localPath) {
      try {
        await unlink(localPath);
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

/**
 * Fast concatenation using HTTP URLs directly with concat demuxer (like NCA toolkit)
 * Uses protocol_whitelist to allow HTTP URLs with concat demuxer
 */
export async function concatenateVideosFast(
  videoUrls: string[],
  outputPath?: string
): Promise<string> {
  if (!videoUrls || videoUrls.length === 0) {
    throw new Error('At least one video URL is required for concatenation');
  }

  if (videoUrls.length === 1) {
    return videoUrls[0];
  }

  const outputFileName =
    outputPath ||
    `merged_fast_${Date.now()}_${Math.random().toString(36).substr(2, 9)}.mp4`;
  const fullOutputPath = path.resolve('/tmp', outputFileName);
  const concatListPath = path.resolve('/tmp', `concat_fast_${Date.now()}.txt`);

  try {
    console.log(
      `[MERGE] Creating concat list for ${videoUrls.length} HTTP URLs...`
    );

    // Create concat list file content with HTTP URLs directly
    const concatListContent = videoUrls
      .map((url) => `file '${url}'`)
      .join('\n');

    await writeFile(concatListPath, concatListContent, 'utf8');

    // Use concat demuxer with protocol whitelist to allow HTTP URLs (like NCA toolkit)
    const ffmpegCommand = [
      'ffmpeg',
      '-y',
      '-protocol_whitelist',
      'file,http,https,tcp,tls,crypto', // Allow HTTP protocols
      '-f',
      'concat',
      '-safe',
      '0',
      '-i',
      `"${concatListPath}"`,
      '-c',
      'copy', // Copy streams without re-encoding - FASTEST!
      `"${fullOutputPath}"`,
    ];

    const commandString = ffmpegCommand.join(' ');
    const execStartTime = Date.now();

    console.log(
      `[MERGE] Running FFmpeg concat with HTTP URLs (NCA toolkit style)...`
    );

    const { stdout, stderr } = await execAsync(commandString, {
      timeout: 120000, // 2 minute timeout for fast copy
      maxBuffer: 1024 * 1024 * 10, // 10MB buffer for large stderr output
    });

    const execEndTime = Date.now();
    console.log(
      `[MERGE] FFmpeg fast merge completed in ${
        execEndTime - execStartTime
      }ms (HTTP URLs + copy mode, ${videoUrls.length} videos)`
    );

    // Check if output file exists
    await access(fullOutputPath);

    return fullOutputPath;
  } catch (error) {
    console.error('FFmpeg fast merge with HTTP URLs failed:', error);

    // Clean up output file if it exists
    try {
      await unlink(fullOutputPath);
    } catch (cleanupError) {
      // Ignore cleanup errors
    }

    throw new Error(
      `FFmpeg fast merge failed: ${
        error instanceof Error ? error.message : 'Unknown error'
      }`
    );
  } finally {
    // Clean up concat list file
    try {
      await unlink(concatListPath);
    } catch (cleanupError) {
      // Ignore cleanup errors
    }
  }
}
