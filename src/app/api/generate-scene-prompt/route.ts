import OpenAI from 'openai';

type BaserowField = {
  id: number;
  name: string;
  type: string;
};

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
const DEFAULT_PROMPT_FIELD_ID = 7091;

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
    const errorText = await response.text();
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

async function baserowGetJson<T>(path: string, query?: Record<string, string>) {
  const baserowUrl = process.env.BASEROW_API_URL;
  if (!baserowUrl) {
    throw new Error('Missing Baserow URL');
  }

  const token = await getJWTToken();
  const url = new URL(`${baserowUrl}${path}`);
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

function extractLinkedVideoId(value: unknown): number | null {
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

  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') {
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
  }

  if (Array.isArray(value)) {
    const first = value[0] as unknown;
    if (typeof first === 'number' && Number.isFinite(first)) return first;
    if (typeof first === 'string') {
      const n = Number(first);
      return Number.isFinite(n) ? n : null;
    }
    const extracted = tryExtractId(first);
    if (extracted) return extracted;
  }

  const extracted = tryExtractId(value);
  if (extracted) return extracted;

  return null;
}

function getSceneText(scene: BaserowRow): string {
  const sentence = String(scene['field_6890'] ?? '').trim();
  const original = String(
    scene['field_6901'] ?? scene['field_6900'] ?? ''
  ).trim();
  return sentence || original;
}

function formatScriptLine(scene: BaserowRow): string {
  const text = getSceneText(scene);
  // Match the user's desired format: "<id> <text>"
  return text ? `${scene.id} ${text}` : String(scene.id);
}

function normalizePromptOutput(raw: string): string {
  let text = raw.trim();

  // Remove fenced code blocks if the model wraps output.
  text = text
    .replace(/^```[a-zA-Z0-9_-]*\n?/g, '')
    .replace(/```$/g, '')
    .trim();

  // Remove common leading labels/headings.
  // Examples:
  // "**Prompt for scene 123:**\n<actual prompt>"
  // "Prompt for scene 123: <actual prompt>"
  // "Scene prompt: <actual prompt>"
  text = text
    .replace(
      /^\*\*\s*(prompt\s*for\s*scene|scene\s*prompt)\s*[^\n]*\*\*\s*\n+/i,
      ''
    )
    .replace(/^(prompt\s*for\s*scene|scene\s*prompt)\s*[^\n]*:\s*/i, '')
    .trim();

  // If there's still a standalone first-line header, drop it.
  const lines = text.split(/\r?\n/).map((l) => l.trim());
  if (lines.length >= 2) {
    const first = lines[0];
    if (
      /^\*\*.*\*\*$/.test(first) ||
      /^prompt\s*for\s*scene\b/i.test(first) ||
      /^scene\s*prompt\b/i.test(first)
    ) {
      lines.shift();
      text = lines.join('\n').trim();
    }
  }

  return text;
}

function isPromptWritableFieldType(type: string): boolean {
  // For storing arbitrary prompts, we must use a free-form text field.
  // URL/email/phone/etc. will fail Baserow validation with "Enter a valid value".
  return type === 'text' || type === 'long_text';
}

async function resolvePromptFieldKey(): Promise<{
  key: string;
  field: BaserowField | null;
}> {
  try {
    const fields = await baserowGetJson<BaserowField[]>(
      `/database/fields/table/${SCENES_TABLE_ID}/`
    );

    const byId = fields.find((f) => f.id === DEFAULT_PROMPT_FIELD_ID) ?? null;
    if (byId) {
      return { key: `field_${byId.id}`, field: byId };
    }

    const byName =
      fields.find((f) => f.name.trim().toLowerCase() === 'prompt for scene') ??
      fields.find((f) => f.name.toLowerCase().includes('prompt for scene')) ??
      fields.find((f) => f.name.toLowerCase().includes('prompt')) ??
      null;

    if (byName) {
      return { key: `field_${byName.id}`, field: byName };
    }

    return { key: `field_${DEFAULT_PROMPT_FIELD_ID}`, field: null };
  } catch {
    return { key: `field_${DEFAULT_PROMPT_FIELD_ID}`, field: null };
  }
}

