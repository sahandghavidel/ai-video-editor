// GPT Image 2 scene generation: store the provider-returned URL directly.
// We intentionally avoid re-uploading the generated image to MinIO.

import { getBaserowToken, buildAuthHeader } from '@/lib/baserow-auth';

type BaserowRow = {
  id: number;
  [key: string]: unknown;
};

const SCENES_TABLE_ID = 714;
const IMAGE_FIELD_KEY = 'field_7094'; // Image for Scene (7094)
const KIE_API_BASE = 'https://api.kie.ai/api/v1';
const KIE_MODEL = 'gpt-image-2-text-to-image';
const CONTEXT_SCENES_BEFORE = 50;
const CONTEXT_SCENES_AFTER = 50;
const RETRY_CONTEXT_SCENES_BEFORE = Math.max(
  1,
  Math.floor(CONTEXT_SCENES_BEFORE / 2),
);
const RETRY_CONTEXT_SCENES_AFTER = Math.max(
  1,
  Math.floor(CONTEXT_SCENES_AFTER / 2),
);
const KIE_POLL_INTERVAL_MS = 3000;
const KIE_MAX_WAIT_MS = 300000;

async function baserowGetJson<T>(
  pathName: string,
  query?: Record<string, string>,
) {
  const baserowUrl = process.env.BASEROW_API_URL;
  if (!baserowUrl) {
    throw new Error('Missing Baserow URL');
  }

  const token = await getBaserowToken();
  const url = new URL(`${baserowUrl}${pathName}`);
  if (query) {
    for (const [key, value] of Object.entries(query)) {
      url.searchParams.set(key, value);
    }
  }

  const res = await fetch(url.toString(), {
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

function extractLinkedVideoId(field: unknown): number | null {
  const tryExtractId = (obj: unknown): number | null => {
    if (!obj || typeof obj !== 'object') return null;
    if (!('id' in obj)) return null;
    const rawId = (obj as { id?: unknown }).id;
    if (typeof rawId === 'number' && Number.isFinite(rawId)) return rawId;
    if (typeof rawId === 'string') {
      const n = Number(rawId);
      return Number.isFinite(n) ? n : null;
    }
    return null;
  };

  if (typeof field === 'number' && Number.isFinite(field)) return field;
  if (typeof field === 'string') {
    const n = Number(field);
    return Number.isFinite(n) ? n : null;
  }

  if (Array.isArray(field) && field.length > 0) {
    const first = field[0] as unknown;
    if (typeof first === 'number' && Number.isFinite(first)) return first;
    if (typeof first === 'string') {
      const n = Number(first);
      return Number.isFinite(n) ? n : null;
    }
    const extracted = tryExtractId(first);
    if (extracted) return extracted;
  }

  const extracted = tryExtractId(field);
  if (extracted) return extracted;

  return null;
}

function getSceneText(scene: BaserowRow): string {
  // Sentence (6890) is the canonical scene text.
  const value = scene['field_6890'];

  if (typeof value === 'string') return value;
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);

  if (Array.isArray(value) && value.length > 0) {
    const first = value[0];
    if (typeof first === 'string') return first;
    if (typeof first === 'number' && Number.isFinite(first))
      return String(first);
    if (typeof first === 'object' && first !== null) {
      const obj = first as { value?: unknown; text?: unknown; name?: unknown };
      const nested = obj.value ?? obj.text ?? obj.name;
      if (typeof nested === 'string') return nested;
      if (typeof nested === 'number' && Number.isFinite(nested))
        return String(nested);
    }
  }

  if (typeof value === 'object' && value !== null) {
    const obj = value as { value?: unknown; text?: unknown; name?: unknown };
    const nested = obj.value ?? obj.text ?? obj.name;
    if (typeof nested === 'string') return nested;
    if (typeof nested === 'number' && Number.isFinite(nested))
      return String(nested);
  }

  return '';
}

function formatScriptLine(scene: BaserowRow): string {
  const text = getSceneText(scene).trim();
  return `${scene.id} ${text}`.trim();
}

function getSceneOrderValue(scene: BaserowRow): number {
  const raw = scene.order;
  if (typeof raw === 'number' && Number.isFinite(raw)) return raw;
  if (typeof raw === 'string') {
    const parsed = Number(raw);
    if (Number.isFinite(parsed)) return parsed;
  }
  return scene.id;
}

function sortScenesByTimeline(a: BaserowRow, b: BaserowRow): number {
  const orderA = getSceneOrderValue(a);
  const orderB = getSceneOrderValue(b);
  if (orderA !== orderB) return orderA - orderB;
  return (a.id ?? 0) - (b.id ?? 0);
}

function isPromptTooLongError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error ?? '');
  return /prompt\s*exceeds\s*maximum\s*length/i.test(message);
}

