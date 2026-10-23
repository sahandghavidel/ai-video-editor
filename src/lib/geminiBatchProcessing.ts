import { access, readFile, rename, writeFile } from 'fs/promises';
import path from 'path';
import { uploadToMinio } from '@/utils/ffmpeg-direct';
import { batchJobDirectory, readBatchJob } from '@/lib/geminiBatchStore';

type PermitPool = { active: number; waiting: (() => void)[] };
const globals = globalThis as typeof globalThis & {
  geminiBatchFitPool?: PermitPool;
  geminiBatchUploads?: Map<string, Promise<string>>;
};
export const GEMINI_BATCH_POLL_INTERVAL_MS = 10_000;
export function getBatchProcessingConcurrency() {
  const value = Number(process.env.GEMINI_TTS_BATCH_PROCESSING_CONCURRENCY || 6);
  return Number.isInteger(value) ? Math.max(1, Math.min(12, value)) : 6;
}
export async function withBatchFitSlot<T>(run: () => Promise<T>): Promise<T> {
  const pool = globals.geminiBatchFitPool ??= { active: 0, waiting: [] };
  const value = Number(process.env.GEMINI_TTS_BATCH_FITTING_CONCURRENCY || 3);
  const limit = Number.isInteger(value) ? Math.max(1, Math.min(4, value)) : 3;
  if (pool.active >= limit) await new Promise<void>(resolve => pool.waiting.push(resolve));
  else pool.active++;
  try { return await run(); }
  finally {
    const next = pool.waiting.shift();
    if (next) next(); else pool.active--;
  }
}
export async function getBatchLocalAudio(id: string, sceneId: number): Promise<string> {
  const job = await readBatchJob(id);
  const scene = job.scenes.find(item => item.id === sceneId);
  if (!scene || job.state !== 'processing') throw new Error('Invalid Batch audio scene');
  if (!scene.rawFile) {
    if (scene.rawUrl) return scene.rawUrl; // Older completed upload checkpoints.
    throw new Error(`Batch audio is not ready for scene ${sceneId}`);
  }
  if (scene.rawFile !== `scene-${sceneId}.wav`) throw new Error('Invalid Batch WAV path');
  const local = path.join(batchJobDirectory(id), scene.rawFile);
  await access(local);
  return local;
}
export async function readBatchOriginalUrl(id: string, sceneId: number): Promise<string | undefined> {
  try {
    const result = JSON.parse(await readFile(path.join(batchJobDirectory(id), `scene-${sceneId}-upload.json`), 'utf8'));
    if (result.sceneId !== sceneId || result.jobId !== id || typeof result.url !== 'string' || !/^https?:\/\//.test(result.url)) throw new Error('Invalid Batch upload checkpoint');
    return result.url as string;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
    throw error;
  }
}
export async function ensureBatchOriginalUploaded(id: string, sceneId: number): Promise<string> {
  const uploads = globals.geminiBatchUploads ??= new Map();
  const key = `${id}:${sceneId}`;
  const existing = uploads.get(key);
  if (existing) return existing;
  const upload = (async () => {
    const job = await readBatchJob(id);
    const scene = job.scenes.find(item => item.id === sceneId);
    if (!scene || job.state !== 'processing') throw new Error('Invalid Batch upload scene');
    if (scene.rawUrl) return scene.rawUrl;
    const saved = await readBatchOriginalUrl(id, sceneId);
    if (saved) return saved;
    const started = Date.now();
    const local = await getBatchLocalAudio(id, sceneId);
    const url = await uploadToMinio(local, `video_${job.videoId}_scene_${sceneId}_tts_batch_${id}.wav`, 'audio/wav');
    const target = path.join(batchJobDirectory(id), `scene-${sceneId}-upload.json`);
    await writeFile(`${target}.tmp`, JSON.stringify({ jobId: id, sceneId, url }), { mode: 0o600 });
    await rename(`${target}.tmp`, target);
    console.info('[Gemini Batch] Stage timing', JSON.stringify({ jobId: id, sceneId, stage: 'original-upload', elapsedMs: Date.now() - started }));
    return url;
  })();
  uploads.set(key, upload);
  try { return await upload; } finally { uploads.delete(key); }
}
