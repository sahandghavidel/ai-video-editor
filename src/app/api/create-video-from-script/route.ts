import { NextRequest, NextResponse } from 'next/server';
import {
  createOriginalVideoRow,
  getOriginalVideosData,
  BaserowRow,
} from '@/lib/baserow-actions';

type Body = {
  script?: unknown;
};

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json().catch(() => null)) as Body | null;
    const script = typeof body?.script === 'string' ? body.script : '';

    if (!script.trim()) {
      return NextResponse.json(
        { error: 'Script is required' },
        { status: 400 }
      );
    }

    // Build a unique title for the new video row.
    const existingVideos = await getOriginalVideosData();

    const baseName = `Script ${new Date().toISOString().slice(0, 10)}`;

    const generateUniqueTitle = (
      base: string,
      videos: BaserowRow[]
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

    const uniqueTitle = generateUniqueTitle(baseName, existingVideos);

    const newRowData: Record<string, unknown> = {
      field_6864: 'Processing', // Status
      field_6852: uniqueTitle, // Title
      field_6854: script, // Script
    };

    const newRow = await createOriginalVideoRow(newRowData);

    return NextResponse.json({
      success: true,
      rowId: newRow.id,
      title: uniqueTitle,
    });
  } catch (error) {
    console.error('Error creating video from script:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Request failed' },
      { status: 500 }
    );
  }
}
