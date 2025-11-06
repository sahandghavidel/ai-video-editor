import { exec } from 'child_process';
import { promisify } from 'util';
import path from 'path';
import { readFile, access, unlink } from 'fs/promises';

const execAsync = promisify(exec);

export interface ConvertToCFROptions {
  inputUrl: string;
  outputPath?: string;
  framerate?: number; // Target framerate (default: 30)
}

/**
 * Convert video to Constant Frame Rate (CFR) using FFmpeg
 */
export async function convertToCFR(
  options: ConvertToCFROptions
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
    const cfrCommand = [
      'ffmpeg',
      '-y',
      '-i',
      `"${inputUrl}"`,
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
      '23',
      '-c:a',
      'aac',
      '-b:a',
      '128k',
      '-ar',
      '48000',
      `"${fullOutputPath}"`,
    ];

    const cfrCommandString = cfrCommand.join(' ');
    console.log(`Running CFR conversion command: ${cfrCommandString}`);

    const execStartTime = Date.now();
    const { stdout, stderr } = await execAsync(cfrCommandString, {
      timeout: 600000, // 10 minute timeout for conversion
    });

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
    } catch (cleanupError) {
      // Ignore cleanup errors
    }

    throw new Error(
      `CFR conversion failed: ${
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
      `cfr_${Date.now()}_${Math.random().toString(36).substr(2, 9)}.mp4`;

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
 * Complete workflow: CFR conversion + MinIO upload + local cleanup
 */
export async function convertToCFRWithUpload(
  options: ConvertToCFROptions & {
    videoId?: string;
    cleanup?: boolean;
  }
): Promise<{ localPath: string; uploadUrl: string }> {
  const { videoId, cleanup = true, ...cfrOptions } = options;

  let localPath: string | null = null;

  try {
    // Step 1: Convert to CFR using FFmpeg
    localPath = await convertToCFR(cfrOptions);

    // Step 2: Generate filename for upload
    const timestamp = Date.now();
    const filename = videoId
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
      } catch (cleanupError) {
        // Ignore cleanup errors
      }
    }

    throw error;
  }
}
