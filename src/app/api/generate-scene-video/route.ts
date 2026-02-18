// KIE image-to-video generation: create a 6s 480p clip from the stored scene image URL
// and save the resulting video URL directly into Baserow.

import { createHash } from 'crypto';

type BaserowRow = {
  id: number;
  [key: string]: unknown;
};

const SCENES_TABLE_ID = 714;
const IMAGE_FIELD_KEY = 'field_7094'; // Image for Scene (7094)
const VIDEO_FIELD_KEY = 'field_7098'; // Video for Scene (7098)

function getImageSignatureFromUrl(imageUrl: string): string {
  // Stable across runs; changes when the scene image URL changes.
  return createHash('sha1').update(imageUrl).digest('hex').slice(0, 10);
}

function isSceneVideoForImage(videoUrl: string, imageSig: string): boolean {
  const lower = videoUrl.toLowerCase();
  const token = `_img_${imageSig.toLowerCase()}_`;
  try {
    const pathname = new URL(videoUrl).pathname;
    const filename = pathname.split('/').filter(Boolean).pop() ?? '';
    if (!filename) return lower.includes(token);
    return filename.toLowerCase().includes(token);
  } catch {
    return lower.includes(token);
  }
}

const MINIO_BUCKET = 'nca-toolkit';
const MINIO_HOST = 'http://host.docker.internal:9000';

const KIE_API_BASE = 'https://api.kie.ai/api/v1';
const KIE_MODEL = 'grok-imagine/image-to-video';

const KIE_POLL_INTERVAL_MS = 3000;
// Video tasks can take a while; allow up to 15 minutes.
const KIE_MAX_WAIT_MS = 15 * 60 * 1000;

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

