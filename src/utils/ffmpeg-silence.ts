import { exec } from 'child_process';
import { promisify } from 'util';
import path from 'path';
import { readFile, access, unlink, writeFile } from 'fs/promises';

const execAsync = promisify(exec);

export interface OptimizeSilenceOptions {
  inputUrl: string;
  outputPath?: string;

  // Speed options
  speedRate?: number; // Speed rate for silent parts (e.g., 4 = 4x)
  mute?: boolean; // Mute the sped-up parts

  // Silence Detection options
  soundLevel?: number; // Filter below sound level (dB)
  minSilenceLength?: number; // Minimum silence duration for FFmpeg detection (seconds)
  minSilenceDurationToSpeedUp?: number; // Only speed up silences >= this (after padding, seconds)
  leftPadding?: number; // Left padding - preserve speech BEFORE silence (seconds)
  rightPadding?: number; // Right padding - preserve speech AFTER silence (seconds)
}

/**
 * Optimize silence in video by detecting silent parts and speeding them up
 */
export async function optimizeSilence(
  options: OptimizeSilenceOptions
): Promise<{ outputPath: string; stats: any }> {
  const {
    inputUrl,
    outputPath,
    speedRate = 4,
    mute = true,
    soundLevel = -43,
    minSilenceLength = 0.3,
    minSilenceDurationToSpeedUp = 0.3,
    leftPadding = 0.14,
    rightPadding = 0.26,
  } = options;

  // Create unique output filename
  const outputFileName =
    outputPath ||
    `silence_opt_${Date.now()}_${Math.random().toString(36).substr(2, 9)}.mp4`;
  const fullOutputPath = path.resolve('/tmp', outputFileName);

  try {
    console.log(`Starting silence optimization for: ${inputUrl}`);
    console.log('Options:', {
      soundLevel,
      minSilenceLength,
      minSilenceDurationToSpeedUp,
      leftPadding,
      rightPadding,
      speedRate,
      mute,
    });

    // Step 1: Detect silence using FFmpeg silencedetect filter
    console.log('Step 1: Detecting silence...');

    const detectCommand = [
      'ffmpeg',
      '-i',
      `"${inputUrl}"`,
      '-af',
      `silencedetect=noise=${soundLevel}dB:d=${minSilenceLength}`,
      '-f',
      'null',
      '-',
    ];

    const detectCommandString = detectCommand.join(' ');
    console.log(`Running detection command: ${detectCommandString}`);

    const { stderr: detectStderr } = await execAsync(detectCommandString, {
      timeout: 300000, // 5 minute timeout
    });

    // Parse silence intervals from stderr
    const silenceStarts: number[] = [];
    const silenceEnds: number[] = [];

    const silenceStartRegex = /silence_start: ([\d.]+)/g;
    const silenceEndRegex = /silence_end: ([\d.]+)/g;

    let match;
    while ((match = silenceStartRegex.exec(detectStderr)) !== null) {
      silenceStarts.push(parseFloat(match[1]));
    }
    while ((match = silenceEndRegex.exec(detectStderr)) !== null) {
      silenceEnds.push(parseFloat(match[1]));
    }

    console.log(`Found ${silenceStarts.length} silence intervals`);

    // Log first 10 raw intervals for debugging
    console.log('First 10 raw silence intervals:');
    for (let i = 0; i < Math.min(10, silenceStarts.length); i++) {
      const duration = (silenceEnds[i] || 0) - silenceStarts[i];
      console.log(
        `  [${i}] ${silenceStarts[i].toFixed(3)}s - ${(
          silenceEnds[i] || 0
        ).toFixed(3)}s (duration: ${duration.toFixed(3)}s)`
      );
    }

    // Step 2: Process silence intervals with padding and filtering
    console.log('Step 2: Processing intervals with padding...');
    const processedIntervals: Array<{
      start: number;
      end: number;
      rawStart: number;
      rawEnd: number;
    }> = [];
    let ignoredCount = 0;

    for (
      let i = 0;
      i < Math.min(silenceStarts.length, silenceEnds.length);
      i++
    ) {
      const rawStart = silenceStarts[i];
      const rawEnd = silenceEnds[i];
      const rawDuration = rawEnd - rawStart;

      // Apply padding: shrink the silence interval to preserve voice around it
      // Left padding: start silence LATER (skip first part to keep voice)
      // Right padding: end silence EARLIER (skip last part to keep voice)
      const paddedStart = rawStart + leftPadding;
      const paddedEnd = rawEnd - rightPadding;
      const paddedDuration = paddedEnd - paddedStart;

      // Only process if there's still silence left after padding
      if (paddedDuration <= 0) {
        ignoredCount++;
        console.log(
          `Ignoring - no silence left after padding: ${rawStart.toFixed(
            3
          )}-${rawEnd.toFixed(3)} (padded: ${paddedDuration.toFixed(3)}s)`
        );
        continue;
      }

      // Check: Ignore silences shorter than threshold (based on PADDED duration)
      if (paddedDuration < minSilenceDurationToSpeedUp) {
        ignoredCount++;
        console.log(
          `Ignoring short silence: raw ${rawStart.toFixed(3)}-${rawEnd.toFixed(
            3
          )} | padded: ${paddedDuration.toFixed(
            3
          )}s < ${minSilenceDurationToSpeedUp}s`
        );
        continue;
      }

      // This interval passes all filters - it will be sped up 4x
      processedIntervals.push({
        start: paddedStart,
        end: paddedEnd,
        rawStart: rawStart,
        rawEnd: rawEnd,
      });
    }

    console.log(
      `Result: ${processedIntervals.length} intervals will be sped up 4x, ${ignoredCount} intervals ignored`
    );

    // Log first 10 processed intervals
    console.log('First 10 processed intervals (after padding and filtering):');
    for (let i = 0; i < Math.min(10, processedIntervals.length); i++) {
      const interval = processedIntervals[i];
      const duration = interval.end - interval.start;
      console.log(
        `  [${i}] ${interval.start.toFixed(3)}s - ${interval.end.toFixed(
          3
        )}s (duration: ${duration.toFixed(3)}s)`
      );
    }

    // Step 3: Build complex filter for speeding up and optionally muting silence
    if (processedIntervals.length === 0) {
      console.log('No silence intervals to process, copying video...');

      // No silence to process, just copy the video
      const copyCommand = [
        'ffmpeg',
        '-y',
        '-i',
        `"${inputUrl}"`,
        '-c',
        'copy',
        `"${fullOutputPath}"`,
      ];

      const copyCommandString = copyCommand.join(' ');
      await execAsync(copyCommandString, { timeout: 300000 });

      return {
        outputPath: fullOutputPath,
        stats: {
          silenceIntervals: 0,
          totalSilenceDuration: 0,
        },
      };
    }

    // Step 4: Use a single-pass approach with proper re-encoding to maintain sync
    // This ensures consistent frame rates and no freezing
    console.log('Step 2: Processing video with single-pass encoding...');

    // Get total duration
    const durationCommand = `ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 "${inputUrl}"`;
    const { stdout: durationOutput } = await execAsync(durationCommand);
    const totalDuration = parseFloat(durationOutput.trim());

    // Get video properties for proper encoding
    const videoInfoCommand = `ffprobe -v error -select_streams v:0 -show_entries stream=r_frame_rate,width,height -of default=noprint_wrappers=1 "${inputUrl}"`;
    const { stdout: videoInfo } = await execAsync(videoInfoCommand);

    // Extract frame rate
    const fpsMatch = videoInfo.match(/r_frame_rate=(\d+)\/(\d+)/);
    const fps = fpsMatch ? parseInt(fpsMatch[1]) / parseInt(fpsMatch[2]) : 30;

    // Create segments with proper encoding
    const segmentFiles: string[] = [];
    const segmentTsFiles: string[] = [];
    let currentTime = 0;
    let segmentIndex = 0;

    for (const interval of processedIntervals) {
      // Process normal speed segment before silence
      if (currentTime < interval.start) {
        const segmentPath = path.resolve(
          '/tmp',
          `segment_${Date.now()}_${segmentIndex++}.ts`
        );

        const duration = interval.start - currentTime;
        const normalSegmentCommand = [
          'ffmpeg',
          '-y',
          '-ss',
          currentTime.toString(),
          '-t',
          duration.toString(),
          '-i',
          `"${inputUrl}"`,
          '-c:v',
          'libx264',
          '-preset',
          'ultrafast',
          '-crf',
          '23',
          '-r',
          fps.toString(),
          '-c:a',
          'aac',
          '-b:a',
          '128k',
          '-ar',
          '48000',
          '-avoid_negative_ts',
          'make_zero',
          '-fflags',
          '+genpts',
          `"${segmentPath}"`,
        ];

        await execAsync(normalSegmentCommand.join(' '), { timeout: 300000 });
        segmentTsFiles.push(segmentPath);
      }

      // Process silence segment with speed adjustment
      const silenceSegmentPath = path.resolve(
        '/tmp',
        `segment_${Date.now()}_${segmentIndex++}.ts`
      );

      const silenceDuration = interval.end - interval.start;

      // Build audio filter for speed adjustment
      const audioFilter = mute
        ? `volume=0,atempo=${speedRate > 2 ? '2.0' : speedRate.toString()}${
            speedRate > 2 ? `,atempo=${(speedRate / 2).toString()}` : ''
          }`
        : `atempo=${speedRate > 2 ? '2.0' : speedRate.toString()}${
            speedRate > 2 ? `,atempo=${(speedRate / 2).toString()}` : ''
          }`;

      const silenceSegmentCommand = [
        'ffmpeg',
        '-y',
        '-ss',
        interval.start.toString(),
        '-t',
        silenceDuration.toString(),
        '-i',
        `"${inputUrl}"`,
        '-filter:v',
        `setpts=PTS/${speedRate}`,
        '-filter:a',
        audioFilter,
        '-c:v',
        'libx264',
        '-preset',
        'ultrafast',
        '-crf',
        '23',
        '-r',
        fps.toString(),
        '-c:a',
        'aac',
        '-b:a',
        '128k',
        '-ar',
        '48000',
        '-avoid_negative_ts',
        'make_zero',
        '-fflags',
        '+genpts',
        `"${silenceSegmentPath}"`,
      ];

      await execAsync(silenceSegmentCommand.join(' '), { timeout: 300000 });
      segmentTsFiles.push(silenceSegmentPath);

      currentTime = interval.end;
    }

    // Process final normal segment
    if (currentTime < totalDuration) {
      const segmentPath = path.resolve(
        '/tmp',
        `segment_${Date.now()}_${segmentIndex++}.ts`
      );

      const duration = totalDuration - currentTime;
      const finalSegmentCommand = [
        'ffmpeg',
        '-y',
        '-ss',
        currentTime.toString(),
        '-t',
        duration.toString(),
        '-i',
        `"${inputUrl}"`,
        '-c:v',
        'libx264',
        '-preset',
        'ultrafast',
        '-crf',
        '23',
        '-r',
        fps.toString(),
        '-c:a',
        'aac',
        '-b:a',
        '128k',
        '-ar',
        '48000',
        '-avoid_negative_ts',
        'make_zero',
        '-fflags',
        '+genpts',
        `"${segmentPath}"`,
      ];

      await execAsync(finalSegmentCommand.join(' '), { timeout: 300000 });
      segmentTsFiles.push(segmentPath);
    }

    // Step 5: Concatenate all segments using concat demuxer
    console.log('Step 3: Concatenating segments...');

    // Create concat file list
    const concatListPath = path.resolve('/tmp', `concat_${Date.now()}.txt`);
    const concatContent = segmentTsFiles
      .map((file) => `file '${file}'`)
      .join('\n');
    await writeFile(concatListPath, concatContent);

    const concatCommand = [
      'ffmpeg',
      '-y',
      '-f',
      'concat',
      '-safe',
      '0',
      '-i',
      `"${concatListPath}"`,
      '-c:v',
      'libx264',
      '-preset',
      'medium',
      '-crf',
      '23',
      '-r',
      fps.toString(),
      '-c:a',
      'aac',
      '-b:a',
      '128k',
      '-ar',
      '48000',
      '-movflags',
      '+faststart',
      `"${fullOutputPath}"`,
    ];

    await execAsync(concatCommand.join(' '), { timeout: 600000 });

    // Cleanup segment files
    for (const segmentFile of segmentTsFiles) {
      try {
        await unlink(segmentFile);
      } catch (e) {
        console.warn(`Failed to cleanup segment: ${segmentFile}`);
      }
    }

    try {
      await unlink(concatListPath);
    } catch (e) {
      console.warn('Failed to cleanup concat list');
    }

    // Check if output file exists
    await access(fullOutputPath);

    const totalSilenceDuration = processedIntervals.reduce(
      (sum, interval) => sum + (interval.end - interval.start),
      0
    );

    console.log(`Silence optimization saved to: ${fullOutputPath}`);
    console.log(
      `Stats: ${
        processedIntervals.length
      } intervals, ${totalSilenceDuration.toFixed(2)}s total silence`
    );

    return {
      outputPath: fullOutputPath,
      stats: {
        silenceIntervals: processedIntervals.length,
        totalSilenceDuration,
      },
    };
  } catch (error) {
    console.error('Silence optimization failed:', error);

    // Cleanup
    try {
      await unlink(fullOutputPath);
    } catch (cleanupError) {
      // Ignore
    }

    throw new Error(
      `Silence optimization failed: ${
        error instanceof Error ? error.message : 'Unknown error'
      }`
    );
  }
}

