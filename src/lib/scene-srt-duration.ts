function parseNumberish(value?: unknown): number {
  if (typeof value === 'number') return value;
  if (typeof value === 'string') {
    const number = Number(value);
    return Number.isFinite(number) ? number : Number.NaN;
  }
  return Number.NaN;
}

export function extractSceneVideoUrl(raw: unknown): string {
  if (typeof raw === 'string') return raw.trim();
  if (!raw) return '';

  if (Array.isArray(raw) && raw.length > 0) {
    return extractSceneVideoUrl(raw[0]);
  }

  if (typeof raw === 'object') {
    const obj = raw as Record<string, unknown>;
    const url = obj.url ?? (obj.file as { url?: unknown } | undefined)?.url;
    if (typeof url === 'string') return url.trim();
  }

  return '';
}

export function resolveFinalSceneDuration(
  scene: Record<string, unknown>,
  allowOriginalDurationFallback: boolean,
): number {
  const finalDuration = parseNumberish(scene.field_7107);
  if (Number.isFinite(finalDuration) && finalDuration > 0) return finalDuration;

  if (allowOriginalDurationFallback && !extractSceneVideoUrl(scene.field_6886)) {
    const originalDuration = parseNumberish(scene.field_6884);
    if (Number.isFinite(originalDuration) && originalDuration > 0) {
      return originalDuration;
    }
  }

  return Number.NaN;
}
