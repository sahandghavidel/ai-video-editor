'use client';

import { ArrowDown, ArrowUp, Pencil, Plus, FileText, Trash2, Combine, Play, Pause } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { VoiceGroup } from '@/lib/voice-manager';
import { takeDuration } from './TakePreview';
import FindReplace from './FindReplace';
import { useReviewAudio } from './useReviewAudio';
import { useTakeQueue, jobKey } from './useTakeQueue';
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
  shown: boolean;
  setBusy: (busy: boolean) => void;
  onGroup: (group: VoiceGroup) => void;
};

export default function ScriptReview({ groups, presets, busy, setBusy, onGroup, shown }: Props) {
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
  const [activeIndex, setActiveIndex] = useState(0);
  const [checked, setChecked] = useState<number[]>([]);
  const [replaceOpen, setReplaceOpen] = useState(false);
  const [compareIndex, setCompareIndex] = useState<number | null>(null);
  const [pair, setPair] = useState(['', '']);
  const queue = useTakeQueue(onGroup);
  const audio = useReviewAudio();
  const editor = useRef<HTMLTextAreaElement>(null);
  const storageKey = 'voice-manager.script-review.v1';
  const scrollTarget = useRef<number | null>(null);
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
      if (!active) return;
      setScripts(items);
      setSelected(items[0]?.id || '');
      try {
        const saved = JSON.parse(localStorage.getItem(storageKey) || 'null');
        const restored = items.find(s => s.id === saved?.script);
        if (restored) {
          setSelected(restored.id);
          const index = Math.max(0, Math.min(Number(saved.index) || 0, restored.sentences.length - 1));
          setActiveIndex(index); scrollTarget.current = index;
          if (saved.filter === 'All' || Object.hasOwn(statusStyles, saved.filter)) setFilter(saved.filter);
          if (typeof saved.query === 'string') setQuery(saved.query);
          if (saved.selection && typeof saved.selection === 'object') setSelection(saved.selection);
        }
      } catch { /* Browser storage is optional. */ }
    })().catch(e => { if (active) setStatus(String(e)); });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    if (!selected) return;
    try { localStorage.setItem(storageKey, JSON.stringify({ script: selected, index: activeIndex, filter, query, selection })); } catch { /* Storage unavailable. */ }
  }, [selected, activeIndex, filter, query, selection]);
  const stopAudio = audio.stop;
  useEffect(() => { stopAudio(); }, [selected, shown, mode, filter, query, stopAudio]);
  function focusLine(index: number) {
    setActiveIndex(index);
    const row = document.getElementById('review-line-' + index);
    row?.focus({ preventScroll: true });
    row?.scrollIntoView({ block: 'nearest' });
  }
  function switchScript(id: string) {
    resetFilters(); setSelected(id); setActiveIndex(0); setChecked([]); setCompareIndex(null); setReplaceOpen(false); setStatus('');
  }
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
    audio.stop(); setStatus(''); setLineEdit(null);
    setTitle(edit && script ? script.title : '');
    setText(edit && script ? script.text : '');
    setPreset(edit && script ? script.voiceID : presets[0]?.id || '');
    setMode(edit ? 'edit' : 'new');
  }
  function updateScript(item: VoiceScript) {
    audio.stop(); setChecked([]); setCompareIndex(null); setLineEdit(null);
    setScripts(all => all.map(s => s.id === item.id ? item : s));
    setActiveIndex(i => Math.max(0, Math.min(item.sentences.length - 1, i)));
  }
  function save(inline = false) {
    if (inline && lineEdit) return changeRow('edit', lineEdit.index, lineEdit.value);
    return run(async () => {
      const item: VoiceScript = await post({ action: mode === 'edit' ? 'editScript' : 'addScript', id: script?.id,
        revision: script?.revision, title, text, voiceID });
      if (mode === 'edit') updateScript(item);
      else { setScripts(all => [item, ...all]); switchScript(item.id); }
      resetFilters(); setMode(null); setStatus('Script saved.');
    });
  }
  function changeRow(operation: 'insert' | 'up' | 'down' | 'remove' | 'split' | 'merge' | 'edit', index: number, value = '', cursor?: number) {
    if (!script) return;
    if (operation === 'remove' && !window.confirm('Remove sentence ' + (index + 1) + ' from this script? Its audio stays in the voice library.')) return;
    return run(async () => {
      audio.stop();
      const item: VoiceScript = await post({ action: 'changeRow', id: script.id, revision: script.revision, operation, index, value, cursor });
      updateScript(item);
      if (operation === 'insert') resetFilters();
      setStatus(operation === 'remove' ? 'Sentence removed.' : operation === 'insert' ? 'Sentence inserted.' : 'Script updated.');
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
  type Row = (typeof lines)[number];
  function track(row?: Row) {
    return row?.group && row.take ? [{ folder: row.group.folder, take: row.take }] : [];
  }
  function audition(row: Row, context = false) {
    focusLine(row.index);
    const tracks = context ? lines.slice(Math.max(0, row.index - 1), row.index + 2).flatMap(r => track(r)) : track(row);
    if (tracks.length) audio.play((context ? 'context:' : 'line:') + row.index + ':' + row.take?.id, tracks);
  }
  function approve(row: Row, advance: boolean) {
    if (locked || !row.group || row.group.issue || !row.take || row.take.status === 'Current approval') return;
    const { group, take } = row;
    return run(async () => {
      const result = await post({ action: 'approve', folder: group.folder, id: take.id });
      onGroup(result.group);
      setStatus('Approval saved.');
      if (advance) {
        const next = [...visible.filter(r => r.index > row.index), ...visible.filter(r => r.index < row.index)]
          .find(r => r.group?.folder !== group.folder && r.state === 'Awaiting approval');
        if (next) audition(next);
        else { audio.stop(); setStatus('No more sentences awaiting approval in this view.'); }
      }
    });
  }
  function batch(rows: Row[], regenerate: boolean) {
    if (!script) return;
    void queue.enqueue(rows.filter(r => !r.group?.issue).map(r => ({ text: r.line, voiceID: script.voiceID, regenerate })));
  }
  useEffect(() => {
    if (!busy && shown && scrollTarget.current !== null) {
      document.getElementById('review-line-' + scrollTarget.current)?.scrollIntoView({ block: 'nearest' });
      scrollTarget.current = null;
    }
  }, [busy, selected, shown]);
  useEffect(() => {
    if (!shown || mode || lineEdit || replaceOpen) return;
    function keydown(e: KeyboardEvent) {
      if (e.defaultPrevented || e.repeat || e.metaKey || e.ctrlKey || e.altKey || e.shiftKey ||
          !(e.target instanceof HTMLElement) || e.target.isContentEditable || e.target.closest('input,textarea,select,[role="textbox"]')) return;
      const pos = visible.findIndex(r => r.index === activeIndex);
      const row = visible[pos] || visible[0];
      if (!row) return;
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        const next = Math.max(0, Math.min(visible.length - 1, pos + (e.key === 'ArrowDown' ? 1 : -1)));
        audio.stop(); focusLine(visible[next].index);
      } else if (e.code === 'Space' && !e.target.closest('button,a,summary')) {
        e.preventDefault(); audition(row);
      } else if (e.key.toLowerCase() === 'a') { e.preventDefault(); void approve(row, false); }
    }
    document.addEventListener('keydown', keydown);
    return () => document.removeEventListener('keydown', keydown);
  });
  return <section className="space-y-5 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:p-6">
    <div className="flex flex-wrap items-center gap-3"><h2 className="mr-auto text-xl font-semibold tracking-tight">Script review</h2>
      {scripts.length > 0 && <select aria-label="Saved script" className="w-full min-w-0 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm sm:w-72" disabled={locked || !!mode || !!lineEdit} value={selected}
        onChange={e => { switchScript(e.target.value); }}>
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
        <button className={button} disabled={locked || !!lineEdit || !missing.length} onClick={() => batch(lines.filter(r => r.state === 'Needs audio'), false)}>Generate missing takes ({missing.length})</button></div>
      <div className="flex flex-wrap items-center gap-2">
        <button className={button} disabled={locked || !!lineEdit} onClick={() => setReplaceOpen(!replaceOpen)}>Find and replace</button>
        {script.canUndo && <button className={button} disabled={locked || !!lineEdit} onClick={() => run(async () => {
          updateScript(await post({ action: 'undoScript', id: script.id, revision: script.revision })); setReplaceOpen(false); setStatus('Last script change undone.');
        })}>Undo last change</button>}
        <button className={button} disabled={locked || !!lineEdit || !checked.length} onClick={() => {
          batch(lines.filter(r => checked.includes(r.index)), true); setChecked([]);
        }}>Regenerate selected ({checked.length})</button>
        <span className="ml-auto text-xs text-slate-500">↑ ↓ Navigate · Space Play / pause · A Approve</span>
      </div>
      {replaceOpen && <FindReplace script={script} busy={locked} close={() => setReplaceOpen(false)} apply={(find, replacement) => run(async () => {
        updateScript(await post({ action: 'replaceText', id: script.id, revision: script.revision, find, replacement }));
        setReplaceOpen(false); resetFilters(); setStatus('Replacements saved.');
      })}/>}
      {queue.message && <p role="status" className="text-sm text-slate-600">{queue.keys.length ? queue.keys.length + ' queued · ' : ''}{queue.message}</p>}
      {audio.error && <p role="alert">{audio.error}</p>}
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
        const row = lines[i];
        const key = jobKey(script.voiceID, line);
        const fresh = group?.takes.find(t => t.id === queue.fresh[key]);
        const lineKey = 'line:' + i + ':' + take?.id;
        return <li id={'review-line-' + i} key={i} tabIndex={0} onFocus={() => setActiveIndex(i)} onClick={() => setActiveIndex(i)}
          className={'flex gap-3 border-l-2 p-4 ' + (activeIndex === i ? 'border-l-blue-600 bg-blue-50/30' : 'border-l-transparent')}>
          <input type="checkbox" className="mt-1 h-4 w-4" aria-label={'Select sentence ' + (i + 1)} checked={checked.includes(i)}
            disabled={group?.issue || !!lineEdit || locked} onChange={e => setChecked(all => e.target.checked ? [...all, i] : all.filter(n => n !== i))} />
          <span className="min-w-8 text-sm font-semibold tabular-nums text-slate-500">{i + 1}.</span>
          <div className="min-w-0 flex-1">{lineEdit?.index === i && !lineEdit.insert ? <form className="space-y-2" onSubmit={e => { e.preventDefault(); void save(true); }}>
            <label className="block text-xs font-semibold text-slate-600" htmlFor="edit-line">Edit sentence {i + 1}</label>
            <textarea ref={editor} id="edit-line" autoFocus rows={3} value={lineEdit.value} disabled={locked} onChange={e => setLineEdit({ index: i, value: e.target.value })}
              className="w-full rounded-lg border border-blue-300 p-3 leading-relaxed focus:outline-blue-600" />
            <button className={button} disabled={locked || !lineEdit.value.trim()}>Save sentence</button>{' '}
            <button className={button} type="button" disabled={locked} onClick={() => changeRow('split', i, lineEdit.value, editor.current?.selectionStart)}>Split at cursor</button>{' '}
            <button className={button} type="button" disabled={locked} onClick={() => setLineEdit(null)}>Cancel</button>
          </form> : <><div className="mb-2 flex items-start justify-between gap-3"><p className="leading-relaxed">{line}</p>
            <div className="flex shrink-0 flex-wrap items-center gap-1">
            <button className="inline-flex shrink-0 items-center gap-1 rounded-md px-2 py-1 text-xs font-medium text-slate-600 hover:bg-blue-50 hover:text-blue-700"
              disabled={locked || !!lineEdit} aria-label={'Edit sentence ' + (i + 1)} onClick={() => {
                const range = ranges[i];
                if (!range) { openEditor(true); return; }
                audio.stop(); setLineEdit({ index: i, value: script.text.slice(range.from, range.to) });
              }}><Pencil size={13}/>Edit</button>
            {([{ op: 'insert', label: 'Insert after sentence', Icon: Plus }, { op: 'up', label: 'Move up sentence', Icon: ArrowUp },
              { op: 'down', label: 'Move down sentence', Icon: ArrowDown }, { op: 'merge', label: 'Merge with next sentence', Icon: Combine }, { op: 'remove', label: 'Remove sentence', Icon: Trash2 }] as const).map(({ op, label, Icon }) =>
              <button key={op} type="button" aria-label={label + ' ' + (i + 1)} title={label + ' ' + (i + 1)}
                className="rounded-md p-1.5 text-slate-600 hover:bg-slate-100 disabled:opacity-25"
                disabled={locked || !!lineEdit || (op === 'up' && i === 0) || ((op === 'down' || op === 'merge') && i === lines.length - 1)}
                onClick={() => op === 'insert' ? setLineEdit({ index: i, value: '', insert: true }) : changeRow(op, i)}><Icon size={15}/></button>)}
            </div></div>
          <div className="flex flex-wrap items-center gap-3 text-sm text-gray-600">
            <span className={'rounded-full px-2 py-1 text-xs font-medium ' + statusStyles[state]}>{state}</span>
            <button type="button" className={button} disabled={locked || queue.keys.includes(key) || group?.issue || !presets.some(p => p.id === script.voiceID)}
              onClick={() => batch([row], Boolean(take))}>
              {queue.keys.includes(key) ? 'Queued…' : take ? 'Regenerate sentence' : 'Generate sentence'}
            </button>
            {group && take && <>
              {group.takes.length > 1 && <select aria-label={'Recording for sentence ' + (i + 1)} value={take.id}
                className="max-w-full rounded-lg border bg-white px-2 py-1.5 text-sm" onChange={e => {
                  audio.stop();
                  const id = e.target.value;
                  setSelection(current => ({ ...current, [group.folder]: id }));
                }}>
                {group.takes.map((version, n) => <option key={version.id} value={version.id}>
                  Take {group.takes.length - n} · {version.status}
                </option>)}
              </select>}
              <button type="button" className="inline-flex items-center gap-1.5 rounded-full border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:border-blue-300" onClick={() => audition(row)}>
                {audio.playing === lineKey ? <Pause className="mr-1 inline" size={13}/> : <Play className="mr-1 inline" size={13}/>}
                {audio.playing === lineKey ? 'Pause' : 'Play sentence'} <span className="tabular-nums text-slate-500">{takeDuration(take.duration)}</span></button>
              <button className={button} onClick={() => audition(row, true)}>{audio.playing === 'context:' + i + ':' + take.id ? 'Pause context' : 'Play in context'}</button>
              {fresh && fresh.id !== take.id && <button className={button} onClick={() => {
                setSelection(current => ({ ...current, [group.folder]: fresh.id }));
                audio.play('line:' + i + ':' + fresh.id, [{ folder: group.folder, take: fresh }]);
              }}>Play new take</button>}
              {group.takes.length > 1 && <button className={button} onClick={() => {
                audio.stop(); setCompareIndex(compareIndex === i ? null : i);
                setPair([take.id, group.takes.find(t => t.id !== take.id)!.id]);
              }}>Compare takes</button>}
              {take.status !== 'Current approval' && <>
                <button className={button} disabled={locked || group.issue} onClick={() => approve(row, false)}>Approve take</button>
                <button className="rounded-lg bg-blue-700 px-3 py-2 text-sm font-semibold text-white hover:bg-blue-800 disabled:opacity-40" disabled={locked || group.issue} onClick={() => approve(row, true)}>Approve and play next</button>
              </>}
              {compareIndex === i && group.takes.length > 1 && <div className="flex w-full flex-wrap gap-3 rounded-lg bg-slate-100 p-3">
                {pair.map((id, side) => {
                  const version = group.takes.find(t => t.id === id);
                  const label = side ? 'B' : 'A';
                  return <div key={label} className="flex gap-1"><select aria-label={'Take ' + label} className="rounded border p-1" value={id}
                    onChange={e => { const value = e.target.value; setPair(old => side ? [old[0], value] : [value, old[1]]); }}>
                    {group.takes.map((t, n) => <option key={t.id} disabled={pair[1 - side] === t.id} value={t.id}>Take {group.takes.length - n} · {t.status}</option>)}</select>
                    <button className={button} disabled={!version} onClick={() => version && audio.play('compare:' + i + ':' + id, [{ folder: group.folder, take: version }], true)}>
                      {audio.playing === 'compare:' + i + ':' + id ? 'Pause' : 'Play'} {label}</button></div>;
                })}
              </div>}
            </>}
          </div>{lineEdit?.insert && lineEdit.index === i && insertForm()}</>}</div></li>;
      })}</ol>
      {!lines.length && (lineEdit?.insert ? insertForm() : <button className={button} disabled={locked} onClick={() => setLineEdit({ index: -1, value: '', insert: true })}>Add first sentence</button>)}
      {!!lines.length && !visible.length && <div className="text-sm text-slate-600">No sentences match these filters. <button className={button} onClick={resetFilters}>Clear filters</button></div>}
    </>}
    {status && <p role="status" className="text-sm">{status}</p>}
  </section>;
}
