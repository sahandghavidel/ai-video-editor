import { NextRequest, NextResponse } from 'next/server';

export const runtime = 'nodejs';
export const maxDuration = 900;

interface RequestBody {
  text?: unknown;
  sceneId?: unknown;
  videoId?: unknown;
  aggressiveEdgeTrim?: unknown;
  [key: string]: unknown;
}

type EdgeSilenceDetection = {
  durationSec: number;
  leadingSilenceSec: number;
  trailingSilenceSec: number;
};

const OMNIVOICE_RIGHT_CLICK_TRIM_THRESHOLD_DB = Math.min(
  -5,
  Math.max(
    -80,
    toFiniteNumber(process.env.OMNIVOICE_RIGHT_CLICK_TRIM_THRESHOLD_DB, -35),
  ),
);

const OMNIVOICE_RIGHT_CLICK_MAX_LEADING_SILENCE_SEC = Math.max(
  0,
  toFiniteNumber(
    process.env.OMNIVOICE_RIGHT_CLICK_MAX_LEADING_SILENCE_SEC ??
      process.env.OMNIVOICE_RIGHT_CLICK_TRIM_START_DURATION_SEC,
    0.12,
  ),
);

const OMNIVOICE_RIGHT_CLICK_RETRY_MAX_ATTEMPTS = Math.min(
  5,
  Math.max(
    1,
    toPositiveInt(process.env.OMNIVOICE_RIGHT_CLICK_RETRY_MAX_ATTEMPTS, 5),
  ),
);

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

function toBoolean(value: unknown, fallback: boolean): boolean {
  if (value === null || value === undefined) return fallback;
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return value !== 0;
  const normalized = String(value).trim().toLowerCase();
  if (['1', 'true', 'yes', 'on'].includes(normalized)) return true;
  if (['0', 'false', 'no', 'off'].includes(normalized)) return false;
  return fallback;
}

