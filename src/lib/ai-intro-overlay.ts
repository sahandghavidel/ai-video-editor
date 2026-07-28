import { execFile } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { promisify } from 'util';
import {
  getOriginalVideoRow,
  getSceneById,
  type BaserowRow,
} from '@/lib/baserow-actions';
import { ensureVideoCached } from '@/utils/video-cache';
import type { AiIntroSourceSegment } from '@/components/ai-intro-overlay/types';

const execFileAsync = promisify(execFile);
const VIDEO_CACHE_MAX_AGE_MS = 30 * 60 * 1000;
const MAX_SOURCE_SEGMENTS_PER_PLACEMENT = 6;

export type TimedWord = {
  word: string;
  start: number;
  end: number;
};

type ProbeOutput = {
  streams?: Array<{
    codec_type?: string;
    width?: number;
    height?: number;
    duration?: string | number;
  }>;
  format?: { duration?: string | number };
};

export type AiIntroContext = {
  scene: BaserowRow;
  originalVideo: BaserowRow;
  sourceVideoUrl: string;
  sourceCaptionsUrl: string;
  linkedVideoId: number;
  sourceExcludeBefore: number;
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

function extractLinkedId(value: unknown): number | null {
  if (typeof value === 'number' && Number.isInteger(value) && value > 0) {
    return value;
  }
  if (typeof value === 'string') {
    const parsed = Number(value);
    return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
  }
  if (Array.isArray(value)) {
    for (const entry of value) {
      const parsed = extractLinkedId(entry);
      if (parsed) return parsed;
    }
    return null;
  }
  if (!value || typeof value !== 'object') return null;
  return extractLinkedId((value as Record<string, unknown>).id);
}

function finiteNumber(value: unknown, fallback = 0): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export async function loadAiIntroContext(
  sceneId: number,
): Promise<AiIntroContext> {
  if (!Number.isInteger(sceneId) || sceneId <= 0) {
    throw new Error('A valid scene ID is required.');
  }

  const scene = await getSceneById(sceneId);
  if (!scene) throw new Error('Scene not found.');

  const linkedVideoId = extractLinkedId(scene.field_6889);
  if (!linkedVideoId) {
    throw new Error('The scene is not linked to an original video.');
  }

  const originalVideo = await getOriginalVideoRow(linkedVideoId);
  const sourceVideoUrl = extractUrl(originalVideo.field_6881);
  const sourceCaptionsUrl = extractUrl(originalVideo.field_6861);

  if (!sourceVideoUrl) {
    throw new Error('The linked original video has no uploaded video URL.');
  }

  return {
    scene,
    originalVideo,
    sourceVideoUrl,
    sourceCaptionsUrl,
    linkedVideoId,
    sourceExcludeBefore: Math.max(
      0,
      finiteNumber(scene.field_6897, finiteNumber(scene.field_6896, 0)),
    ),
  };
}

export async function fetchTimedWords(url: string): Promise<TimedWord[]> {
  const response = await fetch(url, { cache: 'no-store' });
  if (!response.ok) {
    throw new Error(`Failed to load transcription (${response.status}).`);
  }

  const payload = (await response.json().catch(() => null)) as unknown;
  if (!Array.isArray(payload)) {
    throw new Error('The transcription file is not a word-timestamp array.');
  }

  return payload
    .map((item) => {
      const record =
        item && typeof item === 'object'
          ? (item as Record<string, unknown>)
          : {};
      return {
        word: String(record.word ?? record.text ?? '').trim(),
        start: finiteNumber(record.start, Number.NaN),
        end: finiteNumber(record.end, Number.NaN),
      };
    })
    .filter(
      (word) =>
        word.word &&
        Number.isFinite(word.start) &&
        Number.isFinite(word.end) &&
        word.end > word.start &&
        word.start >= 0,
    )
    .sort((a, b) => a.start - b.start);
}

export function wordsInRange(
  words: TimedWord[],
  startTime: number,
  endTime: number,
): TimedWord[] {
  return words.filter(
    (word) => word.end >= startTime && word.start <= endTime,
  );
}

export async function probeVideo(filePath: string): Promise<{
  duration: number;
  width: number;
  height: number;
}> {
  const { stdout } = await execFileAsync('ffprobe', [
    '-v',
    'quiet',
    '-print_format',
    'json',
    '-show_format',
    '-show_streams',
    filePath,
  ]);
  const data = JSON.parse(stdout) as ProbeOutput;
  const stream = data.streams?.find((entry) => entry.codec_type === 'video');
  const duration = finiteNumber(data.format?.duration ?? stream?.duration);
  const width = finiteNumber(stream?.width);
  const height = finiteNumber(stream?.height);
  if (!(duration > 0) || !(width > 0) || !(height > 0)) {
    throw new Error('Video dimensions or duration could not be determined.');
  }
  return { duration, width, height };
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function validateSegments(
  segments: AiIntroSourceSegment[],
  sourceDuration: number,
): AiIntroSourceSegment[] {
  if (
    !Array.isArray(segments) ||
    segments.length === 0 ||
    segments.length > MAX_SOURCE_SEGMENTS_PER_PLACEMENT
  ) {
    throw new Error('Each AI overlay needs between 1 and 6 source sections.');
  }

  return segments.map((segment, index) => {
    const startTime = clamp(Number(segment.startTime), 0, sourceDuration);
    const endTime = clamp(Number(segment.endTime), 0, sourceDuration);
    if (
      !Number.isFinite(startTime) ||
      !Number.isFinite(endTime) ||
      !(endTime > startTime)
    ) {
      throw new Error(`Source section ${index + 1} is invalid.`);
    }
    return { startTime, endTime };
  });
}

export async function prepareAiIntroSourcePreview(input: {
  sceneId: number;
  segments: AiIntroSourceSegment[];
}): Promise<Buffer> {
  const context = await loadAiIntroContext(input.sceneId);
  const sourcePath = await ensureVideoCached(context.sourceVideoUrl, {
    maxAgeMs: VIDEO_CACHE_MAX_AGE_MS,
  });
  const sourceProbe = await probeVideo(sourcePath);
  const segments = validateSegments(input.segments, sourceProbe.duration);
  const tempDir = await fs.promises.mkdtemp(
    path.join(os.tmpdir(), 'ai-intro-source-preview-'),
  );
  const outputPath = path.join(tempDir, 'preview.mp4');

  try {
    const filters = segments.map(
      (segment, index) =>
        `[0:v]trim=start=${segment.startTime}:end=${segment.endTime},setpts=PTS-STARTPTS[source${index}]`,
    );
    filters.push(
      `${segments.map((_, index) => `[source${index}]`).join('')}concat=n=${segments.length}:v=1:a=0[stitched]`,
    );
    filters.push(
      "[stitched]scale=w='if(gt(ih,720),-2,iw)':h='if(gt(ih,720),720,ih)',format=yuv420p[out]",
    );

    await execFileAsync(
      'ffmpeg',
      [
        '-hide_banner',
        '-loglevel',
        'error',
        '-i',
        sourcePath,
        '-filter_complex',
        filters.join(';'),
        '-map',
        '[out]',
        '-an',
        '-c:v',
        'libx264',
        '-preset',
        'ultrafast',
        '-crf',
        '28',
        '-pix_fmt',
        'yuv420p',
        '-movflags',
        '+faststart',
        outputPath,
      ],
      { maxBuffer: 16 * 1024 * 1024 },
    );

    return await fs.promises.readFile(outputPath);
  } finally {
    await fs.promises
      .rm(tempDir, { recursive: true, force: true })
      .catch(() => undefined);
  }
}
