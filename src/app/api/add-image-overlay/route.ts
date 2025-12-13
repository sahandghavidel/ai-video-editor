import { NextRequest, NextResponse } from 'next/server';
import { exec } from 'child_process';
import { promisify } from 'util';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { uploadToMinio } from '@/utils/ffmpeg-cfr';
import ffmpegFonts from '../../../../docs/ffmpeg-fonts.json';
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
    const textStyling = formData.get('textStyling')
      ? JSON.parse(formData.get('textStyling') as string)
      : null;

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
      // Handle text overlay - sizeWidth controls font size (5-100%)
      const fontSize = Math.max(
        16,
        Math.min(
          500,
          (sizeWidth / 100) * Math.min(videoWidth, videoHeight) * 0.2
        )
      );

      // Estimate text dimensions (rough approximation)
      const textWidth = overlayText.length * fontSize * 0.6; // approximate character width
      const textHeight = fontSize * 1.2; // line height

      // Position text to center it at the specified percentage
      const xPos = `w*${positionX / 100}-(${textWidth}/2)`;
      const yPos = `h*${positionY / 100}-(${textHeight}/2)`;

      // Escape text properly for FFmpeg - handle special characters that can break FFmpeg
      const escapedText = overlayText
        .replace(/\\/g, '\\\\') // Escape backslashes first
        .replace(/'/g, "\\'") // Escape single quotes
        .replace(/:/g, '\\:') // Escape colons
        .replace(/\[/g, '\\[') // Escape square brackets
        .replace(/\]/g, '\\]') // Escape square brackets
        .replace(/,/g, '\\,') // Escape commas
        .replace(/;/g, '\\;') // Escape semicolons
        .replace(/\(/g, '\\(') // Escape parentheses
        .replace(/\)/g, '\\)'); // Escape parentheses

      // Use custom styling if provided, otherwise use defaults
      const fontColor = textStyling?.fontColor || 'white';
      const textOpacity = textStyling?.textOpacity || undefined;
      // Background params
      const bgColor = textStyling?.bgColor || null;
      const bgOpacity =
        typeof textStyling?.bgOpacity === 'number'
          ? textStyling?.bgOpacity
          : textStyling?.bgOpacity
          ? Number(textStyling?.bgOpacity)
          : 1;
      const bgSize =
        typeof textStyling?.bgSize === 'number'
          ? textStyling?.bgSize
          : textStyling?.bgSize
          ? Number(textStyling?.bgSize)
          : 0;
      const borderWidth = textStyling?.borderWidth || 3;
      const borderColor = textStyling?.borderColor || 'black';
      const shadowX = textStyling?.shadowX || 8;
      const shadowY = textStyling?.shadowY || 8;
      const shadowColor = textStyling?.shadowColor || 'black';
      const shadowOpacity = textStyling?.shadowOpacity || 0.9;
      const fontFamily = textStyling?.fontFamily || 'Helvetica';

      // Map font family names to actual font files; use the generated mapping
      const mapping = (ffmpegFonts as Record<string, string>) || {};
      const fontFileMap: { [key: string]: string } = Object.fromEntries(
        Object.entries(mapping).filter(([k]) => k !== 'user_fonts_dir')
      );

      const fontFile =
        fontFileMap[fontFamily] || '/System/Library/Fonts/Helvetica.ttc';

      // helper normalize hex #RRGGBB => 0xRRGGBB because FFmpeg drawtext accepts 0x notation
      const normalizeColor = (c: string | undefined | null) => {
        if (!c) return c;
        const trimmed = c.trim();
        if (trimmed.startsWith('#'))
          return '0x' + trimmed.slice(1).toUpperCase();
        return trimmed;
      };

      // include text opacity if provided
      const fontColorWithOpacity = textOpacity
        ? `${normalizeColor(fontColor)}@${Math.max(
            0,
            Math.min(1, Number(textOpacity))
          )}`
        : normalizeColor(fontColor) || fontColor;
      let boxParams = '';
      let drawboxFilter = '';
      if (bgColor && bgSize > 0) {
        const bgColorNormalized = normalizeColor(bgColor) || bgColor;
        const boxColorWithOpacity = `${bgColorNormalized}@${Math.max(
          0,
          Math.min(1, Number(bgOpacity))
        )}`;
        // Compute drawbox position and size based on estimated text dimensions
        const posX = positionX / 100;
        const posY = positionY / 100;
        const boxX = Math.round(videoWidth * posX - textWidth / 2 - bgSize);
        const boxY = Math.round(videoHeight * posY - textHeight / 2 - bgSize);
        const boxW = Math.round(textWidth + bgSize * 2);
        const boxH = Math.round(textHeight + bgSize * 2);
        drawboxFilter = `drawbox=x=${boxX}:y=${boxY}:w=${boxW}:h=${boxH}:color=${boxColorWithOpacity}:t=fill:enable='gte(t\\,${startTime})*lte(t\\,${endTime})'`;
      } else if (bgColor && bgSize === 0) {
        const bgColorNormalized = normalizeColor(bgColor) || bgColor;
        const boxColorWithOpacity = `${bgColorNormalized}@${Math.max(
          0,
          Math.min(1, Number(bgOpacity))
        )}`;
        boxParams = `:box=1:boxcolor=${boxColorWithOpacity}:boxborderw=${Math.max(
          0,
          Math.min(200, Number(bgSize))
        )}`;
      }

      if (drawboxFilter) {
        const vf = `${drawboxFilter},drawtext=text='${escapedText}':borderw=${borderWidth}:bordercolor=${borderColor}:fontsize=${fontSize}:fontcolor=${fontColorWithOpacity}:shadowx=${shadowX}:shadowy=${shadowY}:shadowcolor=${shadowColor}@${shadowOpacity}:fontfile=${fontFile}:x=${xPos}:y=${yPos}:enable='gte(t\\,${startTime})*lte(t\\,${endTime})'`;
        ffmpegCommand = `ffmpeg -i "${videoPath}" -vf "${vf}" -c:a copy ${durationLimit} "${outputPath}"`;
      } else {
        ffmpegCommand = `ffmpeg -i "${videoPath}" -vf "drawtext=text='${escapedText}':borderw=${borderWidth}:bordercolor=${borderColor}:fontsize=${fontSize}:fontcolor=${fontColorWithOpacity}:shadowx=${shadowX}:shadowy=${shadowY}:shadowcolor=${shadowColor}@${shadowOpacity}:fontfile=${fontFile}:x=${xPos}:y=${yPos}${boxParams}:enable='gte(t\\,${startTime})*lte(t\\,${endTime})'" -c:a copy ${durationLimit} "${outputPath}"`;
      }
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

    // Only update the scene with the new video URL if this is not a preview
    if (!preview) {
      await updateSceneRow(sceneId, {
        field_6886: uploadUrl,
      });
    }

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
