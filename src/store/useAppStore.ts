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
  speedingUpAllVideos: boolean;
  concatenatingVideos: boolean;
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
  speedingUpAllVideos: false,
  concatenatingVideos: false,
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
