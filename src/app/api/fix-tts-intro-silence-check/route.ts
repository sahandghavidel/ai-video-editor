import { NextRequest, NextResponse } from 'next/server';

export const runtime = 'nodejs';
export const maxDuration = 120;

interface RequestBody {
  audioUrl?: unknown;
  sceneId?: unknown;
  thresholdDb?: unknown;
  maxLeadingSilenceSec?: unknown;
  maxInternalPauseSec?: unknown;
  maxSilenceRatio?: unknown;
}

type SilenceMetrics = {
  durationSec: number;
  leadingSilenceSec: number;
  trailingSilenceSec: number;
  maxInternalPauseSec: number;
  silenceRatio: number;
  sampleCount: number;
  silentSampleCount: number;
};

const INTRO_FIX_TTS_SILENCE_THRESHOLD_DB_DEFAULT = clampNumber(
  toFiniteNumber(process.env.INTRO_FIX_TTS_SILENCE_THRESHOLD_DB, -35),
  -80,
  -5,
);

const INTRO_FIX_TTS_MAX_LEADING_SILENCE_SEC_DEFAULT = Math.max(
  0,
  toFiniteNumber(process.env.INTRO_FIX_TTS_MAX_LEADING_SILENCE_SEC, 0.12),
);

const INTRO_FIX_TTS_MAX_INTERNAL_PAUSE_SEC_DEFAULT = Math.max(
  0,
  toFiniteNumber(process.env.INTRO_FIX_TTS_MAX_INTERNAL_PAUSE_SEC, 0.45),
);

const INTRO_FIX_TTS_MAX_SILENCE_RATIO_DEFAULT = clampNumber(
  toFiniteNumber(process.env.INTRO_FIX_TTS_MAX_SILENCE_RATIO, 0.18),
  0,
  1,
);

function toFiniteNumber(value: unknown, fallback: number): number {
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(n)) return fallback;
  return n;
}

