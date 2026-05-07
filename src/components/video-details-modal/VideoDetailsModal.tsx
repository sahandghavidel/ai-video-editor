'use client';

import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { Check, Loader2, Save, Search, Upload, X } from 'lucide-react';
import {
  buildEditorValueMap,
  extractUrls,
  fieldKeyFromId,
  formatValueForDisplay,
  hasEditorValueChanged,
  isFieldEditable,
  isNumberField,
  isTextareaField,
  sortedFields,
  supportsFileUpload,
  toPatchValue,
} from './helpers';
import {
  BaserowFieldSchema,
  BaserowVideoRow,
  EditorValue,
  EditorValueMap,
} from './types';

interface VideoDetailsModalProps {
  isOpen: boolean;
  videoId: number | null;
  onClose: () => void;
  onUpdated?: () => void | Promise<void>;
}

type FieldsResponse = {
  fields?: BaserowFieldSchema[];
  error?: string;
};

type UploadResponse = {
  success?: boolean;
  fieldKey?: string;
  url?: string;
  row?: BaserowVideoRow;
  error?: string;
};

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export default function VideoDetailsModal({
  isOpen,
  videoId,
  onClose,
  onUpdated,
}: VideoDetailsModalProps) {
  const [fields, setFields] = useState<BaserowFieldSchema[]>([]);
  const [row, setRow] = useState<BaserowVideoRow | null>(null);
  const [initialValues, setInitialValues] = useState<EditorValueMap>({});
  const [draftValues, setDraftValues] = useState<EditorValueMap>({});
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [uploadingFieldKey, setUploadingFieldKey] = useState<string | null>(
    null,
  );
  const [fieldSearchQuery, setFieldSearchQuery] = useState('');
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const initialValuesRef = useRef<EditorValueMap>({});
  const draftValuesRef = useRef<EditorValueMap>({});

  const isBusy = loading || saving || uploadingFieldKey !== null;

  useEffect(() => {
    initialValuesRef.current = initialValues;
  }, [initialValues]);

  useEffect(() => {
    draftValuesRef.current = draftValues;
  }, [draftValues]);

  const applyRowValues = useCallback(
    (
      nextFields: BaserowFieldSchema[],
      nextRow: BaserowVideoRow,
      options?: {
        preserveUnsavedEdits?: boolean;
        savedFieldKey?: string;
      },
    ) => {
      const editorValues = buildEditorValueMap(nextFields, nextRow);
      setRow(nextRow);

      if (!options?.preserveUnsavedEdits) {
        initialValuesRef.current = editorValues;
        draftValuesRef.current = editorValues;
        setInitialValues(editorValues);
        setDraftValues(editorValues);
        return;
      }

      const previousInitialValues = initialValuesRef.current;
      const previousDraftValues = draftValuesRef.current;

      const mergedInitialValues: EditorValueMap = { ...editorValues };
      const mergedDraftValues: EditorValueMap = { ...editorValues };

      for (const field of nextFields) {
        const fieldKey = fieldKeyFromId(field.id);

        if (fieldKey === options.savedFieldKey) {
          continue;
        }

        const previousInitialValue = previousInitialValues[fieldKey];
        const previousDraftValue = previousDraftValues[fieldKey];

        if (
          previousInitialValue === undefined ||
          previousDraftValue === undefined
        ) {
          continue;
        }

        const wasDirty = hasEditorValueChanged(
          previousInitialValue,
          previousDraftValue,
        );

        if (!wasDirty) continue;

        mergedInitialValues[fieldKey] = previousInitialValue;
        mergedDraftValues[fieldKey] = previousDraftValue;
      }

      initialValuesRef.current = mergedInitialValues;
      draftValuesRef.current = mergedDraftValues;
      setInitialValues(mergedInitialValues);
      setDraftValues(mergedDraftValues);
    },
    [],
  );

  const loadData = useCallback(async () => {
    if (!videoId) return;

    setLoading(true);
    setStatus(null);
    setError(null);

    try {
      const [fieldsRes, rowRes] = await Promise.all([
        fetch('/api/baserow/videos/fields', {
          method: 'GET',
          cache: 'no-store',
        }),
        fetch(`/api/baserow/videos/${videoId}`, {
          method: 'GET',
          cache: 'no-store',
        }),
      ]);

      const fieldsPayload = (await fieldsRes
        .json()
        .catch(() => null)) as FieldsResponse | null;
      const rowPayload = (await rowRes.json().catch(() => null)) as
        | (BaserowVideoRow & { error?: string })
        | null;

      if (!fieldsRes.ok) {
        throw new Error(
          fieldsPayload?.error ||
            `Failed to fetch fields (${fieldsRes.status})`,
        );
      }

      if (!rowRes.ok) {
        throw new Error(
          rowPayload?.error || `Failed to fetch row (${rowRes.status})`,
        );
      }

      const fetchedFields = sortedFields(
        Array.isArray(fieldsPayload?.fields) ? fieldsPayload.fields : [],
      );
      const fetchedRow = (rowPayload ?? null) as BaserowVideoRow | null;

      if (!fetchedRow) {
        throw new Error('Video row was not returned by API');
      }

      setFields(fetchedFields);
      applyRowValues(fetchedFields, fetchedRow);
    } catch (loadError) {
      setError(getErrorMessage(loadError));
      setFields([]);
      setRow(null);
      setInitialValues({});
      setDraftValues({});
    } finally {
      setLoading(false);
    }
  }, [applyRowValues, videoId]);

  useEffect(() => {
    if (!isOpen || !videoId) return;
    void loadData();
  }, [isOpen, videoId, loadData]);

  useEffect(() => {
    if (!isOpen || loading || fields.length === 0 || !row) return;

    const frameId = requestAnimationFrame(() => {
      searchInputRef.current?.focus();
    });

    return () => cancelAnimationFrame(frameId);
  }, [fields.length, isOpen, loading, row]);

  const editableFields = useMemo(
    () => fields.filter((field) => isFieldEditable(field)),
    [fields],
  );

  const normalizedSearchQuery = useMemo(
    () => fieldSearchQuery.trim().toLowerCase(),
    [fieldSearchQuery],
  );

  const filteredFields = useMemo(() => {
    if (!normalizedSearchQuery) return fields;

    return fields.filter((field) => {
      const fieldKey = fieldKeyFromId(field.id);
      const haystack = `${field.name} ${field.type} ${fieldKey}`.toLowerCase();
      return haystack.includes(normalizedSearchQuery);
    });
  }, [fields, normalizedSearchQuery]);

  const hasChanges = useMemo(() => {
    return editableFields.some((field) => {
      const fieldKey = fieldKeyFromId(field.id);
      const previousValue = initialValues[fieldKey];
      const nextValue = draftValues[fieldKey];

      if (previousValue === undefined || nextValue === undefined) {
        return false;
      }

      return hasEditorValueChanged(previousValue, nextValue);
    });
  }, [editableFields, draftValues, initialValues]);

  const updateDraftValue = useCallback(
    (fieldKey: string, value: EditorValue) => {
      setDraftValues((previousValues) => ({
        ...previousValues,
        [fieldKey]: value,
      }));
      setStatus(null);
      setError(null);
    },
    [],
  );

  const saveChanges = useCallback(
    async (options?: { silentIfNoChanges?: boolean }): Promise<boolean> => {
      if (!videoId || !row) return true;

      const patchPayload: Record<string, unknown> = {};

      for (const field of editableFields) {
        const fieldKey = fieldKeyFromId(field.id);
        const previousValue = initialValues[fieldKey];
        const nextValue = draftValues[fieldKey];

        if (previousValue === undefined || nextValue === undefined) continue;
        if (!hasEditorValueChanged(previousValue, nextValue)) continue;

        patchPayload[fieldKey] = toPatchValue(field, nextValue);
      }

      if (Object.keys(patchPayload).length === 0) {
        if (!options?.silentIfNoChanges) {
          setStatus('No changes to save.');
        }
        return true;
      }

      setSaving(true);
      setStatus(null);
      setError(null);

      try {
        const response = await fetch(`/api/baserow/videos/${videoId}`, {
          method: 'PATCH',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(patchPayload),
        });

        const payload = (await response.json().catch(() => null)) as
          | (BaserowVideoRow & { error?: string })
          | null;

        if (!response.ok) {
          throw new Error(
            payload?.error || `Failed to save changes (${response.status})`,
          );
        }

        const updatedRow = payload as BaserowVideoRow;
        applyRowValues(fields, updatedRow);

        setStatus('Changes saved successfully.');
        await Promise.resolve(onUpdated?.());
        return true;
      } catch (saveError) {
        setError(getErrorMessage(saveError));
        return false;
      } finally {
        setSaving(false);
      }
    },
    [
      applyRowValues,
      draftValues,
      editableFields,
      fields,
      initialValues,
      onUpdated,
      row,
      videoId,
    ],
  );

  const handleSave = async () => {
    await saveChanges();
  };

  const handleCloseWithSave = useCallback(async () => {
    if (isBusy) return;

    if (!videoId || !row) {
      onClose();
      return;
    }

    const saved = await saveChanges({ silentIfNoChanges: true });
    if (saved) {
      onClose();
    }
  }, [isBusy, onClose, row, saveChanges, videoId]);

  useEffect(() => {
    if (!isOpen) {
      setFieldSearchQuery('');
      setStatus(null);
      setError(null);
      return;
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;

      event.preventDefault();
      void handleCloseWithSave();
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [handleCloseWithSave, isOpen]);

  const handleUploadFile = async (
    fieldKey: string,
    file: File | null | undefined,
  ) => {
    if (!videoId || !file) return;

    setUploadingFieldKey(fieldKey);
    setStatus(null);
    setError(null);

    try {
      const formData = new FormData();
      formData.append('file', file);
      formData.append('videoId', String(videoId));
      formData.append('fieldKey', fieldKey);

      const response = await fetch('/api/baserow/videos/upload-field-file', {
        method: 'POST',
        body: formData,
      });

      const payload = (await response
        .json()
        .catch(() => null)) as UploadResponse | null;

      if (!response.ok) {
        throw new Error(
          payload?.error ||
            `Failed to upload replacement file (${response.status})`,
        );
      }

      const updatedRow = payload?.row;
      if (updatedRow) {
        applyRowValues(fields, updatedRow, {
          preserveUnsavedEdits: true,
          savedFieldKey: fieldKey,
        });
      }

      const fileName = file.name || 'new file';
      setStatus(`Uploaded ${fileName} and replaced ${fieldKey}.`);
      await Promise.resolve(onUpdated?.());
    } catch (uploadError) {
      setError(getErrorMessage(uploadError));
    } finally {
      setUploadingFieldKey(null);
    }
  };

  if (!isOpen) return null;

  return (
    <div
      className='fixed inset-0 z-[80] bg-black/55 flex items-center justify-center p-4'
      onClick={() => {
        void handleCloseWithSave();
      }}
    >
      <div
        className='w-full max-w-6xl bg-white rounded-xl shadow-2xl border border-gray-200 overflow-hidden'
        onClick={(event) => event.stopPropagation()}
      >
        <div className='px-5 py-4 border-b border-gray-200 flex items-start justify-between gap-3'>
          <div>
            <h3 className='text-lg font-semibold text-gray-900'>
              Video Details Editor
            </h3>
            <p className='text-sm text-gray-600 mt-1'>
              Dynamic Baserow field editor for video #{videoId ?? 'N/A'}.
            </p>
            <p className='text-xs text-gray-500 mt-1'>
              Text fields are editable inline. URL fields support file upload to
              replace the existing asset.
            </p>
          </div>
          <button
            onClick={() => {
              void handleCloseWithSave();
            }}
            disabled={isBusy}
            className='p-2 rounded-md text-gray-500 hover:bg-gray-100 hover:text-gray-800 disabled:opacity-50 disabled:cursor-not-allowed'
            title='Close'
          >
            <X className='w-5 h-5' />
          </button>
        </div>

        <div className='px-5 py-4 max-h-[70vh] overflow-y-auto space-y-3'>
          {!loading && fields.length > 0 && row && (
            <div className='rounded-lg border border-gray-200 bg-gray-50 p-3 space-y-2'>
              <div className='relative'>
                <Search className='w-4 h-4 text-gray-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none' />
                <input
                  ref={searchInputRef}
                  type='text'
                  value={fieldSearchQuery}
                  onChange={(event) => setFieldSearchQuery(event.target.value)}
                  placeholder='Search fields by name, type, or key (e.g. title, long_text, field_6852)'
                  className='w-full pl-9 pr-20 py-2 rounded-md border border-gray-300 bg-white focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 text-sm'
                />
                {fieldSearchQuery.trim().length > 0 && (
                  <button
                    onClick={() => setFieldSearchQuery('')}
                    className='absolute right-2 top-1/2 -translate-y-1/2 px-2 py-1 text-xs rounded bg-gray-100 hover:bg-gray-200 text-gray-700'
                    title='Clear search'
                  >
                    Clear
                  </button>
                )}
              </div>
              <div className='text-xs text-gray-500'>
                Showing {filteredFields.length} of {fields.length} fields
              </div>
            </div>
          )}

          {loading ? (
            <div className='flex items-center justify-center py-10 text-gray-600 gap-2'>
              <Loader2 className='w-4 h-4 animate-spin' />
              <span>Loading video fields...</span>
            </div>
          ) : fields.length === 0 || !row ? (
            <div className='rounded-lg border border-dashed border-gray-300 bg-gray-50 p-4 text-sm text-gray-600'>
              No fields found for this video.
            </div>
          ) : filteredFields.length === 0 ? (
            <div className='rounded-lg border border-dashed border-gray-300 bg-gray-50 p-4 text-sm text-gray-600'>
              No fields matched{' '}
              <code className='font-medium text-gray-800'>
                {fieldSearchQuery.trim()}
              </code>
              . Try a different keyword.
            </div>
          ) : (
            filteredFields.map((field) => {
              const fieldKey = fieldKeyFromId(field.id);
              const draftValue = draftValues[fieldKey] ?? '';
              const rawValue = row[fieldKey];
              const isEditable = isFieldEditable(field);
              const urlCandidates = extractUrls(rawValue);
              const canUpload = supportsFileUpload(field, rawValue);
              const isUploadingThisField = uploadingFieldKey === fieldKey;

              return (
                <div
                  key={field.id}
                  className='rounded-lg border border-gray-200 bg-gray-50 p-3'
                >
                  <div className='flex flex-wrap items-center justify-between gap-2 mb-2'>
                    <div className='flex flex-wrap items-center gap-2'>
                      <h4 className='text-sm font-semibold text-gray-900'>
                        {field.name}
                      </h4>
                      <span className='text-[11px] px-2 py-0.5 rounded-full bg-blue-100 text-blue-700'>
                        {field.type}
                      </span>
                      <span className='text-[11px] px-2 py-0.5 rounded-full bg-gray-200 text-gray-700'>
                        {fieldKey}
                      </span>
                    </div>
                    {!isEditable && (
                      <span className='text-xs text-amber-700 bg-amber-100 px-2 py-0.5 rounded-full'>
                        Read only
                      </span>
                    )}
                  </div>

                  {isEditable ? (
                    <div className='space-y-2'>
                      {field.type === 'single_select' ? (
                        <select
                          value={
                            typeof draftValue === 'string' ? draftValue : ''
                          }
                          onChange={(event) =>
                            updateDraftValue(fieldKey, event.target.value)
                          }
                          className='w-full px-3 py-2 rounded-md border border-gray-300 bg-white focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 text-sm'
                        >
                          <option value=''>No selection</option>
                          {(field.select_options ?? []).map((option) => (
                            <option key={option.id} value={String(option.id)}>
                              {option.value}
                            </option>
                          ))}
                        </select>
                      ) : field.type === 'multiple_select' ? (
                        <div className='rounded-md border border-gray-300 bg-white p-2 space-y-1'>
                          {(field.select_options ?? []).length === 0 ? (
                            <div className='text-xs text-gray-500'>
                              No options available.
                            </div>
                          ) : (
                            (field.select_options ?? []).map((option) => {
                              const selectedValues = Array.isArray(draftValue)
                                ? draftValue
                                : [];
                              const isChecked = selectedValues.includes(
                                String(option.id),
                              );

                              return (
                                <label
                                  key={option.id}
                                  className='flex items-center gap-2 text-sm text-gray-800'
                                >
                                  <input
                                    type='checkbox'
                                    checked={isChecked}
                                    onChange={(event) => {
                                      const nextValues = Array.isArray(
                                        draftValue,
                                      )
                                        ? [...draftValue]
                                        : [];

                                      if (event.target.checked) {
                                        if (
                                          !nextValues.includes(
                                            String(option.id),
                                          )
                                        ) {
                                          nextValues.push(String(option.id));
                                        }
                                      } else {
                                        const idx = nextValues.indexOf(
                                          String(option.id),
                                        );
                                        if (idx >= 0) {
                                          nextValues.splice(idx, 1);
                                        }
                                      }

                                      updateDraftValue(fieldKey, nextValues);
                                    }}
                                  />
                                  <span>{option.value}</span>
                                </label>
                              );
                            })
                          )}
                        </div>
                      ) : field.type === 'boolean' ? (
                        <label className='inline-flex items-center gap-2 text-sm text-gray-800'>
                          <input
                            type='checkbox'
                            checked={Boolean(draftValue)}
                            onChange={(event) =>
                              updateDraftValue(fieldKey, event.target.checked)
                            }
                          />
                          <span>
                            {Boolean(draftValue)
                              ? 'Enabled (true)'
                              : 'Disabled (false)'}
                          </span>
                        </label>
                      ) : isTextareaField(field) ? (
                        <textarea
                          value={
                            typeof draftValue === 'string' ? draftValue : ''
                          }
                          onChange={(event) =>
                            updateDraftValue(fieldKey, event.target.value)
                          }
                          rows={4}
                          className='w-full px-3 py-2 rounded-md border border-gray-300 bg-white focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 text-sm'
                        />
                      ) : (
                        <input
                          type={isNumberField(field) ? 'number' : 'text'}
                          step={field.type === 'rating' ? '1' : 'any'}
                          value={
                            typeof draftValue === 'string' ? draftValue : ''
                          }
                          onChange={(event) =>
                            updateDraftValue(fieldKey, event.target.value)
                          }
                          className='w-full px-3 py-2 rounded-md border border-gray-300 bg-white focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 text-sm'
                        />
                      )}

                      {urlCandidates.length > 0 && (
                        <div className='flex flex-wrap gap-2'>
                          {urlCandidates.map((urlValue, index) => (
                            <a
                              key={`${fieldKey}-url-${index}`}
                              href={urlValue}
                              target='_blank'
                              rel='noopener noreferrer'
                              className='text-xs text-blue-700 bg-blue-50 border border-blue-200 rounded px-2 py-1 hover:bg-blue-100'
                              title={urlValue}
                            >
                              Open URL {index + 1}
                            </a>
                          ))}
                        </div>
                      )}

                      {canUpload && (
                        <div className='pt-1'>
                          <label className='inline-flex items-center gap-2 px-3 py-1.5 rounded-md bg-indigo-600 text-white text-xs font-medium hover:bg-indigo-700 cursor-pointer disabled:opacity-50'>
                            {isUploadingThisField ? (
                              <Loader2 className='w-3.5 h-3.5 animate-spin' />
                            ) : (
                              <Upload className='w-3.5 h-3.5' />
                            )}
                            <span>
                              {isUploadingThisField
                                ? 'Uploading...'
                                : 'Upload and Replace'}
                            </span>
                            <input
                              type='file'
                              className='hidden'
                              disabled={isBusy}
                              onChange={(event) => {
                                const file = event.target.files?.[0] ?? null;
                                void handleUploadFile(fieldKey, file);
                                event.currentTarget.value = '';
                              }}
                            />
                          </label>
                        </div>
                      )}
                    </div>
                  ) : (
                    <pre className='whitespace-pre-wrap break-words text-xs text-gray-700 bg-white border border-gray-200 rounded-md p-2'>
                      {formatValueForDisplay(rawValue) || 'N/A'}
                    </pre>
                  )}
                </div>
              );
            })
          )}

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
            onClick={() => {
              void handleCloseWithSave();
            }}
            disabled={isBusy}
            className='px-4 py-2 rounded-md bg-gray-200 text-gray-700 hover:bg-gray-300 transition-colors text-sm font-medium disabled:opacity-50 disabled:cursor-not-allowed'
          >
            Close
          </button>
          <button
            onClick={() => void loadData()}
            disabled={isBusy || !videoId}
            className='px-4 py-2 rounded-md bg-slate-600 text-white hover:bg-slate-700 transition-colors text-sm font-medium disabled:opacity-50 disabled:cursor-not-allowed'
            title='Reload fields and row values from Baserow'
          >
            Reload
          </button>
          <button
            onClick={handleSave}
            disabled={!hasChanges || isBusy || !videoId}
            className='inline-flex items-center gap-2 px-4 py-2 rounded-md bg-blue-600 text-white hover:bg-blue-700 transition-colors text-sm font-medium disabled:opacity-50 disabled:cursor-not-allowed'
            title='Save changed fields'
          >
            {saving ? (
              <Loader2 className='w-4 h-4 animate-spin' />
            ) : hasChanges ? (
              <Save className='w-4 h-4' />
            ) : (
              <Check className='w-4 h-4' />
            )}
            {saving ? 'Saving...' : hasChanges ? 'Save Changes' : 'Saved'}
          </button>
        </div>
      </div>
    </div>
  );
}
