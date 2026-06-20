import OpenAI from 'openai';
import {
  resolveAIProviderConfig,
  resolveOpenAIClient,
  unloadLocalModel,
} from '@/lib/ai-provider';

type InputScene = {
  sceneId: number;
  text: string;
};

type ParsedSentence = {
  sceneId: number;
  sourceText: string;
  fixedSentence: string;
};

const MAX_BATCH_SIZE = 100;
const DEFAULT_MODEL = 'deepseek/deepseek-v3.2-exp';

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

/**
 * Strip invisible/problematic Unicode characters and normalize cosmetic
 * differences (smart quotes, en/em-dashes, etc.) so that two strings that
 * look the same to a human compare as equal.
 *
 * This is intentionally conservative – it only removes characters that are
 * purely cosmetic and should never change the *meaning* of text.
 */
function stripProblematicUnicode(text: string): string {
  return (
    text
      // NFC composition – combine characters into their canonical form.
      .normalize('NFC')
      // Remove zero-width / invisible formatting characters.
      // U+200B zero-width space, U+200C zero-width non-joiner, U+200D zero-width joiner,
      // U+200E/U+200F left-to-right / right-to-left marks, U+FEFF BOM/ZWNBSP,
      // U+00AD soft hyphen, U+2060 word joiner, U+180E mongolian vowel separator,
      // U+FE00-U+FE0F variation selectors (handled separately below),
      // U+061C arabic letter mark, U+2028 line separator, U+2029 paragraph separator.
      .replace(/[\u200B-\u200F\uFEFF\u00AD\u2060\u180E]/g, '')
      // Remove variation selectors.
      .replace(/[\uFE00-\uFE0F]/g, '')
      // Remove stray combining marks (diacritics that appear/disappear
      // between model echo attempts). Only strip the combining marks
      // themselves, not precomposed characters like é (U+00E9).
      .replace(/[\u0300-\u036F]/g, '')
      // Normalize curly / smart quotes → straight quotes.
      .replace(/[\u2018\u2019\u201A\u201B\u2039\u203A\u02BC]/g, "'")
      .replace(/[\u201C\u201D\u201E\u201F\u00AB\u00BB]/g, '"')
      // Normalize dashes → hyphen-minus.
      .replace(/[\u2012\u2013\u2014\u2015\u2212]/g, '-')
      // Normalize non-breaking / special spaces → regular space.
      .replace(/[\u00A0\u2007\u202F\u205F\u2060\u2009\u200A\u2008\uFEA0]/g, ' ')
      // Collapse whitespace and trim.
      .replace(/\s+/g, ' ')
      .trim()
  );
}

/**
 * Compare two strings using fuzzy Unicode-aware normalization.
 * Returns whether they match and, if not, a short diff preview.
 */
function textsMatchFuzzy(
  a: string,
  b: string,
): { match: boolean; diffPreview?: string } {
  const canonicalA = stripProblematicUnicode(normalizeTextForComparison(a));
  const canonicalB = stripProblematicUnicode(normalizeTextForComparison(b));

  if (canonicalA === canonicalB) {
    return { match: true };
  }

  // Build a short diff preview showing the first divergence.
  const maxLen = Math.max(canonicalA.length, canonicalB.length);
  let firstDiff = -1;
  for (let i = 0; i < maxLen; i++) {
    if (canonicalA[i] !== canonicalB[i]) {
      firstDiff = i;
      break;
    }
  }

  const charA = firstDiff >= 0 ? canonicalA[firstDiff] : '';
  const charB = firstDiff >= 0 ? canonicalB[firstDiff] : '';
  const codePointA = firstDiff >= 0 ? (charA.codePointAt(0) ?? 0) : 0;
  const codePointB = firstDiff >= 0 ? (charB.codePointAt(0) ?? 0) : 0;

  const preview =
    firstDiff >= 0
      ? `char ${firstDiff}: expected U+${codePointA.toString(16).toUpperCase().padStart(4, '0')} ('${charA}'), got U+${codePointB.toString(16).toUpperCase().padStart(4, '0')} ('${charB}')`
      : `length mismatch: ${canonicalA.length} vs ${canonicalB.length}`;

  return { match: false, diffPreview: preview };
}

