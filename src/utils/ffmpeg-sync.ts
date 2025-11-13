import { exec } from 'child_process';
import { promisify } from 'util';
import path from 'path';
import { access, unlink } from 'fs/promises';
import { uploadToMinio } from './ffmpeg-direct';

const execAsync = promisify(exec);

export interface SyncOptions {
  videoUrl: string;
  audioUrl: string;
  outputPath?: string;
  useHardwareAcceleration?: boolean;
  videoBitrate?: string;
}

/**
 * Synchronize video with audio using FFmpeg with speed adjustment
 * Uses the same encoding parameters as speed-up function for fast merge compatibility
 */
export async function syncVideoWithAudio(
  options: SyncOptions
): Promise<string> {
  const {
    videoUrl,
    audioUrl,
    outputPath,
    useHardwareAcceleration = true,
    videoBitrate = '6000k',
  } = options;

  // Create a unique output filename
  const outputFileName =
    outputPath ||
    `synced_${Date.now()}_${Math.random().toString(36).substr(2, 9)}.mp4`;
  const fullOutputPath = path.resolve('/tmp', outputFileName);

  // Variables to store probed audio properties
  let originalCodec = 'aac';
  let originalBitrate = 128000;
  let originalSampleRate = 48000;
  let originalChannels = 2;

  // Probe video audio properties to preserve quality
  console.log('[SYNC] Probing video audio properties...');
  const audioProbeCmd = `ffprobe -v quiet -select_streams a:0 -show_entries stream=codec_name,bit_rate,sample_rate,channels -of json "${videoUrl}"`;
  const { stdout: audioProbeStr } = await execAsync(audioProbeCmd);
  const audioProbe = JSON.parse(audioProbeStr);
  const audioStream = audioProbe.streams?.[0];

  if (!audioStream) {
    throw new Error('No audio stream found in video input');
  }

  originalCodec = audioStream.codec_name || 'aac';
  originalBitrate = audioStream.bit_rate
    ? parseInt(audioStream.bit_rate)
    : 128000;
  originalSampleRate = audioStream.sample_rate
    ? parseInt(audioStream.sample_rate)
    : 48000;
  originalChannels = audioStream.channels || 2;

  console.log(
    `[SYNC] Original audio - Codec: ${originalCodec}, Bitrate: ${originalBitrate}, Sample Rate: ${originalSampleRate}, Channels: ${originalChannels}`
  );

  // Try hardware acceleration first, then fallback to software
  const attempts = useHardwareAcceleration
    ? ['hardware', 'software']
    : ['software'];

  for (let i = 0; i < attempts.length; i++) {
    const attempt = attempts[i];
    const isHardware = attempt === 'hardware';

    try {
      console.log(`[SYNC] Starting video-audio sync using ${attempt} encoding`);

      // Build FFmpeg command for video-audio synchronization
      const ffmpegCommand = [
        'ffmpeg',
        '-y', // Overwrite output file
        '-i',
        `"${videoUrl}"`, // Video input
        '-i',
        `"${audioUrl}"`, // Audio input
      ];

      // Get video and audio durations to calculate speed ratio
      // We'll use a two-pass approach: first get durations, then sync

      // Video filter: adjust video speed to match audio duration
      // Audio filter: resample to match original video's sample rate
      let videoFilter = ``;
      let audioFilter = `aresample=${originalSampleRate}`;

      ffmpegCommand.push(
        '-filter_complex',
        `"[0:v]${videoFilter}[v];[1:a]${audioFilter}[a]"`,
        '-map',
        '[v]',
        '-map',
        '[a]',
        '-shortest' // End when shortest stream ends
      );

      // Add video encoding options (same as trimming for consistency)
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

      // Add audio encoding options (preserve original quality)
      ffmpegCommand.push(
        '-ar',
        originalSampleRate.toString(),
        '-c:a',
        originalCodec,
        '-b:a',
        `${Math.round(originalBitrate / 1000)}k`,
        '-ac',
        originalChannels.toString(),
        '-avoid_negative_ts',
        'make_zero',
        `"${fullOutputPath}"`
      );

      const commandString = ffmpegCommand.join(' ');
      const execStartTime = Date.now();

      const { stdout, stderr } = await execAsync(commandString, {
        timeout: 180000, // 3 minute timeout for sync
        maxBuffer: 1024 * 1024 * 10, // 10MB buffer for large stderr output
      });

      const execEndTime = Date.now();
      console.log(
        `[SYNC] FFmpeg sync completed in ${
          execEndTime - execStartTime
        }ms (${attempt} encoding)`
      );

      // Check if output file exists
      await access(fullOutputPath);

      return fullOutputPath;
    } catch (error) {
      console.error(`[SYNC] FFmpeg ${attempt} sync failed:`, error);

      // Clean up output file if it exists
      try {
        await unlink(fullOutputPath);
      } catch (cleanupError) {
        // Ignore cleanup errors
      }

      // If this was the last attempt, throw the error
      if (i === attempts.length - 1) {
        throw new Error(
          `FFmpeg sync processing failed after ${attempts.length} attempts: ${
            error instanceof Error ? error.message : 'Unknown error'
          }`
        );
      }

      // Otherwise, continue to next attempt
      console.log(`[SYNC] Retrying sync with ${attempts[i + 1]} encoding...`);
    }
  }

  // This should never be reached, but just in case
  throw new Error('FFmpeg sync processing failed: No successful attempts');
}

