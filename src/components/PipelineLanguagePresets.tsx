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

type ManagementAction = 'duplicate' | 'rename' | 'delete';
type ManagementDraft = { action: ManagementAction; source: PipelineLanguagePreset; name: string };
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
  const [managerOpen, setManagerOpen] = useState(false);
  const [management, setManagement] = useState<ManagementDraft | null>(null);
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

  const saveChange = async (body: object) => {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const result = (await response.json()) as PresetResponse;
    if (result.presets) setPresets(result.presets);
    if (!response.ok) throw new Error(result.error);
  };

  const save = async (name: string, selection: string[], action: 'create' | 'update') => {
    if (busy) return;
    setSaving(true);
    try {
      await saveChange({ action, presets: [{ name, languages: selection }], source: action === 'update' ? preset : undefined });
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

  const openManager = async () => {
    setManagerOpen(true);
    setDraft(null);
    setNotice('');
    setLoading(true);
    try {
      const response = await fetch(endpoint, { cache: 'no-store' });
      const result = (await response.json()) as PresetResponse;
      if (!response.ok || !result.presets) throw new Error(result.error);
      setPresets(result.presets);
    } catch (error) {
      setNotice(error instanceof Error && error.message
        ? error.message : 'Could not load shared language presets.');
    } finally {
      setLoading(false);
    }
  };

  const startManagement = (action: ManagementAction, source: PipelineLanguagePreset) => {
    setNotice('');
    setManagement({ action, source, name: action === 'duplicate' ? `${source.name} copy` : source.name });
  };

  const commitManagement = async () => {
    if (busy || !management) return;
    const { action, source } = management;
    const name = management.name.trim();
    if (action !== 'delete' && !name) return;
    setSaving(true);
    try {
      await saveChange({ action, source, name });
      if (selectedName === source.name && action !== 'duplicate') {
        setSelectedName(action === 'rename' ? name : '');
      }
      setManagement(null);
      const message = {
        duplicate: `Duplicated “${source.name}” as “${name}”.`,
        rename: `Renamed “${source.name}” to “${name}”.`,
        delete: `Deleted “${source.name}”. Your pipeline language selection is unchanged.`,
      };
      setNotice(message[action]);
    } catch (error) {
      setManagement(null);
      setNotice(error instanceof Error && error.message
        ? error.message : 'Could not change the shared preset.');
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
            setManagerOpen(false);
            setManagement(null);
            setDraft({ name: '', count: String(languages.length) });
            setNotice('');
          }}
        >
          Save as preset
        </button>
        <button
          type='button'
          className={controlClass}
          disabled={busy}
          aria-expanded={managerOpen}
          onClick={() => {
            if (managerOpen) {
              setManagerOpen(false);
              setManagement(null);
            } else {
              void openManager();
            }
          }}
        >
          {managerOpen ? 'Close Manage Presets' : 'Manage Presets'}
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
      {managerOpen && (
        <section aria-label='Manage language presets' className='rounded-md border border-teal-200 bg-white p-2'>
          {loading ? <p role='status'>Loading shared presets…</p> : !presets.length ? (
            <p>No saved presets.</p>
          ) : (
            <ul className='divide-y divide-teal-100'>
              {presets.map((entry) => (
                <li key={entry.name} className='flex flex-wrap items-center justify-between gap-2 py-1.5'>
                  <span className='font-medium text-teal-900'>{entry.name} ({entry.languages.length})</span>
                  <div className='flex gap-1'>
                    <button type='button' className={controlClass} disabled={busy} onClick={() => startManagement('duplicate', entry)} aria-label={`Duplicate ${entry.name}`}>Duplicate</button>
                    <button type='button' className={controlClass} disabled={busy} onClick={() => startManagement('rename', entry)} aria-label={`Rename ${entry.name}`}>Rename</button>
                    <button type='button' className={controlClass} disabled={busy} onClick={() => startManagement('delete', entry)} aria-label={`Delete ${entry.name}`}>Delete</button>
                  </div>
                  {management?.source.name === entry.name && (
                    <form
                      className='flex w-full flex-wrap items-center gap-2 rounded bg-teal-50 p-2'
                      onSubmit={(event) => {
                        event.preventDefault();
                        void commitManagement();
                      }}
                    >
                      {management.action === 'delete' ? (
                        <p>Delete “{entry.name}” from the shared presets? The current pipeline selection stays applied.</p>
                      ) : (
                        <label className='flex items-center gap-2'>
                          {management.action === 'duplicate' ? 'Copy name' : 'New preset name'}
                          <input
                            required
                            className={controlClass}
                            disabled={busy}
                            value={management.name}
                            onChange={(event) => setManagement({ ...management, name: event.target.value })}
                          />
                        </label>
                      )}
                      <button type='submit' className={controlClass} disabled={busy}>
                        {{ duplicate: 'Save copy', rename: 'Save name', delete: 'Confirm delete' }[management.action]}
                      </button>
                      <button type='button' className={controlClass} disabled={busy} onClick={() => setManagement(null)}>Cancel</button>
                    </form>
                  )}
                </li>
              ))}
            </ul>
          )}
        </section>
      )}
      {notice && <p role='status' className='text-teal-900'>{notice}</p>}
    </div>
  );
}
