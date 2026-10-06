import { execFile } from 'child_process';
import { promisify } from 'util';
import { access, mkdtemp, open, readFile, rm, unlink } from 'fs/promises';
import path from 'path';
import os from 'os';
import { NextResponse } from 'next/server';
import { ensureMinioRunning } from '@/lib/minio-runtime';
import { resolveReferenceAudioPath } from '@/lib/ttsReferenceAudio';
import type { TtsAudioReferenceEntry } from '@/lib/ttsAudioReferencesStore';

const execFileAsync = promisify(execFile);

export async function generateOmniVoiceLora(input: {
  text: string;
  preset: TtsAudioReferenceEntry;
  sceneId?: unknown;
  videoId?: unknown;
  seed?: unknown;
}) {
  if (input.preset.language !== 'en' || !input.preset.referenceText.trim()) {
    return NextResponse.json({ error: 'OmniVoice LoRA requires an English preset and reference transcript' }, { status: 400 });
  }
  if (input.text.length > 12000) {
    return NextResponse.json({ error: 'LoRA scene text must be at most 12000 characters' }, { status: 400 });
  }
  const root = process.env.OMNIVOICE_LORA_ROOT?.trim()
    || path.join(os.homedir(), 'Documents', 'OmniVoice-LoRA-Test');
  const python = path.join(root, 'env', 'bin', 'python');
  await Promise.all([access(python), access(path.join(root, 'base-model', 'config.json')),
    access(path.join(root, 'approved-v1', 'adapter', 'adapter_model.safetensors'))]);
  const reference = resolveReferenceAudioPath({ filenameOrPath: input.preset.filename }).fullPath;
  const lockPath = path.join(root, 'application.lock');
  // The lock spans Next.js reloads and separate route bundles. Never load two LoRA models concurrently.
  let lock;
  try {
    lock = await open(lockPath, 'wx');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'EEXIST') {
      return NextResponse.json({ error: 'OmniVoice LoRA is busy. Retry after the current generation finishes.' }, { status: 409 });
    }
    throw error;
  }
  let tempDir: string | undefined;
  try {
    await lock.writeFile(JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString() }));
    tempDir = await mkdtemp(path.join(os.tmpdir(), 'omnivoice-lora-'));
    const output = path.join(tempDir, 'output.wav');
    const jobPath = path.join(tempDir, 'job.json');
    const seed = typeof input.seed === 'number' && Number.isSafeInteger(input.seed) && input.seed >= 0
      ? input.seed : 1212;
    const device = input.preset.deviceMap === 'cpu' ? 'cpu' : 'mps';
    const job = await open(jobPath, 'wx');
    try {
      await job.writeFile(JSON.stringify({ runtime_root: root, output, text: input.text,
        reference_audio: reference, reference_text: input.preset.referenceText,
        seed, device, num_step: input.preset.numStep, speed: input.preset.speed }));
    } finally { await job.close(); }
    const { stdout } = await execFileAsync(python,
      [path.join(process.cwd(), 'omnivoice-lora-local', 'generate.py'), '--job', jobPath],
      { timeout: 900000, maxBuffer: 4 * 1024 * 1024,
        env: { ...process.env, HF_HUB_OFFLINE: '1', OMP_NUM_THREADS: '4', MKL_NUM_THREADS: '4' } });
    const metrics = JSON.parse(stdout.trim().split('\n').at(-1) || '{}');
    const bytes = await readFile(output);
    if (bytes.length < 44 || bytes.toString('ascii', 0, 4) !== 'RIFF') throw new Error('Invalid LoRA WAV output');
    const id = (value: unknown) => typeof value === 'number' && Number.isSafeInteger(value) && value > 0 ? value : 'sample';
    const timestamp = Date.now();
    const hasVideoId = input.videoId !== undefined && input.videoId !== null && String(input.videoId).trim().length > 0;
    const hasSceneId = input.sceneId !== undefined && input.sceneId !== null && String(input.sceneId).trim().length > 0;
    const filename = hasVideoId
      ? hasSceneId
        ? `video_${id(input.videoId)}_tts_original_en_scene_${id(input.sceneId)}_${timestamp}.wav`
        : `video_${id(input.videoId)}_tts_original_en_${timestamp}.wav`
      : `scene_${id(input.sceneId)}_tts_original_en_${timestamp}.wav`;
    const { baseUrl, bucket } = await ensureMinioRunning();
    const audioUrl = `${baseUrl.replace(/\/+$/, '')}/${bucket}/${filename}`;
    const uploaded = await fetch(audioUrl, { method: 'PUT', headers: { 'Content-Type': 'audio/wav' }, body: new Uint8Array(bytes) });
    if (!uploaded.ok) throw new Error(`LoRA MinIO upload failed (${uploaded.status})`);
    return NextResponse.json({ provider: 'omnivoice-lora', audioUrl, filename,
      generationParams: { adapterVersion: 'approved-v1', trainingStep: 400, referencePresetId: input.preset.id,
        referenceAudioFilename: input.preset.filename, numStep: input.preset.numStep, speed: input.preset.speed,
        dtype: 'float32', deviceMap: device, seed, denoise: false, postprocessOutput: false,
        preprocessPrompt: false, fadeDuration: 0, padDuration: 0, ...metrics } });
  } finally {
    if (tempDir) await rm(tempDir, { recursive: true, force: true }).catch(() => {});
    await lock.close();
    await unlink(lockPath);
  }
}
