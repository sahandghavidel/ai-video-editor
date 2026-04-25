import { BaserowRow } from '@/lib/baserow-actions';

type FlaggedScenesApiPayload = {
  error?: unknown;
  flaggedScenes?: unknown;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object';
}

function coerceSceneRows(value: unknown): BaserowRow[] {
  if (!Array.isArray(value)) return [];

  return value
    .filter((item): item is Record<string, unknown> => isRecord(item))
    .map((item) => {
      const parsedId =
        typeof item.id === 'number'
          ? item.id
          : typeof item.id === 'string'
            ? parseInt(item.id, 10)
            : Number.NaN;

      if (!Number.isFinite(parsedId) || parsedId <= 0) {
        return null;
      }

      return {
        ...item,
        id: parsedId,
      } as BaserowRow;
    })
    .filter((item): item is BaserowRow => item !== null);
}

export async function fetchFlaggedScenesForVideo(
  videoId: number,
): Promise<BaserowRow[]> {
  const response = await fetch('/api/fix-tts-flagged-scenes', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ videoId }),
  });

  const payload = (await response
    .json()
    .catch(() => null)) as FlaggedScenesApiPayload | null;

  if (!response.ok) {
    const errorMessage =
      payload && typeof payload.error === 'string'
        ? payload.error
        : `Failed to fetch flagged scenes (${response.status})`;
    throw new Error(errorMessage);
  }

  return coerceSceneRows(payload?.flaggedScenes);
}