/**
 * Advanced sync with duration-based speed adjustment (like NCA toolkit)
 * Calculates speed ratio and adjusts video speed to match audio duration
 */
export async function syncVideoWithAudioAdvanced(
  options: SyncOptions
): Promise<string> {
  const {
    videoUrl,
    audioUrl,
    outputPath,
    useHardwareAcceleration = true,
    videoBitrate = '6000k',
  } = options;

  // Create a unique output filename
  const outputFileName =
    outputPath ||
    `synced_advanced_${Date.now()}_${Math.random()
      .toString(36)
      .substr(2, 9)}.mp4`;
  const fullOutputPath = path.resolve('/tmp', outputFileName);

  // Variables to store probed audio properties
  let originalCodec = 'aac';
  let originalBitrate = 128000;
  let originalSampleRate = 48000;
  let originalChannels = 2;

  // Probe video audio properties to preserve quality
  console.log('[SYNC] Probing video audio properties...');
  const audioProbeCmd = `ffprobe -v quiet -select_streams a:0 -show_entries stream=codec_name,bit_rate,sample_rate,channels -of json "${videoUrl}"`;
  const { stdout: audioProbeStr } = await execAsync(audioProbeCmd);
  const audioProbe = JSON.parse(audioProbeStr);
  const audioStream = audioProbe.streams?.[0];

  if (!audioStream) {
    throw new Error('No audio stream found in video input');
  }

  originalCodec = audioStream.codec_name || 'aac';
  originalBitrate = audioStream.bit_rate
    ? parseInt(audioStream.bit_rate)
    : 128000;
  originalSampleRate = audioStream.sample_rate
    ? parseInt(audioStream.sample_rate)
    : 48000;
  originalChannels = audioStream.channels || 2;

  console.log(
    `[SYNC] Original audio - Codec: ${originalCodec}, Bitrate: ${originalBitrate}, Sample Rate: ${originalSampleRate}, Channels: ${originalChannels}`
  );

  try {
    console.log('[SYNC] Getting video and audio durations...');

    // Step 1: Get video duration
    const videoDurationCmd = `ffprobe -v quiet -show_entries format=duration -of csv=p=0 "${videoUrl}"`;
    const { stdout: videoDurationStr } = await execAsync(videoDurationCmd);
    const videoDuration = parseFloat(videoDurationStr.trim());

    // Step 2: Get audio duration
    const audioDurationCmd = `ffprobe -v quiet -show_entries format=duration -of csv=p=0 "${audioUrl}"`;
    const { stdout: audioDurationStr } = await execAsync(audioDurationCmd);
    const audioDuration = parseFloat(audioDurationStr.trim());

    // Step 3: Probe video audio properties to preserve quality
    console.log('[SYNC] Probing video audio properties...');
    const audioProbeCmd = `ffprobe -v quiet -select_streams a:0 -show_entries stream=codec_name,bit_rate,sample_rate,channels -of json "${videoUrl}"`;
    const { stdout: audioProbeStr } = await execAsync(audioProbeCmd);
    const audioProbe = JSON.parse(audioProbeStr);
    const audioStream = audioProbe.streams?.[0];

    if (!audioStream) {
      throw new Error('No audio stream found in video input');
    }

    originalCodec = audioStream.codec_name || 'aac';
    originalBitrate = audioStream.bit_rate
      ? parseInt(audioStream.bit_rate)
      : 128000;
    originalSampleRate = audioStream.sample_rate
      ? parseInt(audioStream.sample_rate)
      : 48000;
    originalChannels = audioStream.channels || 2;

    console.log(
      `[SYNC] Original audio - Codec: ${originalCodec}, Bitrate: ${originalBitrate}, Sample Rate: ${originalSampleRate}, Channels: ${originalChannels}`
    );

    // Step 4: Calculate speed ratio
    const speedRatio = audioDuration / videoDuration;
    console.log(
      `[SYNC] Video: ${videoDuration}s, Audio: ${audioDuration}s, Speed ratio: ${speedRatio}`
    );

    // Try hardware acceleration first, then fallback to software
    const attempts = useHardwareAcceleration
      ? ['hardware', 'software']
      : ['software'];

    for (let i = 0; i < attempts.length; i++) {
      const attempt = attempts[i];
      const isHardware = attempt === 'hardware';

      try {
        console.log(
          `[SYNC] Starting advanced sync using ${attempt} encoding (speed ratio: ${speedRatio})`
        );

        // Build FFmpeg command with speed adjustment
        const ffmpegCommand = [
          'ffmpeg',
          '-y', // Overwrite output file
          '-i',
          `"${videoUrl}"`, // Video input
          '-i',
          `"${audioUrl}"`, // Audio input
        ];

        // Apply speed adjustment to video and audio processing
        let videoFilter = `setpts=PTS*${speedRatio}`;
        let audioFilter = `aresample=${originalSampleRate}`;

        ffmpegCommand.push(
          '-filter_complex',
          `"[0:v]${videoFilter}[v];[1:a]${audioFilter}[a]"`,
          '-map',
          '[v]',
          '-map',
          '[a]'
        );

        // Add video encoding options (same as trimming for consistency)
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

        // Add audio encoding options (preserve original quality)
        ffmpegCommand.push(
          '-ar',
          originalSampleRate.toString(),
          '-c:a',
          originalCodec,
          '-b:a',
          `${Math.round(originalBitrate / 1000)}k`,
          '-ac',
          originalChannels.toString(),
          '-avoid_negative_ts',
          'make_zero',
          `"${fullOutputPath}"`
        );

        const commandString = ffmpegCommand.join(' ');
        const execStartTime = Date.now();

        const { stdout, stderr } = await execAsync(commandString, {
          timeout: 300000, // 5 minute timeout for advanced sync
          maxBuffer: 1024 * 1024 * 10, // 10MB buffer for large stderr output
        });

        const execEndTime = Date.now();
        console.log(
          `[SYNC] Advanced sync completed in ${
            execEndTime - execStartTime
          }ms (${attempt} encoding, speed ratio: ${speedRatio})`
        );

        // Check if output file exists
        await access(fullOutputPath);

        return fullOutputPath;
      } catch (error) {
        console.error(`[SYNC] FFmpeg ${attempt} advanced sync failed:`, error);

        // Clean up output file if it exists
        try {
          await unlink(fullOutputPath);
        } catch (cleanupError) {
          // Ignore cleanup errors
        }

        // If this was the last attempt, throw the error
        if (i === attempts.length - 1) {
          throw new Error(
            `FFmpeg advanced sync processing failed after ${
              attempts.length
            } attempts: ${
              error instanceof Error ? error.message : 'Unknown error'
            }`
          );
        }

        // Otherwise, continue to next attempt
        console.log(
          `[SYNC] Retrying advanced sync with ${attempts[i + 1]} encoding...`
        );
      }
    }
  } catch (error) {
    // Clean up output file if it exists
    try {
      await unlink(fullOutputPath);
    } catch (cleanupError) {
      // Ignore cleanup errors
    }

    throw new Error(
      `FFmpeg advanced sync failed: ${
        error instanceof Error ? error.message : 'Unknown error'
      }`
    );
  }

  // This should never be reached, but just in case
  throw new Error(
    'FFmpeg advanced sync processing failed: No successful attempts'
  );
}

