import { NextRequest, NextResponse } from 'next/server';

import { buildAuthHeader, getBaserowToken } from '@/lib/baserow-auth';
import {
  mapNarrationScriptSceneRow,
  type BaserowRow,
} from '@/lib/narration-scripts';

export const runtime = 'nodejs';

const SCENES_TABLE_ID = '739';
const MAX_FIELD_LENGTH = 100_000;
const EDITABLE_FIELDS = {
  part: 'Part',
  narration: 'Narration',
  onScreen: 'On Screen',
  annotation: 'Annotation',
  code: 'Code',
  language: 'Language',
  targetFile: 'Target File',
  codeInstruction: 'Code Instruction',
} as const;

type EditableField = keyof typeof EDITABLE_FIELDS;

function parsePositiveInt(value: string) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

async function requestBaserow(path: string, init: RequestInit = {}) {
  const baserowUrl = process.env.BASEROW_API_URL?.trim().replace(/\/+$/, '');
  if (!baserowUrl) throw new Error('Missing Baserow URL configuration.');

  const execute = async (token: string) =>
    fetch(`${baserowUrl}${path}`, {
      ...init,
      headers: {
        ...(init.headers ?? {}),
        ...buildAuthHeader(token),
      },
      cache: 'no-store',
    });

  let response = await execute(await getBaserowToken());
  if (response.status === 401) {
    response = await execute(await getBaserowToken(true));
  }
  return response;
}

function getErrorDetail(response: Response) {
  return response.text().catch(() => '').then((detail) => detail.slice(0, 1000));
}

function parseEditableBody(body: unknown):
  | { ok: true; values: Record<string, unknown> }
  | { ok: false; error: string; status: number } {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return { ok: false, error: 'Invalid request body.', status: 400 };
  }

  const entries = Object.entries(body as Record<string, unknown>);
  if (entries.length === 0) {
    return { ok: false, error: 'No editable field values supplied.', status: 400 };
  }

  const values: Record<string, unknown> = {};
  for (const [key, value] of entries) {
    if (!(key in EDITABLE_FIELDS)) {
      return { ok: false, error: `Field ${key} cannot be edited here.`, status: 400 };
    }

    if (value !== null && typeof value !== 'string') {
      return { ok: false, error: `Field ${key} must be text.`, status: 400 };
    }

    const text = typeof value === 'string' ? value : '';
    if (text.length > MAX_FIELD_LENGTH) {
      return { ok: false, error: `Field ${key} is too long.`, status: 413 };
    }

    const baserowField = EDITABLE_FIELDS[key as EditableField];
    values[baserowField] = key === 'part' ? text.trim() || null : text;
  }

  return { ok: true, values };
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const sceneId = parsePositiveInt((await params).id);
    if (!sceneId) {
      return NextResponse.json({ error: 'Invalid scene ID.' }, { status: 400 });
    }

    const parsedBody = parseEditableBody(await request.json().catch(() => null));
    if (!parsedBody.ok) {
      return NextResponse.json({ error: parsedBody.error }, { status: parsedBody.status });
    }

    const response = await requestBaserow(
      `/database/rows/table/${SCENES_TABLE_ID}/${sceneId}/?user_field_names=true`,
      {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(parsedBody.values),
      },
    );
    if (!response.ok) {
      return NextResponse.json(
        { error: `Baserow update failed (${response.status}): ${await getErrorDetail(response)}` },
        { status: response.status },
      );
    }

    const row = (await response.json()) as BaserowRow;
    const scene = mapNarrationScriptSceneRow(row);
    if (!scene) throw new Error('Baserow returned an invalid scene row.');

    return NextResponse.json(
      { scene },
      { headers: { 'Cache-Control': 'no-store, max-age=0' } },
    );
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Unable to update scene.' },
      { status: 500 },
    );
  }
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const sceneId = parsePositiveInt((await params).id);
    if (!sceneId) {
      return NextResponse.json({ error: 'Invalid scene ID.' }, { status: 400 });
    }

    const response = await requestBaserow(
      `/database/rows/table/${SCENES_TABLE_ID}/${sceneId}/`,
      { method: 'DELETE' },
    );
    if (!response.ok) {
      return NextResponse.json(
        { error: `Baserow deletion failed (${response.status}): ${await getErrorDetail(response)}` },
        { status: response.status },
      );
    }

    return NextResponse.json({ ok: true, sceneId });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Unable to delete scene.' },
      { status: 500 },
    );
  }
}
