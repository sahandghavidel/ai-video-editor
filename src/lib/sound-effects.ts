export type SoundEffectStatus = 'Draft' | 'Approved';

export type SoundEffect = {
  id: number;
  name: string;
  description: string;
  filePath: string;
  durationSeconds: number;
  measuredRmsDbfs: number | null;
  truePeakDbfs: number | null;
  defaultVolumeDb: number;
  syncPointSeconds: number;
  tags: string;
  usageRules: string;
  sourceCredit: string;
  license: string;
  status: SoundEffectStatus;
};

export const SOUND_EFFECT_MAX_BYTES = 25 * 1024 * 1024;
export const SOUND_EFFECT_EXTENSIONS = new Set([
  '.aac', '.aif', '.aiff', '.flac', '.m4a', '.mp3', '.ogg', '.opus', '.wav',
]);
