import { NextRequest, NextResponse } from 'next/server';
import { execFile } from 'child_process';
import { promisify } from 'util';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { Readable } from 'stream';
import { pipeline } from 'stream/promises';
import type { ReadableStream as NodeReadableStream } from 'stream/web';

export const runtime = 'nodejs';

const execFileAsync = promisify(execFile);

type VideoSourceSegment = {
  startTime: number;
  endTime: number;
};

type ProbeOutput = {
  streams?: { codec_type?: string; duration?: string | number }[];
  format?: { duration?: string | number };
};

export async function POST(request: NextRequest) {
  let tempDir: string | null = null;
  try {
    const formData = await request.formData();
    const video = formData.get('video') as File | null;
    const segmentsRaw = formData.get('segments');
    if (!video || !video.type.startsWith('video/')) {
      return NextResponse.json(
        { error: 'Expected a video file.' },
        { status: 400 },
      );
    }
    if (typeof segmentsRaw !== 'string') {
      return NextResponse.json(
        { error: 'Missing selected video sections.' },
        { status: 400 },
      );
    }

    let requestedSegments: VideoSourceSegment[];
    try {
      const parsed = JSON.parse(segmentsRaw) as unknown;
      if (!Array.isArray(parsed)) throw new Error('Expected an array');
      requestedSegments = parsed.map((item) => {
        const value = item as Partial<VideoSourceSegment>;
        return {
          startTime: Number(value.startTime),
          endTime: Number(value.endTime),
        };
      });
    } catch {
      return NextResponse.json(
        { error: 'Selected video sections are invalid.' },
        { status: 400 },
      );
    }

    tempDir = await fs.promises.mkdtemp(
      path.join(os.tmpdir(), 'prepare-video-overlay-'),
    );
    const inputPath = path.join(tempDir, 'input-video');
    const outputPath = path.join(tempDir, 'preview.mp4');
    await pipeline(
      Readable.fromWeb(
        video.stream() as unknown as NodeReadableStream<Uint8Array>,
      ),
      fs.createWriteStream(inputPath),
    );

    const { stdout } = await execFileAsync('ffprobe', [
      '-v',
      'quiet',
      '-print_format',
      'json',
      '-show_format',
      '-show_streams',
      inputPath,
    ]);
    const probe = JSON.parse(stdout) as ProbeOutput;
    const videoStream = probe.streams?.find(
      (stream) => stream.codec_type === 'video',
    );
    if (!videoStream) throw new Error('No video stream found');
    const duration = Number(probe.format?.duration ?? videoStream.duration);
    if (!Number.isFinite(duration) || duration <= 0) {
      throw new Error('Video duration could not be determined');
    }

    const segments = requestedSegments
      .map((segment) => ({
        startTime: Math.max(0, Math.min(duration, segment.startTime)),
        endTime: Math.max(0, Math.min(duration, segment.endTime)),
      }));
    if (segments.length === 0) throw new Error('Add at least one section');
    for (let index = 0; index < segments.length; index += 1) {
      const segment = segments[index];
      if (!(segment.endTime > segment.startTime)) {
        throw new Error(`Section ${index + 1} has invalid timing`);
      }
    }

    const filters = segments.map(
      (segment, index) =>
        `[0:v]trim=start=${segment.startTime}:end=${segment.endTime},setpts=PTS-STARTPTS[segment${index}]`,
    );
    filters.push(
      `${segments.map((_, index) => `[segment${index}]`).join('')}concat=n=${segments.length}:v=1:a=0[stitched]`,
    );
    filters.push(
      "[stitched]scale=w='if(gt(ih,720),-2,iw)':h='if(gt(ih,720),720,ih)',format=yuv420p[out]",
    );

    await execFileAsync(
      'ffmpeg',
      [
        '-hide_banner',
        '-loglevel',
        'error',
        '-i',
        inputPath,
        '-filter_complex',
        filters.join(';'),
        '-map',
        '[out]',
        '-an',
        '-c:v',
        'libx264',
        '-preset',
        'ultrafast',
        '-crf',
        '28',
        '-pix_fmt',
        'yuv420p',
        '-movflags',
        '+faststart',
        outputPath,
      ],
      { maxBuffer: 16 * 1024 * 1024 },
    );

    const output = await fs.promises.readFile(outputPath);
    return new NextResponse(new Uint8Array(output), {
      status: 200,
      headers: {
        'Content-Type': 'video/mp4',
        'Cache-Control': 'no-store',
      },
    });
  } catch (error) {
    console.error('prepare-video-overlay error:', error);
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : 'Failed to build overlay clip.',
      },
      { status: 500 },
    );
  } finally {
    if (tempDir) {
      await fs.promises.rm(tempDir, { recursive: true, force: true }).catch(() => {
        // ignore cleanup failures
      });
    }
  }
}
