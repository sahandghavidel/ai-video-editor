import OpenAI from 'openai';

export type AIProvider = 'online' | 'local';

export type AIProviderRequestBody = {
  provider?: unknown;
  localEndpoint?: unknown;
  localApiKey?: unknown;
  localAdminApiKey?: unknown;
};

const OPENROUTER_BASE_URL = 'https://openrouter.ai/api/v1';
const DEFAULT_LOCAL_BASE_URL = 'http://127.0.0.1:9573/v1';

const AI_PROVIDER_COOKIE_NAME = 'uve_ai_provider';
const AI_LOCAL_ENDPOINT_COOKIE_NAME = 'uve_ai_local_endpoint';
const AI_LOCAL_API_KEY_COOKIE_NAME = 'uve_ai_local_api_key';
const AI_LOCAL_ADMIN_API_KEY_COOKIE_NAME = 'uve_ai_local_admin_api_key';

const decodeCookieValue = (value: string): string => {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
};

const readCookie = (request: Request, name: string): string | undefined => {
  const cookieHeader = request.headers.get('cookie') || '';
  if (!cookieHeader) return undefined;

  const segments = cookieHeader.split(';');
  for (const segment of segments) {
    const [rawKey, ...rest] = segment.split('=');
    if (!rawKey) continue;
    if (rawKey.trim() !== name) continue;

    const rawValue = rest.join('=').trim();
    if (!rawValue) return undefined;

    return decodeCookieValue(rawValue);
  }

  return undefined;
};

const asNonEmptyString = (value: unknown): string | undefined => {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed ? trimmed : undefined;
};

const normalizeProvider = (value: unknown): AIProvider | undefined => {
  if (value === 'local') return 'local';
  if (value === 'online') return 'online';
  return undefined;
};

const normalizeLocalBaseUrl = (rawInput?: string): string => {
  const input = rawInput?.trim() || DEFAULT_LOCAL_BASE_URL;

  try {
    let normalized = input;
    if (!/^https?:\/\//i.test(normalized)) {
      normalized = `http://${normalized}`;
    }

    const url = new URL(normalized);
    let pathname = url.pathname.replace(/\/+$/, '');

    if (pathname.endsWith('/models')) {
      pathname = pathname.slice(0, -'/models'.length);
    }

    if (!pathname || pathname === '/') {
      pathname = '/v1';
    } else if (!pathname.endsWith('/v1')) {
      pathname = `${pathname}/v1`;
    }

    url.pathname = pathname;
    url.search = '';
    url.hash = '';

    return url.toString();
  } catch {
    return DEFAULT_LOCAL_BASE_URL;
  }
};

export interface ResolvedAIProviderConfig {
  provider: AIProvider;
  localEndpoint?: string;
  localApiKey?: string;
  localAdminApiKey?: string;
}

export const resolveAIProviderConfig = (
  request: Request,
  body?: AIProviderRequestBody | null,
): ResolvedAIProviderConfig => {
  const providerFromBody = normalizeProvider(body?.provider);
  const providerFromCookie = normalizeProvider(
    readCookie(request, AI_PROVIDER_COOKIE_NAME),
  );

  const provider: AIProvider =
    providerFromBody || providerFromCookie || 'online';

  const localEndpoint = normalizeLocalBaseUrl(
    asNonEmptyString(body?.localEndpoint) ||
      asNonEmptyString(readCookie(request, AI_LOCAL_ENDPOINT_COOKIE_NAME)) ||
      process.env.OMLX_BASE_URL ||
      process.env.LOCAL_OPENAI_BASE_URL,
  );

  const localApiKey =
    asNonEmptyString(body?.localApiKey) ||
    asNonEmptyString(readCookie(request, AI_LOCAL_API_KEY_COOKIE_NAME)) ||
    process.env.OMLX_API_KEY?.trim() ||
    process.env.LOCAL_OPENAI_API_KEY?.trim() ||
    undefined;

  const localAdminApiKey =
    asNonEmptyString(body?.localAdminApiKey) ||
    asNonEmptyString(readCookie(request, AI_LOCAL_ADMIN_API_KEY_COOKIE_NAME)) ||
    process.env.OMLX_ADMIN_API_KEY?.trim() ||
    process.env.LOCAL_OPENAI_ADMIN_API_KEY?.trim() ||
    undefined;

  return {
    provider,
    localEndpoint,
    localApiKey,
    localAdminApiKey,
  };
};

