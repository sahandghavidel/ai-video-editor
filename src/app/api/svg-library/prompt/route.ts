import { NextResponse } from 'next/server';
import { listSvgAssets } from '@/lib/svg-library-storage';
import { buildSvgLibrarySection } from '@/utils/hyperframes-svg-library';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export async function GET() {
  try {
    return NextResponse.json({ section: buildSvgLibrarySection(await listSvgAssets()) });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Unable to load approved SVG Library.' }, { status: 502 });
  }
}
