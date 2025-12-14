import { NextResponse } from 'next/server';

const MAX_BYTES = 20 * 1024 * 1024; // 20MB

function isHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const urlParam = searchParams.get('url');

  if (!urlParam || !isHttpUrl(urlParam)) {
    return NextResponse.json(
      { success: false, error: 'Invalid or missing url parameter.' },
      { status: 400 }
    );
  }

  try {
    const upstream = await fetch(urlParam, {
      redirect: 'follow',
      headers: {
        // Some CDNs behave better with a UA
        'User-Agent': 'ultimate-video-editr/1.0',
        Accept: 'image/*,*/*;q=0.8',
      },
    });

    if (!upstream.ok) {
      return NextResponse.json(
        {
          success: false,
          error: `Upstream fetch failed (${upstream.status})`,
        },
        { status: 502 }
      );
    }

    const contentType = upstream.headers.get('content-type') ?? '';
    const contentLengthHeader = upstream.headers.get('content-length');
    const contentLength = contentLengthHeader
      ? Number(contentLengthHeader)
      : undefined;

    if (
      Number.isFinite(contentLength) &&
      (contentLength as number) > MAX_BYTES
    ) {
      return NextResponse.json(
        { success: false, error: 'Image is too large.' },
        { status: 413 }
      );
    }

    if (!contentType.toLowerCase().startsWith('image/')) {
      return NextResponse.json(
        {
          success: false,
          error: `URL did not return an image (content-type: ${
            contentType || 'unknown'
          }).`,
        },
        { status: 415 }
      );
    }

    const arrayBuffer = await upstream.arrayBuffer();
    if (arrayBuffer.byteLength > MAX_BYTES) {
      return NextResponse.json(
        { success: false, error: 'Image is too large.' },
        { status: 413 }
      );
    }

    return new Response(arrayBuffer, {
      status: 200,
      headers: {
        'content-type': contentType,
        'cache-control': 'no-store',
      },
    });
  } catch (e) {
    console.error('fetch-image error:', e);
    return NextResponse.json(
      { success: false, error: 'Failed to fetch image.' },
      { status: 500 }
    );
  }
}
