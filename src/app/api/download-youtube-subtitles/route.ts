import { NextRequest, NextResponse } from 'next/server';
import { spawn } from 'child_process';
import { promises as fs } from 'fs';
import path from 'path';
import os from 'os';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/* ------------------------------------------------------------------ */
/*  yt-dlp binary resolution                                          */
/* ------------------------------------------------------------------ */

// Resolve a fresh yt-dlp binary at module load. Precedence:
//   1. YTDLP_BIN env override (full path to a binary or venv script)
//   2. <project>/.venv/bin/yt-dlp (the venv shipped with this app)
//   3. yt-dlp on PATH (system / Homebrew fallback)
//
// We log which one was chosen so it is obvious in dev logs.
function resolveYtDlpBinary(): { command: string; label: string } {
  const override = process.env.YTDLP_BIN?.trim();
  if (override) {
    return { command: override, label: `env YTDLP_BIN=${override}` };
  }

  // projectRoot is <repo>/src/app/api/download-youtube-subtitles -> 4 levels up.
  const projectRoot = path.resolve(process.cwd());
  const candidates = [
    path.join(projectRoot, '.venv', 'bin', 'yt-dlp'),
    path.join(projectRoot, 'venv', 'bin', 'yt-dlp'),
  ];

  for (const candidate of candidates) {
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      require('fs').accessSync(candidate);
      return { command: candidate, label: `venv ${candidate}` };
    } catch {
      // keep searching
    }
  }

  return { command: 'yt-dlp', label: 'PATH (yt-dlp)' };
}

const YT_DLP_RESOLVED = resolveYtDlpBinary();
console.log(`🛠️ [YT-SUB] Using yt-dlp binary: ${YT_DLP_RESOLVED.label}`);

// Log the rate-limit mitigation knobs once at module load so you can confirm
// in dev logs that the env vars you set in .env.local are taking effect.
const _hasCookies =
  !!process.env.YTDLP_COOKIES_FROM_BROWSER ||
  !!process.env.YTDLP_COOKIES_FILE ||
  !!process.env.YTDLP_COOKIES_DIR;
const _clientConfig =
  process.env.YTDLP_YOUTUBE_PLAYER_CLIENT?.trim() || 'random';
const _clientMode =
  !_clientConfig || _clientConfig.toLowerCase() === 'random'
    ? 'rotating'
    : 'pinned';
console.log(
  `🍪 [YT-SUB] Cookies: ${_hasCookies ? 'ENABLED' : 'disabled (set YTDLP_COOKIES_FROM_BROWSER=chrome to enable)'}`,
);
console.log(
  `🎯 [YT-SUB] YouTube player_client: ${_clientConfig} (${_clientMode})`,
);
// Cache status is logged below, after the cache helpers are defined.

/* ------------------------------------------------------------------ */
/*  Constants                                                         */
/* ------------------------------------------------------------------ */

const USER_AGENTS = [
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.1 Safari/605.1.15',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:120.0) Gecko/20100101 Firefox/120.0',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:120.0) Gecko/20100101 Firefox/120.0',
];

const RATE_LIMIT_REGEX = /\b429\b|too many requests/i;
const AUTO_CAPTIONS_SECTION_REGEX = /available automatic captions/i;
const SUBTITLES_SECTION_REGEX = /available subtitles/i;
const SUBTITLE_TABLE_HEADER_REGEX = /language\s+name\s+formats/i;
const SEPARATOR_LINE_REGEX = /^[-\s]+$/;
const SUBTITLE_ROW_REGEX = /^(\S+)\s+(.+?)\s{2,}(.+)$/;
const ALL_CLIENTS_RATE_LIMITED_PREFIX = 'ALL_CLIENTS_RATE_LIMITED:';

/* ------------------------------------------------------------------ */
/*  Subtitle disk cache                                                */
/* ------------------------------------------------------------------ */

// Caches downloaded subtitle bodies on disk to avoid re-hitting YouTube
// for the same video + language + format combo. Cache files are valid
// for CACHE_TTL_MS milliseconds; after that they're re-fetched.
//
// Set YTDLP_SUBTITLE_CACHE_DIR to override the default location.
// Set YTDLP_SUBTITLE_CACHE_TTL_MS to override the default TTL.
//
// Cache key is a hash of (videoId, lang, format) so it's stable across
// requests but doesn't leak URL parameters into filenames.
const DEFAULT_CACHE_DIR = path.join(process.cwd(), '.cache', 'subtitles');
const DEFAULT_CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

function getCacheDir(): string {
  return process.env.YTDLP_SUBTITLE_CACHE_DIR?.trim() || DEFAULT_CACHE_DIR;
}

