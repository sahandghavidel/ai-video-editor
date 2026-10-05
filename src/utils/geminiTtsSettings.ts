export type LanguageTtsProvider = 'omnivoice' | 'gemini';

export interface GeminiTtsSettings {
  voice: string;
  style: string;
}

export const GEMINI_TTS_MODEL = 'gemini-3.8-flash-tts';
export const DEFAULT_GEMINI_TTS_SETTINGS: GeminiTtsSettings = {
  voice: 'Charon',
  style: 'Clear, steady, friendly tutorial narration at a natural pace. Pronounce technical terms clearly.',
};

// Featured studio voices from Google's TTS documentation.
export const GEMINI_TTS_VOICES = [
  ['en-us-ludo', 'Ludo — Confident and clear'],
  ['Charon', 'Informative'], ['Algieba', 'Smooth'], ['Iapetus', 'Clear'],
  ['Sadaltager', 'Knowledgeable'], ['Zephyr', 'Bright'], ['Puck', 'Upbeat'],
  ['Kore', 'Firm'], ['Fenrir', 'Excitable'], ['Leda', 'Youthful'],
  ['Orus', 'Firm'], ['Aoede', 'Breezy'], ['Callirrhoe', 'Easy-going'],
  ['Autonoe', 'Bright'], ['Enceladus', 'Breathy'], ['Umbriel', 'Easy-going'],
  ['Despina', 'Smooth'], ['Erinome', 'Clear'], ['Algenib', 'Gravelly'],
  ['Rasalgethi', 'Informative'], ['Laomedeia', 'Upbeat'], ['Achernar', 'Soft'],
  ['Alnilam', 'Firm'], ['Schedar', 'Even'], ['Gacrux', 'Mature'],
  ['Pulcherrima', 'Forward'], ['Achird', 'Friendly'], ['Zubenelgenubi', 'Casual'],
  ['Vindemiatrix', 'Gentle'], ['Sadachbia', 'Lively'], ['Sulafat', 'Warm'],
] as const;

export function isSupportedGeminiVoice(voice: string): boolean {
  return GEMINI_TTS_VOICES.some(([name]) => name === voice)
    || /^voice_[A-Za-z0-9_-]{1,200}$/.test(voice)
    || (voice.length <= 206 && /^[a-z]{2,3}-[a-z0-9]+(?:-[a-z0-9]+)+$/.test(voice));
}

export function normalizeGeminiTtsSettings(value: unknown): GeminiTtsSettings {
  const settings = value && typeof value === 'object'
    ? value as Record<string, unknown> : {};
  return {
    voice: typeof settings.voice === 'string'
      ? settings.voice.trim() : DEFAULT_GEMINI_TTS_SETTINGS.voice,
    style: typeof settings.style === 'string'
      ? settings.style : DEFAULT_GEMINI_TTS_SETTINGS.style,
  };
}
