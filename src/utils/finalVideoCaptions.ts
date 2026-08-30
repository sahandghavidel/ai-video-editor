import { getMediaFilename, getSpeechIdentity } from '@/utils/finalVideoIdentity';

export type FinalVideoCaptionStatus = 'matched' | 'missing' | 'stale';

export const getFinalVideoCaptionFilename = (
  sceneId: number,
  finalVideoUrl: string,
): string | null => {
  const speech = getSpeechIdentity(finalVideoUrl);
  if (!speech) return null;

  return `scene_${sceneId}_${speech.kind}_${speech.value}_captions.json`;
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
  const actualFilename = getMediaFilename(input.captionsUrl);

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
