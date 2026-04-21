import OpenAI from 'openai';

type InputScene = {
  sceneId: number;
  text: string;
};

type ParsedSentence = {
  sceneId: number;
  sourceText: string;
  fixedSentence: string;
};

const MAX_BATCH_SIZE = 10;
const DEFAULT_MODEL = 'deepseek/deepseek-v3.2-exp';

const openai = new OpenAI({
  baseURL: 'https://openrouter.ai/api/v1',
  apiKey: process.env.OPENROUTER_API_KEY,
  defaultHeaders: {
    'HTTP-Referer': 'https://ultimate-video-editor.com',
    'X-Title': 'Ultimate Video Editor',
  },
});

function createRequestId(): string {
  return `fls-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function getErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error || 'Unknown error');
}

function summarizeScenesForLog(scenes: InputScene[]) {
  return scenes.map((scene, index) => ({
    index: index + 1,
    sceneId: scene.sceneId,
    charCount: scene.text.length,
    preview: scene.text.slice(0, 80),
  }));
}

function extractReturnedSceneIds(parsed: unknown): number[] | null {
  if (!parsed || typeof parsed !== 'object') return null;
  const raw = (parsed as { sentences?: unknown }).sentences;
  if (!Array.isArray(raw)) return null;

  return raw
    .map((item) => Number((item as { sceneId?: unknown })?.sceneId))
    .filter((n) => Number.isFinite(n) && n > 0);
}

function normalizeTextForComparison(text: string): string {
  return String(text).replace(/\s+/g, ' ').trim();
}

function stripCodeFences(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed.startsWith('```')) return trimmed;

  return trimmed
    .replace(/^```[a-zA-Z0-9_-]*\n?/, '')
    .replace(/```$/, '')
    .trim();
}

function tryParseJson(raw: string): unknown {
  const cleaned = stripCodeFences(raw);

  try {
    return JSON.parse(cleaned);
  } catch {
    const firstBrace = cleaned.indexOf('{');
    const lastBrace = cleaned.lastIndexOf('}');
    if (firstBrace >= 0 && lastBrace > firstBrace) {
      const candidate = cleaned.slice(firstBrace, lastBrace + 1);
      return JSON.parse(candidate);
    }
    throw new Error('Model response is not valid JSON');
  }
}

function normalizeInputScenes(rawScenes: unknown): InputScene[] {
  if (!Array.isArray(rawScenes)) {
    throw new Error('"scenes" must be an array');
  }

  if (rawScenes.length === 0) {
    throw new Error('At least 1 scene is required');
  }

  if (rawScenes.length > MAX_BATCH_SIZE) {
    throw new Error(
      `At most ${MAX_BATCH_SIZE} scenes are allowed, received ${rawScenes.length}`,
    );
  }

  const normalized = rawScenes.map((raw, index) => {
    if (!raw || typeof raw !== 'object') {
      throw new Error(`Scene at index ${index} is invalid`);
    }

    const sceneIdRaw = (raw as { sceneId?: unknown }).sceneId;
    const textRaw = (raw as { text?: unknown }).text;

    const sceneId = Number(sceneIdRaw);
    const text = typeof textRaw === 'string' ? textRaw.trim() : '';

    if (!Number.isFinite(sceneId) || sceneId <= 0) {
      throw new Error(`Scene at index ${index} has invalid sceneId`);
    }

    if (!text) {
      throw new Error(`Scene ${sceneId} has empty text`);
    }

    return { sceneId, text };
  });

  const idSet = new Set<number>();
  for (const scene of normalized) {
    if (idSet.has(scene.sceneId)) {
      throw new Error(`Duplicate sceneId in request: ${scene.sceneId}`);
    }
    idSet.add(scene.sceneId);
  }

  return normalized;
}

