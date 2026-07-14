import { getBaserowToken, buildAuthHeader } from '@/lib/baserow-auth';

export type BaserowRow = {
  id: number;
  [key: string]: unknown;
};

export type ThumbnailVariant = 1 | 2 | 3;

export type ThumbnailVariantConfig = {
  variant: ThumbnailVariant;
  fieldKey: string;
};

export type ThumbnailTaskResult = {
  variant: ThumbnailVariant;
  fieldKey: string;
  taskId?: string;
  imageUrl?: string;
  skipped?: boolean;
  error?: string;
};

const ORIGINAL_VIDEOS_TABLE_ID = 713;
const KIE_API_BASE = 'https://api.kie.ai/api/v1';
const KIE_MODEL = 'gpt-image-2-text-to-image';
const KIE_IMAGE_TO_IMAGE_MODEL = 'gpt-image-2-image-to-image';
export const THUMBNAIL_POLL_INTERVAL_MS = 3000;
export const THUMBNAIL_MAX_WAIT_MS = 15 * 60 * 1000;

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

function getKieApiKey(): string {
  const key = process.env.KIE_API_KEY;
  if (!key) {
    throw new Error('Missing KIE_API_KEY');
  }
  return key;
}

async function baserowGetJson<T>(pathName: string) {
  const baserowUrl = process.env.BASEROW_API_URL;
  if (!baserowUrl) {
    throw new Error('Missing Baserow URL');
  }

  const token = await getBaserowToken();

  const res = await fetch(`${baserowUrl}${pathName}`, {
    method: 'GET',
    headers: {
      ...buildAuthHeader(token),
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

  const token = await getBaserowToken();

  const res = await fetch(`${baserowUrl}${pathName}`, {
    method: 'PATCH',
    headers: {
      ...buildAuthHeader(token),
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

export function extractUrlFromField(raw: unknown): string {
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

export function getThumbnailVariantConfig(
  variant: number,
): ThumbnailVariantConfig {
  if (variant === 1) {
    return { variant: 1, fieldKey: 'field_7100' };
  }

  if (variant === 2) {
    return { variant: 2, fieldKey: 'field_7101' };
  }

  if (variant === 3) {
    return { variant: 3, fieldKey: 'field_7102' };
  }

  throw new Error('Invalid thumbnail variant. Expected 1, 2, or 3.');
}

function extractTextFromField(raw: unknown): string {
  if (typeof raw === 'string') return raw.trim();

  if (typeof raw === 'number' || typeof raw === 'boolean') {
    return String(raw).trim();
  }

  if (Array.isArray(raw)) {
    return raw
      .map((item) => extractTextFromField(item))
      .filter(Boolean)
      .join('\n')
      .trim();
  }

  if (raw && typeof raw === 'object') {
    const obj = raw as Record<string, unknown>;
    const candidate = obj.value ?? obj.name ?? obj.text ?? obj.title;
    return extractTextFromField(candidate);
  }

  return '';
}

function cleanTitleLine(line: string): string {
  return line
    .replace(/^\s*\d+[\).:-]?\s*/, '')
    .replace(/^\s*[-*]\s*/, '')
    .trim();
}

function pickFirstTitle(rawTitle: unknown): string {
  return extractTextFromField(rawTitle)
    .split('\n')
    .map(cleanTitleLine)
    .find(Boolean) ?? '';
}

function buildThumbnailPrompt(
  videoTitle: string,
  videoDescription: string,
): string {
  const clippedTitle = videoTitle.trim().slice(0, 500);
  const clippedDescription = videoDescription.trim().slice(0, 4000);

  return `Create a very clickable, shiny, branded YouTube thumbnail in 16:9

Video title:
${clippedTitle}

Video description:
${clippedDescription}

Brand style:
Use a consistent brand style: dark navy/black background, yellow/gold, electric blue glow, white bold text. The thumbnail should look premium, modern, shiny, and high-contrast, like a top coding education channel.

Main text:
Use only 3 to 6 big words maximum. Make the text extremely large, bold, readable on mobile, and very easy to understand in one second. Use white and yellow/gold text with electric blue shadows/glow. Choose the most clickable words from the video topic.

Layout:
Use a repeatable layout:
- Big main text on the left or center-left
- Yellow/gold banner behind the most important word
- One huge shiny topic icon or object on the right
- Small row of 3 to 4 clean feature icons at the bottom

Design details:
Use glossy 3D text, strong shadows, neon blue rim lights, yellow highlights, lens flares, clean spacing, and a dark tech background. Make it exciting, beginner-friendly, and professional.

Important:
Do not use random colors. Keep the brand colors consistent: dark navy/black, yellow/gold, electric blue, and white. Avoid clutter. Avoid too many small words. Make the main text and main icon the strongest parts of the image.`;
}

function getThumbnailPromptForVideo(video: BaserowRow): string {
  const titleFromMetadata = pickFirstTitle(video.field_6870);
  const titleFromOriginal = pickFirstTitle(video.field_6852);
  const videoTitle = titleFromMetadata || titleFromOriginal;

  const descriptionFromMetadata = extractTextFromField(video.field_6869);
  const script = extractTextFromField(video.field_6854);
  const videoDescription = descriptionFromMetadata || script;

  if (!videoTitle && !videoDescription) {
    throw new Error(
      'Video title, YouTube description, or Script is required for thumbnail generation',
    );
  }

  return buildThumbnailPrompt(videoTitle, videoDescription);
}

export async function fetchOriginalVideoForThumbnail(videoId: number) {
  return baserowGetJson<BaserowRow>(
    `/database/rows/table/${ORIGINAL_VIDEOS_TABLE_ID}/${videoId}/`,
  );
}

async function createGptImageTask(prompt: string): Promise<string> {
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
        aspect_ratio: '16:9',
        resolution: '1K',
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

export async function createGptImageToImageTask(
  prompt: string,
  inputUrl: string,
): Promise<string> {
  const apiKey = getKieApiKey();

  if (!inputUrl.startsWith('http')) {
    throw new Error('Image-to-image input URL must be a hosted http URL');
  }

  const response = await fetch(`${KIE_API_BASE}/jobs/createTask`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: KIE_IMAGE_TO_IMAGE_MODEL,
      input: {
        prompt,
        input_urls: [inputUrl],
        aspect_ratio: '16:9',
        resolution: '1K',
      },
    }),
  });

  if (!response.ok) {
    const t = await response.text().catch(() => '');
    throw new Error(`Kie image-to-image createTask failed: ${response.status} ${t}`);
  }

  const json = (await response
    .json()
    .catch(() => null)) as KieCreateTaskResponse | null;
  const taskId = json?.data?.taskId;
  if (typeof taskId !== 'string' || !taskId.trim()) {
    throw new Error(
      `Kie image-to-image createTask returned no taskId (${json?.msg ?? ''})`,
    );
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

export async function fetchGptImageResult(taskId: string) {
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

export async function createThumbnailTaskForVariant(
  video: BaserowRow,
  cfg: ThumbnailVariantConfig,
  forceRegenerate: boolean,
): Promise<ThumbnailTaskResult> {
  const existingThumbnailUrl = extractUrlFromField(video[cfg.fieldKey]);
  if (existingThumbnailUrl && !forceRegenerate) {
    return {
      variant: cfg.variant,
      fieldKey: cfg.fieldKey,
      imageUrl: existingThumbnailUrl,
      skipped: true,
    };
  }

  const prompt = getThumbnailPromptForVideo(video);
  const taskId = await createGptImageTask(prompt);

  return {
    variant: cfg.variant,
    fieldKey: cfg.fieldKey,
    taskId,
  };
}

export async function saveThumbnailResult(
  videoId: number,
  fieldKey: string,
  imageUrl: string,
) {
  if (!imageUrl.startsWith('http')) {
    throw new Error(
      'GPT Image 2 returned a non-http imageUrl. Please configure it to return a hosted URL.',
    );
  }

  await baserowPatchJson(
    `/database/rows/table/${ORIGINAL_VIDEOS_TABLE_ID}/${videoId}/`,
    {
      [fieldKey]: imageUrl,
    },
  );
}

export async function waitForThumbnailTask(taskId: string): Promise<string> {
  let lastState: string | null = null;
  const pollStart = Date.now();

  while (Date.now() - pollStart < THUMBNAIL_MAX_WAIT_MS) {
    const pollResult = await fetchGptImageResult(taskId);
    lastState = pollResult.state;

    if (pollResult.state === 'fail') {
      throw new Error(
        `GPT Image 2 task failed: ${pollResult.failMsg || 'Unknown failure'}`,
      );
    }

    if (pollResult.imageUrl) {
      return pollResult.imageUrl;
    }

    await new Promise((resolve) =>
      setTimeout(resolve, THUMBNAIL_POLL_INTERVAL_MS),
    );
  }

  throw new Error(
    `GPT Image 2 task timed out without a result (taskId=${taskId}, lastState=${lastState ?? 'unknown'})`,
  );
}

export async function generateThumbnailVariant(options: {
  videoId: number;
  variant: number;
  forceRegenerate: boolean;
}): Promise<ThumbnailTaskResult> {
  getKieApiKey();

  const cfg = getThumbnailVariantConfig(options.variant);
  const video = await fetchOriginalVideoForThumbnail(options.videoId);
  const task = await createThumbnailTaskForVariant(
    video,
    cfg,
    options.forceRegenerate,
  );

  if (task.skipped || !task.taskId) {
    return task;
  }

  const imageUrl = await waitForThumbnailTask(task.taskId);
  await saveThumbnailResult(options.videoId, task.fieldKey, imageUrl);

  return {
    ...task,
    imageUrl,
  };
}
