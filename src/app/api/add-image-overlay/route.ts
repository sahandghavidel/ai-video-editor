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
    const width = parseInt(formData.get('width') as string);
    const height = parseInt(formData.get('height') as string);

    if (
      !sceneId ||
      !videoUrl ||
      !overlayImage ||
      isNaN(positionX) ||
      isNaN(positionY) ||
      isNaN(width) ||
      isNaN(height)
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

      // Save overlay image
      const imageBuffer = await overlayImage.arrayBuffer();
      const imagePath = path.join(tempDir, 'overlay.png');
      await fs.promises.writeFile(imagePath, Buffer.from(imageBuffer));

      // Apply FFmpeg overlay
      const outputPath = path.join(tempDir, 'output.mp4');

      // Calculate position in pixels (assuming 1920x1080 base resolution)
      const baseWidth = 1920;
      const baseHeight = 1080;
      const x = Math.round((positionX / 100) * baseWidth - width / 2);
      const y = Math.round((positionY / 100) * baseHeight - height / 2);

      const ffmpegCommand = `ffmpeg -i "${videoPath}" -i "${imagePath}" -filter_complex "[1:v]scale=${width}:${height}[overlay];[0:v][overlay]overlay=${x}:${y}" -c:a copy "${outputPath}"`;

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
