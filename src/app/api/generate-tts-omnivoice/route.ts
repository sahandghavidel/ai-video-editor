import { NextRequest, NextResponse } from 'next/server';
import { spawn } from 'child_process';
import type { ChildProcessWithoutNullStreams } from 'child_process';
import fs from 'fs';
import path from 'path';
import { promises as fsp } from 'fs';
import os from 'os';

export const runtime = 'nodejs';
export const maxDuration = 900;

type OmniVoiceDeviceMap = 'mps' | 'cpu' | 'auto';
type OmniVoiceDType = 'float16' | 'float32' | 'bfloat16';

interface OmniVoiceTtsSettings {
  pythonPath?: string;
  modelId?: string;
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
  ttsSettings?: {
    reference_audio_filename?: string;
    omniVoice?: OmniVoiceTtsSettings;
  };
}

const OMNIVOICE_IDLE_TIMEOUT_MS = 5 * 60 * 1000;
const OMNIVOICE_JOB_TIMEOUT_MS = 10 * 60 * 1000;

type WorkerJobResult = {
  sampleRate: number;
  cacheHit: boolean;
  promptCacheSize: number;
};

type WorkerPendingJob = {
  resolve: (value: WorkerJobResult) => void;
  reject: (reason: Error) => void;
  timer: NodeJS.Timeout;
};

type OmniVoiceWorkerState = {
  child: ChildProcessWithoutNullStreams;
  key: string;
  pythonCommand: string;
  pythonSource: string;
  pending: Map<string, WorkerPendingJob>;
  stdoutBuffer: string;
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
          PYTORCH_ENABLE_MPS_FALLBACK:
            process.env.PYTORCH_ENABLE_MPS_FALLBACK || '1',
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
  return value === 'cpu' || value === 'auto' || value === 'mps' ? value : 'mps';
}

function buildWorkerKey(input: {
  pythonCommand: string;
  scriptPath: string;
  modelId: string;
  deviceMap: OmniVoiceDeviceMap;
  dtype: OmniVoiceDType;
}): string {
  return [
    input.pythonCommand,
    input.scriptPath,
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
    clearTimeout(pending.timer);
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
  modelId: string;
  deviceMap: OmniVoiceDeviceMap;
  dtype: OmniVoiceDType;
}): OmniVoiceWorkerState {
  const key = buildWorkerKey({
    pythonCommand: input.pythonCommand,
    scriptPath: input.scriptPath,
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
        PYTORCH_ENABLE_MPS_FALLBACK:
          process.env.PYTORCH_ENABLE_MPS_FALLBACK || '1',
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
      };

      try {
        parsed = JSON.parse(line) as {
          id?: string;
          ok?: boolean;
          error?: string;
          sample_rate?: number;
          cache_hit?: boolean;
          prompt_cache_size?: number;
        };
      } catch {
        continue;
      }

      if (!parsed.id) continue;
      const pending = worker.pending.get(parsed.id);
      if (!pending) continue;

      clearTimeout(pending.timer);
      worker.pending.delete(parsed.id);

      if (parsed.ok) {
        pending.resolve({
          sampleRate: parsed.sample_rate || 24000,
          cacheHit: Boolean(parsed.cache_hit),
          promptCacheSize: Math.max(0, Number(parsed.prompt_cache_size || 0)),
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
  modelId: string;
  deviceMap: OmniVoiceDeviceMap;
  dtype: OmniVoiceDType;
}): OmniVoiceWorkerState {
  const key = buildWorkerKey({
    pythonCommand: input.pythonCommand,
    scriptPath: input.scriptPath,
    modelId: input.modelId,
    deviceMap: input.deviceMap,
    dtype: input.dtype,
  });

  const existing = omniVoiceGlobal.__omniVoiceWorkerState;
  if (existing && existing.key === key && !existing.child.killed) {
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
    num_step: input.numStep,
    speed: input.speed,
  };

  const worker = input.worker;
  scheduleWorkerIdleShutdown(worker);

  return new Promise<WorkerJobResult>((resolve, reject) => {
    const timer = setTimeout(() => {
      worker.pending.delete(jobId);
      reject(
        new Error(
          `OmniVoice worker timed out after ${Math.round(OMNIVOICE_JOB_TIMEOUT_MS / 1000)}s`,
        ),
      );
    }, OMNIVOICE_JOB_TIMEOUT_MS);

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
      clearTimeout(timer);
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

  try {
    const body = (await request.json()) as RequestBody;
    const text = typeof body.text === 'string' ? body.text.trim() : '';

    const hasSceneId = hasIdValue(body.sceneId);
    const hasVideoId = hasIdValue(body.videoId);

    if (!text || (!hasSceneId && !hasVideoId)) {
      return NextResponse.json(
        { error: 'Text and (sceneId or videoId) are required' },
        { status: 400 },
      );
    }

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
      modelId,
      deviceMap,
      dtype,
    });

    const runResult = await runOmniVoiceWorkerJob({
      worker,
      text,
      outputPath,
      referenceAudioPath: referenceAudioResolution.fullPath,
      referenceText,
      numStep,
      speed,
    });

    console.info(
      `[OmniVoice] cache=${runResult.cacheHit ? 'HIT' : 'MISS'} cacheSize=${runResult.promptCacheSize} ref=${path.basename(referenceAudioResolution.fullPath)} steps=${numStep} speed=${speed}`,
    );

    const audioBytes = await fsp.readFile(outputPath);

    const timestamp = Date.now();
    const filename = hasVideoId
      ? hasSceneId
        ? `video_${body.videoId}_scene_${body.sceneId}_omnivoice_tts_${timestamp}.wav`
        : `video_${body.videoId}_omnivoice_tts_${timestamp}.wav`
      : `scene_${body.sceneId}_omnivoice_tts_${timestamp}.wav`;

    const bucket = 'nca-toolkit';
    const uploadUrl = `http://host.docker.internal:9000/${bucket}/${filename}`;

    const uploadResponse = await fetch(uploadUrl, {
      method: 'PUT',
      headers: {
        'Content-Type': 'audio/wav',
      },
      body: new Uint8Array(audioBytes),
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
        referenceAudio: path.basename(referenceAudioResolution.fullPath),
        pythonSource,
        sampleRate: runResult.sampleRate,
        cacheHit: runResult.cacheHit,
        promptCacheSize: runResult.promptCacheSize,
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
