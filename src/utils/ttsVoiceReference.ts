import { BaserowRow } from '@/lib/baserow-actions';

const DEFAULT_VOICE_TOKENS = new Set([
  'default',
  'global',
  'global default',
  'default voice',
  'system default',
  'use global',
  'use default',
  'global setting',
  'global settings',
]);

export function normalizeTtsVoiceReference(
  value: string | null | undefined,
): string | null {
  if (typeof value !== 'string') return null;

  const trimmed = value.trim();
  if (!trimmed) return null;

  const normalized = trimmed.toLowerCase();
  if (DEFAULT_VOICE_TOKENS.has(normalized)) {
    return null;
  }

  return trimmed;
}

function extractFromObject(value: Record<string, unknown>): string | null {
  const candidate =
    value.value ?? value.name ?? value.text ?? value.title ?? value.label;

  if (typeof candidate === 'string') {
    return normalizeTtsVoiceReference(candidate);
  }

  return null;
}

// Extract a voice reference filename from Baserow values.
// Rules:
// - preserve exact casing (case-sensitive matching downstream)
// - support plain strings, single-select objects, multi-select arrays
// - if multi-select has multiple items, use the first selected option
export function extractTtsVoiceReference(value: unknown): string | null {
  if (typeof value === 'string') {
    return normalizeTtsVoiceReference(value);
  }

  if (Array.isArray(value)) {
    for (const item of value) {
      const extracted = extractTtsVoiceReference(item);
      if (extracted) return extracted;
    }
    return null;
  }

  if (value && typeof value === 'object') {
    return extractFromObject(value as Record<string, unknown>);
  }

  return null;
}

export function getVideoTtsVoiceReference(video: BaserowRow): string | null {
  return extractTtsVoiceReference(video['field_6860']);
}
