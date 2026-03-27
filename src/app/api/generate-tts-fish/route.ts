import { NextRequest, NextResponse } from 'next/server';
import { Agent } from 'undici';
import { execFile, spawn } from 'node:child_process';
import { promises as fs } from 'node:fs';
import { constants as fsConstants } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';

export const runtime = 'nodejs';
export const maxDuration = 900;

const FISH_HEADERS_TIMEOUT_MS = 60 * 60 * 1000; // 60 minutes
const FISH_BODY_TIMEOUT_MS = 60 * 60 * 1000; // 60 minutes
const FISH_ABORT_TIMEOUT_MS = 65 * 60 * 1000; // 65 minutes safety cap

const FISH_DEFAULT_MAX_NEW_TOKENS = 4096;
const FISH_LONG_TEXT_THRESHOLD_CHARS = 900;
const FISH_DEFAULT_CHUNK_LENGTH = 300;
const FISH_LONG_TEXT_MIN_CHUNK_LENGTH = 500;
const FISH_MAX_SEGMENT_CHARS = 1300;
const FISH_CONNECT_RETRIES = 6;
const FISH_CONNECT_RETRY_DELAY_MS = 1500;
const FISH_HEALTHCHECK_TIMEOUT_MS = 2000;
const FISH_BOOT_POLL_INTERVAL_MS = 1500;
const FISH_BOOT_WAIT_MAX_MS = 90 * 1000;
const FISH_BOOT_COOLDOWN_MS = 15 * 1000;

const fishFetchDispatcher = new Agent({
  headersTimeout: FISH_HEADERS_TIMEOUT_MS,
  bodyTimeout: FISH_BODY_TIMEOUT_MS,
});

const execFileAsync = promisify(execFile);

type GlobalWithFishBootstrap = typeof globalThis & {
  __fishBootstrapPromise?: Promise<boolean>;
  __fishBootstrapLastAttemptAt?: number;
};

const fishBootstrapGlobal = globalThis as GlobalWithFishBootstrap;

type FishFormat = 'wav' | 'mp3' | 'opus' | 'pcm';
type FishLatency = 'normal' | 'balanced';
type FishCache = 'on' | 'off';

interface FishTtsSettings {
  apiBaseUrl?: string;
  apiKey?: string;
  referenceId?: string;
  format?: FishFormat;
  latency?: FishLatency;
  chunk_length?: number;
  max_new_tokens?: number;
  top_p?: number;
  repetition_penalty?: number;
  temperature?: number;
  use_memory_cache?: FishCache;
}

interface RequestBody {
  text?: unknown;
  sceneId?: unknown;
  videoId?: unknown;
  ttsSettings?: {
    seed?: number;
    fish?: FishTtsSettings;
  };
}

interface FishPayload {
  text: string;
  references: unknown[];
  reference_id: string | null;
  format: FishFormat;
  latency: FishLatency;
  max_new_tokens: number;
  chunk_length: number;
  top_p: number;
  repetition_penalty: number;
  temperature: number;
  streaming: boolean;
  use_memory_cache: FishCache;
  seed?: number;
}

function toPositiveInt(value: unknown, fallback: number): number {
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(1, Math.trunc(n));
}

function toFiniteNumber(value: unknown, fallback: number): number {
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(n)) return fallback;
  return n;
}

function normalizeBaseUrl(raw: string | undefined): string {
  const fallback =
    process.env.FISH_TTS_BASE_URL ||
    process.env.NEXT_PUBLIC_FISH_TTS_BASE_URL ||
    'http://127.0.0.1:8080';

  const value = (raw || fallback).trim();
  return value.endsWith('/') ? value.slice(0, -1) : value;
}

