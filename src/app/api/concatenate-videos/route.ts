import { NextRequest, NextResponse } from 'next/server';

export async function POST(request: NextRequest) {
  try {
    const { video_urls, id } = await request.json();

    if (!video_urls || !Array.isArray(video_urls) || video_urls.length === 0) {
      return NextResponse.json(
        { error: 'video_urls array is required and must not be empty' },
        { status: 400 }
      );
    }

    // Validate video URLs format
    for (const videoObj of video_urls) {
      if (!videoObj.video_url || typeof videoObj.video_url !== 'string') {
        return NextResponse.json(
          { error: 'Each video_urls item must have a valid video_url string' },
          { status: 400 }
        );
      }
    }

    console.log('Concatenating videos:', video_urls);

    // Call NCA toolkit video concatenation endpoint
    const response = await fetch(
      'http://host.docker.internal:8080/v1/video/concatenate',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': 'test-key-123', // Using the same API key as other endpoints
        },
        body: JSON.stringify({
          video_urls,
          id: id || `concatenate_${Date.now()}`,
        }),
      }
    );

    if (!response.ok) {
      const errorText = await response.text();
      console.error('NCA toolkit error:', errorText);
      throw new Error(`NCA toolkit error: ${response.status} - ${errorText}`);
    }

    const result = await response.json();

    // The response field contains the concatenated video URL
    const videoUrl = result.response;

    if (!videoUrl) {
      throw new Error('No video URL returned from concatenation service');
    }

    return NextResponse.json({
      videoUrl,
      jobId: result.job_id,
      id: result.id,
      message: result.message,
      runTime: result.run_time,
    });
  } catch (error) {
    console.error('Error concatenating videos:', error);
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : 'Unknown error occurred',
      },
      { status: 500 }
    );
  }
}
