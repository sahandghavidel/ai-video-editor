import { NextRequest, NextResponse } from 'next/server';

export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData();
    const file = formData.get('file') as File;
    const sceneId = formData.get('sceneId') as string;
    const videoId = formData.get('videoId') as string;

    if (!file) {
      return NextResponse.json({ error: 'No file provided' }, { status: 400 });
    }

    if (!sceneId || !videoId) {
      return NextResponse.json(
        { error: 'Scene ID and Video ID are required' },
        { status: 400 }
      );
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

    // Generate filename with video_id_scene_id_raw_timestamp format
    const timestamp = Date.now();
    const fileExtension = file.name.split('.').pop() || 'mp4';
    const filename = `video_${videoId}_scene_${sceneId}_raw_${timestamp}.${fileExtension}`;

    console.log('Generated filename:', filename);

    // Convert file to buffer
    const arrayBuffer = await file.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

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

    console.log('Scene video uploaded successfully:', filename);

    return NextResponse.json({
      success: true,
      videoUrl: uploadUrl,
      filename,
      bucket,
      message: 'Scene video uploaded successfully',
    });
  } catch (error) {
    console.error('Error uploading scene video:', error);
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : 'Upload failed',
      },
      { status: 500 }
    );
  }
}
