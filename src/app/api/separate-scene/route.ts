import { NextRequest, NextResponse } from 'next/server';
import { getBaserowToken, buildAuthHeader } from '@/lib/baserow-auth';

export const runtime = 'nodejs';

interface SceneSegment {
  id: number;
  words: string;
  duration: number;
  startTime: number;
  endTime: number;
  preEndTime: number;
  type: 'sentence' | 'gap';
  videoId: string;
}

interface WordSegment {
  word: string;
  start: number;
  end: number;
}

type TranscriptionData =
  | WordSegment[]
  | { Segments: WordSegment[] }
  | { segments: WordSegment[] }
  | { words: WordSegment[] };

const SCENES_TABLE_ID = '714';
const VIDEOS_TABLE_ID = '713';
const TIMING_DECIMALS = 6;
const TIMING_EPSILON = 1 / 10 ** TIMING_DECIMALS;
const TINY_EMPTY_SCENE_MAX_DURATION_SEC = 0.5;
const SPLIT_ORDER_STEP = 0.001;

const NON_DUPLICABLE_FIELD_KEYS = new Set([
  'id',
  'order',
  'field_6882', // Record ID / autonumber-like field should be regenerated
  'field_6905', // last modified / derived metadata
]);

const CLEARED_GENERATED_FIELDS: Record<string, unknown> = {
  field_6886: '', // Videos
  field_6888: '', // Video Clip URL
  field_6891: '', // TTS
  field_6910: '', // Captions URL for Scene
  field_7120: '', // Original Video Caption for Scene
  field_7105: '', // Fixed Sentence
  field_7094: '', // Image for Scene
  field_7098: '', // Video for Scene
  field_7095: '', // Upscaled Image for Scene
  field_7096: null, // Flagged
  field_7099: '', // hasText
};

function roundTiming(value: number): number {
  return Number(value.toFixed(TIMING_DECIMALS));
}

function formatTiming(value: number): string {
  return value.toFixed(TIMING_DECIMALS);
}

function parseFiniteNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') {
    const parsed = Number.parseFloat(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function parsePositiveInt(value: unknown): number | null {
  if (typeof value === 'number' && Number.isInteger(value) && value > 0) {
    return value;
  }
  if (typeof value === 'string') {
    const parsed = Number.parseInt(value, 10);
    return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
  }
  return null;
}

function hasPopulatedCaptionUrl(value: unknown): boolean {
  if (typeof value === 'string') {
    return value.trim().length > 0;
  }

  if (Array.isArray(value)) {
    return value.some((entry) => hasPopulatedCaptionUrl(entry));
  }

  if (value && typeof value === 'object') {
    const rec = value as Record<string, unknown>;
    return hasPopulatedCaptionUrl(
      rec.url ?? rec.value ?? rec.name ?? rec.text ?? rec.file,
    );
  }

  return false;
}

function extractLinkedVideoId(videoIdField: unknown): number | null {
  if (typeof videoIdField === 'number') {
    return Number.isFinite(videoIdField) ? videoIdField : null;
  }

  if (typeof videoIdField === 'string') {
    const parsed = Number.parseInt(videoIdField, 10);
    return Number.isFinite(parsed) ? parsed : null;
  }

  if (Array.isArray(videoIdField) && videoIdField.length > 0) {
    const first = videoIdField[0] as unknown;

    if (typeof first === 'number') {
      return Number.isFinite(first) ? first : null;
    }

    if (typeof first === 'string') {
      const parsed = Number.parseInt(first, 10);
      return Number.isFinite(parsed) ? parsed : null;
    }

    if (first && typeof first === 'object') {
      const rec = first as Record<string, unknown>;
      const candidate = rec.id ?? rec.value;
      const parsed = Number.parseInt(String(candidate ?? ''), 10);
      return Number.isFinite(parsed) ? parsed : null;
    }
  }

  if (videoIdField && typeof videoIdField === 'object') {
    const rec = videoIdField as Record<string, unknown>;
    const candidate = rec.id ?? rec.value;
    const parsed = Number.parseInt(String(candidate ?? ''), 10);
    return Number.isFinite(parsed) ? parsed : null;
  }

  return null;
}

function normalizeSceneIdList(values: unknown[]): number[] {
  const unique = new Set<number>();

  for (const value of values) {
    const parsed = parsePositiveInt(value);
    if (parsed !== null) {
      unique.add(parsed);
      continue;
    }

    if (value && typeof value === 'object') {
      const rec = value as Record<string, unknown>;
      const fromObject = parsePositiveInt(rec.id ?? rec.value);
      if (fromObject !== null) unique.add(fromObject);
    }
  }

  return [...unique];
}

function extractSceneIdsFromLinkedField(value: unknown): number[] {
  if (Array.isArray(value)) {
    return normalizeSceneIdList(value);
  }

  if (value === null || value === undefined) {
    return [];
  }

  return normalizeSceneIdList([value]);
}

function normalizeSingleSelectValue(value: unknown): number | string | null {
  if (typeof value === 'number') return value;
  if (typeof value === 'string') return value;
  if (typeof value === 'boolean') return value ? 'true' : 'false';

  if (Array.isArray(value) && value.length > 0) {
    const first = value[0] as unknown;
    if (typeof first === 'number') return first;
    if (typeof first === 'string') return first;
    if (first && typeof first === 'object') {
      const obj = first as Record<string, unknown>;
      if (typeof obj.id === 'number' || typeof obj.id === 'string') {
        return obj.id as number | string;
      }
      if (typeof obj.value === 'number' || typeof obj.value === 'string') {
        return obj.value as number | string;
      }
      if (typeof obj.name === 'string') return obj.name;
    }
  }

  if (value && typeof value === 'object') {
    const obj = value as Record<string, unknown>;
    if (typeof obj.id === 'number' || typeof obj.id === 'string') {
      return obj.id as number | string;
    }
    if (typeof obj.value === 'number' || typeof obj.value === 'string') {
      return obj.value as number | string;
    }
    if (typeof obj.name === 'string') return obj.name;
  }

  return null;
}

function normalizeCreatePayload(
  payload: Record<string, unknown>,
): Record<string, unknown> {
  const nextPayload: Record<string, unknown> = { ...payload };

  if (Object.prototype.hasOwnProperty.call(nextPayload, 'field_7096')) {
    const normalized = normalizeSingleSelectValue(nextPayload.field_7096);
    if (normalized === null) {
      delete nextPayload.field_7096;
    } else {
      nextPayload.field_7096 = normalized;
    }
  }

  return nextPayload;
}

function normalizeInputWords(words: unknown): WordSegment[] {
  if (!Array.isArray(words)) return [];

  return words
    .map((entry) => {
      if (!entry || typeof entry !== 'object') return null;
      const rec = entry as Record<string, unknown>;

      const rawWord =
        typeof rec.word === 'string'
          ? rec.word
          : typeof rec.text === 'string'
            ? rec.text
            : '';
      const word = rawWord.trim();
      if (!word) return null;

      const rawStart = parseFiniteNumber(rec.start);
      const rawEnd = parseFiniteNumber(rec.end);
      const start = Math.max(0, rawStart ?? 0);
      const end = Math.max(start, rawEnd ?? start);

      return {
        word,
        start,
        end,
      };
    })
    .filter((entry): entry is WordSegment => entry !== null)
    .sort((a, b) => a.start - b.start || a.end - b.end);
}

function extractWordSegments(
  transcriptionData: TranscriptionData,
): WordSegment[] {
  if (Array.isArray(transcriptionData)) {
    return transcriptionData as WordSegment[];
  }
  if ('Segments' in transcriptionData) {
    return transcriptionData.Segments;
  }
  if ('segments' in transcriptionData) {
    return transcriptionData.segments;
  }
  if ('words' in transcriptionData) {
    return transcriptionData.words;
  }
  return [];
}

function normalizeToken(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9']+/g, ' ')
    .trim();
}

function dedupeSentenceSegments(segments: SceneSegment[]): SceneSegment[] {
  const sentenceSegments: SceneSegment[] = [];
  const usedTimeRanges: Array<{ start: number; end: number }> = [];

  for (const segment of segments) {
    let isOverlapping = false;
    for (const used of usedTimeRanges) {
      const overlap =
        Math.min(segment.endTime, used.end) -
        Math.max(segment.startTime, used.start);
      const overlapRatio = overlap / (segment.endTime - segment.startTime);
      if (overlapRatio > 0.5) {
        isOverlapping = true;
        break;
      }
    }

    if (!isOverlapping) {
      sentenceSegments.push(segment);
      usedTimeRanges.push({ start: segment.startTime, end: segment.endTime });
    }
  }

  return sentenceSegments;
}

function buildSentenceSegmentsFromTranscription(
  transcriptionData: TranscriptionData,
  videoId: string,
): SceneSegment[] {
  const segments = extractWordSegments(transcriptionData);

  console.log(
    'Processing',
    segments.length,
    'word segments into sentences and gaps',
  );

  if (!Array.isArray(segments) || segments.length === 0) {
    throw new Error(
      `No segments found in transcription data. Available keys: ${Object.keys(
        transcriptionData || {},
      ).join(', ')}`,
    );
  }

  function isSentenceEnd(word: string): boolean {
    const abbreviations = [
      'mr',
      'mrs',
      'dr',
      'prof',
      'sr',
      'jr',
      'vs',
      'etc',
      'inc',
      'ltd',
      'co',
      'st',
      'ave',
      'blvd',
    ];
    const trimmed = word.trim();
    const cleanWord = trimmed.toLowerCase().replace(/[^a-z]/g, '');

    if (abbreviations.includes(cleanWord)) {
      return false;
    }

    if (!/[.!?]$/.test(trimmed)) {
      return false;
    }

    const withoutTrailing = trimmed.replace(/[.!?]+$/, '');
    if (/[a-z0-9]\.[a-z0-9]/i.test(withoutTrailing)) {
      return false;
    }

    return true;
  }

  const processedSegments: SceneSegment[] = [];
  let currentSegment = {
    id: 0,
    words: '',
    startTime: null as number | null,
    endTime: null as number | null,
  };

  for (let i = 0; i < segments.length; i++) {
    const wordObj = segments[i];

    let word: string, start: number, end: number;

    if (typeof wordObj === 'string') {
      throw new Error('Word objects must include timing information');
    } else if (
      wordObj.word &&
      typeof wordObj.start === 'number' &&
      typeof wordObj.end === 'number'
    ) {
      word = wordObj.word;
      start = wordObj.start;
      end = wordObj.end;
    } else {
      console.error('Unexpected word object structure:', wordObj);
      throw new Error(
        `Invalid word object structure at index ${i}: ${JSON.stringify(
          wordObj,
        )}`,
      );
    }

    if (currentSegment.startTime === null) {
      currentSegment.startTime = start;
    }

    const nextWordObj = i + 1 < segments.length ? segments[i + 1] : null;
    if (
      nextWordObj &&
      typeof nextWordObj !== 'string' &&
      typeof nextWordObj.word === 'string' &&
      typeof nextWordObj.start === 'number' &&
      typeof nextWordObj.end === 'number' &&
      /[.!?]$/.test(word)
    ) {
      const nextToken = normalizeToken(nextWordObj.word);
      const hasInternalDot = /[a-z0-9]\.[a-z0-9]/i.test(
        word.replace(/[.!?]+$/, ''),
      );
      const isLikelySuffix =
        [
          'js',
          'ts',
          'jsx',
          'tsx',
          'json',
          'ai',
          'io',
          'com',
          'net',
          'org',
        ].includes(nextToken) || /^[0-9]{1,3}$/.test(nextToken);

      if (!hasInternalDot && nextToken && isLikelySuffix) {
        const merged = `${word.replace(/[.!?]+$/, '')}.${nextWordObj.word}`;
        word = merged;
        end = nextWordObj.end;
        i += 1;
      }
    }

    currentSegment.words += (currentSegment.words ? ' ' : '') + word;
    currentSegment.endTime = end;

    if (isSentenceEnd(word)) {
      if (
        currentSegment.startTime !== null &&
        currentSegment.endTime !== null
      ) {
        const exactDuration = currentSegment.endTime - currentSegment.startTime;

        processedSegments.push({
          id: currentSegment.id,
          words: currentSegment.words.trim(),
          duration: exactDuration,
          startTime: currentSegment.startTime,
          endTime: currentSegment.endTime,
          preEndTime: 0,
          type: 'sentence',
          videoId,
        });
      }

      currentSegment = {
        id: processedSegments.length,
        words: '',
        startTime: null,
        endTime: null,
      };
    }
  }

  if (
    currentSegment.words &&
    currentSegment.startTime !== null &&
    currentSegment.endTime !== null
  ) {
    const exactDuration = currentSegment.endTime - currentSegment.startTime;

    processedSegments.push({
      id: currentSegment.id,
      words: currentSegment.words.trim(),
      duration: exactDuration,
      startTime: currentSegment.startTime,
      endTime: currentSegment.endTime,
      preEndTime: 0,
      type: 'sentence',
      videoId,
    });
  }

  return dedupeSentenceSegments(processedSegments);
}

function finalizeSegments(
  sentenceSegments: SceneSegment[],
  videoId: string,
  videoDuration?: number,
): SceneSegment[] {
  console.log(
    `After deduplication: ${sentenceSegments.length} unique sentences`,
  );

  const allSegments: SceneSegment[] = [];
  let segmentId = 0;
  const gapSet = new Set();
  const sentenceSet = new Set();

  if (
    sentenceSegments.length > 0 &&
    sentenceSegments[0].startTime !== null &&
    sentenceSegments[0].startTime > 0
  ) {
    allSegments.push({
      id: segmentId++,
      words: '',
      duration: roundTiming(sentenceSegments[0].startTime),
      startTime: 0,
      endTime: roundTiming(sentenceSegments[0].startTime),
      preEndTime: 0,
      type: 'gap',
      videoId,
    });
  }

  for (let i = 0; i < sentenceSegments.length; i++) {
    const sentence = sentenceSegments[i];

    if (sentence.startTime !== null && sentence.endTime !== null) {
      const sentenceKey = `${formatTiming(sentence.startTime)}-${formatTiming(
        sentence.endTime,
      )}-${sentence.words}`;
      if (!sentenceSet.has(sentenceKey)) {
        sentenceSet.add(sentenceKey);
        allSegments.push({
          id: segmentId++,
          words: sentence.words,
          duration: roundTiming(sentence.duration),
          startTime: roundTiming(sentence.startTime),
          endTime: roundTiming(sentence.endTime),
          preEndTime: 0,
          type: 'sentence',
          videoId,
        });
      }
    }

    if (i < sentenceSegments.length - 1) {
      const nextSentence = sentenceSegments[i + 1];
      if (sentence.endTime !== null && nextSentence.startTime !== null) {
        const gapStartTime = sentence.endTime;
        const gapEndTime = nextSentence.startTime;
        const gapDuration = gapEndTime - gapStartTime;

        const gapKey = `${formatTiming(gapStartTime)}-${formatTiming(
          gapEndTime,
        )}`;
        if (gapDuration !== 0 && !gapSet.has(gapKey)) {
          gapSet.add(gapKey);
          allSegments.push({
            id: segmentId++,
            words: '',
            duration: roundTiming(gapDuration),
            startTime: roundTiming(gapStartTime),
            endTime: roundTiming(gapEndTime),
            preEndTime: 0,
            type: 'gap',
            videoId,
          });
        }
      }
    }
  }

  console.log('Checking for trailing gap...');
  console.log('Video duration:', videoDuration);
  console.log('All segments count:', allSegments.length);

  if (
    videoDuration &&
    typeof videoDuration === 'number' &&
    allSegments.length > 0
  ) {
    let lastSentenceSegment = null;
    for (let i = allSegments.length - 1; i >= 0; i--) {
      if (allSegments[i].type === 'sentence') {
        lastSentenceSegment = allSegments[i];
        break;
      }
    }

    if (lastSentenceSegment && lastSentenceSegment.endTime < videoDuration) {
      const trailingGapDuration = videoDuration - lastSentenceSegment.endTime;
      if (trailingGapDuration > TIMING_EPSILON) {
        console.log(
          `✅ Adding trailing gap: ${formatTiming(
            trailingGapDuration,
          )}s (video ends at ${formatTiming(videoDuration)}s, last word at ${formatTiming(
            lastSentenceSegment.endTime,
          )}s)`,
        );
        allSegments.push({
          id: segmentId++,
          words: '',
          duration: roundTiming(trailingGapDuration),
          startTime: roundTiming(lastSentenceSegment.endTime),
          endTime: roundTiming(videoDuration),
          preEndTime: 0,
          type: 'gap',
          videoId,
        });
      } else {
        console.log(
          `⚠️ Trailing gap too small (${formatTiming(
            trailingGapDuration,
          )}s), not adding`,
        );
      }
    } else if (!lastSentenceSegment) {
      console.log('⚠️ No sentence segments found');
    } else {
      console.log(
        `⚠️ No trailing gap (last word at ${lastSentenceSegment.endTime}s, video ends at ${videoDuration}s)`,
      );
    }
  } else if (!videoDuration) {
    console.log(
      '⚠️ Video duration not provided - trailing silence cannot be detected',
    );
  } else if (typeof videoDuration !== 'number') {
    console.log(
      `⚠️ Video duration is not a number: ${typeof videoDuration} = ${videoDuration}`,
    );
  }

  console.log('Extending sentence end into following empty gaps...');
  for (let i = 0; i < allSegments.length - 1; i++) {
    const current = allSegments[i];
    const next = allSegments[i + 1];

    if (current.type !== 'sentence' || next.type !== 'gap') {
      continue;
    }

    const availableGap = next.endTime - next.startTime;
    if (availableGap <= 0) {
      continue;
    }

    const extendBy = Math.min(1, availableGap);

    current.endTime = roundTiming(current.endTime + extendBy);
    current.duration = roundTiming(current.duration + extendBy);
    next.startTime = roundTiming(next.startTime + extendBy);
    next.duration = roundTiming(next.endTime - next.startTime);
  }

  console.log('Adjusting timings based on gap durations...');

  for (let i = 0; i < allSegments.length; i++) {
    const segment = allSegments[i];

    if (segment.type === 'gap') {
      const gapDuration = segment.duration;

      if (gapDuration < 0) {
        const overlapDuration = Math.abs(gapDuration);
        console.log(
          `Processing negative gap ${formatTiming(gapDuration)}s at index ${i}`,
        );
        console.log(
          `Previous segment: ${allSegments[i - 1]?.type} ${
            allSegments[i - 1]?.startTime
              ? formatTiming(allSegments[i - 1].startTime)
              : 'n/a'
          }-${
            allSegments[i - 1]?.endTime
              ? formatTiming(allSegments[i - 1].endTime)
              : 'n/a'
          }`,
        );
        console.log(
          `Next segment: ${allSegments[i + 1]?.type} ${
            allSegments[i + 1]?.startTime
              ? formatTiming(allSegments[i + 1].startTime)
              : 'n/a'
          }-${
            allSegments[i + 1]?.endTime
              ? formatTiming(allSegments[i + 1].endTime)
              : 'n/a'
          }`,
        );

        if (i > 0 && allSegments[i - 1].type === 'sentence') {
          allSegments[i - 1].endTime = roundTiming(
            allSegments[i - 1].endTime - overlapDuration,
          );
          allSegments[i - 1].duration = roundTiming(
            allSegments[i - 1].duration - overlapDuration,
          );
          console.log(
            `Trimmed previous sentence by ${formatTiming(overlapDuration)}s to resolve overlap`,
          );
        }

        if (
          i < allSegments.length - 1 &&
          allSegments[i + 1].type === 'sentence'
        ) {
          allSegments[i + 1].startTime = roundTiming(
            allSegments[i + 1].startTime + overlapDuration,
          );
          allSegments[i + 1].duration = roundTiming(
            allSegments[i + 1].duration - overlapDuration,
          );
          console.log(
            `Adjusted next sentence start time by +${formatTiming(overlapDuration)}s to resolve overlap`,
          );
        }

        segment.startTime = roundTiming(segment.endTime);
        segment.duration = 0;
      } else if (gapDuration > 0.2) {
        const adjustAmount = 0.1;

        if (i > 0 && allSegments[i - 1].type === 'sentence') {
          allSegments[i - 1].endTime = roundTiming(
            allSegments[i - 1].endTime + adjustAmount,
          );
          allSegments[i - 1].duration = roundTiming(
            allSegments[i - 1].duration + adjustAmount,
          );
        }

        if (
          i < allSegments.length - 1 &&
          allSegments[i + 1].type === 'sentence'
        ) {
          allSegments[i + 1].startTime = roundTiming(
            allSegments[i + 1].startTime - adjustAmount,
          );
          allSegments[i + 1].duration = roundTiming(
            allSegments[i + 1].duration + adjustAmount,
          );
        }

        if (i > 0 && allSegments[i - 1].type === 'sentence') {
          segment.startTime = roundTiming(segment.startTime + adjustAmount);
          segment.duration = roundTiming(segment.duration - adjustAmount);
        }
        if (
          i < allSegments.length - 1 &&
          allSegments[i + 1].type === 'sentence'
        ) {
          segment.endTime = roundTiming(segment.endTime - adjustAmount);
          segment.duration = roundTiming(segment.duration - adjustAmount);
        }
      } else if (gapDuration > 0) {
        if (i > 0 && allSegments[i - 1].type === 'sentence') {
          allSegments[i - 1].endTime = roundTiming(
            allSegments[i - 1].endTime + gapDuration,
          );
          allSegments[i - 1].duration = roundTiming(
            allSegments[i - 1].duration + gapDuration,
          );
          console.log(
            `Absorbed ${formatTiming(gapDuration)}s gap into previous sentence (extended end time)`,
          );
        } else {
          if (
            i < allSegments.length - 1 &&
            allSegments[i + 1].type === 'sentence'
          ) {
            console.log(
              `Small gap ${formatTiming(gapDuration)}s before sentence - leaving as is to avoid overlap`,
            );
          }
        }

        segment.startTime = roundTiming(segment.endTime);
        segment.duration = 0;
      }
    }
  }

  const filteredSegments = allSegments.filter(
    (segment) => segment.duration > 0,
  );
  filteredSegments.forEach((segment, index) => {
    segment.id = index;
  });

  console.log(
    `After gap adjustments: ${filteredSegments.length} segments (removed ${
      allSegments.length - filteredSegments.length
    } zero-duration gaps)`,
  );

  console.log('Ensuring sequential timing...');
  for (let i = 1; i < filteredSegments.length; i++) {
    const currentSegment = filteredSegments[i];
    const previousSegment = filteredSegments[i - 1];

    if (currentSegment.startTime < previousSegment.endTime) {
      const overlap = previousSegment.endTime - currentSegment.startTime;
      currentSegment.startTime = previousSegment.endTime;
      currentSegment.endTime = roundTiming(
        currentSegment.startTime + currentSegment.duration,
      );
      console.log(
        `Fixed overlap: adjusted segment ${i} start time by +${formatTiming(
          overlap,
        )}s`,
      );
    }
  }

  console.log('Recalculating preEndTime values for adjusted timeline...');
  for (let i = 0; i < filteredSegments.length; i++) {
    if (i === 0) {
      filteredSegments[i].preEndTime = 0;
    } else {
      filteredSegments[i].preEndTime = roundTiming(
        filteredSegments[i - 1].endTime,
      );
    }
  }

  return filteredSegments;
}

function mergeTinyEmptyScenesIntoPrevious(
  segments: SceneSegment[],
  maxDurationSec: number = TINY_EMPTY_SCENE_MAX_DURATION_SEC,
): SceneSegment[] {
  if (!Array.isArray(segments) || segments.length === 0) {
    return [];
  }

  const mergedSegments: SceneSegment[] = [];

  for (const segment of segments) {
    const segmentWords = String(segment.words ?? '').trim();
    const isEmptyScene = segmentWords.length === 0;
    const isTinyScene =
      segment.duration > 0 && segment.duration < maxDurationSec;

    if (isEmptyScene && isTinyScene && mergedSegments.length > 0) {
      const previous = mergedSegments[mergedSegments.length - 1];
      const mergedEndTime = Math.max(previous.endTime, segment.endTime);

      previous.endTime = roundTiming(mergedEndTime);
      previous.duration = roundTiming(previous.endTime - previous.startTime);
      continue;
    }

    mergedSegments.push({ ...segment });
  }

  for (let i = 0; i < mergedSegments.length; i++) {
    const current = mergedSegments[i];
    current.id = i;
    current.duration = roundTiming(current.endTime - current.startTime);
    current.preEndTime =
      i === 0 ? 0 : roundTiming(mergedSegments[i - 1].endTime);
  }

  return mergedSegments;
}

function generateScenesFromTranscription(
  transcriptionData: TranscriptionData,
  videoId: string,
  videoDuration?: number,
): SceneSegment[] {
  const sentenceSegments = buildSentenceSegmentsFromTranscription(
    transcriptionData,
    videoId,
  );

  return finalizeSegments(sentenceSegments, videoId, videoDuration);
}

function convertRelativeSegmentsToAbsoluteTimeline(
  segments: SceneSegment[],
  sourceStart: number,
  sourceEnd: number,
): SceneSegment[] {
  const normalizedStart = roundTiming(sourceStart);
  const normalizedEnd = roundTiming(Math.max(sourceStart, sourceEnd));

  const sortedSegments = [...segments].sort(
    (a, b) => a.startTime - b.startTime || a.endTime - b.endTime,
  );

  const absolute: SceneSegment[] = [];
  let previousEnd = normalizedStart;

  for (const segment of sortedSegments) {
    const shiftedStart = roundTiming(sourceStart + segment.startTime);
    const shiftedEnd = roundTiming(sourceStart + segment.endTime);

    const boundedStart = roundTiming(
      Math.min(normalizedEnd, Math.max(normalizedStart, shiftedStart)),
    );
    const boundedEnd = roundTiming(
      Math.min(normalizedEnd, Math.max(normalizedStart, shiftedEnd)),
    );

    const startTime = roundTiming(Math.max(boundedStart, previousEnd));
    const endTime = roundTiming(Math.max(startTime, boundedEnd));
    const duration = roundTiming(endTime - startTime);

    if (duration <= TIMING_EPSILON) {
      previousEnd = endTime;
      continue;
    }

    absolute.push({
      ...segment,
      id: absolute.length,
      startTime,
      endTime,
      duration,
      preEndTime:
        absolute.length === 0 ? normalizedStart : roundTiming(previousEnd),
    });

    previousEnd = endTime;
  }

  if (absolute.length === 0) {
    const fallbackDuration = roundTiming(
      Math.max(0, normalizedEnd - normalizedStart),
    );

    if (fallbackDuration <= TIMING_EPSILON) {
      return [];
    }

    return [
      {
        id: 0,
        words: '',
        duration: fallbackDuration,
        startTime: normalizedStart,
        endTime: normalizedEnd,
        preEndTime: normalizedStart,
        type: 'gap',
        videoId: segments[0]?.videoId ?? '',
      },
    ];
  }

  return absolute.map((segment, index, allSegments) => ({
    ...segment,
    id: index,
    duration: roundTiming(segment.endTime - segment.startTime),
    preEndTime:
      index === 0
        ? normalizedStart
        : roundTiming(allSegments[index - 1].endTime),
  }));
}

function buildDuplicatePayload(
  sourceRow: Record<string, unknown>,
  overrides: Record<string, unknown>,
): Record<string, unknown> {
  const duplicated: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(sourceRow)) {
    if (!key.startsWith('field_')) continue;
    if (NON_DUPLICABLE_FIELD_KEYS.has(key)) continue;
    duplicated[key] = value;
  }

  return {
    ...duplicated,
    ...overrides,
  };
}

