import { mkdir, readFile, writeFile, rename, readdir, rm, stat } from 'fs/promises';
import path from 'path';
import { randomUUID } from 'crypto';
import { getBaserowToken, buildAuthHeader } from '@/lib/baserow-auth';
import { loadTtsAudioReferencesStore } from '@/lib/ttsAudioReferencesStore';
import { normalizeGeminiTtsSettings } from '@/utils/geminiTtsSettings';

export const BATCH_ROOT = path.join(process.cwd(), '.cache/gemini-tts-batches');
export type BatchScene = {
  id: number; key: string; text: string; duration: unknown;
  inputs: Record<string, unknown>; existing: boolean;
  rawFile?: string; rawUrl?: string; done?: boolean; attempts?: number; error?: string;
};
export type GeminiBatchJob = {
  id: string; videoId: number; language: string; presetId: string;
  presetSnapshot: string; origin: string; createdAt: string; updatedAt: string;
  state: 'queued' | 'submitting' | 'waiting' | 'processing' | 'merging' | 'completed' | 'failed';
  step2: Record<string, unknown>; merge: Record<string, unknown>;
  scenes: BatchScene[]; round: number; operation?: string; displayName?: string;
  roundKeys?: string[]; mergeAttempts?: number; nextAttemptAt?: number; error?: string;
  result?: Record<string, unknown>; submissionUnknown?: boolean;
};
export const isTerminal = (job: GeminiBatchJob) => job.state === 'completed' || job.state === 'failed';
export function batchJobDirectory(id: string) {
  if (!/^[a-f0-9-]{36}$/.test(id)) throw new Error('Invalid Batch job ID');
  return path.join(BATCH_ROOT, id);
}
export async function readBatchJob(id: string): Promise<GeminiBatchJob> {
  return JSON.parse(await readFile(path.join(batchJobDirectory(id), 'job.json'), 'utf8'));
}
export async function saveBatchJob(job: GeminiBatchJob) {
  const dir = batchJobDirectory(job.id);
  await mkdir(dir, { recursive: true });
  job.updatedAt = new Date().toISOString();
  const temp = path.join(dir, `job-${randomUUID()}.tmp`);
  await writeFile(temp, JSON.stringify(job), { mode: 0o600 });
  await rename(temp, path.join(dir, 'job.json'));
}
export async function listBatchJobs(): Promise<GeminiBatchJob[]> {
  await mkdir(BATCH_ROOT, { recursive: true });
  const entries = await readdir(BATCH_ROOT);
  const jobs = await Promise.all(entries.filter(id => /^[a-f0-9-]{36}$/.test(id)).map(async id => {
    try { return await readBatchJob(id); } catch { return null; }
  }));
  return jobs.filter((job): job is GeminiBatchJob => !!job);
}
// A disk lease prevents duplicate workers across hot reloads and local Node processes.
// A crashed process can be reclaimed immediately; a live worker's lease never expires mid-save.
export async function withBatchLock<T>(name: string, fn: () => Promise<T>): Promise<T | undefined> {
  if (!/^[A-Za-z0-9_-]+$/.test(name)) throw new Error('Invalid Batch lock name');
  await mkdir(BATCH_ROOT, { recursive: true });
  const lock = path.join(BATCH_ROOT, `${name}.lock`);
  try { await mkdir(lock); } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
    try {
      const pid = Number(await readFile(path.join(lock, 'pid'), 'utf8'));
      if (!Number.isSafeInteger(pid) || pid <= 0) return;
      try { process.kill(pid, 0); return; } catch (probeError) {
        if ((probeError as NodeJS.ErrnoException).code !== 'ESRCH') return;
      }
      await rm(lock, { recursive: true, force: true });
    } catch (readError) {
      // Recover a process that crashed between mkdir and writing its PID.
      if ((readError as NodeJS.ErrnoException).code !== 'ENOENT') return;
      if (Date.now() - (await stat(lock)).mtimeMs < 30_000) return;
      await rm(lock, { recursive: true, force: true });
    }
    return withBatchLock(name, fn);
  }
  try {
    await writeFile(path.join(lock, 'pid'), String(process.pid));
    return await fn();
  } finally { await rm(lock, { recursive: true, force: true }); }
}
export function presetBatchSnapshot(preset: { provider: string; gemini: unknown; baserowFields: unknown }) {
  return JSON.stringify({ provider: preset.provider, gemini: normalizeGeminiTtsSettings(preset.gemini), fields: preset.baserowFields });
}
export async function fetchBatchScenes(videoId: number): Promise<Record<string, unknown>[]> {
  const base = process.env.BASEROW_API_URL;
  if (!base) throw new Error('Missing BASEROW_API_URL');
  const token = await getBaserowToken();
  const scenes: Record<string, unknown>[] = [];
  for (let page = 1; ; page++) {
    const params = new URLSearchParams({ filter__field_6889__equal: String(videoId), size: '200', page: String(page) });
    const response = await fetch(`${base.replace(/\/$/, '')}/database/rows/table/714/?${params}`, {
      headers: buildAuthHeader(token), cache: 'no-store', signal: AbortSignal.timeout(60_000),
    });
    if (!response.ok) throw new Error(`Batch scene lookup failed (${response.status})`);
    const payload = await response.json();
    if (!Array.isArray(payload.results)) throw new Error('Invalid Batch scene lookup');
    scenes.push(...payload.results);
    if (!payload.next) return scenes;
  }
}
export function sceneBatchInputs(row: Record<string, unknown>) {
  return Object.fromEntries(['order', 'field_6890', 'field_6886', 'field_7368'].map(key => [key, row[key] ?? null]));
}
export function assertBatchScene(job: GeminiBatchJob, expected: BatchScene, row: Record<string, unknown>) {
  if (Number(row.id) !== expected.id || String(row[String(job.step2.sourceTextFieldKey)] ?? '').trim() !== expected.text
      || JSON.stringify(row[String(job.step2.sceneDurationFieldKey)]) !== JSON.stringify(expected.duration)
      || JSON.stringify(sceneBatchInputs(row)) !== JSON.stringify(expected.inputs)) {
    throw new Error(`Batch scene ${expected.id} changed since submission; refusing to save stale audio. Start a new dubbing run after resolving the change.`);
  }
}
export async function assertBatchPreset(job: GeminiBatchJob) {
  const { entries } = await loadTtsAudioReferencesStore();
  const candidates = entries.filter(entry => entry.enabled && entry.language.toLowerCase() === job.language && (entry.provider === 'gemini' || entry.filename.trim()));
  const preset = candidates.find(entry => entry.isDefault) || candidates[0];
  if (!preset || preset.id !== job.presetId || presetBatchSnapshot(preset) !== job.presetSnapshot) {
    throw new Error('Language preset changed while the Gemini Batch job was pending; refusing to save stale audio.');
  }
}
export async function validateBatchImport(id: string, body: Record<string, unknown>, row: Record<string, unknown>) {
  const job = await readBatchJob(id);
  if (job.state !== 'processing' || body.provider !== 'gemini' || Number(body.videoId) !== job.videoId) throw new Error('Invalid Batch import');
  for (const key of ['sourceTextFieldKey', 'destinationAudioFieldKey', 'originalAudioFieldKey', 'sceneDurationFieldKey', 'language', 'includeHyperFramesSoundEffects', 'ttsSettings']) {
    if (JSON.stringify(body[key]) !== JSON.stringify(job.step2[key])) throw new Error(`Batch import configuration mismatch: ${key}`);
  }
  const scene = job.scenes.find(item => item.id === Number(row.id));
  if (!scene) throw new Error('Scene is not part of this Batch job');
  await assertBatchPreset(job);
  assertBatchScene(job, scene, row);
  if (scene.text && !scene.rawUrl) throw new Error(`Batch audio not ready for scene ${scene.id}`);
  return scene.rawUrl;
}
export function publicBatchJob(job: GeminiBatchJob) {
  return { id: job.id, videoId: job.videoId, language: job.language, state: job.state,
    completedScenes: job.scenes.filter(scene => scene.done || scene.existing).length,
    totalScenes: job.scenes.length, round: job.round, error: job.error,
    nextAttemptAt: job.nextAttemptAt, result: job.result, updatedAt: job.updatedAt };
}

export async function visibleBatchJobs() {
  const jobs = (await listBatchJobs()).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  return jobs.filter(job => !isTerminal(job) || job.state === 'failed' || Date.now() - Date.parse(job.updatedAt) < 86_400_000).slice(0, 30).map(publicBatchJob);
}
