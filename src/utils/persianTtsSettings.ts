export interface PersianTtsSettings {
  referenceAudio: string;
  seed: number;
  exaggeration: number;
  cfgWeight: number;
  temperature: number;
  repetitionPenalty: number;
  topP: number;
  minP: number;
  steps: number;
}
export const DEFAULT_PERSIAN_TTS_SETTINGS: PersianTtsSettings = {
  referenceAudio: '', seed: 42, exaggeration: 0.5, cfgWeight: 0.5,
  temperature: 0.8, repetitionPenalty: 2, topP: 1, minP: 0.05, steps: 10,
};
export const PERSIAN_CONTROL_RANGES = {
  seed: [0, 2147483647, 1], exaggeration: [0, 1, 0.05], cfgWeight: [0, 1, 0.05],
  temperature: [0.05, 2, 0.05], repetitionPenalty: [1, 5, 0.1],
  topP: [0.01, 1, 0.01], minP: [0, 1, 0.01], steps: [1, 100, 1],
} as const;
export function normalizePersianTtsSettings(value: unknown): PersianTtsSettings {
  const raw = value && typeof value === 'object' ? value as Record<string, unknown> : {};
  const result = { ...DEFAULT_PERSIAN_TTS_SETTINGS };
  result.referenceAudio = typeof raw.referenceAudio === 'string' ? raw.referenceAudio.trim() : '';
  for (const key of Object.keys(PERSIAN_CONTROL_RANGES) as Array<keyof typeof PERSIAN_CONTROL_RANGES>) {
    const n = raw[key];
    const [min, max] = PERSIAN_CONTROL_RANGES[key];
    if (typeof n === 'number' && Number.isFinite(n)) {
      result[key] = Math.max(min, Math.min(max, key === 'seed' || key === 'steps' ? Math.round(n) : n));
    }
  }
  return result;
}
