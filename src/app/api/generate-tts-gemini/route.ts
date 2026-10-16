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
  const startedAt = Date.now();
  let context: { sceneId?: unknown; videoId?: unknown } = {};
  let stage = 'parse-request';
  try {
    const body = await request.json() as {
      text?: unknown; sceneId?: unknown; videoId?: unknown;
      ttsSettings?: { gemini?: unknown };
    };
    context = { sceneId: body.sceneId, videoId: body.videoId };
    const text = typeof body.text === 'string' ? body.text.trim() : '';
    if (!text || text.length > 12000) {
      return NextResponse.json({ error: 'Provide scene text between 1 and 12000 characters' }, { status: 400 });
    }
    const settings = normalizeGeminiTtsSettings(body.ttsSettings?.gemini);
    stage = 'generate-audio';
    const { buffer, usage } = await generateGeminiTts(text, settings);
    stage = 'write-audio';
    tempDir = await mkdtemp(path.join(os.tmpdir(), 'gemini-tts-'));
    const idPart = (value: unknown) => typeof value === 'number' && Number.isSafeInteger(value) && value > 0 ? value : 'sample';
    const filename = `video_${idPart(body.videoId)}_scene_${idPart(body.sceneId)}_tts_${Date.now()}_gemini_${randomUUID()}.wav`;
    const localPath = path.join(tempDir, filename);
    await writeFile(localPath, buffer);
    stage = 'upload-audio';
    const audioUrl = await uploadToMinio(localPath, filename, 'audio/wav');
    return NextResponse.json({ provider: 'gemini', audioUrl, filename,
      generationParams: { model: GEMINI_TTS_MODEL, ...settings }, usage });
  } catch (error) {
    const messages: string[] = [];
    let current: unknown = error;
    for (let depth = 0; current && depth < 4; depth += 1) {
      if (typeof current !== 'object') { messages.push(String(current)); break; }
      const item = current as { name?: unknown; message?: unknown; code?: unknown; cause?: unknown };
      messages.push([item.name, item.code, item.message].filter(Boolean).map(String).join(': '));
      current = item.cause;
    }
    let message = messages.filter(Boolean).join(' <- ') || 'Gemini TTS generation failed';
    for (const key of [process.env.GEMINI_API_KEY, process.env.GOOGLE_API_KEY]) {
      if (key?.trim()) message = message.replaceAll(key.trim(), '[REDACTED]');
    }
    const status = error instanceof GeminiTtsError ? error.status : 500;
    console.error('[Gemini TTS] Request failed', JSON.stringify({
      ...context, model: GEMINI_TTS_MODEL, stage, status,
      elapsedMs: Date.now() - startedAt, error: message,
    }));
    return NextResponse.json({ error: message }, { status });
  } finally {
    if (tempDir) await rm(tempDir, { recursive: true, force: true }).catch(() => {});
  }
}