/**
 * Upload a file to MinIO storage
 */
export async function uploadToMinio(
  filePath: string,
  filename?: string,
  contentType: string = 'video/mp4'
): Promise<string> {
  try {
    const fileBuffer = await readFile(filePath);

    const finalFilename =
      filename ||
      `silence_opt_${Date.now()}_${Math.random()
        .toString(36)
        .substr(2, 9)}.mp4`;

    const bucket = 'nca-toolkit';
    const uploadUrl = `http://host.docker.internal:9000/${bucket}/${finalFilename}`;

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
      }`
    );
  }
}

/**
 * Complete workflow: Silence optimization + MinIO upload + cleanup
 */
export async function optimizeSilenceWithUpload(
  options: OptimizeSilenceOptions & {
    videoId?: string;
    cleanup?: boolean;
  }
): Promise<{ localPath: string; uploadUrl: string; stats: any }> {
  const { videoId, cleanup = true, ...silenceOptions } = options;

  let localPath: string | null = null;

  try {
    // Step 1: Optimize silence
    const result = await optimizeSilence(silenceOptions);
    localPath = result.outputPath;

    // Step 2: Generate filename for upload
    const timestamp = Date.now();
    const filename = videoId
      ? `video_${videoId}_silence_opt_${timestamp}.mp4`
      : `silence_opt_${timestamp}.mp4`;

    // Step 3: Upload to MinIO
    const uploadUrl = await uploadToMinio(localPath, filename, 'video/mp4');

    // Step 4: Cleanup local file if requested
    if (cleanup && localPath) {
      try {
        await unlink(localPath);
        console.log(`Cleaned up local silence-optimized file: ${localPath}`);
      } catch (cleanupError) {
        console.warn(`Failed to cleanup local file: ${cleanupError}`);
      }
    }

    return {
      localPath: cleanup ? '' : localPath,
      uploadUrl,
      stats: result.stats,
    };
  } catch (error) {
    // Cleanup on error
    if (localPath) {
      try {
        await unlink(localPath);
      } catch (cleanupError) {
        // Ignore
      }
    }

    throw error;
  }
}
