import { spawn, type ChildProcessWithoutNullStreams } from 'child_process';
import path from 'path';
import { randomUUID } from 'crypto';

type Metrics = Record<string, number | boolean>;
type Job = {
  text: string; output: string; reference_audio: string; reference_text: string;
  seed: number; num_step: number; speed: number;
};
type Worker = {
  child: ChildProcessWithoutNullStreams;
  key: string;
  ready: Promise<void>;
  resolveReady: () => void;
  rejectReady: (error: Error) => void;
  closed: Promise<void>;
  pending?: { id: string; resolve: (result: Metrics) => void; reject: (error: Error) => void };
  buffer: string;
  stderr: string;
  idleTimer?: ReturnType<typeof setTimeout>;
  dead: boolean;
  idleVersion: number;
};
type State = { worker?: Worker; tail: Promise<void> };
const shared = globalThis as typeof globalThis & { __omniVoiceLoraRuntime?: State };
const state = shared.__omniVoiceLoraRuntime ??= { tail: Promise.resolve() };

function setting(name: string, fallback: number, minimum: number): number {
  const value = Number(process.env[name] ?? fallback);
  return Number.isFinite(value) ? Math.max(minimum, Math.floor(value)) : fallback;
}

async function stop(worker: Worker, reason: string): Promise<void> {
  if (worker.idleTimer) clearTimeout(worker.idleTimer);
  if (state.worker === worker) state.worker = undefined;
  worker.dead = true;
  worker.rejectReady(new Error(`LoRA worker stopped: ${reason}`));
  worker.pending?.reject(new Error(`LoRA worker stopped: ${reason}`));
  worker.pending = undefined;
  console.info(`[OmniVoice LoRA] worker=stopping pid=${worker.child.pid} reason=${reason}`);
  if (worker.child.exitCode === null && worker.child.signalCode === null) worker.child.kill('SIGTERM');
  const force = setTimeout(() => {
    if (worker.child.exitCode === null && worker.child.signalCode === null) worker.child.kill('SIGKILL');
  }, 5000);
  force.unref();
  try { await worker.closed; } finally { clearTimeout(force); }
}

function armIdle(worker: Worker): void {
  if (worker.idleTimer) clearTimeout(worker.idleTimer);
  if (worker.dead) return;
  const version = ++worker.idleVersion;
  worker.idleTimer = setTimeout(() => {
    // Queue shutdown with generations so an idle callback cannot interrupt a job or race a reload.
    const shutdown = state.tail.then(async () => {
      if (state.worker === worker && worker.idleVersion === version && !worker.pending) await stop(worker, 'idle-timeout');
    });
    state.tail = shutdown.catch(() => {});
  }, setting('OMNIVOICE_LORA_IDLE_TIMEOUT_MS', 5 * 60 * 1000, 1));
  worker.idleTimer.unref();
}

