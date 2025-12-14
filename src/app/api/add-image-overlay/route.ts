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
    const videoTintColorRaw = formData.get('videoTintColor') as string | null;
    const videoTintOpacityRaw = formData.get('videoTintOpacity') as
      | string
      | null;
    const videoTintPositionXRaw = formData.get('videoTintPositionX') as
      | string
      | null;
    const videoTintPositionYRaw = formData.get('videoTintPositionY') as
      | string
      | null;
    const videoTintWidthRaw = formData.get('videoTintWidth') as string | null;
    const videoTintHeightRaw = formData.get('videoTintHeight') as string | null;
    const videoTintInvertRaw = formData.get('videoTintInvert') as string | null;
    const overlaySoundRaw = formData.get('overlaySound') as string | null;
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
      videoTintColor: videoTintColorRaw,
      videoTintOpacity: videoTintOpacityRaw,
      videoTintPositionX: videoTintPositionXRaw,
      videoTintPositionY: videoTintPositionYRaw,
      videoTintWidth: videoTintWidthRaw,
      videoTintHeight: videoTintHeightRaw,
      videoTintInvert: videoTintInvertRaw,
      overlaySound: overlaySoundRaw,
    });

    if (
      isNaN(sceneId) ||
      !videoUrl ||
      (!overlayImage && !overlayText && !videoTintColorRaw) ||
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

    const normalizeColor = (c: string | undefined | null) => {
      if (!c) return c;
      const trimmed = c.trim();
      if (trimmed.startsWith('#')) return '0x' + trimmed.slice(1).toUpperCase();
      return trimmed;
    };

    const clamp01 = (v: unknown, fallback: number) => {
      const n = typeof v === 'number' ? v : Number(v);
      if (!Number.isFinite(n)) return fallback;
      return Math.max(0, Math.min(1, n));
    };

    const tintColorNormalized = normalizeColor(videoTintColorRaw);
    const tintOpacity = clamp01(videoTintOpacityRaw, 1);

    const clampPct = (v: unknown, fallback: number) => {
      const n = Number(v);
      if (!Number.isFinite(n)) return fallback;
      return Math.max(0, Math.min(100, n));
    };

    const tintPosX = clampPct(videoTintPositionXRaw, 50);
    const tintPosY = clampPct(videoTintPositionYRaw, 50);
    const tintW = clampPct(videoTintWidthRaw, 100);
    const tintH = clampPct(videoTintHeightRaw, 100);
    const tintInvert = (videoTintInvertRaw || '').toLowerCase() === 'true';

    const leftPct = Math.max(0, Math.min(100, tintPosX - tintW / 2));
    const topPct = Math.max(0, Math.min(100, tintPosY - tintH / 2));
    const rightPct = Math.max(0, Math.min(100, tintPosX + tintW / 2));
    const bottomPct = Math.max(0, Math.min(100, tintPosY + tintH / 2));

    // Build tintFilter after probing video size so we can pixel-align boxes.
    // (Fractional iw*... math can leave 1px seams in invert mode.)
    let tintFilter: string | null = null;

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
    const hasAudio = Array.isArray(probeData.streams)
      ? probeData.streams.some((s: any) => s?.codec_type === 'audio')
      : false;

    // Preserve original audio format for merge compatibility.
    // (When we mix SFX we must re-encode; match the source as closely as possible.)
    let originalAudioCodec = 'aac';
    let originalAudioBitrate = 128000;
    let originalAudioSampleRate = 48000;
    let originalAudioChannels = 2;

    if (hasAudio) {
      const audioStream = probeData.streams.find(
        (s: any) => s?.codec_type === 'audio'
      );
      if (audioStream) {
        if (typeof audioStream.codec_name === 'string') {
          originalAudioCodec = audioStream.codec_name;
        }
        const br = Number(audioStream.bit_rate);
        if (Number.isFinite(br) && br > 0) originalAudioBitrate = br;
        const sr = Number(audioStream.sample_rate);
        if (Number.isFinite(sr) && sr > 0) originalAudioSampleRate = sr;
        const ch = Number(audioStream.channels);
        if (Number.isFinite(ch) && ch > 0) originalAudioChannels = ch;
      }
    }

    const channelLayout =
      originalAudioChannels === 1
        ? 'mono'
        : originalAudioChannels === 2
        ? 'stereo'
        : 'stereo';

    // When mixing (amix), audio must be re-encoded; using the source bitrate can
    // cause noticeable generational loss after multiple renders, especially if
    // the source bitrate is low. Keep a reasonable floor while staying close to
    // the original for merge compatibility.
    const minMixedAudioBitrate = originalAudioChannels === 1 ? 96000 : 192000;
    const maxMixedAudioBitrate = 512000;
    const mixedAudioBitrate = Math.min(
      maxMixedAudioBitrate,
      Math.max(originalAudioBitrate, minMixedAudioBitrate)
    );

    // Resolve optional overlay sound from /public/sounds
    let overlaySoundPath: string | null = null;
    if (overlaySoundRaw) {
      const soundName = String(overlaySoundRaw);
      const base = path.basename(soundName);
      // Prevent path traversal
      if (base !== soundName) {
        return NextResponse.json(
          { error: 'Invalid sound file' },
          { status: 400 }
        );
      }

      const soundsDir = path.join(process.cwd(), 'public', 'sounds');
      const candidate = path.join(soundsDir, base);
      try {
        await fs.promises.access(candidate, fs.constants.R_OK);
        overlaySoundPath = candidate;
      } catch {
        return NextResponse.json(
          { error: 'Sound file not found' },
          { status: 400 }
        );
      }
    }

    if (tintColorNormalized) {
      const enableExpr = `enable='gte(t\\,${startTime})*lte(t\\,${endTime})'`;
      const drawboxPx = (x: number, y: number, w: number, h: number) => {
        // Ensure FFmpeg always gets valid ints and non-negative sizes.
        const xi = Math.max(0, Math.floor(x));
        const yi = Math.max(0, Math.floor(y));
        const wi = Math.max(0, Math.floor(w));
        const hi = Math.max(0, Math.floor(h));
        return `drawbox=x=${xi}:y=${yi}:w=${wi}:h=${hi}:color=${tintColorNormalized}@${tintOpacity}:t=fill:${enableExpr}`;
      };

      // Convert % rect to pixel-aligned edges. Use floor for start and ceil for end
      // so adjacent strips meet cleanly with no gaps.
      const x0 = Math.max(
        0,
        Math.min(videoWidth, Math.floor((leftPct / 100) * videoWidth))
      );
      const y0 = Math.max(
        0,
        Math.min(videoHeight, Math.floor((topPct / 100) * videoHeight))
      );
      const x1 = Math.max(
        0,
        Math.min(videoWidth, Math.ceil((rightPct / 100) * videoWidth))
      );
      const y1 = Math.max(
        0,
        Math.min(videoHeight, Math.ceil((bottomPct / 100) * videoHeight))
      );

      const rectW = Math.max(0, x1 - x0);
      const rectH = Math.max(0, y1 - y0);

      if (!tintInvert) {
        tintFilter = drawboxPx(x0, y0, rectW, rectH);
      } else {
        const filters: string[] = [];

        // Top strip
        if (y0 > 0) {
          filters.push(drawboxPx(0, 0, videoWidth, y0));
        }
        // Bottom strip
        if (y1 < videoHeight) {
          filters.push(drawboxPx(0, y1, videoWidth, videoHeight - y1));
        }
        // Left strip between y0..y1
        if (x0 > 0 && rectH > 0) {
          filters.push(drawboxPx(0, y0, x0, rectH));
        }
        // Right strip between y0..y1
        if (x1 < videoWidth && rectH > 0) {
          filters.push(drawboxPx(x1, y0, videoWidth - x1, rectH));
        }

        tintFilter = filters.join(',');
      }
    }

    // Calculate overlay dimensions in pixels
    const overlayWidth = Math.round((sizeWidth / 100) * videoWidth);
    const overlayHeight = Math.round((sizeHeight / 100) * videoHeight);

    let ffmpegCommand: string;
    const durationLimit = preview ? '-t 10' : '';

    const soundDelayMs = Math.max(0, Math.round(startTime * 1000));

    const buildAudioFilter = (soundInputIndex: number) => {
      // If the source video has no audio stream, generate silence.
      const a0 = hasAudio
        ? `[0:a]aresample=${originalAudioSampleRate}[a0]`
        : `anullsrc=r=${originalAudioSampleRate}:cl=${channelLayout},atrim=0:${Math.max(
            0,
            Number.isFinite(endTime) ? endTime : 0
          )},asetpts=N/SR/TB[a0]`;
      const a1 = `[${soundInputIndex}:a]adelay=${soundDelayMs}:all=1,aresample=${originalAudioSampleRate}[a1]`;
      const amix = `[a0][a1]amix=inputs=2:duration=first:dropout_transition=0:normalize=0[aout]`;
      return `${a0};${a1};${amix}`;
    };

    if (overlayImage) {
      // Handle image overlay
      const imageBuffer = await overlayImage.arrayBuffer();
      const imagePath = path.join(tempDir, 'overlay.png');
      await fs.promises.writeFile(imagePath, Buffer.from(imageBuffer));

      const isGif = overlayImage.type === 'image/gif';
      const streamLoop = isGif ? '-stream_loop -1' : '';

      const overlayScale = `[1:v]scale=w=${overlayWidth}:h=${overlayHeight}:force_original_aspect_ratio=increase,crop=${overlayWidth}:${overlayHeight}[overlay]`;
      const overlayEnable = `enable='gte(t\\,${startTime})*lte(t\\,${endTime})'`;
      const overlayFilter = tintFilter
        ? `[base][overlay]overlay=W*${positionX / 100}-(${overlayWidth})/2:H*${
            positionY / 100
          }-(${overlayHeight})/2:${overlayEnable}[vout]`
        : `[0:v][overlay]overlay=W*${positionX / 100}-(${overlayWidth})/2:H*${
            positionY / 100
          }-(${overlayHeight})/2:${overlayEnable}[vout]`;

      if (overlaySoundPath) {
        const audio = buildAudioFilter(2);
        const baseVideo = tintFilter ? `[0:v]${tintFilter}[base]` : null;
        const parts = [baseVideo, overlayScale, overlayFilter, audio].filter(
          Boolean
        );
        ffmpegCommand = `ffmpeg -i "${videoPath}" ${streamLoop} -i "${imagePath}" -i "${overlaySoundPath}" -filter_complex "${parts.join(
          ';'
        )}" -map "[vout]" -map "[aout]" -ar ${originalAudioSampleRate} -c:a ${originalAudioCodec} -b:a ${Math.round(
          mixedAudioBitrate / 1000
        )}k -ac ${originalAudioChannels} -avoid_negative_ts make_zero -shortest ${durationLimit} "${outputPath}"`;
      } else {
        if (tintFilter) {
          ffmpegCommand = `ffmpeg -i "${videoPath}" ${streamLoop} -i "${imagePath}" -filter_complex "[0:v]${tintFilter}[base];${overlayScale};${overlayFilter}" -map "[vout]" -map 0:a? -c:a copy -shortest ${durationLimit} "${outputPath}"`;
        } else {
          ffmpegCommand = `ffmpeg -i "${videoPath}" ${streamLoop} -i "${imagePath}" -filter_complex "${overlayScale};${overlayFilter}" -map "[vout]" -map 0:a? -c:a copy -shortest ${durationLimit} "${outputPath}"`;
        }
      }
    } else if (overlayText) {
      // Handle text overlay - sizeWidth controls font size (5-100%)
      const fontSize = Math.max(
        16,
        Math.min(
          500,
          (sizeWidth / 100) * Math.min(videoWidth, videoHeight) * 0.2
        )
      );

      const escapeFilterValue = (value: string) =>
        value
          .replace(/\\/g, '\\\\')
          .replace(/:/g, '\\:')
          .replace(/,/g, '\\,')
          .replace(/\[/g, '\\[')
          .replace(/\]/g, '\\]')
          .replace(/'/g, "\\'")
          .replace(/ /g, '\\ ');

      // Position text to center it at the specified percentage.
      // Use FFmpeg's measured text width/height (text_w/text_h) instead of
      // approximating based on string length, which drifts for spaces/punctuation.
      const xPos = `w*${positionX / 100}-text_w/2`;
      const yPos = `h*${positionY / 100}-text_h/2`;

      // Avoid filtergraph quoting issues (e.g. apostrophes in text) by using a text file.
      const textFilePath = path.join(tempDir, 'overlay-text.txt');
      await fs.promises.writeFile(textFilePath, overlayText, 'utf8');
      const textFileArg = escapeFilterValue(textFilePath);

      // Use custom styling if provided, otherwise use defaults
      const fontColor = textStyling?.fontColor ?? 'white';
      const textOpacityRaw =
        typeof textStyling?.textOpacity === 'number'
          ? textStyling.textOpacity
          : textStyling?.textOpacity != null
          ? Number(textStyling.textOpacity)
          : undefined;
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
      const borderWidth = textStyling?.borderWidth ?? 3;
      const borderColor = textStyling?.borderColor ?? 'black';
      const shadowX = textStyling?.shadowX ?? 8;
      const shadowY = textStyling?.shadowY ?? 8;
      const shadowColor = textStyling?.shadowColor ?? 'black';
      const shadowOpacityRaw =
        typeof textStyling?.shadowOpacity === 'number'
          ? textStyling.shadowOpacity
          : textStyling?.shadowOpacity != null
          ? Number(textStyling.shadowOpacity)
          : 0.9;
      const fontFamily = textStyling?.fontFamily ?? 'Helvetica';

      // Map font family names to actual font files; use the generated mapping
      const mapping = Object.fromEntries(
        Object.entries(ffmpegFonts).filter(([_, value]) => value !== null)
      ) as Record<string, string>;
      const fontFileMap: { [key: string]: string } = Object.fromEntries(
        Object.entries(mapping).filter(([k]) => k !== 'user_fonts_dir')
      );

      let fontFile =
        fontFileMap[fontFamily] || '/System/Library/Fonts/Helvetica.ttc';

      // Resolve relative asset paths (like assets/fonts/...) to absolute file paths
      if (fontFile && !path.isAbsolute(fontFile)) {
        fontFile = path.join(process.cwd(), fontFile);
      }

      // Ensure the font file exists on disk. If not, fall back to system default.
      try {
        await fs.promises.access(fontFile, fs.constants.R_OK);
      } catch (err) {
        console.warn(
          `Font file ${fontFile} is not readable or missing; falling back to default`,
          err
        );
        fontFile = '/System/Library/Fonts/Helvetica.ttc';
      }

      // include text opacity if provided
      const fontColorNormalized = normalizeColor(fontColor) || fontColor;
      const fontColorWithOpacity =
        typeof textOpacityRaw === 'number' && Number.isFinite(textOpacityRaw)
          ? `${fontColorNormalized}@${clamp01(textOpacityRaw, 1)}`
          : fontColorNormalized;

      const borderColorNormalized =
        normalizeColor(borderColor) || borderColor || 'black';
      const shadowColorNormalized =
        normalizeColor(shadowColor) || shadowColor || 'black';
      const shadowOpacity = clamp01(shadowOpacityRaw, 0.9);
      let boxParams = '';
      if (bgColor) {
        const bgColorNormalized = normalizeColor(bgColor) || bgColor;
        const boxColorWithOpacity = `${bgColorNormalized}@${Math.max(
          0,
          Math.min(1, Number(bgOpacity))
        )}`;
        // Use drawtext built-in box so padding follows measured text_w/text_h.
        boxParams = `:box=1:boxcolor=${boxColorWithOpacity}:boxborderw=${Math.max(
          0,
          Math.min(200, Number(bgSize))
        )}`;
      }

      const fontFileArg = escapeFilterValue(fontFile);
      const drawText = `drawtext=textfile=${textFileArg}:borderw=${borderWidth}:bordercolor=${borderColorNormalized}:fontsize=${fontSize}:fontcolor=${fontColorWithOpacity}:shadowx=${shadowX}:shadowy=${shadowY}:shadowcolor=${shadowColorNormalized}@${shadowOpacity}:fontfile=${fontFileArg}:x=${xPos}:y=${yPos}${boxParams}:enable='gte(t\\,${startTime})*lte(t\\,${endTime})'`;
      const vf = tintFilter ? `${tintFilter},${drawText}` : drawText;
      if (overlaySoundPath) {
        const audio = buildAudioFilter(1);
        ffmpegCommand = `ffmpeg -i "${videoPath}" -i "${overlaySoundPath}" -filter_complex "[0:v]${vf}[vout];${audio}" -map "[vout]" -map "[aout]" -ar ${originalAudioSampleRate} -c:a ${originalAudioCodec} -b:a ${Math.round(
          mixedAudioBitrate / 1000
        )}k -ac ${originalAudioChannels} -avoid_negative_ts make_zero ${durationLimit} "${outputPath}"`;
      } else {
        ffmpegCommand = `ffmpeg -i "${videoPath}" -vf "${vf}" -c:a copy ${durationLimit} "${outputPath}"`;
      }
    } else if (tintFilter) {
      // Tint-only
      if (overlaySoundPath) {
        const audio = buildAudioFilter(1);
        ffmpegCommand = `ffmpeg -i "${videoPath}" -i "${overlaySoundPath}" -filter_complex "[0:v]${tintFilter}[vout];${audio}" -map "[vout]" -map "[aout]" -ar ${originalAudioSampleRate} -c:a ${originalAudioCodec} -b:a ${Math.round(
          mixedAudioBitrate / 1000
        )}k -ac ${originalAudioChannels} -avoid_negative_ts make_zero ${durationLimit} "${outputPath}"`;
      } else {
        ffmpegCommand = `ffmpeg -i "${videoPath}" -vf "${tintFilter}" -c:a copy ${durationLimit} "${outputPath}"`;
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
