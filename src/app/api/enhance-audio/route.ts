import { NextRequest, NextResponse } from 'next/server';
import { exec } from 'child_process';
import { promisify } from 'util';
import path from 'path';
import { readFile, unlink } from 'fs/promises';

const execAsync = promisify(exec);

/**
 * Upload a file to MinIO storage
 */
async function uploadToMinio(
  filePath: string,
  filename?: string,
  contentType: string = 'video/mp4'
): Promise<string> {
  try {
    // Read the file as Buffer
    const fileBuffer = await readFile(filePath);

    // Generate filename if not provided
    const finalFilename =
      filename ||
      `enhanced_${Date.now()}_${Math.random().toString(36).substr(2, 9)}.mp4`;

    // MinIO configuration
    const bucket = 'nca-toolkit';
    const uploadUrl = `http://host.docker.internal:9000/${bucket}/${finalFilename}`;

    // Upload to MinIO using direct HTTP PUT
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
 * Enhance audio using Resemble Enhance (AI-powered denoising and enhancement)
 */
export async function POST(request: NextRequest) {
  try {
    const {
      sceneId,
      videoUrl,
      denoiseOnly = false,
      solver = 'midpoint',
      nfe = 64,
      tau = 0.5,
      lambd = 1.0,
    } = await request.json();

    if (!sceneId) {
      return NextResponse.json(
        { error: 'Scene ID is required' },
        { status: 400 }
      );
    }

    if (!videoUrl) {
      return NextResponse.json(
        { error: 'Video URL is required' },
        { status: 400 }
      );
    }

    console.log(
      `[ENHANCE] Scene ${sceneId}: Starting Resemble Enhance audio processing (denoise_only=${denoiseOnly}, solver=${solver}, nfe=${nfe}, tau=${tau}, lambd=${lambd})`
    );

    const enhanceStartTime = Date.now();

    try {
      // Create output path
      const outputFileName = `enhanced_${sceneId}_${Date.now()}.mp4`;
      const outputPath = path.resolve('/tmp', outputFileName);

      // Get the Python script path (in project root)
      const scriptPath = path.resolve(
        process.cwd(),
        'resemble-enhance-audio.py'
      );

      // Build Python command with all parameters
      let pythonCmd = `python3 "${scriptPath}" "${videoUrl}" "${outputPath}"`;

      if (denoiseOnly) {
        pythonCmd += ' --denoise-only';
      }

      // Add advanced parameters
      pythonCmd += ` --solver ${solver}`;
      pythonCmd += ` --nfe ${nfe}`;
      pythonCmd += ` --tau ${tau}`;
      pythonCmd += ` --lambd ${lambd}`;

      console.log(`[ENHANCE] Running command: ${pythonCmd}`);

      // Execute Python script
      // Note: Higher NFE values (128) can take 15-20 minutes on CPU
      const { stdout, stderr } = await execAsync(pythonCmd, {
        timeout: 1800000, // 30 minute timeout (increased for high NFE values)
        maxBuffer: 50 * 1024 * 1024, // 50MB buffer for large outputs
      });

      console.log(`[ENHANCE] Python script stderr:`, stderr);

      // Parse the JSON output from Python script
      const result = JSON.parse(stdout.trim());

      if (!result.success) {
        throw new Error(result.error || 'Enhancement failed');
      }

      console.log(`[ENHANCE] Audio enhancement completed successfully`);

      // Upload to MinIO
      console.log(`[ENHANCE] Uploading enhanced video to MinIO...`);
      const uploadUrl = await uploadToMinio(
        result.output_path,
        `video_${sceneId}_enhanced_${Date.now()}.mp4`
      );

      // Cleanup local file
      try {
        await unlink(result.output_path);
      } catch (cleanupError) {
        console.warn('[ENHANCE] Failed to cleanup local file:', cleanupError);
      }

      const enhanceEndTime = Date.now();
      console.log(
        `[ENHANCE] Scene ${sceneId}: Total processing time: ${
          enhanceEndTime - enhanceStartTime
        }ms`
      );

      return NextResponse.json({
        success: true,
        message: `Successfully enhanced audio using Resemble Enhance${
          denoiseOnly ? ' (denoise only)' : ''
        }`,
        data: {
          sceneId,
          originalUrl: videoUrl,
          enhancedUrl: uploadUrl,
          denoiseOnly,
          processingTime: enhanceEndTime - enhanceStartTime,
        },
      });
    } catch (enhanceError) {
      console.error(
        `[ENHANCE] Scene ${sceneId}: Enhancement failed:`,
        enhanceError
      );

      return NextResponse.json(
        {
          error: 'Audio enhancement failed',
          details:
            enhanceError instanceof Error
              ? enhanceError.message
              : 'Unknown error',
          sceneId,
        },
        { status: 500 }
      );
    }
  } catch (error) {
    console.error('[ENHANCE] API error:', error);

    return NextResponse.json(
      {
        error: 'Internal server error',
        details: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 }
    );
  }
}