function getCacheTtlMs(): number {
  const env = process.env.YTDLP_SUBTITLE_CACHE_TTL_MS?.trim();
  if (!env) return DEFAULT_CACHE_TTL_MS;
  const parsed = Number.parseInt(env, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_CACHE_TTL_MS;
}

function getCacheEnabled(): boolean {
  const flag = process.env.YTDLP_SUBTITLE_CACHE_ENABLED?.trim().toLowerCase();
  if (flag === 'false' || flag === '0' || flag === 'off') return false;
  return true; // enabled by default
}

// Extract a stable YouTube video ID from any common URL form.
function extractVideoId(url: string): string | null {
  try {
    const u = new URL(url);
    const host = u.hostname.replace(/^www\./, '');
    if (host === 'youtu.be') {
      return u.pathname.slice(1).split('/')[0] || null;
    }
    if (host.endsWith('youtube.com') || host.endsWith('youtube-nocookie.com')) {
      const v = u.searchParams.get('v');
      if (v) return v;
      // /shorts/<id>, /embed/<id>, /live/<id>
      const m = u.pathname.match(/^\/(shorts|embed|live)\/([^/?#]+)/);
      if (m) return m[2] ?? null;
    }
  } catch {
    // not a URL
  }
  return null;
}

// Tiny non-crypto hash for cache keys. Sufficient for keying a local
// disk cache — not for security.
function hashKey(parts: string[]): string {
  const s = parts.join('::');
  let h1 = 0xdeadbeef ^ s.length;
  let h2 = 0x41c6ce57 ^ s.length;
  for (let i = 0; i < s.length; i++) {
    const ch = s.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507);
  h1 ^= Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507);
  h2 ^= Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36);
}

function getCacheKey(videoId: string, lang: string, format: string): string {
  return hashKey([videoId, lang.toLowerCase(), format.toLowerCase()]);
}

interface CachedSubtitle {
  content: Buffer;
  ext: string;
  contentType: string;
  filename: string;
  cachedAt: number;
}

async function readCache(
  videoId: string,
  lang: string,
  format: string,
): Promise<CachedSubtitle | null> {
  if (!getCacheEnabled()) return null;
  const key = getCacheKey(videoId, lang, format);
  const cacheDir = getCacheDir();
  const cachePath = path.join(cacheDir, `${key}.bin`);

  try {
    const stat = await fs.stat(cachePath);
    const age = Date.now() - stat.mtimeMs;
    if (age > getCacheTtlMs()) {
      return null; // expired
    }
    const buf = await fs.readFile(cachePath);
    // Format: <json-metadata>\n<binary-content>
    const sep = buf.indexOf('\n');
    if (sep === -1) return null;
    const meta = JSON.parse(buf.subarray(0, sep).toString('utf8'));
    const content = buf.subarray(sep + 1);
    return {
      content,
      ext: meta.ext,
      contentType: meta.contentType,
      filename: meta.filename,
      cachedAt: stat.mtimeMs,
    };
  } catch {
    return null;
  }
}

async function writeCache(
  videoId: string,
  lang: string,
  format: string,
  data: Omit<CachedSubtitle, 'cachedAt'>,
): Promise<void> {
  if (!getCacheEnabled()) return;
  const key = getCacheKey(videoId, lang, format);
  const cacheDir = getCacheDir();
  const cachePath = path.join(cacheDir, `${key}.bin`);

  try {
    await fs.mkdir(cacheDir, { recursive: true });
    const meta = JSON.stringify({
      ext: data.ext,
      contentType: data.contentType,
      filename: data.filename,
    });
    await fs.writeFile(
      cachePath,
      Buffer.concat([Buffer.from(meta + '\n', 'utf8'), data.content]),
    );
  } catch (err) {
    // Cache write failures are non-fatal — log and continue.
    console.warn(
      `⚠️ [YT-SUB] Failed to write cache: ${(err as Error).message}`,
    );
  }
}

/* ------------------------------------------------------------------ */
/*  List cache (cached yt-dlp --list-subs output per videoId)          */
/* ------------------------------------------------------------------ */

// Same TTL as the subtitle cache. The list of available subtitles is
// stable for a video, so caching it for 24h is safe.

interface CachedList {
  entries: SubtitleEntry[];
  cachedAt: number;
}

async function readListCache(videoId: string): Promise<CachedList | null> {
  if (!getCacheEnabled()) return null;
  const cacheDir = getCacheDir();
  const cachePath = path.join(cacheDir, `list-${videoId}.json`);

  try {
    const stat = await fs.stat(cachePath);
    const age = Date.now() - stat.mtimeMs;
    if (age > getCacheTtlMs()) return null;
    const buf = await fs.readFile(cachePath, 'utf8');
    const entries = JSON.parse(buf) as SubtitleEntry[];
    return { entries, cachedAt: stat.mtimeMs };
  } catch {
    return null;
  }
}

async function writeListCache(
  videoId: string,
  entries: SubtitleEntry[],
): Promise<void> {
  if (!getCacheEnabled()) return;
  const cacheDir = getCacheDir();
  const cachePath = path.join(cacheDir, `list-${videoId}.json`);

  try {
    await fs.mkdir(cacheDir, { recursive: true });
    await fs.writeFile(cachePath, JSON.stringify(entries));
  } catch (err) {
    console.warn(
      `⚠️ [YT-SUB] Failed to write list cache: ${(err as Error).message}`,
    );
  }
}

// Cache status log (deferred until after helpers are defined).
console.log(
  `💾 [YT-SUB] Subtitle cache: ${getCacheEnabled() ? `ENABLED (${getCacheDir()}, TTL=${Math.round(getCacheTtlMs() / 3600000)}h)` : 'disabled'}`,
);

/* ------------------------------------------------------------------ */
/*  Global serial queue + 429 cooldown                                 */
/* ------------------------------------------------------------------ */

// Single in-process queue. All subtitle yt-dlp calls run serially with a
// minimum delay between them. This is the single most effective fix for
// 429 storms: parallel calls compound the per-IP quota, serial calls
// stay well under it.
//
// Tunables:
//   YTDLP_MIN_REQUEST_GAP_MS = minimum gap between yt-dlp invocations
//   YTDLP_GLOBAL_429_COOLDOWN_MS = after any 429, pause ALL requests
//   YTDLP_MAX_CONCURRENT = how many requests can run in parallel (1 = pure serial)

const MIN_GAP_MS = (() => {
  const v = Number.parseInt(process.env.YTDLP_MIN_REQUEST_GAP_MS ?? '', 10);
  return Number.isFinite(v) && v >= 0 ? v : 4000; // 4s default
})();
const GLOBAL_429_COOLDOWN_MS = (() => {
  const v = Number.parseInt(process.env.YTDLP_GLOBAL_429_COOLDOWN_MS ?? '', 10);
  return Number.isFinite(v) && v >= 0 ? v : 120000; // 2 minutes default
})();
const MAX_CONCURRENT = (() => {
  const v = Number.parseInt(process.env.YTDLP_MAX_CONCURRENT ?? '', 10);
  return Number.isFinite(v) && v >= 1 ? Math.min(v, 4) : 1;
})();
const STARTUP_JITTER_MIN_MS = (() => {
  const v = Number.parseInt(process.env.YTDLP_STARTUP_JITTER_MIN_MS ?? '', 10);
  return Number.isFinite(v) && v >= 0 ? v : 2000;
})();
const STARTUP_JITTER_MAX_MS = (() => {
  const v = Number.parseInt(process.env.YTDLP_STARTUP_JITTER_MAX_MS ?? '', 10);
  return Number.isFinite(v) && v >= 0 ? v : 8000;
})();

let startupJitterPending = true;

interface QueueState {
  activeCount: number;
  lastRequestAt: number;
  globalCooldownUntil: number;
  recent429s: number[]; // timestamps of recent 429s
  totalRequests: number;
  total429s: number;
}

const queueState: QueueState = {
  activeCount: 0,
  lastRequestAt: 0,
  globalCooldownUntil: 0,
  recent429s: [],
  totalRequests: 0,
  total429s: 0,
};

// Mutable waiters for the next-available-slot signal.
const waiters: Array<() => void> = [];

function recordSuccess(): void {
  queueState.lastRequestAt = Date.now();
  queueState.activeCount = Math.max(0, queueState.activeCount - 1);
  releaseNext();
}

function applyGlobal429Cooldown(reason: string): void {
  const now = Date.now();
  queueState.total429s++;
  queueState.recent429s.push(now);
  // Drop 429s older than 5 minutes.
  const cutoff = now - 5 * 60 * 1000;
  while (
    queueState.recent429s.length > 0 &&
    queueState.recent429s[0]! < cutoff
  ) {
    queueState.recent429s.shift();
  }
  // 3+ 429s in 5 minutes -> long cooldown. Otherwise short cooldown.
  const recentCount = queueState.recent429s.length;
  const cooldown =
    recentCount >= 3
      ? GLOBAL_429_COOLDOWN_MS * 3 // 6 min default
      : recentCount >= 2
        ? GLOBAL_429_COOLDOWN_MS * 2 // 4 min
        : GLOBAL_429_COOLDOWN_MS; // 2 min
  queueState.globalCooldownUntil = now + cooldown;
  console.log(
    `🛑 [YT-SUB] 429 storm guard (${reason}): ${recentCount} recent 429s → cooldown ${Math.round(cooldown / 1000)}s (until ${new Date(queueState.globalCooldownUntil).toISOString()})`,
  );
}

function recordFailure(
  is429: boolean,
  options?: { suppress429Cooldown?: boolean },
): void {
  queueState.lastRequestAt = Date.now();
  queueState.activeCount = Math.max(0, queueState.activeCount - 1);
  if (is429) {
    if (options?.suppress429Cooldown) {
      console.log(
        '⚠️ [YT-SUB] 429 received during client fallback attempt — deferring global cooldown until fallback chain is exhausted.',
      );
    } else {
      applyGlobal429Cooldown('direct failure');
    }
  }
  releaseNext();
}

function releaseNext(): void {
  if (waiters.length > 0) {
    const next = waiters.shift();
    next?.();
  }
}

// Acquire a slot in the global queue. Waits until:
//   - activeCount < MAX_CONCURRENT
//   - MIN_GAP_MS has passed since the last request
//   - the global 429 cooldown has expired
async function acquireSlot(): Promise<void> {
  return new Promise<void>((resolve) => {
    const tryAcquire = () => {
      const now = Date.now();

      // Still in global cooldown? Wait for it to expire.
      if (queueState.globalCooldownUntil > now) {
        const waitMs = queueState.globalCooldownUntil - now;
        console.log(
          `⏳ [YT-SUB] Waiting ${Math.round(waitMs / 1000)}s for global 429 cooldown to expire...`,
        );
        setTimeout(() => {
          waiters.push(tryAcquire);
          releaseNext();
        }, waitMs);
        return;
      }

      // At max concurrency? Wait for an active slot to free.
      if (queueState.activeCount >= MAX_CONCURRENT) {
        waiters.push(tryAcquire);
        return;
      }

      // Enforce minimum gap.
      const gap = now - queueState.lastRequestAt;
      if (queueState.lastRequestAt > 0 && gap < MIN_GAP_MS) {
        const waitMs = MIN_GAP_MS - gap;
        setTimeout(() => {
          waiters.push(tryAcquire);
          releaseNext();
        }, waitMs);
        return;
      }

      // Got a slot.
      queueState.activeCount++;
      queueState.totalRequests++;
      resolve();
    };

    tryAcquire();
  });
}

console.log(
  `🚦 [YT-SUB] Rate limiter: max_concurrent=${MAX_CONCURRENT}, min_gap=${MIN_GAP_MS}ms, 429_cooldown=${Math.round(GLOBAL_429_COOLDOWN_MS / 1000)}s`,
);

/* ------------------------------------------------------------------ */
/*  Persistent quota gate (per-success minimum gap)                   */
/* ------------------------------------------------------------------ */

// Tracks when we last SUCCESSFULLY talked to YouTube and refuses any
// new cache-miss request within YTDLP_MIN_SUCCESS_GAP_MS of that.
//
// This is the **baseline protection** — different from the in-memory
// 429 cooldown:
//   - This file survives dev-server restarts.
//   - It only tracks successful contacts (not 429s).
//   - It blocks any new cache-miss until the gap expires.
//   - Cache HITs skip this check entirely (no YouTube contact).
//
// The file lives in the same .cache/ directory as the subtitle cache,
// so it's already covered by .gitignore.

const DEFAULT_QUOTA_FILE = path.join(
  process.cwd(),
  '.cache',
  'youtube-quota.json',
);
const DEFAULT_MIN_SUCCESS_GAP_MIN_MS = 180_000; // 3 minutes
const DEFAULT_MIN_SUCCESS_GAP_MAX_MS = 300_000; // 5 minutes
const ADAPTIVE_GAP_STEP_MS = (() => {
  const v = Number.parseInt(process.env.YTDLP_ADAPTIVE_GAP_STEP_MS ?? '', 10);
  return Number.isFinite(v) && v >= 0 ? v : 60_000; // +1m per level
})();
const ADAPTIVE_GAP_MAX_EXTRA_MS = (() => {
  const v = Number.parseInt(
    process.env.YTDLP_ADAPTIVE_GAP_MAX_EXTRA_MS ?? '',
    10,
  );
  return Number.isFinite(v) && v >= 0 ? v : 300_000; // cap +5m
})();

function getQuotaFile(): string {
  return process.env.YTDLP_QUOTA_STATE_FILE?.trim() || DEFAULT_QUOTA_FILE;
}

function getMinSuccessGapRangeMs(): { min: number; max: number } {
  // Backward-compatible fixed gap override.
  const fixed = Number.parseInt(process.env.YTDLP_MIN_SUCCESS_GAP_MS ?? '', 10);
  if (Number.isFinite(fixed) && fixed >= 0) {
    return { min: fixed, max: fixed };
  }

  const minEnv = Number.parseInt(
    process.env.YTDLP_MIN_SUCCESS_GAP_MIN_MS ?? '',
    10,
  );
  const maxEnv = Number.parseInt(
    process.env.YTDLP_MIN_SUCCESS_GAP_MAX_MS ?? '',
    10,
  );

  const min =
    Number.isFinite(minEnv) && minEnv >= 0
      ? minEnv
      : DEFAULT_MIN_SUCCESS_GAP_MIN_MS;
  const maxRaw =
    Number.isFinite(maxEnv) && maxEnv >= 0
      ? maxEnv
      : DEFAULT_MIN_SUCCESS_GAP_MAX_MS;
  const max = Math.max(min, maxRaw);

  return { min, max };
}

function getEffectiveMinSuccessGapRangeMs(quota: QuotaState | null): {
  min: number;
  max: number;
  adaptiveLevel: number;
  adaptiveExtraMs: number;
} {
  const base = getMinSuccessGapRangeMs();
  const level = Math.max(0, quota?.adaptivePenaltyLevel ?? 0);
  const extra = Math.min(
    ADAPTIVE_GAP_MAX_EXTRA_MS,
    level * ADAPTIVE_GAP_STEP_MS,
  );
  return {
    min: base.min + extra,
    max: base.max + extra,
    adaptiveLevel: level,
    adaptiveExtraMs: extra,
  };
}

function pickMinSuccessGapMs(quota: QuotaState | null): number {
  const { min, max } = getEffectiveMinSuccessGapRangeMs(quota);
  if (max === min) return min;
  return min + Math.floor(Math.random() * (max - min + 1));
}

interface QuotaState {
  // Timestamp of the most recent YouTube contact (success OR 429).
  // Used by the gate to refuse the next cache-miss request.
  lastContactAt: number;
  // Timestamp of the most recent successful contact, for diagnostics.
  lastSuccessAt: number;
  totalSuccesses: number;
  total429s: number;
  consecutive429s: number;
  adaptivePenaltyLevel: number;
  last429At: number;
  lastError?: string;
}

async function readQuotaState(): Promise<QuotaState | null> {
  const file = getQuotaFile();
  try {
    const buf = await fs.readFile(file, 'utf8');
    const parsed = JSON.parse(buf);
    // Accept legacy files that only have lastSuccessAt — treat them as
    // lastContactAt = lastSuccessAt so the gate still works.
    if (typeof parsed.totalSuccesses !== 'number') return null;
    return {
      lastContactAt:
        typeof parsed.lastContactAt === 'number'
          ? parsed.lastContactAt
          : (parsed.lastSuccessAt ?? 0),
      lastSuccessAt:
        typeof parsed.lastSuccessAt === 'number' ? parsed.lastSuccessAt : 0,
      totalSuccesses: parsed.totalSuccesses,
      total429s: typeof parsed.total429s === 'number' ? parsed.total429s : 0,
      consecutive429s:
        typeof parsed.consecutive429s === 'number' ? parsed.consecutive429s : 0,
      adaptivePenaltyLevel:
        typeof parsed.adaptivePenaltyLevel === 'number'
          ? parsed.adaptivePenaltyLevel
          : 0,
      last429At: typeof parsed.last429At === 'number' ? parsed.last429At : 0,
      lastError: parsed.lastError,
    };
  } catch {
    // File doesn't exist or is corrupted — treat as no state.
    return null;
  }
}

async function writeQuotaState(updates: Partial<QuotaState>): Promise<void> {
  const file = getQuotaFile();
  // Read-modify-write so we don't clobber fields updated by other code.
  const current = (await readQuotaState()) ?? {
    lastContactAt: 0,
    lastSuccessAt: 0,
    totalSuccesses: 0,
    total429s: 0,
    consecutive429s: 0,
    adaptivePenaltyLevel: 0,
    last429At: 0,
  };
  const next: QuotaState = { ...current, ...updates };
  try {
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, JSON.stringify(next, null, 2));
  } catch (err) {
    console.warn(
      `⚠️ [YT-SUB] Failed to write quota state: ${(err as Error).message}`,
    );
  }
}

const _quotaRange = getMinSuccessGapRangeMs();
const _quotaGapLabel =
  _quotaRange.min === _quotaRange.max
    ? `${Math.round(_quotaRange.min / 1000)}s`
    : `${Math.round(_quotaRange.min / 1000)}-${Math.round(_quotaRange.max / 1000)}s(random)`;
console.log(
  `⏱️  [YT-SUB] Quota gate: min_contact_gap=${_quotaGapLabel}, state_file=${getQuotaFile()}`,
);

/* ------------------------------------------------------------------ */
/*  yt-dlp helpers                                                     */
/* ------------------------------------------------------------------ */

function getRandomUserAgent(): string {
  return (
    USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)] ??
    USER_AGENTS[0]!
  );
}

