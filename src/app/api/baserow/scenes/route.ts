import { NextRequest, NextResponse } from 'next/server';

export const runtime = 'nodejs';

const SCENES_TABLE_ID = '714';

const NON_DUPLICABLE_FIELD_KEYS = new Set([
  'id',
  'order',
  'field_6882', // Record ID / autonumber-like field should be regenerated
  'field_6905', // last modified / derived metadata
]);

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

async function getSceneRow(
  baserowUrl: string,
  token: string,
  sceneId: number,
): Promise<Record<string, unknown>> {
  const res = await fetch(
    `${baserowUrl}/database/rows/table/${SCENES_TABLE_ID}/${sceneId}/`,
    {
      method: 'GET',
      headers: {
        Authorization: `JWT ${token}`,
      },
      cache: 'no-store',
    },
  );

  if (!res.ok) {
    const errorText = await res.text().catch(() => '');
    throw new Error(
      `Failed to fetch source scene ${sceneId}: ${res.status} ${errorText}`,
    );
  }

  return (await res.json()) as Record<string, unknown>;
}

function buildDuplicatePayload(
  sourceRow: Record<string, unknown>,
  overrides: Record<string, unknown>,
): Record<string, unknown> {
  const duplicated: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(sourceRow)) {
    if (!key.startsWith('field_')) continue;
    if (NON_DUPLICABLE_FIELD_KEYS.has(key)) continue;
    duplicated[key] = value;
  }

  return {
    ...duplicated,
    ...overrides,
  };
}

function normalizeSingleSelectValue(value: unknown): number | string | null {
  if (typeof value === 'number') return value;
  if (typeof value === 'string') return value;
  if (typeof value === 'boolean') return value ? 'true' : 'false';

  if (Array.isArray(value) && value.length > 0) {
    const first = value[0] as unknown;
    if (typeof first === 'number') return first;
    if (typeof first === 'string') return first;
    if (first && typeof first === 'object') {
      const obj = first as Record<string, unknown>;
      if (typeof obj.id === 'number' || typeof obj.id === 'string') {
        return obj.id as number | string;
      }
      if (typeof obj.value === 'number' || typeof obj.value === 'string') {
        return obj.value as number | string;
      }
      if (typeof obj.name === 'string') return obj.name;
    }
  }

  if (value && typeof value === 'object') {
    const obj = value as Record<string, unknown>;
    if (typeof obj.id === 'number' || typeof obj.id === 'string') {
      return obj.id as number | string;
    }
    if (typeof obj.value === 'number' || typeof obj.value === 'string') {
      return obj.value as number | string;
    }
    if (typeof obj.name === 'string') return obj.name;
  }

  return null;
}

export async function POST(request: NextRequest) {
  try {
    const rawBody = (await request.json().catch(() => ({}))) as Record<
      string,
      unknown
    >;
    const { beforeSceneId, sourceSceneId, ...body } = rawBody as Record<
      string,
      unknown
    > & {
      beforeSceneId?: unknown;
      sourceSceneId?: unknown;
    };
    const baserowUrl = process.env.BASEROW_API_URL;

    if (!baserowUrl) {
      return NextResponse.json(
        { error: 'Missing Baserow URL' },
        { status: 500 },
      );
    }

    const token = await getJWTToken();

    const parsedSourceSceneId =
      typeof sourceSceneId === 'number'
        ? sourceSceneId
        : typeof sourceSceneId === 'string'
          ? parseInt(sourceSceneId, 10)
          : NaN;

    const requestBody = !Number.isNaN(parsedSourceSceneId)
      ? buildDuplicatePayload(
          await getSceneRow(baserowUrl, token, parsedSourceSceneId),
          body,
        )
      : body;

    // Baserow single_select fields expect integer option IDs or strings.
    // Duplicated rows can include object/array shapes from row responses.
    if (Object.prototype.hasOwnProperty.call(requestBody, 'field_7096')) {
      const normalized = normalizeSingleSelectValue(requestBody.field_7096);
      if (normalized === null) {
        delete requestBody.field_7096;
      } else {
        requestBody.field_7096 = normalized;
      }
    }

    const parsedBeforeId =
      typeof beforeSceneId === 'number'
        ? beforeSceneId
        : typeof beforeSceneId === 'string'
          ? parseInt(beforeSceneId, 10)
          : NaN;

    const createUrl = new URL(
      `${baserowUrl}/database/rows/table/${SCENES_TABLE_ID}/`,
    );
    if (!Number.isNaN(parsedBeforeId)) {
      createUrl.searchParams.set('before', String(parsedBeforeId));
    }

    const response = await fetch(createUrl.toString(), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `JWT ${token}`,
      },
      body: JSON.stringify(requestBody),
    });

    if (!response.ok) {
      const errorText = await response.text();
      return NextResponse.json(
        {
          error: `Failed to create scene: ${response.status} ${errorText}`,
        },
        { status: response.status },
      );
    }

    const result = await response.json();

    return NextResponse.json(result);
  } catch (error) {
    console.error('Error creating scene:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 },
    );
  }
}
