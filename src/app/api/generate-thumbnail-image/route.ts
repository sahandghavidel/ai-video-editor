// Nano Banana thumbnail generation for Original Videos table.
// Stores provider-returned hosted URL directly into Baserow fields:
// - field_7100 (Thumbnail 1)
// - field_7101 (Thumbnail 2)
// - field_7102 (Thumbnail 3)

import { randomInt } from 'crypto';

type BaserowRow = {
  id: number;
  [key: string]: unknown;
};

const ORIGINAL_VIDEOS_TABLE_ID = 713;
const KIE_API_BASE = 'https://api.kie.ai/api/v1';
const KIE_MODEL = 'google/nano-banana-edit';
const KIE_POLL_INTERVAL_MS = 3000;
const KIE_MAX_WAIT_MS = 600000;

function parseKieCharacterImageUrls(raw: string | undefined): string[] {
  const s = String(raw ?? '').trim();
  if (!s) return [];

  if (s.startsWith('[')) {
    try {
      const parsed = JSON.parse(s) as unknown;
      if (Array.isArray(parsed)) {
        return parsed
          .filter((v): v is string => typeof v === 'string')
          .map((v) => v.trim())
          .filter((v) => v.length > 0)
          .filter((v) => v.startsWith('http://') || v.startsWith('https://'));
      }
    } catch {
      // fall through to delimiter parsing
    }
  }

  return s
    .split(/[\s,;\n\r]+/g)
    .map((v) => v.trim())
    .filter((v) => v.length > 0)
    .filter((v) => v.startsWith('http://') || v.startsWith('https://'));
}

function pickRandom<T>(arr: T[]): T {
  if (arr.length === 0) throw new Error('pickRandom called with empty array');
  return arr[randomInt(arr.length)] as T;
}

function getKieApiKey(): string {
  const key = process.env.KIE_API_KEY;
  if (!key) {
    throw new Error('Missing KIE_API_KEY');
  }
  return key;
}

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
    const errorText = await response.text().catch(() => '');
    throw new Error(`Authentication failed: ${response.status} ${errorText}`);
  }

  const data = (await response.json().catch(() => null)) as {
    token?: string;
  } | null;

  if (!data?.token) {
    throw new Error('Authentication failed: missing token');
  }

  return data.token;
}

async function baserowGetJson<T>(pathName: string) {
  const baserowUrl = process.env.BASEROW_API_URL;
  if (!baserowUrl) {
    throw new Error('Missing Baserow URL');
  }

  const token = await getJWTToken();

  const res = await fetch(`${baserowUrl}${pathName}`, {
    method: 'GET',
    headers: {
      Authorization: `JWT ${token}`,
    },
  });

  if (!res.ok) {
    const t = await res.text().catch(() => '');
    throw new Error(`Baserow GET failed: ${res.status} ${t}`);
  }

  return (await res.json()) as T;
}

