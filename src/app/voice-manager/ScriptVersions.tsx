'use client';

import { useState } from 'react';
import type { VoiceScript } from '@/lib/voice-scripts';

export default function ScriptVersions({ script, busy, save, restore }: { script: VoiceScript; busy: boolean; save: (name: string) => void; restore: (id: string) => void }) {
  const [name, setName] = useState('');
  const [id, setID] = useState('');
  const versions = script.versions || [];
  const version = versions.find(v => v.id === id) || versions.at(-1);
  return <section className="space-y-3 rounded-xl border bg-slate-50 p-4">
    <h3 className="font-semibold">Named script versions</h3>
    <form className="flex flex-wrap gap-2" onSubmit={e => { e.preventDefault(); save(name); }}>
      <input aria-label="Version name" placeholder="Version name" className="rounded border p-2" value={name} onChange={e => setName(e.target.value)} />
      <button className="rounded border bg-white px-3 disabled:opacity-40" disabled={busy || !name.trim()}>Save version</button></form>
    {version && <><div className="flex flex-wrap gap-2"><select aria-label="Compare saved version" value={version.id} onChange={e => setID(e.target.value)} className="rounded border p-2">
      {versions.map(v => <option value={v.id} key={v.id}>{v.name} · {new Date(v.date).toLocaleString()}</option>)}</select>
      <button className="rounded border bg-white px-3" disabled={busy} onClick={() => restore(version.id)}>Restore version</button></div>
      <div className="grid max-h-60 grid-cols-2 gap-3 overflow-auto text-sm">{[version.snapshot, script].map((s, side) =>
        <div key={side}><strong>{side ? 'Current script' : version.name}</strong><ol className="list-decimal pl-6">{s.sentences.map((line, i) =>
          <li key={i} className={line !== (side ? version.snapshot : script).sentences[i] ? 'bg-amber-100 py-1' : 'py-1'}>{line}</li>)}</ol></div>)}</div></>}
  </section>;
}
