// Server-only limits. Local TTS providers never read these settings.
export function getGeminiTtsConcurrency(): number {
  const configured = Number(process.env.GEMINI_TTS_MAX_CONCURRENT);
  return Number.isSafeInteger(configured) && configured >= 1 ? configured : 10;
}

export function getGeminiTtsRequestIntervalMs(): number {
  const configured = Number(process.env.GEMINI_TTS_MIN_INTERVAL_MS);
  return Number.isSafeInteger(configured) && configured >= 1000 ? configured : 1000;
}
