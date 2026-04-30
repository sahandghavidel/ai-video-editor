import { NextRequest, NextResponse } from 'next/server';
import { execFile, spawn } from 'child_process';
import type { ChildProcessWithoutNullStreams } from 'child_process';
import fs from 'fs';
import path from 'path';
import { promises as fsp } from 'fs';
import os from 'os';
import { promisify } from 'util';

export const runtime = 'nodejs';
export const maxDuration = 900;

const execFileAsync = promisify(execFile);

type OmniVoiceDeviceMap = 'mps' | 'cpu' | 'auto';
type OmniVoiceDType = 'float16' | 'float32' | 'bfloat16';

interface OmniVoiceTtsSettings {
  pythonPath?: string;
  modelId?: string;
  language?: string;
  deviceMap?: OmniVoiceDeviceMap;
  dtype?: OmniVoiceDType;
  referenceAudioDir?: string;
  referenceText?: string;
  numStep?: number;
  speed?: number;
}

interface RequestBody {
  text?: unknown;
  sceneId?: unknown;
  videoId?: unknown;
  referenceAudioFilename?: unknown;
  aggressiveEdgeTrim?: unknown;
  ttsSettings?: {
    reference_audio_filename?: string;
    omniVoice?: OmniVoiceTtsSettings;
  };
}

type PreparedWordReplacement = {
  word: string;
  replacement: string;
  pattern: RegExp;
};

type EdgeSilenceDetection = {
  durationSec: number;
  leadingSilenceSec: number;
  trailingSilenceSec: number;
};

type EdgeTrimMetrics = {
  requested: boolean;
  applied: boolean;
  thresholdDb: number;
  leadingRemovedSec: number | null;
  trailingRemovedSec: number | null;
  totalRemovedSec: number | null;
  originalDurationSec: number | null;
  trimmedDurationSec: number | null;
  error: string | null;
};

const OMNIVOICE_IDLE_TIMEOUT_MS = 5 * 60 * 1000;
const OMNIVOICE_JOB_TIMEOUT_MS = Math.max(
  0,
  Number(process.env.OMNIVOICE_JOB_TIMEOUT_MS || 0) || 0,
);
const OMNIVOICE_WORKER_PROTOCOL_VERSION = '2';
const WORD_CHAR_CLASS = 'A-Za-z0-9_';
const OMNIVOICE_FFMPEG_MAX_BUFFER_BYTES = 16 * 1024 * 1024;
const OMNIVOICE_RIGHT_CLICK_TRIM_THRESHOLD_DB = Math.min(
  -5,
  Math.max(
    -80,
    // Conservative default to avoid clipping quiet breaths at the start.
    toFiniteNumber(process.env.OMNIVOICE_RIGHT_CLICK_TRIM_THRESHOLD_DB, -35),
  ),
);
const OMNIVOICE_RIGHT_CLICK_TRIM_START_DURATION_SEC = Math.max(
  0,
  // Require a short silence window before trimming starts.
  toFiniteNumber(
    process.env.OMNIVOICE_RIGHT_CLICK_TRIM_START_DURATION_SEC,
    0.1,
  ),
);
const OMNIVOICE_RIGHT_CLICK_TRIM_KEEP_SILENCE_SEC = Math.max(
  0,
  // Keep a small lead-in so breath/intake transients are preserved.
  toFiniteNumber(process.env.OMNIVOICE_RIGHT_CLICK_TRIM_KEEP_SILENCE_SEC, 0.12),
);

type WorkerJobResult = {
  sampleRate: number;
  cacheHit: boolean;
  promptCacheSize: number;
  promptMs: number;
  generateMs: number;
};

type WorkerPendingJob = {
  resolve: (value: WorkerJobResult) => void;
  reject: (reason: Error) => void;
  timer?: NodeJS.Timeout;
};

type OmniVoiceWorkerState = {
  child: ChildProcessWithoutNullStreams;
  key: string;
  pythonCommand: string;
  pythonSource: string;
  pending: Map<string, WorkerPendingJob>;
  stdoutBuffer: string;
  stderrBuffer: string;
  stderrTail: string;
  idleTimer?: NodeJS.Timeout;
};

type GlobalWithOmniVoiceWorker = typeof globalThis & {
  __omniVoiceWorkerState?: OmniVoiceWorkerState;
};

const omniVoiceGlobal = globalThis as GlobalWithOmniVoiceWorker;

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

function normalizeRefAudioName(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  return trimmed;
}

function hasIdValue(value: unknown): boolean {
  return (
    value !== undefined && value !== null && String(value).trim().length > 0
  );
}

