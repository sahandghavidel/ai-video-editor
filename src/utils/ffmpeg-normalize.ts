import { exec } from 'child_process';
import { promisify } from 'util';
import path from 'path';
import { readFile, access, unlink } from 'fs/promises';

const execAsync = promisify(exec);

export interface NormalizeAudioOptions {
  inputUrl: string;
  outputPath?: string;
  targetLoudness?: number; // Target integrated loudness in LUFS (default: -16)
  loudnessRange?: number; // Target loudness range in LU (default: 7)
  truePeak?: number; // Maximum true peak in dBTP (default: -2)
}

/**
 * Normalize audio loudness using FFmpeg's two-pass loudnorm filter
 * Implements EBU R128 standard for broadcast loudness normalization
 */
export async function normalizeAudioLoudness(
  options: NormalizeAudioOptions
): Promise<string> {
  const {
    inputUrl,
    outputPath,
    targetLoudness = -19, // Changed from -23 to -16 LUFS for louder audio
    loudnessRange = 7,
    truePeak = -2,
  } = options;

  // Create a unique output filename
  const outputFileName =
    outputPath ||
    `normalized_${Date.now()}_${Math.random().toString(36).substr(2, 9)}.mp4`;
  const fullOutputPath = path.resolve('/tmp', outputFileName);

  try {
    console.log(`Starting audio loudness normalization for: ${inputUrl}`);
    console.log(
      `Target loudness: ${targetLoudness} LUFS, Range: ${loudnessRange} LU, True Peak: ${truePeak} dBTP`
    );

    // Pass 1: Analyze the audio and get loudness statistics
    console.log('Performing loudness analysis (Pass 1)...');

    const analyzeCommand = [
      'ffmpeg',
      '-y',
      '-i',
      `"${inputUrl}"`,
      '-vn', // Skip video decoding for faster analysis
      '-af',
      `loudnorm=I=${targetLoudness}:LRA=${loudnessRange}:tp=${truePeak}:print_format=json`,
      '-f',
      'null',
      '-',
    ];

    const analyzeCommandString = analyzeCommand.join(' ');
    console.log(`Running analysis command: ${analyzeCommandString}`);

    const { stdout: analyzeStdout, stderr: analyzeStderr } = await execAsync(
      analyzeCommandString,
      {
        timeout: 300000, // 5 minute timeout for analysis (increased for long videos)
      }
    );

    // Extract JSON from stderr (FFmpeg prints loudnorm stats to stderr)
    const jsonMatch = analyzeStderr.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      throw new Error(
        'Failed to extract loudness statistics from FFmpeg output'
      );
    }

    const loudnessStats = JSON.parse(jsonMatch[0]);
    console.log('Loudness analysis results:', loudnessStats);

    const { input_i, input_lra, input_tp, input_thresh, target_offset } =
      loudnessStats;

    // Pass 2: Apply the normalization with measured values
    console.log('Applying loudness normalization (Pass 2)...');

    const normalizeCommand = [
      'ffmpeg',
      '-y',
      '-i',
      `"${inputUrl}"`,
      '-af',
      `loudnorm=I=${targetLoudness}:LRA=${loudnessRange}:tp=${truePeak}:measured_I=${input_i}:measured_LRA=${input_lra}:measured_TP=${input_tp}:measured_thresh=${input_thresh}:offset=${target_offset}:linear=true`,
      '-ar',
      '48k', // Required sample rate for loudnorm filter
      '-c:v',
      'copy', // Copy video stream without re-encoding
      '-c:a',
      'aac', // Re-encode audio with AAC
      '-b:a',
      '128k',
      '-ac',
      '2',
      `"${fullOutputPath}"`,
    ];

    const normalizeCommandString = normalizeCommand.join(' ');
    console.log(`Running normalization command: ${normalizeCommandString}`);

    const execStartTime = Date.now();
    const { stdout: normalizeStdout, stderr: normalizeStderr } =
      await execAsync(normalizeCommandString, {
        timeout: 300000, // 5 minute timeout for normalization
      });

    const execEndTime = Date.now();
    console.log(
      `Audio normalization completed in ${execEndTime - execStartTime}ms`
    );

    // Check if output file exists
    await access(fullOutputPath);

    console.log(`Normalized audio saved to: ${fullOutputPath}`);
    return fullOutputPath;
  } catch (error) {
    console.error('Audio loudness normalization failed:', error);

    // Clean up output file if it exists
    try {
      await unlink(fullOutputPath);
    } catch (cleanupError) {
      // Ignore cleanup errors
    }

    throw new Error(
      `Audio loudness normalization failed: ${
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
    // Read the file as Buffer (which works with fetch)
    const fileBuffer = await readFile(filePath);

    // Generate filename if not provided
    const finalFilename =
      filename ||
      `normalized_${Date.now()}_${Math.random().toString(36).substr(2, 9)}.mp4`;

    // MinIO configuration
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
 * Complete workflow: Audio normalization + MinIO upload + local cleanup
 */
export async function normalizeAudioWithUpload(
  options: NormalizeAudioOptions & {
    videoId?: string;
    sceneId?: string;
    cleanup?: boolean;
  }
): Promise<{ localPath: string; uploadUrl: string }> {
  const { videoId, sceneId, cleanup = true, ...normalizeOptions } = options;

  let localPath: string | null = null;

  try {
    // Step 1: Normalize audio using FFmpeg
    localPath = await normalizeAudioLoudness(normalizeOptions);

    // Step 2: Generate filename for upload
    const timestamp = Date.now();
    const filename =
      videoId && sceneId
        ? `video_${videoId}_scene_${sceneId}_normalized_${timestamp}.mp4`
        : videoId
        ? `video_${videoId}_normalized_${timestamp}.mp4`
        : sceneId
        ? `scene_${sceneId}_normalized_${timestamp}.mp4`
        : `normalized_${timestamp}.mp4`;

    // Step 3: Upload to MinIO
    const uploadUrl = await uploadToMinio(localPath, filename, 'video/mp4');

    // Step 4: Cleanup local file if requested
    if (cleanup && localPath) {
      try {
        await unlink(localPath);
        console.log(`Cleaned up local normalized file: ${localPath}`);
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