export interface ResolvedOpenAIClient {
  provider: AIProvider;
  client: OpenAI | null;
  baseURL: string;
  missingApiKey: boolean;
}

export const resolveOpenAIClient = (
  request: Request,
  body?: AIProviderRequestBody | null,
): ResolvedOpenAIClient => {
  const providerConfig = resolveAIProviderConfig(request, body);

  if (providerConfig.provider === 'local') {
    const apiKey = providerConfig.localApiKey || 'omlx-local';

    return {
      provider: 'local',
      baseURL: providerConfig.localEndpoint || DEFAULT_LOCAL_BASE_URL,
      missingApiKey: false,
      client: new OpenAI({
        apiKey,
        baseURL: providerConfig.localEndpoint || DEFAULT_LOCAL_BASE_URL,
      }),
    };
  }

  const apiKey =
    process.env.OPENROUTER_API_KEY?.trim() ||
    process.env.OPENAI_API_KEY?.trim() ||
    '';

  if (!apiKey) {
    return {
      provider: 'online',
      baseURL: OPENROUTER_BASE_URL,
      missingApiKey: true,
      client: null,
    };
  }

  return {
    provider: 'online',
    baseURL: OPENROUTER_BASE_URL,
    missingApiKey: false,
    client: new OpenAI({
      apiKey,
      baseURL: OPENROUTER_BASE_URL,
      defaultHeaders: {
        'HTTP-Referer': 'https://ultimate-video-editor.com',
        'X-Title': 'Ultimate Video Editor',
      },
    }),
  };
};

export const resolveRequestedModel = (
  value: unknown,
  fallback: string,
): string => {
  const normalized = asNonEmptyString(value);
  return normalized || fallback;
};

export interface LocalModelUnloadInput {
  modelId: string;
  localBaseUrl?: string;
  localApiKey?: string;
  localAdminApiKey?: string;
}

export interface LocalModelUnloadResult {
  attempted: boolean;
  ok: boolean;
  modelId: string;
  endpoint?: string;
  status?: number;
  message?: string;
}

type LocalModelUnloadAttempt = {
  ok: boolean;
  endpoint: string;
  status?: number;
  message?: string;
};

const resolveLocalAdminBaseUrl = (baseUrl?: string): string => {
  const normalizedBase = normalizeLocalBaseUrl(baseUrl);

  try {
    const parsed = new URL(normalizedBase);
    return parsed.origin;
  } catch {
    try {
      const fallback = new URL(DEFAULT_LOCAL_BASE_URL);
      return fallback.origin;
    } catch {
      return 'http://127.0.0.1:9573';
    }
  }
};

const buildApiKeyHeaders = (apiKey?: string): Record<string, string> => {
  const normalized = String(apiKey || '').trim();
  if (!normalized) return {};

  return {
    Authorization: `Bearer ${normalized}`,
    'X-API-Key': normalized,
  };
};

const extractSessionCookieHeader = (response: Response): string | undefined => {
  const headerBag = response.headers as Headers & {
    getSetCookie?: () => string[];
  };

  const rawCookies =
    typeof headerBag.getSetCookie === 'function'
      ? headerBag.getSetCookie()
      : (() => {
          const single = response.headers.get('set-cookie');
          return single ? [single] : [];
        })();

  if (rawCookies.length === 0) return undefined;

  const cookiePairs = rawCookies
    .map((cookie) => cookie.split(';')[0]?.trim())
    .filter((cookie): cookie is string => Boolean(cookie));

  return cookiePairs.length > 0 ? cookiePairs.join('; ') : undefined;
};

const attemptModelUnload = async (
  endpoint: string,
  headers: Record<string, string>,
): Promise<LocalModelUnloadAttempt> => {
  try {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers,
      cache: 'no-store',
    });

    const message = await response.text().catch(() => '');

    return {
      ok: response.ok,
      endpoint,
      status: response.status,
      message: message || undefined,
    };
  } catch (error) {
    return {
      ok: false,
      endpoint,
      message: error instanceof Error ? error.message : String(error),
    };
  }
};

