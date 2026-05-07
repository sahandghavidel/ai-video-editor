import { NextResponse } from 'next/server';
import { getOriginalVideoFields } from '../_shared';

export const runtime = 'nodejs';

export async function GET() {
  try {
    const fields = await getOriginalVideoFields();

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