function extractUpstreamErrorCode(error: unknown): string | null {
  if (!(error instanceof Error)) return null;
  const cause = (error as Error & { cause?: unknown }).cause;
  if (!cause || typeof cause !== 'object') return null;
  if (!('code' in cause)) return null;
  const code = (cause as { code?: unknown }).code;
  return typeof code === 'string' ? code : null;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isLocalFishBaseUrl(baseUrl: string): boolean {
  try {
    const parsed = new URL(baseUrl);
    const host = parsed.hostname.toLowerCase();
    return host === '127.0.0.1' || host === 'localhost' || host === '::1';
  } catch {
    return false;
  }
}

async function isFishHealthy(fishBaseUrl: string): Promise<boolean> {
  const controller = new AbortController();
  const timeout = setTimeout(() => {
    try {
      controller.abort();
    } catch {
      // ignore
    }
  }, FISH_HEALTHCHECK_TIMEOUT_MS);

  try {
    const health = await fetch(`${fishBaseUrl}/v1/health`, {
      method: 'GET',
      signal: controller.signal,
      dispatcher: fishFetchDispatcher,
    } as unknown as RequestInit);
    return health.ok;
  } catch {
    return false;
  } finally {
    clearTimeout(timeout);
  }
}

async function startLocalFishServerIfAvailable(): Promise<boolean> {
  const scriptPath = path.join(
    process.cwd(),
    'fish-speech-s2-pro',
    'start_fish_mps.sh',
  );

  try {
    await fs.access(scriptPath, fsConstants.X_OK);
  } catch {
    return false;
  }

  try {
    const child = spawn(scriptPath, [], {
      cwd: path.dirname(scriptPath),
      detached: true,
      stdio: 'ignore',
    });
    child.unref();
    return true;
  } catch {
    return false;
  }
}

async function ensureFishServerReady(fishBaseUrl: string): Promise<void> {
  if (await isFishHealthy(fishBaseUrl)) {
    return;
  }

  if (!isLocalFishBaseUrl(fishBaseUrl)) {
    return;
  }

  if (fishBootstrapGlobal.__fishBootstrapPromise) {
    await fishBootstrapGlobal.__fishBootstrapPromise;
    return;
  }

  fishBootstrapGlobal.__fishBootstrapPromise = (async () => {
    const now = Date.now();
    const lastAttempt = fishBootstrapGlobal.__fishBootstrapLastAttemptAt || 0;

    if (now - lastAttempt >= FISH_BOOT_COOLDOWN_MS) {
      fishBootstrapGlobal.__fishBootstrapLastAttemptAt = now;
      await startLocalFishServerIfAvailable();
    }

    const deadline = Date.now() + FISH_BOOT_WAIT_MAX_MS;
    while (Date.now() < deadline) {
      if (await isFishHealthy(fishBaseUrl)) {
        return true;
      }
      await sleep(FISH_BOOT_POLL_INTERVAL_MS);
    }

    return false;
  })().finally(() => {
    fishBootstrapGlobal.__fishBootstrapPromise = undefined;
  });

  await fishBootstrapGlobal.__fishBootstrapPromise;
}

async function fetchFishWithRetry(
  url: string,
  init: RequestInit,
): Promise<Response> {
  let lastError: unknown;

  for (let attempt = 1; attempt <= FISH_CONNECT_RETRIES + 1; attempt += 1) {
    try {
      return await fetch(url, init);
    } catch (error) {
      lastError = error;
      const code = extractUpstreamErrorCode(error);
      const retryable =
        code === 'ECONNREFUSED' ||
        code === 'UND_ERR_CONNECT_TIMEOUT' ||
        code === 'ENOTFOUND' ||
        code === 'EAI_AGAIN';

      if (!retryable || attempt > FISH_CONNECT_RETRIES) {
        throw error;
      }

      await sleep(FISH_CONNECT_RETRY_DELAY_MS);
    }
  }

  throw lastError;
}

function splitTextIntoFishSegments(text: string): string[] {
  const normalized = text.replace(/\s+/g, ' ').trim();
  if (!normalized) return [];

  const sentences = normalized.match(/[^.!?]+[.!?]+|[^.!?]+$/g) || [normalized];
  const segments: string[] = [];

  for (const sentenceRaw of sentences) {
    const sentence = sentenceRaw.trim();
    if (!sentence) continue;

    if (sentence.length > FISH_MAX_SEGMENT_CHARS) {
      const words = sentence.split(' ');
      let sub = '';
      for (const word of words) {
        const candidate = sub ? `${sub} ${word}` : word;
        if (candidate.length > FISH_MAX_SEGMENT_CHARS && sub) {
          segments.push(sub.trim());
          sub = word;
        } else {
          sub = candidate;
        }
      }
      if (sub.trim()) segments.push(sub.trim());
      continue;
    }

    // One sentence per chunk to preserve delivery consistency across joins.
    segments.push(sentence);
  }

  return segments.length > 0 ? segments : [normalized];
}

function toStableSeed(value: unknown): number | null {
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(n)) return null;
  const seed = Math.trunc(n);
  if (seed === 0) return 1;
  return Math.abs(seed);
}

