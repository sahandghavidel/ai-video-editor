'use client';

import { useEffect, useState } from 'react';
import type { Direction } from '@/lib/voice-scripts';
import type { WordFlag } from '@/lib/voice-transcript';

export function Delivery({ direction, busy, save }: { direction?: Direction; busy: boolean; save: (note: string, pause: number) => void }) {
  const [note, setNote] = useState(direction?.note || '');
  const [pause, setPause] = useState(String(direction?.pause || 0));
  const changed = note !== (direction?.note || '') || Number(pause) !== (direction?.pause || 0);
  return <form className="space-y-2 rounded-xl border bg-slate-50 p-3" onSubmit={e => { e.preventDefault(); save(note, Number(pause)); }}>
    <label className="block text-sm font-semibold">Delivery note<textarea value={note} onChange={e => setNote(e.target.value)} rows={2}
      className="mt-1 w-full rounded-md border bg-white p-2 font-normal" placeholder="Pronunciation or pacing notes" /></label>
    <div className="flex flex-wrap items-center justify-between gap-2"><label className="text-sm">Pause after (s) <input type="number" min={0} max={3600} step="any" required
      className="w-20 rounded border bg-white p-1.5" value={pause} onChange={e => setPause(e.target.value)}/></label>
      <button disabled={busy || !changed} className="rounded border bg-white px-3 py-1.5 text-sm disabled:opacity-40">Save delivery</button></div>
  </form>;
}

export function TranscriptCheck({ folder, id, seek }: { folder: string; id: string; seek: (start: number) => void }) {
  const [flags, setFlags] = useState<WordFlag[]>([]);
  const [message, setMessage] = useState('Checking saved transcript…');
  useEffect(() => {
    const abort = new AbortController();
    (async () => {
      const result = await fetch('/api/voice-manager?' + new URLSearchParams({ folder, transcript: id }), { signal: abort.signal });
      if (!result.ok) throw Error('Saved transcript unavailable for this take.');
      const data: WordFlag[] = await result.json();
      if (!abort.signal.aborted) { setFlags(data); setMessage(data.length ? 'Possible word differences' : 'Transcript matches the sentence.'); }
    })().catch(e => { if (!abort.signal.aborted) setMessage(String(e)); });
    return () => abort.abort();
  }, [folder, id]);
  return <div className="space-y-2 text-sm"><p>{message}</p><div className="flex flex-wrap gap-2">{flags.map((flag, i) =>
    <button key={i} className="rounded-full bg-amber-100 px-2.5 py-1 text-amber-900" onClick={() => seek(flag.start)}>{flag.kind} · {flag.word}</button>)}</div></div>;
}
