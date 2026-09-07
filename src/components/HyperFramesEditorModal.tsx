'use client';

import { Loader2, Save, X } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';

type HyperFramesEditorModalProps = {
  isOpen: boolean;
  sceneId: number;
  onClose: () => void;
  onSaved: (html: string) => void;
};

export function HyperFramesEditorModal({
  isOpen,
  sceneId,
  onClose,
  onSaved,
}: HyperFramesEditorModalProps) {
  const [studioUrl, setStudioUrl] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [message, setMessage] = useState('');

  const requestAction = useCallback(
    async (action: 'open' | 'save' | 'stop') => {
      const response = await fetch('/api/hyperframes-editor', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, sceneId }),
      });
      const data = (await response.json().catch(() => null)) as {
        studioUrl?: unknown;
        html?: unknown;
        error?: unknown;
      } | null;
      if (!response.ok) {
        throw new Error(
          typeof data?.error === 'string' ? data.error : `Editor ${action} failed`,
        );
      }
      return data;
    },
    [sceneId],
  );

  useEffect(() => {
    if (!isOpen) return;
    let cancelled = false;
    setStudioUrl('');
    setMessage('');
    setIsLoading(true);
    void requestAction('open')
      .then((data) => {
        if (cancelled) return;
        const url = typeof data?.studioUrl === 'string' ? data.studioUrl : '';
        if (!url) throw new Error('Editor returned an empty Studio URL');
        setStudioUrl(url);
      })
      .catch((error) => {
        if (!cancelled) {
          setMessage(error instanceof Error ? error.message : 'Editor failed to open');
        }
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [isOpen, requestAction]);

  const handleSave = useCallback(async () => {
    if (isSaving) return;
    setIsSaving(true);
    setMessage('Saving visual edits…');
    try {
      const data = await requestAction('save');
      const html = typeof data?.html === 'string' ? data.html : '';
      if (!html) throw new Error('Editor returned empty HyperFrames HTML');
      onSaved(html);
      setMessage('Saved to this scene');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Failed to save edits');
    } finally {
      setIsSaving(false);
    }
  }, [isSaving, onSaved, requestAction]);

  const handleClose = useCallback(() => {
    void requestAction('stop');
    onClose();
  }, [onClose, requestAction]);

  if (!isOpen) return null;

  return (
    <div className='fixed inset-0 z-[90] flex items-center justify-center bg-black/75 p-3'>
      <div className='flex h-[96vh] w-[98vw] flex-col overflow-hidden rounded-xl bg-white shadow-2xl'>
        <header className='flex items-center justify-between gap-4 border-b px-5 py-3'>
          <div>
            <h2 className='text-lg font-semibold'>Visual HyperFrames Editor</h2>
            <p className='text-xs text-gray-500'>Use the preview, play controls, and timeline to adjust this scene.</p>
          </div>
          <div className='flex items-center gap-3'>
            {message ? <span className='max-w-[420px] truncate text-sm text-gray-600'>{message}</span> : null}
            <button
              type='button'
              onClick={handleSave}
              disabled={!studioUrl || isLoading || isSaving}
              className='inline-flex items-center gap-2 rounded bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:cursor-not-allowed disabled:opacity-50'
            >
              {isSaving ? <Loader2 className='h-4 w-4 animate-spin' /> : <Save className='h-4 w-4' />}
              Save to Scene
            </button>
            <button type='button' onClick={handleClose} className='rounded p-2 hover:bg-gray-100' aria-label='Close HyperFrames editor'>
              <X className='h-5 w-5' />
            </button>
          </div>
        </header>
        <div className='relative flex-1 bg-slate-950'>
          {isLoading ? (
            <div className='absolute inset-0 flex items-center justify-center gap-3 text-white'>
              <Loader2 className='h-6 w-6 animate-spin' />
              Starting HyperFrames Studio…
            </div>
          ) : studioUrl ? (
            <iframe
              src={studioUrl}
              title='HyperFrames Studio'
              className='h-full w-full border-0'
              allow='autoplay; clipboard-read; clipboard-write'
            />
          ) : (
            <div className='absolute inset-0 flex items-center justify-center px-8 text-center text-red-300'>{message || 'Unable to open HyperFrames Studio'}</div>
          )}
        </div>
      </div>
    </div>
  );
}
