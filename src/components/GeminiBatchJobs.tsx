'use client';
import { useEffect, useState } from 'react';
import type { GeminiBatchProgress } from '@/utils/geminiBatchClient';

export default function GeminiBatchJobs({ initialJobs }: { initialJobs: GeminiBatchProgress[] }) {
  const [jobs, setJobs] = useState<GeminiBatchProgress[]>(initialJobs);
  const [error, setError] = useState('');
  useEffect(() => {
    let active = true;
    let loading = false;
    let hasPendingJobs = initialJobs.some(job => job.state !== 'completed' && job.state !== 'failed');
    let refreshRequested = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const refresh = async () => {
      if (!active) return;
      if (loading) { refreshRequested = true; return; }
      if (timer) clearTimeout(timer);
      loading = true;
      try {
        const response = await fetch('/api/gemini-tts-batches', { cache: 'no-store' });
        if (response.ok) {
          const payload = await response.json();
          const nextJobs: GeminiBatchProgress[] = Array.isArray(payload.jobs) ? payload.jobs : [];
          hasPendingJobs = nextJobs.some(job => job.state !== 'completed' && job.state !== 'failed');
          if (active) setJobs(nextJobs);
        }
      } catch { /* Retry connectivity failures only while a known job is pending. */ }
      finally {
        loading = false;
        if (active && (refreshRequested || hasPendingJobs)) {
          const delay = refreshRequested ? 0 : 10_000;
          refreshRequested = false;
          timer = setTimeout(() => void refresh(), delay);
        }
      }
    };
    // The server supplies existing jobs with the page, avoiding even a discovery
    // HTTP request when idle (including reloads and development remounts).
    setJobs(initialJobs);
    if (hasPendingJobs) void refresh();
    const onUpdate = () => { hasPendingJobs = true; void refresh(); };
    window.addEventListener('gemini-batch-updated', onUpdate);
    return () => { active = false; if (timer) clearTimeout(timer); window.removeEventListener('gemini-batch-updated', onUpdate); };
  }, [initialJobs]);
  const retry = async (id: string) => {
    setError('');
    try {
      const response = await fetch('/api/gemini-tts-batches', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id }) });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || 'Retry failed');
      setJobs(current => current.map(job => job.id === id ? payload.job : job));
      window.dispatchEvent(new Event('gemini-batch-updated'));
    } catch (error) { setError(error instanceof Error ? error.message : 'Retry failed'); }
  };
  if (!jobs.length) return null;
  return <aside aria-label='Gemini Batch jobs' className='fixed bottom-4 right-4 z-40 w-80 max-h-72 overflow-auto rounded-lg border border-blue-200 bg-white p-3 text-sm shadow-lg'>
    <p className='font-semibold text-gray-900'>Gemini Batch dubbing</p>
    <p className='mb-2 text-xs text-gray-600'>Pending jobs resume when this application is running.</p>
    {jobs.map(job => <div key={job.id} className='border-t py-2'>
      <p className='font-medium text-gray-900'>Video #{job.videoId} · {job.language.toUpperCase()}</p>
      <p className='text-gray-700'>{job.state} · {job.completedScenes}/{job.totalScenes} scenes saved</p>
      {job.nextAttemptAt && <p className='text-xs text-gray-600'>Next attempt: {new Date(job.nextAttemptAt).toLocaleTimeString()}</p>}
      {job.error && <p className='mt-1 text-xs text-red-700'>{job.error}</p>}
      {job.state === 'failed' && <button onClick={() => void retry(job.id)} className='mt-1 rounded border px-2 py-1 text-blue-700'>Retry unfinished scenes</button>}
    </div>)}
    {error && <p role='alert' className='text-xs text-red-700'>{error}</p>}
  </aside>;
}
