import { NextRequest, NextResponse } from 'next/server';
import { createWriteStream } from 'fs';
import { mkdtemp, rm, unlink } from 'fs/promises';
import os from 'os';
import path from 'path';
import { Readable } from 'stream';
import { pipeline } from 'stream/promises';
import {
  createOriginalVideoRow,
  getOriginalVideosData,
  updateOriginalVideoRow,
  BaserowRow,
} from '@/lib/baserow-actions';
import {
  concatenateVideosFast,
  concatenateVideosWithFFmpeg,
} from '@/utils/ffmpeg-merge';
import { uploadToMinio } from '@/utils/ffmpeg-direct';

export const runtime = 'nodejs';
export const maxDuration = 3600;

const MAX_FILE_SIZE = 10 * 1024 * 1024 * 1024; // 10 GB per source video
const MAX_TOTAL_SIZE = 50 * 1024 * 1024 * 1024; // 50 GB per merge request

function sanitizeName(value: string): string {
  return value
    .trim()
    .replace(/\.[^/.]+$/, '')
    .replace(/[^a-zA-Z0-9._ -]/g, '')
    .replace(/\s+/g, ' ')
    .slice(0, 120);
}

function sanitizePathSegment(value: string): string {
  return (
    value
      .trim()
      .replace(/\.[^/.]+$/, '')
      .replace(/[^a-zA-Z0-9._-]/g, '_')
      .replace(/_+/g, '_')
      .slice(0, 120) || 'video'
  );
}

function getExtension(filename: string): string {
  const extension = path.extname(filename).replace(/^\./, '').toLowerCase();
  return extension || 'mp4';
}

function generateUniqueTitle(baseName: string, videos: BaserowRow[]): string {
  const fallbackBaseName = baseName.trim() || 'Merged Video';
  const existingTitles = videos
    .map((video) => {
      const title = video.field_6852;
      return typeof title === 'string' ? title.toLowerCase() : '';
    })
    .filter((title) => title.length > 0);

  let candidate = fallbackBaseName;
  let counter = 1;
  while (existingTitles.includes(candidate.toLowerCase())) {
    candidate = `${fallbackBaseName} (${counter})`;
    counter++;
  }

  return candidate;
}

async function writeUploadedFileToTemp(file: File, filePath: string) {
  const readable = Readable.fromWeb(
    file.stream() as unknown as Parameters<typeof Readable.fromWeb>[0],
  );
  await pipeline(readable, createWriteStream(filePath));
}

export async function POST(request: NextRequest) {
  let tempDir: string | null = null;
  let mergedLocalPath: string | null = null;

  try {
    const formData = await request.formData();
    const files = formData
      .getAll('files')
      .filter((value): value is File => value instanceof File);

    if (files.length < 2) {
      return NextResponse.json(
        { error: 'Select at least two video files to merge' },
        { status: 400 },
      );
    }

    const invalidFile = files.find((file) => !file.type.startsWith('video/'));
    if (invalidFile) {
      return NextResponse.json(
        { error: `${invalidFile.name} is not a video file` },
        { status: 400 },
      );
    }

    const oversizedFile = files.find((file) => file.size > MAX_FILE_SIZE);
    if (oversizedFile) {
      return NextResponse.json(
        { error: `${oversizedFile.name} must be less than 10 GB` },
        { status: 400 },
      );
    }

    const totalSize = files.reduce((sum, file) => sum + file.size, 0);
    if (totalSize > MAX_TOTAL_SIZE) {
      return NextResponse.json(
        { error: 'Total selected video size must be less than 50 GB' },
        { status: 400 },
      );
    }

    tempDir = await mkdtemp(path.join(os.tmpdir(), 'merged-upload-'));
    const tempPaths: string[] = [];

    for (const [index, file] of files.entries()) {
      const extension = getExtension(file.name);
      const safeName = sanitizePathSegment(file.name);
      const filePath = path.join(
        tempDir,
        `${String(index + 1).padStart(3, '0')}_${safeName}.${extension}`,
      );
      await writeUploadedFileToTemp(file, filePath);
      tempPaths.push(filePath);
    }

    try {
      mergedLocalPath = await concatenateVideosFast(tempPaths);
    } catch (fastError) {
      console.log(
        '[MERGED_UPLOAD] Fast local merge failed, falling back to re-encode:',
        fastError,
      );
      mergedLocalPath = await concatenateVideosWithFFmpeg({
        videoUrls: tempPaths,
        useHardwareAcceleration: true,
        videoBitrate: '6000k',
      });
    }

    const existingVideos = await getOriginalVideosData();
    const maxOrder = existingVideos.reduce((max, video) => {
      const order = Number(video.field_6902) || 0;
      return Math.max(max, order);
    }, 0);
    const nextOrder = maxOrder + 1;
    const rawTitleBase = formData.get('titleBase');
    const titleBase =
      typeof rawTitleBase === 'string'
        ? sanitizeName(rawTitleBase)
        : sanitizeName(files[0].name);
    const uniqueTitle = generateUniqueTitle(titleBase, existingVideos);

    const newRow = await createOriginalVideoRow({
      field_6864: 'Processing',
      field_6902: nextOrder,
      field_6852: uniqueTitle,
    });

    const timestamp = Date.now();
    const finalFilename = `video_${newRow.id}_raw_merged_${timestamp}.mp4`;
    const videoUrl = await uploadToMinio(
      mergedLocalPath,
      finalFilename,
      'video/mp4',
    );

    await updateOriginalVideoRow(newRow.id, {
      field_6881: videoUrl,
    });

    return NextResponse.json({
      success: true,
      rowId: newRow.id,
      videoUrl,
      title: uniqueTitle,
      mergedFiles: files.length,
    });
  } catch (error) {
    console.error('[MERGED_UPLOAD] Error merging uploaded files:', error);
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : 'Failed to merge and upload files',
      },
      { status: 500 },
    );
  } finally {
    if (mergedLocalPath) {
      try {
        await unlink(mergedLocalPath);
      } catch {
        // Ignore cleanup errors.
      }
    }

    if (tempDir) {
      try {
        await rm(tempDir, { recursive: true, force: true });
      } catch {
        // Ignore cleanup errors.
      }
    }
  }
}
