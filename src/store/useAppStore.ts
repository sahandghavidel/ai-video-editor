import { create } from 'zustand';
import { BaserowRow } from '@/lib/baserow-actions';

// TTS Settings interface
export interface TTSSettings {
  temperature: number;
  exaggeration: number;
  cfg_weight: number;
  seed: number;
  reference_audio_filename: string;
}

// Speed up filtering modes
export type SpeedUpMode = 'all' | 'emptyOnly' | 'withTextOnly';

// Video processing settings interface
export interface VideoSettings {
  selectedSpeed: number;
  muteAudio: boolean;
  autoGenerateVideo: boolean;
  autoGenerateTTS: boolean;
  speedUpMode: SpeedUpMode;
  playerSpeed: number;
}

// Transcription settings interface
export interface TranscriptionSettings {
  selectedModel: string;
  selectedVideoType: 'original' | 'final';
}

// Deletion settings interface
export interface DeletionSettings {
  enablePrefixCleanup: boolean; // Enable extra prefix-based cleanup when deleting videos
}

// Batch operations state interface
export interface BatchOperationsState {
  improvingAll: boolean;
  generatingAllTTS: boolean;
  generatingAllVideos: boolean;
  speedingUpAllVideos: boolean;
  concatenatingVideos: boolean;
  improvingAllVideos: boolean;
  generatingAllTTSForAllVideos: boolean;
  optimizingAllSilence: boolean;
  normalizingAllAudio: boolean;
  convertingAllToCFR: boolean;
  convertingAllFinalToCFR: boolean;
  transcribingAllFinalScenes: boolean;
}

// Media player state interface
export interface MediaPlayerState {
  playingAudioId: number | null;
  playingVideoId: number | null;
  playingProducedVideoId: number | null;
}

// Model selection state interface
export interface ModelSelectionState {
  selectedModel: string | null;
  models: Model[];
  modelsLoading: boolean;
  modelsError: string | null;
  modelSearch: string;
  enforceLongerSentences: boolean;
}

export interface Model {
  id: string;
  name: string;
  recommended?: boolean;
}

// Scene loading state interface
export interface SceneLoadingState {
  producingTTS: number | null;
  improvingSentence: number | null;
  speedingUpVideo: number | null;
  generatingVideo: number | null;
  currentlyProcessingVideo: number | null;
  optimizingSilenceVideo: number | null;
  normalizingAudioVideo: number | null;
  normalizingAudio: number | null;
  convertingToCFRVideo: number | null;
  convertingFinalToCFRVideo: number | null;
  transcribingScene: number | null;
  creatingTypingEffect: number | null;
}

// Merged video state interface
export interface MergedVideoState {
  url: string | null;
  createdAt: Date | null;
  fileName: string | null;
}

// Selected original video state interface
export interface SelectedOriginalVideoState {
  id: number | null;
  videoUrl: string | null;
  status: string | null;
  sceneIds: number[];
}

// Clip generation state interface
export interface ClipGenerationState {
  generatingClips: number | null; // For bulk generation (video ID)
  clipsProgress: {
    current: number;
    total: number;
    percentage: number;
  } | null;
  generatingSingleClip: number | null; // For single scene generation (scene ID)
}

// Pipeline configuration state interface
export interface PipelineConfig {
  normalizeAudio: boolean;
  convertToCFR: boolean;
  optimizeSilence: boolean;
  transcribe: boolean;
  generateScenes: boolean;
  deleteEmpty: boolean;
  generateClips: boolean;
  speedUp: boolean;
  improve: boolean;
  generateTTS: boolean;
  sync: boolean;
  transcribeScenesAfterSync: boolean;
}

// Audio enhancement mode type
export type AudioEnhancementMode =
  | 'normalize'
  | 'enhance'
  | 'enhance-denoise-only';

// Audio enhancement solver type
export type AudioEnhancementSolver = 'midpoint' | 'rk4' | 'euler';

// Advanced audio enhancement settings
export interface AdvancedAudioSettings {
  solver: AudioEnhancementSolver;
  nfe: number; // Number of function evaluations (32-128)
  tau: number; // CFM prior temperature (0.0-1.0)
  lambd: number; // Denoise strength (0.0-1.0)
}

interface AppState {
  // Core data state
  data: BaserowRow[];
  loading: boolean;
  error: string | null;

  // TTS Settings
  ttsSettings: TTSSettings;

  // Video Settings
  videoSettings: VideoSettings;

  // Transcription Settings
  transcriptionSettings: TranscriptionSettings;

  // Deletion Settings
  deletionSettings: DeletionSettings;

