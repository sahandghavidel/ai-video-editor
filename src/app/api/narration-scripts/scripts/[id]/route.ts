import { NextRequest, NextResponse } from 'next/server';

import { buildAuthHeader, getBaserowToken } from '@/lib/baserow-auth';

export const runtime = 'nodejs';

const SCRIPTS_TABLE_ID = '740';
const SCENES_TABLE_ID = '739';
const MAX_TITLE_LENGTH = 500;
const SCRIPT_STATUS_OPTIONS = ['Draft', 'In Progress', 'Ready', 'Archived'] as const;

type ScriptStatus = (typeof SCRIPT_STATUS_OPTIONS)[number];
type BaserowRow = Record<string, unknown> & { id?: unknown };

function parsePositiveInt(value: string) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

function rowId(row: BaserowRow) {
  if (typeof row.id === 'number' && Number.isSafeInteger(row.id)) return row.id;
  if (typeof row.id === 'string' && /^\d+$/.test(row.id)) return Number(row.id);
  return null;
}

function linkedIds(value: unknown): number[] {
  const values = Array.isArray(value) ? value : value ? [value] : [];
  return values.flatMap((entry) => {
    if (typeof entry === 'number' && Number.isSafeInteger(entry)) return [entry];
    if (typeof entry === 'string' && /^\d+$/.test(entry)) return [Number(entry)];
    if (entry && typeof entry === 'object') {
      const id = (entry as Record<string, unknown>).id;
      if (typeof id === 'number' && Number.isSafeInteger(id)) return [id];
      if (typeof id === 'string' && /^\d+$/.test(id)) return [Number(id)];
    }
    return [];
  });
}

function selectValue(value: unknown) {
  if (typeof value === 'string') return value.trim() || null;
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    const candidate = (value as Record<string, unknown>).value;
    return typeof candidate === 'string' ? candidate.trim() || null : null;
  }
  return null;
}

function getErrorDetail(response: Response) {
  return response.text().catch(() => '').then((detail) => detail.slice(0, 1000));
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
  if (response.status === 401) response = await execute(await getBaserowToken(true));
  return response;
}

async function fetchAllSceneRows() {
  const rows: BaserowRow[] = [];
  let page = 1;

  while (true) {
    const query = new URLSearchParams({
      user_field_names: 'true',
      size: '200',
      page: String(page),
    });
    const response = await requestBaserow(
      `/database/rows/table/${SCENES_TABLE_ID}/?${query.toString()}`,
      { headers: { 'Content-Type': 'application/json' } },
    );
    if (!response.ok) {
      throw new Error(`Could not list related scenes (${response.status}): ${await getErrorDetail(response)}`);
    }

    const payload = (await response.json()) as { results?: unknown; next?: unknown };
    if (!Array.isArray(payload.results)) throw new Error('Baserow returned an invalid scenes response.');
    rows.push(...(payload.results as BaserowRow[]));
    if (!payload.next) return rows;
    page += 1;
  }
}

function parseScriptBody(body: unknown):
  | { ok: true; values: Record<string, unknown> }
  | { ok: false; error: string; status: number } {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return { ok: false, error: 'Invalid request body.', status: 400 };
  }

  const entries = Object.entries(body as Record<string, unknown>);
  if (entries.length === 0) return { ok: false, error: 'No script values supplied.', status: 400 };

  const values: Record<string, unknown> = {};
  for (const [key, value] of entries) {
    if (key !== 'title' && key !== 'status') {
      return { ok: false, error: `Field ${key} cannot be edited here.`, status: 400 };
    }
    if (value !== null && typeof value !== 'string') {
      return { ok: false, error: `Field ${key} must be text.`, status: 400 };
    }

    if (key === 'title') {
      const title = typeof value === 'string' ? value.trim() : '';
      if (!title) return { ok: false, error: 'Script title cannot be empty.', status: 400 };
      if (title.length > MAX_TITLE_LENGTH) return { ok: false, error: 'Script title is too long.', status: 413 };
      values['Script Title'] = title;
      continue;
    }

    const status = typeof value === 'string' ? value.trim() : '';
    if (status && !SCRIPT_STATUS_OPTIONS.includes(status as ScriptStatus)) {
      return {
        ok: false,
        error: `Invalid status. Choose one of: ${SCRIPT_STATUS_OPTIONS.join(', ')}.`,
        status: 400,
      };
    }
    values.Status = status || null;
  }

  return { ok: true, values };
}

function normalizeScript(row: BaserowRow) {
  const id = rowId(row);
  const title = typeof row['Script Title'] === 'string' ? row['Script Title'].trim() : '';
  if (!id || !title) return null;
  return {
    id,
    title,
    status: selectValue(row.Status),
    lastEdited: typeof row['Last Edited'] === 'string' ? row['Last Edited'] : null,
  };
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const scriptId = parsePositiveInt((await params).id);
    if (!scriptId) return NextResponse.json({ error: 'Invalid script ID.' }, { status: 400 });

    const parsedBody = parseScriptBody(await request.json().catch(() => null));
    if (!parsedBody.ok) {
      return NextResponse.json({ error: parsedBody.error }, { status: parsedBody.status });
    }

    const response = await requestBaserow(
      `/database/rows/table/${SCRIPTS_TABLE_ID}/${scriptId}/?user_field_names=true`,
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

    const script = normalizeScript((await response.json()) as BaserowRow);
    if (!script) throw new Error('Baserow returned an invalid script row.');
    return NextResponse.json({ script }, { headers: { 'Cache-Control': 'no-store, max-age=0' } });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Unable to update script.' },
      { status: 500 },
    );
  }
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const scriptId = parsePositiveInt((await params).id);
    if (!scriptId) return NextResponse.json({ error: 'Invalid script ID.' }, { status: 400 });

    // Resolve the complete relationship before deleting anything. This avoids
    // deleting a script while a listing failure could still hide orphan scenes.
    const sceneRows = await fetchAllSceneRows();
    const relatedSceneIds = sceneRows
      .filter((row) => linkedIds(row.Script).includes(scriptId))
      .map(rowId)
      .filter((id): id is number => id !== null);

    const deletedSceneIds: number[] = [];
    for (const sceneId of relatedSceneIds) {
      const response = await requestBaserow(
        `/database/rows/table/${SCENES_TABLE_ID}/${sceneId}/`,
        { method: 'DELETE' },
      );
      if (!response.ok) {
        throw new Error(
          `Could not delete related scene ${sceneId} (${response.status}): ${await getErrorDetail(response)}`,
        );
      }
      deletedSceneIds.push(sceneId);
    }

    const scriptResponse = await requestBaserow(
      `/database/rows/table/${SCRIPTS_TABLE_ID}/${scriptId}/`,
      { method: 'DELETE' },
    );
    if (!scriptResponse.ok) {
      throw new Error(
        `Related scenes were deleted, but the script could not be deleted (${scriptResponse.status}): ${await getErrorDetail(scriptResponse)}`,
      );
    }

    return NextResponse.json({ ok: true, scriptId, deletedSceneIds });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Unable to delete script.' },
      { status: 500 },
    );
  }
}
