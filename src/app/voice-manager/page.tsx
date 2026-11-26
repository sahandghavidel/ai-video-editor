'use client';

import Link from 'next/link';
import TakePreview, { pauseTakePreview } from './TakePreview';
import ScriptReview from './ScriptReview';
import { Fragment, useCallback, useEffect, useState } from 'react';
import type { VoiceGroup, VoiceTake } from '@/lib/voice-manager';
import { formatStorageSize } from '@/lib/storage-manager';

const api = '/api/voice-manager';
const button = 'rounded-lg border border-blue-200 bg-white px-3 py-2 text-sm font-medium text-blue-700 hover:bg-blue-50 disabled:opacity-40';
const pageSize = 25;
function candidates(group: VoiceGroup) {
  return group.issue || !group.takes.some(t => t.status === 'Current approval') ? [] : group.takes.filter(t => t.status === 'Unapproved');
}
function bytes(takes: VoiceTake[]) { return takes.reduce((n, t) => n + t.size, 0); }
export default function VoiceManager() {
  const [groups, setGroups] = useState<VoiceGroup[]>([]);
  const [view, setView] = useState<'scripts' | 'library'>('scripts');
  const [sort, setSort] = useState('Cleanup size');
  const [voiceFilter, setVoiceFilter] = useState('');
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState('All folders');
  const [page, setPage] = useState(0);
  const [expanded, setExpanded] = useState('');
  const [preview, setPreview] = useState<VoiceGroup[]>([]);
  const [busy, setBusy] = useState(true);
  const [draft, setDraft] = useState('');
  const [presets, setPresets] = useState<{ id: string; name: string }[]>([]);
  const [voiceID, setVoiceID] = useState('');
  const [editing, setEditing] = useState(false);
  const [focused, setFocused] = useState('');
  const [message, setMessage] = useState('');
  const load = useCallback(async () => {
    const res = await fetch(api, { cache: 'no-store' });
    if (!res.ok) throw Error('Could not read the Narration Pilot library.');
    setGroups(await res.json());
    const response = await fetch('/api/tts-audio-references', { cache: 'no-store' });
    if (!response.ok) throw Error('Could not load voice presets.');
    const available = (await response.json()).entries.filter((v: { enabled: boolean; language: string; provider: string }) =>
      v.enabled && v.language === 'en' && v.provider === 'omnivoice-lora');
    setPresets(available);
    setVoiceID(current => current || available[0]?.id || '');
  }, []);
  const refresh = useCallback(async () => {
    setBusy(true); setPreview([]); setMessage('');
    try { await load(); } catch (e) { setMessage(String(e)); } finally { setBusy(false); }
  }, [load]);
  useEffect(() => { void refresh(); }, [refresh]);
  useEffect(() => { if (preview.length) document.getElementById('cleanup-preview')?.scrollIntoView({ block: 'nearest' }); }, [preview]);
  const libraryRows = groups.map(g => ({ g, eligible: candidates(g) }));
  const eligibleFolders = libraryRows.filter(row => row.eligible.length > 0);
  const eligibleCount = eligibleFolders.reduce((total, row) => total + row.eligible.length, 0);
  const libraryVoices = new Map(groups.filter(g => g.voiceID).map(g => [g.voiceID, g.voice || g.voiceID]));
  const filtered = Boolean(query.trim() || filter !== 'All folders' || voiceFilter);
  const rows = libraryRows.filter(({ g, eligible }) => {
    if (!(g.narration + ' ' + g.voice).toLowerCase().includes(query.trim().toLowerCase())) return false;
    if (voiceFilter && g.voiceID !== voiceFilter) return false;
    if (filter === 'Approved') return !g.issue && g.takes.some(t => t.status === 'Current approval');
    if (filter === 'Multiple takes') return g.takes.length > 1;
    if (filter === 'Ready to clean') return eligible.length > 0;
    if (filter === 'Awaiting approval') return !g.issue && !g.takes.some(t => t.status === 'Current approval');
    return filter !== 'Needs review' || g.issue;
  }).sort((a, b) => {
    const pinned = Number(b.g.folder === focused) - Number(a.g.folder === focused);
    if (pinned) return pinned;
    const byName = () => a.g.narration.localeCompare(b.g.narration);
    if (sort === 'Newest take') return (b.g.takes[0]?.date || 0) - (a.g.takes[0]?.date || 0) || byName();
    if (sort === 'Most takes') return b.g.takes.length - a.g.takes.length || byName();
    return sort === 'Narration A–Z' ? byName() : bytes(b.eligible) - bytes(a.eligible) || byName();
  });
  const index = Math.min(page, Math.max(0, Math.ceil(rows.length / pageSize) - 1));
  const planned = preview.flatMap(candidates);
  function compose(group?: VoiceGroup) {
    setEditing(true);
    setDraft(group?.narration || '');
    if (group) setVoiceID(group.voiceID);
    setPreview([]);
    requestAnimationFrame(() => document.getElementById('voice-draft')?.focus());
  }
  async function changeTake(action: 'generate' | 'approve', folder?: string, id?: string) {
    setBusy(true); setPreview([]);
    setMessage(action === 'generate' ? 'Generating a new take…' : 'Saving approval…');
    try {
      const res = await fetch(api, { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, folder, id, text: draft, voiceID }) });
      const result = await res.json();
      if (!res.ok || !result.group) throw Error(result.error || 'Refresh the library to check the take.');
      const group: VoiceGroup = result.group;
      setGroups(all => [group, ...all.filter(g => g.folder !== group.folder)]);
      setFocused(group.folder); setExpanded(group.folder); setPage(0);
      if (action === 'generate') {
        setVoiceFilter(''); setQuery(''); setFilter('All folders'); setEditing(false);
        setMessage('New take saved. Preview it in the first row and approve it when ready.');
      } else setMessage('Approval saved for “' + group.narration + '”.');
    } catch (e) { setMessage(String(e)); }
    finally { setBusy(false); }
  }
  async function clean() {
    setBusy(true);
    let moved = 0;
    try {
      for (const [index, group] of preview.entries()) {
        setMessage(`Cleaning folder ${index + 1} of ${preview.length} · ${moved} takes moved to Trash`);
        const res = await fetch(api, { method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ folder: group.folder, ids: candidates(group).map(t => t.id) }) });
        if (!res.ok) throw Error('Cleanup stopped. Check the refreshed folders for remaining takes.');
        moved += (await res.json()).moved;
      }
      setMessage(`Moved ${moved} takes to Trash. Skipped ${planned.length - moved}.`);
    } catch (e) { setMessage(String(e)); }
    finally {
      setPreview([]);
      try { await load(); } catch { setMessage('Refresh to see the latest library state.'); }
      setBusy(false);
    }
  }
  return <main className="min-h-screen bg-gray-50 p-6 text-gray-900 md:p-10">
    <div className="mx-auto max-w-7xl space-y-4">
      <Link href="/" className="text-sm text-blue-700">← Back to editor</Link>
      <h1 className="text-3xl font-bold">Voice Manager</h1>
      <p className="text-gray-600">English LoRA takes saved by Narration Pilot · {groups.length} narration folders</p>
      <nav aria-label="Voice Manager views" className="inline-flex gap-1 rounded-xl border border-slate-200 bg-white p-1 shadow-sm">
        {(['scripts', 'library'] as const).map(item => <button key={item} disabled={busy} aria-pressed={view === item}
          onClick={() => { pauseTakePreview(); setView(item); }} className={'rounded-lg px-4 py-2 text-sm font-semibold ' +
            (view === item ? 'bg-slate-900 text-white' : 'text-slate-600 hover:bg-slate-100')}>
          {item === 'scripts' ? 'Scripts' : 'Voice library'}</button>)}
      </nav>
      {view === 'scripts' && message && <p role="status" className="text-sm">{message}</p>}
      <div hidden={view !== 'scripts'}><ScriptReview shown={view === 'scripts'} groups={groups} presets={presets} busy={busy} setBusy={setBusy}
        onGroup={group => { setPreview([]); setGroups(all => [group, ...all.filter(g => g.folder !== group.folder)]); }} /></div>
      <div hidden={view !== 'library'} className="space-y-4">
      {editing && <form className="space-y-3 rounded-xl border bg-white p-4" onSubmit={e => { e.preventDefault(); void changeTake('generate'); }}>
        <label className="block font-semibold" htmlFor="voice-draft">Sentence to record</label>
        <textarea id="voice-draft" className="w-full rounded-lg border p-3" rows={3} value={draft} disabled={busy} onChange={e => setDraft(e.target.value)} />
        <div className="flex flex-wrap items-center gap-2"><select aria-label="Voice preset" className="rounded-lg border p-2" value={voiceID} disabled={busy} onChange={e => setVoiceID(e.target.value)}>
          {!presets.some(p => p.id === voiceID) && <option value={voiceID}>Choose an enabled preset</option>}
          {presets.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select><button className={button} disabled={busy || !draft.trim() || !presets.some(p => p.id === voiceID)}>Generate take</button>
        <button type="button" className={button} disabled={busy} onClick={() => setEditing(false)}>Cancel</button></div>
      </form>}
      <section className="flex flex-wrap items-center justify-between gap-4 rounded-xl border border-blue-200 bg-blue-50 p-4">
        <div><h2 className="font-semibold">Library-wide cleanup</h2>
          <p className="text-sm text-gray-700">Keep every current and previous approval. Move the remaining takes to Trash only in folders with a current approval.</p>
          {!busy && <p className="mt-1 text-sm font-medium">{eligibleCount} eligible takes across {eligibleFolders.length} folders</p>}
        </div>
        <button className="rounded-lg bg-blue-700 px-4 py-2 text-sm font-medium text-white hover:bg-blue-800 disabled:opacity-40"
          disabled={busy || !eligibleCount} onClick={() => setPreview(eligibleFolders.map(row => row.g))}>Preview cleanup for entire library</button>
      </section>
      <div className="flex flex-wrap items-center gap-3 rounded-xl border bg-white p-4">
        <input aria-label="Search narration or voice" placeholder="Search narration or voice" className="rounded-lg border bg-white px-3 py-2" value={query} onChange={e => { setQuery(e.target.value); setPage(0); }} />
        <select aria-label="Filter folders" className="rounded-lg border bg-white p-2" value={filter} onChange={e => { setFilter(e.target.value); setPage(0); }}>
          {['All folders', 'Approved', 'Awaiting approval', 'Multiple takes', 'Ready to clean', 'Needs review'].map(f => <option key={f}>{f}</option>)}
        </select>
        <select aria-label="Library voice preset" className="max-w-full rounded-lg border p-2" value={voiceFilter} onChange={e => { setVoiceFilter(e.target.value); setPage(0); }}>
          <option value="">All voices</option>{Array.from(libraryVoices, ([id, name]) => <option key={id} value={id}>{name}</option>)}
        </select>
        <label className="flex items-center gap-2 text-sm">Sort by <select className="rounded-lg border p-2" value={sort} onChange={e => { setSort(e.target.value); setFocused(''); setPage(0); }}>
          {['Cleanup size', 'Newest take', 'Most takes', 'Narration A–Z'].map(s => <option key={s}>{s}</option>)}</select></label>
        {filtered && <button className={button} onClick={() => { setQuery(''); setFilter('All folders'); setVoiceFilter(''); setPage(0); }}>Clear filters</button>}
        <button className={button} disabled={busy} onClick={refresh}>Refresh</button>
        {filtered && <button className={button} disabled={busy || !rows.some(r => r.eligible.length)} onClick={() => setPreview(rows.filter(r => r.eligible.length).map(r => r.g))}>Preview cleanup of matching folders</button>}
      </div>
      {message && <p role="status" className="rounded-lg border bg-white p-3">{message}</p>}
      {preview.length > 0 && <section id="cleanup-preview" className="space-y-3 rounded-xl border border-amber-300 bg-amber-50 p-4">
        <h2 className="font-semibold">Cleanup preview · {preview.length} folders · {planned.length} unapproved takes · {formatStorageSize(bytes(planned))}</h2>
        <div className="max-h-52 overflow-auto">{preview.map(g => <details key={g.folder}><summary className="cursor-pointer">{g.narration} · move {candidates(g).length}, keep {g.takes.length - candidates(g).length}</summary>
          {g.takes.map(t => <div key={t.id} className="pl-4 text-sm">{t.status === 'Unapproved' ? 'Move' : 'Keep'} · {t.status} · {new Date(t.date).toLocaleString()} · {t.id.slice(0, 8)}</div>)}</details>)}</div>
        <button className={button} disabled={busy} onClick={clean}>Move {planned.length} to Trash</button>{' '}
        <button className={button} disabled={busy} onClick={() => setPreview([])}>Cancel</button>
      </section>}
      {busy && <p role="status">Reading or updating the local library…</p>}
      <div className="overflow-x-auto rounded-xl border bg-white"><table className="w-full text-left text-sm">
        <thead className="bg-blue-50"><tr>{['Narration / voice', 'Current approval', 'Takes', 'Cleanup size', 'Actions'].map(h => <th key={h} className="p-3">{h}</th>)}</tr></thead>
        <tbody>{rows.slice(index * pageSize, (index + 1) * pageSize).map(({ g, eligible }) => {
          const active = g.takes.find(t => t.status === 'Current approval');
          return <Fragment key={g.folder}><tr className="border-t align-middle">
            <td className="p-3"><span className="font-medium">{g.narration}</span><div className="text-xs text-gray-500">{g.voice}</div></td>
            <td className="p-3">{g.issue && <strong className="block text-amber-700">Needs review</strong>}{active ? <TakePreview key={active.id} group={g} take={active} /> : !g.issue && 'Awaiting approval'}</td>
            <td className="p-3">{g.takes.length}</td><td className="p-3">{formatStorageSize(bytes(eligible))}</td>
            <td className="p-3"><div className="flex flex-wrap gap-2"><button className={button} aria-expanded={expanded === g.folder} onClick={() => setExpanded(expanded === g.folder ? '' : g.folder)}>{expanded === g.folder ? 'Hide takes' : 'View takes'}</button>
              {!!eligible.length && <button className={button} disabled={busy} onClick={() => setPreview([g])}>Preview cleanup</button>}</div></td>
          </tr>{expanded === g.folder && <tr><td colSpan={5} className="bg-gray-50 p-3">
            <button className={button} disabled={busy || g.issue} onClick={() => compose(g)}>Generate from this sentence</button>
            {g.takes.map(t => <div key={t.id} className="flex flex-wrap items-center gap-4 border-b py-2">
              <TakePreview group={g} take={t} /><strong>{t.status}</strong><span>{new Date(t.date).toLocaleString()}</span>
              <span>{t.duration.toFixed(1)} s · {formatStorageSize(t.size)}</span><code>{t.id.slice(0, 8)}</code>
              {t.status !== 'Current approval' && <button className={button} disabled={busy || g.issue} onClick={() => changeTake('approve', g.folder, t.id)}>Approve take</button>}
            </div>)}</td></tr>}</Fragment>;
        })}</tbody></table></div>
      {!busy && !rows.length && <p>No matching narration folders.</p>}
      {!!rows.length && <div className="flex items-center gap-4 text-sm"><button className={button} disabled={!index} onClick={() => setPage(index - 1)}>Previous</button>
        Page {index + 1} of {Math.ceil(rows.length / pageSize)} · {rows.length} folders
        <button className={button} disabled={(index + 1) * pageSize >= rows.length} onClick={() => setPage(index + 1)}>Next</button></div>}
      </div>
    </div>
  </main>;
}
