'use client';

import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { formatStorageSize, type StorageGroup } from '@/lib/storage-manager';
import { sendTelegramNotification } from '@/utils/notifications/telegram';
import { deleteStorageMatch, requestStorage } from '@/utils/storage-manager-client';

type Progress = {
  status: 'Waiting' | 'Deleting' | 'Completed' | 'Completed with errors' | 'Stopped';
  deleted: number;
  missing: number;
  failures: { key: string; error: string }[];
};

export default function StorageManagerPage() {
  const [keywords, setKeywords] = useState('');
  const [groups, setGroups] = useState<StorageGroup[] | null>(null);
  const [progress, setProgress] = useState<Progress[]>([]);
  const [busy, setBusy] = useState<'preview' | 'delete' | null>(null);
  const [error, setError] = useState('');
  const [notificationError, setNotificationError] = useState('');
  const [finished, setFinished] = useState(false);
  const [loadingDefaults, setLoadingDefaults] = useState(true);
  const keywordsEdited = useRef(false);
  const stop = useRef(false);
  const running = useRef(false);
  const totalFiles = groups?.reduce((sum, group) => sum + group.files.length, 0) || 0;
  const totalSize = groups?.reduce((sum, group) => sum + group.files.reduce((sum, file) => sum + file.size, 0), 0) || 0;
  const buttonClass = 'rounded-lg px-4 py-2 text-sm font-medium disabled:cursor-not-allowed disabled:opacity-50';

  useEffect(() => {
    const controller = new AbortController();
    async function loadDefaults() {
      try {
        const response = await fetch('/api/tts-audio-references', { cache: 'no-store', signal: controller.signal });
        if (!response.ok) throw new Error('Unable to load language defaults. You can enter keywords manually.');
        const payload = await response.json();
        if (!Array.isArray(payload.entries)) throw new Error('Unable to load language defaults. You can enter keywords manually.');
        const codes = [...new Set<string>(payload.entries
          .filter((entry: { enabled?: boolean; language?: unknown } | null) => entry && entry.enabled !== false && typeof entry.language === 'string')
          .map((entry: { language: string }) => entry.language.trim().toLowerCase())
          .filter((code: string) => code && code !== 'en'))].sort();
        if (!keywordsEdited.current) setKeywords(codes.map(code => `_${code}_`).join(','));
      } catch (error) {
        if (!controller.signal.aborted && !keywordsEdited.current) setError(error instanceof Error ? error.message : 'Unable to load language defaults.');
      } finally {
        if (!controller.signal.aborted) setLoadingDefaults(false);
      }
    }
    void loadDefaults();
    return () => controller.abort();
  }, []);

  async function notifyCompletion(message: string) {
    const result = await sendTelegramNotification(message);
    if (!result.success) {
      console.warn(`[Telegram] Storage Manager completion notification failed: ${result.error || 'Unknown error'}`);
      setNotificationError('Storage operation finished, but the Telegram notification could not be sent.');
    }
  }

  async function preview() {
    if (running.current) return;
    running.current = true;
    setBusy('preview'); setError(''); setNotificationError(''); setGroups(null); setProgress([]); setFinished(false);
    try {
      const data = await requestStorage({ action: 'preview', keywords });
      setGroups(data.groups);
      const matchedGroups: StorageGroup[] = data.groups;
      const files = matchedGroups.flatMap(group => group.files);
      await notifyCompletion(`✅ Storage Manager preview completed\nKeywords: ${matchedGroups.length}\nMatching files: ${files.length}\nMatched size: ${formatStorageSize(files.reduce((sum, file) => sum + file.size, 0))}`);
    } catch (error) {
      setError(error instanceof Error ? error.message : 'Unable to preview files.');
    } finally { setBusy(null); running.current = false; }
  }

  async function deleteMatches() {
    if (!groups || running.current || !totalFiles || finished) return;
    if (!window.confirm(`Permanently delete ${totalFiles} files (${formatStorageSize(totalSize)}) from MinIO? Existing links to these files will stop working.`)) return;
    running.current = true;
    stop.current = false;
    setBusy('delete'); setError(''); setNotificationError('');
    const results: Progress[] = groups.map(() => ({ status: 'Waiting', deleted: 0, missing: 0, failures: [] }));
    const update = () => setProgress(results.map(result => ({ ...result, failures: [...result.failures] })));
    update();
    try {
      for (let index = 0; index < groups.length; index++) {
        const result = results[index];
        if (stop.current) { result.status = 'Stopped'; update(); continue; }
        result.status = 'Deleting'; update();
        for (const file of groups[index].files) {
          if (stop.current) break;
          try {
            const deletion = await deleteStorageMatch(file);
            if (deletion === 'missing') result.missing++;
            else result.deleted++;
          } catch (error) {
            result.failures.push({ key: file.key, error: error instanceof Error ? error.message : 'Deletion failed.' });
          }
          update();
        }
        result.status = stop.current ? 'Stopped' : result.failures.length ? 'Completed with errors' : 'Completed';
        update();
      }
      if (results.every(result => result.status === 'Completed' || result.status === 'Completed with errors')) {
        const deleted = results.reduce((sum, result) => sum + result.deleted, 0);
        const missing = results.reduce((sum, result) => sum + result.missing, 0);
        const failed = results.reduce((sum, result) => sum + result.failures.length, 0);
        await notifyCompletion(`${failed ? '⚠️ Storage Manager deletion finished with errors' : '✅ Storage Manager deletion completed'}\nKeywords processed: ${groups.length}\nDeleted: ${deleted}\nAlready missing: ${missing}\nFailed: ${failed}`);
      }
    } finally {
      setFinished(true); setBusy(null); running.current = false;
    }
  }

  return (
    <main className='min-h-screen bg-slate-50 p-6 text-slate-900'>
      <div className='mx-auto max-w-5xl space-y-6'>
        <header>
          <Link href='/' onClick={event => { if (busy) event.preventDefault(); }} aria-disabled={!!busy} className='text-sm text-blue-700'>← Video Editor</Link>
          <h1 className='mt-3 text-3xl font-semibold'>Storage Manager</h1>
          <p className='mt-2 text-slate-600'>Delete MinIO files whose names or paths contain your keywords.</p>
        </header>
        <section className='space-y-4 rounded-xl border bg-white p-6'>
          <label htmlFor='storage-keywords' className='block font-medium'>Keywords separated by commas</label>
          <textarea id='storage-keywords' rows={6} value={keywords} disabled={!!busy} onChange={event => { keywordsEdited.current = true; setKeywords(event.target.value); setGroups(null); setProgress([]); setFinished(false); setError(''); setNotificationError(''); }} placeholder={loadingDefaults ? 'Loading language defaults…' : 'apple,orange'} className='min-h-40 w-full resize-y rounded-lg border border-slate-300 px-3 py-2 font-mono text-sm leading-6 disabled:bg-slate-100' />
          <p className='text-sm text-slate-600'>{loadingDefaults ? 'Loading available translation languages…' : 'Defaults include available translation languages except English, with underscores around each code. You can edit this list.'}</p>
          <p className='text-sm text-slate-600'>Matches ignore capitalization. Keywords run in order; a file matching several keywords belongs to the first match. Empty keywords and duplicates are ignored.</p>
          <p className='text-sm text-amber-800'>Deletion is permanent. Baserow records stay in place, but their links to deleted files will stop working.</p>
          <div className='flex flex-wrap gap-3'>
            <button onClick={preview} disabled={!!busy || !keywords.trim()} className={`${buttonClass} bg-blue-600 text-white hover:bg-blue-700`}>{busy === 'preview' ? 'Scanning storage…' : 'Preview matches'}</button>
            <button onClick={deleteMatches} disabled={!!busy || !totalFiles || finished} className={`${buttonClass} bg-red-600 text-white hover:bg-red-700`}>Delete matched files</button>
            {busy === 'delete' && <button onClick={() => { stop.current = true; }} className={`${buttonClass} border border-slate-300 bg-white`}>Stop after current file</button>}
          </div>
          {error && <p role='alert' className='text-sm text-red-700'>{error}</p>}
          {notificationError && <p role='status' className='text-sm text-amber-800'>{notificationError}</p>}
        </section>
        {groups && (
          <section className='space-y-4' aria-live='polite'>
            <p className='font-medium'>{totalFiles} unique files · {formatStorageSize(totalSize)}{finished ? ' in the original preview. Preview again to refresh or retry.' : ' matched.'}</p>
            {busy === 'delete' && <p className='text-sm text-slate-600'>Keep this page open until deletion finishes.</p>}
            {groups.map((group, index) => {
              const result = progress[index];
              const bytes = group.files.reduce((sum, file) => sum + file.size, 0);
              return (
                <article key={group.keyword} className='rounded-xl border bg-white p-5'>
                  <div className='flex flex-wrap items-center justify-between gap-2'>
                    <h2 className='text-lg font-semibold'>{index + 1}. {group.keyword}</h2>
                    <span className='text-sm text-slate-600'>{group.files.length} files · {formatStorageSize(bytes)}</span>
                  </div>
                  {result && <p className='mt-2 text-sm'>{result.status} · {result.deleted} deleted · {result.missing} already missing · {result.failures.length} failed</p>}
                  {!group.files.length ? <p className='mt-3 text-sm text-slate-500'>No additional matching files.</p> : (
                    <details className='mt-3'>
                      <summary className='cursor-pointer text-sm text-blue-700'>View matching files</summary>
                      <ul className='mt-2 max-h-72 overflow-auto divide-y text-sm'>
                        {group.files.map(file => <li key={file.key} className='flex justify-between gap-4 py-2'><span className='break-all'>{file.key}</span><span className='shrink-0 text-slate-500'>{formatStorageSize(file.size)}</span></li>)}
                      </ul>
                    </details>
                  )}
                  {!!result?.failures.length && <ul className='mt-3 max-h-48 overflow-auto space-y-2 text-sm text-red-700'>{result.failures.map(failure => <li key={failure.key} className='break-all'>{failure.key}: {failure.error}</li>)}</ul>}
                </article>
              );
            })}
          </section>
        )}
      </div>
    </main>
  );
}
