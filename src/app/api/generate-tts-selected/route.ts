import { NextRequest, NextResponse } from 'next/server';

export const runtime = 'nodejs';
export const maxDuration = 900;

type Provider = 'chatterbox' | 'fish-s2-pro';

interface BodyWithProvider {
  ttsSettings?: {
    provider?: Provider;
  };
}

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as BodyWithProvider &
      Record<string, unknown>;

    const provider = body?.ttsSettings?.provider || 'chatterbox';
    const targetPath =
      provider === 'fish-s2-pro'
        ? '/api/generate-tts-fish'
        : '/api/generate-tts';

    const targetUrl = `${request.nextUrl.origin}${targetPath}`;
    const forwardResponse = await fetch(targetUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });

    const contentType = forwardResponse.headers.get('content-type') || '';

    if (contentType.includes('application/json')) {
      const json = await forwardResponse.json().catch(() => ({}));
      return NextResponse.json(json, { status: forwardResponse.status });
    }

    const text = await forwardResponse.text().catch(() => '');
    return new NextResponse(text, {
      status: forwardResponse.status,
      headers: {
        'Content-Type': contentType || 'text/plain; charset=utf-8',
      },
    });
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : 'Failed to dispatch TTS provider';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