function getSceneText(scene: BaserowRow): string {
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

function extractUrlFromBaserowField(raw: unknown): string {
  if (typeof raw === 'string') return raw.trim();
  if (!raw) return '';

  if (Array.isArray(raw) && raw.length > 0) {
    return extractUrlFromBaserowField(raw[0]);
  }

  if (typeof raw === 'object') {
    const obj = raw as Record<string, unknown>;
    const url = obj.url ?? (obj.file as { url?: unknown } | undefined)?.url;
    if (typeof url === 'string') return url.trim();
  }

  return String(raw).trim();
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

async function createImageToVideoTask(input: {
  prompt: string;
  imageUrl: string;
  duration?: string;
  resolution?: string;
  mode?: 'normal' | string;
}): Promise<string> {
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
        prompt: input.prompt,
        image_urls: [input.imageUrl],
        duration: input.duration ?? '6',
        resolution: input.resolution ?? '480p',
        mode: input.mode ?? 'normal',
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

function extractUrlsFromString(value: string): string[] {
  const normalized = value.replace(/\\\//g, '/');
  const matches = normalized.match(/https?:\/\/[^\s"'<>]+/gi);
  return Array.isArray(matches) ? matches : [];
}

function pickPreferredUrl(urls: string[]): string | null {
  const cleaned = urls.map((u) => u.trim()).filter(Boolean);
  if (cleaned.length === 0) return null;

  // Prefer MP4 if available.
  const mp4 = cleaned.find((u) => /\.mp4(\?|#|$)/i.test(u));
  if (mp4) return mp4;

  return cleaned[0] ?? null;
}

function extractResultUrl(resultJson: unknown): string | null {
  if (!resultJson) return null;

  let parsed: unknown = resultJson;
  let depth = 0;
  while (typeof parsed === 'string' && depth < 3) {
    const urlCandidate = pickPreferredUrl(extractUrlsFromString(parsed));
    if (urlCandidate) return urlCandidate;

    try {
      parsed = JSON.parse(parsed) as unknown;
    } catch {
      return null;
    }
    depth += 1;
  }

  if (Array.isArray(parsed)) {
    const urls = parsed
      .filter((item): item is string => typeof item === 'string')
      .map((s) => s.trim())
      .filter(Boolean);
    return pickPreferredUrl(urls);
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
    const urls = candidate.resultUrls
      .filter((u): u is string => typeof u === 'string')
      .map((u) => u.trim())
      .filter(Boolean);
    const preferred = pickPreferredUrl(urls);
    if (preferred) return preferred;
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

async function fetchKieRecordInfo(taskId: string): Promise<{
  state: string | null;
  url: string | null;
  failMsg: string | null;
  rawResultJson: unknown;
}> {
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
  const resultJson = json?.data?.resultJson ?? null;

  if (state === 'fail') {
    const failMsg = json?.data?.failMsg || json?.msg || 'Unknown failure';
    return { state, url: null, failMsg, rawResultJson: resultJson };
  }

  const extracted =
    state === 'success'
      ? extractResultUrl(resultJson ?? json?.data ?? json)
      : null;

  return {
    state,
    url: extracted,
    failMsg: null,
    rawResultJson: resultJson ?? json?.data ?? json,
  };
}

function buildVideoPrompt(sceneText: string): string {
  const cleaned = sceneText.trim();
  return `animate this with the concept of this: "${cleaned}"

Requirements:
- 6 seconds total
- No talking
- No background music
- No subtitles/captions
- No added words/text overlays
- Keep the original meaning; do not add extra elements that introduce new text`;
}

async function uploadVideoUrlToMinio(options: {
  sourceUrl: string;
  filename: string;
}): Promise<string> {
  const sourceRes = await fetch(options.sourceUrl);
  if (!sourceRes.ok) {
    const t = await sourceRes.text().catch(() => '');
    throw new Error(
      `Failed to download generated video (${sourceRes.status}) ${t}`,
    );
  }

  const contentType =
    sourceRes.headers.get('content-type')?.trim() || 'video/mp4';
  const arrayBuffer = await sourceRes.arrayBuffer();
  const buffer = Buffer.from(arrayBuffer);

  const uploadUrl = `${MINIO_HOST}/${MINIO_BUCKET}/${options.filename}`;
  const uploadRes = await fetch(uploadUrl, {
    method: 'PUT',
    headers: {
      'Content-Type': contentType,
    },
    body: buffer,
  });

  if (!uploadRes.ok) {
    const t = await uploadRes.text().catch(() => '');
    throw new Error(`MinIO upload error: ${uploadRes.status} ${t}`);
  }

  return uploadUrl;
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

    const scene = await baserowGetJson<BaserowRow>(
      `/database/rows/table/${SCENES_TABLE_ID}/${sceneId}/`,
    );

    const imageUrlRaw = scene[IMAGE_FIELD_KEY];
    const imageUrl = extractUrlFromBaserowField(imageUrlRaw);

    if (
      !imageUrl ||
      !(imageUrl.startsWith('http://') || imageUrl.startsWith('https://'))
    ) {
      return Response.json(
        { error: `Scene is missing a valid image URL in ${IMAGE_FIELD_KEY}` },
        { status: 400 },
      );
    }

    const sceneText = getSceneText(scene);
    if (!sceneText.trim()) {
      return Response.json(
        { error: 'Scene text is empty; cannot build video prompt' },
        { status: 400 },
      );
    }

    const imageSig = getImageSignatureFromUrl(imageUrl);

    // If we already created a video for THIS exact image (by signature), do not regenerate.
    const existingVideoUrlRaw = scene[VIDEO_FIELD_KEY];
    const existingVideoUrl = extractUrlFromBaserowField(existingVideoUrlRaw);

    if (
      existingVideoUrl &&
      (existingVideoUrl.startsWith('http://') ||
        existingVideoUrl.startsWith('https://')) &&
      isSceneVideoForImage(existingVideoUrl, imageSig)
    ) {
      return Response.json(
        {
          alreadyCreated: true,
          sceneId,
          imageUrl,
          imageSig,
          videoUrl: existingVideoUrl,
          message: 'Already video created for this image',
        },
        { status: 409 },
      );
    }

    const prompt = buildVideoPrompt(sceneText);

    console.log('generate-scene-video: creating KIE image-to-video task');
    console.log({
      sceneId,
      imageUrl,
      model: KIE_MODEL,
      duration: '6',
      resolution: '480p',
    });

    const taskId = await createImageToVideoTask({
      prompt,
      imageUrl,
      duration: '6',
      resolution: '480p',
      mode: 'normal',
    });

    const start = Date.now();
    let lastState: string | null = null;
    let lastUrl: string | null = null;
    let lastRaw: unknown = null;

    while (Date.now() - start < KIE_MAX_WAIT_MS) {
      const info = await fetchKieRecordInfo(taskId);
      lastState = info.state;
      lastUrl = info.url;
      lastRaw = info.rawResultJson;

      if (info.state === 'fail') {
        const msg = info.failMsg ?? 'Video generation failed';
        const retryable = /please try again later|internal error/i.test(msg);
        return Response.json(
          {
            error: msg,
            taskId,
            state: info.state,
            rawResultJson: info.rawResultJson,
            retryable,
          },
          { status: 502 },
        );
      }

      if (info.state === 'success' && info.url) {
        break;
      }

      // Continue polling if waiting OR success but URL not yet extractable.
      await new Promise((r) => setTimeout(r, KIE_POLL_INTERVAL_MS));
    }

    if (!lastUrl) {
      const snippet =
        typeof lastRaw === 'string'
          ? lastRaw.slice(0, 500)
          : JSON.stringify(lastRaw).slice(0, 500);

      return Response.json(
        {
          error: 'Timed out waiting for video URL',
          taskId,
          state: lastState,
          rawResultSnippet: snippet,
        },
        { status: 504 },
      );
    }

    const timestamp = Date.now();
    const linkedVideoId = extractLinkedVideoId(scene['field_6889']);
    const filename = linkedVideoId
      ? `video_${linkedVideoId}_scene_${sceneId}_img_${imageSig}_kie_${timestamp}.mp4`
      : `scene_${sceneId}_img_${imageSig}_kie_${timestamp}.mp4`;

    console.log('generate-scene-video: uploading MP4 to MinIO', {
      sceneId,
      filename,
      bucket: MINIO_BUCKET,
    });

    const minioUrl = await uploadVideoUrlToMinio({
      sourceUrl: lastUrl,
      filename,
    });

    // Save to Baserow.
    await baserowPatchJson<BaserowRow>(
      `/database/rows/table/${SCENES_TABLE_ID}/${sceneId}/`,
      {
        [VIDEO_FIELD_KEY]: minioUrl,
      },
    );

    return Response.json({
      videoUrl: minioUrl,
      providerVideoUrl: lastUrl,
      taskId,
      filename,
      bucket: MINIO_BUCKET,
      imageSig,
    });
  } catch (error) {
    console.error('generate-scene-video failed:', error);
    return Response.json(
      {
        error:
          error instanceof Error ? error.message : 'Failed to generate video',
      },
      { status: 500 },
    );
  }
}
