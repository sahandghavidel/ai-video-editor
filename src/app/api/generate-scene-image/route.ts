// Nano Banana image generation: store the provider-returned URL directly.
// We intentionally avoid re-uploading the generated image to MinIO.

import { randomInt } from 'crypto';

type BaserowRow = {
  id: number;
  [key: string]: unknown;
};

const SCENES_TABLE_ID = 714;
const IMAGE_FIELD_KEY = 'field_7094'; // Image for Scene (7094)
const KIE_API_BASE = 'https://api.kie.ai/api/v1';
// Nano Banana Edit model identifier (must match KIE API exactly)
const KIE_MODEL = 'google/nano-banana-edit';
const KIE_POLL_INTERVAL_MS = 3000;
// Allow more time for KIE Nano Banana jobs to complete (10 minutes).
const KIE_MAX_WAIT_MS = 600000;

function parseKieCharacterImageUrls(raw: string | undefined): string[] {
  const s = String(raw ?? '').trim();
  if (!s) return [];

  // Support JSON array: ["https://...", "https://..."]
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

  // Support comma/semicolon/newline/whitespace separated lists.
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

async function baserowGetJson<T>(
  pathName: string,
  query?: Record<string, string>,
) {
  const baserowUrl = process.env.BASEROW_API_URL;
  if (!baserowUrl) {
    throw new Error('Missing Baserow URL');
  }

  const token = await getJWTToken();
  const url = new URL(`${baserowUrl}${pathName}`);
  if (query) {
    for (const [key, value] of Object.entries(query)) {
      url.searchParams.set(key, value);
    }
  }

  const res = await fetch(url.toString(), {
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

async function createNanoBananaTask(
  prompt: string,
  imageUrls: string[],
  imageSize: string = '16:9',
  outputFormat: string = 'png',
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
        // Nano Banana Edit expects image URLs of the uploaded file(s)
        // (up to 10). We'll pass our reference image URL(s) here.
        image_urls: imageUrls,
        output_format: outputFormat,
        image_size: imageSize,
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

type NanoBananaPollResult = {
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
    } catch (error) {
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

async function fetchNanoBananaResult(
  taskId: string,
): Promise<NanoBananaPollResult> {
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
      `Nano Banana success with no URL yet (taskId=${taskId}). resultJson snippet: ${snippet}`,
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
      const page = await baserowGetJson<{ results: BaserowRow[] }>(
        `/database/rows/table/${SCENES_TABLE_ID}/`,
        {
          [`filter__field_6889__equal`]: String(videoId),
          size: '200',
        },
      );
      videoScenes = Array.isArray(page?.results) ? page.results : [];
    }

    const orderedScenes = (videoScenes.length ? videoScenes : [currentScene])
      .slice()
      .sort((a, b) => (a.id ?? 0) - (b.id ?? 0));

    const currentText = getSceneText(currentScene).trim();
    if (!currentText) {
      return Response.json(
        {
          error: 'Current scene is empty; cannot generate image',
        },
        { status: 400 },
      );
    }

    const contextScenes = orderedScenes.filter((scene) =>
      Boolean(getSceneText(scene).trim()),
    );
    const fullScript = contextScenes.map(formatScriptLine).join(' ');

    const prompt = `You are a professional image creator for video clips. Your task is to analyze the script I provide and convert each scene into a single, clear visual that communicates the idea being spoken.

  For each scene:
  Create a strong visual metaphor that explains the concept. Do not just show the character talking; show the character interacting with relevant objects, symbols, UI elements, diagrams, or metaphorical props (e.g., charts, clocks, ladders, puzzles, obstacles, tools). Keep the composition simple, large and readable.

  Style: high contrast, dramatic lighting, clean composition, minimal clutter, strong emotional storytelling, optimised for high YouTube CTR. Keep the character large and clearly visible.

  Use the provided reference image for the character. Keep the exact same character design, hairstyle, face, outfit (blue hoodie, white shirt, red pants, boots, chain), proportions, and cartoon style. Do not redesign the character — only change facial expression and pose while keeping him clearly the same person.

  Create an image for the current scene:

  current scene: ${sceneId} ${currentText} 
  
  
  Full script: ${fullScript}
  
  Create an image for the current scene:

  current scene: ${sceneId} ${currentText}`;

    console.log('generate-scene-image: sending prompt to Nano Banana Edit');
    console.log(prompt);

    const characterImageUrls = parseKieCharacterImageUrls(
      process.env.KIE_CHARACTER_IMAGE_URL,
    );
    const selectedCharacterImageUrl =
      characterImageUrls.length > 0 ? pickRandom(characterImageUrls) : null;
    const imageUrls = selectedCharacterImageUrl
      ? [selectedCharacterImageUrl]
      : [];

    // Nano Banana Edit requires at least 1 input image URL.
    if (imageUrls.length === 0) {
      return Response.json(
        {
          error:
            'Missing KIE_CHARACTER_IMAGE_URL (Nano Banana Edit requires at least one image URL in input.image_urls). You can set a single URL or a list (CSV/whitespace/JSON array).',
        },
        { status: 400 },
      );
    }

    if (selectedCharacterImageUrl) {
      console.log(
        `generate-scene-image: using character reference (${characterImageUrls.length} candidates): ${selectedCharacterImageUrl}`,
      );
    }

    const taskId = await createNanoBananaTask(prompt, imageUrls);

    let imageUrl = '';
    let lastState: string | null = null;
    let lastFailMsg: string | null = null;
    const pollStart = Date.now();
    while (Date.now() - pollStart < KIE_MAX_WAIT_MS) {
      const pollResult = await fetchNanoBananaResult(taskId);
      lastState = pollResult.state;
      lastFailMsg = pollResult.failMsg;

      if (pollResult.state === 'fail') {
        throw new Error(
          `Nano Banana task failed: ${pollResult.failMsg || 'Unknown failure'}`,
        );
      }

      if (pollResult.imageUrl) {
        imageUrl = pollResult.imageUrl;
        break;
      }

      if (pollResult.state === 'success') {
        console.warn(
          `Nano Banana reported success but no URL yet (taskId=${taskId}).`,
        );
      }

      await new Promise((resolve) => setTimeout(resolve, KIE_POLL_INTERVAL_MS));
    }

    if (!imageUrl) {
      throw new Error(
        `Nano Banana task timed out without a result (taskId=${taskId}, lastState=${
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
        'Nano Banana returned a non-http imageUrl. Please configure it to return a hosted URL.',
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
