import { resolveOpenAIClient } from '@/lib/ai-provider';
import {
  BaserowRow,
  getBaserowDataForOriginalVideo,
  getSceneById,
} from '@/lib/baserow-actions';

const getLinkedVideoId = (scene: BaserowRow): number | null => {
  const value = scene.field_6889;
  const getObjectCandidate = (item: object): unknown => {
    const record = item as Record<string, unknown>;
    return record.id ?? record.value;
  };
  const candidate = Array.isArray(value)
    ? value[0] && typeof value[0] === 'object'
      ? getObjectCandidate(value[0])
      : value[0]
    : value && typeof value === 'object'
      ? getObjectCandidate(value)
      : value;
  const parsed = Number(candidate);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
};

const countWords = (text: string): number =>
  text.trim().split(/\s+/).filter(Boolean).length;

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { currentSentence, sceneId, model } = body;

    if (!String(currentSentence || '').trim()) {
      return Response.json(
        { error: 'Current sentence is required' },
        { status: 400 },
      );
    }

    const normalizedSceneId = Number(sceneId);
    if (!Number.isFinite(normalizedSceneId) || normalizedSceneId <= 0) {
      return Response.json({ error: 'Scene ID is required' }, { status: 400 });
    }

    const {
      client: openaiClient,
      provider,
      missingApiKey,
    } = resolveOpenAIClient(request, body);

    if (!openaiClient || missingApiKey) {
      return Response.json(
        {
          error:
            provider === 'online'
              ? 'Missing OpenRouter API key. Set OPENROUTER_API_KEY in .env.local and restart the dev server.'
              : 'Failed to initialize local AI provider client.',
        },
        { status: 500 },
      );
    }

    const currentScene = await getSceneById(normalizedSceneId);
    const linkedVideoId = currentScene
      ? getLinkedVideoId(currentScene)
      : null;
    let previousScenesContext = '';

    if (currentScene && linkedVideoId) {
      const videoScenes = await getBaserowDataForOriginalVideo(linkedVideoId);
      const currentIndex = videoScenes
        .slice()
        .sort((a, b) => a.id - b.id)
        .findIndex((scene) => scene.id === normalizedSceneId);

      if (currentIndex > 0) {
        previousScenesContext = videoScenes
          .slice()
          .sort((a, b) => a.id - b.id)
          .slice(Math.max(0, currentIndex - 10), currentIndex)
          .map(
            (scene) =>
              `Scene ${scene.id}: ${String(
                scene.field_6901 || scene.field_6891 || '',
              ).trim()}`,
          )
          .filter((line) => !line.endsWith(': '))
          .join('\n');
      }
    }

    const contextSection = previousScenesContext
      ? `\nPREVIOUS SCENES CONTEXT:\n${previousScenesContext}\n\nUse the preceding scenes only to maintain continuity and avoid repeating information. Do not copy them or introduce details that are absent from the current text.\n`
      : '';

    const basePrompt = `This is a standalone, independent request. Do not reference or remember any previous conversations, requests, or context from other calls.
${contextSection}
CURRENT SCENE TEXT TO SHORTEN (Scene #${normalizedSceneId}):
${currentSentence}

Rewrite the current scene text so it is meaningfully shorter.

Requirements:
- Preserve the original meaning and technical accuracy.
- Keep all essential instructions, names, values, and important details.
- Remove repetition, filler words, unnecessary explanations, and redundant transitions.
- Do not add new information.
- Do not change the intended action or outcome.
- The complete rewritten text must contain fewer words than the original.
- Prefer concise sentences, but do not make the result sound abrupt or incomplete.
- Never return an empty response.
- Return only the shortened text, with no quotation marks, label, explanation, or commentary.`;

    const originalWordCount = countWords(String(currentSentence));

    for (let attempt = 1; attempt <= 3; attempt++) {
      const prompt =
        basePrompt +
        (attempt > 1
          ? '\n\nYour previous response was not shorter than the original. Rewrite it again using fewer total words while preserving every essential detail.'
          : '');

      console.log(`Shorten sentence prompt attempt ${attempt}/3:\n${prompt}`);

      const completion = await openaiClient.chat.completions.create({
        model:
          model ||
          'cognitivecomputations/dolphin-mistral-24b-venice-edition:free',
        messages: [{ role: 'user', content: prompt }],
      });
      const shortenedSentence = completion.choices[0]?.message?.content
        ?.trim()
        .replace(/^(["'])|(["'])$/g, '');

      if (
        shortenedSentence &&
        countWords(shortenedSentence) < originalWordCount
      ) {
        return Response.json({
          originalSentence: currentSentence,
          shortenedSentence,
          sceneId: normalizedSceneId,
        });
      }
    }

    return Response.json(
      {
        error:
          'AI did not return text shorter than the original after 3 attempts. The original text was preserved.',
      },
      { status: 422 },
    );
  } catch (error) {
    console.error('Error shortening sentence:', error);
    return Response.json(
      {
        error:
          error instanceof Error
            ? error.message
            : 'Failed to shorten sentence',
      },
      { status: 500 },
    );
  }
}
