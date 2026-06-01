import { NextRequest, NextResponse } from 'next/server';
import {
  baserowGetJson,
  baserowPatchJson,
  extractFirstUrl,
  getOriginalVideoFields,
  ORIGINAL_VIDEOS_TABLE_ID,
} from '../_shared';
import { ensureMinioRunning } from '@/lib/minio-runtime';

export const runtime = 'nodejs';

const MAX_UPLOAD_BYTES = 10 * 1024 * 1024 * 1024; // 10 GB

type BaserowRow = {
  id: number;
  [key: string]: unknown;
};

function safeFileSegment(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 80);
}

function inferExtension(file: File): string {
  const fromName = file.name.split('.').pop();
  if (fromName && fromName.trim()) {
    return fromName.toLowerCase().replace(/[^a-z0-9]+/g, '') || 'bin';
  }

  if (file.type.includes('/')) {
    const subtype = file.type.split('/')[1]?.toLowerCase();
    if (subtype) {
      return subtype.replace(/[^a-z0-9]+/g, '') || 'bin';
    }
  }

  return 'bin';
}

function parseVideoId(value: FormDataEntryValue | null): number | null {
  if (typeof value !== 'string') return null;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) return null;
  return parsed;
}

export async function POST(request: NextRequest) {
  try {
    const { baseUrl: minioBaseUrl, bucket: minioBucket } =
      await ensureMinioRunning();

    const formData = await request.formData();

    const rawFile = formData.get('file');
    const rawFieldKey = formData.get('fieldKey');
    const videoId = parseVideoId(formData.get('videoId'));

    if (!(rawFile instanceof File)) {
      return NextResponse.json({ error: 'No file provided' }, { status: 400 });
    }

    if (!videoId) {
      return NextResponse.json({ error: 'Invalid video ID' }, { status: 400 });
    }

    if (typeof rawFieldKey !== 'string' || !/^field_\d+$/.test(rawFieldKey)) {
      return NextResponse.json({ error: 'Invalid field key' }, { status: 400 });
    }

    if (rawFile.size <= 0) {
      return NextResponse.json({ error: 'File is empty' }, { status: 400 });
    }

    if (rawFile.size > MAX_UPLOAD_BYTES) {
      return NextResponse.json(
        { error: 'File size must be less than 10GB' },
        { status: 400 },
      );
    }

    const fields = await getOriginalVideoFields();
    const field = fields.find(
      (candidate) => `field_${candidate.id}` === rawFieldKey,
    );

    if (!field) {
      return NextResponse.json({ error: 'Field not found' }, { status: 404 });
    }

    const currentRow = await baserowGetJson<BaserowRow>(
      `/database/rows/table/${ORIGINAL_VIDEOS_TABLE_ID}/${videoId}/`,
    );

    const previousUrl = extractFirstUrl(currentRow[rawFieldKey]);

    const extension = inferExtension(rawFile);
    const fieldSegment = safeFileSegment(rawFieldKey);
    const filename = `video_${videoId}_${fieldSegment}_${Date.now()}.${extension}`;

    const arrayBuffer = await rawFile.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    const uploadUrl = `${minioBaseUrl.replace(/\/+$/, '')}/${minioBucket}/${filename}`;
    const uploadResponse = await fetch(uploadUrl, {
      method: 'PUT',
      headers: {
        'Content-Type': rawFile.type || 'application/octet-stream',
      },
      body: buffer,
    });

    if (!uploadResponse.ok) {
      const errorText = await uploadResponse.text().catch(() => '');
      return NextResponse.json(
        {
          error: `Failed to upload file: ${uploadResponse.status} ${errorText}`,
        },
        { status: 502 },
      );
    }

    const updatedRow = await baserowPatchJson<BaserowRow>(
      `/database/rows/table/${ORIGINAL_VIDEOS_TABLE_ID}/${videoId}/`,
      {
        [rawFieldKey]: uploadUrl,
      },
    );

    if (previousUrl && previousUrl !== uploadUrl) {
      fetch(previousUrl, { method: 'DELETE' }).catch((error) => {
        console.warn('Failed to delete previous file from MinIO:', error);
      });
    }

    return NextResponse.json({
      success: true,
      fieldKey: rawFieldKey,
      url: uploadUrl,
      row: updatedRow,
      fieldType: field.type,
    });
  } catch (error) {
    console.error('Failed to upload and patch field URL:', error);
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 },
    );
  }
}