async function baserowPatchJson<T>(
  pathName: string,
  body: Record<string, unknown>,
) {
  const baserowUrl = process.env.BASEROW_API_URL;
  if (!baserowUrl) {
    throw new Error('Missing Baserow URL');
  }

  const token = await getJWTToken();

  const res = await fetch(`${baserowUrl}${pathName}`, {
    method: 'PATCH',
    headers: {
      Authorization: `JWT ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const t = await res.text().catch(() => '');
    throw new Error(`Baserow PATCH failed: ${res.status} ${t}`);
  }

  return (await res.json().catch(() => null)) as T;
}

function extractUrlFromField(raw: unknown): string {
  if (typeof raw === 'string') return raw.trim();
  if (!raw) return '';

  if (Array.isArray(raw) && raw.length > 0) {
    return extractUrlFromField(raw[0]);
  }

  if (typeof raw === 'object') {
    const obj = raw as Record<string, unknown>;
    const url = obj.url ?? (obj.file as { url?: unknown } | undefined)?.url;
    if (typeof url === 'string') return url.trim();
  }

  return String(raw).trim();
}

type ThumbnailVariant = 1 | 2 | 3;

type ThumbnailVariantConfig = {
  variant: ThumbnailVariant;
  fieldKey: string;
  maxWords: number;
};

function getThumbnailVariantConfig(variant: number): ThumbnailVariantConfig {
  if (variant === 1) {
    return { variant: 1, fieldKey: 'field_7100', maxWords: 2 };
  }

  if (variant === 2) {
    return { variant: 2, fieldKey: 'field_7101', maxWords: 3 };
  }

  if (variant === 3) {
    return { variant: 3, fieldKey: 'field_7102', maxWords: 5 };
  }

  throw new Error('Invalid thumbnail variant. Expected 1, 2, or 3.');
}

function buildThumbnailPrompt(
  script: string,
  cfg: ThumbnailVariantConfig,
): string {
  const clippedScript = script.trim().slice(0, 4000);

  return `Create a cinematic, high-contrast YouTube thumbnail in 16:9 ratio.

Use the provided reference image for the character. Keep the exact same character design, hairstyle, face, outfit (blue hoodie, white shirt, red pants, boots, chain), proportions, and cartoon style. Do not redesign the character — only change facial expression and pose while keeping him clearly the same person.

do it for this YouTube script:

"${clippedScript}"

Style: high contrast, dramatic lighting, clean composition, minimal clutter, strong emotional storytelling, optimised for high YouTube CTR. Keep the character large and clearly visible. use bold and big texts if needed and AVOID using too many texts. USE MAX ${cfg.maxWords} words`;
}

type KieCreateTaskResponse = {
  code?: number;
  msg?: string;
  data?: { taskId?: string };
};

type KieRecordInfoResponse = {
  code?: number;
  msg?: string;
  data?: {
    taskId?: string;
    model?: string;
    state?: 'waiting' | 'success' | 'fail' | string;
    resultJson?: string;
    failMsg?: string | null;
  };
};

async function createNanoBananaTask(
  prompt: string,
  imageUrls: string[],
): Promise<string> {
  const apiKey = getKieApiKey();

  const response = await fetch(`${KIE_API_BASE}/jobs/createTask`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: KIE_MODEL,
      input: {
        prompt,
        image_urls: imageUrls,
        output_format: 'png',
        image_size: '16:9',
      },
    }),
  });

  if (!response.ok) {
    const t = await response.text().catch(() => '');
    throw new Error(`Kie createTask failed: ${response.status} ${t}`);
  }

  const json = (await response
    .json()
    .catch(() => null)) as KieCreateTaskResponse | null;
  const taskId = json?.data?.taskId;
  if (typeof taskId !== 'string' || !taskId.trim()) {
    throw new Error(`Kie createTask returned no taskId (${json?.msg ?? ''})`);
  }

  return taskId;
}

function extractFirstUrlFromString(value: string): string | null {
  const normalized = value.replace(/\\\//g, '/');
  const match = normalized.match(/https?:\/\/[^\s"'<>]+/i);
  return match ? match[0] : null;
}

function extractResultUrl(resultJson: unknown): string | null {
  if (!resultJson) return null;

  let parsed: unknown = resultJson;
  let depth = 0;
  while (typeof parsed === 'string' && depth < 2) {
    const urlCandidate = extractFirstUrlFromString(parsed);
    if (urlCandidate) return urlCandidate;

    try {
      parsed = JSON.parse(parsed) as unknown;
    } catch {
      return null;
    }
    depth += 1;
  }

  if (Array.isArray(parsed)) {
    const first = parsed.find(
      (item) => typeof item === 'string' && item.trim(),
    );
    return typeof first === 'string' ? first : null;
  }

  if (!parsed || typeof parsed !== 'object') {
    return null;
  }

  const candidate = parsed as {
    resultUrls?: unknown;
    resultUrl?: unknown;
    result_url?: unknown;
    url?: unknown;
    output?: unknown;
    data?: unknown;
    resultJson?: unknown;
  };

  if (candidate.resultJson) {
    const nested = extractResultUrl(candidate.resultJson);
    if (nested) return nested;
  }

  if (typeof candidate.resultUrl === 'string' && candidate.resultUrl.trim()) {
    return candidate.resultUrl;
  }

  if (typeof candidate.result_url === 'string' && candidate.result_url.trim()) {
    return candidate.result_url;
  }

  if (typeof candidate.url === 'string' && candidate.url.trim()) {
    return candidate.url;
  }

  if (Array.isArray(candidate.resultUrls)) {
    const firstUrl = candidate.resultUrls.find(
      (u) => typeof u === 'string' && u.trim(),
    );
    if (typeof firstUrl === 'string') return firstUrl;
  }

  if (Array.isArray(candidate.output)) {
    const first = candidate.output.find(
      (item) => item && typeof item === 'object' && 'url' in item,
    ) as { url?: unknown } | undefined;
    if (first && typeof first.url === 'string' && first.url.trim()) {
      return first.url;
    }
  }

  if (candidate.data) {
    return extractResultUrl(candidate.data);
  }

  return null;
}

async function fetchNanoBananaResult(taskId: string) {
  const apiKey = getKieApiKey();

  const response = await fetch(
    `${KIE_API_BASE}/jobs/recordInfo?taskId=${encodeURIComponent(taskId)}`,
    {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${apiKey}`,
      },
    },
  );

  if (!response.ok) {
    const t = await response.text().catch(() => '');
    throw new Error(`Kie recordInfo failed: ${response.status} ${t}`);
  }

  const json = (await response
    .json()
    .catch(() => null)) as KieRecordInfoResponse | null;

  const state = json?.data?.state ?? null;
  const failMsg = json?.data?.failMsg ?? null;
  const resultJson = json?.data?.resultJson ?? null;

  return {
    state,
    failMsg,
    imageUrl:
      state === 'success'
        ? extractResultUrl(resultJson ?? json?.data ?? json)
        : null,
  };
}

