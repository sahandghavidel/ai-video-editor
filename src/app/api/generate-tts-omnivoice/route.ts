import { NextRequest, NextResponse } from 'next/server';
import { spawn } from 'child_process';
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

async function runOmniVoiceProcess(input: {
  pythonCommand: string;
  scriptPath: string;
  text: string;
  outputPath: string;
  referenceAudioPath: string;
  modelId: string;
  deviceMap: OmniVoiceDeviceMap;
  dtype: OmniVoiceDType;
  numStep: number;
  speed: number;
}): Promise<{ sampleRate: number }> {
  const args = [
    input.scriptPath,
    '--text',
    input.text,
    '--output',
    input.outputPath,
    '--reference-audio',
    input.referenceAudioPath,
    '--model-id',
    input.modelId,
    '--device-map',
    input.deviceMap,
    '--dtype',
    input.dtype,
    '--num-step',
    String(input.numStep),
    '--speed',
    String(input.speed),
  ];

  return new Promise((resolve, reject) => {
    const child = spawn(input.pythonCommand, args, {
      stdio: ['ignore', 'pipe', 'pipe'],
      env: {
        ...process.env,
        PYTORCH_ENABLE_MPS_FALLBACK:
          process.env.PYTORCH_ENABLE_MPS_FALLBACK || '1',
      },
    });

    let stdout = '';
    let stderr = '';

    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString();
    });

    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
    });

    child.on('error', (err) => {
      reject(new Error(`Failed to start OmniVoice runner: ${err.message}`));
    });

    child.on('close', (code) => {
      if (code !== 0) {
        const details = stderr.trim() || stdout.trim() || `exit code ${code}`;
        reject(new Error(`OmniVoice runner failed: ${details}`));
        return;
      }

      const trimmed = stdout.trim();
      if (!trimmed) {
        reject(new Error('OmniVoice runner returned empty output'));
        return;
      }

      try {
        const parsed = JSON.parse(trimmed) as {
          ok?: boolean;
          output_path?: string;
          sample_rate?: number;
          error?: string;
        };

        if (!parsed.ok) {
          reject(
            new Error(parsed.error || 'OmniVoice runner reported failure'),
          );
          return;
        }

        resolve({ sampleRate: parsed.sample_rate || 24000 });
      } catch {
        reject(
          new Error(
            `OmniVoice runner returned invalid JSON: ${trimmed.slice(0, 500)}`,
          ),
        );
      }
    });
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
      'run_omnivoice_tts.py',
    );

    if (!fs.existsSync(scriptPath)) {
      return NextResponse.json(
        {
          error:
            'OmniVoice runner is missing at omnivoice-local/run_omnivoice_tts.py',
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

    const runResult = await runOmniVoiceProcess({
      pythonCommand,
      scriptPath,
      text,
      outputPath,
      referenceAudioPath: referenceAudioResolution.fullPath,
      modelId,
      deviceMap,
      dtype,
      numStep,
      speed,
    });

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
