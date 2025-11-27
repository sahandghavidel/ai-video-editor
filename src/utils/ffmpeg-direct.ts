// Custom streaming upload for large files
import { exec, spawn } from 'child_process';
import { promisify } from 'util';
import path from 'path';
import { readFile, access, unlink, stat, writeFile } from 'fs/promises';
import { createReadStream } from 'fs';
import { pipeline } from 'stream/promises';
import http from 'http';
import https from 'https';
import type { IncomingMessage } from 'http';

const execAsync = promisify(exec);

// Helper function to run FFmpeg with spawn (avoids shell interpretation issues)
function runFFmpegSpawn(args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    console.log('Running FFmpeg command:', 'ffmpeg', ...args);
    const ffmpeg = spawn('ffmpeg', args, {
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';

    ffmpeg.stdout?.on('data', (data) => {
      stdout += data.toString();
    });

    ffmpeg.stderr?.on('data', (data) => {
      stderr += data.toString();
    });

    ffmpeg.on('close', (code) => {
      if (code === 0) {
        console.log('FFmpeg completed successfully');
        resolve();
      } else {
        console.error('FFmpeg failed with code:', code);
        console.error('FFmpeg stderr:', stderr);
        reject(new Error(`FFmpeg process exited with code ${code}: ${stderr}`));
      }
    });

    ffmpeg.on('error', (error) => {
      console.error('FFmpeg spawn error:', error);
      reject(error);
    });
  });
}

