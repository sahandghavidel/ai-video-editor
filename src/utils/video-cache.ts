import crypto from 'crypto';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { Readable } from 'stream';

type EnsureOptions = {
  maxAgeMs: number;
};

const CACHE_DIR = path.join(os.tmpdir(), 'ultimate-video-editr-video-cache');
const inflight = new Map<string, Promise<string>>();
let lastCleanupMs = 0;

const isHttpUrl = (value: string) => /^https?:\/\//i.test(value);

const normalizeCacheKey = (videoUrl: string) => {
  if (!isHttpUrl(videoUrl)) return videoUrl;
  try {
    const u = new URL(videoUrl);
    // Strip querystring so different signatures reuse the same cache slot.
    return `${u.origin}${u.pathname}`;
  } catch {
    return videoUrl;
  }
};

const hashKey = (key: string) =>
  crypto.createHash('sha256').update(key).digest('hex');

async function ensureCacheDir() {
  await fs.promises.mkdir(CACHE_DIR, { recursive: true });
}

async function fileIsFresh(filePath: string, maxAgeMs: number) {
  try {
    const st = await fs.promises.stat(filePath);
    return Date.now() - st.mtimeMs <= maxAgeMs && st.size > 0;
  } catch {
    return false;
  }
}

async function cleanupOldFiles(maxAgeMs: number) {
  const now = Date.now();
  if (now - lastCleanupMs < 60_000) return;
  lastCleanupMs = now;

  let entries: string[];
  try {
    entries = await fs.promises.readdir(CACHE_DIR);
  } catch {
    return;
  }

  const cutoff = now - Math.max(1, maxAgeMs);
  let deleted = 0;
  for (const name of entries) {
    if (deleted >= 50) break;
    const full = path.join(CACHE_DIR, name);
    try {
      const st = await fs.promises.stat(full);
      if (!st.isFile()) continue;
      if (st.mtimeMs < cutoff) {
        await fs.promises.rm(full, { force: true });
        deleted++;
      }
    } catch {
      // ignore
    }
  }
}

export async function getCachedVideoPathIfFresh(
  videoUrl: string,
  opts: EnsureOptions
): Promise<string | null> {
  if (!isHttpUrl(videoUrl)) return null;
  await ensureCacheDir();
  const key = normalizeCacheKey(videoUrl);
  const filePath = path.join(CACHE_DIR, `${hashKey(key)}.mp4`);
  return (await fileIsFresh(filePath, opts.maxAgeMs)) ? filePath : null;
}

export async function ensureVideoCached(
  videoUrl: string,
  opts: EnsureOptions
): Promise<string> {
  if (!isHttpUrl(videoUrl)) {
    throw new Error('Video cache only supports http(s) URLs');
  }

  await ensureCacheDir();

  const key = normalizeCacheKey(videoUrl);
  const filePath = path.join(CACHE_DIR, `${hashKey(key)}.mp4`);

  if (await fileIsFresh(filePath, opts.maxAgeMs)) {
    void cleanupOldFiles(opts.maxAgeMs * 2);
    return filePath;
  }

  const existing = inflight.get(key);
  if (existing) return existing;

  const p = (async () => {
    const tmpPath = `${filePath}.tmp-${process.pid}-${Date.now()}`;

    try {
      const res = await fetch(videoUrl);
      if (!res.ok) {
        throw new Error(`Failed to download video (${res.status})`);
      }

      // Stream to disk to avoid buffering large videos in memory.
      if (res.body) {
        const nodeStream = Readable.fromWeb(res.body as never);
        await new Promise<void>((resolve, reject) => {
          const out = fs.createWriteStream(tmpPath);
          nodeStream.on('error', reject);
          out.on('error', reject);
          out.on('finish', resolve);
          nodeStream.pipe(out);
        });
      } else {
        const buf = Buffer.from(await res.arrayBuffer());
        await fs.promises.writeFile(tmpPath, buf);
      }

      await fs.promises.rename(tmpPath, filePath).catch(async () => {
        // Cross-device rename fallback.
        await fs.promises.copyFile(tmpPath, filePath);
        await fs.promises.rm(tmpPath, { force: true });
      });

      void cleanupOldFiles(opts.maxAgeMs * 2);
      return filePath;
    } catch (err) {
      await fs.promises.rm(tmpPath, { force: true }).catch(() => {
        // ignore
      });
      throw err;
    } finally {
      inflight.delete(key);
    }
  })();

  inflight.set(key, p);
  return p;
}
