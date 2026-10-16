/** Retry only Gemini scene batches, after their in-flight saves have finished. */
export async function runWithGeminiSceneRecovery<T extends {
  ok?: unknown;
  failedSceneIds?: unknown;
  unfinishedSceneIds?: unknown;
}>(options: {
  provider: string;
  send: (sceneIds?: number[]) => Promise<{ response: Response; payload: T | null }>;
  onRetry: (round: number, sceneIds: number[], payload: T | null) => void;
}): Promise<{ response: Response; payload: T | null }> {
  let result = await options.send();
  if (options.provider !== 'gemini') return result;
  for (let round = 1; round <= 2 && result.payload?.ok !== true; round += 1) {
    const sceneIds = [...new Set([
      ...(Array.isArray(result.payload?.failedSceneIds) ? result.payload.failedSceneIds : []),
      ...(Array.isArray(result.payload?.unfinishedSceneIds) ? result.payload.unfinishedSceneIds : []),
    ].filter((id): id is number => typeof id === 'number' && Number.isSafeInteger(id) && id > 0))];
    // Without explicit scene identities, never guess or regenerate the whole video.
    if (!sceneIds.length) break;
    options.onRetry(round, sceneIds, result.payload);
    await new Promise<void>((resolve) => setTimeout(resolve, 60_000));
    result = await options.send(sceneIds);
  }
  return result;
}