function roundTo(value: number | null, digits: number = 3): number | null {
  if (value === null || !Number.isFinite(value)) return null;
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function dbToLinear(db: number): number {
  return Math.pow(10, db / 20);
}

function readFourCc(view: DataView, offset: number): string {
  return String.fromCharCode(
    view.getUint8(offset),
    view.getUint8(offset + 1),
    view.getUint8(offset + 2),
    view.getUint8(offset + 3),
  );
}

function parseWavMetadata(buffer: Buffer): {
  audioFormat: number;
  numChannels: number;
  sampleRate: number;
  bitsPerSample: number;
  blockAlign: number;
  dataOffset: number;
  dataSize: number;
  sampleCount: number;
} | null {
  if (buffer.byteLength < 44) return null;

  const view = new DataView(
    buffer.buffer,
    buffer.byteOffset,
    buffer.byteLength,
  );
  if (readFourCc(view, 0) !== 'RIFF' || readFourCc(view, 8) !== 'WAVE') {
    return null;
  }

  let audioFormat: number | null = null;
  let numChannels: number | null = null;
  let sampleRate: number | null = null;
  let bitsPerSample: number | null = null;
  let blockAlign: number | null = null;
  let dataOffset: number | null = null;
  let dataSize: number | null = null;

  let offset = 12;
  while (offset + 8 <= view.byteLength) {
    const chunkId = readFourCc(view, offset);
    const chunkSize = view.getUint32(offset + 4, true);
    const chunkDataOffset = offset + 8;

    if (chunkDataOffset + chunkSize > view.byteLength) {
      break;
    }

    if (chunkId === 'fmt ' && chunkSize >= 16) {
      audioFormat = view.getUint16(chunkDataOffset, true);
      numChannels = view.getUint16(chunkDataOffset + 2, true);
      sampleRate = view.getUint32(chunkDataOffset + 4, true);
      blockAlign = view.getUint16(chunkDataOffset + 12, true);
      bitsPerSample = view.getUint16(chunkDataOffset + 14, true);
    } else if (chunkId === 'data') {
      dataOffset = chunkDataOffset;
      dataSize = chunkSize;
    }

    const paddedChunkSize = chunkSize + (chunkSize % 2);
    offset = chunkDataOffset + paddedChunkSize;
  }

  if (
    audioFormat === null ||
    numChannels === null ||
    sampleRate === null ||
    bitsPerSample === null ||
    blockAlign === null ||
    dataOffset === null ||
    dataSize === null ||
    blockAlign <= 0 ||
    sampleRate <= 0
  ) {
    return null;
  }

  const sampleCount = Math.floor(dataSize / blockAlign);
  if (sampleCount <= 0) return null;

  return {
    audioFormat,
    numChannels,
    sampleRate,
    bitsPerSample,
    blockAlign,
    dataOffset,
    dataSize,
    sampleCount,
  };
}

function readNormalizedSample(
  view: DataView,
  byteOffset: number,
  audioFormat: number,
  bitsPerSample: number,
): number | null {
  if (audioFormat === 1) {
    if (bitsPerSample === 8) {
      const v = view.getUint8(byteOffset);
      return (v - 128) / 128;
    }
    if (bitsPerSample === 16) {
      return view.getInt16(byteOffset, true) / 32768;
    }
    if (bitsPerSample === 24) {
      const b0 = view.getUint8(byteOffset);
      const b1 = view.getUint8(byteOffset + 1);
      const b2 = view.getUint8(byteOffset + 2);
      let v = b0 | (b1 << 8) | (b2 << 16);
      if (v & 0x800000) {
        v |= ~0xffffff;
      }
      return v / 8388608;
    }
    if (bitsPerSample === 32) {
      return view.getInt32(byteOffset, true) / 2147483648;
    }
  }

  if (audioFormat === 3) {
    if (bitsPerSample === 32) {
      return view.getFloat32(byteOffset, true);
    }
    if (bitsPerSample === 64) {
      return view.getFloat64(byteOffset, true);
    }
  }

  return null;
}

function detectEdgeSilenceFromWav(
  buffer: Buffer,
  thresholdLinear: number,
): EdgeSilenceDetection | null {
  const meta = parseWavMetadata(buffer);
  if (!meta) return null;

  const view = new DataView(
    buffer.buffer,
    buffer.byteOffset,
    buffer.byteLength,
  );
  const bytesPerSample = Math.floor(meta.bitsPerSample / 8);
  if (bytesPerSample <= 0) return null;

  const getFrameAmplitude = (frameIndex: number): number => {
    const frameOffset = meta.dataOffset + frameIndex * meta.blockAlign;
    let maxAbs = 0;

    for (let channel = 0; channel < meta.numChannels; channel += 1) {
      const sampleOffset = frameOffset + channel * bytesPerSample;
      const normalized = readNormalizedSample(
        view,
        sampleOffset,
        meta.audioFormat,
        meta.bitsPerSample,
      );
      if (normalized === null || !Number.isFinite(normalized)) continue;
      const abs = Math.abs(normalized);
      if (abs > maxAbs) maxAbs = abs;
    }

    return maxAbs;
  };

  let firstNonSilent = -1;
  for (let i = 0; i < meta.sampleCount; i += 1) {
    if (getFrameAmplitude(i) > thresholdLinear) {
      firstNonSilent = i;
      break;
    }
  }

  let lastNonSilent = -1;
  for (let i = meta.sampleCount - 1; i >= 0; i -= 1) {
    if (getFrameAmplitude(i) > thresholdLinear) {
      lastNonSilent = i;
      break;
    }
  }

  const durationSec = meta.sampleCount / meta.sampleRate;
  if (firstNonSilent < 0 || lastNonSilent < 0) {
    return {
      durationSec,
      leadingSilenceSec: durationSec,
      trailingSilenceSec: 0,
    };
  }

  const leadingSilenceSec = firstNonSilent / meta.sampleRate;
  const trailingFrames = Math.max(0, meta.sampleCount - 1 - lastNonSilent);
  const trailingSilenceSec = trailingFrames / meta.sampleRate;

  return {
    durationSec,
    leadingSilenceSec,
    trailingSilenceSec,
  };
}

async function callBaseOmniRoute(
  request: NextRequest,
  body: RequestBody,
): Promise<Response> {
  const baseUrl = new URL('/api/generate-tts-omnivoice', request.url);

  return fetch(baseUrl.toString(), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    cache: 'no-store',
    body: JSON.stringify({
      ...body,
      // Explicitly disable FFmpeg trim behavior in the base route.
      aggressiveEdgeTrim: false,
    }),
  });
}

async function detectLeadingSilenceFromAudioUrl(
  audioUrl: string,
  thresholdLinear: number,
): Promise<number | null> {
  if (!audioUrl) return null;

  try {
    const audioResponse = await fetch(audioUrl, { cache: 'no-store' });
    if (!audioResponse.ok) return null;

    const audioBuffer = Buffer.from(await audioResponse.arrayBuffer());
    const detection = detectEdgeSilenceFromWav(audioBuffer, thresholdLinear);
    return roundTo(detection?.leadingSilenceSec ?? null);
  } catch {
    return null;
  }
}

