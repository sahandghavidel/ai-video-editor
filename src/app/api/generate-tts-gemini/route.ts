import { NextRequest, NextResponse } from 'next/server';
import { mkdtemp, writeFile, rm } from 'fs/promises';
import path from 'path';
import os from 'os';
import { randomUUID } from 'crypto';
import { generateGeminiTts, GeminiTtsError } from '@/lib/geminiTts';
import { normalizeGeminiTtsSettings, GEMINI_TTS_MODEL } from '@/utils/geminiTtsSettings';
import { uploadToMinio } from '@/utils/ffmpeg-direct';

export const runtime = 'nodejs';
export const maxDuration = 900;

export async function POST(request: NextRequest) {
  let tempDir: string | undefined;
  try {
    const body = await request.json() as {
      text?: unknown; sceneId?: unknown; videoId?: unknown;
      ttsSettings?: { gemini?: unknown };
    };
    const text = typeof body.text === 'string' ? body.text.trim() : '';
    if (!text || text.length > 12000) {
      return NextResponse.json({ error: 'Provide scene text between 1 and 12000 characters' }, { status: 400 });
    }
    const settings = normalizeGeminiTtsSettings(body.ttsSettings?.gemini);
    const { buffer, usage } = await generateGeminiTts(text, settings);
    tempDir = await mkdtemp(path.join(os.tmpdir(), 'gemini-tts-'));
    const idPart = (value: unknown) => typeof value === 'number' && Number.isSafeInteger(value) && value > 0 ? value : 'sample';
    const filename = `video_${idPart(body.videoId)}_scene_${idPart(body.sceneId)}_tts_${Date.now()}_gemini_${randomUUID()}.wav`;
    const localPath = path.join(tempDir, filename);
    await writeFile(localPath, buffer);
    const audioUrl = await uploadToMinio(localPath, filename, 'audio/wav');
    return NextResponse.json({ provider: 'gemini', audioUrl, filename,
      generationParams: { model: GEMINI_TTS_MODEL, ...settings }, usage });
  } catch (error) {
    const key = process.env.GEMINI_API_KEY?.trim();
    const rawMessage = error instanceof Error ? error.message : 'Gemini TTS generation failed';
    const message = key ? rawMessage.replaceAll(key, '[REDACTED]') : rawMessage;
    return NextResponse.json({ error: message }, { status: error instanceof GeminiTtsError ? error.status : 500 });
  } finally {
    if (tempDir) await rm(tempDir, { recursive: true, force: true }).catch(() => {});
  }
}
