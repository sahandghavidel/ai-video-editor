'use client';

import { useMemo, useState } from 'react';
import type { VoiceScript } from '@/lib/voice-scripts';
import { replacementPlan } from '@/lib/voice-script-ranges';

export default function FindReplace({ script, busy, apply, close }: {
  script: VoiceScript; busy: boolean; apply: (find: string, replacement: string) => void; close: () => void;
}) {
  const [find, setFind] = useState('');
  const [replacement, setReplacement] = useState('');
  const changes = useMemo(() => replacementPlan(script, find, replacement), [script, find, replacement]);
  return <form className="space-y-3 rounded-xl border bg-slate-50 p-4" onSubmit={e => { e.preventDefault(); apply(find, replacement); }}>
    <h3 className="font-semibold">Find and replace</h3>
    <div className="flex flex-wrap gap-2">
      <input aria-label="Find exact text" placeholder="Find exact text" autoFocus className="rounded border p-2" value={find} onChange={e => setFind(e.target.value)} />
      <input aria-label="Replace with" placeholder="Replace with" className="rounded border p-2" value={replacement} onChange={e => setReplacement(e.target.value)} />
      <button disabled={busy || !changes.length} className="rounded bg-blue-700 px-3 text-sm text-white disabled:opacity-40">Apply to {changes.length} sentences</button>
      <button type="button" disabled={busy} onClick={close}>Cancel</button>
    </div>
    <ul className="max-h-48 space-y-2 overflow-auto text-sm">{changes.map(c =>
      <li key={c.index}><strong>Sentence {c.index + 1}</strong><div><del className="text-slate-500">{c.before}</del></div><ins className="text-emerald-800">{c.after}</ins></li>)}</ul>
  </form>;
}