  // Batch Operations State
  batchOperations: BatchOperationsState;

  // Media Player State
  mediaPlayer: MediaPlayerState;

  // Model Selection State
  modelSelection: ModelSelectionState;

  // Scene Loading State
  sceneLoading: SceneLoadingState;

  // Merged Video State
  mergedVideo: MergedVideoState;

  // Selected Original Video State
  selectedOriginalVideo: SelectedOriginalVideoState;

  // Clip Generation State
  clipGeneration: ClipGenerationState;

  // Pipeline Configuration
  pipelineConfig: PipelineConfig;

  // Silence Speed Rate
  silenceSpeedRate: number;
  silenceMuted: boolean;

  // Audio Enhancement Mode
  audioEnhancementMode: AudioEnhancementMode;

  // Advanced Audio Enhancement Settings
  advancedAudioSettings: AdvancedAudioSettings;

  // Computed properties
  getFilteredData: () => BaserowRow[];

  // Actions
  setData: (data: BaserowRow[]) => void;
  setLoading: (loading: boolean) => void;
  setError: (error: string | null) => void;

  // TTS Settings Actions
  updateTTSSettings: (updates: Partial<TTSSettings>) => void;
  resetTTSSettings: () => void;

  // Video Settings Actions
  updateVideoSettings: (updates: Partial<VideoSettings>) => void;
  resetVideoSettings: () => void;

  // Transcription Settings Actions
  updateTranscriptionSettings: (
    updates: Partial<TranscriptionSettings>
  ) => void;
  resetTranscriptionSettings: () => void;

  // Deletion Settings Actions
  updateDeletionSettings: (updates: Partial<DeletionSettings>) => void;
  resetDeletionSettings: () => void;

  // Batch Operations Actions
  startBatchOperation: (operation: keyof BatchOperationsState) => void;
  completeBatchOperation: (operation: keyof BatchOperationsState) => void;
  resetBatchOperations: () => void;

  // Media Player Actions
  setPlayingAudio: (sceneId: number | null) => void;
  setPlayingVideo: (sceneId: number | null) => void;
  setPlayingProducedVideo: (sceneId: number | null) => void;
  stopAllMedia: () => void;

  // Model Selection Actions
  setSelectedModel: (model: string | null) => void;
  setModels: (models: { id: string; name: string }[]) => void;
  setModelsLoading: (loading: boolean) => void;
  setModelsError: (error: string | null) => void;
  setModelSearch: (search: string) => void;
  setEnforceLongerSentences: (enforce: boolean) => void;
  fetchModels: () => Promise<void>;

  // Scene Loading Actions
  setProducingTTS: (sceneId: number | null) => void;
  setImprovingSentence: (sceneId: number | null) => void;
  setSpeedingUpVideo: (sceneId: number | null) => void;
  setTranscribingScene: (sceneId: number | null) => void;
  setCreatingTypingEffect: (sceneId: number | null) => void;
  setGeneratingVideo: (sceneId: number | null) => void;
  setCurrentlyProcessingVideo: (videoId: number | null) => void;
  setOptimizingSilenceVideo: (videoId: number | null) => void;
  setNormalizingAudioVideo: (videoId: number | null) => void;
  setNormalizingAudio: (sceneId: number | null) => void;
  setConvertingToCFRVideo: (videoId: number | null) => void;
  setConvertingFinalToCFRVideo: (videoId: number | null) => void;

  // Merged Video Actions
  setMergedVideo: (url: string, fileName?: string) => void;
  clearMergedVideo: () => void;
  saveMergedVideoToOriginalTable: () => Promise<void>;

  // Selected Original Video Actions
  setSelectedOriginalVideo: (
    id: number | null,
    videoUrl?: string | null,
    status?: string | null,
    sceneIds?: number[]
  ) => void;
  clearSelectedOriginalVideo: () => void;

  // Clip Generation Actions
  setGeneratingClips: (videoId: number | null) => void;
  setClipsProgress: (
    progress: {
      current: number;
      total: number;
      percentage: number;
    } | null
  ) => void;
  clearClipGeneration: () => void;
  setGeneratingSingleClip: (sceneId: number | null) => void;

  // Pipeline Configuration Actions
  updatePipelineConfig: (updates: Partial<PipelineConfig>) => void;
  togglePipelineStep: (step: keyof PipelineConfig) => void;
  resetPipelineConfig: () => void;

  // Silence Speed Rate Actions
  setSilenceSpeedRate: (rate: number) => void;
  setSilenceMuted: (muted: boolean) => void;