/* ------------------------------------------------------------------ */
/*  Cookie helpers                                                     */
/* ------------------------------------------------------------------ */

// Pick the freshest cookies.txt file in a directory. Useful when you
// periodically re-export cookies (e.g. daily/weekly) and want yt-dlp
// to always use the most recent one.
//
// Set YTDLP_COOKIES_DIR to a directory containing one or more *.txt
// cookie files. The freshest (most recently modified) is selected.
//
// Filenames can be anything ending in .txt — e.g.:
//   ~/youtube-cookies/cookies-2026-06-27.txt
//   ~/youtube-cookies/cookies-2026-06-20.txt
async function pickFreshestCookiesFile(): Promise<string | null> {
  const dir = process.env.YTDLP_COOKIES_DIR?.trim();
  if (!dir) return null;

  try {
    const entries = await fs.readdir(dir);
    const txtFiles = entries.filter((f) => f.endsWith('.txt'));
    if (txtFiles.length === 0) return null;

    let freshest: { path: string; mtime: number } | null = null;
    for (const file of txtFiles) {
      const full = path.join(dir, file);
      try {
        const stat = await fs.stat(full);
        if (!stat.isFile()) continue;
        if (!freshest || stat.mtimeMs > freshest.mtime) {
          freshest = { path: full, mtime: stat.mtimeMs };
        }
      } catch {
        // skip unreadable
      }
    }
    return freshest?.path ?? null;
  } catch {
    return null;
  }
}

async function getYtDlpCookieArgsAsync(): Promise<string[]> {
  const cookiesFromBrowser = process.env.YTDLP_COOKIES_FROM_BROWSER;
  const cookiesFile = process.env.YTDLP_COOKIES_FILE;
  const cookiesDir = process.env.YTDLP_COOKIES_DIR;

  if (cookiesFromBrowser) return ['--cookies-from-browser', cookiesFromBrowser];
  if (cookiesFile) {
    await maybeWarnStaleCookieFile(cookiesFile);
    return ['--cookies', cookiesFile];
  }

  // If a cookies directory is set, pick the freshest .txt inside it.
  if (cookiesDir) {
    const picked = await pickFreshestCookiesFile();
    if (picked) {
      await maybeWarnStaleCookieFile(picked);
      console.log(`🍪 [YT-SUB] Using freshest cookies file: ${picked}`);
      return ['--cookies', picked];
    }
    console.warn(
      `⚠️ [YT-SUB] YTDLP_COOKIES_DIR=${cookiesDir} contains no readable .txt files`,
    );
  }

  return [];
}

