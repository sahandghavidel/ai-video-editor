import { NextRequest, NextResponse } from 'next/server';
import {
  loadTtsAudioReferencesStore,
  saveTtsAudioReferencesStore,
} from '@/lib/ttsAudioReferencesStore';

import { normalizeGeminiTtsSettings } from '@/utils/geminiTtsSettings';
import { validateGeminiTtsSettings } from '@/lib/geminiTts';

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

    for (const value of body.entries) {
      if (!value || typeof value !== 'object') {
        return NextResponse.json({ error: 'Each language preset must be an object' }, { status: 400 });
      }
      const entry = value as Record<string, unknown>;
      if (entry.provider !== undefined && entry.provider !== 'omnivoice' && entry.provider !== 'gemini') {
        return NextResponse.json({ error: 'Unsupported language TTS provider' }, { status: 400 });
      }
      if (entry.provider === 'gemini') {
        const error = validateGeminiTtsSettings(normalizeGeminiTtsSettings(entry.gemini));
        if (error) return NextResponse.json({ error }, { status: 400 });
      } else if (typeof entry.filename !== 'string' || !entry.filename.trim()) {
        return NextResponse.json({ error: 'Local presets require a reference filename' }, { status: 400 });
      }
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