  // Audio Enhancement Actions
  setAudioEnhancementMode: (mode: AudioEnhancementMode) => void;
  updateAdvancedAudioSettings: (
    updates: Partial<AdvancedAudioSettings>
  ) => void;

  // Settings Persistence Actions
  saveSettingsToLocalStorage: () => void;
  loadSettingsFromLocalStorage: () => void;
  clearLocalStorageSettings: () => void;

  // Data operations
  updateRow: (id: number, updates: Partial<BaserowRow>) => void;
  addRow: (row: BaserowRow) => void;
}

// Default TTS settings
const defaultTTSSettings: TTSSettings = {
  temperature: 0.8,
  exaggeration: 0.6,
  cfg_weight: 0.5,
  seed: 1212,
  reference_audio_filename: 'calmS5wave.wav',
};

// Default video settings
const defaultVideoSettings: VideoSettings = {
  selectedSpeed: 1,
  muteAudio: true,
  autoGenerateVideo: true,
  autoGenerateTTS: true,
  speedUpMode: 'all',
  playerSpeed: 2,
};

// Default transcription settings
const defaultTranscriptionSettings: TranscriptionSettings = {
  selectedModel: 'parakeet', // Default to Parakeet model
  selectedVideoType: 'original', // Default to original video
};

// Default deletion settings
const defaultDeletionSettings: DeletionSettings = {
  enablePrefixCleanup: false, // Disabled by default - enable for extra safety
};

// Default batch operations settings
const defaultBatchOperations: BatchOperationsState = {
  improvingAll: false,
  generatingAllTTS: false,
  generatingAllVideos: false,
  speedingUpAllVideos: false,
  concatenatingVideos: false,
  improvingAllVideos: false,
  generatingAllTTSForAllVideos: false,
  optimizingAllSilence: false,
  normalizingAllAudio: false,
  convertingAllToCFR: false,
  convertingAllFinalToCFR: false,
  transcribingAllFinalScenes: false,
};

// Default media player state
const defaultMediaPlayer: MediaPlayerState = {
  playingAudioId: null,
  playingVideoId: null,
  playingProducedVideoId: null,
};

// Default model selection state
const defaultModelSelection: ModelSelectionState = {
  selectedModel: 'deepseek/deepseek-v3.2-exp',
  models: [],
  modelsLoading: false,
  modelsError: null,
  modelSearch: 'free',
  enforceLongerSentences: false,
};

// Default scene loading state
const defaultSceneLoading: SceneLoadingState = {
  producingTTS: null,
  improvingSentence: null,
  speedingUpVideo: null,
  generatingVideo: null,
  currentlyProcessingVideo: null,
  optimizingSilenceVideo: null,
  normalizingAudioVideo: null,
  normalizingAudio: null,
  convertingToCFRVideo: null,
  convertingFinalToCFRVideo: null,
  transcribingScene: null,
  creatingTypingEffect: null,
};

// Default merged video state
const defaultMergedVideo: MergedVideoState = {
  url: null,
  createdAt: null,
  fileName: null,
};

// Default selected original video state
const defaultSelectedOriginalVideo: SelectedOriginalVideoState = {
  id: null,
  videoUrl: null,
  status: null,
  sceneIds: [],
};

const defaultClipGeneration: ClipGenerationState = {
  generatingClips: null,
  clipsProgress: null,
  generatingSingleClip: null,
};

// Default pipeline configuration (all steps enabled by default)
const defaultPipelineConfig: PipelineConfig = {
  normalizeAudio: true,
  convertToCFR: true,
  optimizeSilence: true,
  transcribe: true,
  generateScenes: true,
  deleteEmpty: true,
  generateClips: true,
  speedUp: true,
  improve: true,
  generateTTS: true,
  sync: true,
  transcribeScenesAfterSync: true,
};

