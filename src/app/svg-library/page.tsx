'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { validateSvg, SVG_MAX_BYTES, type SvgAsset } from '@/lib/svg-library';

const empty: SvgAsset = { id: 0, name: '', description: '', svg: '', status: 'Draft', viewBox: '', width: 0, height: 0, tags: '', usageRules: 'Preserve proportions and internal design. Animate an outer wrapper.' };
const inputClass = 'w-full rounded-lg border border-slate-300 p-2 text-sm text-slate-900 bg-white';
const buttonClass = 'rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium hover:bg-slate-100 disabled:opacity-50';
function Preview({ svg }: { svg: string }) {
  const result = useMemo(() => {
    try { return { ...validateSvg(svg), error: '' }; }
    catch (e) { return { svg: '', error: e instanceof Error ? e.message : 'Invalid SVG', width: 0, height: 0 }; }
  }, [svg]);
  return <div className='flex h-48 flex-col items-center justify-center rounded-xl border bg-slate-100 p-4'>
    {result.svg ? <>
      {/* SVG image context prevents script execution and isolates asset IDs. */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img className='min-h-0 max-h-36 max-w-full object-contain' src={`data:image/svg+xml;charset=utf-8,${encodeURIComponent(result.svg)}`} alt='SVG asset preview' />
      <span className='mt-2 text-xs text-slate-500'>{result.width} × {result.height}</span>
    </> : <p className='text-sm text-slate-500'>{svg ? result.error : 'Paste or upload an SVG to preview it.'}</p>}
  </div>;
}
export default function SvgLibraryPage() {
  const [assets, setAssets] = useState<SvgAsset[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState('All');
  const [draft, setDraft] = useState<SvgAsset | null>(null);
  const [original, setOriginal] = useState('');
  const dirty = !!draft && JSON.stringify(draft) !== original;
  const load = useCallback(async () => {
    setLoading(true); setError('');
    try {
      const response = await fetch('/api/svg-library');
      const data = await response.json();
      if (!response.ok) throw new Error(data.error);
      setAssets(data.assets);
    } catch (e) { setError(e instanceof Error ? e.message : 'Unable to load library.'); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    if (!dirty) return;
    const handler = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ''; };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [dirty]);
  function open(asset: SvgAsset | null) {
    if (dirty && !window.confirm('Discard your unsaved changes?')) return;
    setDraft(asset); setOriginal(JSON.stringify(asset)); setError(''); setNotice('');
  }
  function update(key: keyof SvgAsset, value: string) {
    setDraft(current => current ? { ...current, [key]: value, ...(key === 'svg' ? { status: 'Draft' as const } : {}) } : null);
  }
  async function save() {
    if (!draft) return;
    setBusy(true); setError(''); setNotice('');
    try {
      validateSvg(draft.svg);
      const response = await fetch('/api/svg-library', { method: draft.id ? 'PATCH' : 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(draft) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error);
      setAssets(current => draft.id ? current.map(a => a.id === draft.id ? data.asset : a) : [...current, data.asset]);
      setDraft(data.asset); setOriginal(JSON.stringify(data.asset)); setNotice('Asset saved.');
    } catch (e) { setError(e instanceof Error ? e.message : 'Unable to save.'); }
    finally { setBusy(false); }
  }
  async function remove() {
    if (!draft?.id || !window.confirm(`Delete “${draft.name || 'Untitled asset'}” from the library?`)) return;
    setBusy(true); setError('');
    try {
      const response = await fetch(`/api/svg-library?id=${draft.id}`, { method: 'DELETE' });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error);
      setAssets(current => current.filter(a => a.id !== draft.id)); setDraft(null); setOriginal(''); setNotice('Asset deleted.');
    } catch (e) { setError(e instanceof Error ? e.message : 'Unable to delete.'); }
    finally { setBusy(false); }
  }
  const visible = assets.filter(a => (filter === 'All' || a.status === filter) && `${a.name} ${a.description} ${a.tags}`.toLowerCase().includes(query.toLowerCase()));
  return <main className='min-h-screen bg-slate-50 p-6 text-slate-900'>
    <div className='mx-auto max-w-7xl space-y-6'>
      <header className='flex flex-wrap items-center justify-between gap-4'>
        <div><Link href='/' onClick={e => { if (dirty && !window.confirm('Discard your unsaved changes?')) e.preventDefault(); }} className='text-sm text-blue-700'>← Video Editor</Link><h1 className='mt-3 text-3xl font-semibold'>SVG Library</h1><p className='mt-1 text-slate-600'>Reusable artwork for your videos. Review assets before approving them.</p></div>
        <button className={`${buttonClass} bg-blue-600 text-white hover:bg-blue-700`} disabled={busy} onClick={() => open({ ...empty })}>Add SVG</button>
      </header>
      {error && <div role='alert' className='rounded-lg bg-red-50 p-3 text-red-700'>{error}</div>}
      {notice && <p role='status' className='text-green-700'>{notice}</p>}
      <div className='flex flex-wrap gap-3'>
        <input aria-label='Search assets' placeholder='Search names, descriptions, or tags…' className={`${inputClass} max-w-md`} value={query} onChange={e => setQuery(e.target.value)} />
        <select aria-label='Filter status' className='rounded-lg border p-2' value={filter} onChange={e => setFilter(e.target.value)}><option>All</option><option>Draft</option><option>Approved</option></select>
        <button className={buttonClass} disabled={loading || busy} onClick={() => void load()}>Refresh</button>
      </div>
      <div className={`grid gap-6 ${draft ? 'lg:grid-cols-2' : ''}`}>
        <section aria-label='Assets' className='grid content-start gap-4 sm:grid-cols-2'>
          {loading ? <p>Loading library…</p> : visible.length === 0 ? <p>No matching assets. Add an SVG to get started.</p> : visible.map(asset => <button disabled={busy} key={asset.id} onClick={() => open({ ...asset })} className={`rounded-xl border bg-white p-4 text-left shadow-sm ${draft?.id === asset.id ? 'ring-2 ring-blue-500' : ''}`}>
            <Preview svg={asset.svg} /><div className='mt-3 flex items-center justify-between gap-2'><h2 className='font-semibold'>{asset.name || 'Untitled asset'}</h2><span className={`rounded-full px-2 py-1 text-xs ${asset.status === 'Approved' ? 'bg-green-100 text-green-800' : 'bg-amber-100 text-amber-800'}`}>{asset.status}</span></div><p className='mt-2 line-clamp-2 text-sm text-slate-600'>{asset.description}</p><p className='mt-2 text-xs text-slate-500'>{asset.tags}</p>
          </button>)}
        </section>
        {draft && <section aria-label='Asset editor' className='space-y-4 rounded-xl border bg-white p-5 shadow-sm'>
          <div className='flex items-center justify-between'><h2 className='text-xl font-semibold'>{draft.id ? 'Edit SVG' : 'New SVG'}{dirty ? ' • Unsaved' : ''}</h2><button disabled={busy} className={buttonClass} onClick={() => open(null)}>Close</button></div>
          <fieldset disabled={busy} className='space-y-4'>
            <label className='block text-sm font-medium'>Name<input className={inputClass} value={draft.name} maxLength={200} onChange={e => update('name', e.target.value)} /></label>
            <label className='block text-sm font-medium'>Description<textarea className={inputClass} value={draft.description} onChange={e => update('description', e.target.value)} /></label>
            <label className='block text-sm font-medium'>Upload SVG<input type='file' accept='.svg,image/svg+xml' className='mt-1 block text-sm' onChange={async e => {
              const file = e.target.files?.[0]; e.target.value = ''; if (!file) return;
              try { if (file.size > SVG_MAX_BYTES) throw new Error('SVG must be smaller than 500 KB.'); const source = await file.text(); validateSvg(source); update('svg', source); setError(''); }
              catch (err) { setError(err instanceof Error ? err.message : 'Unable to read file.'); }
            }} /></label>
            <label className='block text-sm font-medium'>SVG Code<textarea spellCheck={false} className={`${inputClass} h-52 font-mono text-xs`} value={draft.svg} onChange={e => update('svg', e.target.value)} /></label>
            <Preview svg={draft.svg} />
            <p className='text-xs text-slate-500'>ViewBox and dimensions are extracted on save. Editing SVG code returns the asset to Draft.</p>
            <label className='block text-sm font-medium'>Tags<input className={inputClass} placeholder='browser, window, interface' value={draft.tags} onChange={e => update('tags', e.target.value)} /></label>
            <label className='block text-sm font-medium'>Usage Rules<textarea className={inputClass} value={draft.usageRules} onChange={e => update('usageRules', e.target.value)} /></label>
            <label className='block text-sm font-medium'>Status<select className={inputClass} value={draft.status} onChange={e => update('status', e.target.value)}><option>Draft</option><option>Approved</option></select></label>
          </fieldset>
          <div className='flex flex-wrap gap-2'>
            <button className={`${buttonClass} bg-blue-600 text-white hover:bg-blue-700`} disabled={busy || !draft.name.trim() || !draft.svg.trim()} onClick={() => void save()}>{busy ? 'Working…' : 'Save asset'}</button>
            <button className={buttonClass} disabled={busy} onClick={() => open({ ...draft, id: 0, name: `${draft.name} copy`, status: 'Draft' })}>Duplicate</button>
            {!!draft.id && <button className={`${buttonClass} text-red-700`} disabled={busy} onClick={() => void remove()}>Delete</button>}
          </div>
        </section>}
      </div>
    </div>
  </main>;
}
