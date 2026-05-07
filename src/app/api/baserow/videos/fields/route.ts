import { NextResponse } from 'next/server';
import { getOriginalVideoFields } from '../_shared';

export const runtime = 'nodejs';

function shouldForceRefresh(value: string | null): boolean {
  if (!value) return false;
  const normalized = value.trim().toLowerCase();
  return normalized === '1' || normalized === 'true' || normalized === 'yes';
}

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const refresh = shouldForceRefresh(url.searchParams.get('refresh'));
    const fields = await getOriginalVideoFields(refresh);

    return NextResponse.json(
      { fields },
      {
        headers: {
          'Cache-Control': 'no-store, max-age=0',
        },
      },
    );
  } catch (error) {
    console.error('Failed to fetch original video fields:', error);
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 },
    );
  }
}
