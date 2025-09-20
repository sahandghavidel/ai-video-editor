import { NextRequest, NextResponse } from 'next/server';
import {
  createOriginalVideoRow,
  getOriginalVideosData,
} from '@/lib/baserow-actions';

export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData();
    const file = formData.get('file') as File;

    if (!file) {
      return NextResponse.json({ error: 'No file provided' }, { status: 400 });
    }

    // Validate file type
    if (!file.type.startsWith('video/')) {
      return NextResponse.json(
        { error: 'File must be a video' },
        { status: 400 }
      );
    }

    // Validate file size (max 100MB)
    const maxSize = 100 * 1024 * 1024; // 100MB
    if (file.size > maxSize) {
      return NextResponse.json(
        { error: 'File size must be less than 100MB' },
        { status: 400 }
      );
    }

    // Convert file to buffer
    const arrayBuffer = await file.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    // Generate unique filename
    const timestamp = Date.now();
    const fileExtension = file.name.split('.').pop() || 'mp4';
    const filename = `video_${timestamp}.${fileExtension}`;
    const bucket = 'nca-toolkit';
    const uploadUrl = `http://host.docker.internal:9000/${bucket}/${filename}`;

    // Upload to MinIO
    const uploadResponse = await fetch(uploadUrl, {
      method: 'PUT',
      headers: {
        'Content-Type': file.type,
      },
      body: buffer,
    });

    if (!uploadResponse.ok) {
      const errorText = await uploadResponse.text();
      console.error('MinIO upload error:', errorText);
      throw new Error(`MinIO upload error: ${uploadResponse.status}`);
    }

    // Get existing videos to determine next order number
    const existingVideos = await getOriginalVideosData();
    const maxOrder = existingVideos.reduce((max, video) => {
      const order = Number(video.field_6902) || 0;
      return Math.max(max, order);
    }, 0);
    const nextOrder = maxOrder + 1;

    // Create new row in Baserow table 713
    const newRowData = {
      field_6881: uploadUrl, // Video Uploaded URL
      field_6864: 'Pending', // Status
      field_6902: nextOrder, // Order - automatically set to next number
      // field_6866: scenes will be empty initially
      // field_6858: final merged video will be empty initially
    };

    const newRow = await createOriginalVideoRow(newRowData);

    return NextResponse.json({
      success: true,
      videoUrl: uploadUrl,
      filename,
      bucket,
      rowId: newRow.id,
      message: 'Video uploaded successfully',
    });
  } catch (error) {
    console.error('Error uploading video:', error);
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : 'Upload failed',
      },
      { status: 500 }
    );
  }
}