function start(root: string, device: string, key: string): Worker {
  const limit = setting('OMNIVOICE_LORA_MAX_GENERATIONS_BEFORE_RELOAD',
    setting('OMNIVOICE_MAX_GENERATIONS_BEFORE_RELOAD', 100, 1), 1);
  const child = spawn(path.join(root, 'env', 'bin', 'python'),
    [path.join(process.cwd(), 'omnivoice-lora-local', 'worker.py'), '--root', root, '--device', device], {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env, HF_HUB_OFFLINE: '1', TRANSFORMERS_OFFLINE: '1', PYTORCH_ENABLE_MPS_FALLBACK: '0',
        OMP_NUM_THREADS: '4', MKL_NUM_THREADS: '4', OMNIVOICE_LORA_MAX_GENERATIONS_BEFORE_RELOAD: String(limit),
        OMNIVOICE_LORA_PROMPT_CACHE_SIZE: String(setting('OMNIVOICE_LORA_PROMPT_CACHE_SIZE', 16, 1)) },
    });
  let resolveReady!: () => void;
  let rejectReady!: (error: Error) => void;
  const ready = new Promise<void>((resolve, reject) => { resolveReady = resolve; rejectReady = reject; });
  void ready.catch(() => {});
  let resolveClosed!: () => void;
  const closed = new Promise<void>((resolve) => { resolveClosed = resolve; });
  const worker: Worker = { child, key, ready, resolveReady, rejectReady, closed, buffer: '', stderr: '', dead: false, idleVersion: 0 };
  const fail = (error: Error) => {
    worker.dead = true;
    worker.rejectReady(error);
    worker.pending?.reject(error);
    worker.pending = undefined;
    if (worker.idleTimer) clearTimeout(worker.idleTimer);
    if (state.worker === worker) state.worker = undefined;
  };
  child.stdout.setEncoding('utf8');
  child.stderr.setEncoding('utf8');
  child.stdout.on('data', (chunk: string) => {
    worker.buffer += chunk;
    const lines = worker.buffer.split(/\r?\n/);
    worker.buffer = lines.pop() || '';
    for (const line of lines) {
      if (!line.trim()) continue;
      let message;
      try { message = JSON.parse(line); } catch { continue; }
      if (message.event === 'ready') {
        console.info(`[OmniVoice LoRA] worker=ready pid=${child.pid} generationLimit=${limit}`);
        worker.resolveReady();
      } else if (message.event === 'fatal') {
        fail(new Error(message.error || 'LoRA worker initialization failed'));
      } else if (message.id === worker.pending?.id) {
        const pending = worker.pending!;
        worker.pending = undefined;
        if (message.ok) {
          console.info(`[OmniVoice LoRA] pid=${child.pid} generation=${message.generation_count}/${limit} cache=${message.cache_hit ? 'HIT' : 'MISS'}`);
          const { id: _id, ok: _ok, ...metrics } = message;
          void _id; void _ok;
          pending.resolve(metrics);
        } else pending.reject(new Error(message.error || 'LoRA generation failed'));
      }
    }
  });
  child.stderr.on('data', (chunk: string) => { worker.stderr = (worker.stderr + chunk).slice(-4000); });
  child.on('error', (error) => { fail(error); });
  child.on('close', (code, signal) => {
    fail(new Error(`LoRA worker exited (${code ?? signal}): ${worker.stderr.slice(-1000)}`));
    resolveClosed();
  });
  child.stdin.on('error', (error) => { fail(error); });
  state.worker = worker;
  console.info(`[OmniVoice LoRA] worker=starting pid=${child.pid} device=${device}`);
  return worker;
}

async function execute(root: string, device: string, job: Job): Promise<Metrics> {
  const key = [root, device, 'float32', 'approved-v1', 'protocol-1',
    process.env.OMNIVOICE_LORA_MAX_GENERATIONS_BEFORE_RELOAD ?? process.env.OMNIVOICE_MAX_GENERATIONS_BEFORE_RELOAD ?? '100',
    process.env.OMNIVOICE_LORA_PROMPT_CACHE_SIZE ?? '16'].join('|');
  let worker = state.worker;
  if (worker && (worker.key !== key || worker.dead)) { await stop(worker, 'config-changed'); worker = undefined; }
  worker ??= start(root, device, key);
  if (worker.idleTimer) clearTimeout(worker.idleTimer);
  worker.idleVersion += 1;
  const current = worker;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = setting('OMNIVOICE_LORA_JOB_TIMEOUT_MS', setting('OMNIVOICE_JOB_TIMEOUT_MS', 0, 0), 0);
  try {
    const run = (async () => {
      await current.ready;
      if (current.dead) throw new Error('LoRA worker unavailable');
      return new Promise<Metrics>((resolve, reject) => {
        const id = randomUUID();
        current.pending = { id, resolve, reject };
        current.child.stdin.write(JSON.stringify({ ...job, id }) + '\n', (error) => {
          if (error) reject(error);
        });
      });
    })();
    const result = timeout > 0 ? await Promise.race([run, new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error(`LoRA worker timed out after ${timeout}ms`)), timeout);
    })]) : await run;
    if (result.reload_needed) await stop(current, 'generation-count-reached');
    else armIdle(current);
    return result;
  } catch (error) {
    await stop(current, 'job-error');
    throw error;
  } finally { if (timer) clearTimeout(timer); }
}

export function runOmniVoiceLoraJob(root: string, device: string, job: Job): Promise<Metrics> {
  const result = state.tail.then(() => execute(root, device, job));
  state.tail = result.then(() => {}, () => {});
  return result;
}
