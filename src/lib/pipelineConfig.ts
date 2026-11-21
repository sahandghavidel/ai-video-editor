// Pipeline configuration state interface
export interface PipelineConfig {
  scriptFromTitle: boolean;
  ttsScript: boolean;
  ttsVideo: boolean;
  normalizeAudio: boolean;
  convertToCFR: boolean;
  optimizeSilence: boolean;
  transcribe: boolean;
  generateScenes: boolean;
  combinePairsEnabledA: boolean;
  combinePairsEnabledB: boolean;
  combinePairsEnabledC: boolean;
  combinePairsEnabledD: boolean;
  combinePairsSkipA: number;
  combinePairsSkipB: number;
  combinePairsSkipC: number;
  combinePairsSkipD: number;
  deleteEmpty: boolean;
  generateClips: boolean;
  transcribeApplyGenClips: boolean;
  transcribeApplyGenClipsMinChars: number;
  transcribeApplyGenClipsEnabledB: boolean;
  transcribeApplyGenClipsEnabledC: boolean;
  transcribeApplyGenClipsEnabledD: boolean;
  transcribeApplyGenClipsMinCharsB: number;
  transcribeApplyGenClipsMinCharsC: number;
  transcribeApplyGenClipsMinCharsD: number;
  speedUp: boolean;
  speedUpSpeed: number;
  speedUpMuteAudio: boolean;
  fixLanguageAll: boolean;
  codexFixEnglish: boolean;
  improve: boolean;
  generateTTS: boolean;
  sync: boolean;
  transcribeScenesAfterSync: boolean;
  fixFlaggedAfterFixTTS: boolean;
  fixIntroQaAfterFixFlagged: boolean;
  fixIntroQaAllScenes: boolean;
  promptScenesAfterTranscribe: boolean;

  // Scene-level post-processing (batch ops)
  generateSubtitles: boolean;
  generateSceneImages: boolean;
  upscaleSceneImages: boolean;
  applyUpscaledImages: boolean;
  generateSceneVideos: boolean;
  enhanceSceneVideos: boolean;
  applyEnhancedVideos: boolean;
  mergeScenes: boolean;
  convertFinalToCFR: boolean;
  transcribeFinalAll: boolean;
  createEnSrt: boolean;
  createDubbedLanguage: boolean;
  saveDubbedAudioAsWav: boolean;
  includeHyperFramesSoundEffectsInDubbedAudio: boolean;
  includeMusicAndEffectsInDubbedAudio: boolean;
  selectedDubbedLanguagesForPipeline: string[];
  generateYouTubeDescriptions: boolean;
  generateYouTubeKeywords: boolean;
  generateYouTubeTitles: boolean;
  generateYouTubeTimestamps: boolean;
  generateThumbnails: boolean;
  downloadAssetsZipAll: boolean;
}

export interface PipelineTemplate {
  id: string;
  name: string;
  config: PipelineConfig;
  createdAt: string;
  updatedAt: string;
}

// Helper type: only the boolean-valued keys of PipelineConfig (for togglePipelineStep)
export type BooleanPipelineStepKey = {
  [K in keyof PipelineConfig]: PipelineConfig[K] extends boolean ? K : never;
}[keyof PipelineConfig];

