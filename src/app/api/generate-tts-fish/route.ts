import { NextRequest, NextResponse } from 'next/server';

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

    const fishPayload = {
      text,
      references: [],
      reference_id: referenceId,
      format,
      latency,
      max_new_tokens: toPositiveInt(fish.max_new_tokens, 1024),
      chunk_length: Math.max(
        100,
        Math.min(1000, toPositiveInt(fish.chunk_length, 300)),
      ),
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

    const fishResponse = await fetch(`${fishBaseUrl}/v1/tts`, {
      method: 'POST',
      headers,
      body: JSON.stringify(fishPayload),
    });

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
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
