import { NextRequest, NextResponse } from 'next/server';
import {
  createOriginalVideoRow,
  getOriginalVideosData,
  BaserowRow,
} from '@/lib/baserow-actions';

type Body = {
  title?: unknown;
  script?: unknown;
  expectedDuration?: unknown;
  ttsVoiceReference?: unknown;
};

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json().catch(() => null)) as Body | null;
    const title = typeof body?.title === 'string' ? body.title.trim() : '';
    const script = typeof body?.script === 'string' ? body.script.trim() : '';
    const expectedDurationRaw = Number(body?.expectedDuration);
    const expectedDuration = Number.isFinite(expectedDurationRaw)
      ? Math.max(1, Math.round(expectedDurationRaw))
      : 15;
    const ttsVoiceReference =
      typeof body?.ttsVoiceReference === 'string'
        ? body.ttsVoiceReference.trim()
        : '';

    // Build a unique title for the new video row.
    const existingVideos = await getOriginalVideosData();

    // Determine next order value (same behavior as upload-video route)
    const maxOrder = existingVideos.reduce((max, video) => {
      const order = Number(video.field_6902) || 0;
      return Math.max(max, order);
    }, 0);
    const nextOrder = maxOrder + 1;

    const baseName = `Script ${new Date().toISOString().slice(0, 10)}`;

    const generateUniqueTitle = (
      base: string,
      videos: BaserowRow[],
    ): string => {
      const existingTitles = videos
        .map((video) => {
          const title = (video as Record<string, unknown>).field_6852;
          return typeof title === 'string' ? title.toLowerCase() : '';
        })
        .filter((t) => t.length > 0);

      let candidate = base;
      let counter = 1;
      while (existingTitles.includes(candidate.toLowerCase())) {
        candidate = `${base} (${counter})`;
        counter++;
      }
      return candidate;
    };

    const finalTitle = title || generateUniqueTitle(baseName, existingVideos);

    const newRowData: Record<string, unknown> = {
      field_6864: 'Processing', // Status
      field_6902: nextOrder, // Order - automatically set to next number
      field_6852: finalTitle, // Title (custom or auto)
      field_7103: expectedDuration, // Expected duration
      ...(script ? { field_6854: script } : {}), // Optional Script
      ...(ttsVoiceReference ? { field_6860: ttsVoiceReference } : {}), // Optional TTS Voice override
    };

    const newRow = await createOriginalVideoRow(newRowData);

    return NextResponse.json({
      success: true,
      rowId: newRow.id,
      title: finalTitle,
    });
  } catch (error) {
    console.error('Error creating video from script:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Request failed' },
      { status: 500 },
    );
  }
}