function deriveDeterministicSeed(input: string): number {
  let hash = 2166136261;
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  const normalized = hash >>> 0;
  return normalized === 0 ? 1 : normalized;
}

function quoteConcatFilePath(filePath: string): string {
  return filePath.replace(/'/g, "'\\''");
}

async function resolveFfmpegBinary(): Promise<string> {
  const localBinary = path.join(
    process.cwd(),
    'REAL-Video-Enhancer',
    'bin',
    'ffmpeg',
  );
  const candidates = [process.env.FFMPEG_PATH, localBinary].filter(
    (v): v is string => typeof v === 'string' && v.trim().length > 0,
  );

  for (const candidate of candidates) {
    try {
      await fs.access(candidate, fsConstants.X_OK);
      return candidate;
    } catch {
      // try next candidate
    }
  }

  return 'ffmpeg';
}

async function concatWavBuffersWithFfmpeg(
  chunks: ArrayBuffer[],
): Promise<Buffer> {
  if (chunks.length === 0) {
    throw new Error('No WAV chunks to concatenate');
  }

  if (chunks.length === 1) {
    return Buffer.from(chunks[0]);
  }

  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'fish-tts-'));
  try {
    const listPath = path.join(tempDir, 'inputs.txt');
    const outPath = path.join(tempDir, 'merged.wav');

    const listEntries: string[] = [];
    for (let i = 0; i < chunks.length; i += 1) {
      const chunkPath = path.join(tempDir, `part_${i}.wav`);
      await fs.writeFile(chunkPath, Buffer.from(chunks[i]));
      listEntries.push(`file '${quoteConcatFilePath(chunkPath)}'`);
    }

    await fs.writeFile(listPath, `${listEntries.join('\n')}\n`, 'utf8');

    const ffmpegBin = await resolveFfmpegBinary();
    await execFileAsync(ffmpegBin, [
      '-y',
      '-f',
      'concat',
      '-safe',
      '0',
      '-i',
      listPath,
      '-vn',
      '-acodec',
      'pcm_s16le',
      outPath,
    ]);

    return await fs.readFile(outPath);
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true });
  }
}

async function transcodeWavBufferWithFfmpeg(
  wavBuffer: Buffer,
  targetFormat: Exclude<FishFormat, 'wav'>,
): Promise<Buffer> {
  const tempDir = await fs.mkdtemp(
    path.join(os.tmpdir(), 'fish-tts-transcode-'),
  );
  try {
    const inPath = path.join(tempDir, 'input.wav');
    const outExt = targetFormat === 'opus' ? 'opus' : targetFormat;
    const outPath = path.join(tempDir, `output.${outExt}`);

    await fs.writeFile(inPath, wavBuffer);

    const ffmpegBin = await resolveFfmpegBinary();
    const argsByFormat: Record<Exclude<FishFormat, 'wav'>, string[]> = {
      mp3: ['-i', inPath, '-vn', '-acodec', 'libmp3lame', '-q:a', '2', outPath],
      opus: ['-i', inPath, '-vn', '-acodec', 'libopus', '-b:a', '96k', outPath],
      pcm: [
        '-i',
        inPath,
        '-vn',
        '-f',
        's16le',
        '-acodec',
        'pcm_s16le',
        outPath,
      ],
    };

    await execFileAsync(ffmpegBin, ['-y', ...argsByFormat[targetFormat]]);
    return await fs.readFile(outPath);
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true });
  }
}

async function synthesizeFishChunk(
  fishBaseUrl: string,
  headers: Record<string, string>,
  payload: FishPayload,
  signal: AbortSignal,
): Promise<Response> {
  return fetchFishWithRetry(`${fishBaseUrl}/v1/tts`, {
    method: 'POST',
    headers,
    body: JSON.stringify(payload),
    signal,
    // undici-specific option for Node fetch
    dispatcher: fishFetchDispatcher,
  } as unknown as RequestInit);
}

