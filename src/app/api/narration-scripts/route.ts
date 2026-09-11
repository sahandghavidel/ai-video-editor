import { NextResponse } from 'next/server';
import { getNarrationScriptsData } from '@/lib/narration-scripts';

export const runtime = 'nodejs';

export async function GET() {
  try {
    return NextResponse.json(await getNarrationScriptsData());
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Unable to load narration scripts.' },
      { status: 502 },
    );
  }
}
