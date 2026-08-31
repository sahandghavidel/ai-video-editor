import { resolveOpenAIClient, withOpenRouterNitro } from '@/lib/ai-provider';
import {
  fetchTimedWords,
  loadAiIntroContext,
  wordsInRange,
  type TimedWord,
} from '@/lib/ai-intro-overlay';
import { getFinalVideoCaptionStatus } from '@/utils/finalVideoCaptions';
import type {
  AiIntroClipSuggestion,
  AiIntroSuggestionResponse,
} from '@/components/ai-intro-overlay/types';

export const runtime = 'nodejs';

type TranscriptWindow = {
  id: string;
  start: number;
  end: number;
  text: string;
  words: TimedWord[];
};

type ModelSuggestion = {
  candidateId?: unknown;
  startTime?: unknown;
  endTime?: unknown;
  reason?: unknown;
};

function extractUrl(value: unknown): string {
  if (typeof value === 'string') return value.trim();
  if (Array.isArray(value)) {
    for (const entry of value) {
      const resolved = extractUrl(entry);
      if (resolved) return resolved;
    }
    return '';
  }
  if (!value || typeof value !== 'object') return '';
  const record = value as Record<string, unknown>;
  return (
    extractUrl(record.url) ||
    extractUrl(record.value) ||
    extractUrl(record.file)
  );
}

function resolveSceneCaptionsUrl(scene: Record<string, unknown>): string {
  const candidateKeys = [
    'field_6910',
    'Captions URL',
    'captions_url',
    'CaptionsURL',
    'captions URL',
    'field_6892',
    'field_6893',
    'field_6894',
    'field_6895',
    'field_6897',
    'field_6898',
    'field_6899',
  ];
  for (const key of candidateKeys) {
    const resolved = extractUrl(scene[key]);
    if (
      resolved &&
      (resolved.startsWith('http') || resolved.includes('.json'))
    ) {
      return resolved;
    }
  }
  return '';
}

function buildTranscriptWindows(
  words: TimedWord[],
  excludeBefore: number,
): TranscriptWindow[] {
  const eligible = words.filter((word) => word.end > excludeBefore);
  if (eligible.length === 0) return [];

  const span = Math.max(
    1,
    eligible[eligible.length - 1].end - eligible[0].start,
  );
  const windowSeconds = Math.max(8, Math.ceil(span / 240));
  const buckets = new Map<number, TimedWord[]>();

  eligible.forEach((word) => {
    const bucket = Math.floor((word.start - eligible[0].start) / windowSeconds);
    const existing = buckets.get(bucket) ?? [];
    existing.push(word);
    buckets.set(bucket, existing);
  });

  return Array.from(buckets.entries())
    .map(([bucket, bucketWords]) => ({
      id: `C${bucket + 1}`,
      start: bucketWords[0].start,
      end: bucketWords[bucketWords.length - 1].end,
      text: bucketWords
        .map((word) => word.word)
        .join(' ')
        .slice(0, 320),
      words: bucketWords,
    }))
    .slice(0, 260);
}

function parseModelJson(raw: string): ModelSuggestion[] {
  const cleaned = raw
    .trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/i, '');
  const firstBrace = cleaned.indexOf('{');
  const lastBrace = cleaned.lastIndexOf('}');
  const candidate =
    firstBrace >= 0 && lastBrace > firstBrace
      ? cleaned.slice(firstBrace, lastBrace + 1)
      : cleaned;
  const parsed = JSON.parse(candidate) as {
    suggestions?: unknown;
  };
  return Array.isArray(parsed.suggestions)
    ? (parsed.suggestions as ModelSuggestion[])
    : [];
}

function closestWordBy(
  words: TimedWord[],
  value: number,
  key: 'start' | 'end',
): TimedWord {
  return words.reduce((closest, word) =>
    Math.abs(word[key] - value) < Math.abs(closest[key] - value)
      ? word
      : closest,
  );
}

