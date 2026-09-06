import OpenAI from 'openai';
import { resolveOpenAIClient, withOpenRouterNitro } from '@/lib/ai-provider';

export const maxDuration = 120;

const DEFAULT_MODEL = 'deepseek/deepseek-v3.2-exp';
const MODEL_CALL_TIMEOUT_MS = 120_000;
const MAX_SCENES = 500;

type InputScene = {
  sceneId: number;
  text: string;
};

function getErrorMessage(error: unknown): string {
  return error instanceof Error
    ? error.message
    : String(error || 'Unknown error');
}

function normalizeScenes(value: unknown): InputScene[] {
  if (!Array.isArray(value) || value.length === 0) {
    throw new Error('At least one scene is required');
  }
  if (value.length > MAX_SCENES) {
    throw new Error(`At most ${MAX_SCENES} scenes are allowed`);
  }

  const seenIds = new Set<number>();
  return value.map((item, index) => {
    if (!item || typeof item !== 'object') {
      throw new Error(`Scene at index ${index} is invalid`);
    }
    const sceneId = Number((item as { sceneId?: unknown }).sceneId);
    const textRaw = (item as { text?: unknown }).text;
    const text = typeof textRaw === 'string' ? textRaw.trim() : '';
    if (!Number.isInteger(sceneId) || sceneId <= 0) {
      throw new Error(`Scene at index ${index} has an invalid sceneId`);
    }
    if (seenIds.has(sceneId)) {
      throw new Error(`Duplicate sceneId in request: ${sceneId}`);
    }
    seenIds.add(sceneId);
    return { sceneId, text };
  });
}

function parseJsonObject(raw: string): unknown {
  const cleaned = raw
    .trim()
    .replace(/^```[a-zA-Z0-9_-]*\n?/, '')
    .replace(/```$/, '')
    .trim();

  try {
    return JSON.parse(cleaned);
  } catch {
    const start = cleaned.indexOf('{');
    const end = cleaned.lastIndexOf('}');
    if (start >= 0 && end > start)
      return JSON.parse(cleaned.slice(start, end + 1));
    throw new Error('Model response is not valid JSON');
  }
}

function normalizeSelectedIndexes(
  value: unknown,
  sceneCount: number,
): number[] {
  if (!value || typeof value !== 'object') {
    throw new Error('Model JSON payload must be an object');
  }
  const raw = (value as { needsVisualSceneIndexes?: unknown })
    .needsVisualSceneIndexes;
  if (!Array.isArray(raw)) {
    throw new Error('Model JSON must contain needsVisualSceneIndexes');
  }

  const indexes = raw.map(Number);
  if (
    indexes.some(
      (index) => !Number.isInteger(index) || index < 1 || index > sceneCount,
    )
  ) {
    throw new Error('Model returned an invalid scene index');
  }
  return [...new Set(indexes)];
}

export async function POST(request: Request) {
  try {
    const body = (await request.json().catch(() => null)) as {
      scenes?: unknown;
      model?: unknown;
    } | null;
    const scenes = normalizeScenes(body?.scenes);
    const model =
      typeof body?.model === 'string' && body.model.trim()
        ? body.model.trim()
        : DEFAULT_MODEL;

    const { client, missingApiKey } = resolveOpenAIClient(request, {
      provider: 'online',
    });
    if (!client || missingApiKey) {
      return Response.json(
        { error: 'OPENROUTER_API_KEY is not configured' },
        { status: 500 },
      );
    }

    const scenePayload = scenes
      .map(
        (scene, index) =>
          `${index + 1}. sceneIndex=${index + 1}\ntext=${scene.text || '(empty scene)'}`,
      )
      .join('\n\n');

    const prompt = `Analyze every chronological scene below and identify only the scenes that would materially benefit from a custom HyperFrames animation.

Select scenes where animation would clarify an abstract idea, process, comparison, data relationship, technical mechanism, or important visual explanation. Be selective. Do not select a scene merely because animation is possible.

Rules:
- Consider the full sequence and neighboring context.
- Return only sceneIndex values from this input.
- Return strict JSON with exactly this shape: {"needsVisualSceneIndexes":[2,5]}
- Return an empty array when no additional scenes need animation.
- Do not include explanations, markdown, database IDs, or extra keys.

Scenes:
${scenePayload}`;

    const controller = new AbortController();
    const timeoutId = setTimeout(
      () => controller.abort(),
      MODEL_CALL_TIMEOUT_MS,
    );
    const completionPayload = {
      model: withOpenRouterNitro(model, 'online' as const),
      temperature: 0,
      messages: [
        {
          role: 'system' as const,
          content:
            'You are a conservative video storyboard editor. Return only strict JSON matching the requested schema.',
        },
        { role: 'user' as const, content: prompt },
      ],
    };

    let completion: OpenAI.Chat.Completions.ChatCompletion;
    try {
      try {
        completion = await client.chat.completions.create(
          { ...completionPayload, response_format: { type: 'json_object' } },
          { signal: controller.signal },
        );
      } catch (jsonFormatError) {
        if (controller.signal.aborted) throw jsonFormatError;
        completion = await client.chat.completions.create(completionPayload, {
          signal: controller.signal,
        });
      }
    } finally {
      clearTimeout(timeoutId);
    }

    const rawContent = completion.choices[0]?.message?.content?.trim();
    if (!rawContent) throw new Error('Model returned an empty response');

    const selectedIndexes = normalizeSelectedIndexes(
      parseJsonObject(rawContent),
      scenes.length,
    );

    return Response.json({
      sceneIds: selectedIndexes.map((index) => scenes[index - 1].sceneId),
      sceneIndexes: selectedIndexes,
      analyzedCount: scenes.length,
    });
  } catch (error) {
    const message = getErrorMessage(error);
    const status = /required|invalid|duplicate|at most/i.test(message)
      ? 400
      : 500;
    console.error('Find HyperFrames scenes failed:', error);
    return Response.json({ error: message }, { status });
  }
}
