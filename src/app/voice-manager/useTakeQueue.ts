'use client';

import { useEffect, useRef, useState } from 'react';
import type { VoiceGroup } from '@/lib/voice-manager';

type Job = { voiceID: string; text: string; regenerate: boolean };
export const jobKey = (voiceID: string, text: string) => JSON.stringify([voiceID, text]);

export function useTakeQueue(onGroup: (group: VoiceGroup) => void) {
  const queue = useRef<Job[]>([]);
  const pending = useRef(new Set<string>());
  const running = useRef(false);
  const mounted = useRef(true);
  const [keys, setKeys] = useState<string[]>([]);
  const [fresh, setFresh] = useState<Record<string, string>>({});
  const [message, setMessage] = useState('');
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; queue.current = []; };
  }, []);
  async function enqueue(jobs: Job[]) {
    for (const job of jobs) {
      const key = jobKey(job.voiceID, job.text);
      if (pending.current.has(key)) continue;
      pending.current.add(key);
      queue.current.push(job);
    }
    setKeys([...pending.current]);
    if (running.current) return;
    running.current = true;
    let generated = 0, reused = 0;
    const failures: string[] = [];
    while (queue.current.length && mounted.current) {
      const job = queue.current.shift()!;
      const key = jobKey(job.voiceID, job.text);
      setMessage('Generating · ' + job.text);
      try {
        const res = await fetch('/api/voice-manager', { method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: job.regenerate ? 'generate' : 'prepareSentence', voiceID: job.voiceID, text: job.text }) });
        const result = await res.json();
        if (!res.ok || !result.group) throw Error(result.error || 'Generation failed');
        if (mounted.current) {
          onGroup(result.group);
          if (result.id) setFresh(current => ({ ...current, [key]: result.id }));
        }
        if (result.reused) reused++; else generated++;
      } catch (e) { failures.push(job.text + ' — ' + String(e)); }
      finally {
        pending.current.delete(key);
        if (mounted.current) setKeys([...pending.current]);
      }
    }
    running.current = false;
    if (mounted.current) setMessage(`Generated ${generated} · Reused ${reused}` + (failures.length ? ' · Failed: ' + failures.join(' / ') : ''));
  }
  return { enqueue, keys, fresh, message };
}
