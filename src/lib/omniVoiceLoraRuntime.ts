import path from 'path';
import os from 'os';
import { existsSync } from 'fs';
import { resolveOmniVoiceLoraVersion } from '@/utils/omniVoiceLoraVersions';

export function resolveOmniVoiceLoraPython(root: string): string {
  const isolatedPython = path.join(root, 'runtime-env', 'bin', 'python');
  return existsSync(isolatedPython) ? isolatedPython : path.join(root, 'env', 'bin', 'python');
}

export function resolveOmniVoiceLoraRuntime(language: string, version: unknown) {
  const binding = resolveOmniVoiceLoraVersion(language, version);
  if (!binding) throw new Error('Unsupported OmniVoice LoRA language/model binding');
  const root = binding.id === 'persian-v1'
    ? process.env.OMNIVOICE_PERSIAN_LORA_ROOT?.trim()
      || path.join(os.homedir(), 'Documents', 'OmniVoice-Persian-LoRA-v1')
    : process.env.OMNIVOICE_LORA_ROOT?.trim()
      || path.join(os.homedir(), 'Documents', 'OmniVoice-LoRA-Test');
  // A corrected copy can be used without modifying the original experiment environment.
  return { ...binding, root,
    python: resolveOmniVoiceLoraPython(root),
    adapterPath: path.join(root, 'approved-v1', 'adapter') };
}
