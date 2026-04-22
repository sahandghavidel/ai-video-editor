'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Loader2, Plus, Save, Trash2, Wand2, X } from 'lucide-react';

type ReplacementEntry = {
  id: string;
  word: string;
  replacement: string;
  updatedAt?: string;
};

interface TTSWordReplacementsModalProps {
  isOpen: boolean;
  onClose: () => void;
  onApplied?: () => void;
}

const createLocalEntryId = () =>
  `local-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function TTSWordReplacementsModal({
  isOpen,
  onClose,
  onApplied,
}: TTSWordReplacementsModalProps) {
  const [entries, setEntries] = useState<ReplacementEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [applying, setApplying] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const isBusy = loading || saving || applying;

  const normalizedEntries = useMemo(
    () =>
      entries.map((entry) => ({
        id: entry.id,
        word: entry.word,
        replacement: entry.replacement,
      })),
    [entries],
  );

  const loadEntries = useCallback(async () => {
    setLoading(true);
    setError(null);
    setStatus(null);

    try {
      const response = await fetch('/api/tts-word-replacements', {
        method: 'GET',
        cache: 'no-store',
      });

      const payload = (await response.json().catch(() => null)) as {
        entries?: unknown;
        error?: unknown;
      } | null;

      if (!response.ok) {
        const message =
          typeof payload?.error === 'string'
            ? payload.error
            : `Failed to load replacements (${response.status})`;
        throw new Error(message);
      }

      const loadedEntries = Array.isArray(payload?.entries)
        ? (payload.entries as ReplacementEntry[])
        : [];

      setEntries(loadedEntries);
    } catch (loadError) {
      setError(getErrorMessage(loadError));
      setEntries([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!isOpen) return;
    void loadEntries();
  }, [isOpen, loadEntries]);

  useEffect(() => {
    if (!isOpen) return;

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !isBusy) {
        onClose();
      }
    };

    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [isOpen, isBusy, onClose]);

  const handleAddEntry = () => {
    setEntries((prev) => [
      ...prev,
      { id: createLocalEntryId(), word: '', replacement: '' },
    ]);
    setStatus(null);
    setError(null);
  };

  const handleUpdateEntry = (
    id: string,
    key: 'word' | 'replacement',
    value: string,
  ) => {
    setEntries((prev) =>
      prev.map((entry) =>
        entry.id === id ? { ...entry, [key]: value } : entry,
      ),
    );
  };

  const handleDeleteEntry = (id: string) => {
    setEntries((prev) => prev.filter((entry) => entry.id !== id));
    setStatus(null);
    setError(null);
  };

  const handleSave = async () => {
    setSaving(true);
    setError(null);
    setStatus(null);

    try {
      const response = await fetch('/api/tts-word-replacements', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ entries: normalizedEntries }),
      });

      const payload = (await response.json().catch(() => null)) as {
        entries?: unknown;
        error?: unknown;
      } | null;

      if (!response.ok) {
        const message =
          typeof payload?.error === 'string'
            ? payload.error
            : `Failed to save replacements (${response.status})`;
        throw new Error(message);
      }

      const savedEntries = Array.isArray(payload?.entries)
        ? (payload.entries as ReplacementEntry[])
        : [];

      setEntries(savedEntries);
      setStatus(
        `Dictionary saved with ${savedEntries.length} entr${
          savedEntries.length === 1 ? 'y' : 'ies'
        }.`,
      );
    } catch (saveError) {
      setError(getErrorMessage(saveError));
    } finally {
      setSaving(false);
    }
  };

  const handleApply = async () => {
    setApplying(true);
    setError(null);
    setStatus(null);

    try {
      const response = await fetch('/api/apply-tts-word-replacements', {
        method: 'POST',
      });

      const payload = (await response.json().catch(() => null)) as {
        error?: unknown;
        message?: unknown;
        scannedScenes?: unknown;
        changedScenes?: unknown;
        updatedScenes?: unknown;
        failedUpdates?: unknown;
      } | null;

      if (!response.ok) {
        const message =
          typeof payload?.error === 'string'
            ? payload.error
            : `Failed to apply replacements (${response.status})`;
        throw new Error(message);
      }

      const scannedScenes = Number(payload?.scannedScenes ?? 0);
      const changedScenes = Number(payload?.changedScenes ?? 0);
      const updatedScenes = Number(payload?.updatedScenes ?? 0);
      const failedCount = Array.isArray(payload?.failedUpdates)
        ? payload.failedUpdates.length
        : 0;

      const message =
        typeof payload?.message === 'string' &&
        payload.message.trim().length > 0
          ? payload.message
          : 'Replacement run completed.';

      const failureSuffix = failedCount > 0 ? `, failed ${failedCount}` : '';

      setStatus(
        `${message} Scanned ${scannedScenes} scene(s), changed ${changedScenes}, updated ${updatedScenes}${failureSuffix}.`,
      );

      onApplied?.();
    } catch (applyError) {
      setError(getErrorMessage(applyError));
    } finally {
      setApplying(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div
      className='fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4'
      onClick={() => {
        if (!isBusy) onClose();
      }}
    >
      <div
        className='w-full max-w-3xl bg-white rounded-xl shadow-2xl border border-gray-200 overflow-hidden'
        onClick={(event) => event.stopPropagation()}
      >
        <div className='px-5 py-4 border-b border-gray-200 flex items-start justify-between gap-3'>
          <div>
            <h3 className='text-lg font-semibold text-gray-900'>
              TTS Word Replacements
            </h3>
            <p className='text-sm text-gray-600 mt-1'>
              Save a local dictionary of pronunciation-friendly replacements.
              Matching is whole-word and case-sensitive.
            </p>
            <p className='text-xs text-gray-500 mt-1'>
              Leading/trailing spaces are preserved in both fields.
            </p>
          </div>
          <button
            onClick={onClose}
            disabled={isBusy}
            className='p-2 rounded-md text-gray-500 hover:bg-gray-100 hover:text-gray-800 disabled:opacity-50 disabled:cursor-not-allowed'
            title='Close'
          >
            <X className='w-5 h-5' />
          </button>
        </div>

        <div className='px-5 py-4 space-y-3 max-h-[55vh] overflow-y-auto'>
          {loading ? (
            <div className='flex items-center justify-center py-8 text-gray-600 gap-2'>
              <Loader2 className='w-4 h-4 animate-spin' />
              <span>Loading dictionary...</span>
            </div>
          ) : entries.length === 0 ? (
            <div className='rounded-lg border border-dashed border-gray-300 bg-gray-50 p-4 text-sm text-gray-600'>
              No entries yet. Add your first word replacement.
            </div>
          ) : (
            entries.map((entry, index) => (
              <div
                key={entry.id}
                className='grid grid-cols-1 md:grid-cols-[1fr_1fr_auto] gap-2 items-center bg-gray-50 border border-gray-200 rounded-lg p-3'
              >
                <input
                  type='text'
                  value={entry.word}
                  onChange={(event) =>
                    handleUpdateEntry(entry.id, 'word', event.target.value)
                  }
                  placeholder='Word (case-sensitive)'
                  className='w-full px-3 py-2 rounded-md border border-gray-300 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 text-sm'
                />
                <input
                  type='text'
                  value={entry.replacement}
                  onChange={(event) =>
                    handleUpdateEntry(
                      entry.id,
                      'replacement',
                      event.target.value,
                    )
                  }
                  placeholder='Replacement'
                  className='w-full px-3 py-2 rounded-md border border-gray-300 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 text-sm'
                />
                <button
                  onClick={() => handleDeleteEntry(entry.id)}
                  className='inline-flex items-center justify-center gap-1 px-3 py-2 rounded-md bg-red-100 text-red-700 hover:bg-red-200 transition-colors text-sm font-medium'
                  title={`Delete entry #${index + 1}`}
                >
                  <Trash2 className='w-4 h-4' />
                  <span>Delete</span>
                </button>
              </div>
            ))
          )}

          <button
            onClick={handleAddEntry}
            disabled={loading}
            className='inline-flex items-center gap-2 px-3 py-2 rounded-md bg-indigo-100 text-indigo-700 hover:bg-indigo-200 transition-colors text-sm font-medium disabled:opacity-50 disabled:cursor-not-allowed'
          >
            <Plus className='w-4 h-4' />
            Add Entry
          </button>

          {status && (
            <div className='rounded-md border border-green-200 bg-green-50 text-green-800 text-sm px-3 py-2'>
              {status}
            </div>
          )}
          {error && (
            <div className='rounded-md border border-red-200 bg-red-50 text-red-700 text-sm px-3 py-2'>
              {error}
            </div>
          )}
        </div>

        <div className='px-5 py-4 border-t border-gray-200 bg-gray-50 flex flex-wrap items-center justify-end gap-2'>
          <button
            onClick={onClose}
            disabled={isBusy}
            className='px-4 py-2 rounded-md bg-gray-200 text-gray-700 hover:bg-gray-300 transition-colors text-sm font-medium disabled:opacity-50 disabled:cursor-not-allowed'
          >
            Close
          </button>
          <button
            onClick={handleSave}
            disabled={isBusy}
            className='inline-flex items-center gap-2 px-4 py-2 rounded-md bg-indigo-600 text-white hover:bg-indigo-700 transition-colors text-sm font-medium disabled:opacity-50 disabled:cursor-not-allowed'
            title='Save dictionary to local JSON file'
          >
            {saving ? (
              <Loader2 className='w-4 h-4 animate-spin' />
            ) : (
              <Save className='w-4 h-4' />
            )}
            Save Dictionary
          </button>
          <button
            onClick={handleApply}
            disabled={isBusy}
            className='inline-flex items-center gap-2 px-4 py-2 rounded-md bg-emerald-600 text-white hover:bg-emerald-700 transition-colors text-sm font-medium disabled:opacity-50 disabled:cursor-not-allowed'
            title='Apply saved dictionary to all scene sentences (field_6890)'
          >
            {applying ? (
              <Loader2 className='w-4 h-4 animate-spin' />
            ) : (
              <Wand2 className='w-4 h-4' />
            )}
            Apply to All Scenes
          </button>
        </div>
      </div>
    </div>
  );
}