async function getTableRow(
  baserowUrl: string,
  tableId: string,
  rowId: number,
  token: string,
): Promise<Record<string, unknown>> {
  const response = await fetch(
    `${baserowUrl}/database/rows/table/${tableId}/${rowId}/`,
    {
      method: 'GET',
      headers: {
        ...buildAuthHeader(token),
      },
      cache: 'no-store',
    },
  );

  if (!response.ok) {
    const errorText = await response.text().catch(() => '');
    throw new Error(
      `Failed to fetch row ${rowId} from table ${tableId}: ${response.status} ${errorText}`,
    );
  }

  const data = (await response.json().catch(() => null)) as Record<
    string,
    unknown
  > | null;

  if (!data || typeof data !== 'object') {
    throw new Error(
      `Invalid row payload returned for table ${tableId}/${rowId}`,
    );
  }

  return data;
}

async function patchTableRow(
  baserowUrl: string,
  tableId: string,
  rowId: number,
  payload: Record<string, unknown>,
  token: string,
): Promise<Record<string, unknown>> {
  const response = await fetch(
    `${baserowUrl}/database/rows/table/${tableId}/${rowId}/`,
    {
      method: 'PATCH',
      headers: {
        ...buildAuthHeader(token),
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    },
  );

  if (!response.ok) {
    const errorText = await response.text().catch(() => '');
    throw new Error(
      `Failed to update row ${rowId} in table ${tableId}: ${response.status} ${errorText}`,
    );
  }

  const data = (await response.json().catch(() => null)) as Record<
    string,
    unknown
  > | null;

  if (!data || typeof data !== 'object') {
    throw new Error(
      `Invalid PATCH payload returned for table ${tableId}/${rowId}`,
    );
  }

  return data;
}

async function createTableRow(
  baserowUrl: string,
  tableId: string,
  payload: Record<string, unknown>,
  token: string,
  beforeRowId?: number,
): Promise<Record<string, unknown>> {
  const createUrl = new URL(`${baserowUrl}/database/rows/table/${tableId}/`);
  if (beforeRowId && Number.isInteger(beforeRowId) && beforeRowId > 0) {
    createUrl.searchParams.set('before', String(beforeRowId));
  }

  const response = await fetch(createUrl.toString(), {
    method: 'POST',
    headers: {
      ...buildAuthHeader(token),
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const errorText = await response.text().catch(() => '');
    throw new Error(
      `Failed to create row in table ${tableId}: ${response.status} ${errorText}`,
    );
  }

  const data = (await response.json().catch(() => null)) as Record<
    string,
    unknown
  > | null;

  if (!data || typeof data !== 'object') {
    throw new Error(`Invalid create payload returned for table ${tableId}`);
  }

  return data;
}

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json().catch(() => ({}))) as Record<
      string,
      unknown
    >;

    const sceneId = parsePositiveInt(body.sceneId);
    if (!sceneId) {
      return NextResponse.json(
        { error: 'sceneId is required' },
        { status: 400 },
      );
    }

    const editedWords = normalizeInputWords(
      body.editedWords ?? body.captionWords ?? body.words,
    );

    if (!editedWords.length) {
      return NextResponse.json(
        { error: 'editedWords must contain at least one timed word' },
        { status: 400 },
      );
    }

    const baserowUrl = process.env.BASEROW_API_URL;
    if (!baserowUrl) {
      return NextResponse.json(
        { error: 'Missing Baserow URL' },
        { status: 500 },
      );
    }

    const token = await getBaserowToken();

    const sourceScene = await getTableRow(
      baserowUrl,
      SCENES_TABLE_ID,
      sceneId,
      token,
    );

    const videoId = extractLinkedVideoId(sourceScene.field_6889);
    if (!videoId) {
      return NextResponse.json(
        { error: 'Could not resolve videoId (field_6889) for source scene' },
        { status: 400 },
      );
    }

    const videoRow = await getTableRow(
      baserowUrl,
      VIDEOS_TABLE_ID,
      videoId,
      token,
    );
    const existingSceneIds = extractSceneIdsFromLinkedField(
      videoRow.field_6866,
    );
    const sourceSceneIndexInVideo = existingSceneIds.indexOf(sceneId);
    const canonicalBeforeSceneId =
      sourceSceneIndexInVideo >= 0
        ? existingSceneIds[sourceSceneIndexInVideo + 1]
        : undefined;

    const sourceStart = parseFiniteNumber(sourceScene.field_6896) ?? 0;
    const sourceEndField = parseFiniteNumber(sourceScene.field_6897);
    const sourceDurationField = parseFiniteNumber(sourceScene.field_6884);
    const maxWordEnd = editedWords.reduce(
      (max, word) => Math.max(max, word.end),
      0,
    );

    const spanFromBounds =
      sourceEndField !== null ? Math.max(0, sourceEndField - sourceStart) : 0;

    const sourceDuration =
      spanFromBounds > TIMING_EPSILON
        ? spanFromBounds
        : sourceDurationField !== null && sourceDurationField > TIMING_EPSILON
          ? sourceDurationField
          : maxWordEnd;

    if (!Number.isFinite(sourceDuration) || sourceDuration <= TIMING_EPSILON) {
      return NextResponse.json(
        {
          error:
            'Could not determine a valid source scene duration for separation',
        },
        { status: 400 },
      );
    }

    const sourceEnd =
      sourceEndField !== null && sourceEndField > sourceStart
        ? sourceEndField
        : sourceStart + sourceDuration;

    const generatedSegments = generateScenesFromTranscription(
      editedWords,
      String(videoId),
      sourceDuration,
    );

    const postProcessedSegments =
      mergeTinyEmptyScenesIntoPrevious(generatedSegments);

    const absoluteSegments = convertRelativeSegmentsToAbsoluteTimeline(
      postProcessedSegments,
      sourceStart,
      sourceEnd,
    );

    // Duration reconciliation: pin the first segment's start and the last
    // segment's end to the original scene boundaries, then recompute all
    // durations sequentially. This guarantees:
    //   sum(durations) === sourceDuration  (exactly)
    // regardless of rounding drift from gap adjustments, extensions,
    // or overlap resolution in the pipeline above.
    if (absoluteSegments.length > 1) {
      const targetStartTime = roundTiming(sourceStart);
      const targetEndTime = roundTiming(sourceStart + sourceDuration);

      absoluteSegments[0].startTime = targetStartTime;
      absoluteSegments[0].duration = roundTiming(
        Math.max(0, absoluteSegments[0].endTime - targetStartTime),
      );

      const lastSegment = absoluteSegments[absoluteSegments.length - 1];
      lastSegment.endTime = targetEndTime;
      lastSegment.duration = roundTiming(
        Math.max(0, targetEndTime - lastSegment.startTime),
      );

      // Recompute preEndTime values sequentially after the adjustment.
      for (let i = 1; i < absoluteSegments.length; i++) {
        absoluteSegments[i].preEndTime = roundTiming(
          absoluteSegments[i - 1].endTime,
        );
      }
    }

    if (!absoluteSegments.length) {
      return NextResponse.json(
        { error: 'Separation produced zero output segments' },
        { status: 400 },
      );
    }

    // No-op guard: if separation results in only one scene, keep source scene
    // exactly as-is. Do not clear fields, update timings, create rows, or
    // relink scene IDs.
    if (absoluteSegments.length <= 1) {
      return NextResponse.json({
        success: true,
        skippedNoSplit: true,
        sceneId,
        videoId,
        segmentCount: absoluteSegments.length,
        createdSceneIds: [],
        linkedScenesUpdated: false,
        linkedSceneIds: existingSceneIds,
      });
    }

    const currentSceneOrder = parseFiniteNumber(sourceScene.field_7104);
    const fallbackSceneOrder = parseFiniteNumber(sourceScene.order) ?? 1;
    const baseSceneOrder =
      currentSceneOrder !== null ? currentSceneOrder : fallbackSceneOrder;

    const segmentPayloads = absoluteSegments.map((segment, index) => ({
      field_6890: segment.words,
      field_6901: segment.words,
      field_6896: segment.startTime,
      field_6897: segment.endTime,
      field_6898: segment.preEndTime,
      field_6884: segment.duration,
      field_7104: Number(
        (baseSceneOrder + index * SPLIT_ORDER_STEP).toFixed(3),
      ),
      ...CLEARED_GENERATED_FIELDS,
    }));

    let updatedSourceScene = await patchTableRow(
      baserowUrl,
      SCENES_TABLE_ID,
      sceneId,
      segmentPayloads[0],
      token,
    );

    const createdRows: Array<Record<string, unknown>> = [];

    for (let i = 1; i < segmentPayloads.length; i++) {
      const payload = normalizeCreatePayload(
        buildDuplicatePayload(sourceScene, segmentPayloads[i]),
      );

      const createdRow = await createTableRow(
        baserowUrl,
        SCENES_TABLE_ID,
        payload,
        token,
        canonicalBeforeSceneId,
      );

      createdRows.push(createdRow);
    }

    const createdSceneIds = normalizeSceneIdList(
      createdRows.map((row) => row.id),
    );

    const sceneIdsNeedingCaptionClear = new Set<number>();

    if (hasPopulatedCaptionUrl(updatedSourceScene.field_6910)) {
      sceneIdsNeedingCaptionClear.add(sceneId);
    }

    for (const row of createdRows) {
      const createdRowId = parsePositiveInt(row.id);
      if (createdRowId === null) continue;

      if (hasPopulatedCaptionUrl(row.field_6910)) {
        sceneIdsNeedingCaptionClear.add(createdRowId);
      }
    }

    for (const targetSceneId of sceneIdsNeedingCaptionClear) {
      const clearedScene = await patchTableRow(
        baserowUrl,
        SCENES_TABLE_ID,
        targetSceneId,
        { field_6910: '' },
        token,
      );

      if (targetSceneId === sceneId) {
        updatedSourceScene = clearedScene;
        continue;
      }

      const createdRowIndex = createdRows.findIndex((row) => {
        return parsePositiveInt(row.id) === targetSceneId;
      });

      if (createdRowIndex >= 0) {
        createdRows[createdRowIndex] = clearedScene;
      }
    }

    let linkedScenesUpdated = false;
    let linkedSceneIds: number[] = [];

    try {
      const baseIds =
        existingSceneIds.length > 0 ? [...existingSceneIds] : [sceneId];
      const sourceIndex =
        sourceSceneIndexInVideo >= 0
          ? sourceSceneIndexInVideo
          : baseIds.indexOf(sceneId);
      const insertAt = sourceIndex >= 0 ? sourceIndex + 1 : baseIds.length;

      baseIds.splice(insertAt, 0, ...createdSceneIds);
      linkedSceneIds = normalizeSceneIdList(baseIds);

      await patchTableRow(
        baserowUrl,
        VIDEOS_TABLE_ID,
        videoId,
        { field_6866: linkedSceneIds },
        token,
      );

      linkedScenesUpdated = true;
    } catch (linkError) {
      console.warn(
        `Failed to update linked scene IDs (field_6866) for video ${videoId}:`,
        linkError,
      );
    }

    return NextResponse.json({
      success: true,
      skippedNoSplit: false,
      sceneId,
      videoId,
      segmentCount: segmentPayloads.length,
      createdSceneIds,
      canonicalBeforeSceneId: canonicalBeforeSceneId ?? null,
      linkedScenesUpdated,
      linkedSceneIds,
      updatedSourceScene,
      createdScenes: createdRows,
    });
  } catch (error) {
    console.error('Error separating scene:', error);
    return NextResponse.json(
      {
        error: `Failed to separate scene: ${
          error instanceof Error ? error.message : 'Unknown error'
        }`,
      },
      { status: 500 },
    );
  }
}
