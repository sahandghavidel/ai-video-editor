import {spawn, execFile} from "child_process";
import {promisify} from "util";
import {randomUUID} from "crypto";
import {
  existsSync,
  openSync,
  closeSync,
  readFileSync,
  writeFileSync,
  renameSync,
  unlinkSync,
} from "fs";
import path from "path";
import os from "os";

const SERVICE_URL = "http://127.0.0.1:9547";
const IDLE_TIMEOUT_MS = 1 * 60 * 1000;
const STATE_FILE = path.join(process.cwd(), "persian-tts-timeout-state.json");
const execFileAsync = promisify(execFile);
function logLifecycle(message: string): void {
  console.log(`[Persian TTS] [${new Date().toISOString()}] ${message}`);
}

type TimeoutState = {
  scheduledAt: number;
  shutdownInitiated: boolean;
  sessionId: string;
};

function readTimeoutState(): TimeoutState | null {
  try {
    const state = JSON.parse(readFileSync(STATE_FILE, "utf8"));
    return Number.isFinite(state.scheduledAt) &&
      state.scheduledAt > 0 &&
      typeof state.sessionId === "string"
      ? state
      : null;
  } catch (error) {
    if (
      !(
        error &&
        typeof error === "object" &&
        "code" in error &&
        error.code === "ENOENT"
      )
    ) {
      console.error("[Persian TTS] Error reading timeout state:", error);
    }
    return null;
  }
}

function writeTimeoutState(state: TimeoutState): void {
  const temporary = `${STATE_FILE}.tmp`;
  writeFileSync(temporary, JSON.stringify({...state, lastUpdated: Date.now()}));
  renameSync(temporary, STATE_FILE);
}

const shared = globalThis as typeof globalThis & {
  __persianTtsStartup?: Promise<void>;
  __persianTtsPid?: number;
  __persianTtsIdleTimer?: ReturnType<typeof setTimeout>;
  __persianTtsActiveRequests?: number;
};

async function isRunning(): Promise<boolean> {
  try {
    const response = await fetch(`${SERVICE_URL}/health`, {
      signal: AbortSignal.timeout(1500),
      cache: "no-store",
    });
    const state = await response.json();
    return (
      response.ok &&
      state.provider === "chatterbox-persian" &&
      state.checkpoint_available
    );
  } catch {
    return false;
  }
}