function clampNumber(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function roundTo(value: number, digits: number = 3): number {
  if (!Number.isFinite(value)) return 0;
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

function analyzeSilenceFromWav(
  buffer: Buffer,
  thresholdLinear: number,
): SilenceMetrics | null {
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

  const silentFrameFlags = new Uint8Array(meta.sampleCount);
  let silentSampleCount = 0;
  let firstNonSilent = -1;
  let lastNonSilent = -1;

  for (let i = 0; i < meta.sampleCount; i += 1) {
    const isSilent = getFrameAmplitude(i) <= thresholdLinear;
    if (isSilent) {
      silentFrameFlags[i] = 1;
      silentSampleCount += 1;
      continue;
    }

    if (firstNonSilent < 0) {
      firstNonSilent = i;
    }
    lastNonSilent = i;
  }

  const durationSec = meta.sampleCount / meta.sampleRate;

  if (firstNonSilent < 0 || lastNonSilent < 0) {
    return {
      durationSec,
      leadingSilenceSec: durationSec,
      trailingSilenceSec: durationSec,
      maxInternalPauseSec: durationSec,
      silenceRatio: 1,
      sampleCount: meta.sampleCount,
      silentSampleCount,
    };
  }

  const leadingSilenceSec = firstNonSilent / meta.sampleRate;
  const trailingFrames = Math.max(0, meta.sampleCount - 1 - lastNonSilent);
  const trailingSilenceSec = trailingFrames / meta.sampleRate;

  let currentInternalSilentRun = 0;
  let maxInternalSilentRun = 0;
  for (let i = firstNonSilent; i <= lastNonSilent; i += 1) {
    if (silentFrameFlags[i] === 1) {
      currentInternalSilentRun += 1;
      if (currentInternalSilentRun > maxInternalSilentRun) {
        maxInternalSilentRun = currentInternalSilentRun;
      }
    } else {
      currentInternalSilentRun = 0;
    }
  }

  const maxInternalPauseSec = maxInternalSilentRun / meta.sampleRate;
  const silenceRatio =
    meta.sampleCount > 0 ? silentSampleCount / meta.sampleCount : 0;

  return {
    durationSec,
    leadingSilenceSec,
    trailingSilenceSec,
    maxInternalPauseSec,
    silenceRatio,
    sampleCount: meta.sampleCount,
    silentSampleCount,
  };
}

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json().catch(() => null)) as RequestBody | null;
    const audioUrl =
      typeof body?.audioUrl === 'string' ? body.audioUrl.trim() : '';

    if (!audioUrl) {
      return NextResponse.json(
        { error: 'audioUrl is required' },
        { status: 400 },
      );
    }

    const thresholdDb = clampNumber(
      toFiniteNumber(
        body?.thresholdDb,
        INTRO_FIX_TTS_SILENCE_THRESHOLD_DB_DEFAULT,
      ),
      -80,
      -5,
    );

    const thresholds = {
      thresholdDb,
      maxLeadingSilenceSec: Math.max(
        0,
        toFiniteNumber(
          body?.maxLeadingSilenceSec,
          INTRO_FIX_TTS_MAX_LEADING_SILENCE_SEC_DEFAULT,
        ),
      ),
      maxInternalPauseSec: Math.max(
        0,
        toFiniteNumber(
          body?.maxInternalPauseSec,
          INTRO_FIX_TTS_MAX_INTERNAL_PAUSE_SEC_DEFAULT,
        ),
      ),
      maxSilenceRatio: clampNumber(
        toFiniteNumber(
          body?.maxSilenceRatio,
          INTRO_FIX_TTS_MAX_SILENCE_RATIO_DEFAULT,
        ),
        0,
        1,
      ),
    };

    const audioResponse = await fetch(audioUrl, { cache: 'no-store' });
    if (!audioResponse.ok) {
      return NextResponse.json(
        {
          error: `Failed to fetch audio (${audioResponse.status})`,
        },
        { status: 400 },
      );
    }

    const buffer = Buffer.from(await audioResponse.arrayBuffer());
    const thresholdLinear = dbToLinear(thresholds.thresholdDb);
    const metrics = analyzeSilenceFromWav(buffer, thresholdLinear);

    if (!metrics) {
      return NextResponse.json(
        {
          error: 'Unable to parse WAV audio or unsupported format',
        },
        { status: 400 },
      );
    }

    const failedChecks: string[] = [];

    if (metrics.leadingSilenceSec > thresholds.maxLeadingSilenceSec) {
      failedChecks.push('leading_silence');
    }

    if (metrics.maxInternalPauseSec > thresholds.maxInternalPauseSec) {
      failedChecks.push('max_internal_pause');
    }

    if (metrics.silenceRatio > thresholds.maxSilenceRatio) {
      failedChecks.push('silence_ratio');
    }

    const pass = failedChecks.length === 0;

    const roundedMetrics = {
      durationSec: roundTo(metrics.durationSec),
      leadingSilenceSec: roundTo(metrics.leadingSilenceSec),
      trailingSilenceSec: roundTo(metrics.trailingSilenceSec),
      maxInternalPauseSec: roundTo(metrics.maxInternalPauseSec),
      silenceRatio: roundTo(metrics.silenceRatio, 4),
      sampleCount: metrics.sampleCount,
      silentSampleCount: metrics.silentSampleCount,
    };

    const roundedThresholds = {
      thresholdDb: roundTo(thresholds.thresholdDb),
      maxLeadingSilenceSec: roundTo(thresholds.maxLeadingSilenceSec),
      maxInternalPauseSec: roundTo(thresholds.maxInternalPauseSec),
      maxSilenceRatio: roundTo(thresholds.maxSilenceRatio, 4),
    };

    const reason = pass
      ? 'Intro silence QA passed'
      : `Intro silence QA failed (${failedChecks.join(', ')}): lead=${roundedMetrics.leadingSilenceSec}s (max ${roundedThresholds.maxLeadingSilenceSec}s), maxPause=${roundedMetrics.maxInternalPauseSec}s (max ${roundedThresholds.maxInternalPauseSec}s), ratio=${roundedMetrics.silenceRatio} (max ${roundedThresholds.maxSilenceRatio})`;

    return NextResponse.json({
      pass,
      failedChecks,
      reason,
      sceneId:
        typeof body?.sceneId === 'number' || typeof body?.sceneId === 'string'
          ? body.sceneId
          : null,
      metrics: roundedMetrics,
      thresholds: roundedThresholds,
    });
  } catch (error) {
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 },
    );
  }
}