function isTruthyFlag(value: unknown): boolean {
  return value === true || value === 'true' || value === 1 || value === '1';
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
  onFuzzyMatch?: (sceneId: number, diffPreview: string) => void,
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

    // Use strict comparison first (fast path).
    const strictMatch = returnedNormalized === expectedNormalized;

    // If strict fails, try fuzzy Unicode-aware comparison.
    const useOriginalText = !strictMatch;
    if (useOriginalText) {
      const fuzzy = textsMatchFuzzy(expectedSourceText, sourceText);
      if (!fuzzy.match) {
        throw new Error(
          `Model sourceText mismatch for scene ${sceneId}. Expected to match input scene value exactly.`,
        );
      }
      // Fuzzy match passed – the model echoed the right text with cosmetic
      // Unicode differences. Log a warning but proceed, using the ORIGINAL
      // input text as sourceText to avoid downstream inconsistency.
      onFuzzyMatch?.(sceneId, fuzzy.diffPreview ?? 'unknown diff');
    }

    seenIds.add(sceneId);
    byId.set(sceneId, {
      sceneId,
      sourceText: useOriginalText ? expectedSourceText : sourceText,
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

    const body = (await request.json().catch(() => null)) as {
      scenes?: unknown;
      model?: unknown;
      provider?: unknown;
      localEndpoint?: unknown;
      localApiKey?: unknown;
      localAdminApiKey?: unknown;
      unloadModelAfter?: unknown;
    } | null;

    const providerConfig = resolveAIProviderConfig(request, body);

    const {
      client: openaiClient,
      provider,
      missingApiKey,
    } = resolveOpenAIClient(request, body);

    if (!openaiClient || missingApiKey) {
      const errorMessage =
        provider === 'online'
          ? 'OPENROUTER_API_KEY is not configured'
          : 'Failed to initialize local AI provider client';

      console.error(`${logPrefix} ${errorMessage}.`);

      return Response.json(
        {
          error: errorMessage,
          requestId,
        },
        { status: 500 },
      );
    }

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

    const unloadModelAfter = isTruthyFlag(body?.unloadModelAfter);

    const sceneIds = scenes.map((scene) => scene.sceneId);

    console.info(`${logPrefix} Input validated.`, {
      model,
      sceneCount: scenes.length,
      sceneIds,
      unloadModelAfter,
      scenes: summarizeScenesForLog(scenes),
    });

    const scenesPayload = scenes
      .map(
        (scene, index) =>
          `${index + 1}. sceneId=${scene.sceneId}\ntext=${scene.text}`,
      )
      .join('\n\n');

    const userPrompt = `Fix language issues (spelling, grammar, punctuation, capitalization) for these scenes while keeping a friendly tutorial tone and improving flow between consecutive scenes.

Rules:
- Keep the same meaning and intent.
- Do NOT add new facts or remove important details.
- Keep technical terms and numbers unless clearly misspelled.
  - Use a friendly, clear, conversational tutorial tone in fixedSentence.
  - The input scenes are in chronological order; improve connection between neighboring scenes with natural transitions when appropriate.
  - Keep each fixedSentence focused on its own scene content while still sounding coherent with nearby scenes.
  - Do not change the step order.
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

    console.info(`${logPrefix} Prompt sent to model:`);
    console.info(userPrompt);

    const baseCompletionPayload = {
      model,
      temperature: 0,
      messages: [
        {
          role: 'system' as const,
          content:
            'You are a precise text editor for tutorial scripts. Return only strict JSON with the exact required schema.',
        },
        {
          role: 'user' as const,
          content: userPrompt,
        },
      ],
    };

    console.info(`${logPrefix} Calling ${provider} model.`, {
      model,
      strictJsonMode: true,
      attemptedBatchSize: scenes.length,
    });

    // Single attempt: try with response_format=json_object first.
    // If the model/provider doesn't support it, retry once without it
    // (this is a compatibility fallback, not a retry-on-failure).
    let completion: OpenAI.Chat.Completions.ChatCompletion;
    let usedJsonFormat = true;
    try {
      completion = await openaiClient.chat.completions.create({
        ...baseCompletionPayload,
        response_format: { type: 'json_object' },
      });
    } catch (jsonFormatError) {
      usedJsonFormat = false;
      console.warn(
        `${logPrefix} response_format=json_object failed; retrying without response_format.`,
        {
          error: getErrorMessage(jsonFormatError),
        },
      );

      try {
        completion = await openaiClient.chat.completions.create(
          baseCompletionPayload,
        );
      } catch (fallbackError) {
        const errorMessage = `Model request failed: ${getErrorMessage(fallbackError)}`;
        console.error(`${logPrefix} Model call failed.`, {
          error: errorMessage,
        });

        const failurePayload = {
          error: errorMessage,
          requestId,
          attemptedBatchSize: scenes.length,
        };
        console.info(
          `${logPrefix} API return value (model call failure):`,
          failurePayload,
        );
        return Response.json(failurePayload, { status: 502 });
      }
    }

    const rawContent = completion.choices?.[0]?.message?.content?.trim();
    console.info(`${logPrefix} Model response received.`, {
      hasContent: Boolean(rawContent),
      contentLength: rawContent?.length ?? 0,
      choicesCount: completion.choices?.length ?? 0,
      usedJsonFormat,
    });
    console.info(`${logPrefix} Raw model return value:`);
    console.info(rawContent ?? '(empty)');

    if (!rawContent) {
      const errorMessage = 'Model returned empty content';
      console.warn(`${logPrefix} ${errorMessage}`);

      const failurePayload = {
        error: errorMessage,
        requestId,
        attemptedBatchSize: scenes.length,
      };
      console.info(
        `${logPrefix} API return value (empty model content):`,
        failurePayload,
      );
      return Response.json(failurePayload, { status: 502 });
    }

    let parsed: unknown;
    try {
      parsed = tryParseJson(rawContent);
    } catch (error) {
      const errorMessage =
        error instanceof Error
          ? error.message
          : 'Failed to parse model response JSON';
      console.warn(`${logPrefix} Failed to parse model JSON response.`, {
        errorMessage,
        contentPreview: rawContent.slice(0, 400),
      });

      const parseFailurePayload = {
        error: errorMessage,
        requestId,
        attemptedBatchSize: scenes.length,
      };
      console.info(
        `${logPrefix} API return value (parse failure):`,
        parseFailurePayload,
      );
      return Response.json(parseFailurePayload, { status: 422 });
    }

    let sentences: ParsedSentence[];
    try {
      sentences = validateAndNormalizeModelOutput(
        parsed,
        scenes,
        (sceneId, diffPreview) => {
          console.warn(
            `${logPrefix} sourceText fuzzy match for scene ${sceneId}: ${diffPreview}. Using original input text.`,
          );
        },
      );
    } catch (error) {
      const errorMessage =
        error instanceof Error
          ? error.message
          : 'Model response failed validation';
      console.warn(`${logPrefix} Model response validation failed.`, {
        error: errorMessage,
        expectedSceneIds: sceneIds,
        returnedSceneIds: extractReturnedSceneIds(parsed),
      });

      const validationFailurePayload = {
        error: errorMessage,
        requestId,
        attemptedBatchSize: scenes.length,
      };
      console.info(
        `${logPrefix} API return value (validation failure):`,
        validationFailurePayload,
      );
      return Response.json(validationFailurePayload, { status: 422 });
    }

    console.info(`${logPrefix} Validation succeeded.`, {
      returnedSceneIds: sentences.map((s) => s.sceneId),
      attemptedBatchSize: scenes.length,
      durationMs: Date.now() - startedAt,
    });

    let unloadResult: Awaited<ReturnType<typeof unloadLocalModel>> | null =
      null;

    if (provider === 'local' && unloadModelAfter) {
      unloadResult = await unloadLocalModel({
        modelId: model,
        localBaseUrl: providerConfig.localEndpoint,
        localApiKey: providerConfig.localApiKey,
        localAdminApiKey: providerConfig.localAdminApiKey,
      });

      if (unloadResult.ok) {
        console.info(`${logPrefix} Local model unloaded successfully.`, {
          endpoint: unloadResult.endpoint,
          status: unloadResult.status,
          model,
        });
      } else {
        console.warn(`${logPrefix} Local model unload failed.`, {
          endpoint: unloadResult.endpoint,
          status: unloadResult.status,
          model,
          message: unloadResult.message,
        });
      }
    }

    const successPayload = {
      sentences,
      requestId,
      unloadModelAfter,
      unloadResult,
    };
    console.info(`${logPrefix} API return value (success):`, successPayload);
    return Response.json(successPayload);
  } catch (error) {
    console.error(`${logPrefix} Unhandled failure.`, error);
    const unhandledPayload = {
      error: getErrorMessage(error) || 'Failed to fix language for scenes',
      requestId,
    };
    console.info(
      `${logPrefix} API return value (unhandled error):`,
      unhandledPayload,
    );
    return Response.json(unhandledPayload, { status: 500 });
  }
}
