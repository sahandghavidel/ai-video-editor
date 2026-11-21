'use client';

import { useEffect, useState } from 'react';
import type { PipelineLanguagePreset } from '@/lib/pipelineLanguagePresetsStore';
import { useAppStore } from '@/store/useAppStore';
import { getLanguageDisplayName } from '@/utils/languageNames';

interface Props {
  languages: string[];
  availableLanguages: string[] | null;
  disabled: boolean;
}

const endpoint = '/api/pipeline-language-presets';
const legacyStorageKey = 'pipelineLanguagePresets';

type PresetResponse = { presets?: PipelineLanguagePreset[]; conflicts?: string[]; error?: string };

const controlClass = 'rounded border border-teal-300 bg-white px-2 py-1 text-teal-900 disabled:opacity-50';

export default function PipelineLanguagePresets({ languages, availableLanguages, disabled }: Props) {
  const [presets, setPresets] = useState<PipelineLanguagePreset[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const updateConfig = useAppStore((state) => state.updatePipelineConfig);
  const [selectedName, setSelectedName] = useState('');
  const [draft, setDraft] = useState<{ name: string; count: string } | null>(null);
  const [notice, setNotice] = useState('');
  const preset = presets.find((entry) => entry.name === selectedName);
  const matchesPreset = preset && languages.length === preset.languages.length
    && languages.every((code, index) => code === preset.languages[index]);

  useEffect(() => {
    let mounted = true;
    const load = async () => {
      try {
        const response = await fetch(endpoint, { cache: 'no-store' });
        const shared = (await response.json()) as PresetResponse;
        if (!response.ok || !shared.presets) throw new Error(shared.error);
        if (!mounted) return;
        setPresets(shared.presets);
        const legacy = localStorage.getItem(legacyStorageKey);
        if (!legacy) return;
        const oldPresets: unknown = JSON.parse(legacy);
        if (!Array.isArray(oldPresets) || !oldPresets.length) return;
        const migration = await fetch(endpoint, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'import', presets: oldPresets }),
        });
        const imported = (await migration.json()) as PresetResponse;
        if (!migration.ok || !imported.presets) throw new Error(imported.error);
        if (!imported.conflicts?.length && localStorage.getItem(legacyStorageKey) === legacy) {
          localStorage.removeItem(legacyStorageKey);
        }
        if (!mounted) return;
        setPresets(imported.presets);
        if (imported.conflicts?.length) {
          setNotice(`Kept the shared versions of: ${imported.conflicts.join(', ')}. Local copies are still stored in this browser.`);
        }
      } catch (error) {
        if (mounted) setNotice(error instanceof Error && error.message
          ? error.message : 'Could not load shared language presets.');
      } finally {
        if (mounted) setLoading(false);
      }
    };
    void load();
    return () => { mounted = false; };
  }, []);

  const busy = disabled || loading || saving;

  const applyPreset = (name: string) => {
    const next = presets.find((entry) => entry.name === name);
    if (!next || !availableLanguages) return;
    const available = new Set(availableLanguages);
    const selection = next.languages.filter((code) => available.has(code));
    if (!selection.length) {
      setNotice(`No languages in “${next.name}” are currently available.`);
      return;
    }
    const missing = next.languages.filter((code) => !available.has(code));
    updateConfig({ selectedDubbedLanguagesForPipeline: selection });
    setSelectedName(name);
    setNotice(missing.length
      ? `Applied “${name}”. Skipped unavailable languages: ${missing.map(getLanguageDisplayName).join(', ')}.`
      : `Applied “${name}”.`);
  };

  const save = async (name: string, selection: string[], action: 'create' | 'update') => {
    if (busy) return;
    setSaving(true);
    try {
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, presets: [{ name, languages: selection }] }),
      });
      const result = (await response.json()) as PresetResponse;
      if (result.presets) setPresets(result.presets);
      if (!response.ok) throw new Error(result.error);
      if (selection.length === languages.length) setSelectedName(name);
      setDraft(null);
      setNotice(`Saved “${name}” with ${selection.length} languages.`);
    } catch (error) {
      setNotice(error instanceof Error && error.message
        ? error.message : 'Could not save the shared preset.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className='mt-2 space-y-2 text-xs'>
      <div className='flex flex-wrap items-center gap-2'>
        <label htmlFor='pipeline-language-preset' className='font-medium text-teal-900'>Language presets</label>
        <select
          id='pipeline-language-preset'
          className={controlClass}
          value={preset?.name ?? ''}
          disabled={busy || !availableLanguages || !presets.length}
          onChange={(event) => applyPreset(event.target.value)}
        >
          <option value='' disabled>Choose a preset</option>
          {presets.map((entry) => (
            <option key={entry.name} value={entry.name}>{entry.name} ({entry.languages.length})</option>
          ))}
        </select>
        <button
          type='button'
          className={controlClass}
          disabled={busy || !languages.length}
          onClick={() => {
            setDraft({ name: '', count: String(languages.length) });
            setNotice('');
          }}
        >
          Save as preset
        </button>
        {preset && !matchesPreset && (
          <button
            type='button'
            className={controlClass}
            disabled={busy || !availableLanguages}
            onClick={() => applyPreset(preset.name)}
          >
            Reapply preset
          </button>
        )}
        {preset && (
          <button
            type='button'
            className={controlClass}
            disabled={busy || !languages.length || matchesPreset}
            onClick={() => void save(preset.name, languages, 'update')}
          >
            Update preset
          </button>
        )}
      </div>
      {draft && (
        <form
          className='flex flex-wrap items-end gap-2'
          onSubmit={(event) => {
            event.preventDefault();
            if (busy) return;
            const name = draft.name.trim();
            const count = Number(draft.count);
            if (!name || !Number.isInteger(count) || count < 1 || count > languages.length) return;
            if (presets.some((entry) => entry.name.toLowerCase() === name.toLowerCase())) {
              setNotice('That name is already in use. Choose a different name or update the existing preset.');
              return;
            }
            void save(name, languages.slice(0, count), 'create');
          }}
        >
          <label className='grid gap-1 text-teal-900'>
            Preset name
            <input
              required
              className={controlClass}
              value={draft.name}
              onChange={(event) => setDraft({ ...draft, name: event.target.value })}
            />
          </label>
          <label className='grid gap-1 text-teal-900'>
            First languages to save
            <input
              required
              type='number'
              min={1}
              max={languages.length}
              className={controlClass}
              value={draft.count}
              onChange={(event) => setDraft({ ...draft, count: event.target.value })}
            />
          </label>
          <button type='submit' disabled={busy} className={controlClass}>Save language preset</button>
          <button type='button' className={controlClass} onClick={() => setDraft(null)}>Cancel</button>
        </form>
      )}
      {notice && <p role='status' className='text-teal-900'>{notice}</p>}
    </div>
  );
}
