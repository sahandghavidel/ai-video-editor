'use client';

import { useEffect, useState } from 'react';
import type { VoiceGroup } from '@/lib/voice-manager';
import TakePreview from './TakePreview';
import type { VoiceScript } from '@/lib/voice-scripts';

const statusStyles = {
  'Needs audio': 'bg-slate-100 text-slate-700',
  'Awaiting approval': 'bg-amber-100 text-amber-900',
  'Approved': 'bg-emerald-100 text-emerald-800',
  'Needs review': 'bg-rose-100 text-rose-800',
};
type LineStatus = keyof typeof statusStyles;
const api = '/api/voice-manager';
const button = 'rounded-lg border border-blue-200 bg-white px-3 py-2 text-sm font-medium text-blue-700 disabled:opacity-40';

async function post(data: Record<string, unknown>) {
  const res = await fetch(api, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) });
  const result = await res.json();
  if (!res.ok) throw Error(result.error || 'Voice operation failed.');
  return result;
}

type Props = {
  groups: VoiceGroup[];
  presets: { id: string; name: string }[];
  busy: boolean;
  setBusy: (busy: boolean) => void;
  onGroup: (group: VoiceGroup) => void;
};

export default function ScriptReview({ groups, presets, busy, setBusy, onGroup }: Props) {
  const [scripts, setScripts] = useState<VoiceScript[]>([]);
  const [selected, setSelected] = useState('');
  const [adding, setAdding] = useState(false);
  const [title, setTitle] = useState('');
  const [text, setText] = useState('');
  const [preset, setPreset] = useState('');
  const [status, setStatus] = useState('');
  const [filter, setFilter] = useState<LineStatus | 'All'>('All');
  const [query, setQuery] = useState('');
  function resetFilters() { setFilter('All'); setQuery(''); }
  const [working, setWorking] = useState(false);
  const locked = busy || working;
  const voiceID = preset || presets[0]?.id;
  const script = scripts.find(s => s.id === selected);
  useEffect(() => {
    let active = true;
    (async () => {
      const res = await fetch(api + '?scripts=1', { cache: 'no-store' });
      if (!res.ok) throw Error('Could not open saved scripts.');
      const items: VoiceScript[] = await res.json();
      if (active) { setScripts(items); setSelected(items[0]?.id || ''); }
    })().catch(e => { if (active) setStatus(String(e)); });
    return () => { active = false; };
  }, []);

  const byText = new Map(groups.filter(g => g.voiceID === script?.voiceID).map(g => [g.narration, g]));
  const lines = (script?.sentences || []).map((line, index) => {
    const group = byText.get(line);
    const take = group?.takes.find(t => t.status === 'Current approval') || group?.takes.find(t => t.status === 'Previously approved') || group?.takes[0];
    const state: LineStatus = group?.issue ? 'Needs review' : !take ? 'Needs audio' : take.status === 'Unapproved' ? 'Awaiting approval' : 'Approved';
    return { line, index, group, take, state };
  });
  const counts = { 'Needs audio': 0, 'Awaiting approval': 0, Approved: 0, 'Needs review': 0 };
  for (const row of lines) counts[row.state]++;
  const visible = lines.filter(row => (filter === 'All' || row.state === filter) && row.line.toLowerCase().includes(query.trim().toLowerCase()));
  const missing = [...new Set(lines.filter(row => row.state === 'Needs audio').map(row => row.line))];

  async function run(job: () => Promise<void>) {
    setWorking(true); setBusy(true); setStatus('');
    try { await job(); } catch (e) { setStatus(String(e)); }
    finally { setWorking(false); setBusy(false); }
  }
  function save() {
    return run(async () => {
      const item: VoiceScript = await post({ action: 'addScript', title, text, voiceID });
      resetFilters(); setScripts(all => [item, ...all]); setSelected(item.id); setAdding(false); setTitle(''); setText('');
      setStatus('Script saved. Review its sentences below.');
    });
  }
  function generate() {
    if (!script) return;
    return run(async () => {
      let generated = 0;
      for (const [i, sentence] of missing.entries()) {
        setStatus(`Preparing ${i + 1} of ${missing.length} · ${sentence}`);
        const result = await post({ action: 'prepareSentence', text: sentence, voiceID: script.voiceID });
        onGroup(result.group);
        if (!result.reused) generated++;
      }
      setStatus(`Script ready for review. Generated ${generated} new takes.`);
    });
  }

  return <section className="space-y-5 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:p-6">
    <div className="flex flex-wrap items-center gap-3"><h2 className="mr-auto text-xl font-semibold tracking-tight">Script review</h2>
      {scripts.length > 0 && <select aria-label="Saved script" className="max-w-full rounded-lg border p-2" disabled={locked} value={selected}
        onChange={e => { resetFilters(); setSelected(e.target.value); setAdding(false); setStatus(''); }}>
        {scripts.map(s => <option key={s.id} value={s.id}>{s.title}</option>)}</select>}
      <button className={button} disabled={locked || adding} onClick={() => { setAdding(true); setStatus(''); }}>Add script</button>
    </div>
    {!adding && !scripts.length && <p className="text-sm text-slate-600">Add a narration script to generate missing audio and review its sentences in order.</p>}
    {adding && <form className="space-y-2" onSubmit={e => { e.preventDefault(); void save(); }}>
      <input aria-label="Script title" placeholder="Script title (optional)" className="w-full rounded-lg border p-2" value={title} disabled={locked} onChange={e => setTitle(e.target.value)} />
      <label htmlFor="full-script" className="block text-sm font-medium">Full narration script</label>
      <textarea id="full-script" rows={8} autoFocus className="w-full rounded-lg border p-3" placeholder="Paste your full narration here" value={text} disabled={locked} onChange={e => setText(e.target.value)} />
      <div className="flex flex-wrap gap-2"><select aria-label="Script voice preset" className="rounded-lg border p-2" value={voiceID || ''} disabled={locked} onChange={e => setPreset(e.target.value)}>
        {presets.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select>
        <button className={button} disabled={locked || !text.trim() || !voiceID}>Save script and split into sentences</button>
        <button type="button" className={button} disabled={locked} onClick={() => setAdding(false)}>Cancel</button></div>
    </form>}
    {script && !adding && <>
      <div className="flex flex-wrap items-center justify-between gap-4 rounded-xl bg-slate-50 p-4">
        <div><h3 className="font-semibold text-slate-900">{script.title}</h3>
          <p className="mb-2 text-sm text-slate-600">{presets.find(p => p.id === script.voiceID)?.name || script.voiceID} · {counts.Approved} of {lines.length} sentences approved</p>
          <progress className="block h-2 w-full accent-emerald-600" aria-label="Sentence approvals" value={counts.Approved} max={lines.length || 1} /></div>
        <button className={button} disabled={locked || !missing.length} onClick={generate}>Generate missing takes for script ({missing.length})</button></div>
      <div className="space-y-3">
        <input aria-label="Search script sentences" placeholder="Search this script…" className="w-full rounded-lg border px-3 py-2 sm:max-w-sm" value={query} onChange={e => setQuery(e.target.value)} />
        <div aria-label="Sentence status" role="group" className="flex flex-wrap gap-2">
          {(['All', 'Needs audio', 'Awaiting approval', 'Approved', 'Needs review'] as const).map(label =>
            <button key={label} aria-pressed={filter === label} onClick={() => setFilter(label)}
              className={'rounded-full px-3 py-1.5 text-sm font-medium ' + (filter === label ? 'bg-slate-900 text-white' : 'bg-slate-100 text-slate-700 hover:bg-slate-200')}>
              {label} · {label === 'All' ? lines.length : counts[label]}</button>)}
        </div>
      </div>
      <ol aria-label="Script sentences" className="max-h-[55vh] divide-y overflow-auto rounded-xl border border-slate-200">{visible.map(({ line, index: i, group, take, state }) => {
        return <li key={i} className="flex gap-3 p-4">
          <span className="min-w-8 text-sm font-semibold tabular-nums text-slate-500">{i + 1}.</span>
          <div className="min-w-0 flex-1"><p className="mb-2 leading-relaxed">{line}</p>
          <div className="flex flex-wrap items-center gap-3 text-sm text-gray-600">
            <span className={'rounded-full px-2 py-1 text-xs font-medium ' + statusStyles[state]}>{state}</span>
            {group && take && <><TakePreview key={take.id} group={group} take={take} />
              {take.status !== 'Current approval' && <button className={button} disabled={locked || group.issue} onClick={() => run(async () => {
                onGroup((await post({ action: 'approve', folder: group.folder, id: take.id })).group);
                setStatus('Approval saved.');
              })}>Approve take</button>}</>}
          </div></div></li>;
      })}</ol>
      {!visible.length && <div className="text-sm text-slate-600">No sentences match these filters. <button className={button} onClick={resetFilters}>Clear filters</button></div>}
    </>}
    {status && <p role="status" className="text-sm">{status}</p>}
  </section>;
}