function getYtDlpRemoteComponentArgs(): string[] {
  const remoteComponents = process.env.YTDLP_REMOTE_COMPONENTS?.trim();
  if (remoteComponents === 'off' || remoteComponents === 'none') return [];
  return ['--remote-components', remoteComponents || 'ejs:github'];
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function getStartupJitterMs(): number {
  const min = Math.max(
    0,
    Math.min(STARTUP_JITTER_MIN_MS, STARTUP_JITTER_MAX_MS),
  );
  const max = Math.max(min, STARTUP_JITTER_MAX_MS);
  if (max === min) return min;
  return min + Math.floor(Math.random() * (max - min + 1));
}

const STALE_COOKIE_WARN_MS = (() => {
  const v = Number.parseInt(process.env.YTDLP_COOKIE_STALE_WARN_MS ?? '', 10);
  return Number.isFinite(v) && v > 0 ? v : 72 * 60 * 60 * 1000;
})();
const staleCookieWarnings = new Set<string>();

async function maybeWarnStaleCookieFile(filePath: string): Promise<void> {
  if (staleCookieWarnings.has(filePath)) return;
  try {
    const stat = await fs.stat(filePath);
    const ageMs = Date.now() - stat.mtimeMs;
    if (ageMs <= STALE_COOKIE_WARN_MS) return;

    staleCookieWarnings.add(filePath);
    const ageHours = Math.round(ageMs / (60 * 60 * 1000));
    const thresholdHours = Math.round(STALE_COOKIE_WARN_MS / (60 * 60 * 1000));
    console.warn(
      `⚠️ [YT-SUB] Cookies file is stale (${ageHours}h old): ${filePath}. Refresh recommended (threshold=${thresholdHours}h).`,
    );
  } catch {
    // Ignore cookie stat errors; yt-dlp will surface read failures directly.
  }
}

/* ------------------------------------------------------------------ */
/*  Player-client rotation                                             */
/* ------------------------------------------------------------------ */

// Pool of YouTube player clients known to work with subtitle downloads.
// Each client has its own quota pool, so rotating per-request spreads
// load and avoids hitting one client's rate limit repeatedly.
//
// Set YTDLP_YOUTUBE_PLAYER_CLIENT=tv (or any other) to pin a single
// client. Leave it unset (or set to "random") to rotate.
const PLAYER_CLIENT_POOL = [
  'tv',
  'tv_downgraded',
  'web_safari',
  'web_embedded',
  'ios',
  'android_vr',
  'android',
] as const;

type PlayerClient = (typeof PLAYER_CLIENT_POOL)[number];
const PLAYER_CLIENT_FALLBACK_ORDER: PlayerClient[] = [
  'tv_downgraded',
  'tv',
  'web_safari',
  'ios',
  'android_vr',
  'web_embedded',
  'android',
];

const CLIENT_STATS_WINDOW_MS = (() => {
  const v = Number.parseInt(process.env.YTDLP_CLIENT_STATS_WINDOW_MS ?? '', 10);
  return Number.isFinite(v) && v > 0 ? v : 60 * 60 * 1000; // 1h
})();
const CLIENT_COOLDOWN_WINDOW_MS = (() => {
  const v = Number.parseInt(
    process.env.YTDLP_CLIENT_COOLDOWN_WINDOW_MS ?? '',
    10,
  );
  return Number.isFinite(v) && v > 0 ? v : 10 * 60 * 1000; // 10m
})();
const CLIENT_COOLDOWN_DURATION_MS = (() => {
  const v = Number.parseInt(
    process.env.YTDLP_CLIENT_COOLDOWN_DURATION_MS ?? '',
    10,
  );
  return Number.isFinite(v) && v > 0 ? v : 30 * 60 * 1000; // 30m
})();
const CLIENT_COOLDOWN_429_THRESHOLD = (() => {
  const v = Number.parseInt(
    process.env.YTDLP_CLIENT_COOLDOWN_429_THRESHOLD ?? '',
    10,
  );
  return Number.isFinite(v) && v >= 1 ? v : 2;
})();
const VIDEO_CLIENT_HINT_TTL_MS = (() => {
  const v = Number.parseInt(
    process.env.YTDLP_VIDEO_CLIENT_HINT_TTL_MS ?? '',
    10,
  );
  return Number.isFinite(v) && v > 0 ? v : 6 * 60 * 60 * 1000; // 6h
})();

interface ClientRuntimeStats {
  attempts: number;
  successes: number;
  rateLimits: number;
  otherFailures: number;
  recent429s: number[];
  cooldownUntil: number;
  lastSuccessAt: number;
  lastFailureAt: number;
  lastError?: string;
}

const clientRuntimeStats = new Map<PlayerClient, ClientRuntimeStats>();
const videoClientHints = new Map<
  string,
  { client: PlayerClient; at: number }
>();

function pickRandomPlayerClient(hasCookies: boolean): PlayerClient {
  const configured = process.env.YTDLP_YOUTUBE_PLAYER_CLIENT?.trim();

  // Explicit "random" or unset -> rotate from the pool.
  if (!configured || configured.toLowerCase() === 'random') {
    // Slightly prefer tv / tv_downgraded when we have cookies (they work
    // best with auth), but still mix in others so we don't hammer one.
    const weighted = hasCookies
      ? ['tv', 'tv_downgraded', 'tv', 'web_safari', 'ios', 'android_vr']
      : [
          'web_safari',
          'web_embedded',
          'ios',
          'android_vr',
          'tv',
          'tv_downgraded',
        ];
    return weighted[
      Math.floor(Math.random() * weighted.length)
    ] as PlayerClient;
  }

  // Pinned client: respect the env var, but validate against the known pool.
  if ((PLAYER_CLIENT_POOL as readonly string[]).includes(configured)) {
    return configured as PlayerClient;
  }

  // Unknown value: refuse to guess. Fail loud so the operator notices.
  console.warn(
    `⚠️ [YT-SUB] Unknown YTDLP_YOUTUBE_PLAYER_CLIENT="${configured}". Valid: ${PLAYER_CLIENT_POOL.join(', ')}, or "random". Falling back to "tv_downgraded".`,
  );
  return 'tv_downgraded';
}

function getClientStats(client: PlayerClient): ClientRuntimeStats {
  const existing = clientRuntimeStats.get(client);
  if (existing) return existing;
  const fresh: ClientRuntimeStats = {
    attempts: 0,
    successes: 0,
    rateLimits: 0,
    otherFailures: 0,
    recent429s: [],
    cooldownUntil: 0,
    lastSuccessAt: 0,
    lastFailureAt: 0,
  };
  clientRuntimeStats.set(client, fresh);
  return fresh;
}

function pruneClientStats(stats: ClientRuntimeStats, now = Date.now()): void {
  const cutoff = now - CLIENT_COOLDOWN_WINDOW_MS;
  while (stats.recent429s.length > 0 && stats.recent429s[0]! < cutoff) {
    stats.recent429s.shift();
  }
}

function isClientCoolingDown(client: PlayerClient, now = Date.now()): boolean {
  const stats = getClientStats(client);
  pruneClientStats(stats, now);
  return stats.cooldownUntil > now;
}

function noteClientSuccess(client: PlayerClient): void {
  const stats = getClientStats(client);
  const now = Date.now();
  stats.attempts++;
  stats.successes++;
  stats.lastSuccessAt = now;
  if (stats.cooldownUntil > 0 && stats.cooldownUntil <= now) {
    stats.cooldownUntil = 0;
  }
}

function noteClientRateLimit(client: PlayerClient, message: string): void {
  const stats = getClientStats(client);
  const now = Date.now();
  stats.attempts++;
  stats.rateLimits++;
  stats.lastFailureAt = now;
  stats.lastError = message.slice(0, 200);
  stats.recent429s.push(now);
  pruneClientStats(stats, now);
  if (stats.recent429s.length >= CLIENT_COOLDOWN_429_THRESHOLD) {
    stats.cooldownUntil = now + CLIENT_COOLDOWN_DURATION_MS;
    console.log(
      `🧊 [YT-SUB] Cooling down player_client=${client} for ${Math.round(CLIENT_COOLDOWN_DURATION_MS / 60000)}m after ${stats.recent429s.length} recent 429s.`,
    );
  }
}

function noteClientFailure(client: PlayerClient, message: string): void {
  const stats = getClientStats(client);
  stats.attempts++;
  stats.otherFailures++;
  stats.lastFailureAt = Date.now();
  stats.lastError = message.slice(0, 200);
}

function computeClientScore(client: PlayerClient, hasCookies: boolean): number {
  const stats = getClientStats(client);
  const now = Date.now();
  pruneClientStats(stats, now);

  const attempts = Math.max(1, stats.attempts);
  const successRate = stats.successes / attempts;
  const rateLimitRate = stats.rateLimits / attempts;
  const recentSuccessBoost =
    stats.lastSuccessAt > 0 &&
    now - stats.lastSuccessAt <= CLIENT_STATS_WINDOW_MS
      ? 0.5
      : 0;
  const baseOrderBonus =
    (PLAYER_CLIENT_FALLBACK_ORDER.length -
      PLAYER_CLIENT_FALLBACK_ORDER.indexOf(client)) *
    0.02;

  let score =
    successRate * 4 -
    rateLimitRate * 6 -
    stats.otherFailures * 0.15 +
    recentSuccessBoost +
    baseOrderBonus;

  if (hasCookies && client === 'tv_downgraded') score += 0.5;
  if (isClientCoolingDown(client, now)) score -= 10;

  return score;
}

function getVideoHintedClient(videoId?: string): PlayerClient | null {
  if (!videoId) return null;
  const hint = videoClientHints.get(videoId);
  if (!hint) return null;
  if (Date.now() - hint.at > VIDEO_CLIENT_HINT_TTL_MS) {
    videoClientHints.delete(videoId);
    return null;
  }
  return hint.client;
}

function rememberVideoClient(
  videoId: string | undefined,
  client: PlayerClient,
): void {
  if (!videoId) return;
  videoClientHints.set(videoId, { client, at: Date.now() });
}

function getYoutubeExtractorArgs(client: PlayerClient): string {
  const parts: string[] = ['player_js_version=actual'];
  if (client) parts.push(`player_client=${client}`);
  return `youtube:${parts.join(',')}`;
}

function getPlayerClientAttemptOrder(params: {
  preferredClient?: PlayerClient;
  hasCookies: boolean;
  videoId?: string;
}): PlayerClient[] {
  const now = Date.now();
  const ranked = [...PLAYER_CLIENT_FALLBACK_ORDER].sort(
    (a, b) =>
      computeClientScore(b, params.hasCookies) -
      computeClientScore(a, params.hasCookies),
  );

  const nonCooling = ranked.filter((c) => !isClientCoolingDown(c, now));
  const cooling = ranked.filter((c) => isClientCoolingDown(c, now));

  const order: PlayerClient[] = [];
  const hinted = getVideoHintedClient(params.videoId);
  if (hinted) order.push(hinted);
  if (params.preferredClient) order.push(params.preferredClient);
  for (const candidate of nonCooling) {
    if (!order.includes(candidate)) order.push(candidate);
  }
  for (const candidate of cooling) {
    if (!order.includes(candidate)) order.push(candidate);
  }
  return order;
}

async function runYtDlpWithClientFallback(params: {
  label: string;
  buildArgs: (client: PlayerClient) => string[];
  options?: {
    maxRetries?: number;
    baseDelay?: number;
    cooldownOn429?: boolean;
    suppress429Cooldown?: boolean;
  };
  preferredClient?: PlayerClient;
  hasCookies: boolean;
  videoId?: string;
}): Promise<{ output: string; client: PlayerClient }> {
  const attempts = getPlayerClientAttemptOrder({
    preferredClient: params.preferredClient,
    hasCookies: params.hasCookies,
    videoId: params.videoId,
  });
  let lastRateLimitMessage = '';

  for (let i = 0; i < attempts.length; i++) {
    const client = attempts[i]!;
    try {
      if (i > 0) {
        console.log(
          `🔁 [YT-SUB] (${params.label}) 429 fallback: trying player_client=${client} (${i + 1}/${attempts.length})`,
        );
      }
      const output = await runYtDlp(params.buildArgs(client), {
        ...params.options,
        // Critical: while testing fallback clients in the same request,
        // don't trigger the global 429 cooldown yet.
        suppress429Cooldown: true,
      });
      noteClientSuccess(client);
      rememberVideoClient(params.videoId, client);
      return { output, client };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (RATE_LIMIT_REGEX.test(message)) {
        noteClientRateLimit(client, message);
        lastRateLimitMessage = message;
        continue;
      }
      noteClientFailure(client, message);
      throw err;
    }
  }

  // All clients failed with 429 in this request: apply one global cooldown now.
  applyGlobal429Cooldown(`all clients exhausted (${params.label})`);

  throw new Error(
    `${ALL_CLIENTS_RATE_LIMITED_PREFIX} label=${params.label}; tried=${attempts.join(', ')}; last_error=${lastRateLimitMessage.slice(0, 300)}`,
  );
}

function isAllClientsRateLimitedError(message: string): boolean {
  return message.startsWith(ALL_CLIENTS_RATE_LIMITED_PREFIX);
}

function buildYtDlpBaseArgs(
  sleepInterval: string,
  maxSleepInterval: string,
  options: {
    cookieArgs: string[];
    playerClient: PlayerClient;
  },
): string[] {
  return [
    ...options.cookieArgs,
    '--user-agent',
    getRandomUserAgent(),
    '--extractor-args',
    getYoutubeExtractorArgs(options.playerClient),
    ...getYtDlpRemoteComponentArgs(),
    '--sleep-interval',
    sleepInterval,
    '--max-sleep-interval',
    maxSleepInterval,
    // Suppress the "your yt-dlp version is older than 90 days" warning,
    // which produces stderr noise that gets surfaced in retry logs.
    '--no-update',
    // Suppress the "no impersonate target is available" warning. Impersonation
    // is opt-in via env (e.g. YTDLP_REMOTE_COMPONENTS=ejs:github); the warning
    // is not actionable from this app.
    '--no-warnings',
  ];
}

async function retryWithBackoff<T>(
  fn: () => Promise<T>,
  maxRetries = 2,
  baseDelay = 10000,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  _cooldownOn429 = false, // retained for API compat; 429s are now fail-fast
): Promise<T> {
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      if (attempt > 0) {
        console.log(
          `🔄 [YT-SUB] Retry attempt ${attempt + 1}/${maxRetries + 1}`,
        );
      }
      return await fn();
    } catch (error) {
      if (attempt === maxRetries) throw error;

      const message = error instanceof Error ? error.message : String(error);
      const is429 = RATE_LIMIT_REGEX.test(message);

      // CRITICAL: on a 429, don't retry inside this call — the global
      // 429 cooldown already gates the next request via acquireSlot().
      // Retrying here just adds to the throttled-IP count and extends
      // the cooldown further. Fail fast, let the queue handle it.
      if (is429) {
        console.log(
          `⚠️ [YT-SUB] 429 hit — failing fast; fallback logic decides next step`,
        );
        throw error;
      }

      // Non-429 errors: use the configured base delay.
      const delayMs = baseDelay + Math.floor(Math.random() * 3001);

      console.log(
        `⚠️ [YT-SUB] Attempt ${attempt + 1}/${maxRetries + 1} failed. Retrying in ${Math.round(delayMs / 1000)}s...`,
      );
      console.log(`⚠️ [YT-SUB] Reason: ${message.slice(0, 500)}`);

      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }

  throw new Error('Max retries exceeded');
}

