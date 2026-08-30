export const SPEED_UP_MULTIPLIERS = [1, 1.125, 1.5, 2, 4, 8] as const;

export type SpeedUpMultiplier = (typeof SPEED_UP_MULTIPLIERS)[number];

export type SpeedUpVideoMetadata = {
  speed: SpeedUpMultiplier;
  muteAudio: boolean | null;
};

const speedPattern = SPEED_UP_MULTIPLIERS.map((speed) =>
  String(speed).replace('.', '\\.'),
).join('|');

const getFilenameFromUrl = (videoUrl: string): string => {
  const withoutQuery = videoUrl.split(/[?#]/, 1)[0] ?? videoUrl;
  const filename = withoutQuery.slice(withoutQuery.lastIndexOf('/') + 1);

  try {
    return decodeURIComponent(filename);
  } catch {
    return filename;
  }
};

/**
 * Reads speed-up settings encoded in the uploaded speed-up filename.
 * This intentionally performs no network or media probing.
 */
export const parseSpeedUpVideoMetadata = (
  videoUrl: string,
): SpeedUpVideoMetadata | null => {
  if (!videoUrl.trim()) return null;

  const filename = getFilenameFromUrl(videoUrl.trim());
  const match = filename.match(
    new RegExp(
      `(?:^|_)(${speedPattern})x(?:_(muted|unmuted))?(?:_\\d+)?\\.mp4$`,
      'i',
    ),
  );

  if (!match?.[1]) return null;

  const speed = Number(match[1]) as SpeedUpMultiplier;
  if (!SPEED_UP_MULTIPLIERS.includes(speed)) return null;

  return {
    speed,
    muteAudio:
      match[2]?.toLowerCase() === 'muted'
        ? true
        : match[2]?.toLowerCase() === 'unmuted'
          ? false
          : null,
  };
};
