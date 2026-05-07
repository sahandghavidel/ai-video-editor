import {
  BaserowFieldSchema,
  BaserowVideoRow,
  EditorValue,
  EditorValueMap,
} from './types';

const EDITABLE_FIELD_TYPES = new Set([
  'text',
  'long_text',
  'url',
  'email',
  'phone_number',
  'number',
  'rating',
  'boolean',
  'single_select',
  'multiple_select',
]);

const TEXTAREA_FIELD_TYPES = new Set(['long_text']);
const NUMBER_FIELD_TYPES = new Set(['number', 'rating']);

export function fieldKeyFromId(fieldId: number): string {
  return `field_${fieldId}`;
}

export function isFieldEditable(field: BaserowFieldSchema): boolean {
  if (field.read_only) return false;
  return EDITABLE_FIELD_TYPES.has(field.type);
}

export function isTextareaField(field: BaserowFieldSchema): boolean {
  return TEXTAREA_FIELD_TYPES.has(field.type);
}

export function isNumberField(field: BaserowFieldSchema): boolean {
  return NUMBER_FIELD_TYPES.has(field.type);
}

function valueToString(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }

  if (Array.isArray(value)) {
    if (value.length === 0) return '';
    return value.map((entry) => valueToString(entry)).join(', ');
  }

  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    const candidate =
      record.value ?? record.name ?? record.text ?? record.title ?? record.url;

    if (
      typeof candidate === 'string' ||
      typeof candidate === 'number' ||
      typeof candidate === 'boolean'
    ) {
      return String(candidate);
    }

    try {
      return JSON.stringify(value);
    } catch {
      return '';
    }
  }

  return String(value);
}

function normalizeSelectOptionValue(value: unknown): string {
  if (value === null || value === undefined) return '';

  if (typeof value === 'string' || typeof value === 'number') {
    return String(value);
  }

  if (Array.isArray(value) && value.length > 0) {
    return normalizeSelectOptionValue(value[0]);
  }

  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>;

    if (typeof record.id === 'string' || typeof record.id === 'number') {
      return String(record.id);
    }

    if (typeof record.value === 'string' || typeof record.value === 'number') {
      return String(record.value);
    }

    if (typeof record.name === 'string') {
      return record.name;
    }
  }

  return '';
}

function normalizeMultiSelectOptionValue(value: unknown): string[] {
  if (!Array.isArray(value)) return [];

  return value
    .map((entry) => normalizeSelectOptionValue(entry))
    .filter((entry) => entry.trim().length > 0);
}

export function toEditorValue(
  field: BaserowFieldSchema,
  rawValue: unknown,
): EditorValue {
  if (field.type === 'single_select') {
    return normalizeSelectOptionValue(rawValue);
  }

  if (field.type === 'multiple_select') {
    return normalizeMultiSelectOptionValue(rawValue);
  }

  if (field.type === 'boolean') {
    if (typeof rawValue === 'boolean') return rawValue;
    if (typeof rawValue === 'string') {
      return rawValue.trim().toLowerCase() === 'true';
    }
    return Boolean(rawValue);
  }

  return valueToString(rawValue);
}

export function toPatchValue(
  field: BaserowFieldSchema,
  editorValue: EditorValue,
): unknown {
  if (field.type === 'single_select') {
    if (typeof editorValue !== 'string' || editorValue.trim() === '') {
      return null;
    }

    const asNumber = Number(editorValue);
    return Number.isFinite(asNumber) ? asNumber : editorValue;
  }

  if (field.type === 'multiple_select') {
    if (!Array.isArray(editorValue)) return [];

    return editorValue
      .map((entry) => {
        const asNumber = Number(entry);
        return Number.isFinite(asNumber) ? asNumber : entry;
      })
      .filter((entry) => {
        if (typeof entry === 'number') return true;
        return entry.trim().length > 0;
      });
  }

  if (field.type === 'boolean') {
    return Boolean(editorValue);
  }

  if (isNumberField(field)) {
    if (typeof editorValue !== 'string' || editorValue.trim() === '') {
      return null;
    }

    const parsed = Number(editorValue);
    return Number.isFinite(parsed) ? parsed : null;
  }

  if (typeof editorValue === 'string') {
    return editorValue;
  }

  if (Array.isArray(editorValue)) {
    return editorValue.join(', ');
  }

  return String(editorValue);
}