function resolvePythonCommand(options: {
  envVarName: string;
  configuredSetting?: string;
  absoluteCandidates: string[];
  fallbackCommand: string;
}): { command: string; source: string } {
  const configuredEnv = process.env[options.envVarName];
  const configured = configuredEnv?.trim().length
    ? configuredEnv.trim()
    : options.configuredSetting?.trim().length
      ? options.configuredSetting.trim()
      : '';

  if (configured) {
    if (configured.includes('/') && !fs.existsSync(configured)) {
      return {
        command: options.fallbackCommand,
        source: `${options.envVarName || 'configured path'} was set but missing (${configured}); using ${options.fallbackCommand}`,
      };
    }
    return {
      command: configured,
      source:
        configured === configuredEnv?.trim()
          ? `env:${options.envVarName}`
          : 'settings:ttsSettings.omniVoice.pythonPath',
    };
  }

  for (const candidate of options.absoluteCandidates) {
    if (fs.existsSync(candidate)) {
      return { command: candidate, source: `auto:${candidate}` };
    }
  }

  return {
    command: options.fallbackCommand,
    source: `fallback:${options.fallbackCommand}`,
  };
}

async function hasRequiredOmniVoiceModules(
  pythonCommand: string,
): Promise<boolean> {
  return new Promise((resolve) => {
    const probe = spawn(
      pythonCommand,
      [
        '-c',
        'import importlib.util,sys;mods=("torch","torchaudio","omnivoice");sys.exit(0 if all(importlib.util.find_spec(m) is not None for m in mods) else 1)',
      ],
      {
        stdio: 'ignore',
        env: {
          ...process.env,
          PYTORCH_ENABLE_MPS_FALLBACK: '0',
        },
      },
    );

    probe.on('error', () => resolve(false));
    probe.on('close', (code) => resolve(code === 0));
  });
}

async function selectOmniVoicePythonCommand(options: {
  envVarName: string;
  configuredSetting?: string;
  absoluteCandidates: string[];
  fallbackCommand: string;
}): Promise<{ command: string; source: string }> {
  const preferred = resolvePythonCommand(options);

  if (await hasRequiredOmniVoiceModules(preferred.command)) {
    return preferred;
  }

  for (const candidate of options.absoluteCandidates) {
    if (!fs.existsSync(candidate)) continue;
    if (candidate === preferred.command) continue;

    if (await hasRequiredOmniVoiceModules(candidate)) {
      return {
        command: candidate,
        source: `auto-modules:${candidate}`,
      };
    }
  }

  if (
    preferred.command !== options.fallbackCommand &&
    (await hasRequiredOmniVoiceModules(options.fallbackCommand))
  ) {
    return {
      command: options.fallbackCommand,
      source: `fallback-modules:${options.fallbackCommand}`,
    };
  }

  return preferred;
}

function resolveReferenceAudioPath(input: {
  filenameOrPath: string;
  configuredDir?: string;
}): { fullPath: string; searchedDirs: string[] } {
  const { filenameOrPath, configuredDir } = input;

  if (path.isAbsolute(filenameOrPath)) {
    if (fs.existsSync(filenameOrPath)) {
      return { fullPath: filenameOrPath, searchedDirs: [] };
    }
    throw new Error(`Reference audio path does not exist: ${filenameOrPath}`);
  }

  const dirs = [
    configuredDir?.trim() || '',
    process.env.OMNIVOICE_REFERENCE_AUDIO_DIR?.trim() || '',
    path.join(process.cwd(), 'omnivoice-local', 'references'),
  ].filter((d, idx, arr) => d.length > 0 && arr.indexOf(d) === idx);

  for (const dir of dirs) {
    const full = path.resolve(dir, filenameOrPath);
    if (fs.existsSync(full)) {
      return { fullPath: full, searchedDirs: dirs };
    }
  }

  throw new Error(
    `Reference audio not found for '${filenameOrPath}'. Checked: ${dirs.join(', ') || '(no directories configured)'}`,
  );
}

function resolveDType(value: unknown): OmniVoiceDType {
  return value === 'float32' || value === 'bfloat16' || value === 'float16'
    ? value
    : 'float16';
}

function resolveDeviceMap(value: unknown): OmniVoiceDeviceMap {
  // Strict MPS mode: always run OmniVoice on Apple Silicon MPS.
  // We intentionally ignore cpu/auto here to avoid silent CPU fallback behavior.
  void value;
  return 'mps';
}

function formatMs(value: unknown): string {
  const n = Number(value);
  return Number.isFinite(n) ? n.toFixed(1) : 'n/a';
}

