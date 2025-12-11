import { NextRequest, NextResponse } from 'next/server';
import { exec } from 'child_process';
import { promisify } from 'util';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { uploadToMinio } from '@/utils/ffmpeg-cfr';

const execAsync = promisify(exec);

export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData();
    const sceneId = formData.get('sceneId') as string;
    const videoUrl = formData.get('videoUrl') as string;
    const overlayImage = formData.get('overlayImage') as File;
    const positionX = parseFloat(formData.get('positionX') as string);
    const positionY = parseFloat(formData.get('positionY') as string);
    const widthPercent = parseFloat(formData.get('widthPercent') as string);
    const heightPercent = parseFloat(formData.get('heightPercent') as string);
    const startTime = parseFloat(formData.get('startTime') as string);
    const endTime = parseFloat(formData.get('endTime') as string);

    if (
      !sceneId ||
      !videoUrl ||
      !overlayImage ||
      isNaN(positionX) ||
      isNaN(positionY) ||
      isNaN(widthPercent) ||
      isNaN(heightPercent) ||
      isNaN(startTime) ||
      isNaN(endTime)
    ) {
      return NextResponse.json(
        { error: 'Missing required parameters' },
        { status: 400 }
      );
    }

    // Create temporary directory
    const tempDir = path.join(os.tmpdir(), `overlay-${Date.now()}`);
    await fs.promises.mkdir(tempDir, { recursive: true });

    try {
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
      const overlayWidth = Math.round((widthPercent / 100) * videoWidth);
      const overlayHeight = Math.round((heightPercent / 100) * videoHeight);
      const imageBuffer = await overlayImage.arrayBuffer();
      const imagePath = path.join(tempDir, 'overlay.png');
      await fs.promises.writeFile(imagePath, Buffer.from(imageBuffer));

      // Apply FFmpeg overlay
      const outputPath = path.join(tempDir, 'output.mp4');

      const isGif = overlayImage.type === 'image/gif';
      const streamLoop = isGif ? '-stream_loop -1' : '';

      const ffmpegCommand = `ffmpeg -i "${videoPath}" ${streamLoop} -i "${imagePath}" -filter_complex "[1:v]scale=w=${overlayWidth}:h=${overlayHeight}:force_original_aspect_ratio=increase,crop=${overlayWidth}:${overlayHeight}[overlay];[0:v][overlay]overlay=W*${
        positionX / 100
      }-(${overlayWidth})/2:H*${
        positionY / 100
      }-(${overlayHeight})/2:enable='gte(t\,${startTime})*lte(t\,${endTime})'" -c:a copy -shortest "${outputPath}"`;

      await execAsync(ffmpegCommand);

      // Upload to MinIO
      const outputBuffer = await fs.promises.readFile(outputPath);
      const tempUploadPath = path.join(tempDir, 'upload.mp4');
      await fs.promises.writeFile(tempUploadPath, outputBuffer);
      const fileName = `scene-${sceneId}-overlay-${Date.now()}.mp4`;
      const uploadUrl = await uploadToMinio(
        tempUploadPath,
        fileName,
        'video/mp4'
      );

      return NextResponse.json({ success: true, url: uploadUrl });
    } finally {
      // Clean up temporary files
      try {
        await fs.promises.rm(tempDir, { recursive: true, force: true });
      } catch (cleanupError) {
        console.error('Failed to clean up temp files:', cleanupError);
      }
    }
  } catch (error) {
    console.error('Error adding image overlay:', error);
    return NextResponse.json(
      { error: 'Failed to add image overlay' },
      { status: 500 }
    );
  }
}