function runYtDlp(
  args: string[],
  options?: {
    maxRetries?: number;
    baseDelay?: number;
    cooldownOn429?: boolean;
    suppress429Cooldown?: boolean;
  },
): Promise<string> {
  return retryWithBackoff(
    async () => {
      if (startupJitterPending) {
        startupJitterPending = false;
        const jitterMs = getStartupJitterMs();
        if (jitterMs > 0) {
          console.log(
            `⏳ [YT-SUB] Startup jitter: waiting ${Math.round(jitterMs / 1000)}s before first outbound yt-dlp request...`,
          );
          await sleep(jitterMs);
        }
      }

      // Acquire a slot in the global rate-limit queue before doing anything.
      await acquireSlot();
      return new Promise<string>((resolve, reject) => {
        const proc = spawn(YT_DLP_RESOLVED.command, args);
        let stdout = '';
        let stderr = '';

        proc.stdout.on('data', (data: Buffer) => {
          stdout += data.toString();
        });
        proc.stderr.on('data', (data: Buffer) => {
          stderr += data.toString();
        });
        proc.on('close', (code) => {
          if (code === 0) {
            recordSuccess();
            resolve(stdout);
          } else {
            const errMsg =
              stderr || stdout || `yt-dlp exited with code ${code}`;
            recordFailure(RATE_LIMIT_REGEX.test(errMsg), {
              suppress429Cooldown: options?.suppress429Cooldown,
            });
            reject(new Error(errMsg));
          }
        });
        proc.on('error', (err) => {
          recordFailure(RATE_LIMIT_REGEX.test(err.message), {
            suppress429Cooldown: options?.suppress429Cooldown,
          });
          reject(err);
        });
      });
    },
    options?.maxRetries ?? 2,
    options?.baseDelay ?? 10000,
    options?.cooldownOn429 ?? false,
  );
}

