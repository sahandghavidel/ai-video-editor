export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    const { resumeBatchJobs } = await import('@/lib/geminiBatchRunner');
    // On-demand local application recovery; no OS service or local TTS changes.
    await resumeBatchJobs().catch(error => console.error('[Gemini Batch] Startup recovery failed:', error instanceof Error ? error.message : 'Unknown error'));
  }
}
