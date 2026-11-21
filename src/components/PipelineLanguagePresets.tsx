'use client';

import { useState } from 'react';
import { useAppStore } from '@/store/useAppStore';
import { getLanguageDisplayName } from '@/utils/languageNames';

interface Props {
  languages: string[];
  availableLanguages: string[] | null;
  disabled: boolean;
}

const controlClass = 'rounded border border-teal-300 bg-white px-2 py-1 text-teal-900 disabled:opacity-50';

export default function PipelineLanguagePresets({ languages, availableLanguages, disabled }: Props) {
  const presets = useAppStore((state) => state.pipelineLanguagePresets);
  const savePreset = useAppStore((state) => state.savePipelineLanguagePreset);
  const updateConfig = useAppStore((state) => state.updatePipelineConfig);
  const [selectedName, setSelectedName] = useState('');
  const [draft, setDraft] = useState<{ name: string; count: string } | null>(null);
  const [notice, setNotice] = useState('');
  const preset = presets.find((entry) => entry.name === selectedName);
  const matchesPreset = preset && languages.length === preset.languages.length
    && languages.every((code, index) => code === preset.languages[index]);

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

  const save = (name: string, selection: string[]) => {
    try {
      savePreset(name, selection);
      if (selection.length === languages.length) setSelectedName(name);
      setDraft(null);
      setNotice(`Saved “${name}” with ${selection.length} languages.`);
    } catch {
      setNotice('Could not save the preset in this browser.');
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
          disabled={disabled || !availableLanguages || !presets.length}
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
          disabled={disabled || !languages.length}
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
            disabled={disabled || !availableLanguages}
            onClick={() => applyPreset(preset.name)}
          >
            Reapply preset
          </button>
        )}
        {preset && (
          <button
            type='button'
            className={controlClass}
            disabled={disabled || !languages.length || matchesPreset}
            onClick={() => save(preset.name, languages)}
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
            if (disabled) return;
            const name = draft.name.trim();
            const count = Number(draft.count);
            if (!name || !Number.isInteger(count) || count < 1 || count > languages.length) return;
            if (presets.some((entry) => entry.name.toLowerCase() === name.toLowerCase())) {
              setNotice('That name is already in use. Choose a different name or update the existing preset.');
              return;
            }
            save(name, languages.slice(0, count));
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
          <button type='submit' disabled={disabled} className={controlClass}>Save language preset</button>
          <button type='button' className={controlClass} onClick={() => setDraft(null)}>Cancel</button>
        </form>
      )}
      {notice && <p role='status' className='text-teal-900'>{notice}</p>}
    </div>
  );
}