export async function POST(request: NextRequest) {
  const requestStartedAt = Date.now();

  try {
    const body = (await request.json()) as RequestBody;
    const retryRequested = toBoolean(body.aggressiveEdgeTrim, true);
    const maxAttempts = retryRequested
      ? OMNIVOICE_RIGHT_CLICK_RETRY_MAX_ATTEMPTS
      : 1;
    const thresholdLinear = dbToLinear(OMNIVOICE_RIGHT_CLICK_TRIM_THRESHOLD_DB);

    let attemptsExecuted = 0;
    let selectedAttempt: number | null = null;
    let selectedLeadingSilenceSec: number | null = null;
    let bestResponsePayload: Record<string, unknown> | null = null;
    let firstFailureStatus = 500;
    let firstFailureText = 'Failed to generate OmniVoice output';

    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      attemptsExecuted = attempt;

      const baseResponse = await callBaseOmniRoute(request, body);
      if (!baseResponse.ok) {
        const errorText = await baseResponse
          .text()
          .catch(() => 'Unknown upstream error');

        if (bestResponsePayload === null && selectedAttempt === null) {
          firstFailureStatus = baseResponse.status;
          firstFailureText = errorText || firstFailureText;
        }

        continue;
      }

      const payload = (await baseResponse.json().catch(() => null)) as Record<
        string,
        unknown
      > | null;

      if (!payload) {
        continue;
      }

      const audioUrl =
        typeof payload.audioUrl === 'string' ? payload.audioUrl.trim() : '';

      const leadingSilenceSec = await detectLeadingSilenceFromAudioUrl(
        audioUrl,
        thresholdLinear,
      );

      const shouldSelectThisAttempt =
        bestResponsePayload === null ||
        (leadingSilenceSec !== null &&
          (selectedLeadingSilenceSec === null ||
            leadingSilenceSec < selectedLeadingSilenceSec));

      if (shouldSelectThisAttempt) {
        bestResponsePayload = payload;
        selectedAttempt = attempt;
        selectedLeadingSilenceSec = leadingSilenceSec;
      }

      if (
        leadingSilenceSec !== null &&
        leadingSilenceSec <= OMNIVOICE_RIGHT_CLICK_MAX_LEADING_SILENCE_SEC
      ) {
        break;
      }
    }

    if (!bestResponsePayload) {
      return NextResponse.json(
        {
          error: firstFailureText,
          retryAttempts: attemptsExecuted,
          retryMaxAttempts: maxAttempts,
        },
        { status: firstFailureStatus },
      );
    }

    const existingGenerationParams =
      bestResponsePayload.generationParams &&
      typeof bestResponsePayload.generationParams === 'object'
        ? (bestResponsePayload.generationParams as Record<string, unknown>)
        : {};

    const totalMs = Date.now() - requestStartedAt;

    console.info(
      `[OmniVoice] right-click retry route requested=${retryRequested} attempts=${attemptsExecuted}/${maxAttempts} selectedAttempt=${selectedAttempt ?? 'n/a'} selectedLeadingSilenceSec=${selectedLeadingSilenceSec ?? 'n/a'} maxAllowedLeadingSilenceSec=${OMNIVOICE_RIGHT_CLICK_MAX_LEADING_SILENCE_SEC} thresholdDb=${OMNIVOICE_RIGHT_CLICK_TRIM_THRESHOLD_DB} totalMs=${totalMs}`,
    );

    return NextResponse.json({
      ...bestResponsePayload,
      generationParams: {
        ...existingGenerationParams,
        rightClickRetryRequested: retryRequested,
        rightClickRetryAttempts: attemptsExecuted,
        rightClickRetrySelectedAttempt: selectedAttempt,
        rightClickRetryMaxAttempts: maxAttempts,
        rightClickRetryThresholdDb: OMNIVOICE_RIGHT_CLICK_TRIM_THRESHOLD_DB,
        rightClickRetryMaxLeadingSilenceSec:
          OMNIVOICE_RIGHT_CLICK_MAX_LEADING_SILENCE_SEC,
        rightClickRetrySelectedLeadingSilenceSec: selectedLeadingSilenceSec,
        rightClickRetryMode: 'rerun-no-ffmpeg',
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
