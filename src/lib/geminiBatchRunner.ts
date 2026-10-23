import { randomUUID } from 'crypto';
import { writeFile, rename, access } from 'fs/promises';
import path from 'path';
import { Agent } from 'undici';
import { uploadToMinio } from '@/utils/ffmpeg-direct';
import { BatchApiError, createGeminiBatch, decodeBatchAudio, googleBatchRequest, validateOperationName } from '@/lib/geminiBatchApi';
import {
  assertBatchPreset, assertBatchScene, batchJobDirectory, fetchBatchScenes, isTerminal,
  listBatchJobs, readBatchJob, saveBatchJob, withBatchLock,
  type GeminiBatchJob,
} from '@/lib/geminiBatchStore';

const dispatcher = new Agent({ headersTimeout: 0, bodyTimeout: 0 });
const globals = globalThis as typeof globalThis & { geminiBatchTimers?: Map<string, ReturnType<typeof setTimeout>> };
const timers = globals.geminiBatchTimers ??= new Map();
function safeError(error: unknown) {
  let message = error instanceof Error ? error.message : String(error);
  for (const key of [process.env.GEMINI_API_KEY, process.env.GOOGLE_API_KEY]) if (key?.trim()) message = message.replaceAll(key.trim(), '[REDACTED]');
  return message;
}
function log(job: GeminiBatchJob, message: string, extra: Record<string, unknown> = {}) {
  console.info('[Gemini Batch]', JSON.stringify({ jobId: job.id, videoId: job.videoId, language: job.language, state: job.state, message, ...extra }));
}
async function localPost(job: GeminiBatchJob, route: string, body: unknown) {
  const response = await fetch(`${job.origin}${route}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    dispatcher, signal: AbortSignal.timeout(3_600_000),
  } as RequestInit & { dispatcher: Agent });
  const payload = await response.json();
  if (!response.ok || payload.ok !== true || Number(payload.failureCount || 0) > 0) {
    throw new Error(`${route} (${response.status}): ${payload.error || JSON.stringify(payload.failures) || 'Unsuccessful result'}`);
  }
  return payload;
}
async function validateCurrentJob(job: GeminiBatchJob) {
  await assertBatchPreset(job);
  const rows = await fetchBatchScenes(job.videoId);
  if (rows.length !== job.scenes.length) throw new Error('Video scene list changed while Batch was pending; merge blocked.');
  const byId = new Map(rows.map(row => [Number(row.id), row]));
  for (const scene of job.scenes) {
    const row = byId.get(scene.id);
    if (!row) throw new Error(`Batch scene ${scene.id} no longer belongs to video ${job.videoId}`);
    assertBatchScene(job, scene, row);
  }
  return byId;
}
async function reconcileSubmission(job: GeminiBatchJob) {
  // A create call has no idempotency key. After an uncertain response, discover by
  // our persisted unique display name instead of creating a second paid job.
  let pageToken = '';
  do {
    const payload = await googleBatchRequest(`batches?${new URLSearchParams({ pageSize: '100', ...(pageToken ? { pageToken } : {}) })}`);
    const matches = (payload.batches || payload.operations || []).filter((item: { displayName?: string; metadata?: { displayName?: string } }) =>
      (item.displayName || item.metadata?.displayName) === job.displayName);
    if (matches.length > 1) throw new Error('Multiple Google Batch operations matched the submission; manual review required.');
    if (matches.length === 1) {
      job.operation = validateOperationName(matches[0].name);
      job.submissionUnknown = false; job.state = 'waiting';
      job.error = undefined; await saveBatchJob(job); return;
    }
    pageToken = payload.nextPageToken || '';
  } while (pageToken);
  job.submissionUnknown = true;
  job.error = 'Waiting to reconcile Google submission acknowledgement. No duplicate job will be submitted.';
  job.nextAttemptAt = Date.now() + 60_000;
  await saveBatchJob(job);
}
export async function advanceBatchJob(job: GeminiBatchJob) {
  if (job.nextAttemptAt && Date.now() < job.nextAttemptAt) return;
  job.nextAttemptAt = undefined;
  await validateCurrentJob(job);
  if (job.state === 'submitting') { await reconcileSubmission(job); return; }
  if (job.state === 'queued') {
    const pending = job.scenes.filter(scene => !scene.existing && !scene.done && scene.text && !scene.rawFile);
    if (!pending.length) { job.state = 'processing'; await saveBatchJob(job); }
    else {
      job.roundKeys = pending.map(scene => scene.key);
      job.displayName = `tts-${job.id}-round-${job.round}-${randomUUID().slice(0, 8)}`;
      // Validate request before persisting the uncertain submission boundary.
      const { buildGeminiBatchRequest } = await import('@/lib/geminiBatchApi');
      buildGeminiBatchRequest(job);
      job.state = 'submitting'; await saveBatchJob(job);
      log(job, 'Submitting scenes', { scenes: pending.map(scene => scene.id), round: job.round });
      try {
        const operation = await createGeminiBatch(job);
        job.operation = validateOperationName(operation.name);
        job.state = 'waiting'; job.error = undefined;
      } catch (error) {
        if (error instanceof BatchApiError && error.status >= 400 && error.status < 500 && error.status !== 408) {
          if (error.status !== 429 || job.round >= 2) throw error;
          job.round++; job.state = 'queued'; job.nextAttemptAt = Date.now() + 60_000;
          job.error = safeError(error);
        } else {
          // Network/5xx/invalid acknowledgement may mean Google accepted it.
          job.submissionUnknown = true; job.error = safeError(error); job.nextAttemptAt = Date.now() + 60_000;
        }
      }
      await saveBatchJob(job); return;
    }
  }
  if (job.state === 'waiting') {
    const operation = await googleBatchRequest(validateOperationName(job.operation));
    const state = operation.metadata?.state || operation.state;
    if (!operation.done && !['BATCH_STATE_SUCCEEDED', 'BATCH_STATE_FAILED', 'BATCH_STATE_CANCELLED', 'BATCH_STATE_EXPIRED'].includes(state)) return;
    const results = operation.response?.inlinedResponses?.inlinedResponses
      || operation.metadata?.output?.inlinedResponses?.inlinedResponses || [];
    const expected = new Set(job.roundKeys || []);
    const seen = new Set<string>();
    // Validate every key before importing anything. Google order is irrelevant.
    for (const result of results) {
      const key = result.metadata?.key;
      if (!expected.has(key) || seen.has(key)) throw new Error('Google Batch returned unknown or duplicate scene keys; import blocked.');
      seen.add(key);
    }
    for (const scene of job.scenes.filter(scene => expected.has(scene.key))) {
      if (scene.rawFile) continue;
      const result = results.find((item: { metadata?: { key?: string } }) => item.metadata?.key === scene.key);
      try {
        if (!result?.response || result.error) throw new Error(String(result?.error?.message || operation.error?.message || 'Missing audio result'));
        const buffer = decodeBatchAudio(result.response);
        const filename = `scene-${scene.id}.wav`;
        const target = path.join(batchJobDirectory(job.id), filename);
        await writeFile(`${target}.tmp`, buffer, { mode: 0o600 });
        await rename(`${target}.tmp`, target);
        scene.rawFile = filename; scene.error = undefined;
        await saveBatchJob(job);
      } catch (error) { scene.error = safeError(error); }
    }
    job.operation = undefined;
    const missing = job.scenes.filter(scene => expected.has(scene.key) && !scene.rawFile);
    if (missing.length) {
      log(job, 'Generation failed; retrying only missing scenes after 60 seconds', { sceneIds: missing.map(scene => scene.id), failures: missing.map(scene => scene.error) });
      if (job.round >= 2) throw new Error(`Batch generation failed after two recovery rounds: ${missing.map(scene => `${scene.id}: ${scene.error}`).join('; ')}`);
      job.round++; job.state = 'queued'; job.nextAttemptAt = Date.now() + 60_000;
      await saveBatchJob(job); return;
    }
    job.state = 'processing'; await saveBatchJob(job);
  }
  if (job.state === 'processing') {
    // Keep FFmpeg/MinIO work bounded, independent of Standard Gemini concurrency.
    const configured = Number(process.env.GEMINI_TTS_BATCH_PROCESSING_CONCURRENCY || 2);
    const concurrency = Number.isInteger(configured) ? Math.max(1, Math.min(4, configured)) : 2;
    const pending = job.scenes.filter(scene => !scene.existing && !scene.done);
    let cursor = 0;
    let writes = Promise.resolve();
    const checkpoint = () => (writes = writes.then(() => saveBatchJob(job)));
    await Promise.all(Array.from({ length: Math.min(concurrency, pending.length) }, async () => {
      while (cursor < pending.length) {
        const scene = pending[cursor++];
        try {
          if (scene.text && !scene.rawUrl) {
            if (!scene.rawFile) throw new Error('Generated audio is missing');
            const local = path.join(batchJobDirectory(job.id), scene.rawFile);
            await access(local);
            scene.rawUrl = await uploadToMinio(local, `video_${job.videoId}_scene_${scene.id}_tts_batch_${job.id}.wav`, 'audio/wav');
            await checkpoint();
          }
          const result = await localPost(job, '/api/generate-scene-tts-by-field', {
            ...job.step2, geminiBatchJobId: job.id, onlySceneIds: [scene.id], skipIfDestinationExists: false,
          });
          if (Number(result.generatedCount || 0) + Number(result.silentGeneratedCount || 0) + Number(result.skippedExistingCount || 0) < 1) throw new Error('Scene was not saved');
          scene.done = true; scene.error = undefined;
          log(job, 'Scene saved', { sceneId: scene.id });
        } catch (error) {
          scene.attempts = (scene.attempts || 0) + 1; scene.error = safeError(error);
          log(job, 'Scene processing failed', { sceneId: scene.id, attempt: scene.attempts, error: scene.error });
        }
        await checkpoint();
      }
    }));
    const failed = job.scenes.filter(scene => !scene.existing && !scene.done);
    if (failed.length) {
      if (failed.some(scene => (scene.attempts || 0) >= 3)) throw new Error(`Batch scene processing failed after two retries: ${failed.map(scene => `${scene.id}: ${scene.error}`).join('; ')}`);
      job.nextAttemptAt = Date.now() + 60_000; await saveBatchJob(job); return;
    }
    job.state = 'merging'; await saveBatchJob(job);
  }
  if (job.state === 'merging') {
    await validateCurrentJob(job);
    try {
      job.result = await localPost(job, '/api/merge-dubbed-audio-by-field', job.merge);
    } catch (error) {
      job.mergeAttempts = (job.mergeAttempts || 0) + 1;
      if (job.mergeAttempts >= 3) throw error;
      job.error = safeError(error); job.nextAttemptAt = Date.now() + 60_000;
      await saveBatchJob(job); log(job, 'Merge/save failed; retrying after 60 seconds', { attempt: job.mergeAttempts, error: job.error });
      return;
    }
    job.result = { ...job.result, videoId: job.videoId, language: job.language, geminiBatchJobId: job.id };
    job.state = 'completed'; job.error = undefined;
    await saveBatchJob(job); log(job, 'Completed and merged');
  }
}
export function scheduleBatchJob(id: string, delay = 0) {
  if (timers.has(id)) return;
  const timer = setTimeout(async () => {
    try {
      await withBatchLock(id, async () => {
        const job = await readBatchJob(id);
        if (isTerminal(job)) return;
        try { await advanceBatchJob(job); }
        catch (error) {
          const message = safeError(error);
          // Temporary status/lookup failures retain the operation; POSTs are never repeated blindly.
          if ((job.state === 'waiting' || job.state === 'submitting') && (error instanceof TypeError || (error instanceof Error && error.name === 'TimeoutError') || (error instanceof BatchApiError && (error.status === 429 || error.status >= 500)))) {
            job.error = message; job.nextAttemptAt = Date.now() + 60_000;
          } else { job.state = 'failed'; job.error = message; }
          await saveBatchJob(job); log(job, 'Job error', { error: message });
        }
      });
    } catch (error) { console.error('[Gemini Batch] Worker error:', safeError(error)); }
    finally {
      timers.delete(id);
      try {
        const job = await readBatchJob(id);
        if (!isTerminal(job)) scheduleBatchJob(id, Math.max(15_000, (job.nextAttemptAt || 0) - Date.now()));
      } catch { /* Removed/incomplete runtime record; no new paid work. */ }
    }
  }, delay);
  timer.unref?.(); timers.set(id, timer);
}
export async function resumeBatchJobs() {
  for (const job of await listBatchJobs()) if (!isTerminal(job)) scheduleBatchJob(job.id);
}
export async function createOrResumeBatchJob(input: Omit<GeminiBatchJob, 'id' | 'state' | 'createdAt' | 'updatedAt' | 'round'>) {
  const result = await withBatchLock(`video-${input.videoId}-${input.language}`, async () => {
    const existing = (await listBatchJobs()).find(job => job.videoId === input.videoId && job.language === input.language && !isTerminal(job));
    if (existing) { scheduleBatchJob(existing.id); return existing; }
    const now = new Date().toISOString();
    const job: GeminiBatchJob = { ...input, id: randomUUID(), state: 'queued', createdAt: now, updatedAt: now, round: 0 };
    await saveBatchJob(job); scheduleBatchJob(job.id); return job;
  });
  if (!result) throw new Error('Another request is preparing this language Batch job. Please retry shortly.');
  return result;
}
