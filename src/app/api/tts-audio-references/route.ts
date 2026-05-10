import { NextRequest, NextResponse } from 'next/server';
import {
  loadTtsAudioReferencesStore,
  saveTtsAudioReferencesStore,
} from '@/lib/ttsAudioReferencesStore';

export const runtime = 'nodejs';

export async function GET() {
  try {
    const store = await loadTtsAudioReferencesStore();
    return NextResponse.json(store);
  } catch (error) {
    console.error('Failed to load TTS audio references:', error);
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : 'Failed to load audio references',
      },
      { status: 500 },
    );
  }
}

export async function PUT(request: NextRequest) {
  try {
    const body = (await request.json().catch(() => null)) as {
      entries?: unknown;
    } | null;

    if (!body || !Array.isArray(body.entries)) {
      return NextResponse.json(
        { error: 'Invalid request body. Expected { entries: [] }' },
        { status: 400 },
      );
    }

    const store = await saveTtsAudioReferencesStore(body.entries);
    return NextResponse.json(store);
  } catch (error) {
    console.error('Failed to save TTS audio references:', error);
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : 'Failed to save audio references',
      },
      { status: 500 },
    );
  }
}
