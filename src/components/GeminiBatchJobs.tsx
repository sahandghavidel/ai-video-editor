'use client';
import { useEffect } from 'react';
import type { GeminiBatchProgress } from '@/utils/geminiBatchClient';

export default function GeminiBatchJobs({ initialJobs }: { initialJobs: GeminiBatchProgress[] }) {
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
    if (hasPendingJobs) void refresh();
    const onUpdate = () => { hasPendingJobs = true; void refresh(); };
    window.addEventListener('gemini-batch-updated', onUpdate);
    return () => { active = false; if (timer) clearTimeout(timer); window.removeEventListener('gemini-batch-updated', onUpdate); };
  }, [initialJobs]);
  // Keep recovery/status tracking without displaying a floating notification.
  return null;
}
