import { NextRequest, NextResponse } from 'next/server';
import { spawn } from 'child_process';
import path from 'path';
import { access, unlink } from 'fs/promises';
import { uploadToMinio } from '@/utils/ffmpeg-cfr';

function parseDimension(
  input: unknown
): { width: number; height: number } | null {
  if (typeof input !== 'string') return null;
  const trimmed = input.trim();
  if (!trimmed) return null;

  // Support: 1920x1080, 1920×1080, 1920 X 1080
  const match = trimmed.match(/(\d{2,5})\s*[x×X]\s*(\d{2,5})/);
  if (!match) return null;

  const width = Number(match[1]);
  const height = Number(match[2]);
  if (!Number.isFinite(width) || !Number.isFinite(height)) return null;
  if (width <= 0 || height <= 0) return null;
  return { width, height };
}

function parseHexColor(input: unknown): string | null {
  if (typeof input !== 'string') return null;
  const trimmed = input.trim();
  if (!trimmed) return null;

  // Accept '#RRGGBB' or 'RRGGBB' or strings containing a hex color.
  const match = trimmed.match(/#?[0-9a-fA-F]{6}/);
  if (!match) return null;

  const hex = match[0].startsWith('#') ? match[0] : `#${match[0]}`;
  return hex.toUpperCase();
}

async function runFfmpeg(args: string[], timeoutMs: number): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const child = spawn('ffmpeg', args, { stdio: ['ignore', 'pipe', 'pipe'] });

    let stderr = '';
    const timeout = setTimeout(() => {
      child.kill('SIGKILL');
      reject(new Error(`FFmpeg timed out after ${timeoutMs}ms`));
    }, timeoutMs);

    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
    });

    child.on('error', (err) => {
      clearTimeout(timeout);
      reject(err);
    });

    child.on('close', (code) => {
      clearTimeout(timeout);
      if (code === 0) return resolve();
      reject(new Error(`FFmpeg failed (code ${code}). ${stderr}`));
    });
  });
}

export async function POST(request: NextRequest) {
  let outputPath: string | null = null;

  try {
    const {
      videoId,
      audioUrl,
      dimension,
      bgColor,
      framerate = 30,
    } = await request.json();

    if (!videoId) {
      return NextResponse.json(
        { error: 'Video ID is required' },
        { status: 400 }
      );
    }

    if (!audioUrl || typeof audioUrl !== 'string') {
      return NextResponse.json(
        { error: 'Audio URL is required' },
        { status: 400 }
      );
    }

    if (typeof framerate !== 'number' || framerate <= 0 || framerate > 120) {
      return NextResponse.json(
        { error: 'Framerate must be a number between 1 and 120' },
        { status: 400 }
      );
    }

    const parsedDim = parseDimension(dimension) ?? {
      width: 1920,
      height: 1080,
    };
    const parsedBg = parseHexColor(bgColor) ?? '#FFFFFF';

    const timestamp = Date.now();
    const outFileName = `video_${videoId}_tts_bg_${timestamp}.mp4`;
    outputPath = path.resolve('/tmp', outFileName);

    console.log(
      `[TTS->VIDEO] Video ${videoId}: Generating ${parsedDim.width}x${parsedDim.height} @ ${framerate}fps bg=${parsedBg}`
    );
    console.log(`[TTS->VIDEO] Audio URL: ${audioUrl}`);

    const colorSrc = `color=c=${parsedBg}:s=${parsedDim.width}x${parsedDim.height}:r=${framerate}`;

    const ffmpegArgs = [
      '-y',
      '-f',
      'lavfi',
      '-i',
      colorSrc,
      '-i',
      audioUrl,
      '-map',
      '0:v:0',
      '-map',
      '1:a:0',
      '-shortest',
      '-r',
      String(framerate),
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
      '-movflags',
      '+faststart',
      outputPath,
    ];

    const startTime = Date.now();
    await runFfmpeg(ffmpegArgs, 10 * 60 * 1000);
    const endTime = Date.now();

    await access(outputPath);

    const uploadUrl = await uploadToMinio(outputPath, outFileName, 'video/mp4');

    return NextResponse.json({
      success: true,
      message: 'Successfully generated video from TTS audio',
      data: {
        videoId,
        audioUrl,
        videoUrl: uploadUrl,
        width: parsedDim.width,
        height: parsedDim.height,
        bgColor: parsedBg,
        framerate,
        processingTime: endTime - startTime,
      },
    });
  } catch (error) {
    console.error('[TTS->VIDEO] API error:', error);

    return NextResponse.json(
      {
        error: 'Internal server error',
        details: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 }
    );
  } finally {
    if (outputPath) {
      try {
        await unlink(outputPath);
      } catch {
        // ignore
      }
    }
  }
}
