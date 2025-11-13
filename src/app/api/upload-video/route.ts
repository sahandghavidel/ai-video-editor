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

    // Validate file size (max 10GB)
    const maxSize = 10 * 1024 * 1024 * 1024; // 10GB
    if (file.size > maxSize) {
      return NextResponse.json(
        { error: 'File size must be less than 10GB' },
        { status: 400 }
      );
    }

    // Extract original filename for title (without extension)
    const originalName = file.name.replace(/\.[^/.]+$/, ''); // Remove file extension

    // Get existing videos to determine next order number and check for duplicate titles
    const existingVideos = await getOriginalVideosData();
    const maxOrder = existingVideos.reduce((max, video) => {
      const order = Number(video.field_6902) || 0;
      return Math.max(max, order);
    }, 0);
    const nextOrder = maxOrder + 1;

    // Generate unique title based on filename
    const generateUniqueTitle = (
      baseName: string,
      existingVideos: any[]
    ): string => {
      // Get all existing titles (field_6852)
      const existingTitles = existingVideos
        .map((video) => {
          const title = video.field_6852;
          if (typeof title === 'string') return title.toLowerCase();
          return '';
        })
        .filter((title) => title.length > 0);

      // Check if base name exists
      let candidateTitle = baseName;
      let counter = 1;

      while (existingTitles.includes(candidateTitle.toLowerCase())) {
        candidateTitle = `${baseName} (${counter})`;
        counter++;
      }

      return candidateTitle;
    };

    const uniqueTitle = generateUniqueTitle(originalName, existingVideos);

    // Create Baserow row first to get the video ID
    const newRowData = {
      field_6864: 'Processing', // Status - default to Processing on upload
      field_6902: nextOrder, // Order - automatically set to next number
      field_6852: uniqueTitle, // Title - auto-generated from filename
      // field_6881 will be set after upload
      // field_6866: scenes will be empty initially
      // field_6858: final merged video will be empty initially
    };

    const newRow = await createOriginalVideoRow(newRowData);
    const videoId = newRow.id;

    // Convert file to buffer
    const arrayBuffer = await file.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    // Generate filename with video ID and "raw" indicator
    const timestamp = Date.now();
    const fileExtension = file.name.split('.').pop() || 'mp4';
    const filename = `video_${videoId}_raw_${timestamp}.${fileExtension}`;

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

    // Update the row with the video URL
    const { updateOriginalVideoRow } = await import('@/lib/baserow-actions');
    await updateOriginalVideoRow(videoId, {
      field_6881: uploadUrl, // Video Uploaded URL
    });

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
