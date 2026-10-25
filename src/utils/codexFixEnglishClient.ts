import type { CodexFixEnglishJob } from '@/lib/codexFixEnglishJobs';
export const CODEX_ENGLISH_JOB_KEY = 'codexFixEnglishActiveJob';
export const CODEX_ENGLISH_JOB_EVENT = 'codex-fix-english-job';
export function rememberCodexEnglishJob(id: string) {
  localStorage.setItem(CODEX_ENGLISH_JOB_KEY, id);
  window.dispatchEvent(new Event(CODEX_ENGLISH_JOB_EVENT));
}
export function assertCodexEnglishComplete(job: CodexFixEnglishJob, videoId: number) {
  if (job.videoId !== videoId) throw new Error('Codex returned a different video ID');
  if (job.state === 'completed') {
    if (job.result?.verified !== true) throw new Error('Codex completion was not verified');
    return true;
  }
  if (['failed', 'cancelled', 'interrupted'].includes(job.state)) {
    throw new Error(job.error || `Codex job ${job.state}`);
  }
  return false;
}
export async function runCodexFixEnglish(videoId: number, onProgress: (job: CodexFixEnglishJob) => void) {
  const response = await fetch('/api/codex-fix-english', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ videoId }),
  });
  const started = await response.json();
  if (!response.ok || typeof started.jobId !== 'string' || !started.job) throw new Error(started.error || 'Unable to start Codex');
  rememberCodexEnglishJob(started.jobId);
  let job: CodexFixEnglishJob = started.job;
  let failures = 0;
  for (;;) {
    onProgress(job);
    if (assertCodexEnglishComplete(job, videoId)) return job.result!;
    await new Promise(resolve => setTimeout(resolve, 2000));
    try {
      const status = await fetch(`/api/codex-fix-english/jobs/${encodeURIComponent(started.jobId)}`, { cache: 'no-store' });
      if (!status.ok) throw new Error('Unable to read Codex job');
      const data = await status.json();
      if (!data.job || data.job.id !== started.jobId) throw new Error('Invalid Codex job response');
      job = data.job; failures = 0;
    } catch {
      failures++;
      if (failures >= 15) throw new Error('Codex status could not be read. Pipeline stopped; the background job may still be running. Reconnect before retrying.');
    }
  }
}