/* ------------------------------------------------------------------ */
/*  Subtitle list parser                                               */
/* ------------------------------------------------------------------ */

interface SubtitleEntry {
  lang: string;
  name: string;
  formats: string[];
  auto: boolean;
}

function parseSubtitleList(output: string): SubtitleEntry[] {
  const subtitles: SubtitleEntry[] = [];
  const lines = output.split('\n');

  let inSubsSection = false;
  let isAutoSection = false;

  for (const line of lines) {
    if (AUTO_CAPTIONS_SECTION_REGEX.test(line)) {
      isAutoSection = true;
      continue;
    }
    if (SUBTITLES_SECTION_REGEX.test(line)) {
      isAutoSection = false;
      continue;
    }
    if (SUBTITLE_TABLE_HEADER_REGEX.test(line)) {
      inSubsSection = true;
      continue;
    }
    if (!inSubsSection) continue;
    if (inSubsSection && line.trim() === '') {
      inSubsSection = false;
      continue;
    }
    if (SEPARATOR_LINE_REGEX.test(line)) continue;

    const match = SUBTITLE_ROW_REGEX.exec(line);
    if (match) {
      const langCode = match[1];
      const name = match[2];
      const formatsStr = match[3];
      if (!langCode || !name || !formatsStr) continue;

      const formats = [
        ...new Set(
          formatsStr
            .split(/,\s*/)
            .map((f) => f.trim())
            .filter(Boolean),
        ),
      ];

      subtitles.push({
        lang: langCode,
        name: name.trim(),
        formats,
        auto: isAutoSection,
      });
    }
  }

  return subtitles;
}

/* ------------------------------------------------------------------ */
/*  POST handler                                                       */
/* ------------------------------------------------------------------ */

