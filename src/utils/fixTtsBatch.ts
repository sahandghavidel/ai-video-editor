import { BaserowRow } from '@/lib/baserow-actions';

export type FixTtsStatus = 'true' | 'confirmed' | null;

const normalizeFixTtsStatus = (raw: unknown): FixTtsStatus => {
  if (raw === true) {
    return 'true';
  }

  if (typeof raw === 'string') {
    const normalized = raw.trim().toLowerCase();
    if (normalized === 'true' || normalized === 'confirmed') {
      return normalized;
    }

    return null;
  }

  if (raw && typeof raw === 'object') {
    const rec = raw as Record<string, unknown>;
    return normalizeFixTtsStatus(
      rec.value ?? rec.name ?? rec.text ?? rec.title,
    );
  }

  return null;
};

export const parseFixTtsStatus = (raw: unknown): FixTtsStatus => {
  if (Array.isArray(raw)) {
    let sawTrue = false;
    for (const item of raw) {
      const parsed = normalizeFixTtsStatus(item);
      if (parsed === 'confirmed') {
        return 'confirmed';
      }
      if (parsed === 'true') {
        sawTrue = true;
      }
    }

    return sawTrue ? 'true' : null;
  }

  return normalizeFixTtsStatus(raw);
};

export const getSceneFixTtsStatus = (scene: BaserowRow): FixTtsStatus =>
  parseFixTtsStatus(scene['field_7096']);

export const isSceneFlaggedForFixTts = (scene: BaserowRow): boolean =>
  getSceneFixTtsStatus(scene) === 'true';

export const isSceneConfirmedForFixTts = (scene: BaserowRow): boolean =>
  getSceneFixTtsStatus(scene) === 'confirmed';

export const extractLinkedVideoId = (value: unknown): number | null => {
  if (typeof value === 'number') {
    return value;
  }

  if (typeof value === 'string') {
    const parsed = parseInt(value, 10);
    return Number.isFinite(parsed) ? parsed : null;
  }

  if (Array.isArray(value) && value.length > 0) {
    const first = value[0] as unknown;

    if (typeof first === 'number') {
      return first;
    }

    if (typeof first === 'string') {
      const parsed = parseInt(first, 10);
      return Number.isFinite(parsed) ? parsed : null;
    }

    if (typeof first === 'object' && first !== null) {
      const rec = first as Record<string, unknown>;
      const candidate = rec.id ?? rec.value;
      const parsed = parseInt(String(candidate ?? ''), 10);
      return Number.isFinite(parsed) ? parsed : null;
    }
  }

  if (typeof value === 'object' && value !== null) {
    const rec = value as Record<string, unknown>;
    const candidate = rec.id ?? rec.value;
    const parsed = parseInt(String(candidate ?? ''), 10);
    return Number.isFinite(parsed) ? parsed : null;
  }

  return null;
};

const hasNonEmptyTextLikeValue = (value: unknown): boolean => {
  if (typeof value === 'string') {
    return value.trim().length > 0;
  }

  if (Array.isArray(value)) {
    return value.some((item) => hasNonEmptyTextLikeValue(item));
  }

  if (value && typeof value === 'object') {
    const rec = value as Record<string, unknown>;
    return hasNonEmptyTextLikeValue(
      rec.url ?? rec.value ?? rec.name ?? rec.text ?? rec.title,
    );
  }

  return false;
};

export const hasSceneTtsAudioForFixTts = (scene: BaserowRow): boolean =>
  hasNonEmptyTextLikeValue(scene['field_6891']);

export const isFixTtsEligibleScene = (scene: BaserowRow): boolean => {
  const hasFinalVideo =
    typeof scene['field_6886'] === 'string' &&
    String(scene['field_6886']).trim().length > 0;
  const hasText = String(scene['field_6890'] ?? '').trim().length > 0;

  return hasFinalVideo && hasText;
};

export const getFixTtsEligibleScenes = (scenes: BaserowRow[]): BaserowRow[] => {
  return [...scenes]
    .filter(
      (scene) =>
        isFixTtsEligibleScene(scene) && !isSceneConfirmedForFixTts(scene),
    )
    .sort((a, b) => (Number(a.order) || 0) - (Number(b.order) || 0));
};

export const withSceneVoiceOverride = (
  scene: BaserowRow,
  ttsVoiceReference: string | null | undefined,
): BaserowRow => {
  const normalizedVoice =
    typeof ttsVoiceReference === 'string' ? ttsVoiceReference.trim() : '';

  if (!normalizedVoice) {
    return scene;
  }

  return {
    ...scene,
    field_6860: normalizedVoice,
  } as BaserowRow;
};
