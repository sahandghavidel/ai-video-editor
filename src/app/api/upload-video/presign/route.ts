import { NextRequest, NextResponse } from 'next/server';
import {
  createOriginalVideoRow,
  getOriginalVideosData,
  BaserowRow,
} from '@/lib/baserow-actions';
import { ensureMinioRunning } from '@/lib/minio-runtime';
import { generatePresignedPutUrl } from '@/lib/minio-s3';

const MAX_SIZE = 10 * 1024 * 1024 * 1024; // 10 GB
const PRESIGN_TTL = 3600; // 1 hour — generous for slow uploads

// ─── POST /api/upload-video/presign ─────────────────────────────────
// Accepts JSON { filename, contentType, fileSize }
// Returns { uploadUrl, videoId, rowId, filename, bucket }
// The client then PUTs the file directly to MinIO using uploadUrl,
// completely bypassing the Next.js body parser.

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const {
      filename: rawFilename,
      contentType,
      fileSize,
    } = body as {
      filename: string;
      contentType: string;
      fileSize: number;
    };

    if (!rawFilename || !contentType || !fileSize) {
      return NextResponse.json(
        { error: 'filename, contentType, and fileSize are required' },
        { status: 400 },
      );
    }

    if (!contentType.startsWith('video/')) {
      return NextResponse.json(
        { error: 'File must be a video' },
        { status: 400 },
      );
    }

    if (fileSize > MAX_SIZE) {
      return NextResponse.json(
        { error: 'File size must be less than 10 GB' },
        { status: 400 },
      );
    }

    // Ensure MinIO is reachable
    const { baseUrl, bucket } = await ensureMinioRunning();

    // ── Create Baserow row ───────────────────────────────────────
    const originalName = rawFilename.replace(/\.[^/.]+$/, '');

    const existingVideos = await getOriginalVideosData();
    const maxOrder = existingVideos.reduce((max, video) => {
      const order = Number(video.field_6902) || 0;
      return Math.max(max, order);
    }, 0);
    const nextOrder = maxOrder + 1;

    const generateUniqueTitle = (
      baseName: string,
      vids: BaserowRow[],
    ): string => {
      const existingTitles = vids
        .map((v) => {
          const t = v.field_6852;
          return typeof t === 'string' ? t.toLowerCase() : '';
        })
        .filter((t) => t.length > 0);

      let candidate = baseName;
      let counter = 1;
      while (existingTitles.includes(candidate.toLowerCase())) {
        candidate = `${baseName} (${counter})`;
        counter++;
      }
      return candidate;
    };

    const uniqueTitle = generateUniqueTitle(originalName, existingVideos);

    const newRow = await createOriginalVideoRow({
      field_6864: 'Processing',
      field_6902: nextOrder,
      field_6852: uniqueTitle,
    });

    const videoId = newRow.id;

    // ── Build object key ─────────────────────────────────────────
    const timestamp = Date.now();
    const fileExtension = rawFilename.split('.').pop() || 'mp4';
    const objectKey = `video_${videoId}_raw_${timestamp}.${fileExtension}`;

    // ── Generate presigned PUT URL ───────────────────────────────
    const uploadUrl = generatePresignedPutUrl({
      baseUrl,
      bucket,
      key: objectKey,
      contentType,
      expires: PRESIGN_TTL,
    });

    return NextResponse.json({
      uploadUrl,
      videoId,
      rowId: videoId,
      objectKey,
      filename: objectKey,
      bucket,
      expiresIn: PRESIGN_TTL,
    });
  } catch (error) {
    console.error('Error generating presigned URL:', error);
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : 'Failed to prepare upload',
      },
      { status: 500 },
    );
  }
}
