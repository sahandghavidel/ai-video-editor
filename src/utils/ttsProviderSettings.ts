// Strip retired provider settings when loading, updating or saving persisted TTS settings.
export function normalizeTtsSettings<T extends object>(settings: T) {
  const clean = { ...settings } as T & Record<string, unknown>;
  delete clean.fish;
  delete clean.temperature;
  delete clean.exaggeration;
  delete clean.cfg_weight;
  return { ...clean, provider: clean.provider === 'omnivoice-lora' ? 'omnivoice-lora' as const : 'omnivoice' as const };
}
