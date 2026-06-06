import { NextResponse } from 'next/server';
import { getBaserowToken, buildAuthHeader } from '@/lib/baserow-auth';

const ORIGINAL_VIDEOS_TABLE_ID = '713';
const TTS_VOICE_FIELD_ID = 6860;

type BaserowSelectOption = {
  id?: number;
  value?: string;
};

type BaserowField = {
  id?: number;
  name?: string;
  type?: string;
  select_options?: BaserowSelectOption[];
};

type BaserowRow = {
  id: number;
  [key: string]: unknown;
};

function extractVoiceValue(value: unknown): string | null {
  if (typeof value === 'string') {
    const v = value.trim();
    return v.length > 0 ? v : null;
  }

  if (Array.isArray(value)) {
    for (const item of value) {
      const extracted = extractVoiceValue(item);
      if (extracted) return extracted;
    }
    return null;
  }

  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    const candidates = [record.value, record.name, record.title, record.text];
    for (const candidate of candidates) {
      if (typeof candidate === 'string') {
        const v = candidate.trim();
        if (v.length > 0) return v;
      }
    }
  }

  return null;
}

async function fetchFieldOptions(
  baserowUrl: string,
  token: string,
): Promise<string[]> {
  const fieldsRes = await fetch(
    `${baserowUrl}/database/fields/table/${ORIGINAL_VIDEOS_TABLE_ID}/`,
    {
      method: 'GET',
      headers: { ...buildAuthHeader(token), },
      cache: 'no-store',
    },
  );

  if (!fieldsRes.ok) {
    const text = await fieldsRes.text().catch(() => '');
    throw new Error(
      `Failed fetching table fields: ${fieldsRes.status} ${text}`,
    );
  }

  const fields = (await fieldsRes.json().catch(() => null)) as unknown;
  if (!Array.isArray(fields)) return [];

  const voiceField = (fields as BaserowField[]).find((f) => {
    if (typeof f?.id === 'number' && f.id === TTS_VOICE_FIELD_ID) return true;
    if (typeof f?.name !== 'string') return false;
    const normalized = f.name.trim().toLowerCase();
    return normalized === 'tts voice' || normalized.includes('tts voice');
  });

  const options = voiceField?.select_options;
  if (!Array.isArray(options)) return [];

  return options
    .map((o) => (typeof o?.value === 'string' ? o.value.trim() : ''))
    .filter((v) => v.length > 0);
}

async function fetchRowDerivedOptions(
  baserowUrl: string,
  token: string,
): Promise<string[]> {
  const uniqueValues = new Set<string>();
  const fieldKey = `field_${TTS_VOICE_FIELD_ID}`;

  let page = 1;
  let hasMore = true;

  while (hasMore) {
    const rowsRes = await fetch(
      `${baserowUrl}/database/rows/table/${ORIGINAL_VIDEOS_TABLE_ID}/?size=200&page=${page}`,
      {
        method: 'GET',
        headers: { ...buildAuthHeader(token), },
        cache: 'no-store',
      },
    );

    if (!rowsRes.ok) {
      const text = await rowsRes.text().catch(() => '');
      throw new Error(`Failed fetching rows: ${rowsRes.status} ${text}`);
    }

    const payload = (await rowsRes.json().catch(() => null)) as {
      results?: BaserowRow[];
      next?: unknown;
    } | null;

    const rows = Array.isArray(payload?.results) ? payload.results : [];
    for (const row of rows) {
      const value = extractVoiceValue(row[fieldKey]);
      if (value) uniqueValues.add(value);
    }

    hasMore = Boolean(payload?.next);
    page += 1;
  }

  return Array.from(uniqueValues);
}

export async function GET() {
  try {
    const baserowUrl = process.env.BASEROW_API_URL;
    if (!baserowUrl) {
      return NextResponse.json({ voices: [] }, { status: 500 });
    }

    const token = await getBaserowToken();

    // Preferred source: canonical field options from metadata.
    const fieldOptions = await fetchFieldOptions(baserowUrl, token);
    if (fieldOptions.length > 0) {
      return NextResponse.json({
        voices: fieldOptions.sort((a, b) => a.localeCompare(b)),
      });
    }

    // Fallback: derive values from existing rows if field has no select options.
    const rowOptions = await fetchRowDerivedOptions(baserowUrl, token);
    return NextResponse.json({
      voices: rowOptions.sort((a, b) => a.localeCompare(b)),
    });
  } catch (error) {
    console.error('Error fetching TTS voice options:', error);
    return NextResponse.json({ voices: [] }, { status: 500 });
  }
}