export async function POST(request: NextRequest) {
  let body: { url?: string; lang?: string; format?: string; action?: string };

  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const { url, lang, format, action } = body;

  if (!url || typeof url !== 'string') {
    return NextResponse.json({ error: 'url is required' }, { status: 400 });
  }

  /* ── LIST available subtitles ─────────────────────────────────── */

  if (action === 'list') {
    console.log(`📋 [YT-SUB] Listing subtitles for: ${url}`);
    const startMs = Date.now();

    // Cache the list response so UI re-renders don't re-hit YouTube.
    const listVideoId = extractVideoId(url);
    if (listVideoId) {
      const listCached = await readListCache(listVideoId);
      if (listCached) {
        const ageMs = Date.now() - listCached.cachedAt;
        const ageLabel =
          ageMs < 60_000
            ? `${Math.round(ageMs / 1000)}s`
            : `${Math.round(ageMs / 60_000)}m`;
        console.log(
          `💾 [YT-SUB] List cache HIT for ${listVideoId} (age=${ageLabel}, ${listCached.entries.length} entries)`,
        );
        return NextResponse.json({
          subtitles: listCached.entries,
          cached: true,
        });
      }
    }

    try {
      const cookieArgs = await getYtDlpCookieArgsAsync();
      const preferredClient = pickRandomPlayerClient(cookieArgs.length > 0);
      const { output, client: playerClient } = await runYtDlpWithClientFallback(
        {
          label: 'list',
          preferredClient,
          hasCookies: cookieArgs.length > 0,
          videoId: listVideoId ?? undefined,
          buildArgs: (client) => [
            ...buildYtDlpBaseArgs('1', '3', {
              cookieArgs,
              playerClient: client,
            }),
            '--list-subs',
            '--skip-download',
            url,
          ],
          options: { maxRetries: 1, baseDelay: 12000, cooldownOn429: true },
        },
      );
      console.log(`🎯 [YT-SUB] (list) player_client=${playerClient}`);

      const subtitles = parseSubtitleList(output);
      console.log(
        `📋 [YT-SUB] ✅ Found ${subtitles.length} subtitle entries in ${Date.now() - startMs}ms`,
      );

      if (listVideoId) {
        void writeListCache(listVideoId, subtitles);
      }

      return NextResponse.json({ subtitles, cached: false });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.log(
        `📋 [YT-SUB] ❌ Failed after ${Date.now() - startMs}ms: ${message}`,
      );
      const allClientsExhausted = isAllClientsRateLimitedError(message);
      const is429 = RATE_LIMIT_REGEX.test(message);
      const cooldownRemaining = Math.max(
        0,
        queueState.globalCooldownUntil - Date.now(),
      );

      if (allClientsExhausted) {
        const retryAfterSec = Math.max(
          5,
          Math.ceil(cooldownRemaining / 1000) || 60,
        );
        const nextAttemptAt = new Date(
          Date.now() + retryAfterSec * 1000,
        ).toISOString();
        return NextResponse.json(
          {
            queued: true,
            status: 'retrying_later',
            error:
              'YouTube subtitle providers are temporarily busy. Request queued for retry window.',
            retryAfterMs: retryAfterSec * 1000,
            retryAfterSeconds: retryAfterSec,
            nextAttemptAt,
            rateLimited: true,
            cooldownMs: cooldownRemaining,
          },
          {
            status: 202,
            headers: {
              'Retry-After': String(retryAfterSec),
              'X-RateLimit-Cooldown-Ms': String(cooldownRemaining),
              'X-YT-Sub-Queued': '1',
            },
          },
        );
      }

      return NextResponse.json(
        {
          error: is429
            ? `YouTube rate-limited this IP. Try again in ${Math.round(cooldownRemaining / 1000)}s, or switch networks.`
            : `Failed to list subtitles: ${message}`,
          rateLimited: is429,
          cooldownMs: cooldownRemaining,
        },
        {
          status: is429 ? 429 : 500,
          headers: is429
            ? {
                'Retry-After': String(Math.ceil(cooldownRemaining / 1000)),
                'X-RateLimit-Cooldown-Ms': String(cooldownRemaining),
              }
            : {},
        },
      );
    }
  }

  /* ── DOWNLOAD a specific subtitle ─────────────────────────────── */

  if (!lang || typeof lang !== 'string') {
    return NextResponse.json(
      { error: 'lang is required for download (or use action="list")' },
      { status: 400 },
    );
  }

  const subFormat = format || 'srt';
  console.log(
    `📥 [YT-SUB] Downloading subtitle: lang=${lang}, format=${subFormat}, url=${url}`,
  );
  const dlStart = Date.now();

  const videoId = extractVideoId(url);

  /* ── Cache lookup ─────────────────────────────────────────────── */

  if (videoId) {
    const cached = await readCache(videoId, lang, subFormat);
    if (cached) {
      const ageMs = Date.now() - cached.cachedAt;
      const ageLabel =
        ageMs < 60_000
          ? `${Math.round(ageMs / 1000)}s`
          : ageMs < 3_600_000
            ? `${Math.round(ageMs / 60_000)}m`
            : `${Math.round(ageMs / 3_600_000)}h`;
      console.log(
        `💾 [YT-SUB] Cache HIT for ${videoId} (${lang}/${subFormat}, age=${ageLabel}) — skipping YouTube`,
      );
      return new NextResponse(new Uint8Array(cached.content), {
        headers: {
          'Content-Type': cached.contentType,
          'Content-Disposition': `attachment; filename="${cached.filename}"`,
          'X-Subtitle-Lang': lang,
          'X-Subtitle-Format': cached.ext,
          'X-Subtitle-Size': String(cached.content.length),
          'X-Subtitle-Cache': 'HIT',
          'X-Subtitle-Cache-Age': ageLabel,
        },
      });
    }
  }

  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'subtitles-'));
  console.log(`📁 [YT-SUB] Temp dir: ${tmpDir}`);

  /* ── Quota gate (wait, don't reject) ────────────────────────────── */

  // If the last YouTube contact (success OR 429) was less than
  // YTDLP_MIN_SUCCESS_GAP_MS ago, wait silently for the gap to expire
  // instead of rejecting the request. The caller sees a long-running
  // request that ultimately succeeds (or fails on a fresh 429).
  const quota = await readQuotaState();
  const minGap = pickMinSuccessGapMs(quota);
  if (minGap > 0) {
    const lastContact = quota?.lastContactAt ?? quota?.lastSuccessAt ?? 0;
    if (lastContact > 0) {
      const elapsed = Date.now() - lastContact;
      if (elapsed < minGap) {
        const waitMs = minGap - elapsed;
        const waitSec = Math.round(waitMs / 1000);
        console.log(
          `⏱️  [YT-SUB] Quota gate: last YouTube contact was ${Math.round(elapsed / 1000)}s ago. Waiting ${waitSec}s before proceeding...`,
        );
        // Emit periodic "still waiting" ticks so the dev log shows progress.
        const tickIntervalMs = Math.min(
          30000,
          Math.max(5000, Math.floor(waitMs / 4)),
        );
        const tickTimer = setInterval(() => {
          const remaining = Math.max(0, minGap - (Date.now() - lastContact));
          console.log(
            `⏱️  [YT-SUB] Quota gate: still waiting, ${Math.round(remaining / 1000)}s remaining...`,
          );
        }, tickIntervalMs);
        await new Promise<void>((resolve) => {
          setTimeout(() => {
            clearInterval(tickTimer);
            resolve();
          }, waitMs);
        });
        console.log(
          `⏱️  [YT-SUB] Quota gate: gap elapsed, proceeding with download.`,
        );
      }
    }
  }

  try {
    const cookieArgs = await getYtDlpCookieArgsAsync();
    const preferredClient = pickRandomPlayerClient(cookieArgs.length > 0);
    console.log(
      `🎯 [YT-SUB] (download) player_client=${preferredClient}, cookies=${cookieArgs.length > 0 ? 'on' : 'off'}`,
    );

    // Preflight probe to avoid burning the full subtitle download flow on a
    // client that is currently hot-throttled.
    const preflight = await runYtDlpWithClientFallback({
      label: 'download-preflight',
      preferredClient,
      hasCookies: cookieArgs.length > 0,
      videoId: videoId ?? undefined,
      buildArgs: (client) => [
        ...buildYtDlpBaseArgs('1', '2', { cookieArgs, playerClient: client }),
        '--list-subs',
        '--skip-download',
        url,
      ],
      options: { maxRetries: 0, baseDelay: 8000, cooldownOn429: true },
    });

    console.log(
      `🧭 [YT-SUB] Preflight selected player_client=${preflight.client}`,
    );

    const { client: playerClient } = await runYtDlpWithClientFallback({
      label: 'download',
      preferredClient: preflight.client,
      hasCookies: cookieArgs.length > 0,
      videoId: videoId ?? undefined,
      buildArgs: (client) => [
        ...buildYtDlpBaseArgs('2', '5', { cookieArgs, playerClient: client }),
        '--write-subs',
        '--write-auto-subs',
        '--sub-langs',
        lang,
        '--sub-format',
        subFormat,
        '--skip-download',
        '--no-write-playlist-metafiles',
        '-o',
        path.join(tmpDir, 'subtitle.%(ext)s'),
        url,
      ],
      options: { maxRetries: 1, baseDelay: 15000, cooldownOn429: true },
    });

    console.log(`✅ [YT-SUB] yt-dlp finished in ${Date.now() - dlStart}ms`);

    const files = await fs.readdir(tmpDir);
    console.log(
      `📂 [YT-SUB] Files in temp dir: ${files.join(', ') || '(empty)'}`,
    );
    const subFile = files.find((f) => f.startsWith('subtitle.'));

    if (!subFile) {
      console.log(`❌ [YT-SUB] No subtitle file found for lang "${lang}"`);
      return NextResponse.json(
        { error: `No subtitle file found for language "${lang}"` },
        { status: 404 },
      );
    }

    const filePath = path.join(tmpDir, subFile);
    const content = await fs.readFile(filePath);
    const ext = path.extname(subFile).slice(1);

    console.log(
      `📄 [YT-SUB] Serving ${subFile} (${content.length} bytes) after ${Date.now() - dlStart}ms total`,
    );

    const contentType =
      ext === 'vtt'
        ? 'text/vtt'
        : ext === 'srt'
          ? 'text/plain'
          : ext === 'ttml'
            ? 'application/ttml+xml'
            : 'text/plain';

    const filename = `subtitles_${lang}.${ext}`;

    // Persist to disk cache (best-effort, non-blocking on failure).
    if (videoId) {
      void writeCache(videoId, lang, subFormat, {
        content,
        ext,
        contentType,
        filename,
      });
      console.log(
        `💾 [YT-SUB] Cached ${videoId} (${lang}/${subFormat}) at ${getCacheDir()}`,
      );
    }

    // Record this successful YouTube contact in the persistent quota
    // file. The next cache-miss request will be gated against this
    // timestamp until YTDLP_MIN_SUCCESS_GAP_MS elapses.
    try {
      const prev = await readQuotaState();
      const now = Date.now();
      await writeQuotaState({
        lastContactAt: now,
        lastSuccessAt: now,
        totalSuccesses: (prev?.totalSuccesses ?? 0) + 1,
        consecutive429s: 0,
        adaptivePenaltyLevel: Math.max(
          0,
          (prev?.adaptivePenaltyLevel ?? 0) - 1,
        ),
        lastError: undefined,
      });
      const gapRange = getEffectiveMinSuccessGapRangeMs(prev ?? null);
      const gapLabel =
        gapRange.min === gapRange.max
          ? `${Math.round(gapRange.min / 1000)}s`
          : `${Math.round(gapRange.min / 1000)}-${Math.round(gapRange.max / 1000)}s(random${gapRange.adaptiveExtraMs > 0 ? `, adaptive+${Math.round(gapRange.adaptiveExtraMs / 1000)}s` : ''})`;
      console.log(
        `⏱️  [YT-SUB] Quota updated: last_success=now, next_allowed_in=${gapLabel}`,
      );
    } catch (quotaErr) {
      console.warn(
        `⚠️ [YT-SUB] Failed to persist success quota state: ${(quotaErr as Error).message}`,
      );
    }

    return new NextResponse(new Uint8Array(content), {
      headers: {
        'Content-Type': contentType,
        'Content-Disposition': `attachment; filename="${filename}"`,
        'X-Subtitle-Lang': lang,
        'X-Subtitle-Format': ext,
        'X-Subtitle-Size': String(content.length),
        'X-Subtitle-Cache': 'MISS',
        'X-Subtitle-Player-Client': playerClient,
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.log(
      `❌ [YT-SUB] Download failed after ${Date.now() - dlStart}ms: ${message}`,
    );
    const allClientsExhausted = isAllClientsRateLimitedError(message);
    const is429 = RATE_LIMIT_REGEX.test(message);
    const cooldownRemaining = Math.max(
      0,
      queueState.globalCooldownUntil - Date.now(),
    );

    if (is429 || allClientsExhausted) {
      // Persist the 429 to the quota file so it shows up in the GET status.
      // Also update lastContactAt so the quota gate blocks the next request.
      try {
        const prev = await readQuotaState();
        const nextConsecutive429s = (prev?.consecutive429s ?? 0) + 1;
        const maxAdaptiveLevel =
          ADAPTIVE_GAP_STEP_MS > 0
            ? Math.floor(ADAPTIVE_GAP_MAX_EXTRA_MS / ADAPTIVE_GAP_STEP_MS)
            : 0;
        const nextAdaptiveLevel = Math.min(
          maxAdaptiveLevel,
          (prev?.adaptivePenaltyLevel ?? 0) + 1,
        );
        await writeQuotaState({
          lastContactAt: Date.now(),
          total429s: (prev?.total429s ?? 0) + 1,
          consecutive429s: nextConsecutive429s,
          adaptivePenaltyLevel: nextAdaptiveLevel,
          last429At: Date.now(),
          lastError: message.slice(0, 200),
        });
      } catch (quotaErr) {
        console.warn(
          `⚠️ [YT-SUB] Failed to persist 429 quota state: ${(quotaErr as Error).message}`,
        );
      }
    }

    if (allClientsExhausted) {
      const retryAfterSec = Math.max(
        5,
        Math.ceil(cooldownRemaining / 1000) || 60,
      );
      const nextAttemptAt = new Date(
        Date.now() + retryAfterSec * 1000,
      ).toISOString();
      return NextResponse.json(
        {
          queued: true,
          status: 'retrying_later',
          error:
            'Subtitle source is temporarily rate-limited across all clients. Please retry after the suggested delay.',
          retryAfterMs: retryAfterSec * 1000,
          retryAfterSeconds: retryAfterSec,
          nextAttemptAt,
          rateLimited: true,
          cooldownMs: cooldownRemaining,
        },
        {
          status: 202,
          headers: {
            'Retry-After': String(retryAfterSec),
            'X-RateLimit-Cooldown-Ms': String(cooldownRemaining),
            'X-YT-Sub-Queued': '1',
          },
        },
      );
    }

    return NextResponse.json(
      {
        error: is429
          ? `YouTube rate-limited this IP. Try again in ${Math.round(cooldownRemaining / 1000)}s, or switch networks.`
          : `Failed to download subtitle: ${message}`,
        rateLimited: is429,
        cooldownMs: cooldownRemaining,
      },
      {
        status: is429 ? 429 : 500,
        headers: is429
          ? {
              'Retry-After': String(Math.ceil(cooldownRemaining / 1000)),
              'X-RateLimit-Cooldown-Ms': String(cooldownRemaining),
            }
          : {},
      },
    );
  } finally {
    try {
      await fs.rm(tmpDir, { recursive: true, force: true });
    } catch {
      // Best-effort cleanup.
    }
  }
}

/* ------------------------------------------------------------------ */
/*  GET — status / introspection                                       */
/* ------------------------------------------------------------------ */

// Returns current rate-limit + cache state. Useful for debugging from
// the browser or curl:
//   curl http://localhost:9540/api/download-youtube-subtitles
export async function GET(): Promise<NextResponse> {
  const cooldownMs = Math.max(0, queueState.globalCooldownUntil - Date.now());
  const cookieArgs = await getYtDlpCookieArgsAsync();
  const quota = await readQuotaState();
  const effectiveGap = getEffectiveMinSuccessGapRangeMs(quota);

  // Compute how much longer the quota gate will block cache-miss requests.
  let cooldownRemainingMs = 0;
  if (quota && quota.lastContactAt > 0) {
    const elapsed = Date.now() - quota.lastContactAt;
    if (elapsed < effectiveGap.max) {
      cooldownRemainingMs = effectiveGap.max - elapsed;
    }
  }

  const clientStats = PLAYER_CLIENT_FALLBACK_ORDER.map((client) => {
    const stats = getClientStats(client);
    pruneClientStats(stats);
    return {
      client,
      attempts: stats.attempts,
      successes: stats.successes,
      rateLimits: stats.rateLimits,
      otherFailures: stats.otherFailures,
      coolingDown: stats.cooldownUntil > Date.now(),
      cooldownUntil: stats.cooldownUntil
        ? new Date(stats.cooldownUntil).toISOString()
        : null,
      score: Number(
        computeClientScore(client, cookieArgs.length > 0).toFixed(3),
      ),
      lastSuccessAt: stats.lastSuccessAt
        ? new Date(stats.lastSuccessAt).toISOString()
        : null,
      lastFailureAt: stats.lastFailureAt
        ? new Date(stats.lastFailureAt).toISOString()
        : null,
    };
  });

  // Count cached entries on disk.
  let cachedEntries = 0;
  let cachedBytes = 0;
  try {
    const cacheDir = getCacheDir();
    const files = await fs.readdir(cacheDir);
    for (const f of files) {
      try {
        const stat = await fs.stat(path.join(cacheDir, f));
        cachedBytes += stat.size;
        cachedEntries++;
      } catch {
        // skip
      }
    }
  } catch {
    // cache dir doesn't exist yet
  }

  return NextResponse.json({
    binary: YT_DLP_RESOLVED,
    cookies: {
      enabled: cookieArgs.length > 0,
      args: cookieArgs,
    },
    rateLimit: {
      maxConcurrent: MAX_CONCURRENT,
      minGapMs: MIN_GAP_MS,
      cooldownMs,
      cooldownUntil: queueState.globalCooldownUntil
        ? new Date(queueState.globalCooldownUntil).toISOString()
        : null,
      activeRequests: queueState.activeCount,
      totalRequests: queueState.totalRequests,
      total429s: queueState.total429s,
      recent429sLast5Min: queueState.recent429s.length,
    },
    quota: {
      minSuccessGapBaseMinMs: getMinSuccessGapRangeMs().min,
      minSuccessGapBaseMaxMs: getMinSuccessGapRangeMs().max,
      minSuccessGapEffectiveMinMs: effectiveGap.min,
      minSuccessGapEffectiveMaxMs: effectiveGap.max,
      adaptivePenaltyLevel: effectiveGap.adaptiveLevel,
      adaptiveExtraMs: effectiveGap.adaptiveExtraMs,
      stateFile: getQuotaFile(),
      lastContactAt: quota?.lastContactAt
        ? new Date(quota.lastContactAt).toISOString()
        : null,
      secondsSinceLastContact: quota?.lastContactAt
        ? Math.round((Date.now() - quota.lastContactAt) / 1000)
        : null,
      lastSuccessAt: quota?.lastSuccessAt
        ? new Date(quota.lastSuccessAt).toISOString()
        : null,
      secondsSinceLastSuccess: quota?.lastSuccessAt
        ? Math.round((Date.now() - quota.lastSuccessAt) / 1000)
        : null,
      cooldownRemainingMs,
      totalSuccesses: quota?.totalSuccesses ?? 0,
      total429s: quota?.total429s ?? 0,
      consecutive429s: quota?.consecutive429s ?? 0,
      last429At: quota?.last429At
        ? new Date(quota.last429At).toISOString()
        : null,
      lastError: quota?.lastError ?? null,
    },
    clientHealth: clientStats,
    cache: {
      enabled: getCacheEnabled(),
      dir: getCacheDir(),
      ttlMs: getCacheTtlMs(),
      entries: cachedEntries,
      bytes: cachedBytes,
    },
  });
}

/* ------------------------------------------------------------------ */
/*  DELETE — clear cache + reset cooldowns                            */
/* ------------------------------------------------------------------ */

// Clears the subtitle cache, resets the in-memory 429 cooldown, and/or
// resets the persistent quota gate. Use this when:
//   - you want to force a fresh fetch from YouTube
//   - you've been 429-stormed and want to reset the session state
//   - you want to bypass the persistent 2-minute quota gate
//
// Query params:
//   ?scope=cache      — only clear disk subtitle cache
//   ?scope=cooldown   — only reset in-memory 429 cooldown
//   ?scope=quota      — only reset the persistent quota gate
//   ?scope=all        — clear all (default)
export async function DELETE(request: NextRequest): Promise<NextResponse> {
  const url = new URL(request.url);
  const scope = (url.searchParams.get('scope') ?? 'all').toLowerCase();

  const cleared: {
    cache?: number;
    cooldownReset?: boolean;
    quotaReset?: boolean;
  } = {};

  if (scope === 'cache' || scope === 'all') {
    const cacheDir = getCacheDir();
    let count = 0;
    try {
      const files = await fs.readdir(cacheDir);
      for (const f of files) {
        try {
          await fs.unlink(path.join(cacheDir, f));
          count++;
        } catch {
          // skip
        }
      }
      cleared.cache = count;
      console.log(
        `🧹 [YT-SUB] Cache cleared: ${count} files removed from ${cacheDir}`,
      );
    } catch {
      // cache dir doesn't exist
      cleared.cache = 0;
    }
  }

  if (scope === 'cooldown' || scope === 'all') {
    queueState.globalCooldownUntil = 0;
    queueState.recent429s = [];
    cleared.cooldownReset = true;
    console.log(`🧹 [YT-SUB] 429 cooldown reset`);
  }

  if (scope === 'quota' || scope === 'all') {
    // Wipe the persistent quota file so the next request isn't gated.
    try {
      await fs.unlink(getQuotaFile());
      cleared.quotaReset = true;
      console.log(`🧹 [YT-SUB] Quota gate reset: ${getQuotaFile()} removed`);
    } catch {
      // file didn't exist
      cleared.quotaReset = true;
    }
  }

  return NextResponse.json({ ok: true, cleared });
}