async function startService(): Promise<void> {
  if (await isRunning()) return;
  const directory = path.join(os.homedir(), "chatterbox-persian-tts");
  const script = path.join(directory, "start.sh");
  if (!existsSync(script))
    throw new Error(`Persian TTS startup script not found: ${script}`);
  logLifecycle(
    `🚀 Starting TTS server from ${directory}; port=9547; log=service-memory.log`,
  );
  const log = openSync(path.join(directory, "service-memory.log"), "a");
  let failure: Error | undefined;
  try {
    // Same detached, request-driven startup used by the original Chatterbox route.
    const child = spawn(script, [], {
      cwd: directory,
      detached: true,
      stdio: ["ignore", log, log],
      env: {...process.env, PYTHONUNBUFFERED: "1"},
    });
    shared.__persianTtsPid = child.pid;
    logLifecycle(
      `✅ TTS server process spawned; pid=${child.pid ?? "unknown"}`,
    );
    child.on("error", (error) => {
      failure = error;
      console.error("[Persian TTS] ❌ Failed to start TTS server:", error);
    });
    child.on("close", (code, signal) => {
      logLifecycle(
        `🛑 TTS server exited; pid=${child.pid ?? "unknown"} code=${code} signal=${signal ?? "none"}`,
      );
      if (shared.__persianTtsPid === child.pid)
        shared.__persianTtsPid = undefined;
    });
    child.unref();
  } finally {
    closeSync(log);
  }
  logLifecycle("⏳ Waiting for TTS service readiness (up to 30 seconds)");
  const deadline = Date.now() + 30_000;
  let attempts = 0;
  while (Date.now() < deadline) {
    if (await isRunning()) {
      logLifecycle(
        "✅ TTS service ready for requests; model loads on first generation",
      );
      return;
    }
    attempts++;
    if (attempts === 1 || attempts % 4 === 0)
      logLifecycle(
        `⏳ Service not ready yet; attempt=${attempts}, startup time remaining=${Math.max(0, Math.round((deadline - Date.now()) / 1000))}s`,
      );
    if (failure) throw failure;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(
    "Persian TTS could not start within 30 seconds. Check chatterbox-persian-tts/service-memory.log",
  );
}

function clearLocalTimer(): void {
  if (shared.__persianTtsIdleTimer) clearTimeout(shared.__persianTtsIdleTimer);
  shared.__persianTtsIdleTimer = undefined;
}

function isCurrentSession(sessionId: string): boolean {
  const state = readTimeoutState();
  return (
    !shared.__persianTtsActiveRequests &&
    state?.sessionId === sessionId &&
    !state.shutdownInitiated
  );
}

async function performShutdown(sessionId: string): Promise<void> {
  if (!isCurrentSession(sessionId)) {
    logLifecycle(
      `🔍 Shutdown skipped: stale session or active request (${sessionId})`,
    );
    return;
  }
  const state = readTimeoutState();
  logLifecycle(
    `⏰ Shutdown timeout fired (${sessionId}): ${Math.round((Date.now() - (state?.scheduledAt ?? Date.now())) / 1000)}s elapsed, ${IDLE_TIMEOUT_MS / 1000}s expected`,
  );
  logLifecycle("🔍 Finding Persian TTS processes listening on port 9547");
  try {
    // Original shutdown finds detached workers by port. Restrict to Persian's
    // listener and verify its full command before signalling it.
    const {stdout} = await execFileAsync("lsof", [
      "-t",
      "-iTCP:9547",
      "-sTCP:LISTEN",
    ]);
    for (const value of new Set(stdout.trim().split(/\s+/))) {
      const pid = Number(value);
      if (!Number.isSafeInteger(pid) || pid <= 0) continue;
      const {stdout: command} = await execFileAsync("ps", [
        "-p",
        String(pid),
        "-o",
        "command=",
      ]);
      if (
        !command.includes(path.join(os.homedir(), "chatterbox-persian-tts")) ||
        !command.includes("uvicorn")
      ) {
        logLifecycle(
          `⚠️ Skipping non-Persian process on port 9547; pid=${pid}`,
        );
        continue;
      }
      if (!isCurrentSession(sessionId)) return;
      process.kill(pid, "SIGTERM");
      logLifecycle(
        `🛑 Sent SIGTERM to Persian TTS pid=${pid} after ${IDLE_TIMEOUT_MS / 60_000} idle minutes`,
      );
      const verification = setTimeout(async () => {
        if (await isRunning())
          logLifecycle(
            "⚠️ Persian TTS is running after shutdown signal (it may have restarted for a new request)",
          );
        else logLifecycle("✅ Persian TTS server successfully shut down");
      }, 6000);
      verification.unref();
    }
    if (isCurrentSession(sessionId)) {
      unlinkSync(STATE_FILE);
      shared.__persianTtsPid = undefined;
      logLifecycle("🔧 Shutdown callback complete; timeout state cleared");
    }
  } catch (error) {
    // lsof/ps exit 1 when the listener/process has already disappeared.
    if (
      error &&
      typeof error === "object" &&
      "code" in error &&
      error.code === 1
    ) {
      logLifecycle("✅ Persian TTS server already stopped naturally");
      if (isCurrentSession(sessionId) && existsSync(STATE_FILE))
        unlinkSync(STATE_FILE);
      return;
    }
    if (isCurrentSession(sessionId)) {
      console.warn(
        "[Persian TTS] idle shutdown check:",
        error instanceof Error ? error.message : error,
      );
      schedulePeriodicTimeoutCheck(180_000);
    }
  }
}

function schedulePeriodicTimeoutCheck(retryDelay?: number): void {
  clearLocalTimer();
  const state = readTimeoutState();
  if (!state) {
    logLifecycle("🔍 Periodic check: no shutdown timeout scheduled");
    return;
  }
  if (state.shutdownInitiated) {
    logLifecycle("🔍 Periodic check: shutdown already initiated");
    return;
  }
  if (shared.__persianTtsActiveRequests) {
    logLifecycle(
      `⏸ Shutdown checks paused; active requests=${shared.__persianTtsActiveRequests}`,
    );
    return;
  }
  const remaining = state.scheduledAt + IDLE_TIMEOUT_MS - Date.now();
  logLifecycle(
    `🔍 Periodic timeout check (${state.sessionId}): ${Math.max(0, Math.round((Date.now() - state.scheduledAt) / 1000))}s elapsed, ${Math.max(0, Math.round(remaining / 1000))}s remaining; shutdown at ${new Date(state.scheduledAt + IDLE_TIMEOUT_MS).toISOString()}`,
  );
  const delay = retryDelay ?? Math.max(0, Math.min(remaining, 180_000));
  logLifecycle(
    delay <= 60000
      ? `⏰ Scheduling final shutdown check in ${Math.round(delay / 1000)}s`
      : `🔄 Scheduling next shutdown check in ${Math.round(delay / 1000)}s`,
  );
  shared.__persianTtsIdleTimer = setTimeout(() => {
    shared.__persianTtsIdleTimer = undefined;
    if (!isCurrentSession(state.sessionId)) {
      logLifecycle(
        `🔍 Ignoring stale timeout or active generation (${state.sessionId})`,
      );
      return;
    }
    const current = readTimeoutState();
    if (current && Date.now() - current.scheduledAt >= IDLE_TIMEOUT_MS) {
      void performShutdown(state.sessionId);
    } else {
      schedulePeriodicTimeoutCheck();
    }
  }, delay);
  shared.__persianTtsIdleTimer.unref();
}

export async function ensurePersianTtsRunning(): Promise<void> {
  const running = await isRunning();
  logLifecycle(`TTS server status: running=${running}, port=9547`);
  if (running) {
    logLifecycle(
      "🔄 Server already running; shutdown timeout will reset after successful generation",
    );
    return;
  }
  logLifecycle("🚀 TTS server not running; starting it automatically");
  if (!shared.__persianTtsStartup) {
    shared.__persianTtsStartup = startService().finally(() => {
      shared.__persianTtsStartup = undefined;
    });
  }
  await shared.__persianTtsStartup;
  logLifecycle("✅ TTS server started successfully");
}

export function beginPersianTtsRequest(): void {
  shared.__persianTtsActiveRequests =
    (shared.__persianTtsActiveRequests || 0) + 1;
  clearLocalTimer();
  logLifecycle(
    `⏸ Generation request started; shutdown checks paused; active requests=${shared.__persianTtsActiveRequests}`,
  );
}

export function finishPersianTtsRequest(successful = false): void {
  shared.__persianTtsActiveRequests = Math.max(
    0,
    (shared.__persianTtsActiveRequests || 1) - 1,
  );
  try {
    if (successful) {
      const previous = readTimeoutState();
      logLifecycle(
        previous
          ? `🔄 Clearing previous shutdown countdown (${previous.sessionId}); ${Math.max(0, Math.round((previous.scheduledAt + IDLE_TIMEOUT_MS - Date.now()) / 1000))}s remaining`
          : "ℹ️ No existing shutdown timeout to clear",
      );
      logLifecycle(
        `⏰ Scheduling server shutdown in ${IDLE_TIMEOUT_MS / 60_000} minutes (${IDLE_TIMEOUT_MS}ms) after successful generation and upload`,
      );
      writeTimeoutState({
        scheduledAt: Date.now(),
        shutdownInitiated: false,
        sessionId: randomUUID(),
      });
    }
    if (successful)
      logLifecycle("✅ Server shutdown timeout saved with periodic checking");
    else
      logLifecycle(
        "ℹ️ Request finished without success; previous shutdown deadline remains unchanged",
      );
    // Failed/invalid requests do not reset the successful-generation countdown.
    schedulePeriodicTimeoutCheck();
  } catch (error) {
    console.error("[Persian TTS] could not persist idle shutdown:", error);
  }
}

// Re-arm persisted shutdown when this module loads after a Next.js restart.
schedulePeriodicTimeoutCheck();
