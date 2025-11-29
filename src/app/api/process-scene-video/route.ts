import { NextRequest, NextResponse } from 'next/server';
import {
  normalizeAudioLoudness,
  normalizeAudioWithUpload,
} from '@/utils/ffmpeg-normalize';
import { convertToCFR, convertToCFRWithUpload } from '@/utils/ffmpeg-cfr';
import { uploadToMinio } from '@/utils/ffmpeg-cfr';
import path from 'path';
import { writeFile, unlink } from 'fs/promises';

export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData();
    const file = formData.get('file') as File;
    const sceneId = formData.get('sceneId') as string;
    const videoId = formData.get('videoId') as string;
    const applyNormalize = formData.get('applyNormalize') === 'true';
    const applyCfr = formData.get('applyCfr') === 'true';

    if (!file) {
      return NextResponse.json({ error: 'No file provided' }, { status: 400 });
    }

    if (!sceneId || !videoId) {
      return NextResponse.json(
        { error: 'Scene ID and Video ID are required' },
        { status: 400 }
      );
    }

    // Validate file type
    if (!file.type.startsWith('video/')) {
      return NextResponse.json(
        { error: 'File must be a video' },
        { status: 400 }
      );
    }

    // Validate file size (max 10GB)
    const maxSize = 10 * 1024 * 1024 * 1024; // 10GB
    if (file.size > maxSize) {
      return NextResponse.json(
        { error: 'File size must be less than 10GB' },
        { status: 400 }
      );
    }

    console.log(`Processing scene video: ${file.name}, size: ${file.size}`);
    console.log(`Scene ID: ${sceneId}, Video ID: ${videoId}`);
    console.log(`Apply normalize: ${applyNormalize}, Apply CFR: ${applyCfr}`);

    // Convert file to buffer and save temporarily
    const arrayBuffer = await file.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    // Create temporary input file
    const timestamp = Date.now();
    const inputFileName = `input_${sceneId}_${timestamp}.mp4`;
    const inputPath = path.resolve('/tmp', inputFileName);

    // Write buffer to temp file
    const { writeFile } = await import('fs/promises');
    await writeFile(inputPath, buffer);

    let currentPath = inputPath;
    let finalPath = inputPath;

    try {
      // Step 1: Apply normalization if requested
      if (applyNormalize) {
        console.log('Applying audio normalization...');
        const normalizedPath = await normalizeAudioLoudness({
          inputUrl: currentPath,
          targetLoudness: -19,
          loudnessRange: 7,
          truePeak: -2,
        });

        // Clean up previous file if different
        if (currentPath !== inputPath) {
          try {
            await unlink(currentPath);
          } catch (cleanupError) {
            console.warn(
              `Failed to cleanup intermediate file: ${cleanupError}`
            );
          }
        }

        currentPath = normalizedPath;
        finalPath = normalizedPath;
        console.log('Audio normalization completed');
      }

      // Step 2: Apply CFR conversion if requested
      if (applyCfr) {
        console.log('Applying CFR conversion...');
        const cfrPath = await convertToCFR({
          inputUrl: currentPath,
          framerate: 30,
        });

        // Clean up previous file if different
        if (currentPath !== inputPath) {
          try {
            await unlink(currentPath);
          } catch (cleanupError) {
            console.warn(
              `Failed to cleanup intermediate file: ${cleanupError}`
            );
          }
        }

        currentPath = cfrPath;
        finalPath = cfrPath;
        console.log('CFR conversion completed');
      }

      // Step 3: Upload the final processed video to MinIO
      console.log('Uploading processed video to MinIO...');
      const filename = `video_${videoId}_scene_${sceneId}_processed_${timestamp}.mp4`;
      const uploadUrl = await uploadToMinio(finalPath, filename, 'video/mp4');

      console.log('Scene video processed and uploaded successfully:', filename);

      // Clean up final file
      try {
        await unlink(finalPath);
      } catch (cleanupError) {
        console.warn(`Failed to cleanup final file: ${cleanupError}`);
      }

      return NextResponse.json({
        success: true,
        videoUrl: uploadUrl,
        filename,
        message: 'Scene video processed and uploaded successfully',
        processing: {
          normalized: applyNormalize,
          cfr: applyCfr,
        },
      });
    } catch (processingError) {
      console.error('Processing failed:', processingError);

      // If processing failed but we have the original file, try uploading it as-is
      if (finalPath === inputPath) {
        console.log('Uploading original file as fallback...');
        try {
          const filename = `video_${videoId}_scene_${sceneId}_raw_${timestamp}.mp4`;
          const uploadUrl = await uploadToMinio(
            finalPath,
            filename,
            'video/mp4'
          );

          return NextResponse.json({
            success: true,
            videoUrl: uploadUrl,
            filename,
            message: 'Original video uploaded (processing failed)',
            processing: {
              normalized: false,
              cfr: false,
              error:
                processingError instanceof Error
                  ? processingError.message
                  : 'Unknown error',
            },
          });
        } catch (uploadError) {
          console.error('Fallback upload also failed:', uploadError);
        }
      }

      throw processingError;
    } finally {
      // Clean up input file
      try {
        await unlink(inputPath);
      } catch (cleanupError) {
        console.warn(`Failed to cleanup input file: ${cleanupError}`);
      }
    }
  } catch (error) {
    console.error('Error processing scene video:', error);
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : 'Processing failed',
      },
      { status: 500 }
    );
  }
}
