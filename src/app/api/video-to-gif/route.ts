import { NextRequest, NextResponse } from 'next/server';
import { spawn } from 'child_process';
import os from 'os';
import path from 'path';
import fs from 'fs/promises';

const MAX_VIDEO_SIZE = 100 * 1024 * 1024; // 100MB

function toFloat(value: FormDataEntryValue | null): number | null {
  if (value == null) return null;
  const n = typeof value === 'string' ? Number(value) : Number(value);
  if (!Number.isFinite(n)) return null;
  return n;
}

async function runFFmpeg(args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn('ffmpeg', args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let stderr = '';

    child.stderr.on('data', (d) => {
      stderr += d.toString();
    });

    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) return resolve();
      reject(new Error(`ffmpeg exited with code ${code}: ${stderr}`));
    });
  });
}

export async function POST(request: NextRequest) {
  let tempDir: string | null = null;

  try {
    const formData = await request.formData();
    const videoFile = formData.get('video') as File | null;
    const startTime = toFloat(formData.get('startTime'));
    const endTime = toFloat(formData.get('endTime'));

    if (!videoFile || !videoFile.type.startsWith('video/')) {
      return NextResponse.json(
        { success: false, error: 'Expected a video file.' },
        { status: 400 }
      );
    }

    if (videoFile.size > MAX_VIDEO_SIZE) {
      return NextResponse.json(
        { success: false, error: 'Video is too large.' },
        { status: 413 }
      );
    }

    const inputBuffer = Buffer.from(await videoFile.arrayBuffer());
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'video-to-gif-'));

    const inputPath = path.join(tempDir, 'input.mp4');
    const outputPath = path.join(tempDir, 'output.gif');

    await fs.writeFile(inputPath, inputBuffer);

    // Build FFmpeg arguments
    const args = ['-hide_banner', '-y'];

    // Add start time if specified
    if (startTime != null && startTime > 0) {
      args.push('-ss', startTime.toString());
    }

    // Add end time if specified
    if (endTime != null && endTime > 0) {
      args.push('-t', (endTime - (startTime || 0)).toString());
    }

    args.push('-i', inputPath);

    // Convert to GIF with palette generation
    const filterComplex =
      '[0:v]format=rgb24,split[a][b];[a]palettegen=reserve_transparent=1[p];[b][p]paletteuse=alpha_threshold=128[out]';

    args.push(
      '-filter_complex',
      filterComplex,
      '-map',
      '[out]',
      '-loop',
      '0',
      outputPath
    );

    await runFFmpeg(args);

    const outputBuffer = await fs.readFile(outputPath);
    const bytes = new Uint8Array(outputBuffer);

    return new Response(bytes, {
      status: 200,
      headers: {
        'content-type': 'image/gif',
        'cache-control': 'no-store',
      },
    });
  } catch (e) {
    console.error('video-to-gif error:', e);
    return NextResponse.json(
      { success: false, error: 'Failed to convert video to GIF.' },
      { status: 500 }
    );
  } finally {
    if (tempDir) {
      await fs.rm(tempDir, { recursive: true, force: true }).catch(() => {
        // ignore
      });
    }
  }
}