function normalizeSuggestion(
  raw: ModelSuggestion,
  windowsById: Map<string, TranscriptWindow>,
  targetDuration: number,
  index: number,
): AiIntroClipSuggestion | null {
  const candidateId = String(raw.candidateId ?? '').trim();
  const window = windowsById.get(candidateId);
  if (!window || window.words.length === 0) return null;

  const requestedStart = Number(raw.startTime);
  const requestedEnd = Number(raw.endTime);
  const fallbackStart = window.start;
  const fallbackEnd = Math.min(
    window.end,
    fallbackStart + Math.max(0.5, targetDuration),
  );
  const startWord = closestWordBy(
    window.words,
    Number.isFinite(requestedStart) ? requestedStart : fallbackStart,
    'start',
  );
  const endWord = closestWordBy(
    window.words,
    Number.isFinite(requestedEnd) ? requestedEnd : fallbackEnd,
    'end',
  );
  const sourceStartTime = startWord.start;
  let sourceEndTime = endWord.end;

  if (!(sourceEndTime > sourceStartTime)) {
    sourceEndTime = Math.min(
      window.end,
      sourceStartTime + Math.max(0.5, targetDuration),
    );
  }
  if (!(sourceEndTime > sourceStartTime)) return null;

  const selectedWords = wordsInRange(
    window.words,
    sourceStartTime,
    sourceEndTime,
  );
  const transcript = selectedWords.map((word) => word.word).join(' ').trim();
  if (!transcript) return null;

  return {
    id: `${candidateId}-${index + 1}-${sourceStartTime.toFixed(3)}`,
    sourceStartTime,
    sourceEndTime,
    transcript,
    reason: String(raw.reason ?? '').trim() || 'Matches the selected intro text.',
  };
}

