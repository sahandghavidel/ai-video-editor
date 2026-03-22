import { NextRequest, NextResponse } from 'next/server';
import { Agent } from 'undici';

export const runtime = 'nodejs';
export const maxDuration = 900;

const FISH_HEADERS_TIMEOUT_MS = 60 * 60 * 1000; // 60 minutes
const FISH_BODY_TIMEOUT_MS = 60 * 60 * 1000; // 60 minutes
const FISH_ABORT_TIMEOUT_MS = 65 * 60 * 1000; // 65 minutes safety cap

const FISH_DEFAULT_MAX_NEW_TOKENS = 1024;
const FISH_MAX_NEW_TOKENS_CAP = 8192;
const FISH_LONG_TEXT_THRESHOLD_CHARS = 900;
const FISH_DEFAULT_CHUNK_LENGTH = 300;
const FISH_LONG_TEXT_MIN_CHUNK_LENGTH = 500;
const FISH_CONNECT_RETRIES = 6;
const FISH_CONNECT_RETRY_DELAY_MS = 1500;

const fishFetchDispatcher = new Agent({
  headersTimeout: FISH_HEADERS_TIMEOUT_MS,
  bodyTimeout: FISH_BODY_TIMEOUT_MS,
});

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

function estimateRecommendedMaxNewTokens(text: string): number {
  const normalizedText = text.trim();
  if (!normalizedText) return FISH_DEFAULT_MAX_NEW_TOKENS;

  const words = normalizedText.split(/\s+/).filter(Boolean).length;
  const chars = normalizedText.length;

  // Heuristic sized for long narrative TTS scripts.
  const byWordCount = Math.ceil(words * 2.6);
  const byCharCount = Math.ceil(chars * 0.9);

  return Math.max(
    FISH_DEFAULT_MAX_NEW_TOKENS,
    Math.min(FISH_MAX_NEW_TOKENS_CAP, Math.max(byWordCount, byCharCount)),
  );
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

    const fishPayload = {
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
      use_memory_cache: (fish.use_memory_cache || 'off') as FishCache,
      seed:
        typeof body.ttsSettings?.seed === 'number'
          ? Math.trunc(body.ttsSettings.seed)
          : undefined,
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

    let fishResponse: Response;
    try {
      fishResponse = await fetchFishWithRetry(`${fishBaseUrl}/v1/tts`, {
        method: 'POST',
        headers,
        body: JSON.stringify(fishPayload),
        signal: fishController.signal,
        // undici-specific option for Node fetch
        dispatcher: fishFetchDispatcher,
      } as unknown as RequestInit);
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

    const audioBuffer = await fishResponse.arrayBuffer();

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

    const uploadResponse = await fetch(uploadUrl, {
      method: 'PUT',
      headers: {
        'Content-Type': contentTypeMap[format],
      },
      body: audioBuffer,
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
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
