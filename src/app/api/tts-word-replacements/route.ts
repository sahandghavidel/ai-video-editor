import { NextRequest, NextResponse } from 'next/server';
import {
  loadTtsWordReplacementsStore,
  saveTtsWordReplacementsStore,
} from '@/lib/ttsWordReplacementsStore';

export const runtime = 'nodejs';

export async function GET() {
  try {
    const store = await loadTtsWordReplacementsStore();
    return NextResponse.json(store);
  } catch (error) {
    console.error('Failed to load TTS word replacements:', error);
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : 'Failed to load replacements',
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

    const store = await saveTtsWordReplacementsStore(body.entries);
    return NextResponse.json(store);
  } catch (error) {
    console.error('Failed to save TTS word replacements:', error);
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : 'Failed to save replacements',
      },
      { status: 500 },
    );
  }
}