function buildSceneImagePrompt(params: {
  sceneId: number;
  currentText: string;
  contextScript: string;
  contextBefore: number;
  contextAfter: number;
}): string {
  const { sceneId, currentText, contextScript, contextBefore, contextAfter } =
    params;

  return `You are a professional editorial illustrator creating visuals for educational video scenes.

Analyze the current scene and its surrounding script context. Create one clear 16:9 visual that communicates the specific idea being spoken in the current scene.

Visual concept:
Represent one clear idea using one main subject and no more than two supporting elements. Use a relevant object, environment, interface, diagram, symbol, tool, or simple visual metaphor. Do not default to showing a presenter or recurring character.

Include a person only when a human action or emotion is essential to explaining the scene. If a person is included, treat them as a scene-specific supporting subject. Do not imply that their appearance must match people in other scenes.

Visual style:
Create a simple, carefully art-directed editorial illustration. Use clean shapes, restrained detail, balanced spacing, generous negative space, matte materials, soft natural shadows, and simple believable geometry. Keep the main subject large and immediately understandable.

The image should feel intentionally designed by a human illustrator. Avoid excessive detail, random background objects, glossy 3D rendering, exaggerated cinematic lighting, lens flares, floating particles, unnecessary neon effects, distorted anatomy, surreal object combinations, and decorative technology that does not help explain the scene.

Color direction:
Use the channel colors as restrained art direction, not as a strict color filter. Choose either dark navy or warm off-white as the main background. Use warm gold only to guide attention toward the most important subject. Add muted electric blue only when it improves separation or clarity.

Allow realistic, softly muted colors for people, objects, and environments so the image feels natural and thoughtfully illustrated. Do not recolor every object navy, gold, or blue. Avoid heavy neon glow, excessive contrast, metallic gold surfaces, and overly dark scenes.

Important exclusions:
Do not include logos, channel names, brand marks, watermarks, promotional text, title cards, banners, thumbnail layouts, feature-icon rows, or other overt branding. Avoid unnecessary written text. This must look like a clean editorial scene illustration, not a YouTube thumbnail.

Current scene:
Scene ${sceneId}: ${currentText}

Surrounding script context (${contextBefore} before / ${contextAfter} after):
${contextScript}

Generate only the visual for the current scene. Use the surrounding context only to understand its meaning and continuity. Do not combine multiple scenes into one image.`;
}

function getKieApiKey(): string {
  const key = process.env.KIE_API_KEY;
  if (!key) {
    throw new Error('Missing KIE_API_KEY');
  }
  return key;
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
    param?: string;
    resultJson?: string;
    failCode?: string | null;
    failMsg?: string | null;
    costTime?: number | null;
    completeTime?: number | null;
    createTime?: number | null;
  };
};

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
    throw new Error(
      `Kie createTask returned no taskId (${json?.msg ?? 'no msg'})`,
    );
  }

  return taskId;
}

type GptImagePollResult = {
  imageUrl: string | null;
  state: string | null;
  failMsg: string | null;
  rawResultJson: unknown;
};

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

async function fetchGptImageResult(taskId: string): Promise<GptImagePollResult> {
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

  if (state === 'fail') {
    const failMsg = json?.data?.failMsg || json?.msg || 'Unknown failure';
    return {
      imageUrl: null,
      state,
      failMsg,
      rawResultJson: json?.data?.resultJson ?? null,
    };
  }

  const resultJson = json?.data?.resultJson ?? null;
  const extracted =
    state === 'success'
      ? extractResultUrl(resultJson ?? json?.data ?? json)
      : null;

  if (state === 'success' && !extracted && resultJson) {
    const snippet =
      typeof resultJson === 'string'
        ? resultJson.slice(0, 200)
        : JSON.stringify(resultJson).slice(0, 200);
    console.warn(
      `GPT Image 2 success with no URL yet (taskId=${taskId}). resultJson snippet: ${snippet}`,
    );
  }

  return {
    imageUrl: extracted,
    state,
    failMsg: null,
    rawResultJson: resultJson ?? json?.data ?? json,
  };
}

