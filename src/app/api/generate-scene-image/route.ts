import OpenAI from 'openai';
import { readFile, writeFile, unlink } from 'fs/promises';
import path from 'path';
import { uploadToMinio } from '@/utils/ffmpeg-cfr';

type BaserowRow = {
  id: number;
  [key: string]: unknown;
};

const openai = new OpenAI({
  baseURL: 'https://openrouter.ai/api/v1',
  apiKey: process.env.OPENROUTER_API_KEY,
  defaultHeaders: {
    'HTTP-Referer': 'https://ultimate-video-editor.com',
    'X-Title': 'Ultimate Video Editor',
  },
});

const SCENES_TABLE_ID = 714;
const IMAGE_FIELD_KEY = 'field_7094'; // Image for Scene (7094)
const CHARACTER_IMAGE_RELATIVE_PATH = 'public/photos/character.png';

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
  query?: Record<string, string>
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
  body: Record<string, unknown>
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

function parseDataUrl(dataUrl: string): { mime: string; buffer: Buffer } {
  const match = dataUrl.match(/^data:([^;]+);base64,(.*)$/);
  if (!match) {
    throw new Error('Returned image is not a valid data URL');
  }
  const mime = match[1];
  const buffer = Buffer.from(match[2], 'base64');
  return { mime, buffer };
}

function mimeToExt(mime: string): string {
  const m = mime.toLowerCase();
  if (m.includes('png')) return 'png';
  if (m.includes('jpeg') || m.includes('jpg')) return 'jpg';
  if (m.includes('webp')) return 'webp';
  return 'png';
}

export async function POST(req: Request) {
  try {
    if (!process.env.OPENROUTER_API_KEY) {
      return Response.json(
        { error: 'Missing OPENROUTER_API_KEY' },
        { status: 500 }
      );
    }

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
      `/database/rows/table/${SCENES_TABLE_ID}/${sceneId}/`
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
        }
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
        { status: 400 }
      );
    }

    const contextScenes = orderedScenes.filter((scene) =>
      Boolean(getSceneText(scene).trim())
    );
    const fullScript = contextScenes.map(formatScriptLine).join(' ');

    const prompt = `You are a professional image creator for video clips. Your task is to analyze the script I provide and convert each scene into a single, clear visual that communicates the idea being spoken.

  GLOBAL CHARACTER RULES (must be in every prompt):
  Character: "image 1" (use the attached reference image to keep the character consistent).
  Art Style: thick black vector outlines, flat 2D art, high contrast.

  For each scene:
  Create a strong visual metaphor that explains the concept. Do not just show the character talking; show the character interacting with relevant objects, symbols, UI elements, diagrams, or metaphorical props (e.g., charts, clocks, ladders, puzzles, obstacles, tools). Keep the composition simple and readable.

  Create an image for the current scene:

  current scene: ${sceneId} ${currentText} Full script: ${fullScript}`;

    console.log('generate-scene-image: sending prompt to OpenRouter');
    console.log(prompt);

    const characterPath = path.join(
      process.cwd(),
      CHARACTER_IMAGE_RELATIVE_PATH
    );
    const characterBuffer = await readFile(characterPath);
    const characterDataUrl = `data:image/png;base64,${characterBuffer.toString(
      'base64'
    )}`;

    const completion = await openai.chat.completions.create({
      model: 'google/gemini-3-pro-image-preview',
      messages: [
        {
          role: 'user',
          content: [
            { type: 'text', text: prompt },
            { type: 'image_url', image_url: { url: characterDataUrl } },
          ],
        },
      ],
      // @ts-expect-error OpenRouter supports modalities for image output
      modalities: ['image', 'text'],
      temperature: 0.2,
    });

    const imageUrl =
      // @ts-expect-error OpenRouter image modality response
      completion.choices?.[0]?.message?.images?.[0]?.image_url?.url;

    if (typeof imageUrl !== 'string' || !imageUrl.trim()) {
      return Response.json(
        { error: 'Model returned no image' },
        { status: 500 }
      );
    }

    let imageMime = 'image/png';
    let imageBuffer: Buffer;

    if (imageUrl.startsWith('data:')) {
      const parsed = parseDataUrl(imageUrl);
      imageMime = parsed.mime;
      imageBuffer = parsed.buffer;
    } else if (imageUrl.startsWith('http')) {
      const res = await fetch(imageUrl);
      if (!res.ok) {
        throw new Error(`Failed to download generated image (${res.status})`);
      }
      const ab = await res.arrayBuffer();
      imageBuffer = Buffer.from(ab);
      const ct = res.headers.get('content-type');
      if (ct) imageMime = ct;
    } else {
      throw new Error('Model returned an unsupported image URL format');
    }

    const ext = mimeToExt(imageMime);
    const filename = `scene_${sceneId}_nano_banana.${ext}`;
    const tmpPath = path.join('/tmp', filename);

    await writeFile(tmpPath, imageBuffer);

    try {
      const minioUrl = await uploadToMinio(tmpPath, filename, imageMime);

      await baserowPatchJson(
        `/database/rows/table/${SCENES_TABLE_ID}/${sceneId}/`,
        {
          [IMAGE_FIELD_KEY]: minioUrl,
        }
      );

      return Response.json({ imageUrl: minioUrl });
    } finally {
      try {
        await unlink(tmpPath);
      } catch {
        // ignore
      }
    }
  } catch (error) {
    console.error('Error generating scene image:', error);
    return Response.json(
      {
        error: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 }
    );
  }
}