function validateAndNormalizeModelOutput(
  parsed: unknown,
  inputScenes: InputScene[],
): ParsedSentence[] {
  const inputSceneIds = inputScenes.map((scene) => scene.sceneId);
  const inputTextById = new Map<number, string>(
    inputScenes.map((scene) => [scene.sceneId, scene.text]),
  );
  const expectedCount = inputSceneIds.length;

  if (!parsed || typeof parsed !== 'object') {
    throw new Error('Model JSON payload must be an object');
  }

  const sentencesRaw = (parsed as { sentences?: unknown }).sentences;
  if (!Array.isArray(sentencesRaw)) {
    throw new Error('Model JSON must contain a "sentences" array');
  }

  if (sentencesRaw.length !== expectedCount) {
    throw new Error(
      `Model must return exactly ${expectedCount} sentences, received ${sentencesRaw.length}`,
    );
  }

  const allowedIds = new Set(inputSceneIds);
  const seenIds = new Set<number>();
  const byId = new Map<number, ParsedSentence>();

  sentencesRaw.forEach((item, index) => {
    if (!item || typeof item !== 'object') {
      throw new Error(`Invalid sentence object at index ${index}`);
    }

    const sceneIdRaw = (item as { sceneId?: unknown }).sceneId;
    const sourceTextRaw = (item as { sourceText?: unknown }).sourceText;
    const fixedSentenceRaw = (item as { fixedSentence?: unknown })
      .fixedSentence;

    const sceneId = Number(sceneIdRaw);
    const sourceText =
      typeof sourceTextRaw === 'string' ? sourceTextRaw.trim() : '';
    const fixedSentence =
      typeof fixedSentenceRaw === 'string' ? fixedSentenceRaw.trim() : '';

    if (!Number.isFinite(sceneId) || sceneId <= 0) {
      throw new Error(`Invalid sceneId at output index ${index}`);
    }

    if (!allowedIds.has(sceneId)) {
      throw new Error(`Model returned unexpected sceneId: ${sceneId}`);
    }

    if (seenIds.has(sceneId)) {
      throw new Error(`Model returned duplicate sceneId: ${sceneId}`);
    }

    if (!fixedSentence) {
      throw new Error(
        `Model returned empty fixedSentence for scene ${sceneId}`,
      );
    }

    if (!sourceText) {
      throw new Error(`Model returned empty sourceText for scene ${sceneId}`);
    }

    const expectedSourceText = inputTextById.get(sceneId) || '';
    const expectedNormalized = normalizeTextForComparison(expectedSourceText);
    const returnedNormalized = normalizeTextForComparison(sourceText);

    if (!expectedNormalized) {
      throw new Error(
        `Internal error: missing expected input text for scene ${sceneId}`,
      );
    }

    if (returnedNormalized !== expectedNormalized) {
      throw new Error(
        `Model sourceText mismatch for scene ${sceneId}. Expected to match input scene value exactly.`,
      );
    }

    seenIds.add(sceneId);
    byId.set(sceneId, {
      sceneId,
      sourceText,
      fixedSentence,
    });
  });

  const missing = inputSceneIds.filter((id) => !seenIds.has(id));
  if (missing.length > 0) {
    throw new Error(`Model response missing sceneIds: ${missing.join(', ')}`);
  }

  return inputSceneIds.map((sceneId) => {
    const item = byId.get(sceneId);
    if (!item) {
      throw new Error(`Model response missing normalized entry for ${sceneId}`);
    }
    return item;
  });
}

