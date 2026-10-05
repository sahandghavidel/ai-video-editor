import { GEMINI_TTS_MODEL, isSupportedGeminiVoice, type GeminiTtsSettings } from '@/utils/geminiTtsSettings';

export function validateGeminiTtsSettings(settings: GeminiTtsSettings): string | null {
  if (!isSupportedGeminiVoice(settings.voice)) {
    return 'Choose a Gemini voice or enter a valid extended voice ID (such as en-us-ludo) or saved voice_ ID';
  }
  if (settings.style.length > 2000) return 'Gemini delivery style must be at most 2000 characters';
  return null;
}

// Shared by route instances during development reloads. One active generation
// at a time, with at least 10 seconds between request starts (at most 6 RPM).
const quotaState = globalThis as typeof globalThis & {
  geminiTtsQueue?: Promise<void>;
  geminiTtsLastStart?: number;
  geminiTtsCooldownUntil?: number;
};

async function runQueued<T>(generate: () => Promise<T>): Promise<T> {
  const previous = quotaState.geminiTtsQueue || Promise.resolve();
  const request = previous.catch(() => {}).then(generate);
  quotaState.geminiTtsQueue = request.then(() => {}, () => {});
  return request;
}

async function waitForRequestSlot(): Promise<void> {
  const nextStart = Math.max(
    (quotaState.geminiTtsLastStart || 0) + 10_000,
    quotaState.geminiTtsCooldownUntil || 0,
  );
  const delay = Math.max(0, nextStart - Date.now());
  if (delay) await new Promise((resolve) => setTimeout(resolve, delay));
  quotaState.geminiTtsLastStart = Date.now();
}

interface GeminiResult {
  status?: string;
  error?: { message?: string; details?: unknown[] };
  steps?: { type?: string; content?: { type?: string; data?: string; mime_type?: string }[] }[];
  usage?: unknown;
}

function rateLimitRecovery(attempt: number): boolean {
  if (attempt >= 2) return false;
  // Retry the exact same scene twice, one minute after each 429 response.
  // Hold the shared queue so another scene cannot consume the recovery window.
  quotaState.geminiTtsCooldownUntil = Date.now() + 60_000;
  return true;
}

export class GeminiTtsError extends Error {
  constructor(message: string, public status: number) { super(message); }
}

export async function generateGeminiTts(text: string, settings: GeminiTtsSettings) {
  const key = process.env.GEMINI_API_KEY?.trim();
  if (!key) throw new GeminiTtsError('GEMINI_API_KEY is not configured on the server', 400);
  const error = validateGeminiTtsSettings(settings);
  if (error) throw new GeminiTtsError(error, 400);
  return runQueued(async () => {
    for (let attempt = 0; ; attempt += 1) {
      await waitForRequestSlot();
      const response = await fetch('https://generativelanguage.googleapis.com/v1beta/interactions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
        body: JSON.stringify({
          model: GEMINI_TTS_MODEL,
          input: [{ type: 'user_input', content: [{
            type: 'text', text,
            annotations: [{ type: 'speech_metadata', style: settings.style }],
          }] }],
          response_format: { type: 'audio' },
          generation_config: { speech_config: [{ voice: settings.voice }] },
        }),
        signal: AbortSignal.timeout(110_000),
      });
      const result = await response.json() as GeminiResult;
      if (!response.ok) {
        if (response.status === 429 && rateLimitRecovery(attempt)) {
          console.info(`[Gemini TTS] HTTP 429; waiting 60 seconds before retry ${attempt + 1}/2 of the same scene`);
          continue;
        }
        const detail = (result.error?.message || `HTTP ${response.status}`).replaceAll(key, '[REDACTED]');
        throw new GeminiTtsError(`Gemini TTS: ${detail}`, response.status);
      }
      const audio = result.steps?.filter((step) => step.type === 'model_output')
        .flatMap((step) => step.content || []).filter((part) => part.type === 'audio').at(-1);
      if (result.status !== 'completed' || !audio?.data) {
        throw new GeminiTtsError('Gemini TTS did not return completed audio', 502);
      }
      const buffer = Buffer.from(audio.data, 'base64');
      if (buffer.length < 44 || buffer.toString('ascii', 0, 4) !== 'RIFF' || buffer.toString('ascii', 8, 12) !== 'WAVE') {
        throw new GeminiTtsError('Gemini TTS returned invalid WAV audio', 502);
      }
      return { buffer, usage: result.usage };
    }
  });
}