function estimateRecommendedMaxNewTokens(text: string): number {
  const normalizedText = text.trim();
  if (!normalizedText) return FISH_DEFAULT_MAX_NEW_TOKENS;

  const words = normalizedText.split(/\s+/).filter(Boolean).length;
  const chars = normalizedText.length;

  // Intentionally generous to avoid truncated outputs on longer content.
  const byWordCount = Math.ceil(words * 6.0);
  const byCharCount = Math.ceil(chars * 2.2);

  return Math.max(FISH_DEFAULT_MAX_NEW_TOKENS, byWordCount, byCharCount);
}

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as RequestBody;
    const text = typeof body.text === 'string' ? body.text.trim() : '';

    const hasSceneId =
      body.sceneId !== undefined &&
      body.sceneId !== null &&
      String(body.sceneId).trim().length > 0;
    const hasVideoId =
      body.videoId !== undefined &&
      body.videoId !== null &&
      String(body.videoId).trim().length > 0;

    if (!text || (!hasSceneId && !hasVideoId)) {
      return NextResponse.json(
        { error: 'Text and (sceneId or videoId) are required' },
        { status: 400 },
      );
    }

    const fish = body.ttsSettings?.fish || {};
    const fishBaseUrl = normalizeBaseUrl(fish.apiBaseUrl);
    await ensureFishServerReady(fishBaseUrl);
    const apiKey = (fish.apiKey || process.env.FISH_TTS_API_KEY || '').trim();
    const referenceId =
      (fish.referenceId || process.env.FISH_TTS_REFERENCE_ID || '').trim() ||
      null;

    const format: FishFormat = fish.format || 'wav';
    const latency: FishLatency = fish.latency || 'normal';

    const requestedMaxNewTokens = toPositiveInt(
      fish.max_new_tokens,
      FISH_DEFAULT_MAX_NEW_TOKENS,
    );
    const recommendedMaxNewTokens = estimateRecommendedMaxNewTokens(text);
    const maxNewTokens = Math.max(
      requestedMaxNewTokens,
      recommendedMaxNewTokens,
    );

    const requestedChunkLength = Math.max(
      100,
      Math.min(
        1000,
        toPositiveInt(fish.chunk_length, FISH_DEFAULT_CHUNK_LENGTH),
      ),
    );
    const chunkLength =
      text.length >= FISH_LONG_TEXT_THRESHOLD_CHARS
        ? Math.max(requestedChunkLength, FISH_LONG_TEXT_MIN_CHUNK_LENGTH)
        : requestedChunkLength;

    const requestedSeed = toStableSeed(body.ttsSettings?.seed);
    const stableSeed =
      requestedSeed ??
      deriveDeterministicSeed(
        `${hasVideoId ? String(body.videoId) : ''}|${
          hasSceneId ? String(body.sceneId) : ''
        }|${text}`,
      );

    const fishPayload: FishPayload = {
      text,
      references: [],
      reference_id: referenceId,
      format,
      latency,
      max_new_tokens: maxNewTokens,
      chunk_length: chunkLength,
      top_p: Math.max(0.1, Math.min(1.0, toFiniteNumber(fish.top_p, 0.8))),
      repetition_penalty: Math.max(
        0.9,
        Math.min(2.0, toFiniteNumber(fish.repetition_penalty, 1.1)),
      ),
      temperature: Math.max(
        0.1,
        Math.min(1.0, toFiniteNumber(fish.temperature, 0.8)),
      ),
      streaming: false,
      use_memory_cache: (fish.use_memory_cache || 'on') as FishCache,
      seed: stableSeed,
    };

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };

    if (apiKey) {
      headers.authorization = `Bearer ${apiKey}`;
    }

    const fishController = new AbortController();
    const fishAbortTimer = setTimeout(() => {
      try {
        fishController.abort();
      } catch {
        // ignore
      }
    }, FISH_ABORT_TIMEOUT_MS);

    const splitCandidateSegments = splitTextIntoFishSegments(text);
    const shouldSplitText = splitCandidateSegments.length > 1;
    const textSegments = shouldSplitText ? splitCandidateSegments : [text];

    let fishResponse: Response | null = null;
    let audioBuffer: ArrayBuffer | Buffer;

    try {
      if (!shouldSplitText || textSegments.length <= 1) {
        fishResponse = await synthesizeFishChunk(
          fishBaseUrl,
          headers,
          fishPayload,
          fishController.signal,
        );

        if (!fishResponse.ok) {
          const msg = await fishResponse.text().catch(() => '');
          return NextResponse.json(
            {
              error: `Fish TTS failed (${fishResponse.status})${
                msg ? `: ${msg.slice(0, 400)}` : ''
              }`,
            },
            { status: 502 },
          );
        }

        audioBuffer = await fishResponse.arrayBuffer();
      } else {
        const chunkBuffers: ArrayBuffer[] = [];

        for (let i = 0; i < textSegments.length; i += 1) {
          const segmentText = textSegments[i];
          const segmentMaxNewTokens = Math.max(
            fishPayload.max_new_tokens,
            estimateRecommendedMaxNewTokens(segmentText),
          );

          const segmentPayload: FishPayload = {
            ...fishPayload,
            text: segmentText,
            // Always synthesize split chunks as WAV, then merge and transcode.
            format: 'wav',
            max_new_tokens: segmentMaxNewTokens,
          };

          fishResponse = await synthesizeFishChunk(
            fishBaseUrl,
            headers,
            segmentPayload,
            fishController.signal,
          );

          if (!fishResponse.ok) {
            const msg = await fishResponse.text().catch(() => '');
            return NextResponse.json(
              {
                error: `Fish TTS chunk ${i + 1}/${textSegments.length} failed (${fishResponse.status})${
                  msg ? `: ${msg.slice(0, 400)}` : ''
                }`,
              },
              { status: 502 },
            );
          }

          chunkBuffers.push(await fishResponse.arrayBuffer());
        }

        const mergedWav = await concatWavBuffersWithFfmpeg(chunkBuffers);
        audioBuffer =
          format === 'wav'
            ? mergedWav
            : await transcodeWavBufferWithFfmpeg(mergedWav, format);
      }
    } catch (upstreamError) {
      const code = extractUpstreamErrorCode(upstreamError);

      const isTimeout =
        code === 'UND_ERR_HEADERS_TIMEOUT' ||
        code === 'UND_ERR_BODY_TIMEOUT' ||
        code === 'ABORT_ERR';

      const message = isTimeout
        ? `Fish TTS timed out${code ? ` (${code})` : ''}`
        : `Fish TTS is unreachable${code ? ` (${code})` : ''}`;

      const hint = isTimeout
        ? `Fish server did not answer in time. Check GPU/MPS load and model responsiveness at ${fishBaseUrl}/v1/health.`
        : `Cannot connect to Fish server at ${fishBaseUrl}. Start the Fish server and verify ${fishBaseUrl}/v1/health returns ok.`;

      return NextResponse.json(
        {
          error: message,
          fishBaseUrl,
          hint,
        },
        { status: isTimeout ? 504 : 503 },
      );
    } finally {
      clearTimeout(fishAbortTimer);
    }

    const timestamp = Date.now();
    const extension = format === 'pcm' ? 'pcm' : format;
    const filename = hasVideoId
      ? hasSceneId
        ? `video_${body.videoId}_scene_${body.sceneId}_fish_tts_${timestamp}.${extension}`
        : `video_${body.videoId}_fish_tts_${timestamp}.${extension}`
      : `scene_${body.sceneId}_fish_tts_${timestamp}.${extension}`;

    const bucket = 'nca-toolkit';
    const uploadUrl = `http://host.docker.internal:9000/${bucket}/${filename}`;

    const contentTypeMap: Record<FishFormat, string> = {
      wav: 'audio/wav',
      mp3: 'audio/mpeg',
      opus: 'audio/ogg',
      pcm: 'audio/pcm',
    };

    const uploadBody =
      audioBuffer instanceof ArrayBuffer
        ? new Uint8Array(audioBuffer)
        : new Uint8Array(
            audioBuffer.buffer,
            audioBuffer.byteOffset,
            audioBuffer.byteLength,
          );

    const uploadResponse = await fetch(uploadUrl, {
      method: 'PUT',
      headers: {
        'Content-Type': contentTypeMap[format],
      },
      body: uploadBody as unknown as BodyInit,
    });

    if (!uploadResponse.ok) {
      const errorText = await uploadResponse
        .text()
        .catch(() => 'Unknown error');
      throw new Error(
        `MinIO upload failed (${uploadResponse.status}): ${errorText}`,
      );
    }

    return NextResponse.json({
      provider: 'fish-s2-pro',
      audioUrl: uploadUrl,
      filename,
      bucket,
      sceneId: hasSceneId ? body.sceneId : null,
      videoId: hasVideoId ? body.videoId : null,
      generationParams: {
        max_new_tokens: maxNewTokens,
        chunk_length: chunkLength,
        split_text: shouldSplitText,
        segment_count: textSegments.length,
        shared_seed: stableSeed,
        split_strategy: shouldSplitText ? 'sentence' : 'none',
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