/**
 * Complete workflow: FFmpeg sync + MinIO upload + local cleanup
 */
export async function syncVideoWithUpload(
  options: SyncOptions & {
    sceneId?: string;
    videoId?: number | string;
    ttsTimestamp?: string;
    cleanup?: boolean;
    useAdvancedSync?: boolean;
  }
): Promise<{ localPath: string; uploadUrl: string }> {
  const {
    sceneId,
    videoId,
    ttsTimestamp,
    cleanup = true,
    useAdvancedSync = true,
    ...syncOptions
  } = options;

  let localPath: string | null = null;

  try {
    // Step 1: Sync the video and audio using FFmpeg
    localPath = useAdvancedSync
      ? await syncVideoWithAudioAdvanced(syncOptions)
      : await syncVideoWithAudio(syncOptions);

    // Step 2: Generate filename for upload
    // If ttsTimestamp is provided, use it to maintain the link between TTS and sync
    // Otherwise, generate a new timestamp
    const timestamp = ttsTimestamp || Date.now().toString();
    const filename =
      videoId && sceneId
        ? `video_${videoId}_scene_${sceneId}_synced_${timestamp}.mp4`
        : sceneId
        ? `scene_${sceneId}_synced_${timestamp}.mp4`
        : `synced_video_${timestamp}.mp4`;

    console.log(
      `[SYNC] Generating filename with ${
        ttsTimestamp ? 'TTS' : 'new'
      } timestamp: ${filename}`
    );

    // Step 3: Upload to MinIO
    const uploadUrl = await uploadToMinio(localPath, filename, 'video/mp4');

    // Step 4: Cleanup local file if requested
    if (cleanup && localPath) {
      try {
        await unlink(localPath);
        console.log(`[SYNC] Cleaned up local file: ${localPath}`);
      } catch (cleanupError) {
        console.warn(`[SYNC] Failed to cleanup local file: ${cleanupError}`);
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
