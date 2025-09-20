import { NextRequest, NextResponse } from 'next/server';

export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData();
    const file = formData.get('file') as File;

    if (!file) {
      return NextResponse.json({ error: 'No file provided' }, { status: 400 });
    }

    // Convert file to buffer
    const arrayBuffer = await file.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    // Use the provided filename or generate one
    const filename = file.name || `captions_${Date.now()}.json`;
    const bucket = 'nca-toolkit';
    const uploadUrl = `http://host.docker.internal:9000/${bucket}/${filename}`;

    // Upload to MinIO (same as video uploads)
    const uploadResponse = await fetch(uploadUrl, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
      },
      body: buffer,
    });

    if (!uploadResponse.ok) {
      const errorText = await uploadResponse.text();
      console.error('MinIO upload error:', errorText);
      throw new Error(`MinIO upload error: ${uploadResponse.status}`);
    }

    // Return the file URL
    const fileUrl = uploadUrl;

    return NextResponse.json({
      url: fileUrl,
      file_url: fileUrl,
      filename: filename,
    });
  } catch (error) {
    console.error('Error in upload captions API:', error);
    return NextResponse.json(
      {
        error: 'Failed to upload captions',
        details: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 }
    );
  }
}