// Custom streaming upload for large files
function uploadLargeFileToMinio(
  filePath: string,
  uploadUrl: string,
  contentType: string
): Promise<void> {
  return new Promise((resolve, reject) => {
    const fileStream = createReadStream(filePath);
    const url = new URL(uploadUrl);

    const options = {
      hostname: url.hostname,
      port: url.port,
      path: url.pathname + url.search,
      method: 'PUT',
      headers: {
        'Content-Type': contentType,
      },
    };

    const req = http.request(options, (res: IncomingMessage) => {
      if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) {
        resolve();
      } else {
        let errorData = '';
        res.on('data', (chunk: Buffer) => {
          errorData += chunk.toString();
        });
        res.on('end', () => {
          reject(new Error(`Upload failed: ${res.statusCode} ${errorData}`));
        });
      }
    });

    req.on('error', (error: Error) => {
      reject(error);
    });

    // Pipe the file stream to the request
    fileStream.pipe(req);

    fileStream.on('error', (error: Error) => {
      req.destroy();
      reject(error);
    });
  });
}

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
      // Calculate duration
      const duration = parseFloat(endTimeStr) - parseFloat(startTimeStr);

      // Build FFmpeg command
      const ffmpegCommand = [
        'ffmpeg',
        '-y', // Overwrite output file
        '-ss',
        startTimeStr, // Seek to start time BEFORE input (faster)
        '-to',
        endTimeStr, // Use end time instead of duration
        '-i',
        `"${inputUrl}"`, // Input file
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
      const execStartTime = Date.now();

      const { stdout, stderr } = await execAsync(commandString, {
        timeout: 120000, // 2 minute timeout
        maxBuffer: 1024 * 1024 * 10, // 10MB buffer for large stderr output
      });

      const execEndTime = Date.now();
      console.log(
        `FFmpeg completed in ${
          execEndTime - execStartTime
        }ms (${attempt} encoding)`
      );

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

export interface SpeedUpOptions {
  inputUrl: string;
  speed: number; // Speed multiplier (1, 2, 4, etc.)
  muteAudio?: boolean;
  outputPath?: string;
  useHardwareAcceleration?: boolean;
  videoBitrate?: string;
}

export async function speedUpVideoWithFFmpeg(
  options: SpeedUpOptions
): Promise<string> {
  const {
    inputUrl,
    speed,
    muteAudio = false,
    outputPath,
    useHardwareAcceleration = true,
    videoBitrate = '6000k',
  } = options;

  // Create a unique output filename
  const outputFileName =
    outputPath ||
    `speedup_${Date.now()}_${Math.random().toString(36).substr(2, 9)}.mp4`;
  const fullOutputPath = path.resolve('/tmp', outputFileName);

  // Try hardware acceleration first, then fallback to software
  const attempts = useHardwareAcceleration
    ? ['hardware', 'software']
    : ['software'];

  for (let i = 0; i < attempts.length; i++) {
    const attempt = attempts[i];
    const isHardware = attempt === 'hardware';

    try {
      // Build FFmpeg command for speed adjustment
      const ffmpegCommand = [
        'ffmpeg',
        '-y', // Overwrite output file
        '-i',
        `"${inputUrl}"`, // Input file
      ];

      // Video filter: speed up video by changing PTS (presentation timestamp)
      let videoFilter = `setpts=PTS/${speed}`;

      // Audio filter: speed up audio and optionally mute
      let audioFilter;
      if (muteAudio) {
        audioFilter = `atempo=${speed},volume=0`; // Speed up and mute
      } else {
        // For speeds > 2, we need to chain atempo filters (max 2.0 per filter)
        if (speed <= 2) {
          audioFilter = `atempo=${speed}`;
        } else if (speed === 4) {
          audioFilter = `atempo=2.0,atempo=2.0`; // Chain two 2x filters for 4x
        } else {
          // For other speeds, calculate the chain needed
          let tempSpeed = speed;
          const filters = [];
          while (tempSpeed > 2) {
            filters.push('atempo=2.0');
            tempSpeed /= 2;
          }
          if (tempSpeed > 1) {
            filters.push(`atempo=${tempSpeed}`);
          }
          audioFilter = filters.join(',');
        }
      }

      // Add filter complex for video and audio processing
      ffmpegCommand.push(
        '-filter_complex',
        `"[0:v]${videoFilter}[v];[0:a]${audioFilter}[a]"`,
        '-map',
        '[v]',
        '-map',
        '[a]'
      );

      // Add video encoding options (same as trimming for consistent format)
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

      // Add audio encoding options (same as trimming for consistent format)
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
        timeout: 120000, // 2 minute timeout
      });

      const execEndTime = Date.now();
      console.log(
        `FFmpeg speedup completed in ${
          execEndTime - execStartTime
        }ms (${attempt} encoding, ${speed}x speed)`
      );

      // Check if output file exists
      await access(fullOutputPath);

      return fullOutputPath;
    } catch (error) {
      console.error(`FFmpeg ${attempt} speedup encoding failed:`, error);

      // Clean up output file if it exists
      try {
        await unlink(fullOutputPath);
      } catch (cleanupError) {
        // Ignore cleanup errors
      }

      // If this was the last attempt, throw the error
      if (i === attempts.length - 1) {
        throw new Error(
          `FFmpeg speedup processing failed after ${
            attempts.length
          } attempts: ${
            error instanceof Error ? error.message : 'Unknown error'
          }`
        );
      }

      // Otherwise, continue to next attempt
      console.log(`Retrying speedup with ${attempts[i + 1]} encoding...`);
    }
  }

  // This should never be reached, but just in case
  throw new Error('FFmpeg speedup processing failed: No successful attempts');
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
    // Check file size first
    const statStart = Date.now();
    const stats = await stat(filePath);
    const fileSize = stats.size;
    const statEnd = Date.now();
    console.log(
      `[STAT] File size check took ${statEnd - statStart}ms (${(
        fileSize /
        (1024 * 1024)
      ).toFixed(2)}MB)`
    );

    // Generate filename if not provided
    const finalFilename =
      filename ||
      `clip_${Date.now()}_${Math.random().toString(36).substr(2, 9)}.mp4`;

    // MinIO configuration (same as other endpoints)
    const bucket = 'nca-toolkit';
    const uploadUrl = `http://host.docker.internal:9000/${bucket}/${finalFilename}`;

    // For large files (> 100MB), use streaming upload to avoid memory issues
    if (fileSize > 100 * 1024 * 1024) {
      // 100MB limit for streaming
      console.log(
        `Large file detected (${(fileSize / (1024 * 1024)).toFixed(
          2
        )}MB), using streaming upload`
      );

      // Verify file exists before attempting upload
      try {
        await access(filePath);
        // Double-check file size matches what we got earlier
        const verifyStats = await stat(filePath);
        if (verifyStats.size !== fileSize) {
          console.warn(
            `File size changed during upload preparation: ${fileSize} -> ${verifyStats.size}`
          );
        }
      } catch (accessError) {
        console.error(`File access error: ${accessError}`);
        throw new Error(
          `File does not exist or is not accessible: ${filePath}`
        );
      }

      // Add a small delay to ensure file system operations are complete
      await new Promise((resolve) => setTimeout(resolve, 100));

      const streamStart = Date.now();
      let fileStream: ReturnType<typeof createReadStream>;
      try {
        fileStream = createReadStream(filePath);
      } catch (streamError) {
        console.error(`Failed to create read stream: ${streamError}`);
        throw new Error(`Failed to create read stream for file: ${filePath}`);
      }

      const uploadResponse = await fetch(uploadUrl, {
        method: 'PUT',
        headers: {
          'Content-Type': contentType,
          'Content-Length': fileSize.toString(),
        },
        body: fileStream as unknown as BodyInit,
        duplex: 'half' as const,
      } as RequestInit & { duplex: 'half' });
      const streamEnd = Date.now();
      console.log(
        `[STREAM] Streaming upload took ${streamEnd - streamStart}ms`
      );

      if (!uploadResponse.ok) {
        const errorText = await uploadResponse.text();
        console.error('MinIO streaming upload error:', errorText);
        throw new Error(
          `MinIO streaming upload error: ${uploadResponse.status}`
        );
      }

      return uploadUrl;
    } else {
      // For smaller files, use the original buffer method
      // Verify file exists before attempting upload
      try {
        await access(filePath);
      } catch (accessError) {
        throw new Error(
          `File does not exist or is not accessible: ${filePath}`
        );
      }

      const readStart = Date.now();
      const fileBuffer = await readFile(filePath);
      const readEnd = Date.now();
      console.log(`[READ] File read took ${readEnd - readStart}ms`);

      // Upload to MinIO using direct HTTP PUT
      const putStart = Date.now();
      const uploadResponse = await fetch(uploadUrl, {
        method: 'PUT',
        headers: {
          'Content-Type': contentType,
          'Content-Length': fileSize.toString(),
        },
        body: new Uint8Array(fileBuffer),
      });
      const putEnd = Date.now();
      console.log(`[PUT] HTTP PUT request took ${putEnd - putStart}ms`);

      if (!uploadResponse.ok) {
        const errorText = await uploadResponse.text();
        console.error('MinIO upload error:', errorText);
        throw new Error(`MinIO upload error: ${uploadResponse.status}`);
      }

      return uploadUrl;
    }
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
    videoId?: number | string;
    cleanup?: boolean;
  }
): Promise<{ localPath: string; uploadUrl: string }> {
  const { sceneId, videoId, cleanup = true, ...trimOptions } = options;

  let localPath: string | null = null;

  try {
    // Step 1: Create the clip using FFmpeg
    localPath = await trimVideoWithFFmpeg(trimOptions);

    // Step 2: Generate filename for upload
    const timestamp = Date.now();
    const filename =
      videoId && sceneId
        ? `video_${videoId}_scene_${sceneId}_clip_${timestamp}.mp4`
        : sceneId
        ? `scene_${sceneId}_clip_${timestamp}.mp4`
        : `clip_${timestamp}.mp4`;

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
 * Complete workflow: FFmpeg speed-up + MinIO upload + local cleanup
 */
export async function speedUpVideoWithUpload(
  options: SpeedUpOptions & {
    sceneId?: string;
    videoId?: number | string;
    cleanup?: boolean;
  }
): Promise<{ localPath: string; uploadUrl: string }> {
  const { sceneId, videoId, cleanup = true, ...speedUpOptions } = options;

  let localPath: string | null = null;

  try {
    // Step 1: Speed up the video using FFmpeg
    const ffmpegStart = Date.now();
    localPath = await speedUpVideoWithFFmpeg(speedUpOptions);
    const ffmpegEnd = Date.now();
    console.log(
      `[FFMPEG] Scene ${sceneId} processing took ${ffmpegEnd - ffmpegStart}ms`
    );

    // Step 2: Generate filename for upload
    const timestamp = Date.now();
    const speedSuffix = `${speedUpOptions.speed}x`;
    const filename =
      videoId && sceneId
        ? `video_${videoId}_scene_${sceneId}_${speedSuffix}_${timestamp}.mp4`
        : sceneId
        ? `scene_${sceneId}_${speedSuffix}_${timestamp}.mp4`
        : `spedup_${speedSuffix}_${timestamp}.mp4`;

    // Step 3: Upload to MinIO
    const uploadStart = Date.now();
    const uploadUrl = await uploadToMinio(localPath, filename, 'video/mp4');
    const uploadEnd = Date.now();
    console.log(
      `[MINIO] Scene ${sceneId} upload took ${uploadEnd - uploadStart}ms`
    );

    // Step 4: Cleanup local file if requested
    if (cleanup && localPath) {
      try {
        const cleanupStart = Date.now();
        await unlink(localPath);
        const cleanupEnd = Date.now();
        console.log(
          `[CLEANUP] Scene ${sceneId} cleanup took ${
            cleanupEnd - cleanupStart
          }ms - removed: ${localPath}`
        );
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
 * Create a typing effect video with text overlay and typing sound
 */
export async function createTypingEffectVideo(
  inputVideoUrl: string,
  text: string,
  outputPath?: string
): Promise<string> {
  const outputFileName =
    outputPath ||
    `typing_effect_${Date.now()}_${Math.random()
      .toString(36)
      .substr(2, 9)}.mp4`;
  const fullOutputPath = path.resolve('/tmp', outputFileName);

  try {
    // Get video duration and dimensions
    const durationCommand = [
      'ffprobe',
      '-v',
      'quiet',
      '-print_format',
      'json',
      '-show_format',
      '-show_streams',
      `"${inputVideoUrl}"`,
    ];

    const { stdout: probeOutput } = await execAsync(durationCommand.join(' '));
    const probeData = JSON.parse(probeOutput);
    const videoDuration = parseFloat(probeData.format.duration);

    // Get video dimensions from the first video stream
    const videoStream = probeData.streams.find(
      (stream: any) => stream.codec_type === 'video'
    );
    const videoWidth = videoStream.width;
    const videoHeight = videoStream.height;

    // Calculate appropriate font size based on video dimensions
    // Use about 1.5% of the video height as font size, with min 16 and max 40
    const fontSize = Math.max(
      16,
      Math.min(40, Math.round(videoHeight * 0.015))
    );

    // Split text into characters for typing effect
    const characters = text.split('');
    const typingSpeed = 0.15; // seconds per character (from N8N workflow)

    // Calculate required duration for full typing effect
    const typingOnlyDuration = characters.length * typingSpeed;
    const finalDisplayDuration = Math.max(2.0, typingOnlyDuration * 0.3); // 30% of typing time or minimum 2 seconds
    const requiredDuration = typingOnlyDuration + finalDisplayDuration;

    // Calculate speed factor to slow down video to match required duration
    const rawSpeedFactor = videoDuration / requiredDuration;
    const speedFactor = Math.max(0.2, rawSpeedFactor); // Allow even slower minimum speed

    // Generate SRT content for typing effect
    let srtContent = '';
    const frames: Array<{
      text: string;
      timestamp: number;
      frame_number: number;
    }> = [];

    // Create frames for typing effect (all characters)
    for (let i = 1; i <= characters.length; i++) {
      frames.push({
        text: characters.slice(0, i).join(''),
        timestamp: i * typingSpeed,
        frame_number: i,
      });
    }

    // Add final frame with full text displayed
    frames.push({
      text: text,
      timestamp: typingOnlyDuration,
      frame_number: characters.length + 1,
    });

    // Create SRT format
    frames.forEach((frame, index) => {
      const startTime = index === 0 ? 0 : frames[index - 1].timestamp;
      const endTime =
        index === frames.length - 1 ? requiredDuration : frame.timestamp;

      srtContent += `${index + 1}\n`;
      srtContent += `${formatSRTTime(startTime)} --> ${formatSRTTime(
        endTime
      )}\n`;
      srtContent += `${frame.text}\n\n`;
    });

    // Write SRT to temp file
    const srtFilePath = path.resolve('/tmp', `typing_${Date.now()}.srt`);
    await writeFile(srtFilePath, srtContent);

    // Create typing sound path (from public folder)
    const typingSoundPath = path.resolve(
      process.cwd(),
      'public',
      'type-sound.WAV'
    );

    // Build FFmpeg filter based on whether we need to slow down the video
    let videoFilter = `[0:v]`;
    // Calculate how many times to loop the typing sound (3.18s duration)
    const typingSoundDuration = 3.18;
    const loopsNeeded = Math.ceil(typingOnlyDuration / typingSoundDuration);
    const concatInputs = Array(loopsNeeded).fill('[1:a]').join('');
    const concatFilter = `${concatInputs}concat=n=${loopsNeeded}:v=0:a=1,atrim=duration=${typingOnlyDuration}[a1]`;

    let audioFilter = `[0:a]volume=0[a0];${concatFilter};[a0][a1]amix=inputs=2[outa]`;

    if (speedFactor < 1) {
      // Need to slow down video first, then apply subtitles
      videoFilter += `setpts=${1 / speedFactor}*PTS,`;
    }

    // Add brightness filter to darken the video for better text visibility (95% darker)
    videoFilter += `eq=brightness=-0.95,`;

    videoFilter += `subtitles=${srtFilePath}:force_style='FontSize=${fontSize},PrimaryColour=&HFFFFFF&,BackColour=&H000000&,BorderStyle=3,Outline=1,Shadow=3,Alignment=8,MarginV=20'[vout]`;

    // Create FFmpeg command using subtitles filter
    const ffmpegCommand = [
      '-y',
      '-i',
      inputVideoUrl,
      '-i',
      typingSoundPath,
      '-filter_complex',
      `${videoFilter};${audioFilter}`,
      '-map',
      '[vout]',
      '-map',
      '[outa]',
      '-c:v',
      'libx264',
      '-preset',
      'medium',
      '-crf',
      '23',
      '-c:a',
      'aac',
      '-b:a',
      '124k',
      '-t',
      requiredDuration.toString(),
      fullOutputPath,
    ];

    // Use spawn instead of exec to avoid shell interpretation of parentheses
    await runFFmpegSpawn(ffmpegCommand);

    // Clean up SRT file
    try {
      await unlink(srtFilePath);
    } catch (cleanupError) {
      console.warn('Failed to cleanup SRT file:', cleanupError);
    }

    console.log('Typing effect video created successfully');

    return fullOutputPath;
  } catch (error) {
    console.error('Error creating typing effect video:', error);
    throw new Error(
      `Typing effect creation failed: ${
        error instanceof Error ? error.message : 'Unknown error'
      }`
    );
  }
}

// Helper function to format time for SRT (HH:MM:SS,mmm)
function formatSRTTime(seconds: number): string {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = Math.floor(seconds % 60);
  const milliseconds = Math.floor((seconds % 1) * 1000);

  return `${hours.toString().padStart(2, '0')}:${minutes
    .toString()
    .padStart(2, '0')}:${secs.toString().padStart(2, '0')},${milliseconds
    .toString()
    .padStart(3, '0')}`;
}

/**
 * Complete workflow: FFmpeg typing effect + MinIO upload + local cleanup
 */
export async function createTypingEffectVideoWithUpload(options: {
  videoUrl: string;
  text: string;
  sceneId?: string;
  cleanup?: boolean;
}): Promise<{ localPath: string; uploadUrl: string }> {
  const { videoUrl, text, sceneId, cleanup = true } = options;

  let localPath: string | null = null;

  try {
    // Step 1: Create the typing effect video using FFmpeg
    const ffmpegStart = Date.now();
    localPath = await createTypingEffectVideo(videoUrl, text);
    const ffmpegEnd = Date.now();
    console.log(
      `[FFMPEG] Scene ${sceneId} typing effect processing took ${
        ffmpegEnd - ffmpegStart
      }ms`
    );

    // Step 2: Generate filename for upload
    const timestamp = Date.now();
    const filename = sceneId
      ? `scene_${sceneId}_typing_${timestamp}.mp4`
      : `typing_effect_${timestamp}.mp4`;

    // Step 3: Upload to MinIO
    const uploadStart = Date.now();
    const uploadUrl = await uploadToMinio(localPath, filename, 'video/mp4');
    const uploadEnd = Date.now();
    console.log(
      `[UPLOAD] Scene ${sceneId} typing effect uploaded in ${
        uploadEnd - uploadStart
      }ms`
    );

    return { localPath, uploadUrl };
  } catch (error) {
    // Clean up local file on error if it exists
    if (localPath && cleanup) {
      try {
        await unlink(localPath);
        console.log(`[CLEANUP] Removed local file after error: ${localPath}`);
      } catch (cleanupError) {
        console.warn(`[CLEANUP] Failed to remove local file: ${cleanupError}`);
      }
    }
    throw error;
  } finally {
    // Clean up local file if requested and no error occurred
    if (localPath && cleanup) {
      try {
        await unlink(localPath);
        console.log(`[CLEANUP] Removed local file: ${localPath}`);
      } catch (cleanupError) {
        console.warn(`[CLEANUP] Failed to remove local file: ${cleanupError}`);
      }
    }
  }
}