export async function POST(request: Request) {
  try {
    const body = (await request.json().catch(() => null)) as {
      sceneId?: unknown;
      targetStartTime?: unknown;
      targetEndTime?: unknown;
      model?: unknown;
      provider?: unknown;
      localEndpoint?: unknown;
      localApiKey?: unknown;
    } | null;
    const sceneId = Number(body?.sceneId);
    const targetStartTime = Number(body?.targetStartTime);
    const targetEndTime = Number(body?.targetEndTime);
    const targetDuration = targetEndTime - targetStartTime;

    if (
      !Number.isInteger(sceneId) ||
      sceneId <= 0 ||
      !Number.isFinite(targetStartTime) ||
      !Number.isFinite(targetEndTime) ||
      targetStartTime < 0 ||
      !(targetDuration > 0) ||
      targetDuration > 30
    ) {
      return Response.json(
        {
          error:
            'Choose a valid transcript range up to 30 seconds before requesting an AI clip.',
        },
        { status: 400 },
      );
    }

    const context = await loadAiIntroContext(sceneId);
    if (!context.sourceCaptionsUrl) {
      return Response.json(
        {
          error:
            'The linked original video needs a transcription before AI clip selection can run.',
        },
        { status: 400 },
      );
    }
    const sceneCaptionsUrl = resolveSceneCaptionsUrl(context.scene);
    const captionStatus = getFinalVideoCaptionStatus({
      sceneId,
      finalVideoUrl: extractUrl(context.scene.field_6886),
      captionsUrl: sceneCaptionsUrl,
    });
    if (captionStatus.status !== 'matched') {
      return Response.json(
        {
          error:
            `The current scene needs an up-to-date final-video transcription before AI clip selection can run (${captionStatus.status} captions).`,
        },
        { status: 400 },
      );
    }

    const [sceneWords, sourceWords] = await Promise.all([
      fetchTimedWords(sceneCaptionsUrl),
      fetchTimedWords(context.sourceCaptionsUrl),
    ]);
    const selectedTargetWords = wordsInRange(
      sceneWords,
      targetStartTime,
      targetEndTime,
    );
    const targetText = selectedTargetWords
      .map((word) => word.word)
      .join(' ')
      .trim();
    if (!targetText) {
      return Response.json(
        { error: 'No transcribed words exist inside the selected range.' },
        { status: 400 },
      );
    }

    const windows = buildTranscriptWindows(
      sourceWords,
      context.sourceExcludeBefore,
    );
    if (windows.length === 0) {
      return Response.json(
        { error: 'No later transcript sections are available to suggest.' },
        { status: 400 },
      );
    }

    const { client, provider, missingApiKey } = resolveOpenAIClient(
      request,
      body,
    );
    if (!client || missingApiKey) {
      return Response.json(
        {
          error:
            provider === 'online'
              ? 'Missing OpenRouter API key.'
              : 'Failed to initialize the local AI provider.',
        },
        { status: 500 },
      );
    }

    const candidateText = windows
      .map(
        (window) =>
          `${window.id} | ${window.start.toFixed(2)}-${window.end.toFixed(2)} | ${window.text}`,
      )
      .join('\n');
    const prompt = `Choose up to 3 later moments from the source-video transcript that would make strong visual B-roll for the selected intro words.

SELECTED INTRO RANGE
Time: ${targetStartTime.toFixed(2)}-${targetEndTime.toFixed(2)}
Duration: ${targetDuration.toFixed(2)} seconds
Words: ${targetText}

LATER SOURCE TRANSCRIPT CANDIDATES
${candidateText}

Rules:
- Choose only from the listed candidate IDs.
- Prefer a visible result, interaction, transformation, comparison, or concrete demonstration.
- Avoid greetings, setup, repeated narration, silence, and transitions.
- Pick a source range close to the target duration, normally 2-6 seconds.
- startTime and endTime must stay inside the chosen candidate's listed time range.
- Return JSON only in this exact shape:
{"suggestions":[{"candidateId":"C1","startTime":12.3,"endTime":16.7,"reason":"short reason"}]}`;

    const completion = await client.chat.completions.create({
      model: withOpenRouterNitro(
        typeof body?.model === 'string' && body.model.trim()
          ? body.model.trim()
          : 'deepseek/deepseek-v3.2-exp',
        provider,
      ),
      messages: [
        {
          role: 'system',
          content:
            'You are a precise video editor. Return valid JSON only and never invent candidate IDs.',
        },
        { role: 'user', content: prompt },
      ],
      temperature: 0.15,
    });
    const raw = completion.choices?.[0]?.message?.content?.trim() ?? '';
    if (!raw) throw new Error('The model returned no clip suggestions.');

    const modelSuggestions = parseModelJson(raw);
    const windowsById = new Map(windows.map((window) => [window.id, window]));
    const suggestions = modelSuggestions
      .map((suggestion, index) =>
        normalizeSuggestion(
          suggestion,
          windowsById,
          targetDuration,
          index,
        ),
      )
      .filter(
        (suggestion): suggestion is AiIntroClipSuggestion =>
          suggestion !== null,
      )
      .filter(
        (suggestion, index, all) =>
          all.findIndex(
            (candidate) =>
              Math.abs(
                candidate.sourceStartTime - suggestion.sourceStartTime,
              ) < 0.05 &&
              Math.abs(candidate.sourceEndTime - suggestion.sourceEndTime) <
                0.05,
          ) === index,
      )
      .slice(0, 3);

    if (suggestions.length === 0) {
      throw new Error(
        'The model did not return any transcript-backed clip suggestions.',
      );
    }

    const sourceDuration = Math.max(
      Number(context.originalVideo.field_6909) || 0,
      sourceWords[sourceWords.length - 1]?.end || 0,
    );
    const response: AiIntroSuggestionResponse = {
      sourceDuration,
      targetText,
      suggestions,
    };
    return Response.json(response);
  } catch (error) {
    console.error('suggest-ai-intro-clip error:', error);
    return Response.json(
      {
        error:
          error instanceof Error
            ? error.message
            : 'Failed to suggest an AI intro clip.',
      },
      { status: 500 },
    );
  }
}
