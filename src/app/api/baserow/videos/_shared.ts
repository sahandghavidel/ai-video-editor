import { buildAuthHeader, getBaserowToken } from '@/lib/baserow-auth';
const ORIGINAL_VIDEOS_TABLE_ID = '713';

export type BaserowSelectOption = {
  id: number;
  value: string;
  color?: string;
};

export type BaserowFieldSchema = {
  id: number;
  name: string;
  type: string;
  order?: number;
  primary?: boolean;
  read_only?: boolean;
  select_options?: BaserowSelectOption[];
};

let cachedFields: BaserowFieldSchema[] | null = null;
let cachedFieldsAt = 0;

async function requestWithAuth(
  path: string,
  init: RequestInit = {},
): Promise<Response> {
  const baserowUrl = process.env.BASEROW_API_URL;
  if (!baserowUrl) {
    throw new Error('Missing Baserow configuration');
  }

  async function execute(token: string) {
    const response = await fetch(`${baserowUrl}${path}`, {
      ...init,
      headers: {
        ...(init.headers ?? {}),
        ...buildAuthHeader(token),
      },
      cache: 'no-store',
    });
    return response;
  }

  try {
    const token = await getBaserowToken();
    return await execute(token);
  } catch (error) {
    const freshToken = await getBaserowToken(true);
    return execute(freshToken);
  }
}

export async function baserowGetJson<T>(path: string): Promise<T> {
  const response = await requestWithAuth(path, {
    method: 'GET',
  });

  if (!response.ok) {
    const errorText = await response.text().catch(() => '');
    throw new Error(
      `Baserow GET failed: ${response.status} ${response.statusText} ${errorText}`,
    );
  }

  return (await response.json()) as T;
}

export async function baserowPatchJson<T>(
  path: string,
  body: Record<string, unknown>,
): Promise<T> {
  const response = await requestWithAuth(path, {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const errorText = await response.text().catch(() => '');
    throw new Error(
      `Baserow PATCH failed: ${response.status} ${response.statusText} ${errorText}`,
    );
  }

  return (await response.json()) as T;
}

export async function getOriginalVideoFields(
  forceRefresh = false,
): Promise<BaserowFieldSchema[]> {
  const ttlMs = 5 * 60 * 1000;

  if (!forceRefresh && cachedFields && Date.now() - cachedFieldsAt < ttlMs) {
    return cachedFields;
  }

  const fields = await baserowGetJson<BaserowFieldSchema[]>(
    `/database/fields/table/${ORIGINAL_VIDEOS_TABLE_ID}/`,
  );

  cachedFields = fields;
  cachedFieldsAt = Date.now();

  return fields;
}

export function extractFirstUrl(value: unknown): string | null {
  if (!value) return null;

  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (trimmed.startsWith('http://') || trimmed.startsWith('https://')) {
      return trimmed;
    }
    return null;
  }

  if (Array.isArray(value) && value.length > 0) {
    const first = value[0] as unknown;
    if (typeof first === 'string') {
      const trimmed = first.trim();
      if (trimmed.startsWith('http://') || trimmed.startsWith('https://')) {
        return trimmed;
      }
    }

    if (first && typeof first === 'object') {
      const candidate = first as Record<string, unknown>;
      const nestedUrl =
        typeof candidate.url === 'string'
          ? candidate.url
          : typeof candidate.value === 'string'
            ? candidate.value
            : typeof candidate.name === 'string'
              ? candidate.name
              : null;

      if (
        nestedUrl &&
        (nestedUrl.startsWith('http://') || nestedUrl.startsWith('https://'))
      ) {
        return nestedUrl;
      }
    }
  }

  if (value && typeof value === 'object') {
    const candidate = value as Record<string, unknown>;
    const nestedUrl =
      typeof candidate.url === 'string'
        ? candidate.url
        : candidate.file && typeof candidate.file === 'object'
          ? (candidate.file as Record<string, unknown>).url
          : null;

    if (
      typeof nestedUrl === 'string' &&
      (nestedUrl.startsWith('http://') || nestedUrl.startsWith('https://'))
    ) {
      return nestedUrl;
    }
  }

  return null;
}

export function normalizeSingleSelectValue(
  value: unknown,
): number | string | null {
  if (value === null || value === undefined || value === '') {
    return null;
  }

  if (typeof value === 'number' || typeof value === 'string') {
    return value;
  }

  if (Array.isArray(value) && value.length > 0) {
    return normalizeSingleSelectValue(value[0]);
  }

  if (value && typeof value === 'object') {
    const option = value as Record<string, unknown>;

    if (typeof option.id === 'number' || typeof option.id === 'string') {
      return option.id;
    }

    if (typeof option.value === 'number' || typeof option.value === 'string') {
      return option.value;
    }

    if (typeof option.name === 'string') {
      return option.name;
    }
  }

  return null;
}

export function normalizeMultiSelectValue(
  value: unknown,
): Array<number | string> {
  if (!Array.isArray(value)) {
    return [];
  }

  const normalized = value
    .map((item) => normalizeSingleSelectValue(item))
    .filter(
      (item): item is number | string => item !== null && item !== undefined,
    );

  return normalized;
}

export { ORIGINAL_VIDEOS_TABLE_ID };
