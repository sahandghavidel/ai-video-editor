import { spawn } from 'child_process';

type MinioConfig = {
  baseUrl: string;
  bucket: string;
};

const DEFAULT_HEALTH_CACHE_MS = 15_000;
const DEFAULT_HEALTH_TIMEOUT_MS = 350;
const DEFAULT_STARTUP_TIMEOUT_MS = 8_000;
const DEFAULT_START_RETRY_COOLDOWN_MS = 10_000;

let lastHealthyAt = 0;
let inFlightEnsure: Promise<void> | null = null;
let lastStartAttemptAt = 0;

function parseMs(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function getHealthCacheMs(): number {
  return parseMs(process.env.MINIO_HEALTH_CACHE_MS, DEFAULT_HEALTH_CACHE_MS);
}

function getHealthTimeoutMs(): number {
  return parseMs(
    process.env.MINIO_HEALTH_TIMEOUT_MS,
    DEFAULT_HEALTH_TIMEOUT_MS,
  );
}

function getStartupTimeoutMs(): number {
  return parseMs(
    process.env.MINIO_STARTUP_TIMEOUT_MS,
    DEFAULT_STARTUP_TIMEOUT_MS,
  );
}

function getStartRetryCooldownMs(): number {
  return parseMs(
    process.env.MINIO_START_RETRY_COOLDOWN_MS,
    DEFAULT_START_RETRY_COOLDOWN_MS,
  );
}

function toLocalHostName(value: string): string {
  return value.toLowerCase().trim();
}

function isLocalhostUrl(baseUrl: string): boolean {
  try {
    const parsed = new URL(baseUrl);
    const host = toLocalHostName(parsed.hostname);
    return host === 'localhost' || host === '127.0.0.1' || host === '::1';
  } catch {
    return false;
  }
}

function shouldAutoStart(baseUrl: string): boolean {
  const explicit = process.env.MINIO_AUTO_START?.trim().toLowerCase();
  if (explicit === '1' || explicit === 'true' || explicit === 'yes') {
    return true;
  }
  if (explicit === '0' || explicit === 'false' || explicit === 'no') {
    return false;
  }

  return process.env.NODE_ENV !== 'production' && isLocalhostUrl(baseUrl);
}

function normalizeBaseUrl(value: string): string {
  return value.trim().replace(/\/+$/, '');
}

export function getMinioConfig(): MinioConfig {
  const baseUrl = process.env.MINIO_BASE_URL?.trim();
  const bucket = process.env.MINIO_BUCKET?.trim();

  if (!baseUrl || !bucket) {
    throw new Error(
      'Missing MinIO configuration. Set MINIO_BASE_URL and MINIO_BUCKET in .env.local',
    );
  }

  return {
    baseUrl: normalizeBaseUrl(baseUrl),
    bucket,
  };
}

async function isMinioHealthy(baseUrl: string): Promise<boolean> {
  const healthUrl = `${normalizeBaseUrl(baseUrl)}/minio/health/live`;
  const timeoutMs = getHealthTimeoutMs();

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(healthUrl, {
      method: 'GET',
      signal: controller.signal,
      cache: 'no-store',
    });
    return response.ok;
  } catch {
    return false;
  } finally {
    clearTimeout(timeout);
  }
}

function parseMinioAddress(baseUrl: string): string {
  const parsed = new URL(baseUrl);
  if (process.env.MINIO_SERVER_ADDRESS?.trim()) {
    return process.env.MINIO_SERVER_ADDRESS.trim();
  }

  const port = parsed.port || (parsed.protocol === 'https:' ? '443' : '80');
  return `${parsed.hostname}:${port}`;
}

