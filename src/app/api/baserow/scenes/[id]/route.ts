import { NextRequest, NextResponse } from 'next/server';

export const runtime = 'nodejs';

type BaserowSelectOption = {
  id: number;
  value: string;
  color?: string;
};

type BaserowField = {
  id?: number;
  name?: string;
  type?: string;
  select_options?: BaserowSelectOption[];
};

const SCENES_TABLE_ID = '714';
const FLAGGED_FIELD_ID = 7096;
const FLAGGED_FIELD_KEY = 'field_7096';

let cachedFlaggedTrueOptionId: number | null = null;
let cachedFlaggedTrueOptionIdAt = 0;

async function resolveFlaggedTrueOptionId(
  baserowUrl: string,
  token: string,
): Promise<number | null> {
  // Cache for 10 minutes to avoid hammering the Baserow metadata endpoint.
  const ttlMs = 10 * 60 * 1000;
  if (
    cachedFlaggedTrueOptionId !== null &&
    Date.now() - cachedFlaggedTrueOptionIdAt < ttlMs
  ) {
    return cachedFlaggedTrueOptionId;
  }

  const res = await fetch(
    `${baserowUrl}/database/fields/table/${SCENES_TABLE_ID}/`,
    {
      method: 'GET',
      headers: {
        Authorization: `JWT ${token}`,
      },
      // This is server-side; ensure we don't cache across deployments unexpectedly.
      cache: 'no-store',
    },
  );

  if (!res.ok) {
    const t = await res.text().catch(() => '');
    console.warn(
      `Failed to fetch Baserow fields for scenes table: ${res.status} ${t}`,
    );
    return null;
  }

  const fields = (await res.json().catch(() => null)) as unknown;
  if (!Array.isArray(fields)) return null;

  const flaggedField = (fields as BaserowField[]).find(
    (f) =>
      (typeof f?.id === 'number' && f.id === FLAGGED_FIELD_ID) ||
      (typeof f?.name === 'string' && f.name.toLowerCase() === 'flagged'),
  );

  const options = flaggedField?.select_options;
  if (!Array.isArray(options) || options.length === 0) return null;

  const trueOpt = options.find(
    (o) => typeof o?.value === 'string' && o.value.toLowerCase() === 'true',
  );
  if (!trueOpt || typeof trueOpt.id !== 'number') return null;

  cachedFlaggedTrueOptionId = trueOpt.id;
  cachedFlaggedTrueOptionIdAt = Date.now();
  return trueOpt.id;
}

function normalizeSelectValueToBoolLabel(
  value: unknown,
): 'true' | 'false' | null {
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (typeof value === 'string') {
    const v = value.trim().toLowerCase();
    if (v === 'true') return 'true';
    if (v === 'false') return 'false';
  }
  if (value && typeof value === 'object') {
    const rec = value as Record<string, unknown>;
    const maybeValue = rec.value;
    if (typeof maybeValue === 'string') {
      const v = maybeValue.trim().toLowerCase();
      if (v === 'true') return 'true';
      if (v === 'false') return 'false';
    }
  }
  return null;
}

// Helper function to get JWT token for Baserow API
async function getJWTToken(): Promise<string> {
  const baserowUrl = process.env.BASEROW_API_URL;
  const email = process.env.BASEROW_EMAIL;
  const password = process.env.BASEROW_PASSWORD;

  if (!baserowUrl || !email || !password) {
    throw new Error('Missing Baserow configuration');
  }

  const response = await fetch(`${baserowUrl}/user/token-auth/`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Authentication failed: ${response.status} ${errorText}`);
  }

  const data = await response.json();
  return data.token;
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const sceneId = parseInt(id);
    if (isNaN(sceneId)) {
      return NextResponse.json({ error: 'Invalid scene ID' }, { status: 400 });
    }

    const body = (await request.json().catch(() => ({}))) as Record<
      string,
      unknown
    >;
    const baserowUrl = process.env.BASEROW_API_URL;

    if (!baserowUrl) {
      return NextResponse.json(
        { error: 'Missing Baserow URL' },
        { status: 500 },
      );
    }

    // Get JWT token
    const token = await getJWTToken();

    // Normalize the Flagged single-select field (field_7096) if the client sends the label/boolean.
    if (Object.prototype.hasOwnProperty.call(body, FLAGGED_FIELD_KEY)) {
      const requested = body[FLAGGED_FIELD_KEY];
      const label = normalizeSelectValueToBoolLabel(requested);

      // For now we only need to support setting it to true.
      if (label === 'true') {
        const optId = await resolveFlaggedTrueOptionId(baserowUrl, token);
        if (typeof optId === 'number') {
          body[FLAGGED_FIELD_KEY] = optId;
        }
      }
    }

    // Update the scene in Baserow
    const response = await fetch(
      `${baserowUrl}/database/rows/table/${SCENES_TABLE_ID}/${sceneId}/`,
      {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `JWT ${token}`,
        },
        body: JSON.stringify(body),
      },
    );

    if (!response.ok) {
      const errorText = await response.text();
      console.error('Failed to update scene:', errorText);
      return NextResponse.json(
        { error: `Failed to update scene: ${response.status} ${errorText}` },
        { status: response.status },
      );
    }

    const result = await response.json();
    return NextResponse.json(result);
  } catch (error) {
    console.error('Error updating scene:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 },
    );
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const sceneId = parseInt(id);
    if (isNaN(sceneId)) {
      return NextResponse.json({ error: 'Invalid scene ID' }, { status: 400 });
    }

    const baserowUrl = process.env.BASEROW_API_URL;
    const scenesTableId = '714'; // Scenes table

    if (!baserowUrl) {
      return NextResponse.json(
        { error: 'Missing Baserow URL' },
        { status: 500 },
      );
    }

    // Get JWT token
    const token = await getJWTToken();

    // Delete the scene in Baserow
    const response = await fetch(
      `${baserowUrl}/database/rows/table/${scenesTableId}/${sceneId}/`,
      {
        method: 'DELETE',
        headers: {
          Authorization: `JWT ${token}`,
        },
      },
    );

    if (!response.ok) {
      const errorText = await response.text();
      console.error('Failed to delete scene:', errorText);
      return NextResponse.json(
        { error: `Failed to delete scene: ${response.status} ${errorText}` },
        { status: response.status },
      );
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Error deleting scene:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 },
    );
  }
}
