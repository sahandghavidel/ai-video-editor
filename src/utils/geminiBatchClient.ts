export type GeminiBatchProgress = {
  id: string; videoId: number; language: string; state: string;
  completedScenes: number; totalScenes: number; round: number;
  error?: string; nextAttemptAt?: number; updatedAt: string;
  result?: Record<string, unknown>;
};
const pause = (ms = 5000) => new Promise(resolve => setTimeout(resolve, ms));
// Existing callers still receive a final HTTP Response. A 202 submission is never
// counted as a completed language, and a failed Batch blocks subsequent languages.
export async function fetchDubbedWithBatch(url: string, init: RequestInit): Promise<Response> {
  let response = await fetch(url, init);
  if (response.status !== 202) return response;
  let submitted = await response.json();
  while (submitted.queued === true) {
    const retrySeconds = Number(submitted.retryAfterSeconds || response.headers.get('Retry-After'));
    const retryAt = Date.parse(submitted.nextAttemptAt);
    const delay = Math.max(1000, Number.isFinite(retryAt) ? retryAt - Date.now() : 0,
      retrySeconds > 0 ? retrySeconds * 1000 : Number.isFinite(retryAt) ? 0 : 60_000);
    await pause(delay);
    init.signal?.throwIfAborted();
    response = await fetch(url, init);
    if (response.status !== 202) return response;
    submitted = await response.json();
  }
  if (typeof submitted.jobId !== 'string') return Response.json({ error: 'Missing Gemini Batch job ID', stopLanguageBatch: true }, { status: 502 });
  window.dispatchEvent(new Event('gemini-batch-updated'));
  for (;;) {
    await pause();
    try {
      const status = await fetch(`/api/gemini-tts-batches?id=${encodeURIComponent(submitted.jobId)}`, { cache: 'no-store' });
      if (status.status >= 500) continue;
      const payload = await status.json();
      if (!status.ok || !payload.job) return Response.json({ error: payload.error || 'Unable to find Batch job', stopLanguageBatch: true }, { status: 502 });
      const job: GeminiBatchProgress = payload.job;
      if (job.state === 'completed') return Response.json({ ...job.result, localSubtitle: submitted.localSubtitle, ok: true });
      if (job.state === 'cancelled') return Response.json({ error: job.error || 'Gemini Batch was cancelled', stopLanguageBatch: true, jobId: job.id }, { status: 409 });
      if (job.state === 'failed') return Response.json({ error: job.error || 'Gemini Batch failed', stopLanguageBatch: true, jobId: job.id }, { status: 502 });
    } catch {
      // Server restart / temporary offline period: keep this language pending.
      // The server's durable job resumes on the next successful status request.
    }
  }
}
