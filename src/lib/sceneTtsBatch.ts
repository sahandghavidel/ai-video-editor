import { getGeminiTtsConcurrency } from '@/lib/geminiTtsLimits';

/** Only the Gemini provider opts into parallel scene processing. */
export async function runSceneTtsBatch<T>(options: {
  provider: string;
  scenes: readonly T[];
  processScene: (scene: T) => Promise<void>;
  shouldStop: () => boolean;
}): Promise<void> {
  const { provider, scenes, processScene, shouldStop } = options;
  if (provider !== 'gemini') {
    for (const scene of scenes) {
      if (shouldStop()) break;
      await processScene(scene);
    }
    return;
  }

  let nextIndex = 0;
  let failed = false;
  const worker = async () => {
    while (!failed && !shouldStop() && nextIndex < scenes.length) {
      const scene = scenes[nextIndex++];
      try {
        await processScene(scene);
      } catch (error) {
        failed = true;
        throw error;
      }
    }
  };
  // Drain in-flight scenes (including their saves) before returning an error
  // or allowing the caller to start merging the generated audio.
  const results = await Promise.allSettled(
    Array.from({ length: Math.min(getGeminiTtsConcurrency(), scenes.length) }, worker),
  );
  const failure = results.find((result) => result.status === 'rejected');
  if (failure?.status === 'rejected') throw failure.reason;
}
