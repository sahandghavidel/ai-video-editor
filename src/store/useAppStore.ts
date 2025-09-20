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
}

// Batch operations state interface
export interface BatchOperationsState {
  improvingAll: boolean;
  generatingAllTTS: boolean;
  generatingAllVideos: boolean;
  speedingUpAllVideos: boolean;
  concatenatingVideos: boolean;
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
  models: any[];
  modelsLoading: boolean;
  modelsError: string | null;
  modelSearch: string;
}

// Scene loading state interface
export interface SceneLoadingState {
  producingTTS: number | null;
  improvingSentence: number | null;
  speedingUpVideo: number | null;
  generatingVideo: number | null;
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

interface AppState {
  // Core data state
  data: BaserowRow[];
  loading: boolean;
  error: string | null;

  // TTS Settings
  ttsSettings: TTSSettings;

  // Video Settings
  videoSettings: VideoSettings;

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
  fetchModels: () => Promise<void>;

  // Scene Loading Actions
  setProducingTTS: (sceneId: number | null) => void;
  setImprovingSentence: (sceneId: number | null) => void;
  setSpeedingUpVideo: (sceneId: number | null) => void;
  setGeneratingVideo: (sceneId: number | null) => void;

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
  temperature: 0.2,
  exaggeration: 0.8,
  cfg_weight: 0.2,
  seed: 1212,
  reference_audio_filename: 'calmS5wave.wav',
};

// Default video settings
const defaultVideoSettings: VideoSettings = {
  selectedSpeed: 4,
  muteAudio: true,
  autoGenerateVideo: true,
  autoGenerateTTS: false,
  speedUpMode: 'emptyOnly',
};

// Default batch operations settings
const defaultBatchOperations: BatchOperationsState = {
  improvingAll: false,
  generatingAllTTS: false,
  generatingAllVideos: false,
  speedingUpAllVideos: false,
  concatenatingVideos: false,
};

// Default media player state
const defaultMediaPlayer: MediaPlayerState = {
  playingAudioId: null,
  playingVideoId: null,
  playingProducedVideoId: null,
};

// Default model selection state
const defaultModelSelection: ModelSelectionState = {
  selectedModel: 'deepseek/deepseek-r1:free',
  models: [],
  modelsLoading: false,
  modelsError: null,
  modelSearch: 'free',
};

// Default scene loading state
const defaultSceneLoading: SceneLoadingState = {
  producingTTS: null,
  improvingSentence: null,
  speedingUpVideo: null,
  generatingVideo: null,
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

export const useAppStore = create<AppState>((set, get) => ({
  // Initial state
  data: [],
  loading: false,
  error: null,

  // TTS Settings
  ttsSettings: defaultTTSSettings,

  // Video Settings
  videoSettings: defaultVideoSettings,

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
    set((state) => ({
      ttsSettings: { ...state.ttsSettings, ...updates },
    })),

  resetTTSSettings: () => set({ ttsSettings: defaultTTSSettings }),

  // Video Settings Actions
  updateVideoSettings: (updates) =>
    set((state) => ({
      videoSettings: { ...state.videoSettings, ...updates },
    })),

  resetVideoSettings: () => set({ videoSettings: defaultVideoSettings }),

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
    set((state) => ({
      modelSelection: { ...state.modelSelection, selectedModel: modelId },
    })),

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
    set((state) => ({
      modelSelection: { ...state.modelSelection, modelSearch: search },
    })),

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

  setGeneratingVideo: (sceneId) =>
    set((state) => ({
      sceneLoading: { ...state.sceneLoading, generatingVideo: sceneId },
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
      // Import the update function (this will be available at runtime)
      const { updateOriginalVideoRow } = await import('@/lib/baserow-actions');

      // Update the original video with the merged video URL
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
        }));

        console.log('Settings loaded from localStorage');
      }
    } catch (error) {
      console.error('Failed to load settings from localStorage:', error);
    }
  },

  clearLocalStorageSettings: () => {
    try {
      localStorage.removeItem('video-editor-settings');
      set({
        ttsSettings: defaultTTSSettings,
        videoSettings: defaultVideoSettings,
        modelSelection: {
          ...get().modelSelection,
          selectedModel: defaultModelSelection.selectedModel,
          modelSearch: defaultModelSelection.modelSearch,
        },
        selectedOriginalVideo: defaultSelectedOriginalVideo,
      });
      console.log('Settings cleared from localStorage');
    } catch (error) {
      console.error('Failed to clear settings from localStorage:', error);
    }
  },
}));
