import { NextRequest, NextResponse } from 'next/server';
import { updateOriginalVideoRow } from '@/lib/baserow-actions';
import { ensureMinioRunning } from '@/lib/minio-runtime';

// ─── POST /api/upload-video/confirm ─────────────────────────────────
// Called by the client AFTER the browser has successfully PUT the file
// directly to MinIO via the presigned URL.
//
// Body: { rowId: number, filename: string }
//
// We verify the object exists (HEAD request) and then write the final
// URL into the Baserow row.

export async function POST(request: NextRequest) {
  try {
    const { rowId, filename } = (await request.json()) as {
      rowId: number;
      filename: string;
    };

    if (!rowId || !filename) {
      return NextResponse.json(
        { error: 'rowId and filename are required' },
        { status: 400 },
      );
    }

    const { baseUrl, bucket } = await ensureMinioRunning();
    const objectUrl = `${baseUrl.replace(/\/+$/, '')}/${bucket}/${filename}`;

    // Verify the object actually landed in MinIO (lightweight HEAD)
    const headResponse = await fetch(objectUrl, { method: 'HEAD' });

    if (!headResponse.ok) {
      return NextResponse.json(
        {
          error: `Object not found in MinIO (HEAD ${headResponse.status}). The upload may still be in progress.`,
        },
        { status: 404 },
      );
    }

    // Persist the URL in Baserow
    await updateOriginalVideoRow(rowId, {
      field_6881: objectUrl,
    });

    return NextResponse.json({
      success: true,
      videoUrl: objectUrl,
      rowId,
    });
  } catch (error) {
    console.error('Error confirming upload:', error);
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : 'Failed to confirm upload',
      },
      { status: 500 },
    );
  }
}