// Keep existing pipeline behavior by enabling the original steps by default.
// New, heavier scene-level steps are opt-in.
export const defaultPipelineConfig: PipelineConfig = {
  scriptFromTitle: true,
  ttsScript: true,
  ttsVideo: true,
  normalizeAudio: true,
  convertToCFR: true,
  optimizeSilence: true,
  transcribe: true,
  generateScenes: true,
  combinePairsEnabledA: true,
  combinePairsEnabledB: true,
  combinePairsEnabledC: true,
  combinePairsEnabledD: true,
  combinePairsSkipA: 30,
  combinePairsSkipB: 60,
  combinePairsSkipC: 90,
  combinePairsSkipD: 120,
  deleteEmpty: true,
  generateClips: true,
  transcribeApplyGenClips: false,
  transcribeApplyGenClipsMinChars: 150,
  transcribeApplyGenClipsEnabledB: false,
  transcribeApplyGenClipsEnabledC: false,
  transcribeApplyGenClipsEnabledD: false,
  transcribeApplyGenClipsMinCharsB: 150,
  transcribeApplyGenClipsMinCharsC: 150,
  transcribeApplyGenClipsMinCharsD: 150,
  speedUp: true,
  speedUpSpeed: 4,
  speedUpMuteAudio: true,
  fixLanguageAll: true,
  codexFixEnglish: false,
  improve: true,
  generateTTS: true,
  sync: true,
  transcribeScenesAfterSync: true,
  fixFlaggedAfterFixTTS: true,
  fixIntroQaAfterFixFlagged: true,
  fixIntroQaAllScenes: false,
  promptScenesAfterTranscribe: true,

  generateSubtitles: false,
  generateSceneImages: false,
  upscaleSceneImages: false,
  applyUpscaledImages: false,
  generateSceneVideos: false,
  enhanceSceneVideos: false,
  applyEnhancedVideos: false,
  mergeScenes: false,
  convertFinalToCFR: false,
  transcribeFinalAll: false,
  createEnSrt: false,
  createDubbedLanguage: false,
  saveDubbedAudioAsWav: false,
  includeHyperFramesSoundEffectsInDubbedAudio: false,
  includeMusicAndEffectsInDubbedAudio: true,
  selectedDubbedLanguagesForPipeline: [],
  generateYouTubeDescriptions: false,
  generateYouTubeKeywords: false,
  generateYouTubeTitles: false,
  generateYouTubeTimestamps: false,
  generateThumbnails: false,
  downloadAssetsZipAll: false,
};

function normalizeLanguageCode(value: unknown): string {
  if (typeof value !== 'string') return '';
  return value.trim().toLowerCase();
}

export function toUniqueNormalizedLanguageList(values: unknown): string[] {
  if (!Array.isArray(values)) return [];

  const unique = new Set<string>();
  const ordered: string[] = [];

  for (const value of values) {
    const normalized = normalizeLanguageCode(value);
    if (!normalized || unique.has(normalized)) continue;
    unique.add(normalized);
    ordered.push(normalized);
  }

  return ordered;
}

export function normalizePipelineConfig(
  config: Partial<PipelineConfig> | undefined,
  selectedDubbedLanguagesOverride?: string[],
): PipelineConfig {
  const pipelineSpeedUpSpeed =
    typeof config?.speedUpSpeed === 'number' &&
    [1, 1.125, 1.5, 2, 4, 8].includes(config.speedUpSpeed)
      ? config.speedUpSpeed
      : defaultPipelineConfig.speedUpSpeed;
  const pipelineSpeedUpMuteAudio =
    typeof config?.speedUpMuteAudio === 'boolean'
      ? config.speedUpMuteAudio
      : defaultPipelineConfig.speedUpMuteAudio;
  const selectedDubbedLanguagesForPipeline =
    selectedDubbedLanguagesOverride !== undefined
      ? toUniqueNormalizedLanguageList(selectedDubbedLanguagesOverride)
      : toUniqueNormalizedLanguageList(
          config?.selectedDubbedLanguagesForPipeline,
        );

  return {
    ...defaultPipelineConfig,
    ...config,
    codexFixEnglish: config?.codexFixEnglish === true,
    includeMusicAndEffectsInDubbedAudio:
      typeof config?.includeMusicAndEffectsInDubbedAudio === 'boolean'
        ? config.includeMusicAndEffectsInDubbedAudio
        : defaultPipelineConfig.includeMusicAndEffectsInDubbedAudio,
    speedUpSpeed: pipelineSpeedUpSpeed,
    speedUpMuteAudio: pipelineSpeedUpMuteAudio,
    selectedDubbedLanguagesForPipeline,
  };
}

