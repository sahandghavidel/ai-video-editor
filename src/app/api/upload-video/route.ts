/**
 * DEPRECATED — This route previously accepted multipart/form-data uploads
 * but Next.js App Router body-parser silently drops payloads > ~4 MB,
 * making it impossible to upload large video files this way.
 *
 * Uploads now use the presigned-URL flow:
 *   POST /api/upload-video/presign   → get a presigned MinIO PUT URL
 *   PUT  <presignedUrl>             → browser uploads directly to MinIO
 *   POST /api/upload-video/confirm   → persist the URL in Baserow
 *
 * See src/components/OriginalVideosList.tsx handleFileUpload().
 */

import { NextResponse } from 'next/server';

export async function POST() {
  return NextResponse.json(
    {
      error:
        'This upload path is deprecated. Use /api/upload-video/presign instead.',
    },
    { status: 410 },
  );
}
