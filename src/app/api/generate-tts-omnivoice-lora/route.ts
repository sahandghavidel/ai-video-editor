import { NextRequest, NextResponse } from 'next/server';
import { POST as generateOmniVoice } from '../generate-tts-omnivoice/route';

export const runtime = 'nodejs';
export const maxDuration = 900;

// Share ordinary OmniVoice text preparation; the provider branch runs before its worker is touched.
export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => null);
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return NextResponse.json({ error: 'Expected a TTS request object' }, { status: 400 });
  }
  return generateOmniVoice(new NextRequest(request.url, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...body, ttsSettings: { ...body.ttsSettings, provider: 'omnivoice-lora' } }),
  }));
}
