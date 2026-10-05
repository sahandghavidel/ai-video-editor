import { ensurePersianTtsRunning, beginPersianTtsRequest, finishPersianTtsRequest } from '@/lib/persianTtsRuntime';
import { resolveReferenceAudioPath } from '@/lib/ttsReferenceAudio';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { readFile } from 'fs/promises';
import { normalizePersianTtsSettings } from '@/utils/persianTtsSettings';
import { NextRequest, NextResponse } from 'next/server';
import { mkdtemp, writeFile, rm } from 'fs/promises';
import path from 'path';
import os from 'os';
import { randomUUID } from 'crypto';
import { uploadToMinio } from '@/utils/ffmpeg-direct';

export const runtime = 'nodejs';
export const maxDuration = 900;

export async function POST(request: NextRequest) {
  let tempDir: string | undefined;
  beginPersianTtsRequest();
  try {
    const body = await request.json() as {
      text?: unknown; sceneId?: unknown; videoId?: unknown;
      referenceAudioFilename?: string;
      ttsSettings?: { persian?: unknown; reference_audio_filename?: string; omniVoice?: { referenceAudioDir?: string; deviceMap?: string; speed?: number } };
    };
    const text = typeof body.text === 'string' ? body.text.trim() : '';
    if (!text || text.length > 12000) {
      return NextResponse.json({ error: 'Provide scene text between 1 and 12000 characters' }, { status: 400 });
    }
    const referenceName = body.referenceAudioFilename || body.ttsSettings?.reference_audio_filename;
    const referenceAudio = referenceName ? resolveReferenceAudioPath({ filenameOrPath: referenceName,
      configuredDir: body.ttsSettings?.omniVoice?.referenceAudioDir }).fullPath : undefined;
    await ensurePersianTtsRunning();
    const response = await fetch('http://127.0.0.1:9547/speech', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text, language: 'fa', ...(() => {
        const settings = normalizePersianTtsSettings(body.ttsSettings?.persian);
        return { reference_audio: referenceAudio || settings.referenceAudio || null, device: body.ttsSettings?.omniVoice?.deviceMap || 'auto', seed: settings.seed,
          exaggeration: settings.exaggeration, cfg_weight: settings.cfgWeight,
          temperature: settings.temperature, repetition_penalty: settings.repetitionPenalty,
          top_p: settings.topP, min_p: settings.minP, steps: settings.steps };
      })() }), signal: AbortSignal.timeout(90000),
    });
    if (!response.ok) return NextResponse.json({ error: 'Isolated Persian TTS generation failed' }, { status: response.status });
    const buffer = Buffer.from(await response.arrayBuffer());
    if (buffer.length < 44 || buffer.toString('ascii', 0, 4) !== 'RIFF') throw new Error('Invalid Persian WAV response');
    tempDir = await mkdtemp(path.join(os.tmpdir(), 'persian-tts-'));
    const idPart = (value: unknown) => typeof value === 'number' && Number.isSafeInteger(value) && value > 0 ? value : 'sample';
    const filename = `video_${idPart(body.videoId)}_scene_${idPart(body.sceneId)}_tts_${Date.now()}_persian_${randomUUID()}.wav`;
    const localPath = path.join(tempDir, filename);
    await writeFile(localPath, buffer);
    const speed = Math.max(0.5, Math.min(2, body.ttsSettings?.omniVoice?.speed || 1));
    if (speed !== 1) {
      const adjusted = path.join(tempDir, 'speed.wav');
      await promisify(execFile)(process.env.FFMPEG_PATH || 'ffmpeg', ['-y', '-i', localPath, '-af', `atempo=${speed}`, '-c:a', 'pcm_s16le', adjusted]);
      await writeFile(localPath, await readFile(adjusted));
    }
    const audioUrl = await uploadToMinio(localPath, filename, 'audio/wav');
    return NextResponse.json({ provider: 'chatterbox-persian', audioUrl, filename,
      generationParams: { model: 'Thomcles/Chatterbox-TTS-Persian-Farsi' } });
  } catch (error) {
    const rawMessage = error instanceof Error ? error.message : 'Persian TTS generation failed';
    const message = rawMessage;
    return NextResponse.json({ error: message }, { status: 500 });
  } finally {
    finishPersianTtsRequest();
    if (tempDir) await rm(tempDir, { recursive: true, force: true }).catch(() => {});
  }
}
