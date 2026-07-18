import { readFile } from 'fs/promises';
import { NextRequest, NextResponse } from 'next/server';
import {
  BRANDED_TEXT_MAX_DURATION,
  BRANDED_TEXT_MIN_DURATION,
} from '@/lib/branded-text-template';
import { renderBrandedTextOverlay } from '@/utils/hyperframes-branded-text';

export const runtime = 'nodejs';

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as {
      text?: unknown;
      duration?: unknown;
    };
    const text = typeof body.text === 'string' ? body.text.trim() : '';
    const duration = Number(body.duration);

    if (!text) {
      return NextResponse.json(
        { error: 'Enter text before adding the branded template.' },
        { status: 400 },
      );
    }
    if (
      !Number.isFinite(duration) ||
      duration < BRANDED_TEXT_MIN_DURATION ||
      duration > BRANDED_TEXT_MAX_DURATION
    ) {
      return NextResponse.json(
        {
          error: `Branded text duration must be between ${BRANDED_TEXT_MIN_DURATION} and ${BRANDED_TEXT_MAX_DURATION} seconds.`,
        },
        { status: 400 },
      );
    }

    const outputPath = await renderBrandedTextOverlay({
      text,
      duration,
      fps: 24,
      quality: 'draft',
    });
    const output = await readFile(outputPath);
    return new NextResponse(new Uint8Array(output), {
      headers: {
        'Content-Type': 'video/webm',
        'Cache-Control': 'private, max-age=31536000, immutable',
      },
    });
  } catch (error) {
    console.error('Failed to render branded text preview:', error);
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : 'Failed to render branded text preview.',
      },
      { status: 500 },
    );
  }
}
