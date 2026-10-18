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
  const isPersianV2 = binding.id === 'persian-v2-pass-2' || binding.id === 'persian-v2-pass-8';
  const isFullModel = binding.id === 'persian-full-v1';
  const root = isFullModel
    ? process.env.OMNIVOICE_PERSIAN_FULL_ROOT?.trim()
      || path.join(os.homedir(), 'Documents', 'OmniVoice-Persian-Full-Finetune-v1')
    : isPersianV2
    ? process.env.OMNIVOICE_PERSIAN_LORA_V2_ROOT?.trim()
      || path.join(os.homedir(), 'Documents', 'OmniVoice-Persian-LoRA-v2')
    : binding.id === 'persian-v1'
    ? process.env.OMNIVOICE_PERSIAN_LORA_ROOT?.trim()
      || path.join(os.homedir(), 'Documents', 'OmniVoice-Persian-LoRA-v1')
    : process.env.OMNIVOICE_LORA_ROOT?.trim()
      || path.join(os.homedir(), 'Documents', 'OmniVoice-LoRA-Test');
  // A corrected copy can be used without modifying the original experiment environment.
  return { ...binding, root,
    modelType: isFullModel ? 'full-finetune' : 'lora',
    python: resolveOmniVoiceLoraPython(root),
    adapterPath: isFullModel ? path.join(root, 'application-v1', 'model') : isPersianV2
      ? path.join(root, 'application-v2', binding.id === 'persian-v2-pass-2' ? 'pass-2' : 'pass-8', 'adapter')
      : path.join(root, 'approved-v1', 'adapter') };
}
