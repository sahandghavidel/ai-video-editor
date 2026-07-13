import { NextRequest, NextResponse } from 'next/server';
import { createWriteStream } from 'fs';
import { mkdtemp, rm, unlink } from 'fs/promises';
import Busboy from 'busboy';
import os from 'os';
import path from 'path';
import { Readable } from 'stream';
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

type ParsedUpload = {
  tempPaths: string[];
  files: Array<{ name: string; contentType: string; size: number }>;
  titleBase: string | null;
  renderNormally: boolean;
};

function jsonFailure(error: string) {
  return NextResponse.json({
    success: false,
    error,
  });
}

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

export async function POST(request: NextRequest) {
  let tempDir: string | null = null;
  let mergedLocalPath: string | null = null;

  try {
    const contentType = request.headers.get('content-type') || '';
    if (!contentType.toLowerCase().includes('multipart/form-data')) {
      return jsonFailure('Expected multipart/form-data request body');
    }

    const contentLength = Number(request.headers.get('content-length') || 0);
    if (Number.isFinite(contentLength) && contentLength > MAX_TOTAL_SIZE) {
      return jsonFailure('Total selected video size must be less than 50 GB');
    }

    if (!request.body) {
      return jsonFailure('Request body is required');
    }

    tempDir = await mkdtemp(path.join(os.tmpdir(), 'merged-upload-'));
    const parsedUpload = await parseMultipartUpload(
      request,
      tempDir,
      contentType,
    );
    const { files, tempPaths, titleBase: parsedTitleBase } = parsedUpload;
    const { renderNormally } = parsedUpload;

    if (files.length < 2) {
      return jsonFailure('Select at least two video files to merge');
    }

    const invalidFile = files.find((file) => !file.contentType.startsWith('video/'));
    if (invalidFile) {
      return jsonFailure(`${invalidFile.name} is not a video file`);
    }

    const totalSize = files.reduce((sum, file) => sum + file.size, 0);
    if (totalSize > MAX_TOTAL_SIZE) {
      return jsonFailure('Total selected video size must be less than 50 GB');
    }

    if (renderNormally) {
      mergedLocalPath = await concatenateVideosWithFFmpeg({
        videoUrls: tempPaths,
        useHardwareAcceleration: false,
        videoBitrate: '6000k',
      });
    } else {
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
    }

    const existingVideos = await getOriginalVideosData();
    const maxOrder = existingVideos.reduce((max, video) => {
      const order = Number(video.field_6902) || 0;
      return Math.max(max, order);
    }, 0);
    const nextOrder = maxOrder + 1;
    const titleBase = sanitizeName(parsedTitleBase || files[0].name);
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
    const message =
      error instanceof Error ? error.message : 'Failed to merge and upload files';
    console.warn('[MERGED_UPLOAD] Merge upload failed gracefully:', message);
    return jsonFailure(message);
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

function parseMultipartUpload(
  request: NextRequest,
  tempDir: string,
  contentType: string,
): Promise<ParsedUpload> {
  return new Promise((resolve, reject) => {
    const tempPaths: string[] = [];
    const files: ParsedUpload['files'] = [];
    let titleBase: string | null = null;
    let renderNormally = false;
    let fileIndex = 0;
    let settled = false;
    let totalSize = 0;
    const pendingWrites: Promise<void>[] = [];

    const fail = (error: Error) => {
      if (settled) return;
      settled = true;
      reject(error);
    };

    const busboy = Busboy({
      headers: {
        'content-type': contentType,
      },
      limits: {
        fileSize: MAX_FILE_SIZE,
        files: 100,
        fields: 20,
      },
    });

    busboy.on('field', (name, value) => {
      if (name === 'titleBase') {
        titleBase = value;
      } else if (name === 'renderNormally') {
        renderNormally = value === 'true';
      }
    });

    busboy.on('file', (name, fileStream, info) => {
      if (name !== 'files') {
        fileStream.resume();
        return;
      }

      const filename = info.filename || `video-${fileIndex + 1}.mp4`;
      const contentTypeForFile = info.mimeType || 'application/octet-stream';
      const extension = getExtension(filename);
      const safeName = sanitizePathSegment(filename);
      const currentIndex = fileIndex++;
      const filePath = path.join(
        tempDir,
        `${String(currentIndex + 1).padStart(3, '0')}_${safeName}.${extension}`,
      );
      let fileSize = 0;
      let hitFileSizeLimit = false;

      const writeStream = createWriteStream(filePath);
      tempPaths.push(filePath);

      fileStream.on('data', (chunk: Buffer) => {
        fileSize += chunk.length;
        totalSize += chunk.length;
        if (totalSize > MAX_TOTAL_SIZE) {
          fileStream.unpipe(writeStream);
          writeStream.destroy();
          fail(new Error('Total selected video size must be less than 50 GB'));
        }
      });

      fileStream.on('limit', () => {
        hitFileSizeLimit = true;
        fileStream.unpipe(writeStream);
        writeStream.destroy();
        fail(new Error(`${filename} must be less than 10 GB`));
      });

      fileStream.on('error', (error) => {
        writeStream.destroy();
        fail(error instanceof Error ? error : new Error('File stream failed'));
      });

      writeStream.on('error', (error) => {
        fileStream.resume();
        fail(error instanceof Error ? error : new Error('File write failed'));
      });

      const writeDone = new Promise<void>((writeResolve, writeReject) => {
        writeStream.on('finish', () => {
          if (hitFileSizeLimit) {
            writeReject(new Error(`${filename} must be less than 10 GB`));
            return;
          }

          files[currentIndex] = {
            name: filename,
            contentType: contentTypeForFile,
            size: fileSize,
          };
          writeResolve();
        });
        writeStream.on('error', writeReject);
      });

      pendingWrites.push(writeDone);
      fileStream.pipe(writeStream);
    });

    busboy.on('error', (error) => {
      fail(error instanceof Error ? error : new Error('Failed to parse body'));
    });

    busboy.on('finish', async () => {
      if (settled) return;

      try {
        await Promise.all(pendingWrites);
        if (settled) return;
        settled = true;
        resolve({
          tempPaths,
          files: files.filter(Boolean),
          titleBase,
          renderNormally,
        });
      } catch (error) {
        fail(error instanceof Error ? error : new Error('Failed to save files'));
      }
    });

    Readable.fromWeb(
      request.body as unknown as Parameters<typeof Readable.fromWeb>[0],
    ).pipe(busboy);
  });
}
