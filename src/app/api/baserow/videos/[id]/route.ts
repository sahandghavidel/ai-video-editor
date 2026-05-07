import { NextRequest, NextResponse } from 'next/server';
import {
  baserowGetJson,
  baserowPatchJson,
  getOriginalVideoFields,
  normalizeMultiSelectValue,
  normalizeSingleSelectValue,
  ORIGINAL_VIDEOS_TABLE_ID,
} from '../_shared';

export const runtime = 'nodejs';

type BaserowRow = {
  id: number;
  [key: string]: unknown;
};

function parsePositiveInt(value: string): number | null {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) return null;
  return parsed;
}

function normalizePatchValue(fieldType: string, value: unknown): unknown {
  switch (fieldType) {
    case 'text':
    case 'long_text':
    case 'url':
    case 'email':
    case 'phone_number': {
      if (value === null || value === undefined) return '';
      return String(value);
    }

    case 'number':
    case 'rating': {
      if (value === '' || value === null || value === undefined) {
        return null;
      }
      const parsed = Number(value);
      return Number.isFinite(parsed) ? parsed : null;
    }

    case 'boolean': {
      if (typeof value === 'boolean') return value;
      if (typeof value === 'string') {
        return value.trim().toLowerCase() === 'true';
      }
      return Boolean(value);
    }

    case 'single_select': {
      return normalizeSingleSelectValue(value);
    }

    case 'multiple_select': {
      return normalizeMultiSelectValue(value);
    }

    default:
      return value;
  }
}

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const videoId = parsePositiveInt(id);

    if (!videoId) {
      return NextResponse.json({ error: 'Invalid video ID' }, { status: 400 });
    }

    const row = await baserowGetJson<BaserowRow>(
      `/database/rows/table/${ORIGINAL_VIDEOS_TABLE_ID}/${videoId}/`,
    );

    return NextResponse.json(row, {
      headers: {
        'Cache-Control': 'no-store, max-age=0',
      },
    });
  } catch (error) {
    console.error('Failed to fetch original video row:', error);
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 },
    );
  }
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const videoId = parsePositiveInt(id);

    if (!videoId) {
      return NextResponse.json({ error: 'Invalid video ID' }, { status: 400 });
    }

    const body = (await request.json().catch(() => null)) as Record<
      string,
      unknown
    > | null;

    if (!body || typeof body !== 'object') {
      return NextResponse.json(
        { error: 'Invalid request body' },
        { status: 400 },
      );
    }

    const fields = await getOriginalVideoFields();
    const fieldByKey = new Map(
      fields.map((field) => [`field_${field.id}`, field]),
    );

    const normalizedPatch: Record<string, unknown> = {};

    for (const [key, value] of Object.entries(body)) {
      if (!key.startsWith('field_')) continue;

      const field = fieldByKey.get(key);
      if (!field) continue;

      normalizedPatch[key] = normalizePatchValue(field.type, value);
    }

    if (Object.keys(normalizedPatch).length === 0) {
      return NextResponse.json(
        { error: 'No editable field values supplied' },
        { status: 400 },
      );
    }

    const updatedRow = await baserowPatchJson<BaserowRow>(
      `/database/rows/table/${ORIGINAL_VIDEOS_TABLE_ID}/${videoId}/`,
      normalizedPatch,
    );

    return NextResponse.json(updatedRow, {
      headers: {
        'Cache-Control': 'no-store, max-age=0',
      },
    });
  } catch (error) {
    console.error('Failed to update original video row:', error);
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 },
    );
  }
}