export async function POST(req: Request) {
  try {
    getKieApiKey();

    const body = (await req.json().catch(() => null)) as {
      videoId?: unknown;
      variant?: unknown;
    } | null;

    const videoId =
      typeof body?.videoId === 'number' ? body.videoId : Number(body?.videoId);
    const variant =
      typeof body?.variant === 'number' ? body.variant : Number(body?.variant);

    if (!Number.isFinite(videoId) || videoId <= 0) {
      return Response.json({ error: 'videoId is required' }, { status: 400 });
    }

    let cfg: ThumbnailVariantConfig;
    try {
      cfg = getThumbnailVariantConfig(variant);
    } catch (error) {
      return Response.json(
        {
          error: error instanceof Error ? error.message : 'Invalid variant',
        },
        { status: 400 },
      );
    }

    const video = await baserowGetJson<BaserowRow>(
      `/database/rows/table/${ORIGINAL_VIDEOS_TABLE_ID}/${videoId}/`,
    );

    const script =
      typeof video.field_6854 === 'string' ? video.field_6854.trim() : '';

    if (!script) {
      return Response.json(
        {
          error: 'Script (field_6854) is required for thumbnail generation',
        },
        { status: 400 },
      );
    }

    const existingValue = video[cfg.fieldKey as keyof BaserowRow];
    const existingThumbnailUrl = extractUrlFromField(existingValue);
    if (existingThumbnailUrl) {
      return Response.json({
        skipped: true,
        imageUrl: existingThumbnailUrl,
        fieldKey: cfg.fieldKey,
      });
    }

    const prompt = buildThumbnailPrompt(script, cfg);

    const characterImageUrls = parseKieCharacterImageUrls(
      process.env.KIE_CHARACTER_IMAGE_URL,
    );

    if (characterImageUrls.length === 0) {
      return Response.json(
        {
          error:
            'Missing KIE_CHARACTER_IMAGE_URL (Nano Banana Edit requires at least one image URL in input.image_urls).',
        },
        { status: 400 },
      );
    }

    const selectedCharacterImageUrl = pickRandom(characterImageUrls);

    const taskId = await createNanoBananaTask(prompt, [
      selectedCharacterImageUrl,
    ]);

    let imageUrl = '';
    let lastState: string | null = null;

    const pollStart = Date.now();
    while (Date.now() - pollStart < KIE_MAX_WAIT_MS) {
      const pollResult = await fetchNanoBananaResult(taskId);
      lastState = pollResult.state;

      if (pollResult.state === 'fail') {
        throw new Error(
          `Nano Banana task failed: ${pollResult.failMsg || 'Unknown failure'}`,
        );
      }

      if (pollResult.imageUrl) {
        imageUrl = pollResult.imageUrl;
        break;
      }

      await new Promise((resolve) => setTimeout(resolve, KIE_POLL_INTERVAL_MS));
    }

    if (!imageUrl) {
      throw new Error(
        `Nano Banana task timed out without a result (taskId=${taskId}, lastState=${lastState ?? 'unknown'})`,
      );
    }

    if (!imageUrl.startsWith('http')) {
      throw new Error(
        'Nano Banana returned a non-http imageUrl. Please configure it to return a hosted URL.',
      );
    }

    await baserowPatchJson(
      `/database/rows/table/${ORIGINAL_VIDEOS_TABLE_ID}/${videoId}/`,
      {
        [cfg.fieldKey]: imageUrl,
      },
    );

    return Response.json({
      imageUrl,
      fieldKey: cfg.fieldKey,
      variant: cfg.variant,
      maxWords: cfg.maxWords,
    });
  } catch (error) {
    console.error('Error generating thumbnail image:', error);
    return Response.json(
      {
        error: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 },
    );
  }
}