function parseConsoleAddress(baseUrl: string): string {
  if (process.env.MINIO_SERVER_CONSOLE_ADDRESS?.trim()) {
    return process.env.MINIO_SERVER_CONSOLE_ADDRESS.trim();
  }

  const parsed = new URL(baseUrl);
  const apiPort = Number(
    parsed.port || (parsed.protocol === 'https:' ? '443' : '80'),
  );
  const consolePort = Number.isFinite(apiPort) ? apiPort + 1 : 9001;
  return `${parsed.hostname}:${consolePort}`;
}

async function startLocalMinioProcess(baseUrl: string): Promise<void> {
  const minioDataDir = process.env.MINIO_DATA_DIR?.trim();
  if (!minioDataDir) {
    throw new Error(
      'MinIO is not running and auto-start is enabled, but MINIO_DATA_DIR is not set in .env.local',
    );
  }

  const minioBin = process.env.MINIO_SERVER_BIN?.trim() || 'minio';
  const args = [
    'server',
    minioDataDir,
    '--address',
    parseMinioAddress(baseUrl),
    '--console-address',
    parseConsoleAddress(baseUrl),
  ];

  const minioEnv: NodeJS.ProcessEnv = {
    ...process.env,
  };

  if (process.env.MINIO_ROOT_USER?.trim()) {
    minioEnv.MINIO_ROOT_USER = process.env.MINIO_ROOT_USER.trim();
  }

  if (process.env.MINIO_ROOT_PASSWORD?.trim()) {
    minioEnv.MINIO_ROOT_PASSWORD = process.env.MINIO_ROOT_PASSWORD.trim();
  }

  await new Promise<void>((resolve, reject) => {
    const child = spawn(minioBin, args, {
      detached: true,
      stdio: 'ignore',
      env: minioEnv,
    });

    child.once('error', (error) => {
      reject(
        new Error(
          `Failed to spawn MinIO process (${minioBin}). ${
            error instanceof Error ? error.message : 'Unknown error'
          }`,
        ),
      );
    });

    child.once('spawn', () => {
      child.unref();
      resolve();
    });
  });
}

async function waitForMinioHealthy(baseUrl: string): Promise<boolean> {
  const startupTimeoutMs = getStartupTimeoutMs();
  const started = Date.now();

  while (Date.now() - started < startupTimeoutMs) {
    if (await isMinioHealthy(baseUrl)) {
      return true;
    }

    await new Promise((resolve) => setTimeout(resolve, 250));
  }

  return false;
}

export async function ensureMinioRunning(): Promise<MinioConfig> {
  const config = getMinioConfig();
  const now = Date.now();

  if (now - lastHealthyAt < getHealthCacheMs()) {
    return config;
  }

  if (inFlightEnsure) {
    await inFlightEnsure;
    return config;
  }

  inFlightEnsure = (async () => {
    const alreadyHealthy = await isMinioHealthy(config.baseUrl);
    if (alreadyHealthy) {
      lastHealthyAt = Date.now();
      return;
    }

    if (!shouldAutoStart(config.baseUrl)) {
      throw new Error(
        `MinIO is unreachable at ${config.baseUrl}. Start MinIO manually or set MINIO_AUTO_START=1 with MINIO_DATA_DIR in .env.local`,
      );
    }

    const cooldownMs = getStartRetryCooldownMs();
    const elapsedSinceLastStart = Date.now() - lastStartAttemptAt;
    if (lastStartAttemptAt > 0 && elapsedSinceLastStart < cooldownMs) {
      throw new Error(
        `MinIO startup retry is cooling down (${cooldownMs - elapsedSinceLastStart}ms remaining).`,
      );
    }

    lastStartAttemptAt = Date.now();
    await startLocalMinioProcess(config.baseUrl);

    const healthyAfterStart = await waitForMinioHealthy(config.baseUrl);
    if (!healthyAfterStart) {
      throw new Error(
        `MinIO did not become healthy at ${config.baseUrl} after auto-start attempt.`,
      );
    }

    lastHealthyAt = Date.now();
  })().finally(() => {
    inFlightEnsure = null;
  });

  await inFlightEnsure;
  return config;
}
