'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Loader2, Plus, Save, Trash2, X } from 'lucide-react';

type DeviceMap = 'mps' | 'cpu' | 'auto';
type DType = 'float16' | 'float32' | 'bfloat16';

type BaserowLanguageFields = {
  videoSrtFieldKey: string;
  videoReferenceSrtFieldKey: string;
  videoFinalDubbedAudioFieldKey: string;
  sceneDurationFieldKey: string;
  sceneReferenceSentenceFieldKey: string;
  sceneTargetSentenceFieldKey: string;
  sceneDubbedAudioFieldKey: string;
  sceneOriginalAudioFieldKey: string;
};

type AudioReferenceEntry = {
  id: string;
  name: string;
  filename: string;
  language: string;
  referenceText: string;
  baserowFields: BaserowLanguageFields;
  deviceMap: DeviceMap;
  dtype: DType;
  numStep: number;
  speed: number;
  description: string;
  tags: string[];
  isDefault: boolean;
  enabled: boolean;
  updatedAt?: string;
};

interface TTSAudioReferencesModalProps {
  isOpen: boolean;
  onClose: () => void;
}

const createLocalEntryId = () =>
  `audio-ref-local-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;

const FIELD_KEY_REGEX = /^field_\d+$/;

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function asFieldKey(value: unknown, fallback: string): string {
  if (typeof value !== 'string') return fallback;
  const trimmed = value.trim();
  return FIELD_KEY_REGEX.test(trimmed) ? trimmed : fallback;
}

function asOptionalFieldKey(value: unknown): string {
  if (typeof value !== 'string') return '';
  const trimmed = value.trim();
  return FIELD_KEY_REGEX.test(trimmed) ? trimmed : '';
}

function normalizeEntry(raw: unknown): AudioReferenceEntry | null {
  if (!raw || typeof raw !== 'object') return null;
  const entry = raw as Record<string, unknown>;

  const filename =
    typeof entry.filename === 'string' ? entry.filename.trim() : '';
  if (!filename) return null;

  const id =
    typeof entry.id === 'string' && entry.id.trim().length > 0
      ? entry.id.trim()
      : createLocalEntryId();

  const nameRaw = typeof entry.name === 'string' ? entry.name.trim() : '';
  const languageRaw =
    typeof entry.language === 'string' ? entry.language.trim() : '';

  const deviceMap: DeviceMap =
    entry.deviceMap === 'cpu' ||
    entry.deviceMap === 'auto' ||
    entry.deviceMap === 'mps'
      ? entry.deviceMap
      : 'mps';

  const dtype: DType =
    entry.dtype === 'float16' ||
    entry.dtype === 'float32' ||
    entry.dtype === 'bfloat16'
      ? entry.dtype
      : 'float32';

  const numStepRaw =
    typeof entry.numStep === 'number'
      ? entry.numStep
      : typeof entry.numStep === 'string'
        ? Number(entry.numStep)
        : Number.NaN;
  const numStep = Number.isFinite(numStepRaw)
    ? Math.round(clamp(numStepRaw, 8, 64))
    : 64;

  const speedRaw =
    typeof entry.speed === 'number'
      ? entry.speed
      : typeof entry.speed === 'string'
        ? Number(entry.speed)
        : Number.NaN;
  const speed = Number.isFinite(speedRaw) ? clamp(speedRaw, 0.5, 2) : 1;

  const baserowFieldsRaw =
    entry.baserowFields && typeof entry.baserowFields === 'object'
      ? (entry.baserowFields as Record<string, unknown>)
      : {};

  const baserowFields: BaserowLanguageFields = {
    videoSrtFieldKey: asFieldKey(
      baserowFieldsRaw.videoSrtFieldKey,
      'field_7112',
    ),
    videoReferenceSrtFieldKey: asFieldKey(
      baserowFieldsRaw.videoReferenceSrtFieldKey,
      'field_6872',
    ),
    videoFinalDubbedAudioFieldKey: asOptionalFieldKey(
      baserowFieldsRaw.videoFinalDubbedAudioFieldKey,
    ),
    sceneDurationFieldKey: asFieldKey(
      baserowFieldsRaw.sceneDurationFieldKey,
      'field_7107',
    ),
    sceneReferenceSentenceFieldKey: asFieldKey(
      baserowFieldsRaw.sceneReferenceSentenceFieldKey,
      'field_6890',
    ),
    sceneTargetSentenceFieldKey: asFieldKey(
      baserowFieldsRaw.sceneTargetSentenceFieldKey,
      'field_7110',
    ),
    sceneDubbedAudioFieldKey: asFieldKey(
      baserowFieldsRaw.sceneDubbedAudioFieldKey,
      'field_7111',
    ),
    sceneOriginalAudioFieldKey: asOptionalFieldKey(
      baserowFieldsRaw.sceneOriginalAudioFieldKey,
    ),
  };

  return {
    id,
    name: nameRaw || filename,
    filename,
    language: (languageRaw || 'und').toLowerCase(),
    referenceText:
      typeof entry.referenceText === 'string' ? entry.referenceText : '',
    baserowFields,
    deviceMap,
    dtype,
    numStep,
    speed,
    description: typeof entry.description === 'string' ? entry.description : '',
    tags: Array.isArray(entry.tags)
      ? entry.tags
          .filter((tag): tag is string => typeof tag === 'string')
          .map((tag) => tag.trim())
          .filter(Boolean)
      : [],
    isDefault: Boolean(entry.isDefault),
    enabled: typeof entry.enabled === 'boolean' ? entry.enabled : true,
    updatedAt:
      typeof entry.updatedAt === 'string' ? entry.updatedAt : undefined,
  };
}

function normalizeDefaultsPerLanguage(
  entries: AudioReferenceEntry[],
): AudioReferenceEntry[] {
  const seen = new Set<string>();

  return entries.map((entry) => {
    if (!entry.isDefault) return entry;

    const key = entry.language.toLowerCase();
    if (seen.has(key)) {
      return { ...entry, isDefault: false };
    }

    seen.add(key);
    return entry;
  });
}

export function TTSAudioReferencesModal({
  isOpen,
  onClose,
}: TTSAudioReferencesModalProps) {
  const [entries, setEntries] = useState<AudioReferenceEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const isBusy = loading || saving;

  const normalizedEntries = useMemo(
    () =>
      normalizeDefaultsPerLanguage(
        entries.map((entry) => ({
          ...entry,
          language: entry.language.trim().toLowerCase() || 'und',
          name: entry.name.trim() || entry.filename.trim(),
          filename: entry.filename.trim(),
          referenceText: entry.referenceText,
          baserowFields: {
            videoSrtFieldKey: asFieldKey(
              entry.baserowFields.videoSrtFieldKey,
              'field_7112',
            ),
            videoReferenceSrtFieldKey: asFieldKey(
              entry.baserowFields.videoReferenceSrtFieldKey,
              'field_6872',
            ),
            videoFinalDubbedAudioFieldKey: asOptionalFieldKey(
              entry.baserowFields.videoFinalDubbedAudioFieldKey,
            ),
            sceneDurationFieldKey: asFieldKey(
              entry.baserowFields.sceneDurationFieldKey,
              'field_7107',
            ),
            sceneReferenceSentenceFieldKey: asFieldKey(
              entry.baserowFields.sceneReferenceSentenceFieldKey,
              'field_6890',
            ),
            sceneTargetSentenceFieldKey: asFieldKey(
              entry.baserowFields.sceneTargetSentenceFieldKey,
              'field_7110',
            ),
            sceneDubbedAudioFieldKey: asFieldKey(
              entry.baserowFields.sceneDubbedAudioFieldKey,
              'field_7111',
            ),
            sceneOriginalAudioFieldKey: asOptionalFieldKey(
              entry.baserowFields.sceneOriginalAudioFieldKey,
            ),
          },
          numStep: Math.round(clamp(entry.numStep, 8, 64)),
          speed: clamp(entry.speed, 0.5, 2),
        })),
      ),
    [entries],
  );

  const loadEntries = useCallback(async () => {
    setLoading(true);
    setStatus(null);
    setError(null);

    try {
      const response = await fetch('/api/tts-audio-references', {
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
            : `Failed to load audio references (${response.status})`;
        throw new Error(message);
      }

      const loadedEntries = Array.isArray(payload?.entries)
        ? payload.entries
            .map((entry) => normalizeEntry(entry))
            .filter((entry): entry is AudioReferenceEntry => entry !== null)
        : [];

      setEntries(normalizeDefaultsPerLanguage(loadedEntries));
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
      {
        id: createLocalEntryId(),
        name: '',
        filename: '',
        language: 'fa',
        referenceText: '',
        baserowFields: {
          videoSrtFieldKey: 'field_7112',
          videoReferenceSrtFieldKey: 'field_6872',
          videoFinalDubbedAudioFieldKey: 'field_7113',
          sceneDurationFieldKey: 'field_7107',
          sceneReferenceSentenceFieldKey: 'field_6890',
          sceneTargetSentenceFieldKey: 'field_7110',
          sceneDubbedAudioFieldKey: 'field_7111',
          sceneOriginalAudioFieldKey: '',
        },
        deviceMap: 'mps',
        dtype: 'float32',
        numStep: 64,
        speed: 1,
        description: '',
        tags: [],
        isDefault: false,
        enabled: true,
      },
    ]);
    setStatus(null);
    setError(null);
  };

  const updateEntry = (id: string, updates: Partial<AudioReferenceEntry>) => {
    setEntries((prev) =>
      prev.map((entry) => (entry.id === id ? { ...entry, ...updates } : entry)),
    );
    setStatus(null);
    setError(null);
  };

  const handleSetDefault = (id: string, checked: boolean) => {
    setEntries((prev) => {
      const current = prev.find((entry) => entry.id === id);
      if (!current) return prev;
      const language = current.language.trim().toLowerCase();

      return prev.map((entry) => {
        if (entry.id === id) {
          return { ...entry, isDefault: checked };
        }

        if (checked && entry.language.trim().toLowerCase() === language) {
          return { ...entry, isDefault: false };
        }

        return entry;
      });
    });
    setStatus(null);
    setError(null);
  };

  const handleDeleteEntry = (id: string) => {
    setEntries((prev) => prev.filter((entry) => entry.id !== id));
    setStatus(null);
    setError(null);
  };

  const handleSave = async () => {
    setSaving(true);
    setStatus(null);
    setError(null);

    try {
      const response = await fetch('/api/tts-audio-references', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          entries: normalizedEntries,
        }),
      });

      const payload = (await response.json().catch(() => null)) as {
        entries?: unknown;
        error?: unknown;
      } | null;

      if (!response.ok) {
        const message =
          typeof payload?.error === 'string'
            ? payload.error
            : `Failed to save audio references (${response.status})`;
        throw new Error(message);
      }

      const savedEntries = Array.isArray(payload?.entries)
        ? payload.entries
            .map((entry) => normalizeEntry(entry))
            .filter((entry): entry is AudioReferenceEntry => entry !== null)
        : [];

      setEntries(normalizeDefaultsPerLanguage(savedEntries));
      setStatus(
        `Saved ${savedEntries.length} audio reference entr${
          savedEntries.length === 1 ? 'y' : 'ies'
        }.`,
      );
    } catch (saveError) {
      setError(getErrorMessage(saveError));
    } finally {
      setSaving(false);
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
        className='w-full max-w-5xl bg-white rounded-xl shadow-2xl border border-gray-200 overflow-hidden'
        onClick={(event) => event.stopPropagation()}
      >
        <div className='px-5 py-4 border-b border-gray-200 flex items-start justify-between gap-3'>
          <div>
            <h3 className='text-lg font-semibold text-gray-900'>
              OmniVoice Language Presets
            </h3>
            <p className='text-sm text-gray-600 mt-1'>
              Manage per-language reference voices and generation settings.
            </p>
            <p className='text-xs text-gray-500 mt-1'>
              Editable fields: Language, Filename, Reference Text, Device,
              DType, Num Step, Speed, and Baserow field mappings.
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

        <div className='px-5 py-4 space-y-3 max-h-[62vh] overflow-y-auto'>
          {loading ? (
            <div className='flex items-center justify-center py-8 text-gray-600 gap-2'>
              <Loader2 className='w-4 h-4 animate-spin' />
              <span>Loading language presets...</span>
            </div>
          ) : entries.length === 0 ? (
            <div className='rounded-lg border border-dashed border-gray-300 bg-gray-50 p-4 text-sm text-gray-600'>
              No presets yet. Add one for a language (e.g. `fa`, `en`).
            </div>
          ) : (
            entries.map((entry, index) => (
              <div
                key={entry.id}
                className='bg-gray-50 border border-gray-200 rounded-lg p-3 space-y-3'
              >
                <div className='flex items-center justify-between gap-3'>
                  <div className='text-xs text-gray-500'>
                    Preset #{index + 1}
                    {entry.updatedAt ? ` • updated ${entry.updatedAt}` : ''}
                  </div>
                  <button
                    onClick={() => handleDeleteEntry(entry.id)}
                    className='inline-flex items-center justify-center gap-1 px-3 py-2 rounded-md bg-red-100 text-red-700 hover:bg-red-200 transition-colors text-sm font-medium'
                    title={`Delete preset #${index + 1}`}
                  >
                    <Trash2 className='w-4 h-4' />
                    <span>Delete</span>
                  </button>
                </div>

                <div className='grid grid-cols-1 md:grid-cols-3 gap-2'>
                  <div className='space-y-1'>
                    <label className='text-xs font-medium text-gray-700'>
                      Name
                    </label>
                    <input
                      type='text'
                      value={entry.name}
                      onChange={(event) =>
                        updateEntry(entry.id, { name: event.target.value })
                      }
                      placeholder='Farsi Default Voice'
                      className='w-full px-3 py-2 rounded-md border border-gray-300 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 text-sm'
                    />
                  </div>

                  <div className='space-y-1'>
                    <label className='text-xs font-medium text-gray-700'>
                      Audio Filename
                    </label>
                    <input
                      type='text'
                      value={entry.filename}
                      onChange={(event) =>
                        updateEntry(entry.id, { filename: event.target.value })
                      }
                      placeholder='fa.wav'
                      className='w-full px-3 py-2 rounded-md border border-gray-300 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 text-sm'
                    />
                  </div>

                  <div className='space-y-1'>
                    <label className='text-xs font-medium text-gray-700'>
                      Language
                    </label>
                    <input
                      type='text'
                      value={entry.language}
                      onChange={(event) =>
                        updateEntry(entry.id, {
                          language: event.target.value.toLowerCase(),
                        })
                      }
                      placeholder='fa'
                      className='w-full px-3 py-2 rounded-md border border-gray-300 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 text-sm'
                    />
                  </div>
                </div>

                <div className='space-y-1'>
                  <label className='text-xs font-medium text-gray-700'>
                    Reference Text
                  </label>
                  <textarea
                    rows={3}
                    value={entry.referenceText}
                    onChange={(event) =>
                      updateEntry(entry.id, {
                        referenceText: event.target.value,
                      })
                    }
                    placeholder='Optional transcript of your reference audio'
                    className='w-full px-3 py-2 rounded-md border border-gray-300 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 text-sm'
                  />
                </div>

                <div className='grid grid-cols-2 md:grid-cols-4 gap-2'>
                  <div className='space-y-1'>
                    <label className='text-xs font-medium text-gray-700'>
                      Device
                    </label>
                    <select
                      value={entry.deviceMap}
                      onChange={(event) =>
                        updateEntry(entry.id, {
                          deviceMap: event.target.value as DeviceMap,
                        })
                      }
                      className='w-full px-3 py-2 rounded-md border border-gray-300 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 text-sm'
                    >
                      <option value='mps'>mps</option>
                      <option value='auto'>auto</option>
                      <option value='cpu'>cpu</option>
                    </select>
                  </div>

                  <div className='space-y-1'>
                    <label className='text-xs font-medium text-gray-700'>
                      DType
                    </label>
                    <select
                      value={entry.dtype}
                      onChange={(event) =>
                        updateEntry(entry.id, {
                          dtype: event.target.value as DType,
                        })
                      }
                      className='w-full px-3 py-2 rounded-md border border-gray-300 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 text-sm'
                    >
                      <option value='float16'>float16</option>
                      <option value='float32'>float32</option>
                      <option value='bfloat16'>bfloat16</option>
                    </select>
                  </div>

                  <div className='space-y-1'>
                    <label className='text-xs font-medium text-gray-700'>
                      Num Step
                    </label>
                    <input
                      type='number'
                      min='8'
                      max='64'
                      value={entry.numStep}
                      onChange={(event) =>
                        updateEntry(entry.id, {
                          numStep: Math.round(
                            clamp(Number(event.target.value) || 64, 8, 64),
                          ),
                        })
                      }
                      className='w-full px-3 py-2 rounded-md border border-gray-300 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 text-sm'
                    />
                  </div>

                  <div className='space-y-1'>
                    <label className='text-xs font-medium text-gray-700'>
                      Speed
                    </label>
                    <input
                      type='number'
                      min='0.5'
                      max='2'
                      step='0.05'
                      value={entry.speed}
                      onChange={(event) =>
                        updateEntry(entry.id, {
                          speed: clamp(Number(event.target.value) || 1, 0.5, 2),
                        })
                      }
                      className='w-full px-3 py-2 rounded-md border border-gray-300 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 text-sm'
                    />
                  </div>
                </div>

                <div className='rounded-md border border-indigo-200 bg-indigo-50 p-3 space-y-2'>
                  <p className='text-xs font-medium text-indigo-900'>
                    Baserow field mapping for this language (use field_###)
                  </p>

                  <div className='grid grid-cols-1 md:grid-cols-2 gap-2'>
                    <div className='space-y-1'>
                      <label className='text-xs font-medium text-gray-700'>
                        Video SRT Field
                      </label>
                      <input
                        type='text'
                        value={entry.baserowFields.videoSrtFieldKey}
                        onChange={(event) =>
                          updateEntry(entry.id, {
                            baserowFields: {
                              ...entry.baserowFields,
                              videoSrtFieldKey: event.target.value,
                            },
                          })
                        }
                        placeholder='field_7112'
                        className='w-full px-3 py-2 rounded-md border border-gray-300 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 text-sm'
                      />
                    </div>

                    <div className='space-y-1'>
                      <label className='text-xs font-medium text-gray-700'>
                        Reference Video SRT Field
                      </label>
                      <input
                        type='text'
                        value={entry.baserowFields.videoReferenceSrtFieldKey}
                        onChange={(event) =>
                          updateEntry(entry.id, {
                            baserowFields: {
                              ...entry.baserowFields,
                              videoReferenceSrtFieldKey: event.target.value,
                            },
                          })
                        }
                        placeholder='field_6872'
                        className='w-full px-3 py-2 rounded-md border border-gray-300 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 text-sm'
                      />
                    </div>

                    <div className='space-y-1'>
                      <label className='text-xs font-medium text-gray-700'>
                        Video Final Dubbed Audio Field (optional)
                      </label>
                      <input
                        type='text'
                        value={
                          entry.baserowFields.videoFinalDubbedAudioFieldKey
                        }
                        onChange={(event) =>
                          updateEntry(entry.id, {
                            baserowFields: {
                              ...entry.baserowFields,
                              videoFinalDubbedAudioFieldKey: event.target.value,
                            },
                          })
                        }
                        placeholder='field_7113'
                        className='w-full px-3 py-2 rounded-md border border-gray-300 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 text-sm'
                      />
                    </div>

                    <div className='space-y-1'>
                      <label className='text-xs font-medium text-gray-700'>
                        Scene Duration Field
                      </label>
                      <input
                        type='text'
                        value={entry.baserowFields.sceneDurationFieldKey}
                        onChange={(event) =>
                          updateEntry(entry.id, {
                            baserowFields: {
                              ...entry.baserowFields,
                              sceneDurationFieldKey: event.target.value,
                            },
                          })
                        }
                        placeholder='field_7107'
                        className='w-full px-3 py-2 rounded-md border border-gray-300 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 text-sm'
                      />
                    </div>

                    <div className='space-y-1'>
                      <label className='text-xs font-medium text-gray-700'>
                        Scene Reference Sentence Field
                      </label>
                      <input
                        type='text'
                        value={
                          entry.baserowFields.sceneReferenceSentenceFieldKey
                        }
                        onChange={(event) =>
                          updateEntry(entry.id, {
                            baserowFields: {
                              ...entry.baserowFields,
                              sceneReferenceSentenceFieldKey:
                                event.target.value,
                            },
                          })
                        }
                        placeholder='field_6890'
                        className='w-full px-3 py-2 rounded-md border border-gray-300 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 text-sm'
                      />
                    </div>

                    <div className='space-y-1'>
                      <label className='text-xs font-medium text-gray-700'>
                        Scene Target Sentence Field
                      </label>
                      <input
                        type='text'
                        value={entry.baserowFields.sceneTargetSentenceFieldKey}
                        onChange={(event) =>
                          updateEntry(entry.id, {
                            baserowFields: {
                              ...entry.baserowFields,
                              sceneTargetSentenceFieldKey: event.target.value,
                            },
                          })
                        }
                        placeholder='field_7110'
                        className='w-full px-3 py-2 rounded-md border border-gray-300 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 text-sm'
                      />
                    </div>

                    <div className='space-y-1'>
                      <label className='text-xs font-medium text-gray-700'>
                        Scene Dubbed Audio Field
                      </label>
                      <input
                        type='text'
                        value={entry.baserowFields.sceneDubbedAudioFieldKey}
                        onChange={(event) =>
                          updateEntry(entry.id, {
                            baserowFields: {
                              ...entry.baserowFields,
                              sceneDubbedAudioFieldKey: event.target.value,
                            },
                          })
                        }
                        placeholder='field_7111'
                        className='w-full px-3 py-2 rounded-md border border-gray-300 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 text-sm'
                      />
                    </div>

                    <div className='space-y-1'>
                      <label className='text-xs font-medium text-gray-700'>
                        Scene Original TTS Audio Field (optional)
                      </label>
                      <input
                        type='text'
                        value={entry.baserowFields.sceneOriginalAudioFieldKey}
                        onChange={(event) =>
                          updateEntry(entry.id, {
                            baserowFields: {
                              ...entry.baserowFields,
                              sceneOriginalAudioFieldKey: event.target.value,
                            },
                          })
                        }
                        placeholder='field_7117'
                        className='w-full px-3 py-2 rounded-md border border-gray-300 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 text-sm'
                      />
                    </div>
                  </div>
                </div>

                <div className='grid grid-cols-1 md:grid-cols-2 gap-2'>
                  <label className='inline-flex items-center gap-2 text-sm text-gray-700'>
                    <input
                      type='checkbox'
                      checked={entry.enabled}
                      onChange={(event) =>
                        updateEntry(entry.id, {
                          enabled: event.target.checked,
                        })
                      }
                      className='rounded border-gray-300 text-indigo-600 focus:ring-indigo-500'
                    />
                    Enabled
                  </label>

                  <label className='inline-flex items-center gap-2 text-sm text-gray-700'>
                    <input
                      type='checkbox'
                      checked={entry.isDefault}
                      onChange={(event) =>
                        handleSetDefault(entry.id, event.target.checked)
                      }
                      className='rounded border-gray-300 text-indigo-600 focus:ring-indigo-500'
                    />
                    Default for this language
                  </label>
                </div>
              </div>
            ))
          )}

          <button
            onClick={handleAddEntry}
            disabled={loading}
            className='inline-flex items-center gap-2 px-3 py-2 rounded-md bg-indigo-100 text-indigo-700 hover:bg-indigo-200 transition-colors text-sm font-medium disabled:opacity-50 disabled:cursor-not-allowed'
          >
            <Plus className='w-4 h-4' />
            Add Language Preset
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
            title='Save language presets to local JSON file'
          >
            {saving ? (
              <Loader2 className='w-4 h-4 animate-spin' />
            ) : (
              <Save className='w-4 h-4' />
            )}
            Save Presets
          </button>
        </div>
      </div>
    </div>
  );
}
