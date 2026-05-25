import type { NextRequest } from 'next/server';

const DEFAULT_LOCAL_BASE_URL = 'http://127.0.0.1:9573/v1';

const toModelsUrl = (baseUrl: string): string => {
  let normalized = baseUrl.trim();

  if (!/^https?:\/\//i.test(normalized)) {
    normalized = `http://${normalized}`;
  }

  const url = new URL(normalized);
  const cleanedPath = url.pathname.replace(/\/+$/, '');

  if (cleanedPath.endsWith('/models')) {
    url.pathname = cleanedPath;
  } else if (cleanedPath.endsWith('/v1')) {
    url.pathname = `${cleanedPath}/models`;
  } else if (!cleanedPath || cleanedPath === '/') {
    url.pathname = '/v1/models';
  } else {
    url.pathname = `${cleanedPath}/v1/models`;
  }

  url.search = '';
  url.hash = '';

  return url.toString();
};

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json().catch(() => ({}))) as {
      baseUrl?: string;
      apiKey?: string;
    };

    const baseUrl =
      typeof body.baseUrl === 'string' && body.baseUrl.trim()
        ? body.baseUrl.trim()
        : DEFAULT_LOCAL_BASE_URL;

    const apiKey =
      typeof body.apiKey === 'string' ? body.apiKey.trim() : undefined;

    const modelsUrl = toModelsUrl(baseUrl);

    const upstream = await fetch(modelsUrl, {
      method: 'GET',
      headers: {
        Accept: 'application/json',
        ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
      },
      cache: 'no-store',
    });

    const responseText = await upstream.text();

    let parsed: unknown;
    try {
      parsed = JSON.parse(responseText);
    } catch {
      parsed = null;
    }

    if (!upstream.ok) {
      return new Response(
        JSON.stringify({
          error: `Failed to fetch local models (${upstream.status})`,
          details: parsed ?? responseText,
        }),
        {
          status: upstream.status,
          headers: { 'Content-Type': 'application/json' },
        },
      );
    }

    const rawData =
      parsed &&
      typeof parsed === 'object' &&
      Array.isArray((parsed as { data?: unknown }).data)
        ? ((parsed as { data: unknown[] }).data ?? [])
        : [];

    const models = rawData
      .map((item) => {
        if (!item || typeof item !== 'object') return null;

        const record = item as Record<string, unknown>;
        const id = typeof record.id === 'string' ? record.id : '';

        if (!id) return null;

        const name =
          typeof record.name === 'string' && record.name.trim()
            ? record.name.trim()
            : id;

        return { id, name };
      })
      .filter((model): model is { id: string; name: string } => model !== null);

    return new Response(JSON.stringify({ data: models }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (error) {
    return new Response(
      JSON.stringify({
        error: error instanceof Error ? error.message : String(error),
      }),
      {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      },
    );
  }
}
