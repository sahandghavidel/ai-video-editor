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
  zoomLevel?: number; // Zoom percentage (0 = no zoom, 10 = 10% zoom, etc.)
  panMode?: 'none' | 'zoom' | 'topToBottom'; // Pan mode: none, zoom pan, or top-to-bottom pan
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
    zoomLevel = 0,
    panMode = 'none',
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

    // Step 2.5: Get video dimensions
    const videoDimensionsCmd = `ffprobe -v quiet -select_streams v:0 -show_entries stream=width,height -of csv=p=0 "${videoUrl}"`;
    const { stdout: videoDimensionsStr } = await execAsync(videoDimensionsCmd);
    const [videoWidth, videoHeight] = videoDimensionsStr
      .trim()
      .split(',')
      .map(Number);
    console.log(`[SYNC] Video dimensions: ${videoWidth}x${videoHeight}`);

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

        if (panMode === 'zoom') {
          // Zoom pan: animate from zoomLevel% to (zoomLevel+20)% over OUTPUT duration
          // Order: setpts (sync) -> fps -> scale -> zoompan
          // 1. setpts to sync video to audio duration FIRST
          // 2. fps to normalize frame rate after sync
          // 3. Scale up 10x for quality
          // 4. Zoompan using 'on' (output frame number) based on OUTPUT frame count
          const startZoom = 1 + zoomLevel / 100;
          const endZoom = 1 + (zoomLevel + 20) / 100;
          const zoomDelta = endZoom - startZoom; // Should be 0.2 for 20% increase
          const fps = 30;
          // Total output frames = audioDuration * fps
          const totalOutputFrames = Math.ceil(audioDuration * fps);
          // Use 'on' (output frame number) which counts frames output by zoompan
          // on/totalOutputFrames gives 0->1 progression over the synced output
          videoFilter = `setpts=PTS*${speedRatio},fps=${fps},scale=10*iw:10*ih,zoompan=z='${startZoom}+${zoomDelta}*sin((on/${totalOutputFrames})*PI/2)':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=1:s=${videoWidth}x${videoHeight}:fps=${fps}`;
          console.log(
            `[SYNC] First syncing video to ${audioDuration.toFixed(
              2
            )}s, then applying smooth zoom pan from ${zoomLevel}% to ${
              zoomLevel + 20
            }% over ${totalOutputFrames} output frames (output: ${videoWidth}x${videoHeight})`
          );
        } else if (panMode === 'topToBottom') {
          // Top to Bottom pan: TWO-STEP PROCESS
          // Step 1: Sync video to audio duration first (separate FFmpeg call)
          // Step 2: Apply pan effect to the synced video
          const fps = 30;
          const zoomFactor = 1 + zoomLevel / 100;

          // Create temp synced video first (use fullOutputPath, not outputPath which could be undefined)
          const tempSyncedPath = fullOutputPath.replace(
            '.mp4',
            '_synced_temp.mp4'
          );
          const syncCommand = [
            'ffmpeg',
            '-y',
            '-i',
            `"${videoUrl}"`,
            '-i',
            `"${audioUrl}"`,
            '-filter_complex',
            `"[0:v]setpts=PTS*${speedRatio}[v];[1:a]aresample=${originalSampleRate}[a]"`,
            '-map',
            '[v]',
            '-map',
            '[a]',
            '-c:v',
            'libx264',
            '-preset',
            'fast',
            '-crf',
            '18',
            '-c:a',
            'aac',
            '-shortest',
            `"${tempSyncedPath}"`,
          ];

          console.log(`[SYNC] Step 1: Syncing video to audio duration...`);
          console.log(`[SYNC] Sync command: ${syncCommand.join(' ')}`);
          await execAsync(syncCommand.join(' '));

          // Get the actual duration of the synced video
          const syncedDurationCmd = `ffprobe -v quiet -show_entries format=duration -of csv=p=0 "${tempSyncedPath}"`;
          const { stdout: syncedDurationStr } = await execAsync(
            syncedDurationCmd
          );
          const syncedDuration = parseFloat(syncedDurationStr.trim());
          console.log(`[SYNC] Synced video duration: ${syncedDuration}s`);

          // Get synced video dimensions
          const syncedDimCmd = `ffprobe -v quiet -select_streams v:0 -show_entries stream=width,height -of csv=p=0 "${tempSyncedPath}"`;
          const { stdout: syncedDimStr } = await execAsync(syncedDimCmd);
          const [syncedWidth, syncedHeight] = syncedDimStr
            .trim()
            .split(',')
            .map(Number);
          console.log(
            `[SYNC] Synced video dimensions: ${syncedWidth}x${syncedHeight}`
          );

          // Top-to-bottom pan effect with FIXED zoom level:
          // - Scale by zoomFactor (e.g., 1.2 for 20% zoom) - this is the zoom amount
          // - Pan from top to bottom over the entire video duration
          // - The pan speed adapts to duration (longer video = slower pan)
          //
          // Example: 20% zoom on 1080p video
          // Scaled: 1296p height, Crop: 1080p
          // Max Y travel: 1296 - 1080 = 216 pixels
          // For 2s video: 108 px/s, For 10s video: 21.6 px/s
          const scaleFactor = zoomFactor; // Use the zoom level (1.2 = 20% zoom)
          const scaledWidth = Math.round(syncedWidth * scaleFactor);
          const scaledHeight = Math.round(syncedHeight * scaleFactor);
          const cropX = Math.floor((scaledWidth - syncedWidth) / 2); // Center horizontally
          const maxY = scaledHeight - syncedHeight; // Total vertical distance to pan

          console.log(
            `[SYNC] Zoom factor: ${scaleFactor}, Scaled: ${scaledWidth}x${scaledHeight}, MaxY: ${maxY}px over ${syncedDuration}s`
          );

          const panCommand = [
            'ffmpeg',
            '-y',
            '-i',
            `"${tempSyncedPath}"`,
            '-vf',
            `"scale=${scaledWidth}:${scaledHeight},crop=${syncedWidth}:${syncedHeight}:${cropX}:'${maxY}*(t/${syncedDuration})'"`,
            '-c:v',
            isHardware ? 'h264_videotoolbox' : 'libx264',
            isHardware ? '-b:v' : '-crf',
            isHardware ? videoBitrate : '23',
            '-c:a',
            'copy',
            `"${fullOutputPath}"`,
          ];

          console.log(
            `[SYNC] Step 2: Top-to-bottom pan (${
              (scaleFactor - 1) * 100
            }% zoom, ${maxY}px over ${syncedDuration}s)...`
          );
          console.log(`[SYNC] Pan command: ${panCommand.join(' ')}`);
          await execAsync(panCommand.join(' '));

          // Clean up temp file
          await execAsync(`rm -f "${tempSyncedPath}"`);

          console.log(`[SYNC] Two-step top-to-bottom pan complete`);
          return fullOutputPath;
        } else if (zoomLevel > 0) {
          const zoomFactor = 1 + zoomLevel / 100;
          videoFilter = `setpts=PTS*${speedRatio},scale=iw*${zoomFactor}:ih*${zoomFactor},crop=iw/${zoomFactor}:ih/${zoomFactor}`;
          console.log(
            `[SYNC] Applying ${zoomLevel}% zoom (factor: ${zoomFactor})`
          );
        }
        let audioFilter = `aresample=${originalSampleRate}`;

        console.log(`[SYNC] Video filter: ${videoFilter}`);

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
    clipTimestamp?: string;
    cleanup?: boolean;
    useAdvancedSync?: boolean;
  }
): Promise<{ localPath: string; uploadUrl: string }> {
  const {
    sceneId,
    videoId,
    ttsTimestamp,
    clipTimestamp,
    cleanup = true,
    useAdvancedSync = true,
    zoomLevel = 0,
    panMode = 'none',
    ...syncOptions
  } = options;

  // Re-add zoomLevel and panMode to syncOptions since we extracted them
  const syncOptionsWithZoom = { ...syncOptions, zoomLevel, panMode };

  let localPath: string | null = null;

  try {
    // Step 1: Sync the video and audio using FFmpeg
    localPath = useAdvancedSync
      ? await syncVideoWithAudioAdvanced(syncOptionsWithZoom)
      : await syncVideoWithAudio(syncOptionsWithZoom);

    // Step 2: Generate filename for upload
    // Format: video_ID_scene_ID_synced_TTS_TIMESTAMP_CLIP_TIMESTAMP_zoomX[_panMode].mp4
    // This allows us to regenerate sync if either TTS or clip changes
    // Always include zoom suffix (zoom0, zoom10, zoom20, etc.)
    // Add panMode suffix if not 'none'
    const panSuffix = panMode !== 'none' ? `_${panMode}` : '';
    const zoomSuffix = `_zoom${zoomLevel}${panSuffix}`;
    let filename: string;

    if (ttsTimestamp && clipTimestamp) {
      // Both timestamps available - full tracking
      filename =
        videoId && sceneId
          ? `video_${videoId}_scene_${sceneId}_synced_${ttsTimestamp}_${clipTimestamp}${zoomSuffix}.mp4`
          : sceneId
          ? `scene_${sceneId}_synced_${ttsTimestamp}_${clipTimestamp}${zoomSuffix}.mp4`
          : `synced_video_${ttsTimestamp}_${clipTimestamp}${zoomSuffix}.mp4`;
      console.log(
        `[SYNC] Generating filename with TTS timestamp (${ttsTimestamp}), clip timestamp (${clipTimestamp}), zoom ${zoomLevel}%${
          panMode !== 'none' ? ` ${panMode}` : ''
        }: ${filename}`
      );
    } else if (ttsTimestamp) {
      // Only TTS timestamp - backward compatibility
      filename =
        videoId && sceneId
          ? `video_${videoId}_scene_${sceneId}_synced_${ttsTimestamp}${zoomSuffix}.mp4`
          : sceneId
          ? `scene_${sceneId}_synced_${ttsTimestamp}${zoomSuffix}.mp4`
          : `synced_video_${ttsTimestamp}${zoomSuffix}.mp4`;
      console.log(
        `[SYNC] Generating filename with TTS timestamp only, zoom ${zoomLevel}%: ${filename}`
      );
    } else {
      // No timestamps - generate new one
      const timestamp = Date.now().toString();
      filename =
        videoId && sceneId
          ? `video_${videoId}_scene_${sceneId}_synced_${timestamp}${zoomSuffix}.mp4`
          : sceneId
          ? `scene_${sceneId}_synced_${timestamp}${zoomSuffix}.mp4`
          : `synced_video_${timestamp}${zoomSuffix}.mp4`;
      console.log(
        `[SYNC] Generating filename with new timestamp, zoom ${zoomLevel}%: ${filename}`
      );
    }

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
