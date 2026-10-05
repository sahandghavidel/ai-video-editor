import { spawn } from 'child_process';
import { existsSync, openSync, closeSync } from 'fs';
import path from 'path';
import os from 'os';

const SERVICE_URL = 'http://127.0.0.1:9547';
const shared = globalThis as typeof globalThis & {
  __persianTtsStartup?: Promise<void>;
  __persianTtsPid?: number;
  __persianTtsIdleTimer?: ReturnType<typeof setTimeout>;
  __persianTtsActiveRequests?: number;
};

async function isRunning(): Promise<boolean> {
  try {
    const response = await fetch(`${SERVICE_URL}/health`, {
      signal: AbortSignal.timeout(1500), cache: 'no-store',
    });
    const state = await response.json();
    return response.ok && state.provider === 'chatterbox-persian' && state.checkpoint_available;
  } catch {
    return false;
  }
}

async function startService(): Promise<void> {
  if (await isRunning()) return;
  const directory = path.join(os.homedir(), 'chatterbox-persian-tts');
  const script = path.join(directory, 'start.sh');
  if (!existsSync(script)) throw new Error(`Persian TTS startup script not found: ${script}`);
  const log = openSync(path.join(directory, 'service-memory.log'), 'a');
  let failure: Error | undefined;
  try {
    // Same detached, request-driven startup used by the original Chatterbox route.
    const child = spawn(script, [], {
      cwd: directory, detached: true, stdio: ['ignore', log, log],
      env: { ...process.env, PYTHONUNBUFFERED: '1' },
    });
    shared.__persianTtsPid = child.pid;
    child.on('error', (error) => { failure = error; });
    child.unref();
  } finally {
    closeSync(log);
  }
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    if (await isRunning()) return;
    if (failure) throw failure;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error('Persian TTS could not start within 30 seconds. Check chatterbox-persian-tts/service-memory.log');
}

export async function ensurePersianTtsRunning(): Promise<void> {
  if (shared.__persianTtsIdleTimer) clearTimeout(shared.__persianTtsIdleTimer);
  if (await isRunning()) return;
  // Concurrent scenes share one startup, including across Next.js route bundles.
  if (!shared.__persianTtsStartup) {
    shared.__persianTtsStartup = startService().finally(() => {
      shared.__persianTtsStartup = undefined;
    });
  }
  await shared.__persianTtsStartup;
}

export function beginPersianTtsRequest(): void {
  shared.__persianTtsActiveRequests = (shared.__persianTtsActiveRequests || 0) + 1;
  if (shared.__persianTtsIdleTimer) clearTimeout(shared.__persianTtsIdleTimer);
}

export function finishPersianTtsRequest(): void {
  shared.__persianTtsActiveRequests = Math.max(0, (shared.__persianTtsActiveRequests || 1) - 1);
  if (shared.__persianTtsActiveRequests || !shared.__persianTtsPid) return;
  // Original Chatterbox uses 15 minutes after generation; target only our PID.
  shared.__persianTtsIdleTimer = setTimeout(() => {
    if (shared.__persianTtsActiveRequests || !shared.__persianTtsPid) return;
    try { process.kill(shared.__persianTtsPid, 'SIGTERM'); } catch { /* Already stopped. */ }
    shared.__persianTtsPid = undefined;
  }, 15 * 60 * 1000);
  shared.__persianTtsIdleTimer.unref();
}
