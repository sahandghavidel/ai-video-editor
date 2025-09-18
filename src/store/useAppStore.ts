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

// Video processing settings interface
export interface VideoSettings {
  selectedSpeed: number;
  muteAudio: boolean;
  autoGenerateVideo: boolean;
  autoGenerateTTS: boolean;
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

  // Data operations
  updateRow: (id: number, updates: Partial<BaserowRow>) => void;
  addRow: (row: BaserowRow) => void;
}

// Default TTS settings
const defaultTTSSettings: TTSSettings = {
  temperature: 0.8,
  exaggeration: 0.3,
  cfg_weight: 0.5,
  seed: 1212,
  reference_audio_filename: 'calmS5wave.wav',
};

// Default video settings
const defaultVideoSettings: VideoSettings = {
  selectedSpeed: 4,
  muteAudio: true,
  autoGenerateVideo: true,
  autoGenerateTTS: false,
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
}));
