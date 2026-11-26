'use client';

import { ArrowDown, ArrowUp, Pencil, Plus, FileText, Trash2 } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import type { VoiceGroup } from '@/lib/voice-manager';
import TakePreview, { pauseTakePreview } from './TakePreview';
import { sourceRanges } from '@/lib/voice-script-ranges';
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
  const [mode, setMode] = useState<'new' | 'edit' | null>(null);
  const [lineEdit, setLineEdit] = useState<{ index: number; value: string; insert?: boolean } | null>(null);
  const [title, setTitle] = useState('');
  const [text, setText] = useState('');
  const [preset, setPreset] = useState('');
  const [status, setStatus] = useState('');
  const [filter, setFilter] = useState<LineStatus | 'All'>('All');
  const [query, setQuery] = useState('');
  function resetFilters() { setFilter('All'); setQuery(''); }
  const [selection, setSelection] = useState<Record<string, string>>({});
  const [generating, setGenerating] = useState<number | null>(null);
  const [working, setWorking] = useState(false);
  const locked = busy || working;
  const voiceID = preset || presets[0]?.id;
  const script = scripts.find(s => s.id === selected);
  const ranges = useMemo(() => sourceRanges(script), [script]);
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
    const candidate = group?.takes.find(t => t.id === selection[group.folder]) || take;
    return { line, index, group, take: candidate, state };
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
  function openEditor(edit: boolean) {
    pauseTakePreview(); setStatus(''); setLineEdit(null);
    setTitle(edit && script ? script.title : '');
    setText(edit && script ? script.text : '');
    setPreset(edit && script ? script.voiceID : presets[0]?.id || '');
    setMode(edit ? 'edit' : 'new');
  }
  function save(inline = false) {
    return run(async () => {
      const editing = inline || mode === 'edit';
      let content = text;
      if (inline) {
        const range = lineEdit && ranges[lineEdit.index];
        if (!script || !lineEdit || !range) throw Error('Open Edit script to change this sentence.');
        content = script.text.slice(0, range.from) + lineEdit.value.trim() + script.text.slice(range.to);
      }
      const item: VoiceScript = await post({ action: editing ? 'editScript' : 'addScript', id: script?.id,
        revision: script?.revision, title: inline ? script?.title : title, text: content, voiceID: inline ? script?.voiceID : voiceID });
      resetFilters(); setScripts(all => editing ? all.map(s => s.id === item.id ? item : s) : [item, ...all]);
      setSelected(item.id); setMode(null); setLineEdit(null); setStatus('Script saved.');
    });
  }
  function changeRow(operation: 'insert' | 'up' | 'down' | 'remove', index: number, value = '') {
    if (!script) return;
    if (operation === 'remove' && !window.confirm('Remove sentence ' + (index + 1) + ' from this script? Its audio stays in the voice library.')) return;
    return run(async () => {
      pauseTakePreview();
      const item: VoiceScript = await post({ action: 'changeRow', id: script.id, revision: script.revision, operation, index, value });
      setScripts(all => all.map(s => s.id === item.id ? item : s)); setLineEdit(null);
      if (operation === 'insert') resetFilters();
      setStatus(operation === 'remove' ? 'Sentence removed.' : operation === 'insert' ? 'Sentence inserted.' : 'Sentence moved.');
    });
  }
  function insertForm() {
    if (!lineEdit?.insert) return null;
    return <form className="mt-3 space-y-2 rounded-lg border border-blue-200 bg-blue-50 p-3" onSubmit={e => {
      e.preventDefault(); void changeRow('insert', lineEdit.index, lineEdit.value);
    }}>
      <label htmlFor="new-line" className="block text-sm font-semibold">{lineEdit.index < 0 ? 'First sentence' : 'New sentence after ' + (lineEdit.index + 1)}</label>
      <textarea id="new-line" autoFocus rows={2} value={lineEdit.value} disabled={locked}
        onChange={e => setLineEdit({ ...lineEdit, value: e.target.value })} className="w-full rounded-lg border bg-white p-2" />
      <button className={button} disabled={locked || !lineEdit.value.trim()}>Insert sentence</button>{' '}
      <button type="button" className={button} disabled={locked} onClick={() => setLineEdit(null)}>Cancel</button>
    </form>;
  }
  function generateSentence(line: string, index: number, hasTake: boolean) {
    if (!script) return;
    return run(async () => {
      pauseTakePreview();
      setGenerating(index);
      try {
        const result = await post({ action: hasTake ? 'generate' : 'prepareSentence', text: line, voiceID: script.voiceID });
        const group: VoiceGroup = result.group;
        onGroup(group);
        if (result.id) setSelection(current => ({ ...current, [group.folder]: result.id }));
        if (filter === 'Needs audio') setFilter('All');
        setStatus(result.reused ? 'Found a saved recording for sentence ' + (index + 1) + '.' :
          'New take ready for sentence ' + (index + 1) + '.');
      } finally { setGenerating(null); }
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
      {scripts.length > 0 && <select aria-label="Saved script" className="w-full min-w-0 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm sm:w-72" disabled={locked || !!mode || !!lineEdit} value={selected}
        onChange={e => { resetFilters(); setSelected(e.target.value); setStatus(''); }}>
        {scripts.map(s => <option key={s.id} value={s.id}>{s.title}</option>)}</select>}
      <button className={button} disabled={locked || !!mode || !!lineEdit} onClick={() => openEditor(false)}><Plus className="mr-1 inline" size={15}/>Add script</button>
    </div>
    {!mode && !scripts.length && <p className="text-sm text-slate-600">Add a narration script to generate missing audio and review its sentences in order.</p>}
    {mode && <form className="space-y-4 rounded-xl border border-blue-100 bg-slate-50 p-5" onSubmit={e => { e.preventDefault(); void save(); }}>
      <h3 className="flex items-center gap-2 text-lg font-semibold"><FileText size={18}/>{mode === 'edit' ? 'Edit script' : 'New script'}</h3>
      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_17rem]">
        <div><label htmlFor="full-script" className="mb-2 block text-sm font-medium">Full narration script</label>
          <textarea id="full-script" rows={10} autoFocus className="w-full resize-y rounded-lg border bg-white p-4 text-base leading-7 focus:outline-blue-600" placeholder="Paste your full narration here" value={text} disabled={locked} onChange={e => setText(e.target.value)} />
        </div>
        <div className="space-y-4"><label className="block text-sm font-medium" htmlFor="script-title">Script title
          <input id="script-title" placeholder="Script title (optional)" className="mt-2 w-full rounded-lg border bg-white p-2 font-normal" value={title} disabled={locked} onChange={e => setTitle(e.target.value)} /></label>
          <label className="block text-sm font-medium">Voice preset<select aria-label="Script voice preset" className="mt-2 w-full rounded-lg border bg-white p-2 font-normal" value={voiceID || ''} disabled={locked} onChange={e => setPreset(e.target.value)}>
            {presets.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label>
          <div className="flex flex-wrap gap-2"><button className="rounded-lg bg-blue-700 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-800 disabled:opacity-40" disabled={locked || !text.trim() || !voiceID}>{mode === 'edit' ? 'Save changes' : 'Save script and split into sentences'}</button>
            <button type="button" className={button} disabled={locked} onClick={() => setMode(null)}>Cancel</button></div>
        </div>
      </div>
    </form>}
    {script && !mode && <>
      <div className="flex flex-wrap items-center justify-between gap-4 rounded-xl bg-slate-50 p-4">
        <div className="min-w-0 flex-1"><h3 className="mb-1 break-words text-lg font-semibold leading-snug text-slate-900">{script.title}</h3>
          <p className="mb-2 text-sm text-slate-600">{presets.find(p => p.id === script.voiceID)?.name || script.voiceID} · {counts.Approved} of {lines.length} sentences approved</p>
          <progress className="block h-1.5 w-full max-w-xs appearance-none overflow-hidden rounded-full [&::-webkit-progress-bar]:bg-slate-200 [&::-webkit-progress-value]:bg-emerald-600 [&::-moz-progress-bar]:bg-emerald-600" aria-label="Sentence approvals" value={counts.Approved} max={lines.length || 1} /></div>
        <button className={button} disabled={locked || !!lineEdit} onClick={() => openEditor(true)}><Pencil className="mr-1 inline" size={14}/>Edit script</button>
        <button className={button} disabled={locked || !!lineEdit || !missing.length} onClick={generate}>Generate missing takes ({missing.length})</button></div>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <input disabled={!!lineEdit} aria-label="Search script sentences" placeholder="Search this script…" className="w-full rounded-lg border px-3 py-2 sm:max-w-xs" value={query} onChange={e => setQuery(e.target.value)} />
        <div aria-label="Sentence status" role="group" className="flex flex-wrap gap-2">
          {(['All', 'Needs audio', 'Awaiting approval', 'Approved', 'Needs review'] as const).map(label =>
            <button key={label} disabled={!!lineEdit} aria-pressed={filter === label} onClick={() => setFilter(label)}
              className={'rounded-full px-3 py-1.5 text-sm font-medium ' + (filter === label ? 'bg-slate-900 text-white' : 'bg-slate-100 text-slate-700 hover:bg-slate-200')}>
              {label} · {label === 'All' ? lines.length : counts[label]}</button>)}
        </div>
      </div>
      <ol aria-label="Script sentences" className="max-h-[55vh] divide-y overflow-auto rounded-xl border border-slate-200">{visible.map(({ line, index: i, group, take, state }) => {
        return <li key={i} className="flex gap-3 p-4">
          <span className="min-w-8 text-sm font-semibold tabular-nums text-slate-500">{i + 1}.</span>
          <div className="min-w-0 flex-1">{lineEdit?.index === i && !lineEdit.insert ? <form className="space-y-2" onSubmit={e => { e.preventDefault(); void save(true); }}>
            <label className="block text-xs font-semibold text-slate-600" htmlFor="edit-line">Edit sentence {i + 1}</label>
            <textarea id="edit-line" autoFocus rows={3} value={lineEdit.value} disabled={locked} onChange={e => setLineEdit({ index: i, value: e.target.value })}
              className="w-full rounded-lg border border-blue-300 p-3 leading-relaxed focus:outline-blue-600" />
            <button className={button} disabled={locked || !lineEdit.value.trim()}>Save sentence</button>{' '}
            <button className={button} type="button" disabled={locked} onClick={() => setLineEdit(null)}>Cancel</button>
          </form> : <><div className="mb-2 flex items-start justify-between gap-3"><p className="leading-relaxed">{line}</p>
            <div className="flex shrink-0 flex-wrap items-center gap-1">
            <button className="inline-flex shrink-0 items-center gap-1 rounded-md px-2 py-1 text-xs font-medium text-slate-600 hover:bg-blue-50 hover:text-blue-700"
              disabled={locked || !!lineEdit} aria-label={'Edit sentence ' + (i + 1)} onClick={() => {
                const range = ranges[i];
                if (!range) { openEditor(true); return; }
                pauseTakePreview(); setLineEdit({ index: i, value: script.text.slice(range.from, range.to) });
              }}><Pencil size={13}/>Edit</button>
            {([{ op: 'insert', label: 'Insert after sentence', Icon: Plus }, { op: 'up', label: 'Move up sentence', Icon: ArrowUp },
              { op: 'down', label: 'Move down sentence', Icon: ArrowDown }, { op: 'remove', label: 'Remove sentence', Icon: Trash2 }] as const).map(({ op, label, Icon }) =>
              <button key={op} type="button" aria-label={label + ' ' + (i + 1)} title={label + ' ' + (i + 1)}
                className="rounded-md p-1.5 text-slate-600 hover:bg-slate-100 disabled:opacity-25"
                disabled={locked || !!lineEdit || (op === 'up' && i === 0) || (op === 'down' && i === lines.length - 1)}
                onClick={() => op === 'insert' ? setLineEdit({ index: i, value: '', insert: true }) : changeRow(op, i)}><Icon size={15}/></button>)}
            </div></div>
          <div className="flex flex-wrap items-center gap-3 text-sm text-gray-600">
            <span className={'rounded-full px-2 py-1 text-xs font-medium ' + statusStyles[state]}>{state}</span>
            <button type="button" className={button} disabled={locked || group?.issue || !presets.some(p => p.id === script.voiceID)}
              onClick={() => generateSentence(line, i, Boolean(take))}>
              {generating === i ? 'Generating…' : take ? 'Regenerate sentence' : 'Generate sentence'}
            </button>
            {group && take && <>
              {group.takes.length > 1 && <select aria-label={'Recording for sentence ' + (i + 1)} value={take.id}
                className="max-w-full rounded-lg border bg-white px-2 py-1.5 text-sm" onChange={e => {
                  pauseTakePreview();
                  const id = e.target.value;
                  setSelection(current => ({ ...current, [group.folder]: id }));
                }}>
                {group.takes.map((version, n) => <option key={version.id} value={version.id}>
                  Take {group.takes.length - n} · {version.status}
                </option>)}
              </select>}
              <TakePreview key={take.id} group={group} take={take} showLabel />
              {take.status !== 'Current approval' && <button className={button} disabled={locked || group.issue} onClick={() => run(async () => {
                onGroup((await post({ action: 'approve', folder: group.folder, id: take.id })).group);
                setStatus('Approval saved.');
              })}>Approve take</button>}</>}
          </div>{lineEdit?.insert && lineEdit.index === i && insertForm()}</>}</div></li>;
      })}</ol>
      {!lines.length && (lineEdit?.insert ? insertForm() : <button className={button} disabled={locked} onClick={() => setLineEdit({ index: -1, value: '', insert: true })}>Add first sentence</button>)}
      {!!lines.length && !visible.length && <div className="text-sm text-slate-600">No sentences match these filters. <button className={button} onClick={resetFilters}>Clear filters</button></div>}
    </>}
    {status && <p role="status" className="text-sm">{status}</p>}
  </section>;
}