function roundTo(value: number | null, digits: number = 3): number | null {
  if (value === null || !Number.isFinite(value)) return null;
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
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

function dbToLinear(db: number): number {
  return Math.pow(10, db / 20);
}

async function resolveFfmpegBinary(): Promise<string> {
  const localBinary = path.join(
    process.cwd(),
    'REAL-Video-Enhancer',
    'bin',
    'ffmpeg',
  );

  const candidates = [process.env.FFMPEG_PATH, localBinary].filter(
    (candidate): candidate is string =>
      typeof candidate === 'string' && candidate.trim().length > 0,
  );

  for (const candidate of candidates) {
    try {
      await fsp.access(candidate, fs.constants.X_OK);
      return candidate;
    } catch {
      // try next candidate
    }
  }

  return 'ffmpeg';
}

function buildAggressiveEdgeTrimFilter(): string {
  const threshold = `${OMNIVOICE_RIGHT_CLICK_TRIM_THRESHOLD_DB}dB`;
  const startDuration =
    OMNIVOICE_RIGHT_CLICK_TRIM_START_DURATION_SEC.toFixed(3);
  const keepSilence = OMNIVOICE_RIGHT_CLICK_TRIM_KEEP_SILENCE_SEC.toFixed(3);

  const pass = `silenceremove=start_periods=1:start_duration=${startDuration}:start_threshold=${threshold}:start_silence=${keepSilence}`;
  // Beginning-only aggressive trim (do NOT trim tail/end).
  return pass;
}

async function applyAggressiveEdgeTrimWav(
  inputPath: string,
  outputPath: string,
): Promise<void> {
  const ffmpegBinary = await resolveFfmpegBinary();
  const filter = buildAggressiveEdgeTrimFilter();

  await execFileAsync(
    ffmpegBinary,
    ['-y', '-i', inputPath, '-af', filter, '-c:a', 'pcm_s16le', outputPath],
    { maxBuffer: OMNIVOICE_FFMPEG_MAX_BUFFER_BYTES },
  );
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
    // PCM integer
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
    // IEEE float
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

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function prepareWordReplacements(entries: unknown): PreparedWordReplacement[] {
  if (!Array.isArray(entries)) return [];

  const prepared: PreparedWordReplacement[] = [];

  for (const rawEntry of entries) {
    if (!rawEntry || typeof rawEntry !== 'object') continue;

    const entry = rawEntry as Record<string, unknown>;
    const word = typeof entry.word === 'string' ? entry.word : '';
    const replacement =
      typeof entry.replacement === 'string' ? entry.replacement : '';

    if (!word.trim() || !replacement.trim()) continue;

    prepared.push({
      word,
      replacement,
      pattern: new RegExp(
        `(^|[^${WORD_CHAR_CLASS}])(${escapeRegExp(word)})(?=$|[^${WORD_CHAR_CLASS}])`,
        'g',
      ),
    });
  }

  return prepared;
}

function applyWordReplacements(
  text: string,
  replacements: PreparedWordReplacement[],
): { text: string; substitutions: number } {
  let updated = text;
  let substitutions = 0;

  for (const replacement of replacements) {
    updated = updated.replace(replacement.pattern, (_match, prefix: string) => {
      substitutions += 1;
      return `${prefix}${replacement.replacement}`;
    });
  }

  return { text: updated, substitutions };
}

async function loadWordReplacementsFromApi(
  request: NextRequest,
): Promise<PreparedWordReplacement[]> {
  try {
    const replacementsUrl = new URL('/api/tts-word-replacements', request.url);
    const response = await fetch(replacementsUrl.toString(), {
      method: 'GET',
      cache: 'no-store',
    });

    if (!response.ok) {
      const errorText = await response.text().catch(() => '');
      console.warn(
        `[OmniVoice] Failed to load TTS replacements: ${response.status} ${errorText}`,
      );
      return [];
    }

    const payload = (await response.json().catch(() => null)) as {
      entries?: unknown;
    } | null;
    return prepareWordReplacements(payload?.entries);
  } catch (error) {
    console.warn('[OmniVoice] Failed to fetch TTS replacements:', error);
    return [];
  }
}

// Strip quote-like chars and backticks before synthesis.
const OMNIVOICE_QUOTE_CHAR_REGEX = /[`"“”„‟«»＂]/g;

function stripOmniVoiceQuoteChars(text: string): {
  sanitizedText: string;
  removedQuoteCount: number;
} {
  const matches = text.match(OMNIVOICE_QUOTE_CHAR_REGEX);
  const removedQuoteCount = matches ? matches.length : 0;

  const sanitizedText = text
    .replace(OMNIVOICE_QUOTE_CHAR_REGEX, '')
    .replace(/\s{2,}/g, ' ')
    .trim();

  return { sanitizedText, removedQuoteCount };
}

function splitHyphenSeparatedWordsInPlainSegment(segment: string): {
  text: string;
  hyphenSplitCount: number;
} {
  let hyphenSplitCount = 0;

  // Replace hyphen joins only when both sides look like words.
  // Example: background-size -> background size
  const text = segment.replace(
    /([A-Za-z][A-Za-z0-9]*)-(?=[A-Za-z][A-Za-z0-9]*)/g,
    (_match, leftWord: string) => {
      hyphenSplitCount += 1;
      return `${leftWord} `;
    },
  );

  return { text, hyphenSplitCount };
}

function normalizeHyphenSeparatedWordsForOmniVoice(text: string): {
  normalizedText: string;
  hyphenSplitCount: number;
} {
  const bracketTagRegex = /\[[^\]\r\n]*\]/g;
  let normalizedText = '';
  let hyphenSplitCount = 0;
  let lastIndex = 0;

  for (const match of text.matchAll(bracketTagRegex)) {
    const index = match.index ?? 0;
    const before = text.slice(lastIndex, index);
    const converted = splitHyphenSeparatedWordsInPlainSegment(before);
    normalizedText += converted.text;
    hyphenSplitCount += converted.hyphenSplitCount;
    normalizedText += match[0];
    lastIndex = index + match[0].length;
  }

  const tail = splitHyphenSeparatedWordsInPlainSegment(text.slice(lastIndex));
  normalizedText += tail.text;
  hyphenSplitCount += tail.hyphenSplitCount;

  return { normalizedText, hyphenSplitCount };
}

function splitCamelCaseInPlainSegment(segment: string): {
  text: string;
  splitWordCount: number;
} {
  let splitWordCount = 0;

  const text = segment.replace(/\b[A-Za-z][A-Za-z0-9]*\b/g, (word) => {
    const withSpaces = word
      .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
      .replace(/([a-z\d])([A-Z])/g, '$1 $2');

    if (withSpaces !== word) {
      splitWordCount += 1;
    }

    return withSpaces;
  });

  return { text, splitWordCount };
}

function splitCamelCaseForOmniVoice(text: string): {
  normalizedText: string;
  splitWordCount: number;
} {
  const bracketTagRegex = /\[[^\]\r\n]*\]/g;
  let normalizedText = '';
  let splitWordCount = 0;
  let lastIndex = 0;

  for (const match of text.matchAll(bracketTagRegex)) {
    const index = match.index ?? 0;
    const before = text.slice(lastIndex, index);
    const converted = splitCamelCaseInPlainSegment(before);
    normalizedText += converted.text;
    splitWordCount += converted.splitWordCount;
    normalizedText += match[0];
    lastIndex = index + match[0].length;
  }

  const tail = splitCamelCaseInPlainSegment(text.slice(lastIndex));
  normalizedText += tail.text;
  splitWordCount += tail.splitWordCount;

  return { normalizedText, splitWordCount };
}

function moveDotBeforeFollowingWordInPlainSegment(segment: string): {
  text: string;
  movedDotCount: number;
} {
  let movedDotCount = 0;

  const text = segment.replace(
    /([A-Za-z0-9_])\.(?=[A-Za-z_])/g,
    (_match, prevChar: string) => {
      movedDotCount += 1;
      return `${prevChar} .`;
    },
  );

  return { text, movedDotCount };
}

function normalizeDotSeparatedWordsForOmniVoice(text: string): {
  normalizedText: string;
  movedDotCount: number;
} {
  const bracketTagRegex = /\[[^\]\r\n]*\]/g;
  let normalizedText = '';
  let movedDotCount = 0;
  let lastIndex = 0;

  for (const match of text.matchAll(bracketTagRegex)) {
    const index = match.index ?? 0;
    const before = text.slice(lastIndex, index);
    const converted = moveDotBeforeFollowingWordInPlainSegment(before);
    normalizedText += converted.text;
    movedDotCount += converted.movedDotCount;
    normalizedText += match[0];
    lastIndex = index + match[0].length;
  }

  const tail = moveDotBeforeFollowingWordInPlainSegment(text.slice(lastIndex));
  normalizedText += tail.text;
  movedDotCount += tail.movedDotCount;

  return { normalizedText, movedDotCount };
}

function getWorkerScriptVersion(scriptPath: string): string {
  try {
    const stat = fs.statSync(scriptPath);
    return `${OMNIVOICE_WORKER_PROTOCOL_VERSION}:${stat.mtimeMs}`;
  } catch {
    return `${OMNIVOICE_WORKER_PROTOCOL_VERSION}:missing`;
  }
}

function buildWorkerKey(input: {
  pythonCommand: string;
  scriptPath: string;
  scriptVersion: string;
  modelId: string;
  deviceMap: OmniVoiceDeviceMap;
  dtype: OmniVoiceDType;
}): string {
  return [
    input.pythonCommand,
    input.scriptPath,
    input.scriptVersion,
    input.modelId,
    input.deviceMap,
    input.dtype,
  ].join('|');
}

function stopOmniVoiceWorker(reason: string): void {
  const worker = omniVoiceGlobal.__omniVoiceWorkerState;
  if (!worker) return;

  if (worker.idleTimer) {
    clearTimeout(worker.idleTimer);
    worker.idleTimer = undefined;
  }

  for (const [jobId, pending] of worker.pending.entries()) {
    if (pending.timer) {
      clearTimeout(pending.timer);
    }
    pending.reject(
      new Error(`OmniVoice worker stopped (${reason}) before job ${jobId}`),
    );
    worker.pending.delete(jobId);
  }

  try {
    worker.child.kill('SIGTERM');
  } catch {
    // ignore
  }

  omniVoiceGlobal.__omniVoiceWorkerState = undefined;
}

function scheduleWorkerIdleShutdown(worker: OmniVoiceWorkerState): void {
  if (worker.idleTimer) {
    clearTimeout(worker.idleTimer);
  }

  worker.idleTimer = setTimeout(() => {
    if (worker.pending.size > 0) {
      scheduleWorkerIdleShutdown(worker);
      return;
    }

    if (omniVoiceGlobal.__omniVoiceWorkerState?.key === worker.key) {
      stopOmniVoiceWorker('idle-timeout');
    }
  }, OMNIVOICE_IDLE_TIMEOUT_MS);
}

function startOmniVoiceWorker(input: {
  pythonCommand: string;
  pythonSource: string;
  scriptPath: string;
  scriptVersion: string;
  modelId: string;
  deviceMap: OmniVoiceDeviceMap;
  dtype: OmniVoiceDType;
}): OmniVoiceWorkerState {
  console.info(
    `[OmniVoice] worker=starting source=${input.pythonSource} model=${input.modelId} device=${input.deviceMap} dtype=${input.dtype}`,
  );

  const key = buildWorkerKey({
    pythonCommand: input.pythonCommand,
    scriptPath: input.scriptPath,
    scriptVersion: input.scriptVersion,
    modelId: input.modelId,
    deviceMap: input.deviceMap,
    dtype: input.dtype,
  });

  const child = spawn(
    input.pythonCommand,
    [
      input.scriptPath,
      '--model-id',
      input.modelId,
      '--device-map',
      input.deviceMap,
      '--dtype',
      input.dtype,
    ],
    {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: {
        ...process.env,
        PYTORCH_ENABLE_MPS_FALLBACK: '0',
      },
    },
  );

  const worker: OmniVoiceWorkerState = {
    child,
    key,
    pythonCommand: input.pythonCommand,
    pythonSource: input.pythonSource,
    pending: new Map<string, WorkerPendingJob>(),
    stdoutBuffer: '',
    stderrBuffer: '',
    stderrTail: '',
    idleTimer: undefined,
  };

  child.stdout.setEncoding('utf8');
  child.stderr.setEncoding('utf8');

  child.stdout.on('data', (chunk: string) => {
    worker.stdoutBuffer += chunk;
    const lines = worker.stdoutBuffer.split(/\r?\n/);
    worker.stdoutBuffer = lines.pop() || '';

    for (const lineRaw of lines) {
      const line = lineRaw.trim();
      if (!line) continue;

      let parsed: {
        id?: string;
        ok?: boolean;
        error?: string;
        sample_rate?: number;
        cache_hit?: boolean;
        prompt_cache_size?: number;
        prompt_ms?: number;
        generate_ms?: number;
      };

      try {
        parsed = JSON.parse(line) as {
          id?: string;
          ok?: boolean;
          error?: string;
          sample_rate?: number;
          cache_hit?: boolean;
          prompt_cache_size?: number;
          prompt_ms?: number;
          generate_ms?: number;
        };
      } catch {
        continue;
      }

      if (!parsed.id) continue;
      const pending = worker.pending.get(parsed.id);
      if (!pending) continue;

      if (pending.timer) {
        clearTimeout(pending.timer);
      }
      worker.pending.delete(parsed.id);

      if (parsed.ok) {
        pending.resolve({
          sampleRate: parsed.sample_rate || 24000,
          cacheHit: Boolean(parsed.cache_hit),
          promptCacheSize: Math.max(0, Number(parsed.prompt_cache_size || 0)),
          promptMs: Math.max(0, Number(parsed.prompt_ms || 0)),
          generateMs: Math.max(0, Number(parsed.generate_ms || 0)),
        });
      } else {
        pending.reject(
          new Error(parsed.error || 'OmniVoice worker returned failure'),
        );
      }
    }
  });

  child.stderr.on('data', (chunk: string) => {
    const next = `${worker.stderrTail}${chunk}`;
    worker.stderrTail = next.slice(-4000);

    worker.stderrBuffer += chunk;
    const lines = worker.stderrBuffer.split(/\r?\n/);
    worker.stderrBuffer = lines.pop() || '';

    for (const rawLine of lines) {
      const line = rawLine.trim();
      if (!line) continue;
      console.info(`[OmniVoice][worker] ${line}`);
    }
  });

  child.on('error', (err) => {
    const current = omniVoiceGlobal.__omniVoiceWorkerState;
    if (!current || current.key !== worker.key) return;
    stopOmniVoiceWorker(`process-error: ${err.message}`);
  });

  child.on('close', (code, signal) => {
    const current = omniVoiceGlobal.__omniVoiceWorkerState;
    if (!current || current.key !== worker.key) return;
    stopOmniVoiceWorker(
      `process-exit: code=${code ?? 'null'} signal=${signal ?? 'null'}`,
    );
  });

  scheduleWorkerIdleShutdown(worker);
  omniVoiceGlobal.__omniVoiceWorkerState = worker;
  return worker;
}

function ensureOmniVoiceWorker(input: {
  pythonCommand: string;
  pythonSource: string;
  scriptPath: string;
  scriptVersion: string;
  modelId: string;
  deviceMap: OmniVoiceDeviceMap;
  dtype: OmniVoiceDType;
}): OmniVoiceWorkerState {
  const key = buildWorkerKey({
    pythonCommand: input.pythonCommand,
    scriptPath: input.scriptPath,
    scriptVersion: input.scriptVersion,
    modelId: input.modelId,
    deviceMap: input.deviceMap,
    dtype: input.dtype,
  });

  const existing = omniVoiceGlobal.__omniVoiceWorkerState;
  if (existing && existing.key === key && !existing.child.killed) {
    console.info(
      `[OmniVoice] worker=reused source=${existing.pythonSource} model=${input.modelId} device=${input.deviceMap} dtype=${input.dtype}`,
    );
    scheduleWorkerIdleShutdown(existing);
    return existing;
  }

  if (existing) {
    stopOmniVoiceWorker('config-changed');
  }

  return startOmniVoiceWorker(input);
}

async function runOmniVoiceWorkerJob(input: {
  worker: OmniVoiceWorkerState;
  text: string;
  outputPath: string;
  referenceAudioPath: string;
  referenceText?: string;
  language?: string;
  numStep: number;
  speed: number;
}): Promise<WorkerJobResult> {
  const jobId = `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;

  const payload = {
    id: jobId,
    text: input.text,
    output_path: input.outputPath,
    reference_audio: input.referenceAudioPath,
    reference_text: input.referenceText || '',
    language: input.language || '',
    num_step: input.numStep,
    speed: input.speed,
  };

  const worker = input.worker;
  scheduleWorkerIdleShutdown(worker);

  return new Promise<WorkerJobResult>((resolve, reject) => {
    const timer =
      OMNIVOICE_JOB_TIMEOUT_MS > 0
        ? setTimeout(() => {
            worker.pending.delete(jobId);
            reject(
              new Error(
                `OmniVoice worker timed out after ${Math.round(OMNIVOICE_JOB_TIMEOUT_MS / 1000)}s`,
              ),
            );
          }, OMNIVOICE_JOB_TIMEOUT_MS)
        : undefined;

    worker.pending.set(jobId, {
      resolve: (value) => {
        resolve(value);
      },
      reject,
      timer,
    });

    try {
      worker.child.stdin.write(`${JSON.stringify(payload)}\n`);
    } catch (error) {
      if (timer) {
        clearTimeout(timer);
      }
      worker.pending.delete(jobId);
      reject(
        new Error(
          `Failed to dispatch OmniVoice worker job: ${
            error instanceof Error ? error.message : 'unknown error'
          }`,
        ),
      );
    }
  });
}

export async function POST(request: NextRequest) {
  let outputPath = '';
  const requestStartedAt = Date.now();

  try {
    const body = (await request.json()) as RequestBody;
    const rawText = typeof body.text === 'string' ? body.text.trim() : '';
    const aggressiveEdgeTrim = toBoolean(body.aggressiveEdgeTrim, false);

    const hasSceneId = hasIdValue(body.sceneId);
    const hasVideoId = hasIdValue(body.videoId);

    if (!rawText || (!hasSceneId && !hasVideoId)) {
      return NextResponse.json(
        { error: 'Text and (sceneId or videoId) are required' },
        { status: 400 },
      );
    }

    const replacements = await loadWordReplacementsFromApi(request);
    const {
      text: textWithReplacements,
      substitutions: replacementSubstitutions,
    } = applyWordReplacements(rawText, replacements);

    const { normalizedText: textWithHyphenWordsSplit, hyphenSplitCount } =
      normalizeHyphenSeparatedWordsForOmniVoice(textWithReplacements);

    const { normalizedText: textWithCamelCaseSplit, splitWordCount } =
      splitCamelCaseForOmniVoice(textWithHyphenWordsSplit);

    const { normalizedText: textWithDotSeparatedWords, movedDotCount } =
      normalizeDotSeparatedWordsForOmniVoice(textWithCamelCaseSplit);

    const { sanitizedText: text, removedQuoteCount } = stripOmniVoiceQuoteChars(
      textWithDotSeparatedWords,
    );

    if (!text) {
      return NextResponse.json(
        {
          error:
            'Text is empty after removing quote/backtick characters for OmniVoice TTS.',
        },
        { status: 400 },
      );
    }

    console.info(
      `[OmniVoice] outbound_tts_text sceneId=${hasSceneId ? String(body.sceneId) : 'n/a'} videoId=${hasVideoId ? String(body.videoId) : 'n/a'} replacementsApplied=${replacementSubstitutions} replacementsConfigured=${replacements.length} hyphenWordsSplit=${hyphenSplitCount} camelCaseWordsSplit=${splitWordCount} dotPrefixesMoved=${movedDotCount} removedQuotes=${removedQuoteCount} text=${JSON.stringify(text)}`,
    );

    const omniVoice = body.ttsSettings?.omniVoice || {};

    const modelId = (omniVoice.modelId || 'k2-fsa/OmniVoice').trim();
    const deviceMap = resolveDeviceMap(omniVoice.deviceMap);
    const dtype = resolveDType(omniVoice.dtype);
    const numStep = Math.max(
      8,
      Math.min(64, toPositiveInt(omniVoice.numStep, 32)),
    );
    const speed = Math.max(
      0.5,
      Math.min(2.0, toFiniteNumber(omniVoice.speed, 1.0)),
    );
    const referenceText =
      typeof omniVoice.referenceText === 'string'
        ? omniVoice.referenceText.trim()
        : '';
    const language =
      typeof omniVoice.language === 'string' ? omniVoice.language.trim() : '';

    const referenceAudioName =
      normalizeRefAudioName(body.referenceAudioFilename) ||
      normalizeRefAudioName(body.ttsSettings?.reference_audio_filename);

    if (!referenceAudioName) {
      return NextResponse.json(
        {
          error:
            'OmniVoice voice cloning requires a reference audio filename/path. Set TTS voice reference for the video/scene or provide referenceAudioFilename.',
        },
        { status: 400 },
      );
    }

    const referenceAudioResolution = resolveReferenceAudioPath({
      filenameOrPath: referenceAudioName,
      configuredDir: omniVoice.referenceAudioDir,
    });

    const scriptPath = path.join(
      process.cwd(),
      'omnivoice-local',
      'omnivoice_worker.py',
    );
    const scriptVersion = getWorkerScriptVersion(scriptPath);

    if (!fs.existsSync(scriptPath)) {
      return NextResponse.json(
        {
          error:
            'OmniVoice worker is missing at omnivoice-local/omnivoice_worker.py',
        },
        { status: 500 },
      );
    }

    const { command: pythonCommand, source: pythonSource } =
      await selectOmniVoicePythonCommand({
        envVarName: 'OMNIVOICE_PYTHON',
        configuredSetting: omniVoice.pythonPath,
        absoluteCandidates: [
          path.join(process.cwd(), '.venv', 'bin', 'python'),
          path.join(process.cwd(), '.venv', 'bin', 'python3'),
          path.join(process.cwd(), 'parakeet-env', 'bin', 'python'),
          path.join(process.cwd(), 'parakeet-env', 'bin', 'python3'),
        ],
        fallbackCommand: 'python3',
      });

    const hasModules = await hasRequiredOmniVoiceModules(pythonCommand);
    if (!hasModules) {
      throw new Error(
        `OmniVoice dependencies are missing in selected Python (${pythonCommand}, ${pythonSource}). Install: torch, torchaudio, omnivoice`,
      );
    }

    const tmpDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'omnivoice-tts-'));
    outputPath = path.join(tmpDir, 'out.wav');

    const worker = ensureOmniVoiceWorker({
      pythonCommand,
      pythonSource,
      scriptPath,
      scriptVersion,
      modelId,
      deviceMap,
      dtype,
    });

    const workerJobStartedAt = Date.now();
    const runResult = await runOmniVoiceWorkerJob({
      worker,
      text,
      outputPath,
      referenceAudioPath: referenceAudioResolution.fullPath,
      referenceText,
      language,
      numStep,
      speed,
    });
    const workerJobMs = Date.now() - workerJobStartedAt;

    const trimMetrics: EdgeTrimMetrics = {
      requested: aggressiveEdgeTrim,
      applied: false,
      thresholdDb: OMNIVOICE_RIGHT_CLICK_TRIM_THRESHOLD_DB,
      leadingRemovedSec: null,
      trailingRemovedSec: null,
      totalRemovedSec: null,
      originalDurationSec: null,
      trimmedDurationSec: null,
      error: null,
    };

    const thresholdLinear = dbToLinear(OMNIVOICE_RIGHT_CLICK_TRIM_THRESHOLD_DB);
    let audioBytesBuffer: Buffer;

    if (!aggressiveEdgeTrim) {
      audioBytesBuffer = await fsp.readFile(outputPath);
    } else {
      const rawAudioBytes = await fsp.readFile(outputPath);
      audioBytesBuffer = rawAudioBytes;
      const beforeDetection = detectEdgeSilenceFromWav(
        rawAudioBytes,
        thresholdLinear,
      );

      if (beforeDetection) {
        trimMetrics.originalDurationSec = roundTo(beforeDetection.durationSec);
      }

      const trimmedPath = path.join(tmpDir, 'out_edge_trimmed.wav');

      try {
        await applyAggressiveEdgeTrimWav(outputPath, trimmedPath);
        const trimmedAudioBytes = await fsp.readFile(trimmedPath);
        if (trimmedAudioBytes.byteLength > 0) {
          audioBytesBuffer = trimmedAudioBytes;
          trimMetrics.applied = true;

          const afterDetection = detectEdgeSilenceFromWav(
            trimmedAudioBytes,
            thresholdLinear,
          );

          if (beforeDetection && afterDetection) {
            const leadingRemoved = Math.max(
              0,
              beforeDetection.leadingSilenceSec -
                afterDetection.leadingSilenceSec,
            );
            trimMetrics.leadingRemovedSec = roundTo(leadingRemoved);
            trimMetrics.trailingRemovedSec = 0;
            trimMetrics.totalRemovedSec = roundTo(leadingRemoved);
            trimMetrics.trimmedDurationSec = roundTo(
              afterDetection.durationSec,
            );
          } else if (beforeDetection) {
            trimMetrics.leadingRemovedSec = roundTo(
              beforeDetection.leadingSilenceSec,
            );
            trimMetrics.trailingRemovedSec = 0;
            trimMetrics.totalRemovedSec = roundTo(
              beforeDetection.leadingSilenceSec,
            );
          }
        }
      } catch (error) {
        trimMetrics.error =
          error instanceof Error
            ? error.message
            : 'Aggressive edge trim failed';
        console.warn(
          `[OmniVoice] right-click aggressive edge trim failed; using original output. error=${trimMetrics.error}`,
        );
      }

      console.info(
        `[OmniVoice] right-click begin-trim requested=${trimMetrics.requested} applied=${trimMetrics.applied} thresholdDb=${trimMetrics.thresholdDb} startDurationSec=${OMNIVOICE_RIGHT_CLICK_TRIM_START_DURATION_SEC} keepSilenceSec=${OMNIVOICE_RIGHT_CLICK_TRIM_KEEP_SILENCE_SEC} beginningRemovedSec=${trimMetrics.leadingRemovedSec ?? 'n/a'} originalDurationSec=${trimMetrics.originalDurationSec ?? 'n/a'} trimmedDurationSec=${trimMetrics.trimmedDurationSec ?? 'n/a'} totalRemovedSec=${trimMetrics.totalRemovedSec ?? 'n/a'}`,
      );
    }

    const timestamp = Date.now();
    const filename = hasVideoId
      ? hasSceneId
        ? `video_${body.videoId}_scene_${body.sceneId}_omnivoice_tts_${timestamp}.wav`
        : `video_${body.videoId}_omnivoice_tts_${timestamp}.wav`
      : `scene_${body.sceneId}_omnivoice_tts_${timestamp}.wav`;

    const bucket = 'nca-toolkit';
    const uploadUrl = `http://host.docker.internal:9000/${bucket}/${filename}`;

    const uploadStartedAt = Date.now();
    const uploadResponse = await fetch(uploadUrl, {
      method: 'PUT',
      headers: {
        'Content-Type': 'audio/wav',
      },
      body: new Uint8Array(audioBytesBuffer),
    });
    const uploadMs = Date.now() - uploadStartedAt;

    if (!uploadResponse.ok) {
      const errorText = await uploadResponse
        .text()
        .catch(() => 'Unknown error');
      throw new Error(
        `MinIO upload failed (${uploadResponse.status}): ${errorText}`,
      );
    }

    const totalMs = Date.now() - requestStartedAt;
    console.info(
      `[OmniVoice] cache=${runResult.cacheHit ? 'HIT' : 'MISS'} cacheSize=${runResult.promptCacheSize} ref=${path.basename(referenceAudioResolution.fullPath)} steps=${numStep} speed=${speed} workerJobMs=${workerJobMs} promptMs=${formatMs(runResult.promptMs)} generateMs=${formatMs(runResult.generateMs)} beginTrimRequested=${trimMetrics.requested} beginTrimApplied=${trimMetrics.applied} beginTrimThresholdDb=${trimMetrics.thresholdDb} beginTrimStartDurationSec=${OMNIVOICE_RIGHT_CLICK_TRIM_START_DURATION_SEC} beginTrimKeepSilenceSec=${OMNIVOICE_RIGHT_CLICK_TRIM_KEEP_SILENCE_SEC} beginTrimSec=${trimMetrics.leadingRemovedSec ?? 'n/a'} uploadMs=${uploadMs} totalMs=${totalMs}`,
    );

    return NextResponse.json({
      provider: 'omnivoice',
      audioUrl: uploadUrl,
      filename,
      bucket,
      sceneId: hasSceneId ? body.sceneId : null,
      videoId: hasVideoId ? body.videoId : null,
      generationParams: {
        modelId,
        deviceMap,
        dtype,
        numStep,
        speed,
        language,
        removedQuoteCount,
        hyphenWordsSplit: hyphenSplitCount,
        camelCaseWordsSplit: splitWordCount,
        dotPrefixesMoved: movedDotCount,
        wordReplacementsApplied: replacementSubstitutions,
        wordReplacementsConfigured: replacements.length,
        referenceAudio: path.basename(referenceAudioResolution.fullPath),
        pythonSource,
        sampleRate: runResult.sampleRate,
        cacheHit: runResult.cacheHit,
        promptCacheSize: runResult.promptCacheSize,
        promptMs: runResult.promptMs,
        generateMs: runResult.generateMs,
        aggressiveEdgeTrimRequested: trimMetrics.requested,
        aggressiveEdgeTrimApplied: trimMetrics.applied,
        aggressiveEdgeTrimThresholdDb: trimMetrics.thresholdDb,
        aggressiveEdgeTrimStartDurationSec:
          OMNIVOICE_RIGHT_CLICK_TRIM_START_DURATION_SEC,
        aggressiveEdgeTrimKeepSilenceSec:
          OMNIVOICE_RIGHT_CLICK_TRIM_KEEP_SILENCE_SEC,
        aggressiveEdgeTrimLeadingRemovedSec: trimMetrics.leadingRemovedSec,
        aggressiveEdgeTrimTrailingRemovedSec: trimMetrics.trailingRemovedSec,
        aggressiveEdgeTrimTotalRemovedSec: trimMetrics.totalRemovedSec,
        aggressiveEdgeTrimOriginalDurationSec: trimMetrics.originalDurationSec,
        aggressiveEdgeTrimTrimmedDurationSec: trimMetrics.trimmedDurationSec,
        aggressiveEdgeTrimError: trimMetrics.error,
        workerJobMs,
        uploadMs,
        totalMs,
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json({ error: message }, { status: 500 });
  } finally {
    if (outputPath) {
      const dir = path.dirname(outputPath);
      await fsp.rm(dir, { recursive: true, force: true }).catch(() => {
        // ignore cleanup failures
      });
    }
  }
}
