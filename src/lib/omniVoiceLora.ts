import { runOmniVoiceLoraJob } from '@/lib/omniVoiceLoraWorker';
import { access, mkdtemp, readFile, rm } from 'fs/promises';
import path from 'path';
import os from 'os';
import { resolveOmniVoiceLoraRuntime } from '@/lib/omniVoiceLoraRuntime';
import { validateOmniVoiceLoraPreset } from '@/utils/omniVoiceLoraVersions';
import { NextResponse } from 'next/server';
import { ensureMinioRunning } from '@/lib/minio-runtime';
import { resolveReferenceAudioPath } from '@/lib/ttsReferenceAudio';
import type { TtsAudioReferenceEntry } from '@/lib/ttsAudioReferencesStore';

export async function generateOmniVoiceLora(input: {
  text: string;
  preset: TtsAudioReferenceEntry;
  sceneId?: unknown;
  videoId?: unknown;
  seed?: unknown;
}) {
  const presetError = validateOmniVoiceLoraPreset(input.preset);
  if (presetError) {
    return NextResponse.json({ error: presetError }, { status: 400 });
  }
  if (input.text.length > 12000) {
    return NextResponse.json({ error: 'LoRA scene text must be at most 12000 characters' }, { status: 400 });
  }
  const runtime = resolveOmniVoiceLoraRuntime(input.preset.language, input.preset.loraAdapterVersion);
  const { root, python, language } = runtime;
  await Promise.all([access(python), access(path.join(root, 'base-model', 'config.json')),
    access(path.join(runtime.adapterPath, runtime.modelType === 'full-finetune' ? 'model.safetensors' : 'adapter_model.safetensors'))]);
  const reference = resolveReferenceAudioPath({ filenameOrPath: input.preset.filename }).fullPath;
  let tempDir: string | undefined;
  try {
    tempDir = await mkdtemp(path.join(os.tmpdir(), 'omnivoice-lora-'));
    const output = path.join(tempDir, 'output.wav');
    const seed = typeof input.seed === 'number' && Number.isSafeInteger(input.seed) && input.seed >= 0
      ? input.seed : 1212;
    const device = input.preset.deviceMap === 'cpu' ? 'cpu' : 'mps';
    const metrics = await runOmniVoiceLoraJob(root, device, { output, text: input.text,
      reference_audio: reference, reference_text: input.preset.referenceText,
      seed, num_step: input.preset.numStep, speed: input.preset.speed, language }, runtime.id);
    const bytes = await readFile(output);
    if (bytes.length < 44 || bytes.toString('ascii', 0, 4) !== 'RIFF') throw new Error('Invalid LoRA WAV output');
    const id = (value: unknown) => typeof value === 'number' && Number.isSafeInteger(value) && value > 0 ? value : 'sample';
    const timestamp = Date.now();
    const hasVideoId = input.videoId !== undefined && input.videoId !== null && String(input.videoId).trim().length > 0;
    const hasSceneId = input.sceneId !== undefined && input.sceneId !== null && String(input.sceneId).trim().length > 0;
    const filename = hasVideoId
      ? hasSceneId
        ? `video_${id(input.videoId)}_tts_original_${language}_scene_${id(input.sceneId)}_${timestamp}.wav`
        : `video_${id(input.videoId)}_tts_original_${language}_${timestamp}.wav`
      : `scene_${id(input.sceneId)}_tts_original_${language}_${timestamp}.wav`;
    const { baseUrl, bucket } = await ensureMinioRunning();
    const audioUrl = `${baseUrl.replace(/\/+$/, '')}/${bucket}/${filename}`;
    const uploaded = await fetch(audioUrl, { method: 'PUT', headers: { 'Content-Type': 'audio/wav' }, body: new Uint8Array(bytes) });
    if (!uploaded.ok) throw new Error(`LoRA MinIO upload failed (${uploaded.status})`);
    return NextResponse.json({ provider: 'omnivoice-lora', audioUrl, filename,
      generationParams: { adapterVersion: runtime.id, modelType: runtime.modelType, language, trainingStep: runtime.trainingStep, referencePresetId: input.preset.id,
        referenceAudioFilename: input.preset.filename, numStep: input.preset.numStep, speed: input.preset.speed,
        dtype: 'float32', deviceMap: device, seed, denoise: false, postprocessOutput: false,
        preprocessPrompt: false, fadeDuration: 0, padDuration: 0, ...metrics } });
  } finally {
    if (tempDir) await rm(tempDir, { recursive: true, force: true }).catch(() => {});
  }
}
