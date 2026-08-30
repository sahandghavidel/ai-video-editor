export type SpeechIdentity = {
  kind: 'tts' | 'video';
  value: string;
};

export const getMediaFilename = (value: string): string => {
  const normalized = value.trim();
  if (!normalized) return '';

  try {
    const pathname = new URL(normalized).pathname;
    return decodeURIComponent(pathname.split('/').filter(Boolean).pop() ?? '');
  } catch {
    const pathname = normalized.split(/[?#]/, 1)[0];
    const filename = pathname.split('/').filter(Boolean).pop() ?? '';
    try {
      return decodeURIComponent(filename);
    } catch {
      return filename;
    }
  }
};

const hashIdentity = (value: string): string => {
  let first = 0x811c9dc5;
  let second = 0x9e3779b9;
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    first ^= code;
    first = Math.imul(first, 0x01000193);
    second ^= code;
    second = Math.imul(second, 0x85ebca6b);
  }
  return `${(first >>> 0).toString(16).padStart(8, '0')}${(second >>> 0)
    .toString(16)
    .padStart(8, '0')}`;
};

export const getSpeechIdentity = (finalVideoUrl: string): SpeechIdentity | null => {
  const filename = getMediaFilename(finalVideoUrl);
  if (!filename) return null;

  const embeddedTts = filename.match(/(?:^|_)tts_(\d{13})(?:_|\.)/i);
  if (embeddedTts?.[1]) return { kind: 'tts', value: embeddedTts[1] };

  const syncedTts = filename.match(/(?:^|_)synced_(\d{13})(?:_|\.)/i);
  if (syncedTts?.[1]) return { kind: 'tts', value: syncedTts[1] };

  const embeddedFallback = filename.match(
    /(?:^|_)video_([a-f0-9]{16})(?:_|\.)/i,
  );
  if (embeddedFallback?.[1]) {
    return { kind: 'video', value: embeddedFallback[1].toLowerCase() };
  }

  return { kind: 'video', value: hashIdentity(filename) };
};

export const getHyperFramesIdentity = (
  hyperFramesVideoUrl: string,
): string | null => {
  const filename = getMediaFilename(hyperFramesVideoUrl);
  return filename ? hashIdentity(filename) : null;
};

export const getAppliedHyperFramesFilename = (input: {
  sceneId: number;
  finalVideoUrl: string;
  hyperFramesVideoUrl: string;
}): string | null => {
  const speech = getSpeechIdentity(input.finalVideoUrl);
  const hyperFrames = getHyperFramesIdentity(input.hyperFramesVideoUrl);
  if (!speech || !hyperFrames) return null;

  return `scene_${input.sceneId}_${speech.kind}_${speech.value}_hf_${hyperFrames}.mp4`;
};

export const isHyperFramesAlreadyApplied = (input: {
  sceneId: number;
  finalVideoUrl: string;
  hyperFramesVideoUrl: string;
}): boolean => {
  const expected = getAppliedHyperFramesFilename(input);
  return Boolean(expected && getMediaFilename(input.finalVideoUrl) === expected);
};
