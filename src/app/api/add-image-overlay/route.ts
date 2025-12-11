import { NextRequest, NextResponse } from 'next/server';
import { exec } from 'child_process';
import { promisify } from 'util';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { uploadToMinio } from '@/utils/ffmpeg-cfr';
import { updateSceneRow } from '@/lib/baserow-actions';

const execAsync = promisify(exec);

export async function POST(request: NextRequest) {
  let tempDir: string | null = null;

  try {
    const formData = await request.formData();
    const sceneIdString = formData.get('sceneId') as string;
    const sceneId = parseInt(sceneIdString, 10);
    const videoUrl = formData.get('videoUrl') as string;
    const overlayImage = formData.get('overlayImage') as File | null;
    const overlayText = formData.get('overlayText') as string | null;
    const positionX = parseFloat(formData.get('positionX') as string);
    const positionY = parseFloat(formData.get('positionY') as string);
    const sizeWidth = parseFloat(formData.get('sizeWidth') as string);
    const sizeHeight = parseFloat(formData.get('sizeHeight') as string);
    const startTime = parseFloat(formData.get('startTime') as string);
    const endTime = parseFloat(formData.get('endTime') as string);
    const preview = formData.get('preview') === 'true';

    console.log('API received:', {
      sceneId,
      videoUrl,
      overlayImage: !!overlayImage,
      overlayText,
      positionX,
      positionY,
      sizeWidth,
      sizeHeight,
      startTime,
      endTime,
      preview,
    });

    if (
      isNaN(sceneId) ||
      !videoUrl ||
      (!overlayImage && !overlayText) ||
      isNaN(positionX) ||
      isNaN(positionY) ||
      isNaN(sizeWidth) ||
      isNaN(sizeHeight) ||
      isNaN(startTime) ||
      isNaN(endTime)
    ) {
      return NextResponse.json(
        { error: 'Missing required parameters' },
        { status: 400 }
      );
    }

    // Create temporary directory
    tempDir = path.join(os.tmpdir(), `overlay-${Date.now()}`);
    await fs.promises.mkdir(tempDir, { recursive: true });

    // Apply overlay
    const outputPath = path.join(tempDir, 'output.mp4');

    // Download video
    const videoResponse = await fetch(videoUrl);
    if (!videoResponse.ok) {
      throw new Error('Failed to download video');
    }
    const videoBuffer = await videoResponse.arrayBuffer();
    const videoPath = path.join(tempDir, 'input.mp4');
    await fs.promises.writeFile(videoPath, Buffer.from(videoBuffer));

    // Get video dimensions
    const { stdout: probeOutput } = await execAsync(
      `ffprobe -v quiet -print_format json -show_streams "${videoPath}"`
    );
    const probeData = JSON.parse(probeOutput);
    const videoStream = probeData.streams.find(
      (s: any) => s.codec_type === 'video'
    );
    if (!videoStream) {
      throw new Error('No video stream found');
    }
    const videoWidth = videoStream.width;
    const videoHeight = videoStream.height;

    // Calculate overlay dimensions in pixels
    const overlayWidth = Math.round((sizeWidth / 100) * videoWidth);
    const overlayHeight = Math.round((sizeHeight / 100) * videoHeight);

    let ffmpegCommand: string;
    const durationLimit = preview ? '-t 10' : '';

    if (overlayImage) {
      // Handle image overlay
      const imageBuffer = await overlayImage.arrayBuffer();
      const imagePath = path.join(tempDir, 'overlay.png');
      await fs.promises.writeFile(imagePath, Buffer.from(imageBuffer));

      const isGif = overlayImage.type === 'image/gif';
      const streamLoop = isGif ? '-stream_loop -1' : '';

      ffmpegCommand = `ffmpeg -i "${videoPath}" ${streamLoop} -i "${imagePath}" -filter_complex "[1:v]scale=w=${overlayWidth}:h=${overlayHeight}:force_original_aspect_ratio=increase,crop=${overlayWidth}:${overlayHeight}[overlay];[0:v][overlay]overlay=W*${
        positionX / 100
      }-(${overlayWidth})/2:H*${
        positionY / 100
      }-(${overlayHeight})/2:enable='gte(t\\,${startTime})*lte(t\\,${endTime})'" -c:a copy -shortest ${durationLimit} "${outputPath}"`;
    } else if (overlayText) {
      // Handle text overlay
      const fontSize = Math.min(overlayWidth, overlayHeight) * 0.8;
      const xPos = `(w-text_w)/2`;
      const yPos = `(h-text_h)/2`;

      // Escape text properly for FFmpeg
      const escapedText = overlayText
        .replace(/'/g, "\\'")
        .replace(/:/g, '\\:')
        .replace(/\\/g, '\\\\');

      ffmpegCommand = `ffmpeg -i "${videoPath}" -vf "drawtext=text='${escapedText}':fontsize=${fontSize}:fontcolor=white:shadowx=2:shadowy=2:x=${xPos}:y=${yPos}:enable='gte(t\\,${startTime})*lte(t\\,${endTime})'" -c:a copy ${durationLimit} "${outputPath}"`;
    } else {
      throw new Error('No overlay content provided');
    }

    await execAsync(ffmpegCommand);

    // Upload to MinIO
    const outputBuffer = await fs.promises.readFile(outputPath);
    const tempUploadPath = path.join(tempDir, 'upload.mp4');
    await fs.promises.writeFile(tempUploadPath, outputBuffer);
    const fileName = preview
      ? `temp-preview-${sceneId}-${Date.now()}.mp4`
      : `scene-${sceneId}-overlay-${Date.now()}.mp4`;
    const uploadUrl = await uploadToMinio(
      tempUploadPath,
      fileName,
      'video/mp4'
    );

    // Update the scene with the new video URL
    await updateSceneRow(sceneId, {
      field_6886: uploadUrl,
    });

    return NextResponse.json({ success: true, url: uploadUrl });
  } catch (error) {
    console.error('Error adding overlay:', error);
    return NextResponse.json(
      { error: 'Failed to add overlay' },
      { status: 500 }
    );
  } finally {
    // Clean up temporary files
    if (tempDir) {
      await fs.promises
        .rm(tempDir, { recursive: true, force: true })
        .catch((cleanupError) => {
          console.error('Failed to clean up temp files:', cleanupError);
        });
    }
  }
}
