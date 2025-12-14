import { NextRequest, NextResponse } from 'next/server';
import { spawn } from 'child_process';
import os from 'os';
import path from 'path';
import fs from 'fs/promises';

const MAX_BYTES = 25 * 1024 * 1024; // 25MB

function toInt(value: FormDataEntryValue | null): number | null {
  if (value == null) return null;
  const n = typeof value === 'string' ? Number(value) : Number(value);
  if (!Number.isFinite(n)) return null;
  return Math.round(n);
}

function runFFmpeg(args: string[]): Promise<void> {
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
    const file = formData.get('image') as File | null;

    const left = toInt(formData.get('left'));
    const top = toInt(formData.get('top'));
    const width = toInt(formData.get('width'));
    const height = toInt(formData.get('height'));

    if (!file || file.type !== 'image/gif') {
      return NextResponse.json(
        { success: false, error: 'Expected a GIF file.' },
        { status: 400 }
      );
    }

    if (
      left == null ||
      top == null ||
      width == null ||
      height == null ||
      width <= 0 ||
      height <= 0 ||
      left < 0 ||
      top < 0
    ) {
      return NextResponse.json(
        { success: false, error: 'Invalid crop coordinates.' },
        { status: 400 }
      );
    }

    const inputBuffer = Buffer.from(await file.arrayBuffer());
    if (inputBuffer.byteLength > MAX_BYTES) {
      return NextResponse.json(
        { success: false, error: 'GIF is too large.' },
        { status: 413 }
      );
    }

    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'crop-gif-'));
    const inputPath = path.join(tempDir, 'input.gif');
    const outputPath = path.join(tempDir, 'output.gif');

    await fs.writeFile(inputPath, inputBuffer);

    // Crop while preserving animation.
    // Use palettegen/paletteuse to keep GIF colors stable after filtering.
    const cropExpr = `crop=${width}:${height}:${left}:${top}`;
    const filterComplex = `[0:v]${cropExpr},split[a][b];[a]palettegen=reserve_transparent=1[p];[b][p]paletteuse=alpha_threshold=128[out]`;

    await runFFmpeg([
      '-hide_banner',
      '-y',
      '-i',
      inputPath,
      '-filter_complex',
      filterComplex,
      '-map',
      '[out]',
      '-loop',
      '0',
      outputPath,
    ]);

    const out = await fs.readFile(outputPath);
    const bytes = new Uint8Array(out);

    return new Response(bytes, {
      status: 200,
      headers: {
        'content-type': 'image/gif',
        'cache-control': 'no-store',
      },
    });
  } catch (e) {
    console.error('crop-gif error:', e);
    return NextResponse.json(
      { success: false, error: 'Failed to crop GIF.' },
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