export async function POST(request: Request) {
  try {
    const body = (await request.json().catch(() => null)) as {
      sceneId?: unknown;
      model?: unknown;
      resolveOnly?: unknown;
    } | null;

    const sceneId = Number(body?.sceneId);
    const model = typeof body?.model === 'string' ? body.model : null;
    const resolveOnly = body?.resolveOnly === true;

    // Allow callers to resolve the destination field without generating.
    if (resolveOnly) {
      const { key: promptFieldKey, field: promptField } =
        await resolvePromptFieldKey();

      if (promptField && !isPromptWritableFieldType(promptField.type)) {
        return Response.json(
          {
            error: `"${promptField.name}" cannot store prompts (type: ${promptField.type}). Change it to a Text or Long text field in Baserow.`,
            promptFieldKey,
            promptFieldType: promptField.type,
          },
          { status: 400 }
        );
      }

      return Response.json({ promptFieldKey });
    }

    if (!Number.isFinite(sceneId) || sceneId <= 0) {
      return Response.json({ error: 'Scene ID is required' }, { status: 400 });
    }

    const { key: promptFieldKey, field: promptField } =
      await resolvePromptFieldKey();

    if (promptField && !isPromptWritableFieldType(promptField.type)) {
      return Response.json(
        {
          error: `"${promptField.name}" cannot store prompts (type: ${promptField.type}). Change it to a Text or Long text field in Baserow.`,
          promptFieldKey,
          promptFieldType: promptField.type,
        },
        { status: 400 }
      );
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
          error: 'Current scene is empty; cannot generate prompt',
          promptFieldKey,
        },
        { status: 400 }
      );
    }

    // Exclude empty scenes from the context we send to the model.
    const contextScenes = orderedScenes.filter((scene) =>
      Boolean(getSceneText(scene).trim())
    );
    const fullScript = contextScenes.map(formatScriptLine).join(' ');

    const prompt = `You are a Professional Video Storyboard Artist and AI Prompt Engineer. Your task is to analyze the trading script I provide and break it down into a series of visual image prompts. GLOBAL CHARACTER RULES (Must be in every prompt): Character: 2D minimalist sticky character. Appearance: Solid cyan skin, solid cyan head. Face: NO face mask, NO white patch. Simple black dot eyes directly on the cyan skin. Art Style: Thick black vector outlines, flat 2D art, high contrast. Environment: Minimalist, dark navy or black backgrounds. For each scene, create a visual metaphor that explains the concept being spoken. Do not just show the character talking; show the character interacting with trading charts, symbols, or metaphorical objects (mountains, traps, clocks, etc.). Just return the prompt for the current scene nothing else: current scene: ${sceneId} ${currentText} Full script: ${fullScript}`;

    // User requested: log the EXACT prompt being sent.
    console.log('generate-scene-prompt: sending prompt to OpenRouter');
    console.log(prompt);

    const completion = await openai.chat.completions.create({
      model: model || 'deepseek/deepseek-v3.2-exp',
      messages: [
        {
          role: 'system',
          content:
            'Return ONLY the final image prompt text. Do not include headings, labels (e.g., "Prompt for scene"), markdown, quotes, or any extra commentary.',
        },
        { role: 'user', content: prompt },
      ],
      temperature: 0.2,
    });

    const rawScenePrompt = completion.choices?.[0]?.message?.content?.trim();
    const scenePrompt = rawScenePrompt
      ? normalizePromptOutput(rawScenePrompt)
      : null;

    if (!scenePrompt) {
      return Response.json(
        { error: 'Model returned empty prompt', promptFieldKey },
        { status: 500 }
      );
    }

    return Response.json({ scenePrompt, promptFieldKey });
  } catch (error) {
    console.error('Error generating scene prompt:', error);
    return Response.json(
      {
        error: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 }
    );
  }
}
