'use client';
import { useEffect, useState } from 'react';
import type { CodexFixEnglishJob } from '@/lib/codexFixEnglishJobs';
import { CODEX_ENGLISH_JOB_EVENT, CODEX_ENGLISH_JOB_KEY } from '@/utils/codexFixEnglishClient';

export default function CodexFixEnglishStatus() {
  const [job, setJob] = useState<CodexFixEnglishJob | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    let disposed = false;
    let generation = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const refresh = async () => {
      clearTimeout(timer);
      const requestGeneration = ++generation;
      const id = localStorage.getItem(CODEX_ENGLISH_JOB_KEY);
      if (!id) { setJob(null); return; }
      try {
        const res = await fetch(`/api/codex-fix-english/jobs/${encodeURIComponent(id)}`, { cache: 'no-store' });
        if (!res.ok) throw new Error('Unable to read Codex status');
        const data = await res.json();
        if (disposed || requestGeneration !== generation || localStorage.getItem(CODEX_ENGLISH_JOB_KEY) !== id) return;
        setJob(data.job); setError('');
        if (['queued', 'running'].includes(data.job.state)) timer = setTimeout(() => { void refresh(); }, 2500);
      } catch {
        if (!disposed && requestGeneration === generation) { setError('Unable to read Codex status. The pipeline will not advance without verification.'); timer = setTimeout(() => { void refresh(); }, 5000); }
      }
    };
    const wake = () => { void refresh(); };
    wake();
    window.addEventListener(CODEX_ENGLISH_JOB_EVENT, wake);
    return () => { disposed = true; clearTimeout(timer); window.removeEventListener(CODEX_ENGLISH_JOB_EVENT, wake); };
  }, []);
  if (!job && !error) return null;
  const active = job && ['queued', 'running'].includes(job.state);
  const acknowledge = async () => {
    if (!job) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/codex-fix-english/jobs/${job.id}/cancel`, { method: 'POST' });
      if (!res.ok) throw new Error('Unable to cancel or acknowledge job');
      if (!active) { localStorage.removeItem(CODEX_ENGLISH_JOB_KEY); setJob(null); }
      window.dispatchEvent(new Event(CODEX_ENGLISH_JOB_EVENT));
    } catch { setError('Unable to cancel or acknowledge Codex job.'); } finally { setBusy(false); }
  };
  return <div className='col-span-full mt-3 rounded border border-purple-200 bg-white p-3 text-sm' role='status'>
    {job && <>
      <p>Codex Fix English · Video #{job.videoId} · {job.phase}</p>
      {job.result && <p>Reviewed {job.result.reviewedScenes} scenes · Changed {job.result.changedScenes} · Saved and verified</p>}
      {job.result?.issues.map((issue, i) => <p key={i} className='text-amber-700'>{issue}</p>)}
      {job.error && <p className='text-red-600'>{job.error}</p>}
      <button type='button' disabled={busy} onClick={() => { void acknowledge(); }} className='mt-2 rounded border px-2 py-1 disabled:opacity-50'>
        {active ? 'Cancel Codex job' : job.state === 'completed' ? 'Dismiss' : 'I reviewed the result — allow a new run'}
      </button>
    </>}
    {error && <p className='text-red-600'>{error}</p>}
  </div>;
}
