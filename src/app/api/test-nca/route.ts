import { NextRequest, NextResponse } from 'next/server';

export async function POST(request: NextRequest) {
  try {
    const { testType } = await request.json();

    // NCA Toolkit credentials from your Docker setup
    const NCA_API_KEY = 'test-key-123';
    const NCA_BASE_URL = 'http://host.docker.internal:8080';

    if (testType === 'health') {
      // Test if NCA service is running
      const healthResponse = await fetch(`${NCA_BASE_URL}/health`, {
        method: 'GET',
        headers: {
          'x-api-key': NCA_API_KEY,
        },
      });

      return NextResponse.json({
        status: healthResponse.status,
        statusText: healthResponse.statusText,
        ok: healthResponse.ok,
        url: NCA_BASE_URL,
      });
    }

    if (testType === 'metadata') {
      // Test metadata endpoint with a sample video URL
      const testVideoUrl =
        'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/BigBuckBunny.mp4';

      const metadataResponse = await fetch(
        `${NCA_BASE_URL}/v1/media/metadata`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-api-key': NCA_API_KEY,
          },
          body: JSON.stringify({
            media_url: testVideoUrl,
          }),
        }
      );

      const responseText = await metadataResponse.text();

      return NextResponse.json({
        status: metadataResponse.status,
        statusText: metadataResponse.statusText,
        ok: metadataResponse.ok,
        response: responseText,
        url: `${NCA_BASE_URL}/v1/media/metadata`,
      });
    }

    return NextResponse.json({ error: 'Invalid test type' }, { status: 400 });
  } catch (error) {
    console.error('Test API error:', error);
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : 'Unknown error occurred',
        stack: error instanceof Error ? error.stack : undefined,
      },
      { status: 500 }
    );
  }
}
