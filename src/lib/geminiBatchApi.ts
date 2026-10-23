import { GEMINI_TTS_MODEL, normalizeGeminiTtsSettings } from '@/utils/geminiTtsSettings';
import type { GeminiBatchJob } from '@/lib/geminiBatchStore';

const BASE = 'https://generativelanguage.googleapis.com/v1beta';
export class BatchApiError extends Error {
  constructor(message: string, public status: number) { super(message); }
}
export async function googleBatchRequest(resource: string, body?: unknown) {
  const key = process.env.GEMINI_API_KEY?.trim();
  if (!key) throw new Error('GEMINI_API_KEY is not configured');
  const response = await fetch(`${BASE}/${resource}`, {
    method: body ? 'POST' : 'GET', headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
    ...(body ? { body: JSON.stringify(body) } : {}), cache: 'no-store', signal: AbortSignal.timeout(120_000),
  });
  const payload = await response.json();
  if (!response.ok) throw new BatchApiError(`Google Batch ${response.status}: ${String(payload?.error?.message || response.statusText).replaceAll(key, '[REDACTED]')}`, response.status);
  return payload;
}
export function buildGeminiBatchRequest(job: GeminiBatchJob) {
  const settings = normalizeGeminiTtsSettings((job.step2.ttsSettings as { gemini?: unknown })?.gemini);
  const keys = new Set(job.roundKeys);
  const body = { batch: { display_name: job.displayName, input_config: { requests: { requests:
    job.scenes.filter(scene => keys.has(scene.key)).map(scene => ({
      metadata: { key: scene.key }, request: {
        contents: [{ role: 'user', parts: [{ text: scene.text, speechMetadata: { style: settings.style } }] }],
        generationConfig: { responseModalities: ['AUDIO'], speechConfig: { voiceConfig: { voice: settings.voice } } },
      },
    })),
  } } } };
  // Inline jobs must be below 20MB; fail explicitly rather than silently charge Standard.
  if (Buffer.byteLength(JSON.stringify(body)) >= 19_000_000) throw new Error('Gemini Batch input exceeds the inline size limit. Split this video into smaller jobs.');
  return body;
}
export const createGeminiBatch = (job: GeminiBatchJob) => googleBatchRequest(`models/${GEMINI_TTS_MODEL}:batchGenerateContent`, buildGeminiBatchRequest(job));
export function validateOperationName(name: unknown): string {
  if (typeof name !== 'string' || !/^batches\/[A-Za-z0-9_-]+$/.test(name)) throw new Error('Invalid Google Batch operation name');
  return name;
}
export function decodeBatchAudio(response: { candidates?: { finishReason?: string; content?: { parts?: { inlineData?: { mimeType?: string; data?: string } }[] } }[] }): Buffer {
  const candidate = response.candidates?.[0];
  if (candidate?.finishReason !== 'STOP') throw new Error(`Incomplete Batch audio (${candidate?.finishReason || 'no candidate'})`);
  const parts = candidate.content?.parts?.filter(part => part.inlineData?.data) || [];
  if (parts.length !== 1 || !/^audio\/wav(?:;|$)/i.test(parts[0].inlineData?.mimeType || '')) throw new Error('Expected one WAV audio result');
  const buffer = Buffer.from(parts[0].inlineData!.data!, 'base64');
  if (buffer.length < 44 || buffer.toString('ascii', 0, 4) !== 'RIFF' || buffer.toString('ascii', 8, 12) !== 'WAVE') throw new Error('Invalid Batch WAV audio');
  return buffer;
}