export async function POST(req: Request) {
  try {
    getKieApiKey();

    const body = (await req.json().catch(() => null)) as {
      sceneId?: unknown;
    } | null;

    const sceneId =
      typeof body?.sceneId === 'number' ? body.sceneId : Number(body?.sceneId);

    if (!Number.isFinite(sceneId) || sceneId <= 0) {
      return Response.json({ error: 'Scene ID is required' }, { status: 400 });
    }

    // Fetch current scene.
    const currentScene = await baserowGetJson<BaserowRow>(
      `/database/rows/table/${SCENES_TABLE_ID}/${sceneId}/`,
    );

    const videoId = extractLinkedVideoId(currentScene['field_6889']);

    // Fetch scenes for same video (best effort).
    let videoScenes: BaserowRow[] = [];
    if (videoId) {
      let pageNumber = 1;
      let hasMore = true;
      const allScenes: BaserowRow[] = [];

      while (hasMore) {
        const page = await baserowGetJson<{
          results?: BaserowRow[];
          next?: string | null;
        }>(`/database/rows/table/${SCENES_TABLE_ID}/`, {
          [`filter__field_6889__equal`]: String(videoId),
          size: '200',
          page: String(pageNumber),
        });

        const results = Array.isArray(page?.results) ? page.results : [];
        allScenes.push(...results);
        hasMore = Boolean(page?.next);
        pageNumber += 1;
      }

      videoScenes = allScenes;
    }

    if (!videoScenes.some((scene) => scene.id === currentScene.id)) {
      videoScenes.push(currentScene);
    }

    const orderedScenes = (videoScenes.length ? videoScenes : [currentScene])
      .slice()
      .sort(sortScenesByTimeline);

    const currentText = getSceneText(currentScene).trim();
    if (!currentText) {
      return Response.json(
        {
          error: 'Current scene is empty; cannot generate image',
        },
        { status: 400 },
      );
    }

    const currentSceneIndex = orderedScenes.findIndex(
      (scene) => scene.id === sceneId,
    );

    const buildContextScript = (before: number, after: number): string => {
      const contextWindowScenes =
        currentSceneIndex >= 0
          ? orderedScenes.slice(
              Math.max(0, currentSceneIndex - before),
              Math.min(orderedScenes.length, currentSceneIndex + after + 1),
            )
          : orderedScenes;

      const contextScenes = contextWindowScenes.filter((scene) =>
        Boolean(getSceneText(scene).trim()),
      );

      return contextScenes.map(formatScriptLine).join(' ');
    };

    const fullContextScript = buildContextScript(
      CONTEXT_SCENES_BEFORE,
      CONTEXT_SCENES_AFTER,
    );
    const trimmedContextScript = buildContextScript(
      RETRY_CONTEXT_SCENES_BEFORE,
      RETRY_CONTEXT_SCENES_AFTER,
    );

    const fullPrompt = buildSceneImagePrompt({
      sceneId,
      currentText,
      contextScript: fullContextScript,
      contextBefore: CONTEXT_SCENES_BEFORE,
      contextAfter: CONTEXT_SCENES_AFTER,
    });
    const trimmedPrompt = buildSceneImagePrompt({
      sceneId,
      currentText,
      contextScript: trimmedContextScript,
      contextBefore: RETRY_CONTEXT_SCENES_BEFORE,
      contextAfter: RETRY_CONTEXT_SCENES_AFTER,
    });

    let taskId = '';
    try {
      console.log(
        'generate-scene-image: sending prompt to GPT Image 2 (attempt 1, full context)',
      );
      console.log(fullPrompt);
      taskId = await createGptImageTask(fullPrompt);
    } catch (error) {
      if (!isPromptTooLongError(error)) {
        throw error;
      }

      console.warn(
        `generate-scene-image: first createTask failed due to prompt length. Retrying once with trimmed context (${RETRY_CONTEXT_SCENES_BEFORE} before / ${RETRY_CONTEXT_SCENES_AFTER} after).`,
      );
      console.log(
        'generate-scene-image: sending prompt to GPT Image 2 (attempt 2, trimmed context)',
      );
      console.log(trimmedPrompt);

      taskId = await createGptImageTask(trimmedPrompt);
    }

    let imageUrl = '';
    let lastState: string | null = null;
    const pollStart = Date.now();
    while (Date.now() - pollStart < KIE_MAX_WAIT_MS) {
      const pollResult = await fetchGptImageResult(taskId);
      lastState = pollResult.state;

      if (pollResult.state === 'fail') {
        throw new Error(
          `GPT Image 2 task failed: ${pollResult.failMsg || 'Unknown failure'}`,
        );
      }

      if (pollResult.imageUrl) {
        imageUrl = pollResult.imageUrl;
        break;
      }

      if (pollResult.state === 'success') {
        console.warn(
          `GPT Image 2 reported success but no URL yet (taskId=${taskId}).`,
        );
      }

      await new Promise((resolve) => setTimeout(resolve, KIE_POLL_INTERVAL_MS));
    }

    if (!imageUrl) {
      throw new Error(
        `GPT Image 2 task timed out without a result (taskId=${taskId}, lastState=${
          lastState ?? 'unknown'
        })`,
      );
    }

    // The user wants us to store the URL returned by the image generation
    // service and NOT upload the image again to MinIO.
    if (!imageUrl.startsWith('http')) {
      // If the provider ever returns a data URL, we refuse rather than silently
      // re-uploading, since that violates the desired behavior.
      throw new Error(
        'GPT Image 2 returned a non-http imageUrl. Please configure it to return a hosted URL.',
      );
    }

    await baserowPatchJson(
      `/database/rows/table/${SCENES_TABLE_ID}/${sceneId}/`,
      {
        [IMAGE_FIELD_KEY]: imageUrl,
      },
    );

    return Response.json({ imageUrl });
  } catch (error) {
    console.error('Error generating scene image:', error);
    return Response.json(
      {
        error: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 },
    );
  }
}
