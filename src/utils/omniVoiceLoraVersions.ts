// Shared preset bindings. Paths are resolved only on the server, never from presets.
export const OMNIVOICE_LORA_VERSIONS = [
  { id: 'approved-v1', language: 'en', name: 'English v1', trainingStep: 400 },
  { id: 'persian-v1', language: 'fa', name: 'Persian v1', trainingStep: 3000 },
  { id: 'persian-v2-pass-2', language: 'fa', name: 'Persian v2 — 2 passes', trainingStep: 4700 },
  { id: 'persian-v2-pass-8', language: 'fa', name: 'Persian v2 — 8 passes', trainingStep: 18799 },
] as const;

export type OmniVoiceLoraVersion = typeof OMNIVOICE_LORA_VERSIONS[number]['id'];

export function resolveOmniVoiceLoraVersion(language: string, version: unknown) {
  // Old English presets have no binding; they must keep loading English v1.
  const id = version === undefined && language === 'en' ? 'approved-v1' : version;
  return OMNIVOICE_LORA_VERSIONS.find((entry) => entry.id === id && entry.language === language);
}

export function validateOmniVoiceLoraPreset(preset: {
  language: string; loraAdapterVersion?: unknown; referenceText?: unknown;
}): string | null {
  if (!resolveOmniVoiceLoraVersion(preset.language, preset.loraAdapterVersion)) {
    return 'Choose a supported OmniVoice LoRA model matching the preset language';
  }
  if (typeof preset.referenceText !== 'string' || !preset.referenceText.trim()) {
    return 'OmniVoice LoRA requires a reference transcript';
  }
  return null;
}