export const unloadLocalModel = async (
  input: LocalModelUnloadInput,
): Promise<LocalModelUnloadResult> => {
  const modelId = String(input.modelId || '').trim();
  if (!modelId) {
    return {
      attempted: false,
      ok: false,
      modelId,
      message: 'Missing modelId',
    };
  }

  const localV1BaseUrl = normalizeLocalBaseUrl(input.localBaseUrl).replace(
    /\/+$/,
    '',
  );
  const adminBaseUrl = resolveLocalAdminBaseUrl(input.localBaseUrl);
  const publicEndpoint = `${localV1BaseUrl}/models/${encodeURIComponent(modelId)}/unload`;
  const endpoint = `${adminBaseUrl}/admin/api/models/${encodeURIComponent(modelId)}/unload`;

  const localApiKey = String(input.localApiKey || '').trim();
  const adminApiKey = String(input.localAdminApiKey || '').trim();

  // 1) Preferred path: public OpenAI-compatible unload endpoint.
  // This works for standard API keys and avoids admin-session auth requirements.
  const publicAttempt = await attemptModelUnload(
    publicEndpoint,
    buildApiKeyHeaders(localApiKey || adminApiKey),
  );

  if (publicAttempt.ok) {
    return {
      attempted: true,
      ok: true,
      modelId,
      endpoint: publicAttempt.endpoint,
      status: publicAttempt.status,
      message: publicAttempt.message,
    };
  }

  // 2) Fallback: admin unload endpoint with key headers.
  const adminAttempt = await attemptModelUnload(
    endpoint,
    buildApiKeyHeaders(adminApiKey || localApiKey),
  );

  if (adminAttempt.ok) {
    return {
      attempted: true,
      ok: true,
      modelId,
      endpoint: adminAttempt.endpoint,
      status: adminAttempt.status,
      message: adminAttempt.message,
    };
  }

  let sessionRetryAttempt: LocalModelUnloadAttempt | null = null;
  const authKeyForLogin = adminApiKey || localApiKey;

  // 3) If admin endpoint rejects key headers, attempt admin login and retry with session cookie.
  if (
    authKeyForLogin &&
    (adminAttempt.status === 401 || adminAttempt.status === 403)
  ) {
    try {
      const loginResponse = await fetch(`${adminBaseUrl}/admin/api/login`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...buildApiKeyHeaders(authKeyForLogin),
        },
        body: JSON.stringify({
          api_key: authKeyForLogin,
          remember: false,
        }),
        cache: 'no-store',
      });

      const loginMessage = await loginResponse.text().catch(() => '');

      if (loginResponse.ok) {
        const cookieHeader = extractSessionCookieHeader(loginResponse);

        if (cookieHeader) {
          sessionRetryAttempt = await attemptModelUnload(endpoint, {
            ...buildApiKeyHeaders(authKeyForLogin),
            Cookie: cookieHeader,
          });
        } else {
          sessionRetryAttempt = {
            ok: false,
            endpoint,
            message:
              'Admin login succeeded, but no session cookie was returned by the server.',
          };
        }
      } else {
        sessionRetryAttempt = {
          ok: false,
          endpoint: `${adminBaseUrl}/admin/api/login`,
          status: loginResponse.status,
          message: loginMessage || 'Admin login failed',
        };
      }
    } catch (error) {
      sessionRetryAttempt = {
        ok: false,
        endpoint: `${adminBaseUrl}/admin/api/login`,
        message: error instanceof Error ? error.message : String(error),
      };
    }

    if (sessionRetryAttempt?.ok) {
      return {
        attempted: true,
        ok: true,
        modelId,
        endpoint: sessionRetryAttempt.endpoint,
        status: sessionRetryAttempt.status,
        message: sessionRetryAttempt.message,
      };
    }
  }

  const combinedMessage = [
    publicAttempt.status
      ? `v1 unload failed (${publicAttempt.status})${publicAttempt.message ? `: ${publicAttempt.message}` : ''}`
      : publicAttempt.message
        ? `v1 unload error: ${publicAttempt.message}`
        : null,
    adminAttempt.status
      ? `admin unload failed (${adminAttempt.status})${adminAttempt.message ? `: ${adminAttempt.message}` : ''}`
      : adminAttempt.message
        ? `admin unload error: ${adminAttempt.message}`
        : null,
    sessionRetryAttempt
      ? sessionRetryAttempt.status
        ? `admin session flow failed (${sessionRetryAttempt.status})${sessionRetryAttempt.message ? `: ${sessionRetryAttempt.message}` : ''}`
        : sessionRetryAttempt.message
          ? `admin session flow error: ${sessionRetryAttempt.message}`
          : null
      : null,
  ]
    .filter(Boolean)
    .join(' | ');

  return {
    attempted: true,
    ok: false,
    modelId,
    endpoint,
    status: sessionRetryAttempt?.status ?? adminAttempt.status,
    message: combinedMessage || 'Failed to unload local model',
  };
};
