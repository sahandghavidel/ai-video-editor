export type TtsSeedMode = 'random' | 'fixed';
export type TtsSeedPreset = { provider?: string; seedMode?: TtsSeedMode; seed?: number };
export function normalizeSeedMode(mode: unknown, provider: unknown): TtsSeedMode {
  return mode === 'random' || mode === 'fixed' ? mode : provider === 'omnivoice-lora' ? 'fixed' : 'random';
}
export function validTtsSeed(seed: unknown): seed is number {
  return typeof seed === 'number' && Number.isSafeInteger(seed) && seed >= 0 && seed <= 2_147_483_647;
}
export function resolvePresetSeed(preset: TtsSeedPreset, sharedSeed?: unknown, override?: unknown): number {
  if (validTtsSeed(override)) return override;
  if (normalizeSeedMode(preset.seedMode, preset.provider) === 'random') return Math.floor(Math.random() * 2_147_483_647);
  return validTtsSeed(preset.seed) ? preset.seed : validTtsSeed(sharedSeed) ? sharedSeed : 1212;
}
