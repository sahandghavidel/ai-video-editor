export type FinalVideoCaptionStatus = 'matched' | 'missing' | 'stale';

const getUrlFilename = (value: string): string => {
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

const sanitizeFilenamePart = (value: string): string =>
  value
    .replace(/\.[^.]+$/, '')
    .replace(/[^a-zA-Z0-9._-]+/g, '_')
    .replace(/^_+|_+$/g, '');

export const getFinalVideoCaptionFilename = (
  sceneId: number,
  finalVideoUrl: string,
): string | null => {
  const finalVideoName = sanitizeFilenamePart(getUrlFilename(finalVideoUrl));
  if (!finalVideoName) return null;

  return `scene_${sceneId}_final_${finalVideoName}_captions.json`;
};

export const getFinalVideoCaptionStatus = (input: {
  sceneId: number;
  finalVideoUrl: string;
  captionsUrl: string;
}): {
  status: FinalVideoCaptionStatus;
  expectedFilename: string | null;
  actualFilename: string;
} => {
  const expectedFilename = getFinalVideoCaptionFilename(
    input.sceneId,
    input.finalVideoUrl,
  );
  const actualFilename = getUrlFilename(input.captionsUrl);

  if (!actualFilename) {
    return { status: 'missing', expectedFilename, actualFilename };
  }

  return {
    status:
      expectedFilename && actualFilename === expectedFilename
        ? 'matched'
        : 'stale',
    expectedFilename,
    actualFilename,
  };
};