export async function POST(request: Request) {
  const requestId = createRequestId();
  const logPrefix = `[fix-language-scenes][${requestId}]`;
  const startedAt = Date.now();

  try {
    console.info(`${logPrefix} Incoming request.`);

    if (!process.env.OPENROUTER_API_KEY) {
      console.error(`${logPrefix} OPENROUTER_API_KEY is not configured.`);
      return Response.json(
        { error: 'OPENROUTER_API_KEY is not configured', requestId },
        { status: 500 },
      );
    }

    const body = (await request.json().catch(() => null)) as {
      scenes?: unknown;
      model?: unknown;
    } | null;

    const incomingSceneCount = Array.isArray(body?.scenes)
      ? body.scenes.length
      : null;

    console.info(`${logPrefix} Parsed request body.`, {
      hasBody: Boolean(body),
      modelFromBody:
        typeof body?.model === 'string' ? body.model : '(not provided)',
      incomingSceneCount,
    });

    let scenes: InputScene[];
    try {
      scenes = normalizeInputScenes(body?.scenes);
    } catch (error) {
      const message = getErrorMessage(error);
      console.error(`${logPrefix} Input validation failed.`, {
        message,
        incomingSceneCount,
      });
      return Response.json({ error: message, requestId }, { status: 400 });
    }

    const model =
      typeof body?.model === 'string' && body.model.trim()
        ? body.model.trim()
        : DEFAULT_MODEL;

    const sceneIds = scenes.map((scene) => scene.sceneId);

    console.info(`${logPrefix} Input validated.`, {
      model,
      sceneCount: scenes.length,
      sceneIds,
      scenes: summarizeScenesForLog(scenes),
    });

    const scenesPayload = scenes
      .map(
        (scene, index) =>
          `${index + 1}. sceneId=${scene.sceneId}\ntext=${scene.text}`,
      )
      .join('\n\n');

    const userPrompt = `Fix language issues (spelling, grammar, punctuation, capitalization) for these scenes.

Rules:
- Keep the same meaning and intent.
- Do NOT add new facts or remove important details.
- Keep technical terms and numbers unless clearly misspelled.
- You will receive between 1 and ${MAX_BATCH_SIZE} scenes.
- Return ALL ${sceneIds.length} scenes exactly once.
- The output MUST be valid JSON and follow this exact shape:
{
  "sentences": [
    { "sceneId": 123, "sourceText": "<EXACT input text for that sceneId>", "fixedSentence": "..." }
  ]
}
- The sourceText value MUST exactly match the input text for the same sceneId.
- Do not paraphrase, shorten, or alter sourceText.
- Do not include markdown or extra keys.

Input scenes:
${scenesPayload}`;

    const maxAttempts = 3;
    let lastFailureReason = '';

    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      const retryInstruction =
        attempt > 1
          ? `\n\nIMPORTANT RETRY INSTRUCTIONS (attempt ${attempt}/${maxAttempts}):\nThe previous response failed validation: ${lastFailureReason || 'unknown reason'}.\nReturn valid JSON only, and include sceneId, sourceText (exact input text for same sceneId), and fixedSentence for every scene.`
          : '';

      const baseCompletionPayload = {
        model,
        temperature: 0,
        messages: [
          {
            role: 'system' as const,
            content:
              'You are a precise text editor. Return only strict JSON with the exact required schema.',
          },
          {
            role: 'user' as const,
            content: `${userPrompt}${retryInstruction}`,
          },
        ],
      };

      console.info(`${logPrefix} Calling OpenRouter model.`, {
        model,
        strictJsonMode: true,
        attempt: `${attempt}/${maxAttempts}`,
        retryReason: attempt > 1 ? lastFailureReason : null,
      });

      let completion: OpenAI.Chat.Completions.ChatCompletion;
      try {
        completion = await openai.chat.completions.create({
          ...baseCompletionPayload,
          response_format: { type: 'json_object' },
        });
      } catch (error) {
        console.warn(
          `${logPrefix} response_format=json_object failed; retrying without response_format.`,
          {
            attempt: `${attempt}/${maxAttempts}`,
            error: getErrorMessage(error),
          },
        );

        try {
          completion = await openai.chat.completions.create(
            baseCompletionPayload,
          );
        } catch (fallbackError) {
          lastFailureReason = `Model request failed: ${getErrorMessage(fallbackError)}`;
          console.error(`${logPrefix} Model call failed.`, {
            attempt: `${attempt}/${maxAttempts}`,
            error: lastFailureReason,
          });

          if (attempt < maxAttempts) {
            continue;
          }

          return Response.json(
            {
              error: lastFailureReason,
              requestId,
              attemptsUsed: attempt,
            },
            { status: 502 },
          );
        }
      }

      const rawContent = completion.choices?.[0]?.message?.content?.trim();
      console.info(`${logPrefix} Model response received.`, {
        attempt: `${attempt}/${maxAttempts}`,
        hasContent: Boolean(rawContent),
        contentLength: rawContent?.length ?? 0,
        choicesCount: completion.choices?.length ?? 0,
      });

      if (!rawContent) {
        lastFailureReason = 'Model returned empty content';
        console.warn(
          `${logPrefix} Empty model content; will retry if attempts remain.`,
          {
            attempt: `${attempt}/${maxAttempts}`,
          },
        );

        if (attempt < maxAttempts) {
          continue;
        }

        return Response.json(
          {
            error: lastFailureReason,
            requestId,
            attemptsUsed: attempt,
          },
          { status: 502 },
        );
      }

      let parsed: unknown;
      try {
        parsed = tryParseJson(rawContent);
      } catch (error) {
        lastFailureReason = getErrorMessage(error);
        console.warn(
          `${logPrefix} Failed to parse model JSON response; will retry if attempts remain.`,
          {
            attempt: `${attempt}/${maxAttempts}`,
            error: lastFailureReason,
            contentPreview: rawContent.slice(0, 400),
          },
        );

        if (attempt < maxAttempts) {
          continue;
        }

        return Response.json(
          {
            error:
              error instanceof Error
                ? error.message
                : 'Failed to parse model response JSON',
            requestId,
            attemptsUsed: attempt,
          },
          { status: 422 },
        );
      }

      let sentences: ParsedSentence[];
      try {
        sentences = validateAndNormalizeModelOutput(parsed, scenes);
      } catch (error) {
        lastFailureReason = getErrorMessage(error);
        console.warn(
          `${logPrefix} Model response validation failed; will retry if attempts remain.`,
          {
            attempt: `${attempt}/${maxAttempts}`,
            error: lastFailureReason,
            expectedSceneIds: sceneIds,
            returnedSceneIds: extractReturnedSceneIds(parsed),
          },
        );

        if (attempt < maxAttempts) {
          continue;
        }

        return Response.json(
          {
            error:
              error instanceof Error
                ? error.message
                : 'Model response failed validation',
            requestId,
            attemptsUsed: attempt,
          },
          { status: 422 },
        );
      }

      console.info(`${logPrefix} Validation succeeded.`, {
        attempt: `${attempt}/${maxAttempts}`,
        returnedSceneIds: sentences.map((s) => s.sceneId),
        durationMs: Date.now() - startedAt,
      });

      return Response.json({ sentences, requestId, attemptsUsed: attempt });
    }

    return Response.json(
      {
        error: `Model output failed after ${maxAttempts} attempts`,
        requestId,
        attemptsUsed: maxAttempts,
      },
      { status: 422 },
    );
  } catch (error) {
    console.error(`${logPrefix} Unhandled failure.`, error);
    return Response.json(
      {
        error: getErrorMessage(error) || 'Failed to fix language for scenes',
        requestId,
      },
      { status: 500 },
    );
  }
}
