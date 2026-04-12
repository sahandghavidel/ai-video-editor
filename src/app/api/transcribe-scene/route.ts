import { NextRequest, NextResponse } from 'next/server';
import { ChildProcessWithoutNullStreams, spawn } from 'child_process';
import { randomUUID } from 'crypto';
import fs from 'fs';
import path from 'path';

function resolvePythonCommand(options: {
  envVarName: string;
  absoluteCandidates: string[];
  fallbackCommand: string;
}): { command: string; source: string } {
  const configured = process.env[options.envVarName];
  if (configured && configured.trim().length > 0) {
    const trimmed = configured.trim();
    if (trimmed.includes('/') && !fs.existsSync(trimmed)) {
      return {
        command: options.fallbackCommand,
        source: `${options.envVarName} was set but points to a missing path (${trimmed}); falling back to ${options.fallbackCommand}`,
      };
    }
    return { command: trimmed, source: `env:${options.envVarName}` };
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

type MediumEnPendingJob = {
  resolve: (value: Record<string, unknown>) => void;
  reject: (reason: Error) => void;
  timeout: NodeJS.Timeout | null;
};

type MediumEnQueuedJob = {
  id: string;
  mediaUrl: string;
  sceneId: string;
};

type MediumEnWorkerState = {
  worker: ChildProcessWithoutNullStreams | null;
  workerKey: string | null;
  idleTimer: NodeJS.Timeout | null;
  stdoutBuffer: string;
  inFlightJobId: string | null;
  pendingJobs: Map<string, MediumEnPendingJob>;
  jobQueue: MediumEnQueuedJob[];
  lastStderrLine: string | null;
};

const MEDIUM_EN_KEEP_WARM_MS = 2 * 60 * 1000;
const MEDIUM_EN_JOB_TIMEOUT_MS = 15 * 60 * 1000;

const mediumEnGlobal = globalThis as typeof globalThis & {
  __mediumEnWorkerState?: MediumEnWorkerState;
};

const mediumEnState: MediumEnWorkerState =
  mediumEnGlobal.__mediumEnWorkerState ??
  (mediumEnGlobal.__mediumEnWorkerState = {
    worker: null,
    workerKey: null,
    idleTimer: null,
    stdoutBuffer: '',
    inFlightJobId: null,
    pendingJobs: new Map<string, MediumEnPendingJob>(),
    jobQueue: [],
    lastStderrLine: null,
  });

function clearMediumEnIdleTimer() {
  if (mediumEnState.idleTimer) {
    clearTimeout(mediumEnState.idleTimer);
    mediumEnState.idleTimer = null;
  }
}

function scheduleMediumEnIdleShutdown() {
  clearMediumEnIdleTimer();
  if (
    !mediumEnState.worker ||
    mediumEnState.inFlightJobId ||
    mediumEnState.jobQueue.length > 0 ||
    mediumEnState.pendingJobs.size > 0
  ) {
    return;
  }

  mediumEnState.idleTimer = setTimeout(() => {
    if (
      !mediumEnState.worker ||
      mediumEnState.inFlightJobId ||
      mediumEnState.jobQueue.length > 0 ||
      mediumEnState.pendingJobs.size > 0
    ) {
      return;
    }

    console.log(
      '[SCENE_TRANSCRIBE] medium.en worker idle for 2 minutes, unloading model',
    );
    mediumEnState.worker.kill('SIGTERM');
  }, MEDIUM_EN_KEEP_WARM_MS);
}

function rejectAllMediumEnJobs(error: Error) {
  for (const [jobId, pending] of mediumEnState.pendingJobs.entries()) {
    if (pending.timeout) {
      clearTimeout(pending.timeout);
    }
    pending.reject(error);
    mediumEnState.pendingJobs.delete(jobId);
  }
  mediumEnState.jobQueue.length = 0;
  mediumEnState.inFlightJobId = null;
}

function dispatchMediumEnQueue() {
  if (
    !mediumEnState.worker ||
    mediumEnState.inFlightJobId ||
    mediumEnState.jobQueue.length === 0
  ) {
    return;
  }

  const nextJob = mediumEnState.jobQueue.shift();
  if (!nextJob) {
    return;
  }

  const pending = mediumEnState.pendingJobs.get(nextJob.id);
  if (!pending) {
    dispatchMediumEnQueue();
    return;
  }

  try {
    mediumEnState.worker.stdin.write(
      JSON.stringify({
        id: nextJob.id,
        media_url: nextJob.mediaUrl,
        scene_id: nextJob.sceneId,
      }) + '\n',
    );
    mediumEnState.inFlightJobId = nextJob.id;

    pending.timeout = setTimeout(() => {
      const timedOutJob = mediumEnState.pendingJobs.get(nextJob.id);
      if (!timedOutJob) {
        return;
      }

      mediumEnState.pendingJobs.delete(nextJob.id);
      if (mediumEnState.inFlightJobId === nextJob.id) {
        mediumEnState.inFlightJobId = null;
      }

      timedOutJob.reject(
        new Error(
          `Scene Whisper medium.en transcription timed out after ${MEDIUM_EN_JOB_TIMEOUT_MS}ms`,
        ),
      );

      if (mediumEnState.worker) {
        mediumEnState.worker.kill('SIGTERM');
      }
      scheduleMediumEnIdleShutdown();
    }, MEDIUM_EN_JOB_TIMEOUT_MS);
  } catch (error) {
    mediumEnState.pendingJobs.delete(nextJob.id);
    pending.reject(
      new Error(
        `Failed to dispatch medium.en transcription job: ${error instanceof Error ? error.message : String(error)}`,
      ),
    );
    mediumEnState.inFlightJobId = null;
    if (mediumEnState.worker) {
      mediumEnState.worker.kill('SIGTERM');
    }
  }
}

function handleMediumEnWorkerLine(line: string) {
  let payload: Record<string, unknown>;
  try {
    payload = JSON.parse(line) as Record<string, unknown>;
  } catch {
    console.warn(
      '[SCENE_TRANSCRIBE] medium.en worker emitted non-JSON line:',
      line,
    );
    return;
  }

  if (payload.ready === true) {
    console.log('[SCENE_TRANSCRIBE] medium.en worker ready (model loaded)');
    return;
  }

  const jobId = typeof payload.id === 'string' ? payload.id : null;
  if (!jobId) {
    return;
  }

  const pending = mediumEnState.pendingJobs.get(jobId);
  if (!pending) {
    return;
  }

  mediumEnState.pendingJobs.delete(jobId);
  if (pending.timeout) {
    clearTimeout(pending.timeout);
  }

  if (mediumEnState.inFlightJobId === jobId) {
    mediumEnState.inFlightJobId = null;
  }

  if (
    payload.ok === true &&
    payload.result &&
    typeof payload.result === 'object'
  ) {
    pending.resolve(payload.result as Record<string, unknown>);
  } else {
    const workerError =
      typeof payload.error === 'string'
        ? payload.error
        : 'Unknown medium.en worker error';
    pending.reject(new Error(workerError));
  }

  dispatchMediumEnQueue();
  scheduleMediumEnIdleShutdown();
}

function ensureMediumEnWorker(pythonCommand: string, scriptPath: string) {
  const workerKey = `${pythonCommand}::${scriptPath}`;

  if (
    mediumEnState.worker &&
    mediumEnState.worker.exitCode === null &&
    mediumEnState.workerKey === workerKey
  ) {
    clearMediumEnIdleTimer();
    return;
  }

  if (
    mediumEnState.worker &&
    mediumEnState.worker.exitCode === null &&
    mediumEnState.workerKey !== workerKey
  ) {
    mediumEnState.worker.kill('SIGTERM');
  }

  clearMediumEnIdleTimer();
  mediumEnState.stdoutBuffer = '';
  mediumEnState.workerKey = workerKey;
  mediumEnState.lastStderrLine = null;

  console.log(
    `[SCENE_TRANSCRIBE] Starting persistent medium.en worker with python: ${pythonCommand}`,
  );

  const worker = spawn(pythonCommand, [scriptPath], {
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  mediumEnState.worker = worker;

  worker.stdout.on('data', (data) => {
    mediumEnState.stdoutBuffer += data.toString();

    let newlineIndex = mediumEnState.stdoutBuffer.indexOf('\n');
    while (newlineIndex >= 0) {
      const line = mediumEnState.stdoutBuffer.slice(0, newlineIndex).trim();
      mediumEnState.stdoutBuffer = mediumEnState.stdoutBuffer.slice(
        newlineIndex + 1,
      );
      if (line) {
        handleMediumEnWorkerLine(line);
      }
      newlineIndex = mediumEnState.stdoutBuffer.indexOf('\n');
    }
  });

  worker.stderr.on('data', (data) => {
    const stderrText = data.toString().trim();
    if (stderrText.length > 0 && stderrText !== mediumEnState.lastStderrLine) {
      mediumEnState.lastStderrLine = stderrText;
      console.log(`[SCENE_TRANSCRIBE][medium.en worker] ${stderrText}`);
    }
  });

  worker.on('close', (code, signal) => {
    const shouldRejectPending =
      mediumEnState.pendingJobs.size > 0 ||
      mediumEnState.jobQueue.length > 0 ||
      mediumEnState.inFlightJobId !== null;

    mediumEnState.worker = null;
    mediumEnState.workerKey = null;
    mediumEnState.stdoutBuffer = '';
    mediumEnState.inFlightJobId = null;
    mediumEnState.lastStderrLine = null;
    clearMediumEnIdleTimer();

    if (shouldRejectPending) {
      rejectAllMediumEnJobs(
        new Error(
          `medium.en worker exited unexpectedly (code=${code ?? 'null'}, signal=${signal ?? 'null'})`,
        ),
      );
    }

    console.log(
      `[SCENE_TRANSCRIBE] medium.en worker stopped (code=${code ?? 'null'}, signal=${signal ?? 'null'})`,
    );
  });

  worker.on('error', (error) => {
    console.error('[SCENE_TRANSCRIBE] medium.en worker process error:', error);
  });
}

function transcribeWithWarmMediumEn(options: {
  pythonCommand: string;
  scriptPath: string;
  mediaUrl: string;
  sceneId: string;
}) {
  ensureMediumEnWorker(options.pythonCommand, options.scriptPath);
  clearMediumEnIdleTimer();

  return new Promise<Record<string, unknown>>((resolve, reject) => {
    const id = randomUUID();
    mediumEnState.pendingJobs.set(id, {
      resolve,
      reject,
      timeout: null,
    });

    mediumEnState.jobQueue.push({
      id,
      mediaUrl: options.mediaUrl,
      sceneId: options.sceneId,
    });

    dispatchMediumEnQueue();
  });
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { media_url, model = 'parakeet', scene_id } = body;

    if (!media_url) {
      return NextResponse.json(
        { error: 'media_url is required' },
        { status: 400 },
      );
    }

    if (!scene_id) {
      return NextResponse.json(
        { error: 'scene_id is required' },
        { status: 400 },
      );
    }

    console.log(
      `[SCENE_TRANSCRIBE] Starting ${model} transcription for scene ${scene_id}:`,
      media_url,
    );

    // Handle different transcription models
    let transcriptionPromise: Promise<Record<string, unknown>>;

    if (model === 'cohere-local') {
      const configuredBaseUrl = process.env.NEXT_PUBLIC_BASE_URL?.trim();
      const headerHost =
        request.headers.get('x-forwarded-host') || request.headers.get('host');
      const headerProto =
        request.headers.get('x-forwarded-proto') ||
        request.nextUrl.protocol.replace(':', '');
      const resolvedBaseUrl =
        configuredBaseUrl ||
        (headerHost ? `${headerProto}://${headerHost}` : undefined);

      if (!resolvedBaseUrl) {
        return NextResponse.json(
          {
            error:
              'Unable to resolve base URL for Cohere local scene transcription route',
          },
          { status: 500 },
        );
      }

      transcriptionPromise = fetch(
        `${resolvedBaseUrl}/api/cohere-local/transcribe-scene`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ media_url, scene_id }),
        },
      ).then(async (res) => {
        const payload = (await res.json().catch(() => ({}))) as Record<
          string,
          unknown
        >;
        if (!res.ok) {
          const errorMessage =
            typeof payload.error === 'string'
              ? payload.error
              : `Cohere local scene route failed with status ${res.status}`;
          throw new Error(errorMessage);
        }
        return payload;
      });
    } else if (model === 'parakeet') {
      // Path to the Parakeet transcription script
      const scriptPath = path.join(process.cwd(), 'parakeet-transcribe.py');
      const { command: pythonCommand, source: pythonSource } =
        resolvePythonCommand({
          envVarName: 'PARAKEET_PYTHON',
          absoluteCandidates: [
            path.join(process.cwd(), 'parakeet-env', 'bin', 'python'),
            path.join(process.cwd(), 'parakeet-env', 'bin', 'python3'),
          ],
          fallbackCommand: 'python3',
        });

      console.log(
        `[SCENE_TRANSCRIBE] Using Parakeet python: ${pythonCommand} (${pythonSource})`,
      );

      // Run the Parakeet transcription script
      transcriptionPromise = new Promise((resolve, reject) => {
        const pythonProcess = spawn(pythonCommand, [scriptPath, media_url], {
          stdio: ['pipe', 'pipe', 'pipe'],
        });

        let stdout = '';
        let stderr = '';

        pythonProcess.stdout.on('data', (data) => {
          stdout += data.toString();
        });

        pythonProcess.stderr.on('data', (data) => {
          stderr += data.toString();
        });

        pythonProcess.on('close', (code) => {
          if (code === 0) {
            try {
              // Parse the JSON output from the Python script
              const result = JSON.parse(stdout);
              resolve(result);
            } catch (parseError) {
              reject(
                new Error(
                  `Failed to parse scene transcription result: ${parseError}`,
                ),
              );
            }
          } else {
            reject(
              new Error(
                `Scene transcription failed with code ${code}: ${stderr}`,
              ),
            );
          }
        });

        pythonProcess.on('error', (error) => {
          reject(
            new Error(
              `Failed to start scene transcription process: ${error.message}`,
            ),
          );
        });
      });
    } else if (model === 'small') {
      // Path to the Whisper small transcription script
      const scriptPath = path.join(
        process.cwd(),
        'whisper-small-transcribe.py',
      );
      const { command: pythonCommand, source: pythonSource } =
        resolvePythonCommand({
          envVarName: 'WHISPER_PYTHON',
          absoluteCandidates: [
            path.join(process.cwd(), 'whisper-env', 'bin', 'python'),
            path.join(process.cwd(), 'whisper-env', 'bin', 'python3'),
            path.join(process.cwd(), 'whisper-env', 'bin', 'python3.13'),
            path.join(process.cwd(), 'parakeet-env', 'bin', 'python'),
            path.join(process.cwd(), 'parakeet-env', 'bin', 'python3'),
          ],
          fallbackCommand: 'python3',
        });

      console.log(
        `[SCENE_TRANSCRIBE] Using Whisper python: ${pythonCommand} (${pythonSource})`,
      );

      // Run the Whisper small transcription script
      transcriptionPromise = new Promise((resolve, reject) => {
        const pythonProcess = spawn(pythonCommand, [scriptPath, media_url], {
          stdio: ['pipe', 'pipe', 'pipe'],
        });

        let stdout = '';
        let stderr = '';

        pythonProcess.stdout.on('data', (data) => {
          stdout += data.toString();
        });

        pythonProcess.stderr.on('data', (data) => {
          stderr += data.toString();
        });

        pythonProcess.on('close', (code) => {
          if (code === 0) {
            try {
              // Parse the JSON output from the Python script
              const result = JSON.parse(stdout);
              resolve(result);
            } catch (parseError) {
              reject(
                new Error(
                  `Failed to parse scene transcription result: ${parseError}`,
                ),
              );
            }
          } else {
            reject(
              new Error(
                `Scene transcription failed with code ${code}: ${stderr}`,
              ),
            );
          }
        });

        pythonProcess.on('error', (error) => {
          reject(
            new Error(
              `Failed to start scene transcription process: ${error.message}`,
            ),
          );
        });
      });
    } else if (model === 'tiny') {
      // Path to the Whisper tiny transcription script
      const scriptPath = path.join(process.cwd(), 'whisper-tiny-transcribe.py');
      const { command: pythonCommand, source: pythonSource } =
        resolvePythonCommand({
          envVarName: 'WHISPER_PYTHON',
          absoluteCandidates: [
            path.join(process.cwd(), 'whisper-env', 'bin', 'python'),
            path.join(process.cwd(), 'whisper-env', 'bin', 'python3'),
            path.join(process.cwd(), 'whisper-env', 'bin', 'python3.13'),
            path.join(process.cwd(), 'parakeet-env', 'bin', 'python'),
            path.join(process.cwd(), 'parakeet-env', 'bin', 'python3'),
          ],
          fallbackCommand: 'python3',
        });

      console.log(
        `[SCENE_TRANSCRIBE] Using Whisper python: ${pythonCommand} (${pythonSource})`,
      );

      // Run the Whisper tiny transcription script
      transcriptionPromise = new Promise((resolve, reject) => {
        const pythonProcess = spawn(pythonCommand, [scriptPath, media_url], {
          stdio: ['pipe', 'pipe', 'pipe'],
        });

        let stdout = '';
        let stderr = '';

        pythonProcess.stdout.on('data', (data) => {
          stdout += data.toString();
        });

        pythonProcess.stderr.on('data', (data) => {
          stderr += data.toString();
        });

        pythonProcess.on('close', (code) => {
          if (code === 0) {
            try {
              // Parse the JSON output from the Python script
              const result = JSON.parse(stdout);
              resolve(result);
            } catch (parseError) {
              reject(
                new Error(
                  `Failed to parse scene transcription result: ${parseError}`,
                ),
              );
            }
          } else {
            reject(
              new Error(
                `Scene Whisper tiny transcription failed with code ${code}: ${stderr}`,
              ),
            );
          }
        });

        pythonProcess.on('error', (error) => {
          reject(
            new Error(
              `Failed to start scene Whisper tiny transcription process: ${error.message}`,
            ),
          );
        });
      });
    } else if (model === 'turbo') {
      // Path to the Whisper turbo transcription script
      const scriptPath = path.join(
        process.cwd(),
        'whisper-turbo-transcribe.py',
      );
      const { command: pythonCommand, source: pythonSource } =
        resolvePythonCommand({
          envVarName: 'WHISPER_PYTHON',
          absoluteCandidates: [
            path.join(process.cwd(), 'whisper-env', 'bin', 'python'),
            path.join(process.cwd(), 'whisper-env', 'bin', 'python3'),
            path.join(process.cwd(), 'whisper-env', 'bin', 'python3.13'),
            path.join(process.cwd(), 'parakeet-env', 'bin', 'python'),
            path.join(process.cwd(), 'parakeet-env', 'bin', 'python3'),
          ],
          fallbackCommand: 'python3',
        });

      console.log(
        `[SCENE_TRANSCRIBE] Using Whisper python: ${pythonCommand} (${pythonSource})`,
      );

      // Run the Whisper turbo transcription script
      transcriptionPromise = new Promise((resolve, reject) => {
        const pythonProcess = spawn(pythonCommand, [scriptPath, media_url], {
          stdio: ['pipe', 'pipe', 'pipe'],
        });

        let stdout = '';
        let stderr = '';

        pythonProcess.stdout.on('data', (data) => {
          stdout += data.toString();
        });

        pythonProcess.stderr.on('data', (data) => {
          stderr += data.toString();
        });

        pythonProcess.on('close', (code) => {
          if (code === 0) {
            try {
              const result = JSON.parse(stdout);
              resolve(result);
            } catch (parseError) {
              reject(
                new Error(
                  `Failed to parse scene transcription result: ${parseError}`,
                ),
              );
            }
          } else {
            reject(
              new Error(
                `Scene Whisper turbo transcription failed with code ${code}: ${stderr}`,
              ),
            );
          }
        });

        pythonProcess.on('error', (error) => {
          reject(
            new Error(
              `Failed to start scene Whisper turbo transcription process: ${error.message}`,
            ),
          );
        });
      });
    } else if (model === 'large') {
      // Path to the Whisper large transcription script
      const scriptPath = path.join(
        process.cwd(),
        'whisper-large-transcribe.py',
      );
      const { command: pythonCommand, source: pythonSource } =
        resolvePythonCommand({
          envVarName: 'WHISPER_PYTHON',
          absoluteCandidates: [
            path.join(process.cwd(), 'whisper-env', 'bin', 'python'),
            path.join(process.cwd(), 'whisper-env', 'bin', 'python3'),
            path.join(process.cwd(), 'whisper-env', 'bin', 'python3.13'),
            path.join(process.cwd(), 'parakeet-env', 'bin', 'python'),
            path.join(process.cwd(), 'parakeet-env', 'bin', 'python3'),
          ],
          fallbackCommand: 'python3',
        });

      console.log(
        `[SCENE_TRANSCRIBE] Using Whisper python: ${pythonCommand} (${pythonSource})`,
      );

      // Run the Whisper large transcription script
      transcriptionPromise = new Promise((resolve, reject) => {
        const pythonProcess = spawn(pythonCommand, [scriptPath, media_url], {
          stdio: ['pipe', 'pipe', 'pipe'],
        });

        let stdout = '';
        let stderr = '';

        pythonProcess.stdout.on('data', (data) => {
          stdout += data.toString();
        });

        pythonProcess.stderr.on('data', (data) => {
          stderr += data.toString();
        });

        pythonProcess.on('close', (code) => {
          if (code === 0) {
            try {
              const result = JSON.parse(stdout);
              resolve(result);
            } catch (parseError) {
              reject(
                new Error(
                  `Failed to parse scene transcription result: ${parseError}`,
                ),
              );
            }
          } else {
            reject(
              new Error(
                `Scene Whisper large transcription failed with code ${code}: ${stderr}`,
              ),
            );
          }
        });

        pythonProcess.on('error', (error) => {
          reject(
            new Error(
              `Failed to start scene Whisper large transcription process: ${error.message}`,
            ),
          );
        });
      });
    } else if (model === 'medium.en') {
      // Path to the Whisper medium.en transcription script
      const scriptPath = path.join(
        process.cwd(),
        'whisper-medium-en-worker.py',
      );
      const { command: pythonCommand, source: pythonSource } =
        resolvePythonCommand({
          envVarName: 'WHISPER_PYTHON',
          absoluteCandidates: [
            path.join(process.cwd(), 'whisper-env', 'bin', 'python'),
            path.join(process.cwd(), 'whisper-env', 'bin', 'python3'),
            path.join(process.cwd(), 'whisper-env', 'bin', 'python3.13'),
            path.join(process.cwd(), 'parakeet-env', 'bin', 'python'),
            path.join(process.cwd(), 'parakeet-env', 'bin', 'python3'),
          ],
          fallbackCommand: 'python3',
        });

      console.log(
        `[SCENE_TRANSCRIBE] Using Whisper python: ${pythonCommand} (${pythonSource})`,
      );

      // Reuse persistent medium.en worker and keep it warm for 2 minutes after each job
      transcriptionPromise = transcribeWithWarmMediumEn({
        pythonCommand,
        scriptPath,
        mediaUrl: media_url,
        sceneId: String(scene_id),
      });
    } else if (model === 'whisperx') {
      // Path to the WhisperX transcription script
      const scriptPath = path.join(process.cwd(), 'whisperx-transcribe.py');
      const { command: pythonCommand, source: pythonSource } =
        resolvePythonCommand({
          envVarName: 'WHISPER_PYTHON',
          absoluteCandidates: [
            path.join(process.cwd(), 'whisper-env', 'bin', 'python'),
            path.join(process.cwd(), 'whisper-env', 'bin', 'python3'),
            path.join(process.cwd(), 'whisper-env', 'bin', 'python3.13'),
            path.join(process.cwd(), 'parakeet-env', 'bin', 'python'),
            path.join(process.cwd(), 'parakeet-env', 'bin', 'python3'),
          ],
          fallbackCommand: 'python3',
        });

      console.log(
        `[SCENE_TRANSCRIBE] Using WhisperX python: ${pythonCommand} (${pythonSource})`,
      );

      // Run the WhisperX transcription script
      transcriptionPromise = new Promise((resolve, reject) => {
        const pythonProcess = spawn(pythonCommand, [scriptPath, media_url], {
          stdio: ['pipe', 'pipe', 'pipe'],
        });

        let stdout = '';
        let stderr = '';

        pythonProcess.stdout.on('data', (data) => {
          stdout += data.toString();
        });

        pythonProcess.stderr.on('data', (data) => {
          stderr += data.toString();
        });

        pythonProcess.on('close', (code) => {
          if (code === 0) {
            try {
              const result = JSON.parse(stdout);
              resolve(result);
            } catch (parseError) {
              reject(
                new Error(
                  `Failed to parse scene transcription result: ${parseError}`,
                ),
              );
            }
          } else {
            reject(
              new Error(
                `Scene WhisperX transcription failed with code ${code}: ${stderr}`,
              ),
            );
          }
        });

        pythonProcess.on('error', (error) => {
          reject(
            new Error(
              `Failed to start scene WhisperX transcription process: ${error.message}`,
            ),
          );
        });
      });
    } else if (model === 'mlx-whisperx') {
      // Path to the MLX Whisper + WhisperX alignment script
      const scriptPath = path.join(process.cwd(), 'mlx-whisperx-transcribe.py');
      const { command: pythonCommand, source: pythonSource } =
        resolvePythonCommand({
          envVarName: 'WHISPER_PYTHON',
          absoluteCandidates: [
            path.join(process.cwd(), 'whisper-env', 'bin', 'python'),
            path.join(process.cwd(), 'whisper-env', 'bin', 'python3'),
            path.join(process.cwd(), 'whisper-env', 'bin', 'python3.13'),
            path.join(process.cwd(), 'parakeet-env', 'bin', 'python'),
            path.join(process.cwd(), 'parakeet-env', 'bin', 'python3'),
          ],
          fallbackCommand: 'python3',
        });

      console.log(
        `[SCENE_TRANSCRIBE] Using MLX WhisperX python: ${pythonCommand} (${pythonSource})`,
      );

      transcriptionPromise = new Promise((resolve, reject) => {
        const pythonProcess = spawn(pythonCommand, [scriptPath, media_url], {
          stdio: ['pipe', 'pipe', 'pipe'],
        });

        let stdout = '';
        let stderr = '';

        pythonProcess.stdout.on('data', (data) => {
          stdout += data.toString();
        });

        pythonProcess.stderr.on('data', (data) => {
          stderr += data.toString();
        });

        pythonProcess.on('close', (code) => {
          if (code === 0) {
            try {
              const result = JSON.parse(stdout);
              resolve(result);
            } catch (parseError) {
              reject(
                new Error(
                  `Failed to parse scene transcription result: ${parseError}`,
                ),
              );
            }
          } else {
            reject(
              new Error(
                `Scene MLX WhisperX transcription failed with code ${code}: ${stderr}`,
              ),
            );
          }
        });

        pythonProcess.on('error', (error) => {
          reject(
            new Error(
              `Failed to start scene MLX WhisperX transcription process: ${error.message}`,
            ),
          );
        });
      });
    } else {
      return NextResponse.json(
        { error: `Unknown transcription model: ${model}` },
        { status: 400 },
      );
    }

    // Wait for transcription to complete
    const transcriptionResult = await transcriptionPromise;

    console.log(
      `[SCENE_TRANSCRIBE] ${model} transcription completed successfully for scene ${scene_id}`,
    );

    return NextResponse.json(transcriptionResult);
  } catch (error) {
    console.error('[SCENE_TRANSCRIBE] Error in scene transcribe API:', error);
    return NextResponse.json(
      {
        error: 'Failed to transcribe scene',
        details: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 },
    );
  }
}