export function extractUrls(value: unknown): string[] {
  const urls: string[] = [];

  const addUrl = (candidate: unknown) => {
    if (typeof candidate !== 'string') return;
    const trimmed = candidate.trim();
    if (
      trimmed.startsWith('http://') ||
      trimmed.startsWith('https://') ||
      trimmed.startsWith('/')
    ) {
      urls.push(trimmed);
    }
  };

  if (typeof value === 'string') {
    addUrl(value);
    return urls;
  }

  if (Array.isArray(value)) {
    for (const entry of value) {
      if (typeof entry === 'string') {
        addUrl(entry);
        continue;
      }

      if (entry && typeof entry === 'object') {
        const record = entry as Record<string, unknown>;
        addUrl(record.url);
        addUrl(record.value);
      }
    }

    return urls;
  }

  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    addUrl(record.url);
    addUrl(record.value);

    if (record.file && typeof record.file === 'object') {
      addUrl((record.file as Record<string, unknown>).url);
    }
  }

  return urls;
}

export function supportsFileUpload(
  field: BaserowFieldSchema,
  rawValue: unknown,
): boolean {
  if (field.type === 'url' || field.type === 'file') return true;
  return extractUrls(rawValue).length > 0;
}

export function formatValueForDisplay(value: unknown): string {
  if (value === null || value === undefined) return '';

  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }

  if (Array.isArray(value)) {
    if (value.length === 0) return '';
    return value
      .map((entry) => {
        if (typeof entry === 'string') return entry;
        if (typeof entry === 'number' || typeof entry === 'boolean') {
          return String(entry);
        }
        if (entry && typeof entry === 'object') {
          const record = entry as Record<string, unknown>;
          const label =
            record.value ?? record.name ?? record.text ?? record.url;
          if (typeof label === 'string' || typeof label === 'number') {
            return String(label);
          }

          try {
            return JSON.stringify(entry);
          } catch {
            return '';
          }
        }
        return '';
      })
      .filter((entry) => entry.trim().length > 0)
      .join(', ');
  }

  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    const label = record.value ?? record.name ?? record.text ?? record.url;
    if (typeof label === 'string' || typeof label === 'number') {
      return String(label);
    }

    try {
      return JSON.stringify(value, null, 2);
    } catch {
      return '';
    }
  }

  return String(value);
}

export function buildEditorValueMap(
  fields: BaserowFieldSchema[],
  row: BaserowVideoRow,
): EditorValueMap {
  const values: EditorValueMap = {};

  for (const field of fields) {
    const key = fieldKeyFromId(field.id);
    values[key] = toEditorValue(field, row[key]);
  }

  return values;
}

function normalizeForComparison(value: EditorValue): string {
  if (Array.isArray(value)) {
    return JSON.stringify([...value].sort());
  }

  if (typeof value === 'boolean') {
    return value ? 'true' : 'false';
  }

  return value;
}

export function hasEditorValueChanged(
  previousValue: EditorValue,
  nextValue: EditorValue,
): boolean {
  return (
    normalizeForComparison(previousValue) !== normalizeForComparison(nextValue)
  );
}

export function sortedFields(
  fields: BaserowFieldSchema[],
): BaserowFieldSchema[] {
  // Preserve the exact order returned by Baserow fields API.
  // This mirrors Baserow's left-to-right column order in the modal
  // (rendered top-to-bottom).
  return [...fields];
}