export const useAppStore = create<AppState>((set, get) => ({
  // Initial state
  data: [],
  loading: false,
  error: null,

  // TTS Settings
  ttsSettings: defaultTTSSettings,

  // Video Settings
  videoSettings: defaultVideoSettings,

  // Transcription Settings
  transcriptionSettings: defaultTranscriptionSettings,

  // Deletion Settings
  deletionSettings: defaultDeletionSettings,

  // Batch Operations State
  batchOperations: defaultBatchOperations,

  // Media Player State
  mediaPlayer: defaultMediaPlayer,

  // Model Selection State
  modelSelection: defaultModelSelection,

  // Scene Loading State
  sceneLoading: defaultSceneLoading,

  // Merged Video State
  mergedVideo: defaultMergedVideo,

  // Selected Original Video State
  selectedOriginalVideo: defaultSelectedOriginalVideo,

  // Clip Generation State
  clipGeneration: defaultClipGeneration,

  // Pipeline Configuration
  pipelineConfig: defaultPipelineConfig,

  // Silence Speed Rate
  silenceSpeedRate: 4, // Default to 4x speed
  silenceMuted: true, // Default to muted

  // Audio Enhancement Mode
  audioEnhancementMode: 'normalize' as AudioEnhancementMode, // Default to Resemble Enhance

  // Advanced Audio Enhancement Settings
  advancedAudioSettings: {
    solver: 'midpoint' as AudioEnhancementSolver,
    nfe: 64,
    tau: 0.5,
    lambd: 1.0,
  },

  // Computed properties
  getFilteredData: () => {
    const state = get();
    const { data, selectedOriginalVideo } = state;

    // If no video is selected, return all data
    if (!selectedOriginalVideo.id) {
      return data;
    }

    // Filter scenes that belong to the selected original video
    // field_6889 is the "Videos ID" column that references Table 713 (Original Videos)
    return data.filter((scene) => {
      const videoId = scene.field_6889;
      // Handle different data types that might come from Baserow
      if (typeof videoId === 'number') {
        return videoId === selectedOriginalVideo.id;
      }
      if (typeof videoId === 'string') {
        return parseInt(videoId, 10) === selectedOriginalVideo.id;
      }
      if (Array.isArray(videoId) && videoId.length > 0) {
        // If it's an array, check if the first item matches
        const firstId =
          typeof videoId[0] === 'object'
            ? videoId[0].id || videoId[0].value
            : videoId[0];
        return parseInt(String(firstId), 10) === selectedOriginalVideo.id;
      }
      return false;
    });
  },

  // Actions
  setData: (data) => set({ data }),
  setLoading: (loading) => set({ loading }),
  setError: (error) => set({ error }),

  // TTS Settings Actions
  updateTTSSettings: (updates) =>
    set((state) => {
      const newSettings = { ...state.ttsSettings, ...updates };
      // Save to localStorage whenever updated
      localStorage.setItem('ttsSettings', JSON.stringify(newSettings));
      return { ttsSettings: newSettings };
    }),

  resetTTSSettings: () =>
    set(() => {
      // Save to localStorage when reset
      localStorage.setItem('ttsSettings', JSON.stringify(defaultTTSSettings));
      return { ttsSettings: defaultTTSSettings };
    }),

  // Video Settings Actions
  updateVideoSettings: (updates) =>
    set((state) => {
      const newSettings = { ...state.videoSettings, ...updates };
      // Save to localStorage whenever updated
      localStorage.setItem('videoSettings', JSON.stringify(newSettings));
      return { videoSettings: newSettings };
    }),

  resetVideoSettings: () =>
    set(() => {
      // Save to localStorage when reset
      localStorage.setItem(
        'videoSettings',
        JSON.stringify(defaultVideoSettings)
      );
      return { videoSettings: defaultVideoSettings };
    }),

  // Transcription Settings Actions
  updateTranscriptionSettings: (updates) =>
    set((state) => {
      const newSettings = { ...state.transcriptionSettings, ...updates };
      // Save to localStorage whenever updated
      localStorage.setItem(
        'transcriptionSettings',
        JSON.stringify(newSettings)
      );
      return { transcriptionSettings: newSettings };
    }),

  resetTranscriptionSettings: () =>
    set(() => {
      // Save to localStorage when reset
      localStorage.setItem(
        'transcriptionSettings',
        JSON.stringify(defaultTranscriptionSettings)
      );
      return { transcriptionSettings: defaultTranscriptionSettings };
    }),

  // Deletion Settings Actions
  updateDeletionSettings: (updates) =>
    set((state) => {
      const newSettings = { ...state.deletionSettings, ...updates };
      // Save to localStorage whenever updated
      localStorage.setItem('deletionSettings', JSON.stringify(newSettings));
      return { deletionSettings: newSettings };
    }),

  resetDeletionSettings: () =>
    set(() => {
      // Save to localStorage when reset
      localStorage.setItem(
        'deletionSettings',
        JSON.stringify(defaultDeletionSettings)
      );
      return { deletionSettings: defaultDeletionSettings };
    }),

  // Batch Operations Actions
  startBatchOperation: (operation) =>
    set((state) => ({
      batchOperations: { ...state.batchOperations, [operation]: true },
    })),

  completeBatchOperation: (operation) =>
    set((state) => ({
      batchOperations: { ...state.batchOperations, [operation]: false },
    })),

  resetBatchOperations: () => set({ batchOperations: defaultBatchOperations }),

  // Media Player Actions
  setPlayingAudio: (sceneId) =>
    set((state) => ({
      mediaPlayer: { ...state.mediaPlayer, playingAudioId: sceneId },
    })),

  setPlayingVideo: (sceneId) =>
    set((state) => ({
      mediaPlayer: { ...state.mediaPlayer, playingVideoId: sceneId },
    })),

  setPlayingProducedVideo: (sceneId) =>
    set((state) => ({
      mediaPlayer: { ...state.mediaPlayer, playingProducedVideoId: sceneId },
    })),

  stopAllMedia: () =>
    set((state) => ({
      mediaPlayer: {
        playingAudioId: null,
        playingVideoId: null,
        playingProducedVideoId: null,
      },
    })),

  // Model Selection Actions
  setSelectedModel: (modelId) =>
    set((state) => {
      const newModelSelection = {
        ...state.modelSelection,
        selectedModel: modelId,
      };
      // Save to localStorage whenever updated
      localStorage.setItem('modelSelection', JSON.stringify(newModelSelection));
      return { modelSelection: newModelSelection };
    }),

  setModels: (models) =>
    set((state) => ({
      modelSelection: { ...state.modelSelection, models },
    })),

  setModelsLoading: (loading) =>
    set((state) => ({
      modelSelection: { ...state.modelSelection, modelsLoading: loading },
    })),

  setModelsError: (error) =>
    set((state) => ({
      modelSelection: { ...state.modelSelection, modelsError: error },
    })),

  setModelSearch: (search) =>
    set((state) => {
      const newModelSelection = {
        ...state.modelSelection,
        modelSearch: search,
      };
      // Save to localStorage whenever updated
      localStorage.setItem('modelSelection', JSON.stringify(newModelSelection));
      return { modelSelection: newModelSelection };
    }),

  setEnforceLongerSentences: (enforce: boolean) =>
    set((state) => {
      const newModelSelection = {
        ...state.modelSelection,
        enforceLongerSentences: enforce,
      };
      // Save to localStorage whenever updated
      localStorage.setItem('modelSelection', JSON.stringify(newModelSelection));
      return { modelSelection: newModelSelection };
    }),

  fetchModels: async () => {
    const { setModelsLoading, setModelsError, setModels, setSelectedModel } =
      get();
    setModelsLoading(true);
    setModelsError(null);
    try {
      const res = await fetch('/api/openrouter-models');
      if (!res.ok) {
        const text = await res.text();
        throw new Error(text || `Model fetch failed: ${res.status}`);
      }
      const json = await res.json();
      const models = json.data || [];
      setModels(models);

      // Set default model if not set and models exist
      const currentSelection = get().modelSelection.selectedModel;
      if (!currentSelection && models.length > 0) {
        setSelectedModel(models[0].id);
      }
    } catch (err) {
      setModelsError(err instanceof Error ? err.message : String(err));
      setModels([]);
    } finally {
      setModelsLoading(false);
    }
  },

  // Scene Loading Actions
  setProducingTTS: (sceneId) =>
    set((state) => ({
      sceneLoading: { ...state.sceneLoading, producingTTS: sceneId },
    })),

  setImprovingSentence: (sceneId) =>
    set((state) => ({
      sceneLoading: { ...state.sceneLoading, improvingSentence: sceneId },
    })),

  setSpeedingUpVideo: (sceneId) =>
    set((state) => ({
      sceneLoading: { ...state.sceneLoading, speedingUpVideo: sceneId },
    })),

  setTranscribingScene: (sceneId) =>
    set((state) => ({
      sceneLoading: { ...state.sceneLoading, transcribingScene: sceneId },
    })),

  setCreatingTypingEffect: (sceneId) =>
    set((state) => ({
      sceneLoading: { ...state.sceneLoading, creatingTypingEffect: sceneId },
    })),

  setGeneratingVideo: (sceneId) =>
    set((state) => ({
      sceneLoading: { ...state.sceneLoading, generatingVideo: sceneId },
    })),

  setCurrentlyProcessingVideo: (videoId) =>
    set((state) => ({
      sceneLoading: {
        ...state.sceneLoading,
        currentlyProcessingVideo: videoId,
      },
    })),

  setOptimizingSilenceVideo: (videoId) =>
    set((state) => ({
      sceneLoading: {
        ...state.sceneLoading,
        optimizingSilenceVideo: videoId,
      },
    })),

  setNormalizingAudioVideo: (videoId) =>
    set((state) => ({
      sceneLoading: {
        ...state.sceneLoading,
        normalizingAudioVideo: videoId,
      },
    })),

  setNormalizingAudio: (sceneId) =>
    set((state) => ({
      sceneLoading: {
        ...state.sceneLoading,
        normalizingAudio: sceneId,
      },
    })),

  setConvertingToCFRVideo: (videoId) =>
    set((state) => ({
      sceneLoading: {
        ...state.sceneLoading,
        convertingToCFRVideo: videoId,
      },
    })),

  setConvertingFinalToCFRVideo: (videoId) =>
    set((state) => ({
      sceneLoading: {
        ...state.sceneLoading,
        convertingFinalToCFRVideo: videoId,
      },
    })),

  // Merged Video Actions
  setMergedVideo: (url, fileName) => {
    set({
      mergedVideo: {
        url,
        createdAt: new Date(),
        fileName: fileName || 'merged-video.mp4',
      },
    });

    // Automatically save to original table if a video is selected
    const state = get();
    if (state.selectedOriginalVideo.id) {
      // Save asynchronously without blocking the UI
      state.saveMergedVideoToOriginalTable().catch((error) => {
        console.error('Auto-save to original table failed:', error);
      });
    }
  },

  clearMergedVideo: () =>
    set({
      mergedVideo: defaultMergedVideo,
    }),

  saveMergedVideoToOriginalTable: async () => {
    const state = get();
    const { mergedVideo, selectedOriginalVideo } = state;

    // Only save if we have both a merged video and a selected original video
    if (!mergedVideo.url || !selectedOriginalVideo.id) {
      console.warn(
        'Cannot save merged video: missing video URL or selected original video'
      );
      return;
    }

    try {
      // Import the required functions (this will be available at runtime)
      const { updateOriginalVideoRow, getOriginalVideoRow } = await import(
        '@/lib/baserow-actions'
      );

      // Step 1: Fetch the current original video row to get the old merged video URL
      const currentVideoRow = await getOriginalVideoRow(
        selectedOriginalVideo.id
      );
      const oldMergedVideoUrl = currentVideoRow.field_6858 as string | null; // Final Merged Video URL field

      // Step 2: Delete the old merged video from MinIO if it exists
      if (oldMergedVideoUrl && typeof oldMergedVideoUrl === 'string') {
        console.log(
          `Deleting old merged video from MinIO: ${oldMergedVideoUrl}`
        );
        try {
          // Dynamic import of the minio-client module
          const { deleteFromMinio } = await import('@/utils/minio-client');
          const deleted = await deleteFromMinio(oldMergedVideoUrl);
          if (deleted) {
            console.log('Successfully deleted old merged video from MinIO');
          } else {
            console.warn(
              'Failed to delete old merged video from MinIO (continuing anyway)'
            );
          }
        } catch (deleteError) {
          console.warn(
            'Error deleting old merged video from MinIO (continuing anyway):',
            deleteError
          );
        }
      }

      // Step 3: Update the original video with the new merged video URL
      await updateOriginalVideoRow(selectedOriginalVideo.id, {
        field_6858: mergedVideo.url, // Final Merged Video URL field
      });

      console.log(
        `Merged video URL saved to original video #${selectedOriginalVideo.id}`
      );
    } catch (error) {
      console.error(
        'Failed to save merged video URL to original table:',
        error
      );
      throw error;
    }
  },

  // Selected Original Video Actions
  setSelectedOriginalVideo: (id, videoUrl, status, sceneIds) =>
    set({
      selectedOriginalVideo: {
        id,
        videoUrl: videoUrl || null,
        status: status || null,
        sceneIds: sceneIds || [],
      },
    }),

  clearSelectedOriginalVideo: () =>
    set({
      selectedOriginalVideo: defaultSelectedOriginalVideo,
    }),

  // Clip Generation Actions
  setGeneratingClips: (videoId) =>
    set((state) => ({
      clipGeneration: {
        ...state.clipGeneration,
        generatingClips: videoId,
      },
    })),

  setClipsProgress: (progress) =>
    set((state) => ({
      clipGeneration: {
        ...state.clipGeneration,
        clipsProgress: progress,
      },
    })),

  clearClipGeneration: () =>
    set({
      clipGeneration: defaultClipGeneration,
    }),

  setGeneratingSingleClip: (sceneId) =>
    set((state) => ({
      clipGeneration: {
        ...state.clipGeneration,
        generatingSingleClip: sceneId,
      },
    })),

  // Pipeline Configuration Actions
  updatePipelineConfig: (updates) =>
    set((state) => {
      const newConfig = {
        ...state.pipelineConfig,
        ...updates,
      };
      // Save to localStorage whenever updated
      localStorage.setItem('pipelineConfig', JSON.stringify(newConfig));
      return { pipelineConfig: newConfig };
    }),

  togglePipelineStep: (step) =>
    set((state) => {
      const newConfig = {
        ...state.pipelineConfig,
        [step]: !state.pipelineConfig[step],
      };
      // Save to localStorage whenever updated
      localStorage.setItem('pipelineConfig', JSON.stringify(newConfig));
      return { pipelineConfig: newConfig };
    }),

  resetPipelineConfig: () =>
    set(() => {
      // Save to localStorage when reset
      localStorage.setItem(
        'pipelineConfig',
        JSON.stringify(defaultPipelineConfig)
      );
      return { pipelineConfig: defaultPipelineConfig };
    }),

  // Silence Speed Rate Actions
  setSilenceSpeedRate: (rate) =>
    set(() => {
      // Save to localStorage whenever updated
      localStorage.setItem('silenceSpeedRate', rate.toString());
      return { silenceSpeedRate: rate };
    }),

  setSilenceMuted: (muted) =>
    set(() => {
      // Save to localStorage whenever updated
      localStorage.setItem('silenceMuted', muted.toString());
      return { silenceMuted: muted };
    }),

  setAudioEnhancementMode: (mode) =>
    set(() => {
      // Save to localStorage whenever updated
      localStorage.setItem('audioEnhancementMode', mode);
      return { audioEnhancementMode: mode };
    }),

  updateAdvancedAudioSettings: (updates) =>
    set((state) => {
      const newSettings = { ...state.advancedAudioSettings, ...updates };
      // Save to localStorage whenever updated
      localStorage.setItem(
        'advancedAudioSettings',
        JSON.stringify(newSettings)
      );
      return { advancedAudioSettings: newSettings };
    }),

  // Data operations
  updateRow: (id, updates) =>
    set((state) => ({
      data: state.data.map((row) =>
        row.id === id ? { ...row, ...updates } : row
      ),
    })),

  addRow: (row) =>
    set((state) => ({
      data: [...state.data, row],
    })),

  // Settings Persistence Actions
  saveSettingsToLocalStorage: () => {
    const state = get();
    const settingsToSave = {
      ttsSettings: state.ttsSettings,
      videoSettings: state.videoSettings,
      transcriptionSettings: state.transcriptionSettings,
      deletionSettings: state.deletionSettings,
      modelSelection: {
        selectedModel: state.modelSelection.selectedModel,
        modelSearch: state.modelSelection.modelSearch,
      },
      selectedOriginalVideo: state.selectedOriginalVideo,
    };

    try {
      localStorage.setItem(
        'video-editor-settings',
        JSON.stringify(settingsToSave)
      );
      console.log('Settings saved to localStorage');
    } catch (error) {
      console.error('Failed to save settings to localStorage:', error);
    }
  },

  loadSettingsFromLocalStorage: () => {
    try {
      const savedSettings = localStorage.getItem('video-editor-settings');
      if (savedSettings) {
        const settings = JSON.parse(savedSettings);

        set((state) => ({
          ttsSettings: { ...defaultTTSSettings, ...settings.ttsSettings },
          videoSettings: { ...defaultVideoSettings, ...settings.videoSettings },
          transcriptionSettings: {
            ...defaultTranscriptionSettings,
            ...settings.transcriptionSettings,
          },
          deletionSettings: {
            ...defaultDeletionSettings,
            ...settings.deletionSettings,
          },
          modelSelection: {
            ...state.modelSelection,
            selectedModel:
              settings.modelSelection?.selectedModel ||
              state.modelSelection.selectedModel,
            modelSearch:
              settings.modelSelection?.modelSearch ||
              state.modelSelection.modelSearch,
          },
          selectedOriginalVideo: settings.selectedOriginalVideo
            ? {
                ...defaultSelectedOriginalVideo,
                ...settings.selectedOriginalVideo,
              }
            : defaultSelectedOriginalVideo,
          pipelineConfig: {
            ...defaultPipelineConfig,
            ...settings.pipelineConfig,
          },
        }));

        console.log('Settings loaded from localStorage');
      }

      // Also try to load pipelineConfig from its own key for backward compatibility
      const savedPipelineConfig = localStorage.getItem('pipelineConfig');
      if (savedPipelineConfig) {
        const config = JSON.parse(savedPipelineConfig);
        set({ pipelineConfig: { ...defaultPipelineConfig, ...config } });
      }

      // Load silenceSpeedRate from localStorage
      const savedSilenceSpeedRate = localStorage.getItem('silenceSpeedRate');
      if (savedSilenceSpeedRate) {
        const rate = parseInt(savedSilenceSpeedRate, 10);
        if (!isNaN(rate) && [1, 2, 4, 8].includes(rate)) {
          set({ silenceSpeedRate: rate });
        }
      }

      // Load silenceMuted from localStorage
      const savedSilenceMuted = localStorage.getItem('silenceMuted');
      if (savedSilenceMuted !== null) {
        set({ silenceMuted: savedSilenceMuted === 'true' });
      }

      // Load audioEnhancementMode from localStorage
      const savedAudioMode = localStorage.getItem('audioEnhancementMode');
      if (
        savedAudioMode &&
        ['normalize', 'enhance', 'enhance-denoise-only'].includes(
          savedAudioMode
        )
      ) {
        set({ audioEnhancementMode: savedAudioMode as AudioEnhancementMode });
      }

      // Load videoSettings from its own key (takes precedence over video-editor-settings)
      const savedVideoSettings = localStorage.getItem('videoSettings');
      if (savedVideoSettings) {
        try {
          const settings = JSON.parse(savedVideoSettings);
          set({ videoSettings: { ...defaultVideoSettings, ...settings } });
        } catch (e) {
          console.error('Failed to parse videoSettings:', e);
        }
      }

      // Load transcriptionSettings from localStorage
      const savedTranscriptionSettings = localStorage.getItem(
        'transcriptionSettings'
      );
      if (savedTranscriptionSettings) {
        try {
          const settings = JSON.parse(savedTranscriptionSettings);
          set({
            transcriptionSettings: {
              ...defaultTranscriptionSettings,
              ...settings,
            },
          });
        } catch (e) {
          console.error('Failed to parse transcriptionSettings:', e);
        }
      }

      // Load deletionSettings from localStorage
      const savedDeletionSettings = localStorage.getItem('deletionSettings');
      if (savedDeletionSettings) {
        try {
          const settings = JSON.parse(savedDeletionSettings);
          set({
            deletionSettings: {
              ...defaultDeletionSettings,
              ...settings,
            },
          });
        } catch (e) {
          console.error('Failed to parse deletionSettings:', e);
        }
      }

      // Load ttsSettings from localStorage
      const savedTTSSettings = localStorage.getItem('ttsSettings');
      if (savedTTSSettings) {
        try {
          const settings = JSON.parse(savedTTSSettings);
          set({ ttsSettings: { ...defaultTTSSettings, ...settings } });
        } catch (e) {
          console.error('Failed to parse ttsSettings:', e);
        }
      }

      // Load modelSelection from localStorage
      const savedModelSelection = localStorage.getItem('modelSelection');
      if (savedModelSelection) {
        try {
          const settings = JSON.parse(savedModelSelection);
          set((state) => ({
            modelSelection: { ...state.modelSelection, ...settings },
          }));
        } catch (e) {
          console.error('Failed to parse modelSelection:', e);
        }
      }

      // Load advancedAudioSettings from localStorage
      const savedAdvancedAudio = localStorage.getItem('advancedAudioSettings');
      if (savedAdvancedAudio) {
        try {
          const settings = JSON.parse(savedAdvancedAudio);
          // Validate settings
          if (
            settings.solver &&
            ['midpoint', 'rk4', 'euler'].includes(settings.solver) &&
            typeof settings.nfe === 'number' &&
            settings.nfe >= 32 &&
            settings.nfe <= 128 &&
            typeof settings.tau === 'number' &&
            settings.tau >= 0 &&
            settings.tau <= 1 &&
            typeof settings.lambd === 'number' &&
            settings.lambd >= 0 &&
            settings.lambd <= 1
          ) {
            set({ advancedAudioSettings: settings });
          }
        } catch (e) {
          console.error('Failed to parse advancedAudioSettings:', e);
        }
      }
    } catch (error) {
      console.error('Failed to load settings from localStorage:', error);
    }
  },

  clearLocalStorageSettings: () => {
    try {
      localStorage.removeItem('video-editor-settings');
      localStorage.removeItem('pipelineConfig');
      set({
        ttsSettings: defaultTTSSettings,
        videoSettings: defaultVideoSettings,
        transcriptionSettings: defaultTranscriptionSettings,
        modelSelection: {
          ...get().modelSelection,
          selectedModel: defaultModelSelection.selectedModel,
          modelSearch: defaultModelSelection.modelSearch,
        },
        selectedOriginalVideo: defaultSelectedOriginalVideo,
        pipelineConfig: defaultPipelineConfig,
      });
      console.log('Settings cleared from localStorage');
    } catch (error) {
      console.error('Failed to clear settings from localStorage:', error);
    }
  },
}));
