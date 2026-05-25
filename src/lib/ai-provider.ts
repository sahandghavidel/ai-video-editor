import OpenAI from 'openai';

export type AIProvider = 'online' | 'local';

export type AIProviderRequestBody = {
  provider?: unknown;
  localEndpoint?: unknown;
  localApiKey?: unknown;
};

const OPENROUTER_BASE_URL = 'https://openrouter.ai/api/v1';
const DEFAULT_LOCAL_BASE_URL = 'http://127.0.0.1:9573/v1';

const AI_PROVIDER_COOKIE_NAME = 'uve_ai_provider';
const AI_LOCAL_ENDPOINT_COOKIE_NAME = 'uve_ai_local_endpoint';
const AI_LOCAL_API_KEY_COOKIE_NAME = 'uve_ai_local_api_key';

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

  return {
    provider,
    localEndpoint,
    localApiKey,
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
