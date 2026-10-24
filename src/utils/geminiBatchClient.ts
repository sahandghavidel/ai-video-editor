export type GeminiBatchProgress = {
  id: string; videoId: number; language: string; state: string;
  completedScenes: number; totalScenes: number; round: number;
  error?: string; nextAttemptAt?: number; updatedAt: string;
  result?: Record<string, unknown>;
};
const pause = () => new Promise(resolve => setTimeout(resolve, 5000));
// Existing callers still receive a final HTTP Response. A 202 submission is never
// counted as a completed language, and a failed Batch blocks subsequent languages.
export async function fetchDubbedWithBatch(url: string, init: RequestInit): Promise<Response> {
  const response = await fetch(url, init);
  if (response.status !== 202) return response;
  const submitted = await response.json();
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
      if (job.state === 'completed') return Response.json({ ...job.result, ok: true });
      if (job.state === 'cancelled') return Response.json({ error: job.error || 'Gemini Batch was cancelled', stopLanguageBatch: true, jobId: job.id }, { status: 409 });
      if (job.state === 'failed') return Response.json({ error: job.error || 'Gemini Batch failed', stopLanguageBatch: true, jobId: job.id }, { status: 502 });
    } catch {
      // Server restart / temporary offline period: keep this language pending.
      // The server's durable job resumes on the next successful status request.
    }
  }
}
