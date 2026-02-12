'use client';

import React, { useState, useEffect, useRef } from 'react';
import {
  BaserowRow,
  getOriginalVideosData,
  updateOriginalVideoRow,
  deleteOriginalVideoWithScenes,
  getBaserowData,
} from '@/lib/baserow-actions';
import { useAppStore } from '@/store/useAppStore';
import {
  Loader2,
  Video,
  RefreshCw,
  ExternalLink,
  CheckCircle,
  Clock,
  AlertCircle,
  X,
  Check,
  Edit3,
  Save,
  GripVertical,
  Plus,
  Trash2,
  Subtitles,
  Grid3x3,
  Volume2,
  Mic,
  Upload,
  FileText,
  Zap,
  Workflow,
  Film,
  FastForward,
} from 'lucide-react';
import TranscriptionModelSelection from './TranscriptionModelSelection';
import MergedVideoDisplay from './MergedVideoDisplay';
import FinalVideoTable from './FinalVideoTable';
import PipelineConfig from './PipelineConfig';
import { playSuccessSound, playErrorSound } from '@/utils/soundManager';
import { sendTelegramNotification } from '@/utils/telegram';
import {
  handleImproveAllSentencesForAllVideos,
  handleGenerateAllTTSForAllVideos as generateAllTTSForAllVideosUtil,
  handleSpeedUpAllVideosForAllScenes,
  handleGenerateAllVideos,
  handleOptimizeSilenceForAllVideos,
} from '@/utils/batchOperations';
import { deleteFromMinio } from '@/utils/minio-client';

type BaserowField =
  | string
  | number
  | boolean
  | {
      url?: string;
      value?: unknown;
      name?: string;
      text?: string;
      title?: string;
      file?: { url?: string };
    }
  | Array<{
      url?: string;
      value?: unknown;
      name?: string;
      text?: string;
      file?: { url?: string };
    }>
  | null
  | undefined;
import { Sparkles, Mic2 } from 'lucide-react';

interface SceneHandlers {
  handleSentenceImprovement: (
    sceneId: number,
    sentence: string,
    model?: string,
    sceneData?: BaserowRow,
    skipRefresh?: boolean,
    enforceLongerSentences?: boolean,
  ) => Promise<void>;
  handleTTSProduce: (
    sceneId: number,
    text: string,
    sceneData?: BaserowRow,
  ) => Promise<void>;
  handleVideoGenerate: (
    sceneId: number,
    videoUrl: string,
    audioUrl: string,
  ) => Promise<void>;
  handleSpeedUpVideo: (
    sceneId: number,
    sceneData?: BaserowRow,
    skipRefresh?: boolean,
  ) => Promise<void>;
}

interface OriginalVideosListProps {
  sceneHandlers?: SceneHandlers | null;
  refreshScenesData?: () => void;
}

export default function OriginalVideosList({
  sceneHandlers,
  refreshScenesData,
}: OriginalVideosListProps) {
  const [originalVideos, setOriginalVideos] = useState<BaserowRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);

  const [isScriptUploadModalOpen, setIsScriptUploadModalOpen] = useState(false);
  const [scriptUploadText, setScriptUploadText] = useState('');
  const [creatingVideoFromScript, setCreatingVideoFromScript] = useState(false);
  const [generatingTtsFromScripts, setGeneratingTtsFromScripts] =
    useState(false);
  const [generatingScriptTtsForVideo, setGeneratingScriptTtsForVideo] =
    useState<number | null>(null);
  const [
    generatingVideoFromTtsAudioForVideo,
    setGeneratingVideoFromTtsAudioForVideo,
  ] = useState<number | null>(null);
  const [generatingVideoFromTtsAudioAll, setGeneratingVideoFromTtsAudioAll] =
    useState(false);
  const [editingTitle, setEditingTitle] = useState<{
    videoId: number;
    value: string;
    saving: boolean;
  } | null>(null);
  const [updatingStatus, setUpdatingStatus] = useState<number | null>(null);
  const [bulkStatusChange, setBulkStatusChange] = useState<string>('');
  const [updatingBulkStatus, setUpdatingBulkStatus] = useState(false);
  const [draggedRow, setDraggedRow] = useState<number | null>(null);
  const [dragOverRow, setDragOverRow] = useState<number | null>(null);
  const [reordering, setReordering] = useState(false);
  const [deleting, setDeleting] = useState<number | null>(null);
  const [transcribing, setTranscribing] = useState<number | null>(null);
  const [transcribingAll, setTranscribingAll] = useState(false);
  const [generatingScenes, setGeneratingScenes] = useState<number | null>(null);
  const [generatingScenesAll, setGeneratingScenesAll] = useState(false);
  const [normalizing, setNormalizing] = useState<number | null>(null);
  const [convertingToCFR, setConvertingToCFR] = useState<number | null>(null);
  const [optimizingSilence, setOptimizingSilence] = useState<number | null>(
    null,
  );
  const [mergingFinalVideos, setMergingFinalVideos] = useState(false);
  const [generatingTimestamps, setGeneratingTimestamps] = useState(false);
  const [timestampData, setTimestampData] = useState<string>('');
  const [improvingAllVideosScenes, setImprovingAllVideosScenes] =
    useState(false);
  const [currentProcessingVideoId, setCurrentProcessingVideoId] = useState<
    number | null
  >(null);
  const [generatingAllTTSForAllVideos, setGeneratingAllTTSForAllVideos] =
    useState(false);
  const [speedingUpAllVideos, setSpeedingUpAllVideos] = useState(false);
  const [deletingEmptyScenesAllVideos, setDeletingEmptyScenesAllVideos] =
    useState(false);
  const [
    transcribingProcessingScenesAllVideos,
    setTranscribingProcessingScenesAllVideos,
  ] = useState(false);
  const [
    promptingProcessingScenesAllVideos,
    setPromptingProcessingScenesAllVideos,
  ] = useState(false);
  const [generatingAllVideos, setGeneratingAllVideos] = useState(false);
  const [generatingClipsAll, setGeneratingClipsAll] = useState(false);
  const [runningFullPipeline, setRunningFullPipeline] = useState(false);
  const [pipelineStep, setPipelineStep] = useState<string>('');
  const [isExpanded, setIsExpanded] = useState(false); // Collapsible state - collapsed by default
  const [isBatchOperationsExpanded, setIsBatchOperationsExpanded] =
    useState(false); // Batch operations collapsed by default
  const [isFinalVideoExpanded, setIsFinalVideoExpanded] = useState(false); // Final video section collapsed by default

  // Get clip generation state from global store
  const {
    clipGeneration,
    setGeneratingClips: setGeneratingClipsGlobal,
    setClipsProgress: setClipsProgressGlobal,
    clearClipGeneration,
    setMergedVideo,
  } = useAppStore();
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Global state
  const {
    selectedOriginalVideo,
    setSelectedOriginalVideo,
    saveSettingsToLocalStorage,
    loadSettingsFromLocalStorage,
    getFilteredData,
    mergedVideo,
    clearMergedVideo,
    transcriptionSettings,
    deletionSettings,
    data: allScenesData,
    modelSelection,
    sceneLoading,
    setImprovingSentence,
    setCurrentlyProcessingVideo,
    batchOperations,
    startBatchOperation,
    completeBatchOperation,
    setProducingTTS,
    setSpeedingUpVideo,
    setGeneratingVideo,
    setOptimizingSilenceVideo,
    setNormalizingAudioVideo,
    setConvertingToCFRVideo,
    setConvertingFinalToCFRVideo,
    videoSettings,
    pipelineConfig,
    silenceSpeedRate,
    silenceMuted,
    audioEnhancementMode,
    advancedAudioSettings,
  } = useAppStore();

  useEffect(() => {
    // Load settings from localStorage on mount
    loadSettingsFromLocalStorage();
  }, [loadSettingsFromLocalStorage]);

  // Refresh the original videos list when a merged video is saved
  useEffect(() => {
    if (mergedVideo.url && selectedOriginalVideo.id) {
      // Small delay to ensure the database update is complete
      const timer = setTimeout(() => {
        fetchOriginalVideos(true);
      }, 1000);

      return () => clearTimeout(timer);
    }
  }, [mergedVideo.url, selectedOriginalVideo.id]);

  // Load timestamp data from localStorage on mount
  useEffect(() => {
    const savedTimestampData = localStorage.getItem('final-video-data');
    if (savedTimestampData) {
      try {
        const parsedData = JSON.parse(savedTimestampData);
        // Handle both old string format and new object format
        if (typeof parsedData === 'string') {
          setTimestampData(parsedData);
        } else if (parsedData && parsedData.timestamp) {
          setTimestampData(parsedData.timestamp);
        }
      } catch (error) {
        // If parsing fails, treat as old string format
        setTimestampData(savedTimestampData);
      }
    }
  }, []);

  // Helper function to extract value from Baserow field
  const extractFieldValue = (field: unknown): string => {
    const f = field as BaserowField;
    if (!f) return '';

    // If it's already a string, return it
    if (typeof f === 'string') return f;

    // If it's an array, join with commas
    if (Array.isArray(f)) {
      return f
        .map((item) => {
          if (typeof item === 'object' && item !== null) {
            // Try to extract meaningful value from object
            const obj = item as {
              value?: unknown;
              name?: string;
              text?: string;
              title?: string;
            };
            return (
              String(obj.value) ||
              obj.name ||
              obj.text ||
              obj.title ||
              JSON.stringify(item)
            );
          }
          return String(item);
        })
        .join(', ');
    }

    // If it's an object, try to extract meaningful value
    if (typeof f === 'object' && f !== null) {
      // Common Baserow field patterns
      const obj = f as {
        url?: string;
        value?: unknown;
        name?: string;
        text?: string;
        title?: string;
        file?: { url?: string };
      };
      if (obj.url) return obj.url;
      if (obj.value) return String(obj.value);
      if (obj.name) return obj.name;
      if (obj.text) return obj.text;
      if (obj.title) return obj.title;

      // If none of the above, convert to string
      return JSON.stringify(f);
    }

    return String(f);
  };

  // Helper function to extract and format scenes
  const extractScenes = (
    field: unknown,
  ): { count: number; scenes: string[] } => {
    const f = field as BaserowField;
    if (!f) return { count: 0, scenes: [] };

    let sceneList: string[] = [];

    // If it's already a string with comma-separated values
    if (typeof f === 'string') {
      sceneList = f
        .split(',')
        .map((s) => s.trim())
        .filter((s) => s.length > 0);
    }
    // If it's an array
    else if (Array.isArray(f)) {
      sceneList = f
        .map((item) => {
          if (typeof item === 'object' && item !== null) {
            const obj = item as {
              value?: unknown;
              name?: string;
              text?: string;
              title?: string;
            };
            return (
              String(obj.value) ||
              obj.name ||
              obj.text ||
              obj.title ||
              String(item)
            );
          }
          return String(item);
        })
        .filter((s) => s.length > 0);
    }
    // If it's an object, try to extract meaningful value
    else if (typeof f === 'object' && f !== null) {
      const obj = f as {
        value?: unknown;
        name?: string;
        text?: string;
        title?: string;
      };
      const value =
        String(obj.value) ||
        obj.name ||
        obj.text ||
        obj.title ||
        JSON.stringify(f);
      sceneList = String(value)
        .split(',')
        .map((s) => s.trim())
        .filter((s) => s.length > 0);
    } else {
      sceneList = String(f)
        .split(',')
        .map((s) => s.trim())
        .filter((s) => s.length > 0);
    }

    return { count: sceneList.length, scenes: sceneList };
  };

  // Helper function to extract URL from field
  const extractUrl = (field: unknown): string | null => {
    const f = field as BaserowField;
    if (!f) return null;

    // If it's a string that looks like a URL
    if (typeof f === 'string' && (f.startsWith('http') || f.startsWith('/'))) {
      return f;
    }

    // If it's an object with url property
    if (typeof f === 'object' && f !== null && !Array.isArray(f)) {
      const obj = f as { url?: string; file?: { url?: string } };
      if (obj.url) return obj.url;
      if (obj.file && obj.file.url) return obj.file.url;
    }

    // If it's an array, get the first URL
    if (Array.isArray(f) && f.length > 0) {
      const firstItem = f[0] as unknown;
      if (typeof firstItem === 'string' && firstItem.startsWith('http')) {
        return firstItem;
      }
      if (typeof firstItem === 'object' && firstItem !== null) {
        const obj = firstItem as { url?: string; file?: { url?: string } };
        if (obj.url) return obj.url;
        if (obj.file && obj.file.url) return obj.file.url;
      }
    }

    return null;
  };

  const parseDimension = (
    input: string,
  ): { width: number; height: number } | null => {
    const trimmed = input.trim();
    if (!trimmed) return null;

    const match = trimmed.match(/(\d{2,5})\s*[x×X]\s*(\d{2,5})/);
    if (!match) return null;

    const width = Number(match[1]);
    const height = Number(match[2]);
    if (!Number.isFinite(width) || !Number.isFinite(height)) return null;
    if (width <= 0 || height <= 0) return null;
    return { width, height };
  };

  const parseHexColor = (input: string): string | null => {
    const trimmed = input.trim();
    if (!trimmed) return null;

    const match = trimmed.match(/#?[0-9a-fA-F]{6}/);
    if (!match) return null;

    const hex = match[0].startsWith('#') ? match[0] : `#${match[0]}`;
    return hex.toUpperCase();
  };

  const handleGenerateVideoFromTtsAudio = async (
    video: BaserowRow,
    options?: {
      playSound?: boolean;
      refreshAtEnd?: boolean;
      setErrorOnFailure?: boolean;
    },
  ) => {
    const audioUrl = extractUrl(video.field_6859);
    if (!audioUrl) {
      setError('No TTS audio URL found for this video');
      return;
    }

    const playSound = options?.playSound ?? true;
    const refreshAtEnd = options?.refreshAtEnd ?? true;
    const setErrorOnFailure = options?.setErrorOnFailure ?? true;

    try {
      setGeneratingVideoFromTtsAudioForVideo(video.id);

      const dimensionRaw = extractFieldValue(video.field_7092);
      const bgRaw = extractFieldValue(video.field_7093);

      const parsedDim = parseDimension(dimensionRaw) ?? {
        width: 1920,
        height: 1080,
      };
      const parsedBg = parseHexColor(bgRaw) ?? '#FFFFFF';

      const response = await fetch('/api/generate-video-from-tts-audio', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          videoId: video.id,
          audioUrl,
          dimension: `${parsedDim.width}x${parsedDim.height}`,
          bgColor: parsedBg,
          framerate: 30,
        }),
      });

      if (!response.ok) {
        let errorMessage = `Video generation failed: ${response.status}`;
        try {
          const errorData = await response.json();
          errorMessage = errorData.error || errorData.details || errorMessage;
          console.error('API Error:', errorData);
        } catch {
          // ignore parse errors
        }
        throw new Error(errorMessage);
      }

      const result = await response.json();
      const generatedUrl = result?.data?.videoUrl as string | undefined;

      if (!generatedUrl) {
        throw new Error('No videoUrl returned from API');
      }

      await updateOriginalVideoRow(video.id, {
        field_6881: generatedUrl, // Video Uploaded URL
        field_6908: generatedUrl, // CFR Video URL (already encoded CFR-like at 30fps)
      });

      if (refreshAtEnd) {
        await handleRefresh();
      }
      if (playSound) {
        playSuccessSound();
      }
    } catch (error) {
      console.error('Error generating video from TTS audio:', error);
      if (playSound) {
        playErrorSound();
      }
      if (setErrorOnFailure) {
        setError(
          `Failed to generate video from TTS audio: ${
            error instanceof Error ? error.message : 'Unknown error'
          }`,
        );
      }
    } finally {
      setGeneratingVideoFromTtsAudioForVideo(null);
    }
  };

  const handleGenerateVideoFromTtsAudioAll = async (
    playSound = true,
    refreshAtEnd = true,
  ) => {
    if (generatingVideoFromTtsAudioAll) return;
    if (generatingVideoFromTtsAudioForVideo !== null) return;

    setGeneratingVideoFromTtsAudioAll(true);
    setGeneratingVideoFromTtsAudioForVideo(null);
    setError(null);

    try {
      // Fetch once at start to avoid mid-batch refresh loops
      const videos = await getOriginalVideosData();
      const processingVideos = videos.filter((v) => {
        const status = extractFieldValue(v.field_6864).trim().toLowerCase();
        return status === 'processing';
      });

      for (const video of processingVideos) {
        const hasTtsAudio = !!extractUrl(video.field_6859);
        if (!hasTtsAudio) continue;

        const existingVideoUrl =
          extractUrl(video.field_6881) || extractUrl(video.field_6908);
        if (existingVideoUrl && existingVideoUrl.trim().length > 0) continue;

        try {
          await handleGenerateVideoFromTtsAudio(video, {
            playSound: false,
            refreshAtEnd: false,
            setErrorOnFailure: false,
          });
        } catch (innerErr) {
          console.error('TTS→Video batch: error for video', video.id, innerErr);
          continue;
        }
      }

      if (refreshAtEnd) {
        await fetchOriginalVideos(true);
      }
      if (playSound) {
        playSuccessSound();
      }
    } catch (err) {
      console.error('Error in TTS→Video batch:', err);
      if (playSound) {
        playErrorSound();
      }
      setError(
        err instanceof Error
          ? err.message
          : 'Failed to generate videos from TTS audio',
      );
    } finally {
      setGeneratingVideoFromTtsAudioAll(false);
      setGeneratingVideoFromTtsAudioForVideo(null);
    }
  };

  // Helper function to check if video has scenes
  const hasScenes = (video: BaserowRow): boolean => {
    const scenesField = video.field_6866; // Scenes field
    if (!scenesField) return false;

    // If it's an array and has items
    if (Array.isArray(scenesField) && scenesField.length > 0) {
      return true;
    }

    // If it's a number (single scene ID)
    if (typeof scenesField === 'number') {
      return true;
    }

    // If it's a string with content
    if (typeof scenesField === 'string' && scenesField.trim() !== '') {
      return true;
    }

    return false;
  };

  const handleFileUpload = async (file: File) => {
    if (!file.type.startsWith('video/')) {
      setError('Please select a video file');
      return;
    }

    const maxSize = 10 * 1024 * 1024 * 1024; // 10GB
    if (file.size > maxSize) {
      setError('File size must be less than 10GB');
      return;
    }

    setUploading(true);
    setUploadProgress(0);
    setError(null);

    try {
      const formData = new FormData();
      formData.append('file', file);

      const response = await fetch('/api/upload-video', {
        method: 'POST',
        body: formData,
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Upload failed');
      }

      const result = await response.json();

      // Refresh the videos list to show the new upload
      await fetchOriginalVideos(true);

      setUploadProgress(100);
      setTimeout(() => {
        setUploading(false);
        setUploadProgress(0);
      }, 1000);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Upload failed');
      setUploading(false);
      setUploadProgress(0);
    }
  };

  const handleFileSelect = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) {
      handleFileUpload(file);
    }
  };

  const openFileDialog = () => {
    fileInputRef.current?.click();
  };

  const openScriptUploadModal = () => {
    setIsScriptUploadModalOpen(true);
  };

  const closeScriptUploadModal = () => {
    if (creatingVideoFromScript) return;
    setIsScriptUploadModalOpen(false);
    setScriptUploadText('');
  };

  const handleCreateVideoFromScript = async () => {
    if (creatingVideoFromScript) return;
    if (!scriptUploadText.trim()) return;

    setCreatingVideoFromScript(true);
    setError(null);

    try {
      const res = await fetch('/api/create-video-from-script', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ script: scriptUploadText }),
      });

      if (!res.ok) {
        const json = (await res.json().catch(() => null)) as {
          error?: unknown;
        } | null;
        const msg =
          typeof json?.error === 'string'
            ? json.error
            : `Create failed (${res.status})`;
        throw new Error(msg);
      }

      await fetchOriginalVideos(true);
      setIsScriptUploadModalOpen(false);
      setScriptUploadText('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Create failed');
    } finally {
      setCreatingVideoFromScript(false);
    }
  };

  const handleGenerateTtsFromScripts = async (
    playSound = true,
    refreshAtEnd = true,
  ) => {
    if (generatingTtsFromScripts) return;

    setGeneratingTtsFromScripts(true);
    setGeneratingScriptTtsForVideo(null);
    setError(null);

    try {
      // Fetch once at start to avoid mid-batch refresh loops
      const videos = await getOriginalVideosData();
      const processingVideos = videos.filter((v) => {
        const status = extractFieldValue(v.field_6864).trim().toLowerCase();
        return status === 'processing';
      });

      for (const video of processingVideos) {
        const script =
          typeof video.field_6854 === 'string' ? video.field_6854.trim() : '';
        if (!script) continue;

        const existingTtsUrl = extractUrl(video.field_6859);
        if (existingTtsUrl && existingTtsUrl.trim().length > 0) continue;

        // Show per-row loading state for the current video
        setGeneratingScriptTtsForVideo(video.id);

        try {
          const ttsRes = await fetch('/api/generate-tts', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ text: script, videoId: video.id }),
          });

          if (!ttsRes.ok) {
            const json = (await ttsRes.json().catch(() => null)) as {
              error?: unknown;
            } | null;
            const msg =
              typeof json?.error === 'string'
                ? json.error
                : `TTS failed (${ttsRes.status})`;
            console.error('TTS failed for video', video.id, msg);
            continue;
          }

          const ttsJson = (await ttsRes.json()) as { audioUrl?: unknown };
          const audioUrl =
            typeof ttsJson.audioUrl === 'string' ? ttsJson.audioUrl : '';
          if (!audioUrl) {
            console.error('TTS returned no audioUrl for video', video.id);
            continue;
          }

          await updateOriginalVideoRow(video.id, { field_6859: audioUrl });
        } catch (innerErr) {
          console.error('TTS error for video', video.id, innerErr);
          continue;
        } finally {
          // Clear between iterations so the spinner only shows for the active row
          setGeneratingScriptTtsForVideo(null);
        }
      }

      if (refreshAtEnd) {
        await fetchOriginalVideos(true);
      }

      if (playSound) {
        playSuccessSound();
      }
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : 'Failed to generate TTS from scripts',
      );
      if (playSound) {
        playErrorSound();
      }
    } finally {
      setGeneratingTtsFromScripts(false);
      setGeneratingScriptTtsForVideo(null);
    }
  };

  const handleGenerateTtsFromVideoScript = async (video: BaserowRow) => {
    if (generatingScriptTtsForVideo !== null) return;

    const script =
      typeof video.field_6854 === 'string' ? video.field_6854.trim() : '';
    const existingTtsUrl = extractUrl(video.field_6859);

    if (!script) {
      setError('No script found for TTS');
      return;
    }

    if (existingTtsUrl && existingTtsUrl.trim().length > 0) {
      return;
    }

    setGeneratingScriptTtsForVideo(video.id);
    setError(null);

    try {
      const ttsRes = await fetch('/api/generate-tts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: script, videoId: video.id }),
      });

      if (!ttsRes.ok) {
        const json = (await ttsRes.json().catch(() => null)) as {
          error?: unknown;
        } | null;
        const msg =
          typeof json?.error === 'string'
            ? json.error
            : `TTS failed (${ttsRes.status})`;
        throw new Error(msg);
      }

      const ttsJson = (await ttsRes.json()) as { audioUrl?: unknown };
      const audioUrl =
        typeof ttsJson.audioUrl === 'string' ? ttsJson.audioUrl : '';
      if (!audioUrl) {
        throw new Error('TTS returned no audioUrl');
      }

      await updateOriginalVideoRow(video.id, { field_6859: audioUrl });
      await fetchOriginalVideos(true);
      playSuccessSound();
    } catch (err) {
      console.error('Error generating TTS from video script:', err);
      playErrorSound();
      setError(
        err instanceof Error
          ? err.message
          : 'Failed to generate TTS from script',
      );
    } finally {
      setGeneratingScriptTtsForVideo(null);
    }
  };

  const handleRowClick = (video: BaserowRow) => {
    const videoUrl = extractUrl(video.field_6881);
    const status = extractFieldValue(video.field_6864);
    const sceneData = extractScenes(video.field_6866);

    // Convert scene IDs to numbers if they exist
    const sceneIds = sceneData.scenes
      .map((id) => {
        const numId = parseInt(id, 10);
        return isNaN(numId) ? 0 : numId;
      })
      .filter((id) => id > 0);

    setSelectedOriginalVideo(video.id, videoUrl, status, sceneIds);

    // Save to localStorage
    saveSettingsToLocalStorage();
  };

  const isRowSelected = (videoId: number) => {
    return selectedOriginalVideo.id === videoId;
  };

  const fetchOriginalVideos = async (isRefresh = false) => {
    try {
      if (isRefresh) {
        setRefreshing(true);
      } else {
        setLoading(true);
      }
      setError(null);

      const data = await getOriginalVideosData();

      // Sort by order field (if exists), otherwise by ID
      const sortedData = data.sort((a, b) => {
        const orderA = Number(a.field_6902) || a.id;
        const orderB = Number(b.field_6902) || b.id;
        return orderA - orderB;
      });

      setOriginalVideos(sortedData);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : 'Failed to fetch original videos',
      );
      console.error('Error fetching original videos:', err);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => {
    fetchOriginalVideos();
  }, []);

  const handleRefresh = async () => {
    await fetchOriginalVideos(true);
  };

  const getStatusIcon = (status: string) => {
    switch (status?.toLowerCase()) {
      case 'completed':
      case 'complete':
      case 'done':
        return <CheckCircle className='w-4 h-4 text-green-500' />;
      case 'processing':
      case 'in progress':
        return <Clock className='w-4 h-4 text-yellow-500' />;
      default:
        return <AlertCircle className='w-4 h-4 text-gray-400' />;
    }
  };

  const getStatusColor = (status: string) => {
    switch (status?.toLowerCase()) {
      case 'completed':
      case 'complete':
      case 'done':
        return 'bg-green-100 text-green-800';
      case 'processing':
      case 'in progress':
        return 'bg-yellow-100 text-yellow-800';
      default:
        return 'bg-gray-100 text-gray-600';
    }
  };

  // Drag and drop handlers for reordering
  const handleRowDragStart = (e: React.DragEvent, videoId: number) => {
    setDraggedRow(videoId);
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/html', videoId.toString());
  };

  const handleRowDragOver = (e: React.DragEvent, videoId: number) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    setDragOverRow(videoId);
  };

  const handleRowDragLeave = () => {
    setDragOverRow(null);
  };

  const handleRowDragEnd = () => {
    setDraggedRow(null);
    setDragOverRow(null);
  };

  const handleRowDrop = async (e: React.DragEvent, targetVideoId: number) => {
    e.preventDefault();

    if (!draggedRow || draggedRow === targetVideoId) {
      setDraggedRow(null);
      setDragOverRow(null);
      return;
    }

    setReordering(true);

    try {
      // Create a new array with updated order
      const currentVideos = [...originalVideos];
      const draggedIndex = currentVideos.findIndex((v) => v.id === draggedRow);
      const targetIndex = currentVideos.findIndex(
        (v) => v.id === targetVideoId,
      );

      if (draggedIndex === -1 || targetIndex === -1) return;

      // Remove the dragged item and insert it at the target position
      const [draggedVideo] = currentVideos.splice(draggedIndex, 1);
      currentVideos.splice(targetIndex, 0, draggedVideo);

      // Update order values (1-based indexing)
      const updates: Promise<void>[] = [];
      currentVideos.forEach((video, index) => {
        const newOrder = index + 1;
        // Update both local state and database
        video.field_6902 = newOrder;
        updates.push(
          updateOriginalVideoRow(video.id, { field_6902: newOrder }),
        );
      });

      // Update local state optimistically
      setOriginalVideos(currentVideos);

      // Save all order changes to database
      await Promise.all(updates);

      console.log(
        `Reordered videos: moved video ${draggedRow} to position ${
          targetIndex + 1
        }`,
      );
    } catch (error) {
      console.error('Failed to reorder videos:', error);
      // Refresh data to revert optimistic update
      fetchOriginalVideos(true);
    } finally {
      setReordering(false);
      setDraggedRow(null);
      setDragOverRow(null);
    }
  };

  // Title editing functions
  const startTitleEdit = (videoId: number, currentTitle: string) => {
    setEditingTitle({
      videoId,
      value: currentTitle,
      saving: false,
    });
  };

  const cancelTitleEdit = () => {
    setEditingTitle(null);
  };

  const saveTitleEdit = async (videoId: number, newTitle: string) => {
    if (!editingTitle || editingTitle.videoId !== videoId) return;

    setEditingTitle((prev) => (prev ? { ...prev, saving: true } : null));

    try {
      await updateOriginalVideoRow(videoId, {
        field_6852: newTitle,
      });

      // Update local state
      setOriginalVideos((prevVideos) =>
        prevVideos.map((video) =>
          video.id === videoId ? { ...video, field_6852: newTitle } : video,
        ),
      );

      setEditingTitle(null);
    } catch (error) {
      console.error('Failed to update title:', error);
      // Could add toast notification here
    }
  };

  const handleTitleKeyDown = (e: React.KeyboardEvent, videoId: number) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      if (editingTitle) {
        saveTitleEdit(videoId, editingTitle.value);
      }
    } else if (e.key === 'Escape') {
      e.preventDefault();
      cancelTitleEdit();
    }
  };

  // Update status function
  const handleStatusChange = async (
    videoId: number,
    newStatus: string,
    e: React.SyntheticEvent,
  ) => {
    e.stopPropagation();
    setUpdatingStatus(videoId);

    try {
      await updateOriginalVideoRow(videoId, {
        field_6864: newStatus,
      });

      // Update local state
      setOriginalVideos((prevVideos) =>
        prevVideos.map((video) =>
          video.id === videoId ? { ...video, field_6864: newStatus } : video,
        ),
      );
    } catch (error) {
      console.error('Failed to update status:', error);
    } finally {
      setUpdatingStatus(null);
    }
  };

  // Bulk status change function
  const handleBulkStatusChange = async () => {
    if (!bulkStatusChange || originalVideos.length === 0) return;

    setUpdatingBulkStatus(true);
    let successCount = 0;
    let errorCount = 0;

    try {
      // Update all videos with the selected status
      const updatePromises = originalVideos.map(async (video) => {
        try {
          await updateOriginalVideoRow(video.id, {
            field_6864: bulkStatusChange,
          });
          successCount++;
          return video.id;
        } catch (error) {
          console.error(
            `Failed to update status for video ${video.id}:`,
            error,
          );
          errorCount++;
          return null;
        }
      });

      await Promise.all(updatePromises);

      // Update local state for all successfully updated videos
      setOriginalVideos((prevVideos) =>
        prevVideos.map((video) => ({
          ...video,
          field_6864: bulkStatusChange,
        })),
      );

      console.log(
        `Bulk status update completed: ${successCount} successful, ${errorCount} failed`,
      );

      // Reset the bulk status change
      setBulkStatusChange('');
    } catch (error) {
      console.error('Bulk status update failed:', error);
    } finally {
      setUpdatingBulkStatus(false);
    }
  };

  // Delete video function
  const handleDeleteVideo = async (videoId: number) => {
    setDeleting(videoId);

    try {
      // Delete the video and all related scenes
      // Pass the prefix cleanup setting from global state
      await deleteOriginalVideoWithScenes(
        videoId,
        deletionSettings.enablePrefixCleanup,
      );

      // Remove from local state
      setOriginalVideos((prev) => prev.filter((v) => v.id !== videoId));

      // Clear selection if this video was selected
      if (selectedOriginalVideo.id === videoId) {
        setSelectedOriginalVideo(null);
        saveSettingsToLocalStorage();
      }

      console.log(`Successfully deleted video ${videoId} and related scenes`);
    } catch (error) {
      console.error('Failed to delete video:', error);
    } finally {
      setDeleting(null);
      // add sound effect
      playSuccessSound();
    }
  };

  // Transcribe video function
  const handleTranscribeVideo = async (videoId: number, videoUrl: string) => {
    try {
      setTranscribing(videoId);

      // Step 1: Transcribe the video using selected model
      const transcribeResponse = await fetch('/api/transcribe-video', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          media_url: videoUrl,
          model: transcriptionSettings.selectedModel,
        }),
      });

      if (!transcribeResponse.ok) {
        throw new Error('Failed to transcribe video');
      }

      const transcriptionData = await transcribeResponse.json();

      // Extract video duration from transcription
      const videoDuration = transcriptionData.response?.duration || null;
      console.log('Video duration:', videoDuration);

      // Step 2: Process the response to extract word timestamps
      const wordTimestamps = [];
      const segments = transcriptionData.response?.segments;

      if (segments && segments.length > 0) {
        for (const segment of segments) {
          if (segment.words) {
            for (const wordObj of segment.words) {
              wordTimestamps.push({
                word: wordObj.word.trim(),
                start: wordObj.start,
                end: wordObj.end,
              });
            }
          }
        }
      }

      // Step 3: Upload the captions file to Baserow
      const captionsData = JSON.stringify(wordTimestamps);
      const timestamp = Date.now();
      const filename = `video_${videoId}_captions_${timestamp}.json`;

      const formData = new FormData();
      const blob = new Blob([captionsData], { type: 'application/json' });
      formData.append('file', blob, filename);

      const uploadResponse = await fetch('/api/upload-captions', {
        method: 'POST',
        body: formData,
      });

      if (!uploadResponse.ok) {
        throw new Error('Failed to upload captions');
      }

      const uploadResult = await uploadResponse.json();
      console.log('Captions uploaded successfully:', uploadResult);

      // Step 4: Update the original video record with the captions URL and duration
      const captionsUrl = uploadResult.url || uploadResult.file_url;
      if (captionsUrl) {
        const updateData: Record<string, unknown> = {
          field_6861: captionsUrl, // Captions URL field
        };

        // Add duration if available
        if (videoDuration !== null) {
          updateData.field_6909 = videoDuration; // Duration field
        }

        await updateOriginalVideoRow(videoId, updateData);
      }

      // Refresh the table to show any updates
      await handleRefresh();

      // Play success sound for transcription completion
      playSuccessSound();
    } catch (error) {
      console.error('Error transcribing video:', error);

      // Play error sound for transcription failure
      playErrorSound();

      setError(
        `Failed to transcribe video: ${
          error instanceof Error ? error.message : 'Unknown error'
        }`,
      );
    } finally {
      setTranscribing(null);
    }
  };

  const handleNormalizeVideo = async (videoId: number, videoUrl: string) => {
    try {
      setNormalizing(videoId);

      // Choose API endpoint based on audio enhancement mode
      const apiEndpoint =
        audioEnhancementMode === 'normalize'
          ? '/api/normalize-audio'
          : '/api/enhance-audio';

      const denoiseOnly = audioEnhancementMode === 'enhance-denoise-only';

      // Call the appropriate audio processing API
      const normalizeResponse = await fetch(apiEndpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          sceneId: videoId, // Use videoId as sceneId for original video normalization
          videoUrl: videoUrl,
          ...(audioEnhancementMode !== 'normalize' && {
            denoiseOnly,
            // Pass advanced audio settings for AI enhancement
            solver: advancedAudioSettings.solver,
            nfe: advancedAudioSettings.nfe,
            tau: advancedAudioSettings.tau,
            lambd: advancedAudioSettings.lambd,
          }),
        }),
      });

      if (!normalizeResponse.ok) {
        const errorData = await normalizeResponse.json();
        throw new Error(errorData.error || 'Failed to process audio');
      }

      const normalizeData = await normalizeResponse.json();
      console.log('Audio processed successfully:', normalizeData);

      // Update the original video record with the processed video URL
      const processedUrl =
        normalizeData.data?.normalizedUrl || normalizeData.data?.enhancedUrl;
      if (processedUrl) {
        // Store the old video URL before updating
        const oldVideoUrl = videoUrl;

        console.log(`[NORMALIZE] Old URL: ${oldVideoUrl}`);
        console.log(`[NORMALIZE] New URL: ${processedUrl}`);

        await updateOriginalVideoRow(videoId, {
          field_6903: processedUrl, // Normalized/Enhanced Video URL field
          field_6881: processedUrl, // Normalized/Enhanced Video URL field
        });

        // Delete the old video from MinIO to save space
        if (oldVideoUrl && oldVideoUrl !== processedUrl) {
          console.log(
            `[NORMALIZE] Deleting original video from MinIO: ${oldVideoUrl}`,
          );
          try {
            const deleted = await deleteFromMinio(oldVideoUrl);
            if (deleted) {
              console.log(
                `[NORMALIZE] Successfully deleted original video from MinIO`,
              );
            } else {
              console.warn(
                `[NORMALIZE] Failed to delete original video from MinIO, but continuing`,
              );
            }
          } catch (deleteError) {
            console.error(
              `[NORMALIZE] Error deleting original video from MinIO:`,
              deleteError,
            );
            // Don't throw - normalization was successful
          }
        } else {
          console.log(
            `[NORMALIZE] Skipping deletion - URLs are the same or old URL is missing`,
          );
        }
      }

      // Refresh the table to show any updates
      await handleRefresh();

      // Play success sound for normalization completion
      playSuccessSound();
    } catch (error) {
      console.error('Error normalizing video:', error);

      // Play error sound for normalization failure
      playErrorSound();

      setError(
        `Failed to process audio: ${
          error instanceof Error ? error.message : 'Unknown error'
        }`,
      );
    } finally {
      setNormalizing(null);
    }
  };

  const handleConvertToCFR = async (videoId: number, videoUrl: string) => {
    try {
      setConvertingToCFR(videoId);

      // Call the convert to CFR API
      const cfrResponse = await fetch('/api/convert-to-cfr', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          videoId: videoId,
          videoUrl: videoUrl,
          framerate: 30, // Target framerate of 30 fps
        }),
      });

      if (!cfrResponse.ok) {
        const errorData = await cfrResponse.json();
        throw new Error(errorData.error || 'Failed to convert to CFR');
      }

      const cfrData = await cfrResponse.json();
      console.log('Video converted to CFR successfully:', cfrData);

      // Update the original video record with the CFR video URL
      if (cfrData.data?.cfrUrl) {
        // Store the old video URL before updating
        const oldVideoUrl = videoUrl;

        console.log(`[CFR] Old URL: ${oldVideoUrl}`);
        console.log(`[CFR] New URL: ${cfrData.data.cfrUrl}`);

        await updateOriginalVideoRow(videoId, {
          field_6908: cfrData.data.cfrUrl, // CFR Video URL field
          field_6881: cfrData.data.cfrUrl, // Replace the main video URL field with CFR version
        });

        // Delete the old video from MinIO to save space
        if (oldVideoUrl && oldVideoUrl !== cfrData.data.cfrUrl) {
          console.log(
            `[CFR] Deleting original video from MinIO: ${oldVideoUrl}`,
          );
          try {
            const deleted = await deleteFromMinio(oldVideoUrl);
            if (deleted) {
              console.log(
                `[CFR] Successfully deleted original video from MinIO`,
              );
            } else {
              console.warn(
                `[CFR] Failed to delete original video from MinIO, but continuing`,
              );
            }
          } catch (deleteError) {
            console.error(
              `[CFR] Error deleting original video from MinIO:`,
              deleteError,
            );
            // Don't throw - CFR conversion was successful
          }
        } else {
          console.log(
            `[CFR] Skipping deletion - URLs are the same or old URL is missing`,
          );
        }
      }

      // Refresh the table to show any updates
      await handleRefresh();

      // Play success sound for CFR conversion completion
      playSuccessSound();
    } catch (error) {
      console.error('Error converting to CFR:', error);

      // Play error sound for CFR conversion failure
      playErrorSound();

      setError(
        `Failed to convert to CFR: ${
          error instanceof Error ? error.message : 'Unknown error'
        }`,
      );
    } finally {
      setConvertingToCFR(null);
    }
  };

  const handleOptimizeSilence = async (videoId: number, videoUrl: string) => {
    try {
      setOptimizingSilence(videoId);

      // Call the optimize silence API
      const silenceResponse = await fetch('/api/optimize-silence', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          videoId: videoId,
          videoUrl: videoUrl,
          options: {
            // FastForward options
            minCutLength: 0, // FastForward cuts longer than 0 sec
            maxCutLength: 90, // FastForward cuts shorter than 90 sec
            speedRate: silenceSpeedRate, // Speed Rate: configurable (1x, 2x, 4x, 8x)
            mute: silenceMuted, // Mute: configurable (muted or original audio)

            // Silence Detection options
            soundLevel: -43, // Filter below -43 dB
            minSilenceLength: 0.3, // Remove silences longer than 0.3 sec
            minDetectionLength: 0.2, // Ignore detections shorter than 0.2 sec
            leftPadding: 0.14, // Left padding: 0.14 sec
            rightPadding: 0.26, // Right padding: 0.26 sec
          },
        }),
      });

      if (!silenceResponse.ok) {
        const errorData = await silenceResponse.json();
        throw new Error(errorData.error || 'Failed to optimize silence');
      }

      const silenceData = await silenceResponse.json();
      console.log('Silence optimized successfully:', silenceData);

      // Update the original video record with the optimized video URL
      if (silenceData.data?.optimizedUrl) {
        // Store the old video URL before updating
        const oldVideoUrl = videoUrl;

        console.log(`[SILENCE] Old URL: ${oldVideoUrl}`);
        console.log(`[SILENCE] New URL: ${silenceData.data.optimizedUrl}`);

        await updateOriginalVideoRow(videoId, {
          field_6907: silenceData.data.optimizedUrl, // Silenced Video URL field
          field_6881: silenceData.data.optimizedUrl, // Replace the main video URL field
        });

        // Delete the old video from MinIO to save space
        if (oldVideoUrl && oldVideoUrl !== silenceData.data.optimizedUrl) {
          console.log(
            `[SILENCE] Deleting original video from MinIO: ${oldVideoUrl}`,
          );
          try {
            const deleted = await deleteFromMinio(oldVideoUrl);
            if (deleted) {
              console.log(
                `[SILENCE] Successfully deleted original video from MinIO`,
              );
            } else {
              console.warn(
                `[SILENCE] Failed to delete original video from MinIO, but continuing`,
              );
            }
          } catch (deleteError) {
            console.error(
              `[SILENCE] Error deleting original video from MinIO:`,
              deleteError,
            );
            // Don't throw - silence optimization was successful
          }
        } else {
          console.log(
            `[SILENCE] Skipping deletion - URLs are the same or old URL is missing`,
          );
        }
      }

      // Refresh the table to show any updates
      await handleRefresh();

      // Play success sound for silence optimization completion
      playSuccessSound();
    } catch (error) {
      console.error('Error optimizing silence:', error);

      // Play error sound for silence optimization failure
      playErrorSound();

      setError(
        `Failed to optimize silence: ${
          error instanceof Error ? error.message : 'Unknown error'
        }`,
      );
    } finally {
      setOptimizingSilence(null);
    }
  };

  // Transcribe all videos that don't have captions
  const handleTranscribeAll = async (playSound = true) => {
    try {
      setTranscribingAll(true);

      // Fetch fresh original videos data directly from API
      const freshVideosData = await getOriginalVideosData();

      // Filter videos that have video URLs but no captions URLs AND status is "Processing"
      const videosToTranscribe = freshVideosData.filter((video) => {
        const videoUrl = extractUrl(video.field_6881);
        const captionsUrl = extractUrl(video.field_6861);
        const status = extractFieldValue(video.field_6864);
        return videoUrl && !captionsUrl && status === 'Processing'; // Has video, no captions, and Processing status
      });

      if (videosToTranscribe.length === 0) {
        console.log('No videos found that need transcription');
        return;
      }

      console.log(
        `Starting transcription for ${videosToTranscribe.length} videos...`,
      );

      // Process videos one by one to avoid overwhelming the API
      for (const video of videosToTranscribe) {
        const videoUrl = extractUrl(video.field_6881);
        if (videoUrl) {
          console.log(`Transcribing video ${video.id}...`);
          setTranscribing(video.id);

          try {
            await handleTranscribeVideoInternal(video.id, videoUrl);
            console.log(`Successfully transcribed video ${video.id}`);
          } catch (error) {
            console.error(`Failed to transcribe video ${video.id}:`, error);
            // Continue with next video even if one fails
          }
        }
      }

      console.log('Batch transcription completed');
      await handleRefresh();

      // Play success sound for batch transcription completion (if enabled)
      if (playSound) {
        playSuccessSound();
      }
    } catch (error) {
      console.error('Error in batch transcription:', error);

      // Play error sound for batch transcription failure
      playErrorSound();

      setError(
        `Failed to transcribe all videos: ${
          error instanceof Error ? error.message : 'Unknown error'
        }`,
      );
    } finally {
      setTranscribing(null);
      setTranscribingAll(false);
    }
  };

  // Internal transcription function (without UI state management)
  const handleTranscribeVideoInternal = async (
    videoId: number,
    videoUrl: string,
  ) => {
    // Step 1: Transcribe the video using selected model
    const transcribeResponse = await fetch('/api/transcribe-video', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        media_url: videoUrl,
        model: transcriptionSettings.selectedModel,
      }),
    });

    if (!transcribeResponse.ok) {
      throw new Error('Failed to transcribe video');
    }

    const transcriptionData = await transcribeResponse.json();

    // Step 2: Process the response to extract word timestamps
    const wordTimestamps = [];
    const segments = transcriptionData.response?.segments;

    if (segments && segments.length > 0) {
      for (const segment of segments) {
        if (segment.words) {
          for (const wordObj of segment.words) {
            wordTimestamps.push({
              word: wordObj.word.trim(),
              start: wordObj.start,
              end: wordObj.end,
            });
          }
        }
      }
    }

    // Step 3: Upload the captions file to MinIO
    const captionsData = JSON.stringify(wordTimestamps);
    const timestamp = Date.now();
    const filename = `video_${videoId}_captions_${timestamp}.json`;

    const formData = new FormData();
    const blob = new Blob([captionsData], { type: 'application/json' });
    formData.append('file', blob, filename);

    const uploadResponse = await fetch('/api/upload-captions', {
      method: 'POST',
      body: formData,
    });

    if (!uploadResponse.ok) {
      throw new Error('Failed to upload captions');
    }

    const uploadResult = await uploadResponse.json();

    // Step 4: Update the original video record with the captions URL
    const captionsUrl = uploadResult.url || uploadResult.file_url;
    if (captionsUrl) {
      await updateOriginalVideoRow(videoId, {
        field_6861: captionsUrl, // Captions URL field
      });
    }
  };

  // Generate Scenes for individual video
  const handleGenerateScenes = async (videoId: number) => {
    try {
      setGeneratingScenes(videoId);
      setError(null);

      // Find the video to get captions URL and duration
      const video = originalVideos.find((v) => v.id === videoId);
      const captionsUrl = extractUrl(video?.field_6861);
      const hasScript =
        typeof video?.field_6854 === 'string' &&
        video.field_6854.trim().length > 0;
      let videoDuration = video?.field_6909 as number | undefined;

      if (!captionsUrl && !hasScript) {
        throw new Error('No captions URL or script found for this video');
      }

      // Fallback: If duration not stored, calculate from captions
      if (!videoDuration) {
        console.log(
          'Duration not found in database, calculating from captions...',
        );
        try {
          if (captionsUrl) {
            const captionsResponse = await fetch(captionsUrl);
            if (captionsResponse.ok) {
              const captions = await captionsResponse.json();
              if (Array.isArray(captions) && captions.length > 0) {
                // Get the end time of the last word
                const lastWord = captions[captions.length - 1];
                if (lastWord && typeof lastWord.end === 'number') {
                  videoDuration = lastWord.end;
                  console.log(
                    `Calculated duration from captions: ${videoDuration}s`,
                  );

                  // Save duration to database for future use
                  await updateOriginalVideoRow(videoId, {
                    field_6909: videoDuration,
                  });
                  console.log('Duration saved to database');
                }
              }
            }
          }
        } catch (error) {
          console.warn('Failed to calculate duration from captions:', error);
        }
      }

      console.log('Generating scenes for video:', videoId);
      console.log('Video duration:', videoDuration || 'not available');

      const response = await fetch('/api/generate-scenes', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          videoId,
          captionsUrl,
          videoDuration,
        }),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Failed to generate scenes');
      }

      const result = await response.json();
      console.log('Scenes generated successfully:', result);

      // Refresh the data to show any changes
      await handleRefresh();
    } catch (error) {
      console.error('Error generating scenes:', error);
      setError(
        `Failed to generate scenes: ${
          error instanceof Error ? error.message : 'Unknown error'
        }`,
      );
    } finally {
      setGeneratingScenes(null);
    }
  };

  // Generate Scenes for all videos
  const handleGenerateScenesAll = async (playSound = true) => {
    try {
      setGeneratingScenesAll(true);

      // Fetch fresh data directly to ensure we have latest captions URLs
      console.log('Fetching fresh data before scene generation...');
      const freshData = await getOriginalVideosData();
      console.log('Fresh data fetched:', freshData.length, 'videos');

      // Filter videos that have captions or script but no scenes AND status is "Processing"
      const videosToProcess = freshData.filter((video) => {
        const captionsUrl = extractUrl(video.field_6861);
        const hasCaptions = !!captionsUrl;
        const hasScript =
          typeof video.field_6854 === 'string' &&
          video.field_6854.trim().length > 0;
        const scenesExist = hasScenes(video);
        const status = extractFieldValue(video.field_6864);
        console.log(
          `Video ${video.id}: captions=${hasCaptions}, script=${hasScript}, scenes=${scenesExist}, status=${status}`,
        );
        return (
          (hasCaptions || hasScript) &&
          !hasScenes(video) &&
          status === 'Processing'
        );
      });

      if (videosToProcess.length === 0) {
        console.log('No videos found with captions that need scene generation');
        return;
      }

      console.log(
        `Starting scene generation for ${videosToProcess.length} videos...`,
      );

      // Process videos one by one
      for (const video of videosToProcess) {
        const captionsUrl = extractUrl(video.field_6861);
        const hasScript =
          typeof video.field_6854 === 'string' &&
          video.field_6854.trim().length > 0;
        let videoDuration = video?.field_6909 as number | undefined;

        // Fallback: Calculate duration from captions if not stored
        if (captionsUrl && !videoDuration) {
          try {
            const captionsResponse = await fetch(captionsUrl);
            if (captionsResponse.ok) {
              const captions = await captionsResponse.json();
              if (Array.isArray(captions) && captions.length > 0) {
                const lastWord = captions[captions.length - 1];
                if (lastWord && typeof lastWord.end === 'number') {
                  videoDuration = lastWord.end;
                  console.log(
                    `Video ${video.id}: Calculated duration from captions: ${videoDuration}s`,
                  );
                  // Save duration to database
                  await updateOriginalVideoRow(video.id, {
                    field_6909: videoDuration,
                  });
                }
              }
            }
          } catch (error) {
            console.warn(
              `Video ${video.id}: Failed to calculate duration from captions`,
            );
          }
        }

        if (captionsUrl || hasScript) {
          console.log(`Generating scenes for video ${video.id}...`);
          setGeneratingScenes(video.id);

          try {
            await handleGenerateScenesInternal(
              video.id,
              captionsUrl || undefined,
              videoDuration,
            );
            console.log(`Successfully generated scenes for video ${video.id}`);
          } catch (error) {
            console.error(
              `Failed to generate scenes for video ${video.id}:`,
              error,
            );
            // Continue with next video even if one fails
          }
        }
      }

      console.log('Batch scene generation completed');
      await handleRefresh();
    } catch (error) {
      console.error('Error in batch scene generation:', error);
      setError(
        `Failed to generate scenes for all videos: ${
          error instanceof Error ? error.message : 'Unknown error'
        }`,
      );
    } finally {
      setGeneratingScenes(null);
      setGeneratingScenesAll(false);
    }
  };

  // Internal scene generation function (without UI state management)
  const handleGenerateScenesInternal = async (
    videoId: number,
    captionsUrl?: string,
    videoDuration?: number,
  ) => {
    const response = await fetch('/api/generate-scenes', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        videoId,
        captionsUrl,
        videoDuration,
      }),
    });

    if (!response.ok) {
      const errorData = await response.json();
      throw new Error(errorData.error || 'Failed to generate scenes');
    }

    return response.json();
  };

  // Improve All Scenes for All Videos
  const handleImproveAllVideosScenes = async (playSound = true) => {
    if (!sceneHandlers) {
      console.log(
        'Scene handlers are not available yet. Please wait a moment and try again.',
      );
      return;
    }

    try {
      setImprovingAllVideosScenes(true);

      // Fetch fresh original videos data to check status
      const freshVideosData = await getOriginalVideosData();

      // Fetch fresh scenes data directly from API
      const freshScenesData = await getBaserowData();

      // Get all scenes from fresh data
      if (!freshScenesData || freshScenesData.length === 0) {
        console.log('No scenes found to improve');
        return;
      }

      // Filter videos by Processing status
      const videosToProcess = freshVideosData.filter((video) => {
        const status = extractFieldValue(video.field_6864);
        return status === 'Processing';
      });

      const videoIdsToProcess = new Set(videosToProcess.map((v) => v.id));

      // Filter scenes to only process those whose parent video has status === 'Processing'
      const scenesToProcess = freshScenesData.filter((scene) => {
        const videoIdField = scene['field_6889'];
        let videoId: number | null = null;

        if (typeof videoIdField === 'number') {
          videoId = videoIdField;
        } else if (typeof videoIdField === 'string') {
          videoId = parseInt(videoIdField, 10);
        } else if (Array.isArray(videoIdField) && videoIdField.length > 0) {
          const firstId =
            typeof videoIdField[0] === 'object'
              ? videoIdField[0].id || videoIdField[0].value
              : videoIdField[0];
          videoId = parseInt(String(firstId), 10);
        }

        return videoId && !isNaN(videoId) && videoIdsToProcess.has(videoId);
      });

      console.log(`Videos with Processing status: ${videosToProcess.length}`);
      console.log(
        `Scenes to process: ${scenesToProcess.length} of ${freshScenesData.length}`,
      );

      if (scenesToProcess.length === 0) {
        console.log('No scenes to process for videos with Processing status');
        return;
      }

      console.log(
        `Starting AI improvement for ${videosToProcess.length} videos (status: Processing) with ${scenesToProcess.length} scenes...`,
      );

      await handleImproveAllSentencesForAllVideos(
        scenesToProcess,
        sceneHandlers.handleSentenceImprovement,
        modelSelection.selectedModel,
        setImprovingAllVideosScenes,
        setCurrentProcessingVideoId,
        setImprovingSentence,
        playSound,
      );

      console.log('Batch improvement completed for all videos');

      // Refresh the original videos list to show any updates
      await handleRefresh();

      // Note: Success sound is already played in the batch operation utility
    } catch (error) {
      console.error('Error improving all videos scenes:', error);

      // Play error sound
      if (playSound) {
        playErrorSound();
      }

      setError(
        `Failed to improve all videos scenes: ${
          error instanceof Error ? error.message : 'Unknown error'
        }`,
      );
    } finally {
      setImprovingAllVideosScenes(false);
      setCurrentProcessingVideoId(null);
    }
  };

  // Generate TTS for All Scenes in All Videos
  const handleGenerateAllTTSForAllVideos = async (playSound = true) => {
    if (!sceneHandlers) {
      console.log(
        'Scene handlers are not available yet. Please wait a moment and try again.',
      );
      return;
    }

    try {
      setGeneratingAllTTSForAllVideos(true);

      // Fetch fresh original videos data to check status
      const freshVideosData = await getOriginalVideosData();

      // Fetch fresh scenes data directly from API
      const freshScenesData = await getBaserowData();

      // Get all scenes from fresh data
      if (!freshScenesData || freshScenesData.length === 0) {
        console.log('No scenes found to generate TTS');
        return;
      }

      // Filter videos by Processing status
      const videosToProcess = freshVideosData.filter((video) => {
        const status = extractFieldValue(video.field_6864);
        return status === 'Processing';
      });

      const videoIdsToProcess = new Set(videosToProcess.map((v) => v.id));

      // Filter scenes to only process those whose parent video has status === 'Processing'
      const scenesToProcess = freshScenesData.filter((scene) => {
        const videoIdField = scene['field_6889'];
        let videoId: number | null = null;

        if (typeof videoIdField === 'number') {
          videoId = videoIdField;
        } else if (typeof videoIdField === 'string') {
          videoId = parseInt(videoIdField, 10);
        } else if (Array.isArray(videoIdField) && videoIdField.length > 0) {
          const firstId =
            typeof videoIdField[0] === 'object'
              ? videoIdField[0].id || videoIdField[0].value
              : videoIdField[0];
          videoId = parseInt(String(firstId), 10);
        }

        return videoId && !isNaN(videoId) && videoIdsToProcess.has(videoId);
      });

      console.log(`Videos with Processing status: ${videosToProcess.length}`);
      console.log(
        `Scenes to process: ${scenesToProcess.length} of ${freshScenesData.length}`,
      );

      if (scenesToProcess.length === 0) {
        console.log('No scenes to process for videos with Processing status');
        return;
      }

      console.log(
        `Starting TTS generation for ${videosToProcess.length} videos (status: Processing) with ${scenesToProcess.length} scenes...`,
      );

      await generateAllTTSForAllVideosUtil(
        scenesToProcess,
        sceneHandlers.handleTTSProduce,
        setGeneratingAllTTSForAllVideos,
        setCurrentProcessingVideoId,
        setProducingTTS,
        playSound,
      );

      console.log('Batch TTS generation completed for all videos');

      // Refresh the original videos list to show any updates
      await handleRefresh();

      // Note: Success sound is already played in the batch operation utility
    } catch (error) {
      console.error('Error generating TTS for all videos scenes:', error);

      // Play error sound
      if (playSound) {
        playErrorSound();
      }

      setError(
        `Failed to generate TTS for all videos scenes: ${
          error instanceof Error ? error.message : 'Unknown error'
        }`,
      );
    } finally {
      setGeneratingAllTTSForAllVideos(false);
      setCurrentProcessingVideoId(null);
    }
  };

  // Generate Video for All Scenes in All Videos
  const handleGenerateAllVideosForAllScenes = async (playSound = true) => {
    if (!sceneHandlers) {
      console.log(
        'Scene handlers are not available yet. Please wait a moment and try again.',
      );
      return;
    }

    try {
      setGeneratingAllVideos(true);

      // Fetch fresh original videos data to check status
      const freshVideosData = await getOriginalVideosData();

      // Fetch fresh scenes data directly from API
      const freshScenesData = await getBaserowData();

      // Get all scenes from fresh data
      if (!freshScenesData || freshScenesData.length === 0) {
        console.log('No scenes found to generate videos');
        return;
      }

      // Filter videos by Processing status
      const videosToProcess = freshVideosData.filter((video) => {
        const status = extractFieldValue(video.field_6864);
        return status === 'Processing';
      });

      const videoIdsToProcess = new Set(videosToProcess.map((v) => v.id));

      // Filter scenes to only process those whose parent video has status === 'Processing'
      const scenesToProcess = freshScenesData.filter((scene) => {
        const videoIdField = scene['field_6889'];
        let videoId: number | null = null;

        if (typeof videoIdField === 'number') {
          videoId = videoIdField;
        } else if (typeof videoIdField === 'string') {
          videoId = parseInt(videoIdField, 10);
        } else if (Array.isArray(videoIdField) && videoIdField.length > 0) {
          const firstId =
            typeof videoIdField[0] === 'object'
              ? videoIdField[0].id || videoIdField[0].value
              : videoIdField[0];
          videoId = parseInt(String(firstId), 10);
        }

        return videoId && !isNaN(videoId) && videoIdsToProcess.has(videoId);
      });

      console.log(`Videos with Processing status: ${videosToProcess.length}`);
      console.log(
        `Scenes to process: ${scenesToProcess.length} of ${freshScenesData.length}`,
      );

      if (scenesToProcess.length === 0) {
        console.log('No scenes to process for videos with Processing status');
        return;
      }

      console.log(
        `Starting video generation for ${videosToProcess.length} videos (status: Processing) with ${scenesToProcess.length} scenes...`,
      );

      await handleGenerateAllVideos(
        scenesToProcess,
        sceneHandlers.handleVideoGenerate,
        () => {}, // startBatchOperation (not used in OriginalVideosList)
        () => {}, // completeBatchOperation (not used in OriginalVideosList)
        setGeneratingVideo,
        async () => {
          // Refresh only scenes data, not the entire page
          if (refreshScenesData) {
            refreshScenesData();
          }
        },
        playSound,
      );

      console.log('Batch video generation completed for all videos');

      // Note: Success sound and refresh are already handled in the batch operation utility
    } catch (error) {
      console.error('Error generating videos for all scenes:', error);

      // Play error sound
      if (playSound) {
        playErrorSound();
      }

      setError(
        `Failed to generate videos for all scenes: ${
          error instanceof Error ? error.message : 'Unknown error'
        }`,
      );
    } finally {
      setGeneratingAllVideos(false);
    }
  };

  // Speed Up All Videos for All Scenes
  const handleSpeedUpAllVideos = async (playSound = true) => {
    try {
      setSpeedingUpAllVideos(true);

      // Fetch fresh original videos data to check status
      const freshVideosData = await getOriginalVideosData();

      // Fetch fresh scenes data directly from API
      const freshScenesData = await getBaserowData();

      // Get all scenes from fresh data
      if (!freshScenesData || freshScenesData.length === 0) {
        console.log('No scenes found to speed up videos');
        return;
      }

      // Filter videos by Processing status
      const videosToProcess = freshVideosData.filter((video) => {
        const status = extractFieldValue(video.field_6864);
        return status === 'Processing';
      });

      const videoIdsToProcess = new Set(videosToProcess.map((v) => v.id));

      // Filter scenes to only process those whose parent video has status === 'Processing'
      const scenesToProcess = freshScenesData.filter((scene) => {
        const videoIdField = scene['field_6889'];
        let videoId: number | null = null;

        if (typeof videoIdField === 'number') {
          videoId = videoIdField;
        } else if (typeof videoIdField === 'string') {
          videoId = parseInt(videoIdField, 10);
        } else if (Array.isArray(videoIdField) && videoIdField.length > 0) {
          const firstId =
            typeof videoIdField[0] === 'object'
              ? videoIdField[0].id || videoIdField[0].value
              : videoIdField[0];
          videoId = parseInt(String(firstId), 10);
        }

        return videoId && !isNaN(videoId) && videoIdsToProcess.has(videoId);
      });

      console.log(`Videos with Processing status: ${videosToProcess.length}`);
      console.log(
        `Scenes to process: ${scenesToProcess.length} of ${freshScenesData.length}`,
      );

      if (scenesToProcess.length === 0) {
        console.log('No scenes to process for videos with Processing status');
        return;
      }

      console.log(
        `Starting speed up for ${videosToProcess.length} videos (status: Processing) with ${scenesToProcess.length} scenes...`,
      );

      await handleSpeedUpAllVideosForAllScenes(
        scenesToProcess,
        videoSettings,
        setSpeedingUpAllVideos,
        setCurrentProcessingVideoId,
        setSpeedingUpVideo,
        async () => {
          // Refresh only scenes data, not the entire page
          if (refreshScenesData) {
            refreshScenesData();
          }
        },
        playSound,
      );

      console.log('Batch speed up completed for all videos');

      // Note: Success sound and refresh are already handled in the batch operation utility
    } catch (error) {
      console.error('Error speeding up all videos:', error);

      // Play error sound
      if (playSound) {
        playErrorSound();
      }

      setError(
        `Failed to speed up all videos: ${
          error instanceof Error ? error.message : 'Unknown error'
        }`,
      );
    } finally {
      setSpeedingUpAllVideos(false);
      setCurrentProcessingVideoId(null);
    }
  };

  // Delete Empty Scenes for All Videos (Processing only)
  const handleDeleteEmptyScenesAllVideos = async (playSound = true) => {
    try {
      setError(null);
      setDeletingEmptyScenesAllVideos(true);

      const extractLinkedVideoId = (videoIdField: unknown): number | null => {
        if (typeof videoIdField === 'number') {
          return videoIdField;
        }

        if (typeof videoIdField === 'string') {
          const parsed = parseInt(videoIdField, 10);
          return Number.isFinite(parsed) ? parsed : null;
        }

        if (Array.isArray(videoIdField) && videoIdField.length > 0) {
          const first = videoIdField[0];

          if (typeof first === 'number') {
            return first;
          }

          if (typeof first === 'string') {
            const parsed = parseInt(first, 10);
            return Number.isFinite(parsed) ? parsed : null;
          }

          if (typeof first === 'object' && first !== null) {
            const rec = first as Record<string, unknown>;
            const candidate = rec.id ?? rec.value;
            const parsed = parseInt(String(candidate ?? ''), 10);
            return Number.isFinite(parsed) ? parsed : null;
          }
        }

        if (typeof videoIdField === 'object' && videoIdField !== null) {
          const rec = videoIdField as Record<string, unknown>;
          const candidate = rec.id ?? rec.value;
          const parsed = parseInt(String(candidate ?? ''), 10);
          return Number.isFinite(parsed) ? parsed : null;
        }

        return null;
      };

      // Fetch fresh original videos data to check status
      const freshVideosData = await getOriginalVideosData();

      // Fetch fresh scenes data directly from API
      const freshScenesData = await getBaserowData();

      if (!freshScenesData || freshScenesData.length === 0) {
        console.log('No scenes found to delete');
        return;
      }

      // Filter videos by Processing status
      const processingVideos = freshVideosData.filter((video) => {
        const status = extractFieldValue(video.field_6864);
        return status === 'Processing';
      });

      const processingVideoIds = new Set(processingVideos.map((v) => v.id));

      // Filter scenes to only those whose parent video has status === 'Processing'
      const scenesForProcessingVideos = freshScenesData.filter((scene) => {
        const videoId = extractLinkedVideoId(scene['field_6889']);

        return videoId && !isNaN(videoId) && processingVideoIds.has(videoId);
      });

      const emptyScenes = scenesForProcessingVideos.filter((scene) => {
        const sentence = String(scene['field_6890'] ?? '').trim();
        const original = String(
          scene['field_6901'] ?? scene['field_6900'] ?? '',
        ).trim();

        return sentence === '' && original === '';
      });

      console.log(`Processing videos: ${processingVideos.length}`);
      console.log(
        `Scenes in Processing videos: ${scenesForProcessingVideos.length} of ${freshScenesData.length}`,
      );
      console.log(`Empty scenes to delete: ${emptyScenes.length}`);

      if (emptyScenes.length === 0) {
        console.log('No empty scenes found for Processing videos');
        return;
      }

      for (const scene of emptyScenes) {
        const videoId = extractLinkedVideoId(scene['field_6889']);

        if (videoId && !isNaN(videoId)) {
          setCurrentProcessingVideoId(videoId);
        }

        const res = await fetch(`/api/baserow/scenes/${scene.id}`, {
          method: 'DELETE',
        });

        if (!res.ok) {
          const errorText = await res.text();
          throw new Error(
            `Failed to delete scene ${scene.id}: ${res.status} ${errorText}`,
          );
        }

        // Small delay to avoid overwhelming Baserow
        await new Promise((resolve) => setTimeout(resolve, 250));
      }

      if (refreshScenesData) {
        refreshScenesData();
      }

      if (playSound) {
        playSuccessSound();
      }
    } catch (error) {
      console.error('Error deleting empty scenes for all videos:', error);

      if (playSound) {
        playErrorSound();
      }

      setError(
        `Failed to delete empty scenes: ${
          error instanceof Error ? error.message : 'Unknown error'
        }`,
      );
    } finally {
      setDeletingEmptyScenesAllVideos(false);
      setCurrentProcessingVideoId(null);
    }
  };

  // Transcribe FINAL Scenes for All Videos (Processing only)
  const handleTranscribeProcessingScenesAllVideos = async (
    playSound = true,
  ) => {
    if (transcribingProcessingScenesAllVideos) return;

    try {
      setError(null);
      setTranscribingProcessingScenesAllVideos(true);

      const extractLinkedVideoId = (videoIdField: unknown): number | null => {
        if (typeof videoIdField === 'number') {
          return videoIdField;
        }

        if (typeof videoIdField === 'string') {
          const parsed = parseInt(videoIdField, 10);
          return Number.isFinite(parsed) ? parsed : null;
        }

        if (Array.isArray(videoIdField) && videoIdField.length > 0) {
          const first = videoIdField[0];

          if (typeof first === 'number') {
            return first;
          }

          if (typeof first === 'string') {
            const parsed = parseInt(first, 10);
            return Number.isFinite(parsed) ? parsed : null;
          }

          if (typeof first === 'object' && first !== null) {
            const rec = first as Record<string, unknown>;
            const candidate = rec.id ?? rec.value;
            const parsed = parseInt(String(candidate ?? ''), 10);
            return Number.isFinite(parsed) ? parsed : null;
          }
        }

        if (typeof videoIdField === 'object' && videoIdField !== null) {
          const rec = videoIdField as Record<string, unknown>;
          const candidate = rec.id ?? rec.value;
          const parsed = parseInt(String(candidate ?? ''), 10);
          return Number.isFinite(parsed) ? parsed : null;
        }

        return null;
      };

      // Fetch fresh original videos and scenes
      const freshVideosData = await getOriginalVideosData();
      const freshScenesData = await getBaserowData();

      if (!freshScenesData || freshScenesData.length === 0) {
        console.log('No scenes found to transcribe');
        return;
      }

      // Filter videos by Processing status
      const processingVideos = freshVideosData.filter((video) => {
        const status = extractFieldValue(video.field_6864);
        return status === 'Processing';
      });

      const processingVideoIds = new Set(processingVideos.map((v) => v.id));

      // Filter scenes for Processing videos
      const scenesForProcessingVideos = freshScenesData.filter((scene) => {
        const videoId = extractLinkedVideoId(scene['field_6889']);
        return videoId && !isNaN(videoId) && processingVideoIds.has(videoId);
      });

      // Only transcribe scenes that have a final video and missing captions
      const scenesToTranscribe = scenesForProcessingVideos.filter((scene) => {
        const finalVideo = scene['field_6886'];
        const captions = scene['field_6910'];

        const hasFinalVideo =
          typeof finalVideo === 'string' && finalVideo.trim().length > 0;
        const hasCaptions =
          typeof captions === 'string'
            ? captions.trim().length > 0
            : !!captions;

        return hasFinalVideo && !hasCaptions;
      });

      console.log(`Processing videos: ${processingVideos.length}`);
      console.log(
        `Scenes in Processing videos: ${scenesForProcessingVideos.length} of ${freshScenesData.length}`,
      );
      console.log(
        `Scenes to transcribe (final video, missing captions): ${scenesToTranscribe.length}`,
      );

      if (scenesToTranscribe.length === 0) {
        console.log(
          'No final scenes found that need transcription for Processing videos',
        );
        return;
      }

      for (const scene of scenesToTranscribe) {
        const videoId = extractLinkedVideoId(scene['field_6889']);
        if (videoId && !isNaN(videoId)) {
          setCurrentProcessingVideoId(videoId);
        }

        const videoUrl = String(scene['field_6886'] ?? '').trim();
        if (!videoUrl) continue;

        // Step 1: Transcribe the scene final video
        const transcribeResponse = await fetch('/api/transcribe-scene', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            media_url: videoUrl,
            model: transcriptionSettings.selectedModel,
            scene_id: scene.id,
          }),
        });

        if (!transcribeResponse.ok) {
          const errText = await transcribeResponse.text();
          throw new Error(
            `Failed to transcribe scene ${scene.id}: ${transcribeResponse.status} ${errText}`,
          );
        }

        const transcriptionData = await transcribeResponse.json();

        // Step 2: Extract word timestamps
        const wordTimestamps: Array<{
          word: string;
          start: number;
          end: number;
        }> = [];
        const segments = transcriptionData.response?.segments;

        if (segments && segments.length > 0) {
          for (const segment of segments) {
            if (segment.words) {
              for (const wordObj of segment.words) {
                wordTimestamps.push({
                  word: String(wordObj.word ?? '').trim(),
                  start: Number(wordObj.start),
                  end: Number(wordObj.end),
                });
              }
            }
          }
        }

        // Step 3: Upload captions JSON
        const captionsData = JSON.stringify(wordTimestamps);
        const timestamp = Date.now();
        const filename = `scene_${scene.id}_captions_${timestamp}.json`;

        const formData = new FormData();
        const blob = new Blob([captionsData], { type: 'application/json' });
        formData.append('file', blob, filename);

        const uploadResponse = await fetch('/api/upload-captions', {
          method: 'POST',
          body: formData,
        });

        if (!uploadResponse.ok) {
          const errText = await uploadResponse.text();
          throw new Error(
            `Failed to upload captions for scene ${scene.id}: ${uploadResponse.status} ${errText}`,
          );
        }

        const uploadResult = await uploadResponse.json();
        const captionsUrl = uploadResult.url || uploadResult.file_url;
        if (!captionsUrl) {
          throw new Error(
            `Upload did not return a captions URL for scene ${scene.id}`,
          );
        }

        // Step 4: Update scene fields (captions + sentence)
        const fullText = wordTimestamps
          .map((w) => w.word)
          .filter(Boolean)
          .join(' ')
          .trim();

        const updateData: Record<string, unknown> = {
          field_6910: captionsUrl,
          ...(fullText ? { field_6890: fullText } : {}),
        };

        const patchRes = await fetch(`/api/baserow/scenes/${scene.id}`, {
          method: 'PATCH',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(updateData),
        });

        if (!patchRes.ok) {
          const errorText = await patchRes.text();
          throw new Error(
            `Failed to update scene ${scene.id}: ${patchRes.status} ${errorText}`,
          );
        }

        // Small delay to avoid rate limits / overwhelming the backend
        await new Promise((resolve) => setTimeout(resolve, 2000));
      }

      if (refreshScenesData) {
        refreshScenesData();
      }

      if (playSound) {
        playSuccessSound();
      }
    } catch (error) {
      console.error(
        'Error transcribing final scenes for Processing videos:',
        error,
      );

      if (playSound) {
        playErrorSound();
      }

      setError(
        `Failed to transcribe final scenes: ${
          error instanceof Error ? error.message : 'Unknown error'
        }`,
      );
    } finally {
      setTranscribingProcessingScenesAllVideos(false);
      setCurrentProcessingVideoId(null);
    }
  };

  // Prompt Scenes for All Videos (Processing only)
  const handlePromptProcessingScenesAllVideos = async (playSound = true) => {
    if (promptingProcessingScenesAllVideos) return;
    if (!modelSelection.selectedModel) return;

    try {
      setPromptingProcessingScenesAllVideos(true);

      // Resolve prompt destination field key once
      let promptFieldKey: string | null = null;
      try {
        const res = await fetch('/api/generate-scene-prompt', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ resolveOnly: true }),
        });

        if (!res.ok) {
          const t = await res.text().catch(() => '');
          throw new Error(`Failed to resolve prompt field: ${res.status} ${t}`);
        }

        const json = (await res.json().catch(() => null)) as {
          promptFieldKey?: unknown;
        } | null;
        promptFieldKey =
          typeof json?.promptFieldKey === 'string' ? json.promptFieldKey : null;
      } catch (error) {
        console.error('Failed to resolve prompt field key:', error);
        return;
      }

      if (!promptFieldKey) return;

      const extractLinkedVideoId = (videoIdField: unknown): number | null => {
        if (typeof videoIdField === 'number') return videoIdField;

        if (typeof videoIdField === 'string') {
          const parsed = parseInt(videoIdField, 10);
          return Number.isFinite(parsed) ? parsed : null;
        }

        if (Array.isArray(videoIdField) && videoIdField.length > 0) {
          const first = videoIdField[0];

          if (typeof first === 'number') return first;
          if (typeof first === 'string') {
            const parsed = parseInt(first, 10);
            return Number.isFinite(parsed) ? parsed : null;
          }

          if (typeof first === 'object' && first !== null) {
            const rec = first as Record<string, unknown>;
            const candidate = rec.id ?? rec.value;
            const parsed = parseInt(String(candidate ?? ''), 10);
            return Number.isFinite(parsed) ? parsed : null;
          }
        }

        if (typeof videoIdField === 'object' && videoIdField !== null) {
          const rec = videoIdField as Record<string, unknown>;
          const candidate = rec.id ?? rec.value;
          const parsed = parseInt(String(candidate ?? ''), 10);
          return Number.isFinite(parsed) ? parsed : null;
        }

        return null;
      };

      // Fetch fresh original videos and scenes
      const freshVideosData = await getOriginalVideosData();
      const freshScenesData = await getBaserowData();

      if (!freshScenesData || freshScenesData.length === 0) {
        if (playSound) playSuccessSound();
        return;
      }

      // Processing-only videos
      const processingVideos = freshVideosData.filter((video) => {
        const status = extractFieldValue(video.field_6864);
        return status === 'Processing';
      });

      const processingVideoIds = new Set(processingVideos.map((v) => v.id));

      // Scenes for Processing videos, non-empty, and missing prompt
      const scenesToPrompt = freshScenesData.filter((scene) => {
        const videoId = extractLinkedVideoId(scene['field_6889']);
        if (!videoId || isNaN(videoId) || !processingVideoIds.has(videoId)) {
          return false;
        }

        const sentence = String(scene['field_6890'] ?? '').trim();
        const original = String(
          scene['field_6901'] ?? scene['field_6900'] ?? '',
        ).trim();
        if (!(sentence || original)) return false;

        const existingPromptValue = scene[
          promptFieldKey as keyof typeof scene
        ] as unknown;
        if (typeof existingPromptValue === 'string') {
          return existingPromptValue.trim().length === 0;
        }

        return !existingPromptValue;
      });

      if (scenesToPrompt.length === 0) {
        if (playSound) playSuccessSound();
        return;
      }

      for (const scene of scenesToPrompt) {
        const videoId = extractLinkedVideoId(scene['field_6889']);
        if (videoId && !isNaN(videoId)) {
          setCurrentProcessingVideoId(videoId);
        }

        const genRes = await fetch('/api/generate-scene-prompt', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            sceneId: scene.id,
            model: modelSelection.selectedModel,
          }),
        });

        if (!genRes.ok) {
          const t = await genRes.text().catch(() => '');
          throw new Error(
            `Prompt generation failed for scene ${scene.id}: ${genRes.status} ${t}`,
          );
        }

        const genData = (await genRes.json().catch(() => null)) as {
          scenePrompt?: unknown;
        } | null;
        const scenePrompt =
          typeof genData?.scenePrompt === 'string' ? genData.scenePrompt : null;

        if (!scenePrompt || !scenePrompt.trim()) {
          throw new Error(`Empty prompt returned for scene ${scene.id}`);
        }

        const patchRes = await fetch(`/api/baserow/scenes/${scene.id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ [promptFieldKey]: scenePrompt }),
        });

        if (!patchRes.ok) {
          const t = await patchRes.text().catch(() => '');
          throw new Error(
            `Failed to save prompt for scene ${scene.id}: ${patchRes.status} ${t}`,
          );
        }

        await new Promise((resolve) => setTimeout(resolve, 150));
      }

      if (refreshScenesData) {
        refreshScenesData();
      }

      if (playSound) {
        playSuccessSound();
      }
    } catch (error) {
      console.error('Prompt scenes (Processing) failed:', error);
      // No UI error messages; keep silent on failure.
    } finally {
      setPromptingProcessingScenesAllVideos(false);
      setCurrentProcessingVideoId(null);
    }
  };

  // Optimize Silence for All Original Videos
  const handleOptimizeSilenceAll = async (playSound = true) => {
    try {
      setOptimizingSilenceVideo(null);
      startBatchOperation('optimizingAllSilence');

      // Fetch fresh original videos data directly from API
      const freshVideosData = await getOriginalVideosData();

      // Filter videos that have video URLs but don't have silenced version yet AND status is "Processing"
      const videosToOptimize = freshVideosData.filter((video) => {
        const videoUrl = extractUrl(video.field_6881);
        const silencedUrl = extractUrl(video.field_6907);
        const status = extractFieldValue(video.field_6864);
        return videoUrl && !silencedUrl && status === 'Processing'; // Has video URL, no silenced version, and Processing status
      });

      if (videosToOptimize.length === 0) {
        console.log('No videos found that need silence optimization');
        return;
      }

      console.log(
        `Starting silence optimization for ${videosToOptimize.length} videos...`,
      );

      // Process videos one by one to avoid overwhelming the API
      for (const video of videosToOptimize) {
        const videoUrl = extractUrl(video.field_6881);
        if (videoUrl) {
          console.log(`Optimizing silence for video ${video.id}...`);
          setOptimizingSilenceVideo(video.id);

          try {
            const response = await fetch('/api/optimize-silence', {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
              },
              body: JSON.stringify({
                videoId: video.id,
                videoUrl: videoUrl,
                options: {
                  // FastForward options
                  minCutLength: 0, // FastForward cuts longer than 0 sec
                  maxCutLength: 90, // FastForward cuts shorter than 90 sec
                  speedRate: silenceSpeedRate, // Speed Rate: configurable (1x, 2x, 4x, 8x)
                  mute: silenceMuted, // Mute: configurable (muted or original audio)

                  // Silence Detection options
                  soundLevel: -43, // Filter below -43 dB
                  minSilenceLength: 0.3, // Remove silences longer than 0.3 sec
                  minDetectionLength: 0.2, // Ignore detections shorter than 0.2 sec
                  leftPadding: 0.14, // Left padding: 0.14 sec
                  rightPadding: 0.26, // Right padding: 0.26 sec
                },
              }),
            });

            if (!response.ok) {
              let errorMessage = `Silence optimization failed: ${response.status}`;
              try {
                const errorData = await response.json();
                errorMessage = errorData.error || errorMessage;
                console.error('API Error:', errorData);
              } catch (parseError) {
                console.error('Could not parse error response');
              }
              throw new Error(errorMessage);
            }

            const result = await response.json();
            console.log(`Successfully optimized silence for video ${video.id}`);
            console.log('Result:', result);
            console.log('Optimized URL:', result.data?.optimizedUrl);

            // Update the original video record with the optimized video URL
            if (result.data?.optimizedUrl) {
              console.log(`Updating video ${video.id} with optimized URL...`);

              // Store the old video URL before updating
              const oldVideoUrl = videoUrl;

              console.log(`[SILENCE BATCH] Old URL: ${oldVideoUrl}`);
              console.log(
                `[SILENCE BATCH] New URL: ${result.data.optimizedUrl}`,
              );

              await updateOriginalVideoRow(video.id, {
                field_6907: result.data.optimizedUrl, // Silenced Video URL field
                field_6881: result.data.optimizedUrl, // Replace the main video URL field
              });
              console.log(`Video ${video.id} updated successfully`);

              // Delete the old video from MinIO to save space
              if (oldVideoUrl && oldVideoUrl !== result.data.optimizedUrl) {
                console.log(
                  `[SILENCE BATCH] Deleting original video from MinIO: ${oldVideoUrl}`,
                );
                try {
                  const deleted = await deleteFromMinio(oldVideoUrl);
                  if (deleted) {
                    console.log(
                      `[SILENCE BATCH] Successfully deleted original video from MinIO`,
                    );
                  } else {
                    console.warn(
                      `[SILENCE BATCH] Failed to delete original video from MinIO, but continuing`,
                    );
                  }
                } catch (deleteError) {
                  console.error(
                    `[SILENCE BATCH] Error deleting original video from MinIO:`,
                    deleteError,
                  );
                  // Don't throw - silence optimization was successful
                }
              } else {
                console.log(
                  `[SILENCE BATCH] Skipping deletion - URLs are the same or old URL is missing`,
                );
              }

              // Refresh after each video to show updates immediately
              await handleRefresh();
            } else {
              console.warn(
                `No optimized URL found in result for video ${video.id}`,
              );
            }
          } catch (error) {
            console.error(
              `Failed to optimize silence for video ${video.id}:`,
              error,
            );
            // Continue with next video even if one fails
          }
        }
      }

      console.log('Batch silence optimization completed');
      await handleRefresh();

      // Play success sound (if enabled)
      if (playSound) {
        playSuccessSound();
      }
    } catch (error) {
      console.error('Error in batch silence optimization:', error);

      // Play error sound (if enabled)
      if (playSound) {
        playErrorSound();
      }

      setError(
        `Failed to optimize silence for all videos: ${
          error instanceof Error ? error.message : 'Unknown error'
        }`,
      );
    } finally {
      setOptimizingSilenceVideo(null);
      completeBatchOperation('optimizingAllSilence');
    }
  };

  // Normalize Audio Loudness for All Original Videos
  const handleNormalizeAudioAll = async (playSound = true) => {
    try {
      setNormalizingAudioVideo(null);
      startBatchOperation('normalizingAllAudio');

      // Fetch fresh original videos data directly from API
      const freshVideosData = await getOriginalVideosData();

      // Filter videos that have video URLs but don't have normalized version yet AND status is "Processing"
      const videosToNormalize = freshVideosData.filter((video) => {
        const videoUrl = extractUrl(video.field_6881);
        const normalizedUrl = extractUrl(video.field_6903);
        const status = extractFieldValue(video.field_6864);
        return videoUrl && !normalizedUrl && status === 'Processing'; // Has video URL, no normalized version, and Processing status
      });

      if (videosToNormalize.length === 0) {
        console.log('No videos found that need audio normalization');
        return;
      }

      console.log(
        `Starting audio normalization for ${videosToNormalize.length} videos...`,
      );

      // Process videos one by one to avoid overwhelming the API
      for (const video of videosToNormalize) {
        const videoUrl = extractUrl(video.field_6881);
        if (videoUrl) {
          console.log(`Normalizing audio for video ${video.id}...`);
          setNormalizingAudioVideo(video.id);

          try {
            const response = await fetch('/api/normalize-audio', {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
              },
              body: JSON.stringify({
                sceneId: video.id,
                videoUrl: videoUrl,
              }),
            });

            if (!response.ok) {
              let errorMessage = `Audio normalization failed: ${response.status}`;
              try {
                const errorData = await response.json();
                errorMessage = errorData.error || errorMessage;
                console.error('API Error:', errorData);
              } catch (parseError) {
                console.error('Could not parse error response');
              }
              throw new Error(errorMessage);
            }

            const result = await response.json();
            console.log('='.repeat(80));
            console.log(
              `[CLIENT] Successfully normalized audio for video ${video.id}`,
            );
            console.log('[CLIENT] Result:', result);
            console.log('[CLIENT] Normalized URL:', result.data?.normalizedUrl);
            console.log('='.repeat(80));

            // Update the original video record with the normalized video URL
            if (result.data?.normalizedUrl) {
              console.log(
                `[CLIENT] Updating video ${video.id} with normalized URL...`,
              );

              // Store the old uploaded video URL before updating
              const oldUploadedVideoUrl = videoUrl; // This is the original field_6881 URL we extracted earlier

              console.log(`[NORMALIZE DEBUG] Old URL: ${oldUploadedVideoUrl}`);
              console.log(
                `[NORMALIZE DEBUG] New URL: ${result.data.normalizedUrl}`,
              );
              console.log(
                `[NORMALIZE DEBUG] URLs are different: ${
                  oldUploadedVideoUrl !== result.data.normalizedUrl
                }`,
              );

              await updateOriginalVideoRow(video.id, {
                field_6903: result.data.normalizedUrl, // Normalized Video URL field
                field_6881: result.data.normalizedUrl, // Replace the main video URL field
              });
              console.log(`Video ${video.id} updated successfully`);

              // Delete the old uploaded video from MinIO to save space
              if (
                oldUploadedVideoUrl &&
                oldUploadedVideoUrl !== result.data.normalizedUrl
              ) {
                console.log(
                  `[NORMALIZE] Deleting original uploaded video from MinIO: ${oldUploadedVideoUrl}`,
                );
                try {
                  const deleted = await deleteFromMinio(oldUploadedVideoUrl);
                  if (deleted) {
                    console.log(
                      `[NORMALIZE] Successfully deleted original uploaded video from MinIO`,
                    );
                  } else {
                    console.warn(
                      `[NORMALIZE] Failed to delete original video from MinIO, but continuing`,
                    );
                  }
                } catch (deleteError) {
                  console.error(
                    `[NORMALIZE] Error deleting original video from MinIO:`,
                    deleteError,
                  );
                  // Don't throw - normalization was successful
                }
              } else {
                console.log(
                  `[NORMALIZE] Skipping deletion - URLs are the same or old URL is missing`,
                );
              }

              // Refresh after each video to show updates immediately
              await handleRefresh();
            } else {
              console.warn(
                `No normalized URL found in result for video ${video.id}`,
              );
            }
          } catch (error) {
            console.error(
              `Failed to normalize audio for video ${video.id}:`,
              error,
            );
            // Continue with next video even if one fails
          }
        }
      }

      console.log('Batch audio normalization completed');
      await handleRefresh();

      // Play success sound (if enabled)
      if (playSound) {
        playSuccessSound();
      }
    } catch (error) {
      console.error('Error in batch audio normalization:', error);

      // Play error sound (if enabled)
      if (playSound) {
        playErrorSound();
      }

      setError(
        `Failed to normalize audio for all videos: ${
          error instanceof Error ? error.message : 'Unknown error'
        }`,
      );
    } finally {
      setNormalizingAudioVideo(null);
      completeBatchOperation('normalizingAllAudio');
    }
  };

  // Convert to CFR for All Original Videos
  const handleConvertToCFRAll = async (playSound = true) => {
    try {
      setConvertingToCFRVideo(null);
      startBatchOperation('convertingAllToCFR');

      // Fetch fresh original videos data directly from API
      const freshVideosData = await getOriginalVideosData();

      // Filter videos that have video URLs but don't have CFR version yet AND status is "Processing"
      const videosToConvert = freshVideosData.filter((video) => {
        const videoUrl = extractUrl(video.field_6881);
        const cfrUrl = extractUrl(video.field_6908);
        const status = extractFieldValue(video.field_6864);
        return videoUrl && !cfrUrl && status === 'Processing'; // Has video URL, no CFR version, and Processing status
      });

      if (videosToConvert.length === 0) {
        console.log('No videos found that need CFR conversion');
        return;
      }

      console.log(
        `Starting CFR conversion for ${videosToConvert.length} videos...`,
      );

      // Process videos one by one to avoid overwhelming the API
      for (const video of videosToConvert) {
        const videoUrl = extractUrl(video.field_6881);
        if (videoUrl) {
          console.log(`Converting video ${video.id} to CFR...`);
          setConvertingToCFRVideo(video.id);

          try {
            const response = await fetch('/api/convert-to-cfr', {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
              },
              body: JSON.stringify({
                videoId: video.id,
                videoUrl: videoUrl,
                framerate: 30, // Target framerate of 30 fps
              }),
            });

            if (!response.ok) {
              let errorMessage = `CFR conversion failed: ${response.status}`;
              try {
                const errorData = await response.json();
                errorMessage = errorData.error || errorMessage;
                console.error('API Error:', errorData);
              } catch (parseError) {
                console.error('Could not parse error response');
              }
              throw new Error(errorMessage);
            }

            const result = await response.json();
            console.log(`Successfully converted video ${video.id} to CFR`);
            console.log('Result:', result);
            console.log('CFR URL:', result.data?.cfrUrl);

            // Update the original video record with the CFR video URL
            if (result.data?.cfrUrl) {
              console.log(`Updating video ${video.id} with CFR URL...`);

              // Store the old video URL before updating
              const oldVideoUrl = videoUrl;

              console.log(`[CFR BATCH] Old URL: ${oldVideoUrl}`);
              console.log(`[CFR BATCH] New URL: ${result.data.cfrUrl}`);

              await updateOriginalVideoRow(video.id, {
                field_6908: result.data.cfrUrl, // CFR Video URL field
                field_6881: result.data.cfrUrl, // Replace the main video URL field
              });
              console.log(`Video ${video.id} updated successfully`);

              // Delete the old video from MinIO to save space
              if (oldVideoUrl && oldVideoUrl !== result.data.cfrUrl) {
                console.log(
                  `[CFR BATCH] Deleting original video from MinIO: ${oldVideoUrl}`,
                );
                try {
                  const deleted = await deleteFromMinio(oldVideoUrl);
                  if (deleted) {
                    console.log(
                      `[CFR BATCH] Successfully deleted original video from MinIO`,
                    );
                  } else {
                    console.warn(
                      `[CFR BATCH] Failed to delete original video from MinIO, but continuing`,
                    );
                  }
                } catch (deleteError) {
                  console.error(
                    `[CFR BATCH] Error deleting original video from MinIO:`,
                    deleteError,
                  );
                  // Don't throw - CFR conversion was successful
                }
              } else {
                console.log(
                  `[CFR BATCH] Skipping deletion - URLs are the same or old URL is missing`,
                );
              }

              // Refresh after each video to show updates immediately
              await handleRefresh();
            } else {
              console.warn(`No CFR URL found in result for video ${video.id}`);
            }
          } catch (error) {
            console.error(`Failed to convert video ${video.id} to CFR:`, error);
            // Continue with next video even if one fails
          }
        }
      }

      console.log('Batch CFR conversion completed');
      await handleRefresh();

      // Play success sound (if enabled)
      if (playSound) {
        playSuccessSound();
      }
    } catch (error) {
      console.error('Error in batch CFR conversion:', error);

      // Play error sound (if enabled)
      if (playSound) {
        playErrorSound();
      }

      setError(
        `Failed to convert videos to CFR: ${
          error instanceof Error ? error.message : 'Unknown error'
        }`,
      );
    } finally {
      setConvertingToCFRVideo(null);
      completeBatchOperation('convertingAllToCFR');
    }
  };

  // Convert All Final Merged Videos to CFR
  const handleConvertFinalToCFRAll = async () => {
    try {
      setError(null);
      setConvertingFinalToCFRVideo(null);
      startBatchOperation('convertingAllFinalToCFR');

      // Fetch fresh original videos data directly from API
      const freshVideosData = await getOriginalVideosData();

      // Filter videos that have Final Merged Video URLs AND status is "Processing"
      const videosToConvert = freshVideosData.filter((video) => {
        const finalVideoUrl = extractUrl(video.field_6858);
        const status = extractFieldValue(video.field_6864);
        const isAlreadyCFR = finalVideoUrl && finalVideoUrl.includes('_cfr');
        return finalVideoUrl && status === 'Processing' && !isAlreadyCFR; // Has final video URL, Processing status, and not already CFR
      });

      if (videosToConvert.length === 0) {
        console.log('No final videos found that need CFR conversion');
        return;
      }

      console.log(
        `Starting CFR conversion for ${videosToConvert.length} final videos...`,
      );

      // Process videos one by one to avoid overwhelming the API
      for (const video of videosToConvert) {
        const finalVideoUrl = extractUrl(video.field_6858);
        if (finalVideoUrl) {
          console.log(`Converting final video ${video.id} to CFR...`);
          setConvertingFinalToCFRVideo(video.id);

          try {
            const response = await fetch('/api/convert-to-cfr', {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
              },
              body: JSON.stringify({
                videoId: video.id,
                videoUrl: finalVideoUrl,
                framerate: 30, // Target framerate of 30 fps
              }),
            });

            if (!response.ok) {
              let errorMessage = `CFR conversion failed: ${response.status}`;
              try {
                const errorData = await response.json();
                errorMessage = errorData.error || errorMessage;
                console.error('API Error:', errorData);
              } catch (parseError) {
                console.error('Could not parse error response');
              }
              throw new Error(errorMessage);
            }

            const result = await response.json();
            console.log(
              `Successfully converted final video ${video.id} to CFR`,
            );
            console.log('Result:', result);
            console.log('CFR URL:', result.data?.cfrUrl);

            // Update the record with the CFR final video URL
            if (result.data?.cfrUrl) {
              console.log(
                `Updating video ${video.id} final video with CFR URL...`,
              );

              // Store the old final video URL before updating
              const oldFinalVideoUrl = finalVideoUrl;

              console.log(`[CFR FINAL BATCH] Old URL: ${oldFinalVideoUrl}`);
              console.log(`[CFR FINAL BATCH] New URL: ${result.data.cfrUrl}`);

              await updateOriginalVideoRow(video.id, {
                field_6858: result.data.cfrUrl, // Replace the Final Merged Video URL with CFR version
              });
              console.log(`Video ${video.id} final video updated successfully`);

              // Delete the old final video from MinIO to save space
              if (oldFinalVideoUrl && oldFinalVideoUrl !== result.data.cfrUrl) {
                console.log(
                  `[CFR FINAL BATCH] Deleting original final video from MinIO: ${oldFinalVideoUrl}`,
                );
                try {
                  const deleted = await deleteFromMinio(oldFinalVideoUrl);
                  if (deleted) {
                    console.log(
                      `[CFR FINAL BATCH] Successfully deleted original final video from MinIO`,
                    );
                  } else {
                    console.warn(
                      `[CFR FINAL BATCH] Failed to delete original final video from MinIO, but continuing`,
                    );
                  }
                } catch (deleteError) {
                  console.error(
                    `[CFR FINAL BATCH] Error deleting original final video from MinIO:`,
                    deleteError,
                  );
                  // Don't throw - CFR conversion was successful
                }
              } else {
                console.log(
                  `[CFR FINAL BATCH] Skipping deletion - URLs are the same or old URL is missing`,
                );
              }

              // Refresh after each video to show updates immediately
              await handleRefresh();
            } else {
              console.warn(
                `No CFR URL found in result for final video ${video.id}`,
              );
            }
          } catch (error) {
            console.error(
              `Failed to convert final video ${video.id} to CFR:`,
              error,
            );
            // Continue with next video even if one fails
          }
        }
      }

      console.log('Batch CFR conversion for final videos completed');
      await handleRefresh();

      // Play success sound
      playSuccessSound();
    } catch (error) {
      console.error('Error in batch CFR conversion for final videos:', error);

      // Play error sound
      playErrorSound();

      setError(
        `Failed to convert final videos to CFR: ${
          error instanceof Error ? error.message : 'Unknown error'
        }`,
      );
    } finally {
      setConvertingFinalToCFRVideo(null);
      completeBatchOperation('convertingAllFinalToCFR');
    }
  };

  // Merge All Final Videos
  const handleMergeAllFinalVideos = async () => {
    try {
      setMergingFinalVideos(true);
      setError(null);

      // Fetch fresh original videos data directly from API
      const freshVideosData = await getOriginalVideosData();

      // Filter videos that have Final Merged Video URLs, Order values, and "Processing" status
      const videosWithFinalVideos = freshVideosData.filter((video) => {
        const finalVideoUrl = extractUrl(video.field_6858); // Final Merged Video URL
        const order = video.field_6902; // Order field
        const status = extractFieldValue(video.field_6864); // Status field
        console.log(
          `Video ${video.id}: field_6858=${video.field_6858}, extracted URL=${finalVideoUrl}, order=${order}, status=${status}`,
        );
        return (
          finalVideoUrl &&
          order !== null &&
          order !== undefined &&
          status === 'Processing'
        );
      });

      console.log(
        `Found ${videosWithFinalVideos.length} videos with final merged videos and "Processing" status`,
      );

      if (videosWithFinalVideos.length === 0) {
        console.log(
          'No videos found with final merged videos and "Processing" status to merge',
        );
        return;
      }

      // Sort videos by Order (field_6902)
      videosWithFinalVideos.sort((a, b) => {
        const orderA = parseInt(String(a.field_6902)) || 0;
        const orderB = parseInt(String(b.field_6902)) || 0;
        console.log(
          `Sorting: Video ${a.id} order=${orderA}, Video ${b.id} order=${orderB}`,
        );
        return orderA - orderB;
      });

      console.log(
        'Sorted videos:',
        videosWithFinalVideos.map((v) => ({
          id: v.id,
          order: v.field_6902,
          url: extractUrl(v.field_6858),
        })),
      );

      // Extract video URLs in order
      const videoUrls = videosWithFinalVideos.map((video) =>
        extractUrl(video.field_6858),
      );

      console.log('Final video URLs to merge:', videoUrls);

      console.log(
        `Merging ${videoUrls.length} final videos in order:`,
        videoUrls,
      );

      // Get the old final merged video URL from localStorage to delete it
      let oldFinalMergedUrl: string | null = null;
      try {
        const existingData = localStorage.getItem('final-video-data');
        if (existingData) {
          const dataObject = JSON.parse(existingData);
          oldFinalMergedUrl = dataObject.finalVideoUrl || null;
          if (oldFinalMergedUrl) {
            console.log(
              `[MERGE] Found old final merged video in localStorage: ${oldFinalMergedUrl}`,
            );
          }
        }
      } catch (error) {
        console.warn(
          'Failed to read old final merged video from localStorage:',
          error,
        );
      }

      // Call the concatenate API with fast mode
      const response = await fetch('/api/concatenate-videos', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          video_urls: videoUrls,
          id: 'final_merged', // Will generate filename: final_merged_video_timestamp.mp4
          fast_mode: true, // Use fast merging without re-encoding
          old_merged_url: oldFinalMergedUrl, // Pass old final merged URL from localStorage to delete it
        }),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Failed to merge final videos');
      }

      const result = await response.json();
      console.log('Final videos merged successfully:', result);

      // Save the merged video URL to global state and local storage (without saving to Baserow)
      const mergedVideoUrl = result.videoUrl || result.url || result.video_url;
      const fileName = `final-merged-videos-${Date.now()}.mp4`;
      console.log('Setting merged video:', mergedVideoUrl, fileName);

      // Set merged video directly in store without triggering Baserow save
      useAppStore.setState({
        mergedVideo: {
          url: mergedVideoUrl,
          createdAt: new Date(),
          fileName: fileName,
        },
      });

      // Also save to localStorage with final-video-data key
      try {
        const existingData = localStorage.getItem('final-video-data');
        let dataObject = {};

        if (existingData) {
          try {
            dataObject = JSON.parse(existingData);
          } catch (parseError) {
            // If parsing fails, start with empty object
            dataObject = {};
          }
        }

        // Update with final video URL
        const updatedData = {
          ...dataObject,
          finalVideoUrl: mergedVideoUrl,
          mergedAt: new Date().toISOString(),
        };

        localStorage.setItem('final-video-data', JSON.stringify(updatedData));

        // Dispatch custom event to notify other components of localStorage update
        window.dispatchEvent(new CustomEvent('localStorageUpdate'));

        console.log('Saved final video URL to localStorage:', mergedVideoUrl);
      } catch (storageError) {
        console.warn(
          'Failed to save final video URL to localStorage:',
          storageError,
        );
      }

      // Verify the state was set
      setTimeout(() => {
        const currentState = useAppStore.getState().mergedVideo;
        console.log('Current mergedVideo state:', currentState);
      }, 100);

      // Play success sound
      playSuccessSound();
    } catch (error) {
      console.error('Error merging final videos:', error);

      // Play error sound
      playErrorSound();

      setError(
        `Failed to merge final videos: ${
          error instanceof Error ? error.message : 'Unknown error'
        }`,
      );
    } finally {
      setMergingFinalVideos(false);
    }
  };

  // Generate Timestamps for Final Videos
  const handleGenerateTimestamps = async () => {
    try {
      setGeneratingTimestamps(true);
      setError(null);

      // Fetch fresh original videos data directly from API
      const freshVideosData = await getOriginalVideosData();

      // Filter videos that have Final Merged Video URLs, Titles, Order values, and "Processing" status
      const videosWithTimestamps = freshVideosData.filter((video) => {
        const finalVideoUrl = extractUrl(video.field_6858); // Final Merged Video URL
        const title = video.field_6852; // Title field
        const order = video.field_6902; // Order field
        const status = extractFieldValue(video.field_6864); // Status field
        return (
          finalVideoUrl &&
          title &&
          order !== null &&
          order !== undefined &&
          status === 'Processing'
        );
      });

      if (videosWithTimestamps.length === 0) {
        console.log(
          'No videos found with final merged videos, titles, order values, and "Processing" status',
        );
        return;
      }

      // Sort videos by Order (field_6902)
      videosWithTimestamps.sort((a, b) => {
        const orderA = parseInt(String(a.field_6902)) || 0;
        const orderB = parseInt(String(b.field_6902)) || 0;
        return orderA - orderB;
      });

      console.log(
        'Generating timestamps for videos:',
        videosWithTimestamps.map((v) => ({
          title: v.field_6852,
          order: v.field_6902,
          url: extractUrl(v.field_6858),
        })),
      );

      // Calculate cumulative timestamps
      let cumulativeSeconds = 0;
      const timestampLines: string[] = [];

      for (const video of videosWithTimestamps) {
        try {
          // Get video duration
          const videoUrl = extractUrl(video.field_6858);
          const response = await fetch('/api/get-video-duration', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({ videoUrl }),
          });

          if (!response.ok) {
            throw new Error('Failed to get video duration');
          }

          const durationData = await response.json();
          const durationSeconds = durationData.duration || 0;

          // Format timestamp
          const timestamp = formatTimestamp(cumulativeSeconds);
          const title = String(video.field_6852);

          timestampLines.push(`${timestamp} - ${title}`);

          // Add duration to cumulative time
          cumulativeSeconds += durationSeconds;
        } catch (durationError) {
          console.warn(
            `Failed to get duration for video ${video.id}, using 0:`,
            durationError,
          );
          // Still add the timestamp with 0 duration
          const timestamp = formatTimestamp(cumulativeSeconds);
          const title = String(video.field_6852);
          timestampLines.push(`${timestamp} - ${title}`);
        }
      }

      // Create final timestamp text
      const timestampText = timestampLines.join('\n');

      // Set timestamp data
      setTimestampData(timestampText);

      // Save to localStorage - preserve existing data
      const existingData = localStorage.getItem('final-video-data');
      let dataObject: Record<string, unknown> = {};

      if (existingData) {
        try {
          dataObject = JSON.parse(existingData);
        } catch (parseError) {
          dataObject = {};
        }
      }

      // Update with timestamp data
      const updatedData = {
        ...dataObject,
        timestamp: timestampText,
        createdAt: new Date().toISOString(),
        videoCount: videosWithTimestamps.length,
      };

      localStorage.setItem('final-video-data', JSON.stringify(updatedData));

      // Dispatch custom event to notify other components of localStorage update
      window.dispatchEvent(new CustomEvent('localStorageUpdate'));

      console.log('Generated timestamps:', timestampText);

      // Play success sound
      playSuccessSound();
    } catch (error) {
      console.error('Error generating timestamps:', error);

      // Play error sound
      playErrorSound();

      setError(
        `Failed to generate timestamps: ${
          error instanceof Error ? error.message : 'Unknown error'
        }`,
      );
    } finally {
      setGeneratingTimestamps(false);
    }
  };

  // Helper function to format seconds into HH:MM:SS or MM:SS
  const formatTimestamp = (seconds: number): string => {
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const secs = Math.floor(seconds % 60);

    if (hours > 0) {
      return `${hours}:${minutes.toString().padStart(2, '0')}:${secs
        .toString()
        .padStart(2, '0')}`;
    } else {
      return `${minutes}:${secs.toString().padStart(2, '0')}`;
    }
  };

  // Generate Clips for all videos
  const handleGenerateClipsAll = async (playSound = true) => {
    try {
      setGeneratingClipsAll(true);
      setError(null);

      // Fetch fresh original videos data directly from API
      const freshVideosData = await getOriginalVideosData();

      // Filter videos that have scenes AND status is "Processing"
      const videosWithScenes = freshVideosData.filter((video) => {
        const status = extractFieldValue(video.field_6864);
        return hasScenes(video) && status === 'Processing';
      });

      if (videosWithScenes.length === 0) {
        console.log('No videos found with scenes to generate clips');
        return;
      }

      console.log(
        `Starting clip generation for ${videosWithScenes.length} videos...`,
      );

      // Process videos one by one
      for (const video of videosWithScenes) {
        console.log(`Generating clips for video ${video.id}...`);

        try {
          await handleGenerateClipsInternal(video.id);
          console.log(`Successfully generated clips for video ${video.id}`);

          // No need to refresh here since we refresh after each scene in handleGenerateClipsInternal

          // Small delay between videos
          await new Promise((resolve) => setTimeout(resolve, 500));
        } catch (error) {
          console.error(
            `Failed to generate clips for video ${video.id}:`,
            error,
          );
          // Continue with next video
        }
      }

      console.log('Batch clip generation completed');

      // Play success sound (if enabled)
      if (playSound) {
        playSuccessSound();
      }
    } catch (error) {
      console.error('Error in batch clip generation:', error);

      // Play error sound
      playErrorSound();

      setError(
        `Failed to generate clips for all videos: ${
          error instanceof Error ? error.message : 'Unknown error'
        }`,
      );
    } finally {
      setGeneratingClipsAll(false);
      clearClipGeneration();
    }
  };

  // Run Full Pipeline: TTS Script -> TTS Video -> Normalize Audio -> CFR -> Silence -> Transcribe All -> Generate Scenes -> Delete Empty -> Gen Clips All -> Speed Up All -> Improve All -> TTS All -> Sync All -> Transcribe Scenes (Processing) -> Prompt Scenes (Processing)
  const handleRunFullPipeline = async () => {
    if (!sceneHandlers) {
      console.log(
        'Scene handlers are not available yet. Please wait a moment and try again.',
      );
      return;
    }

    try {
      setRunningFullPipeline(true);
      setError(null);

      console.log('========================================');
      console.log('Starting Full Pipeline Processing');
      console.log('Pipeline Configuration:', pipelineConfig);
      console.log('========================================');

      let stepNumber = 0;

      // Step 1: TTS Script (Processing only, from video Script)
      if (pipelineConfig.ttsScript) {
        stepNumber++;
        setPipelineStep(
          `Step ${stepNumber}: Generating TTS from scripts for Processing videos...`,
        );
        console.log(
          `Step ${stepNumber}: Generating TTS from scripts for Processing videos`,
        );
        try {
          await handleGenerateTtsFromScripts(false, false);
          console.log(
            `✓ Step ${stepNumber} Complete: Script TTS generation finished`,
          );

          console.log('Refreshing data after script TTS generation...');
          await handleRefresh();
          console.log('Data refreshed successfully');

          console.log('Waiting 20 seconds before next step...');
          await new Promise((resolve) => setTimeout(resolve, 20000));
          console.log('Wait complete, proceeding to next step');
        } catch (error) {
          console.error(
            `✗ Step ${stepNumber} Failed: Script TTS generation error`,
            error,
          );
          throw new Error(
            `Script TTS generation failed: ${
              error instanceof Error ? error.message : 'Unknown error'
            }`,
          );
        }
      } else {
        console.log('⊘ Skipping Step: TTS Script (disabled in config)');
      }

      // Step: TTS Video (Processing only, from video TTS Audio)
      if (pipelineConfig.ttsVideo) {
        stepNumber++;
        setPipelineStep(
          `Step ${stepNumber}: Generating videos from TTS audio for Processing videos...`,
        );
        console.log(
          `Step ${stepNumber}: Generating videos from TTS audio for Processing videos`,
        );
        try {
          await handleGenerateVideoFromTtsAudioAll(false, false);
          console.log(
            `✓ Step ${stepNumber} Complete: TTS audio → video generation finished`,
          );

          console.log('Refreshing data after TTS video generation...');
          await handleRefresh();
          console.log('Data refreshed successfully');

          console.log('Waiting 20 seconds before next step...');
          await new Promise((resolve) => setTimeout(resolve, 20000));
          console.log('Wait complete, proceeding to next step');
        } catch (error) {
          console.error(
            `✗ Step ${stepNumber} Failed: TTS video generation error`,
            error,
          );
          throw new Error(
            `TTS video generation failed: ${
              error instanceof Error ? error.message : 'Unknown error'
            }`,
          );
        }
      } else {
        console.log('⊘ Skipping Step: TTS Video (disabled in config)');
      }

      // Step: Normalize Audio All
      if (pipelineConfig.normalizeAudio) {
        stepNumber++;
        setPipelineStep(
          `Step ${stepNumber}: Normalizing audio for all videos...`,
        );
        console.log(`Step ${stepNumber}: Normalizing audio for all videos`);
        try {
          await handleNormalizeAudioAll(false);
          console.log(
            `✓ Step ${stepNumber} Complete: Audio normalization finished`,
          );

          // Refresh data to get updated videos
          console.log('Refreshing data after audio normalization...');
          await handleRefresh();
          console.log('Data refreshed successfully');

          // Wait 20 seconds before next step
          console.log('Waiting 20 seconds before next step...');
          await new Promise((resolve) => setTimeout(resolve, 20000));
          console.log('Wait complete, proceeding to next step');
        } catch (error) {
          console.error(
            `✗ Step ${stepNumber} Failed: Audio normalization error`,
            error,
          );
          throw new Error(
            `Audio normalization failed: ${
              error instanceof Error ? error.message : 'Unknown error'
            }`,
          );
        }
      } else {
        console.log('⊘ Skipping Step: Normalize Audio (disabled in config)');
      }

      // Step 2: Convert to CFR All
      if (pipelineConfig.convertToCFR) {
        stepNumber++;
        setPipelineStep(`Step ${stepNumber}: Converting all videos to CFR...`);
        console.log(`Step ${stepNumber}: Converting all videos to CFR`);
        try {
          await handleConvertToCFRAll(false);
          console.log(`✓ Step ${stepNumber} Complete: CFR conversion finished`);

          // Refresh data to get updated videos
          console.log('Refreshing data after CFR conversion...');
          await handleRefresh();
          console.log('Data refreshed successfully');

          // Wait 20 seconds before next step
          console.log('Waiting 20 seconds before next step...');
          await new Promise((resolve) => setTimeout(resolve, 20000));
          console.log('Wait complete, proceeding to next step');
        } catch (error) {
          console.error(
            `✗ Step ${stepNumber} Failed: CFR conversion error`,
            error,
          );
          throw new Error(
            `CFR conversion failed: ${
              error instanceof Error ? error.message : 'Unknown error'
            }`,
          );
        }
      } else {
        console.log('⊘ Skipping Step: Convert to CFR (disabled in config)');
      }

      // Step 3: Optimize Silence All
      if (pipelineConfig.optimizeSilence) {
        stepNumber++;
        setPipelineStep(
          `Step ${stepNumber}: Optimizing silence for all videos...`,
        );
        console.log(`Step ${stepNumber}: Optimizing silence for all videos`);
        try {
          await handleOptimizeSilenceAll(false);
          console.log(
            `✓ Step ${stepNumber} Complete: Silence optimization finished`,
          );

          // Refresh data to get updated videos
          console.log('Refreshing data after silence optimization...');
          await handleRefresh();
          console.log('Data refreshed successfully');

          // Wait 20 seconds before next step
          console.log('Waiting 20 seconds before next step...');
          await new Promise((resolve) => setTimeout(resolve, 20000));
          console.log('Wait complete, proceeding to next step');
        } catch (error) {
          console.error(
            `✗ Step ${stepNumber} Failed: Silence optimization error`,
            error,
          );
          throw new Error(
            `Silence optimization failed: ${
              error instanceof Error ? error.message : 'Unknown error'
            }`,
          );
        }
      } else {
        console.log('⊘ Skipping Step: Optimize Silence (disabled in config)');
      }

      // Step 4: Transcribe All
      if (pipelineConfig.transcribe) {
        stepNumber++;
        setPipelineStep(`Step ${stepNumber}: Transcribing all videos...`);
        console.log(`Step ${stepNumber}: Transcribing all videos`);
        try {
          await handleTranscribeAll(false);
          console.log(`✓ Step ${stepNumber} Complete: Transcription finished`);

          // Refresh data to get updated captions URLs
          console.log('Refreshing data after transcription...');
          await handleRefresh();
          if (refreshScenesData) {
            refreshScenesData();
          }
          console.log('Data refreshed successfully');

          // Wait 20 seconds before next step
          console.log('Waiting 20 seconds before next step...');
          await new Promise((resolve) => setTimeout(resolve, 20000));
          console.log('Wait complete, proceeding to next step');
        } catch (error) {
          console.error(
            `✗ Step ${stepNumber} Failed: Transcription error`,
            error,
          );
          throw new Error(
            `Transcription failed: ${
              error instanceof Error ? error.message : 'Unknown error'
            }`,
          );
        }
      } else {
        console.log('⊘ Skipping Step: Transcribe (disabled in config)');
      }

      // Step 2: Generate Scenes
      if (pipelineConfig.generateScenes) {
        stepNumber++;
        setPipelineStep(
          `Step ${stepNumber}: Generating scenes for all videos...`,
        );
        console.log(`Step ${stepNumber}: Generating scenes for all videos`);
        try {
          await handleGenerateScenesAll(false);
          console.log(
            `✓ Step ${stepNumber} Complete: Scene generation finished`,
          );

          // Refresh data to get updated scenes
          console.log('Refreshing data after scene generation...');
          await handleRefresh();
          if (refreshScenesData) {
            refreshScenesData();
          }
          console.log('Data refreshed successfully');

          // Wait 20 seconds before next step
          console.log('Waiting 20 seconds before next step...');
          await new Promise((resolve) => setTimeout(resolve, 20000));
          console.log('Wait complete, proceeding to next step');
        } catch (error) {
          console.error(
            `✗ Step ${stepNumber} Failed: Scene generation error`,
            error,
          );
          throw new Error(
            `Scene generation failed: ${
              error instanceof Error ? error.message : 'Unknown error'
            }`,
          );
        }
      } else {
        console.log('⊘ Skipping Step: Generate Scenes (disabled in config)');
      }

      // Step: Delete Empty (Processing only)
      if (pipelineConfig.deleteEmpty) {
        stepNumber++;
        setPipelineStep(
          `Step ${stepNumber}: Deleting empty scenes for Processing videos...`,
        );
        console.log(
          `Step ${stepNumber}: Deleting empty scenes for Processing videos`,
        );
        try {
          await handleDeleteEmptyScenesAllVideos(false);
          console.log(
            `✓ Step ${stepNumber} Complete: Empty scenes deletion finished`,
          );

          console.log('Refreshing data after deleting empty scenes...');
          await handleRefresh();
          if (refreshScenesData) {
            refreshScenesData();
          }
          console.log('Data refreshed successfully');

          console.log('Waiting 20 seconds before next step...');
          await new Promise((resolve) => setTimeout(resolve, 20000));
          console.log('Wait complete, proceeding to next step');
        } catch (error) {
          console.error(
            `✗ Step ${stepNumber} Failed: Delete empty scenes error`,
            error,
          );
          throw new Error(
            `Delete empty scenes failed: ${
              error instanceof Error ? error.message : 'Unknown error'
            }`,
          );
        }
      } else {
        console.log('⊘ Skipping Step: Delete Empty (disabled in config)');
      }

      // Step 3: Generate Clips All
      if (pipelineConfig.generateClips) {
        stepNumber++;
        setPipelineStep(
          `Step ${stepNumber}: Generating clips for all videos...`,
        );
        console.log(`Step ${stepNumber}: Generating clips for all videos`);
        try {
          await handleGenerateClipsAll(false);
          console.log(
            `✓ Step ${stepNumber} Complete: Clip generation finished`,
          );

          // Refresh data to get updated clips
          console.log('Refreshing data after clip generation...');
          await handleRefresh();
          if (refreshScenesData) {
            refreshScenesData();
          }
          console.log('Data refreshed successfully');

          // Wait 20 seconds before next step
          console.log('Waiting 20 seconds before next step...');
          await new Promise((resolve) => setTimeout(resolve, 20000));
          console.log('Wait complete, proceeding to next step');
        } catch (error) {
          console.error(
            `✗ Step ${stepNumber} Failed: Clip generation error`,
            error,
          );
          throw new Error(
            `Clip generation failed: ${
              error instanceof Error ? error.message : 'Unknown error'
            }`,
          );
        }
      } else {
        console.log('⊘ Skipping Step: Generate Clips (disabled in config)');
      }

      // Step 4: Speed Up All
      if (pipelineConfig.speedUp) {
        stepNumber++;
        setPipelineStep(`Step ${stepNumber}: Speeding up all videos...`);
        console.log(`Step ${stepNumber}: Speeding up all videos`);
        try {
          await handleSpeedUpAllVideos(false);
          console.log(`✓ Step ${stepNumber} Complete: Speed up finished`);

          // Refresh data to get updated sped up videos
          console.log('Refreshing data after speed up...');
          await handleRefresh();
          if (refreshScenesData) {
            refreshScenesData();
          }
          console.log('Data refreshed successfully');

          // Wait 20 seconds before next step
          console.log('Waiting 20 seconds before next step...');
          await new Promise((resolve) => setTimeout(resolve, 20000));
          console.log('Wait complete, proceeding to next step');
        } catch (error) {
          console.error(`✗ Step ${stepNumber} Failed: Speed up error`, error);
          throw new Error(
            `Speed up failed: ${
              error instanceof Error ? error.message : 'Unknown error'
            }`,
          );
        }
      } else {
        console.log('⊘ Skipping Step: Speed Up (disabled in config)');
      }

      // Step 5: Improve All
      if (pipelineConfig.improve) {
        stepNumber++;
        setPipelineStep(`Step ${stepNumber}: Improving all scenes...`);
        console.log(`Step ${stepNumber}: Improving all scenes`);
        try {
          await handleImproveAllVideosScenes(false);
          console.log(`✓ Step ${stepNumber} Complete: AI improvement finished`);

          // Refresh data to get updated improved sentences
          console.log('Refreshing data after AI improvement...');
          await handleRefresh();
          if (refreshScenesData) {
            refreshScenesData();
          }
          console.log('Data refreshed successfully');

          // Wait 20 seconds before next step
          console.log('Waiting 20 seconds before next step...');
          await new Promise((resolve) => setTimeout(resolve, 20000));
          console.log('Wait complete, proceeding to next step');
        } catch (error) {
          console.error(
            `✗ Step ${stepNumber} Failed: AI improvement error`,
            error,
          );
          throw new Error(
            `AI improvement failed: ${
              error instanceof Error ? error.message : 'Unknown error'
            }`,
          );
        }
      } else {
        console.log('⊘ Skipping Step: Improve (disabled in config)');
      }

      // Step 6: TTS All
      if (pipelineConfig.generateTTS) {
        stepNumber++;
        setPipelineStep(`Step ${stepNumber}: Generating TTS for all scenes...`);
        console.log(`Step ${stepNumber}: Generating TTS for all scenes`);
        try {
          await handleGenerateAllTTSForAllVideos(false);
          console.log(`✓ Step ${stepNumber} Complete: TTS generation finished`);

          // Refresh data to get updated TTS audio
          console.log('Refreshing data after TTS generation...');
          await handleRefresh();
          if (refreshScenesData) {
            refreshScenesData();
          }
          console.log('Data refreshed successfully');

          // Wait 20 seconds before next step
          console.log('Waiting 20 seconds before next step...');
          await new Promise((resolve) => setTimeout(resolve, 20000));
          console.log('Wait complete, proceeding to next step');
        } catch (error) {
          console.error(
            `✗ Step ${stepNumber} Failed: TTS generation error`,
            error,
          );
          throw new Error(
            `TTS generation failed: ${
              error instanceof Error ? error.message : 'Unknown error'
            }`,
          );
        }
      } else {
        console.log('⊘ Skipping Step: Generate TTS (disabled in config)');
      }

      // Step 7: Sync All
      if (pipelineConfig.sync) {
        stepNumber++;
        setPipelineStep(`Step ${stepNumber}: Syncing all videos...`);
        console.log(`Step ${stepNumber}: Syncing all videos`);
        try {
          await handleGenerateAllVideosForAllScenes(false);
          console.log(`✓ Step ${stepNumber} Complete: Video sync finished`);

          // Refresh data to get updated synced videos
          console.log('Refreshing data after video sync...');
          await handleRefresh();
          if (refreshScenesData) {
            refreshScenesData();
          }
          console.log('Data refreshed successfully');
        } catch (error) {
          console.error(`✗ Step ${stepNumber} Failed: Video sync error`, error);
          throw new Error(
            `Video sync failed: ${
              error instanceof Error ? error.message : 'Unknown error'
            }`,
          );
        }
      } else {
        console.log('⊘ Skipping Step: Sync (disabled in config)');
      }

      // Step 8: Transcribe Scenes (Processing only, after Sync)
      if (pipelineConfig.transcribeScenesAfterSync) {
        stepNumber++;
        setPipelineStep(
          `Step ${stepNumber}: Transcribing scenes for Processing videos...`,
        );
        console.log(
          `Step ${stepNumber}: Transcribing scenes for Processing videos`,
        );
        try {
          await handleTranscribeProcessingScenesAllVideos(false);
          console.log(
            `✓ Step ${stepNumber} Complete: Scene transcription finished`,
          );

          console.log('Refreshing data after scene transcription...');
          await handleRefresh();
          if (refreshScenesData) {
            refreshScenesData();
          }
          console.log('Data refreshed successfully');
        } catch (error) {
          console.error(
            `✗ Step ${stepNumber} Failed: Scene transcription error`,
            error,
          );
          throw new Error(
            `Scene transcription failed: ${
              error instanceof Error ? error.message : 'Unknown error'
            }`,
          );
        }
      } else {
        console.log(
          '⊘ Skipping Step: Transcribe Scenes After Sync (disabled in config)',
        );
      }

      // Step 9: Prompt Scenes (Processing only, after Transcribe Scenes)
      if (pipelineConfig.promptScenesAfterTranscribe) {
        stepNumber++;
        setPipelineStep(
          `Step ${stepNumber}: Prompting scenes for Processing videos...`,
        );
        console.log(
          `Step ${stepNumber}: Prompting scenes for Processing videos`,
        );

        try {
          await handlePromptProcessingScenesAllVideos(false);
          console.log(
            `✓ Step ${stepNumber} Complete: Scene prompting finished`,
          );

          console.log('Refreshing data after scene prompting...');
          await handleRefresh();
          if (refreshScenesData) {
            refreshScenesData();
          }
          console.log('Data refreshed successfully');
        } catch (error) {
          console.error(
            `✗ Step ${stepNumber} Failed: Scene prompting error`,
            error,
          );
          throw new Error(
            `Scene prompting failed: ${
              error instanceof Error ? error.message : 'Unknown error'
            }`,
          );
        }
      } else {
        console.log('⊘ Skipping Step: Prompt Scenes (disabled in config)');
      }

      console.log('========================================');
      console.log('✓ Full Pipeline Complete!');
      console.log(`Total steps executed: ${stepNumber}`);
      console.log('========================================');

      // Send Telegram notification for successful completion
      await sendTelegramNotification(
        `🎉 Full Pipeline Complete! Successfully executed ${stepNumber} processing steps.`,
      );

      // Final refresh
      await handleRefresh();
      if (refreshScenesData) {
        refreshScenesData();
      }

      // Play success sound
      playSuccessSound();

      setPipelineStep('Pipeline completed successfully!');

      // Clear pipeline step after 3 seconds
      setTimeout(() => {
        setPipelineStep('');
      }, 3000);
    } catch (error) {
      console.error('========================================');
      console.error('✗ Full Pipeline Failed');
      console.error('========================================');
      console.error('Pipeline error:', error);

      // Play error sound
      playErrorSound();

      setError(
        `Full pipeline failed: ${
          error instanceof Error ? error.message : 'Unknown error'
        }`,
      );

      setPipelineStep('');
    } finally {
      setRunningFullPipeline(false);
    }
  };

  // Internal clip generation function (without UI state management)
  const handleGenerateClipsInternal = async (videoId: number) => {
    setGeneratingClipsGlobal(videoId);
    setClipsProgressGlobal({ current: 0, total: 1, percentage: 0 });

    const response = await fetch('/api/generate-clips', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        videoId,
      }),
    });

    if (!response.ok) {
      throw new Error('Failed to start clip generation');
    }

    const reader = response.body?.getReader();
    const decoder = new TextDecoder();

    if (!reader) {
      throw new Error('No response body available');
    }

    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();

      if (done) break;

      buffer += decoder.decode(value, { stream: true });

      // Process complete lines
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        if (line.startsWith('data: ')) {
          try {
            const data = JSON.parse(line.substring(6));

            if (data.progress) {
              setClipsProgressGlobal({
                current: data.progress.current,
                total: data.progress.total,
                percentage: data.progress.percentage,
              });
            }

            // Refresh data only when a scene is completed (not on every progress update)
            if (data.type === 'scene_complete') {
              console.log(
                `Scene ${data.sceneNumber}/${data.total} completed, refreshing data...`,
              );

              // Refresh both original videos and scenes data after each scene completes
              await handleRefresh();
              if (refreshScenesData) {
                refreshScenesData();
              }

              // Small delay to ensure UI updates
              await new Promise((resolve) => setTimeout(resolve, 300));
            }

            if (data.error) {
              throw new Error(data.error);
            }

            if (data.completed) {
              console.log('Clip generation completed for video:', videoId);
            }
          } catch (parseError) {
            console.warn('Failed to parse SSE data:', line);
          }
        }
      }
    }
  };

  // Generate Clips for video
  const handleGenerateClips = async (videoId: number) => {
    try {
      setGeneratingClipsGlobal(videoId);
      setClipsProgressGlobal({ current: 0, total: 1, percentage: 0 });
      setError(null);

      console.log('Generating clips for video:', videoId);

      // Use EventSource for Server-Sent Events
      const eventSource = new EventSource('/api/generate-clips', {
        // Note: EventSource doesn't support POST directly, so we need to use a different approach
      });

      // Alternative: Use fetch with streaming
      const response = await fetch('/api/generate-clips', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          videoId,
        }),
      });

      if (!response.ok) {
        throw new Error('Failed to start clip generation');
      }

      const reader = response.body?.getReader();
      const decoder = new TextDecoder();

      if (!reader) {
        throw new Error('No response body available');
      }

      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();

        if (done) break;

        buffer += decoder.decode(value, { stream: true });

        // Process complete lines
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (line.startsWith('data: ')) {
            try {
              const data = JSON.parse(line.slice(6));

              switch (data.type) {
                case 'progress':
                  setClipsProgressGlobal({
                    current: data.current,
                    total: data.total,
                    percentage: data.percentage,
                  });
                  break;

                case 'scene_complete':
                  setClipsProgressGlobal({
                    current: data.current,
                    total: data.total,
                    percentage: data.percentage,
                  });
                  break;

                case 'scene_error':
                  console.error(
                    `Scene ${data.sceneNumber} failed:`,
                    data.error,
                  );
                  setClipsProgressGlobal({
                    current: data.current,
                    total: data.total,
                    percentage: data.percentage,
                  });
                  break;

                case 'complete':
                  console.log('Clips generation completed:', data);
                  setClipsProgressGlobal({
                    current: data.processedScenes,
                    total: data.totalScenes,
                    percentage: 100,
                  });

                  // Play success sound for batch completion
                  playSuccessSound();

                  // Refresh the data to show any changes
                  await handleRefresh();
                  break;

                case 'error':
                  throw new Error(data.error);
              }
            } catch (parseError) {
              console.error('Error parsing SSE data:', parseError);
            }
          }
        }
      }
    } catch (error) {
      console.error('Error generating clips:', error);

      // Play error sound for batch failure
      playErrorSound();

      setError(
        `Failed to generate clips: ${
          error instanceof Error ? error.message : 'Unknown error'
        }`,
      );
    } finally {
      // Small delay to show completion before clearing
      setTimeout(() => {
        clearClipGeneration();
      }, 2000);
    }
  };

  if (loading) {
    return (
      <div className='bg-white rounded-xl shadow-lg border border-gray-200 p-6 mb-8'>
        <div className='flex items-center justify-center py-8'>
          <Loader2 className='w-6 h-6 animate-spin text-blue-500 mr-2' />
          <span className='text-gray-600'>Loading original videos...</span>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className='bg-white rounded-xl shadow-lg border border-gray-200 p-6 mb-8'>
        <div className='flex items-center justify-between'>
          <div className='flex items-center text-red-600'>
            <AlertCircle className='w-5 h-5 mr-2' />
            <span>Error loading original videos: {error}</span>
          </div>
          <button
            onClick={handleRefresh}
            className='px-4 py-2 bg-red-500 hover:bg-red-600 text-white rounded-lg transition-colors truncate'
          >
            Retry
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className='bg-white rounded-xl shadow-lg border border-gray-200 p-6 mb-8'>
      {/* Header - Clickable to expand/collapse */}
      <button
        onClick={() => setIsExpanded(!isExpanded)}
        className='w-full mb-6 flex items-center justify-between hover:bg-gray-50 -m-6 p-6 rounded-t-xl transition-colors'
      >
        <div className='flex items-center gap-2'>
          <Video className='w-6 h-6 text-blue-500' />
          <div className='text-left'>
            <h2 className='text-2xl font-bold text-gray-900'>
              Original Videos
            </h2>
            <p className='text-gray-600 mt-1'>
              {originalVideos.length} video
              {originalVideos.length !== 1 ? 's' : ''} in library
            </p>
          </div>
        </div>
        <div className='flex items-center gap-3'>
          <span className='text-xs text-gray-400'>
            {isExpanded ? 'Click to collapse' : 'Click to expand'}
          </span>
          <svg
            className={`w-5 h-5 text-gray-400 transition-transform ${
              isExpanded ? 'rotate-180' : ''
            }`}
            fill='none'
            stroke='currentColor'
            viewBox='0 0 24 24'
          >
            <path
              strokeLinecap='round'
              strokeLinejoin='round'
              strokeWidth={2}
              d='M19 9l-7 7-7-7'
            />
          </svg>
        </div>
      </button>

      {/* Collapsible Content */}
      {isExpanded && (
        <div>
          {/* Pipeline Configuration */}
          <div className='mb-6'>
            <PipelineConfig />
          </div>

          {/* Batch Operations - Collapsible */}
          <div className='bg-gray-50 rounded-lg border border-gray-200 overflow-hidden mb-6'>
            {/* Batch Operations Header */}
            <button
              onClick={() =>
                setIsBatchOperationsExpanded(!isBatchOperationsExpanded)
              }
              className='w-full px-4 py-3 flex items-center justify-between hover:bg-gray-100 transition-colors'
            >
              <div className='flex items-center gap-2'>
                <Zap className='w-4 h-4 text-orange-600' />
                <h3 className='text-sm font-semibold text-gray-900'>
                  Batch Operations
                </h3>
                <span className='text-xs text-gray-500'>({13} actions)</span>
              </div>
              <div className='flex items-center gap-2'>
                <span className='text-xs text-gray-400'>
                  {isBatchOperationsExpanded ? 'Collapse' : 'Expand'}
                </span>
                <svg
                  className={`w-4 h-4 text-gray-400 transition-transform ${
                    isBatchOperationsExpanded ? 'rotate-180' : ''
                  }`}
                  fill='none'
                  stroke='currentColor'
                  viewBox='0 0 24 24'
                >
                  <path
                    strokeLinecap='round'
                    strokeLinejoin='round'
                    strokeWidth={2}
                    d='M19 9l-7 7-7-7'
                  />
                </svg>
              </div>
            </button>

            {/* Collapsible Batch Operations Content */}
            {isBatchOperationsExpanded && (
              <div className='p-4 bg-white'>
                {/* Action Buttons - Full Width Grid Layout */}
                <div className='w-full'>
                  <div
                    className='grid gap-2'
                    style={{
                      gridTemplateColumns:
                        'repeat(auto-fit, minmax(140px, 1fr))',
                    }}
                  >
                    {/* Upload Button */}
                    <button
                      onClick={openFileDialog}
                      disabled={uploading}
                      className={`w-full inline-flex items-center justify-center gap-2 px-3 py-2 truncate ${
                        uploading
                          ? 'bg-gray-400 cursor-not-allowed'
                          : 'bg-green-500 hover:bg-green-600'
                      } text-white text-sm font-medium rounded-md transition-all shadow-sm hover:shadow disabled:cursor-not-allowed min-h-[40px] cursor-pointer`}
                      title={
                        uploading
                          ? `Uploading... ${uploadProgress}%`
                          : 'Upload a new video'
                      }
                    >
                      {uploading ? (
                        <>
                          <Loader2 className='w-4 h-4 animate-spin' />
                          <span className='truncate'>
                            Uploading... {uploadProgress}%
                          </span>
                        </>
                      ) : (
                        <>
                          <Upload className='w-4 h-4' />
                          <span>Upload</span>
                        </>
                      )}
                    </button>

                    {/* Upload Script Button */}
                    <button
                      onClick={openScriptUploadModal}
                      disabled={uploading || creatingVideoFromScript}
                      className={`w-full inline-flex items-center justify-center gap-2 px-3 py-2 truncate ${
                        uploading || creatingVideoFromScript
                          ? 'bg-gray-400 cursor-not-allowed'
                          : 'bg-green-500 hover:bg-green-600'
                      } text-white text-sm font-medium rounded-md transition-all shadow-sm hover:shadow disabled:cursor-not-allowed min-h-[40px] cursor-pointer`}
                      title='Create a new video row from a script'
                    >
                      {creatingVideoFromScript ? (
                        <>
                          <Loader2 className='w-4 h-4 animate-spin' />
                          <span className='truncate'>Creating...</span>
                        </>
                      ) : (
                        <>
                          <FileText className='w-4 h-4' />
                          <span>Upload Script</span>
                        </>
                      )}
                    </button>

                    {/* TTS Script Button */}
                    <button
                      onClick={() => void handleGenerateTtsFromScripts()}
                      disabled={
                        uploading ||
                        creatingVideoFromScript ||
                        generatingTtsFromScripts
                      }
                      className={`w-full inline-flex items-center justify-center gap-2 px-3 py-2 truncate ${
                        uploading ||
                        creatingVideoFromScript ||
                        generatingTtsFromScripts
                          ? 'bg-gray-400 cursor-not-allowed'
                          : 'bg-green-500 hover:bg-green-600'
                      } text-white text-sm font-medium rounded-md transition-all shadow-sm hover:shadow disabled:cursor-not-allowed min-h-[40px] cursor-pointer`}
                      title='Generate TTS audio from Script for Processing videos'
                    >
                      {generatingTtsFromScripts ? (
                        <>
                          <Loader2 className='w-4 h-4 animate-spin' />
                          <span className='truncate'>Generating...</span>
                        </>
                      ) : (
                        <>
                          <Volume2 className='w-4 h-4' />
                          <span>TTS Script</span>
                        </>
                      )}
                    </button>

                    {/* TTS → Video Button */}
                    <button
                      onClick={() => void handleGenerateVideoFromTtsAudioAll()}
                      disabled={
                        uploading ||
                        creatingVideoFromScript ||
                        generatingTtsFromScripts ||
                        generatingVideoFromTtsAudioAll ||
                        generatingVideoFromTtsAudioForVideo !== null
                      }
                      className={`w-full inline-flex items-center justify-center gap-2 px-3 py-2 truncate ${
                        uploading ||
                        creatingVideoFromScript ||
                        generatingTtsFromScripts ||
                        generatingVideoFromTtsAudioAll ||
                        generatingVideoFromTtsAudioForVideo !== null
                          ? 'bg-gray-400 cursor-not-allowed'
                          : 'bg-green-500 hover:bg-green-600'
                      } text-white text-sm font-medium rounded-md transition-all shadow-sm hover:shadow disabled:cursor-not-allowed min-h-[40px] cursor-pointer`}
                      title='Generate video from TTS audio for Processing videos (skips ones with video URL)'
                    >
                      {generatingVideoFromTtsAudioAll ? (
                        <>
                          <Loader2 className='w-4 h-4 animate-spin' />
                          <span className='truncate'>Generating...</span>
                        </>
                      ) : (
                        <>
                          <Film className='w-4 h-4' />
                          <span>TTS Video</span>
                        </>
                      )}
                    </button>

                    <input
                      ref={fileInputRef}
                      type='file'
                      accept='video/*'
                      onChange={handleFileSelect}
                      className='hidden'
                    />

                    {isScriptUploadModalOpen && (
                      <div className='fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4'>
                        <div className='w-full max-w-2xl rounded-lg bg-white shadow-lg border border-gray-200'>
                          <div className='px-4 py-3 border-b border-gray-200 flex items-center justify-between'>
                            <h3 className='text-sm font-semibold text-gray-900'>
                              Upload Script
                            </h3>
                            <button
                              onClick={closeScriptUploadModal}
                              disabled={creatingVideoFromScript}
                              className='text-gray-500 hover:text-gray-700 disabled:text-gray-300'
                              title='Close'
                            >
                              <X className='w-4 h-4' />
                            </button>
                          </div>

                          <div className='p-4'>
                            <textarea
                              value={scriptUploadText}
                              onChange={(e) =>
                                setScriptUploadText(e.target.value)
                              }
                              placeholder='Paste your script here...'
                              className='w-full min-h-[200px] rounded-md border border-gray-300 p-3 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-purple-500'
                            />
                          </div>

                          <div className='px-4 py-3 border-t border-gray-200 flex items-center justify-end gap-2'>
                            <button
                              onClick={closeScriptUploadModal}
                              disabled={creatingVideoFromScript}
                              className='px-3 py-2 text-sm font-medium rounded-md border border-gray-300 text-gray-700 hover:bg-gray-50 disabled:text-gray-300 disabled:border-gray-200'
                            >
                              Cancel
                            </button>
                            <button
                              onClick={handleCreateVideoFromScript}
                              disabled={
                                creatingVideoFromScript ||
                                scriptUploadText.trim().length === 0
                              }
                              className='px-3 py-2 text-sm font-medium rounded-md bg-purple-600 hover:bg-purple-700 disabled:bg-purple-300 text-white'
                            >
                              {creatingVideoFromScript
                                ? 'Creating...'
                                : 'Create Video'}
                            </button>
                          </div>
                        </div>
                      </div>
                    )}

                    {/* Primary Actions */}
                    {/* Refresh Button */}
                    <button
                      onClick={handleRefresh}
                      disabled={refreshing || uploading || reordering}
                      className='w-full inline-flex items-center justify-center gap-2 px-3 py-2 truncate bg-blue-500 hover:bg-blue-600 disabled:bg-blue-300 text-white text-sm font-medium rounded-md transition-all shadow-sm hover:shadow disabled:cursor-not-allowed min-h-[40px] cursor-pointer'
                      title='Refresh the videos list'
                    >
                      <RefreshCw
                        className={`w-4 h-4 ${
                          refreshing || reordering ? 'animate-spin' : ''
                        }`}
                      />
                      <span>
                        {reordering
                          ? 'Reordering...'
                          : refreshing
                            ? 'Refreshing...'
                            : 'Refresh'}
                      </span>
                    </button>

                    {/* Transcribe All Button */}
                    <button
                      onClick={() => handleTranscribeAll()}
                      disabled={
                        transcribing !== null ||
                        transcribingAll ||
                        uploading ||
                        reordering
                      }
                      className='w-full inline-flex items-center justify-center gap-2 px-3 py-2 truncate bg-purple-500 hover:bg-purple-600 disabled:bg-purple-300 text-white text-sm font-medium rounded-md transition-all shadow-sm hover:shadow disabled:cursor-not-allowed min-h-[40px] cursor-pointer'
                      title={
                        transcribing !== null || transcribingAll
                          ? 'Transcription in progress...'
                          : 'Transcribe all videos without captions'
                      }
                    >
                      <Subtitles
                        className={`w-4 h-4 ${
                          transcribingAll ? 'animate-pulse' : ''
                        }`}
                      />
                      <span>
                        {transcribingAll
                          ? transcribing !== null
                            ? `#${transcribing}...`
                            : 'Processing...'
                          : 'Transcribe All'}
                      </span>
                    </button>

                    {/* Generate All Scenes Button */}
                    <button
                      onClick={() => handleGenerateScenesAll()}
                      disabled={
                        generatingScenes !== null ||
                        generatingScenesAll ||
                        uploading ||
                        reordering
                      }
                      className='w-full inline-flex items-center justify-center gap-2 px-3 py-2 truncate bg-green-500 hover:bg-green-600 disabled:bg-green-300 text-white text-sm font-medium rounded-md transition-all shadow-sm hover:shadow disabled:cursor-not-allowed min-h-[40px] cursor-pointer'
                      title={
                        generatingScenes !== null || generatingScenesAll
                          ? 'Scene generation in progress...'
                          : 'Generate scenes for all videos with captions or script'
                      }
                    >
                      <Grid3x3
                        className={`w-4 h-4 ${
                          generatingScenesAll ? 'animate-pulse' : ''
                        }`}
                      />
                      <span>
                        {generatingScenesAll
                          ? generatingScenes !== null
                            ? `#${generatingScenes}...`
                            : 'Processing...'
                          : 'Generate Scenes'}
                      </span>
                    </button>

                    {/* Processing Actions */}
                    {/* Improve All Videos Button */}
                    <button
                      onClick={() => handleImproveAllVideosScenes()}
                      disabled={
                        improvingAllVideosScenes ||
                        sceneLoading.improvingSentence !== null ||
                        !sceneHandlers ||
                        uploading ||
                        reordering
                      }
                      className='w-full inline-flex items-center justify-center gap-2 px-3 py-2 truncate bg-indigo-500 hover:bg-indigo-600 disabled:bg-indigo-300 text-white text-sm font-medium rounded-md transition-all shadow-sm hover:shadow disabled:cursor-not-allowed min-h-[40px] cursor-pointer'
                      title={
                        !sceneHandlers
                          ? 'Scene handlers not ready. Please wait...'
                          : improvingAllVideosScenes
                            ? 'Improving all scenes for all videos...'
                            : 'Improve all scenes for all videos with AI'
                      }
                    >
                      <Sparkles
                        className={`w-4 h-4 ${
                          improvingAllVideosScenes ? 'animate-pulse' : ''
                        }`}
                      />
                      <span>
                        {improvingAllVideosScenes
                          ? currentProcessingVideoId !== null
                            ? `V${currentProcessingVideoId}`
                            : sceneLoading.improvingSentence !== null
                              ? `S${sceneLoading.improvingSentence}`
                              : 'Processing...'
                          : 'Improve All'}
                      </span>
                    </button>

                    {/* Generate TTS All Videos Button */}
                    <button
                      onClick={() => handleGenerateAllTTSForAllVideos()}
                      disabled={
                        generatingAllTTSForAllVideos ||
                        sceneLoading.producingTTS !== null ||
                        !sceneHandlers ||
                        uploading ||
                        reordering
                      }
                      className='w-full inline-flex items-center justify-center gap-2 px-3 py-2 truncate bg-purple-500 hover:bg-purple-600 disabled:bg-purple-300 text-white text-sm font-medium rounded-md transition-all shadow-sm hover:shadow disabled:cursor-not-allowed min-h-[40px] cursor-pointer'
                      title={
                        !sceneHandlers
                          ? 'Scene handlers not ready. Please wait...'
                          : generatingAllTTSForAllVideos
                            ? 'Generating TTS for all scenes in all videos...'
                            : 'Generate TTS for all scenes in all videos'
                      }
                    >
                      <Mic2
                        className={`w-4 h-4 ${
                          generatingAllTTSForAllVideos ? 'animate-pulse' : ''
                        }`}
                      />
                      <span>
                        {generatingAllTTSForAllVideos
                          ? currentProcessingVideoId !== null
                            ? `V${currentProcessingVideoId}`
                            : sceneLoading.producingTTS !== null
                              ? `S${sceneLoading.producingTTS}`
                              : 'Processing...'
                          : 'TTS All'}
                      </span>
                    </button>

                    {/* Speed Up All Videos Button */}
                    <button
                      onClick={() => handleSpeedUpAllVideos()}
                      disabled={
                        speedingUpAllVideos ||
                        sceneLoading.speedingUpVideo !== null ||
                        !sceneHandlers ||
                        uploading ||
                        reordering
                      }
                      style={
                        speedingUpAllVideos ||
                        sceneLoading.speedingUpVideo !== null ||
                        !sceneHandlers ||
                        uploading ||
                        reordering
                          ? { backgroundColor: '#fde047' }
                          : { backgroundColor: '#eab308' }
                      }
                      onMouseEnter={(e) => {
                        if (
                          !speedingUpAllVideos &&
                          sceneLoading.speedingUpVideo === null &&
                          sceneHandlers &&
                          !uploading &&
                          !reordering
                        ) {
                          e.currentTarget.style.backgroundColor = '#ca8a04';
                        }
                      }}
                      onMouseLeave={(e) => {
                        if (
                          !speedingUpAllVideos &&
                          sceneLoading.speedingUpVideo === null &&
                          sceneHandlers &&
                          !uploading &&
                          !reordering
                        ) {
                          e.currentTarget.style.backgroundColor = '#eab308';
                        }
                      }}
                      className='w-full inline-flex items-center justify-center gap-2 px-3 py-2 truncate text-white text-sm font-medium rounded-md transition-all shadow-sm hover:shadow disabled:cursor-not-allowed min-h-[40px] cursor-pointer'
                      title={
                        !sceneHandlers
                          ? 'Scene handlers not ready. Please wait...'
                          : speedingUpAllVideos
                            ? 'Speeding up all videos...'
                            : 'Speed up all video clips with current speed settings'
                      }
                    >
                      <Zap
                        className={`w-4 h-4 ${
                          speedingUpAllVideos ? 'animate-pulse' : ''
                        }`}
                      />
                      <span>
                        {speedingUpAllVideos
                          ? currentProcessingVideoId !== null
                            ? `V${currentProcessingVideoId}`
                            : sceneLoading.speedingUpVideo !== null
                              ? `S${sceneLoading.speedingUpVideo}`
                              : 'Processing...'
                          : 'Speed Up All'}
                      </span>
                    </button>

                    {/* Optimize Silence All Button */}
                    <button
                      onClick={() => handleOptimizeSilenceAll()}
                      disabled={
                        batchOperations.optimizingAllSilence ||
                        sceneLoading.optimizingSilenceVideo !== null ||
                        uploading ||
                        reordering
                      }
                      className='w-full inline-flex items-center justify-center gap-2 px-3 py-2 truncate bg-emerald-500 hover:bg-emerald-600 disabled:bg-emerald-300 text-white text-sm font-medium rounded-md transition-all shadow-sm hover:shadow disabled:cursor-not-allowed min-h-[40px] cursor-pointer'
                      title={
                        batchOperations.optimizingAllSilence
                          ? `Optimizing silence for all videos (${silenceSpeedRate}x speed ${
                              silenceMuted ? '+ mute' : '+ audio'
                            })...`
                          : `Detect and optimize silence in all original videos (${silenceSpeedRate}x speed ${
                              silenceMuted ? '+ mute' : '+ audio'
                            })`
                      }
                    >
                      <FastForward
                        className={`w-4 h-4 ${
                          batchOperations.optimizingAllSilence
                            ? 'animate-pulse'
                            : ''
                        }`}
                      />
                      <span>
                        {batchOperations.optimizingAllSilence
                          ? sceneLoading.optimizingSilenceVideo !== null
                            ? `V${sceneLoading.optimizingSilenceVideo}`
                            : 'Processing...'
                          : 'Silence Opt All'}
                      </span>
                    </button>

                    {/* Normalize Audio All Button */}
                    <button
                      onClick={() => handleNormalizeAudioAll()}
                      disabled={
                        batchOperations.normalizingAllAudio ||
                        sceneLoading.normalizingAudioVideo !== null ||
                        uploading ||
                        reordering
                      }
                      className='w-full inline-flex items-center justify-center gap-2 px-3 py-2 truncate bg-purple-500 hover:bg-purple-600 disabled:bg-purple-300 text-white text-sm font-medium rounded-md transition-all shadow-sm hover:shadow disabled:cursor-not-allowed min-h-[40px] cursor-pointer'
                      title={
                        batchOperations.normalizingAllAudio
                          ? 'Normalizing audio for all videos...'
                          : 'Normalize audio loudness for all original videos'
                      }
                    >
                      <Volume2
                        className={`w-4 h-4 ${
                          batchOperations.normalizingAllAudio
                            ? 'animate-pulse'
                            : ''
                        }`}
                      />
                      <span>
                        {batchOperations.normalizingAllAudio
                          ? sceneLoading.normalizingAudioVideo !== null
                            ? `V${sceneLoading.normalizingAudioVideo}`
                            : 'Processing...'
                          : 'Normalize All'}
                      </span>
                    </button>

                    {/* Convert to CFR All Button */}
                    <button
                      onClick={() => handleConvertToCFRAll()}
                      disabled={
                        batchOperations.convertingAllToCFR ||
                        sceneLoading.convertingToCFRVideo !== null ||
                        uploading ||
                        reordering
                      }
                      className='w-full inline-flex items-center justify-center gap-2 px-3 py-2 truncate bg-indigo-500 hover:bg-indigo-600 disabled:bg-indigo-300 text-white text-sm font-medium rounded-md transition-all shadow-sm hover:shadow disabled:cursor-not-allowed min-h-[40px] cursor-pointer'
                      title={
                        batchOperations.convertingAllToCFR
                          ? 'Converting all videos to CFR...'
                          : 'Convert all videos to constant frame rate (30 fps)'
                      }
                    >
                      <Film
                        className={`w-4 h-4 ${
                          batchOperations.convertingAllToCFR
                            ? 'animate-pulse'
                            : ''
                        }`}
                      />
                      <span>
                        {batchOperations.convertingAllToCFR
                          ? sceneLoading.convertingToCFRVideo !== null
                            ? `V${sceneLoading.convertingToCFRVideo}`
                            : 'Processing...'
                          : 'CFR All'}
                      </span>
                    </button>

                    {/* Generate Video All Button */}
                    <button
                      onClick={() => handleGenerateAllVideosForAllScenes()}
                      disabled={
                        generatingAllVideos ||
                        sceneLoading.generatingVideo !== null ||
                        !sceneHandlers ||
                        uploading ||
                        reordering
                      }
                      className='w-full inline-flex items-center justify-center gap-2 px-3 py-2 truncate bg-green-500 hover:bg-green-600 disabled:bg-green-300 text-white text-sm font-medium rounded-md transition-all shadow-sm hover:shadow disabled:cursor-not-allowed min-h-[40px] cursor-pointer'
                      title={
                        !sceneHandlers
                          ? 'Scene handlers not ready. Please wait...'
                          : generatingAllVideos
                            ? 'Generating videos for all scenes...'
                            : 'Generate videos for all scenes with video and TTS audio'
                      }
                    >
                      <Video
                        className={`w-4 h-4 ${
                          generatingAllVideos ? 'animate-pulse' : ''
                        }`}
                      />
                      <span>
                        {generatingAllVideos
                          ? sceneLoading.generatingVideo !== null
                            ? `S${sceneLoading.generatingVideo}`
                            : 'Processing...'
                          : 'Sync All'}
                      </span>
                    </button>

                    {/* Generate Clips All Button */}
                    <button
                      onClick={() => handleGenerateClipsAll()}
                      disabled={
                        generatingClipsAll ||
                        clipGeneration.generatingClips !== null ||
                        uploading ||
                        reordering
                      }
                      style={
                        generatingClipsAll ||
                        clipGeneration.generatingClips !== null ||
                        uploading ||
                        reordering
                          ? { backgroundColor: '#67e8f9' }
                          : { backgroundColor: '#06b6d4' }
                      }
                      onMouseEnter={(e) => {
                        if (
                          !generatingClipsAll &&
                          clipGeneration.generatingClips === null &&
                          !uploading &&
                          !reordering
                        ) {
                          e.currentTarget.style.backgroundColor = '#0891b2';
                        }
                      }}
                      onMouseLeave={(e) => {
                        if (
                          !generatingClipsAll &&
                          clipGeneration.generatingClips === null &&
                          !uploading &&
                          !reordering
                        ) {
                          e.currentTarget.style.backgroundColor = '#06b6d4';
                        }
                      }}
                      className='w-full inline-flex items-center justify-center gap-2 px-3 py-2 truncate text-white text-sm font-medium rounded-md transition-all shadow-sm hover:shadow disabled:cursor-not-allowed min-h-[40px] cursor-pointer'
                      title={
                        generatingClipsAll
                          ? 'Generating clips for all videos...'
                          : clipGeneration.generatingClips !== null
                            ? 'Another clip generation in progress'
                            : 'Generate video clips for all videos with scenes'
                      }
                    >
                      <Video
                        className={`w-4 h-4 ${
                          generatingClipsAll ||
                          clipGeneration.generatingClips !== null
                            ? 'animate-pulse'
                            : ''
                        }`}
                      />
                      <span>
                        {generatingClipsAll
                          ? clipGeneration.generatingClips !== null
                            ? `#${clipGeneration.generatingClips}`
                            : 'Processing...'
                          : 'Gen Clips All'}
                      </span>
                    </button>

                    {/* Merge All Final Videos Button */}
                    <button
                      onClick={handleMergeAllFinalVideos}
                      disabled={
                        mergingFinalVideos ||
                        uploading ||
                        reordering ||
                        transcribing !== null ||
                        transcribingAll ||
                        generatingScenes !== null ||
                        generatingScenesAll
                      }
                      className='w-full inline-flex items-center justify-center gap-2 px-3 py-2 truncate bg-orange-500 hover:bg-orange-600 disabled:bg-orange-300 text-white text-sm font-medium rounded-md transition-all shadow-sm hover:shadow disabled:cursor-not-allowed min-h-[40px] cursor-pointer'
                      title={
                        mergingFinalVideos
                          ? 'Merging final videos...'
                          : 'Merge all final merged videos in order'
                      }
                    >
                      <Video
                        className={`w-4 h-4 ${
                          mergingFinalVideos ? 'animate-pulse' : ''
                        }`}
                      />
                      <span>
                        {mergingFinalVideos ? 'Merging...' : 'Merge Final'}
                      </span>
                    </button>

                    {/* Convert Final Videos to CFR Button */}
                    <button
                      onClick={() => handleConvertFinalToCFRAll()}
                      disabled={
                        batchOperations.convertingAllFinalToCFR ||
                        sceneLoading.convertingFinalToCFRVideo !== null ||
                        uploading ||
                        reordering
                      }
                      className='w-full inline-flex items-center justify-center gap-2 px-3 py-2 truncate bg-pink-500 hover:bg-pink-600 disabled:bg-pink-300 text-white text-sm font-medium rounded-md transition-all shadow-sm hover:shadow disabled:cursor-not-allowed min-h-[40px] cursor-pointer'
                      title={
                        batchOperations.convertingAllFinalToCFR
                          ? 'Converting all final videos to CFR...'
                          : 'Convert all final merged videos to constant frame rate (30 fps)'
                      }
                    >
                      <Film
                        className={`w-4 h-4 ${
                          batchOperations.convertingAllFinalToCFR
                            ? 'animate-pulse'
                            : ''
                        }`}
                      />
                      <span>
                        {batchOperations.convertingAllFinalToCFR
                          ? sceneLoading.convertingFinalToCFRVideo !== null
                            ? `V${sceneLoading.convertingFinalToCFRVideo}`
                            : 'Processing...'
                          : 'CFR Final All'}
                      </span>
                    </button>

                    {/* Delete Empty Scenes (Processing) Button */}
                    <button
                      onClick={() => handleDeleteEmptyScenesAllVideos()}
                      disabled={
                        deletingEmptyScenesAllVideos ||
                        transcribingProcessingScenesAllVideos ||
                        uploading ||
                        reordering ||
                        transcribing !== null ||
                        transcribingAll ||
                        generatingScenes !== null ||
                        generatingScenesAll ||
                        mergingFinalVideos ||
                        batchOperations.convertingAllFinalToCFR ||
                        sceneLoading.convertingFinalToCFRVideo !== null
                      }
                      className='w-full inline-flex items-center justify-center gap-2 px-3 py-2 truncate bg-red-500 hover:bg-red-600 disabled:bg-red-300 text-white text-sm font-medium rounded-md transition-all shadow-sm hover:shadow disabled:cursor-not-allowed min-h-[40px] cursor-pointer'
                      title={
                        deletingEmptyScenesAllVideos
                          ? 'Deleting empty scenes for Processing videos...'
                          : 'Delete scenes that have empty text fields for videos with Processing status'
                      }
                    >
                      <Trash2
                        className={`w-4 h-4 ${
                          deletingEmptyScenesAllVideos ? 'animate-pulse' : ''
                        }`}
                      />
                      <span>
                        {deletingEmptyScenesAllVideos
                          ? currentProcessingVideoId !== null
                            ? `V${currentProcessingVideoId}`
                            : 'Processing...'
                          : 'Delete Empty'}
                      </span>
                    </button>

                    {/* Transcribe FINAL Scenes (Processing) Button */}
                    <button
                      onClick={() =>
                        handleTranscribeProcessingScenesAllVideos()
                      }
                      disabled={
                        transcribingProcessingScenesAllVideos ||
                        promptingProcessingScenesAllVideos ||
                        deletingEmptyScenesAllVideos ||
                        uploading ||
                        reordering ||
                        transcribing !== null ||
                        transcribingAll ||
                        generatingScenes !== null ||
                        generatingScenesAll ||
                        mergingFinalVideos ||
                        batchOperations.convertingAllFinalToCFR ||
                        sceneLoading.convertingFinalToCFRVideo !== null
                      }
                      className='w-full inline-flex items-center justify-center gap-2 px-3 py-2 truncate bg-purple-500 hover:bg-purple-600 disabled:bg-purple-300 text-white text-sm font-medium rounded-md transition-all shadow-sm hover:shadow disabled:cursor-not-allowed min-h-[40px] cursor-pointer'
                      title={
                        transcribingProcessingScenesAllVideos
                          ? 'Transcribing final scenes for Processing videos...'
                          : 'Transcribe final scene videos (missing captions) for videos with Processing status'
                      }
                    >
                      <Subtitles
                        className={`w-4 h-4 ${
                          transcribingProcessingScenesAllVideos
                            ? 'animate-pulse'
                            : ''
                        }`}
                      />
                      <span>
                        {transcribingProcessingScenesAllVideos
                          ? currentProcessingVideoId !== null
                            ? `V${currentProcessingVideoId}`
                            : 'Processing...'
                          : 'Transcribe Scenes'}
                      </span>
                    </button>

                    {/* Prompt Scenes (Processing) Button */}
                    <button
                      onClick={() => handlePromptProcessingScenesAllVideos()}
                      disabled={
                        promptingProcessingScenesAllVideos ||
                        transcribingProcessingScenesAllVideos ||
                        deletingEmptyScenesAllVideos ||
                        uploading ||
                        reordering ||
                        transcribing !== null ||
                        transcribingAll ||
                        generatingScenes !== null ||
                        generatingScenesAll ||
                        mergingFinalVideos ||
                        batchOperations.convertingAllFinalToCFR ||
                        sceneLoading.convertingFinalToCFRVideo !== null
                      }
                      className='w-full inline-flex items-center justify-center gap-2 px-3 py-2 truncate bg-indigo-500 hover:bg-indigo-600 disabled:bg-indigo-300 text-white text-sm font-medium rounded-md transition-all shadow-sm hover:shadow disabled:cursor-not-allowed min-h-[40px] cursor-pointer'
                      title={
                        promptingProcessingScenesAllVideos
                          ? 'Generating prompts for scenes in Processing videos...'
                          : 'Generate and save prompts for non-empty scenes in videos with Processing status'
                      }
                    >
                      <Sparkles
                        className={`w-4 h-4 ${
                          promptingProcessingScenesAllVideos
                            ? 'animate-pulse'
                            : ''
                        }`}
                      />
                      <span>
                        {promptingProcessingScenesAllVideos
                          ? currentProcessingVideoId !== null
                            ? `V${currentProcessingVideoId}`
                            : 'Processing...'
                          : 'Prompt Scenes'}
                      </span>
                    </button>

                    {/* Final Actions */}
                    {/* Generate Timestamps Button */}
                    <button
                      onClick={handleGenerateTimestamps}
                      disabled={
                        generatingTimestamps ||
                        uploading ||
                        reordering ||
                        transcribing !== null ||
                        transcribingAll ||
                        generatingScenes !== null ||
                        generatingScenesAll ||
                        mergingFinalVideos
                      }
                      className='w-full inline-flex items-center justify-center gap-2 px-3 py-2 truncate bg-teal-500 hover:bg-teal-600 disabled:bg-teal-300 text-white text-sm font-medium rounded-md transition-all shadow-sm hover:shadow disabled:cursor-not-allowed min-h-[40px] cursor-pointer'
                      title={
                        generatingTimestamps
                          ? 'Generating timestamps...'
                          : 'Generate timestamps for final merged videos'
                      }
                    >
                      <Clock
                        className={`w-4 h-4 ${
                          generatingTimestamps ? 'animate-pulse' : ''
                        }`}
                      />
                      <span>
                        {generatingTimestamps ? 'Generating...' : 'Timestamps'}
                      </span>
                    </button>

                    {/* Full Pipeline Button */}
                    <button
                      onClick={handleRunFullPipeline}
                      disabled={
                        runningFullPipeline ||
                        transcribing !== null ||
                        transcribingAll ||
                        generatingScenes !== null ||
                        generatingScenesAll ||
                        improvingAllVideosScenes ||
                        generatingAllTTSForAllVideos ||
                        speedingUpAllVideos ||
                        generatingAllVideos ||
                        generatingClipsAll ||
                        !sceneHandlers ||
                        uploading ||
                        reordering
                      }
                      style={
                        runningFullPipeline ||
                        transcribing !== null ||
                        transcribingAll ||
                        generatingScenes !== null ||
                        generatingScenesAll ||
                        improvingAllVideosScenes ||
                        generatingAllTTSForAllVideos ||
                        speedingUpAllVideos ||
                        generatingAllVideos ||
                        generatingClipsAll ||
                        !sceneHandlers ||
                        uploading ||
                        reordering
                          ? { backgroundColor: '#d8b4fe' }
                          : { backgroundColor: '#9333ea' }
                      }
                      onMouseEnter={(e) => {
                        if (
                          !runningFullPipeline &&
                          transcribing === null &&
                          !transcribingAll &&
                          generatingScenes === null &&
                          !generatingScenesAll &&
                          !improvingAllVideosScenes &&
                          !generatingAllTTSForAllVideos &&
                          !speedingUpAllVideos &&
                          !generatingAllVideos &&
                          !generatingClipsAll &&
                          sceneHandlers &&
                          !uploading &&
                          !reordering
                        ) {
                          e.currentTarget.style.backgroundColor = '#7c3aed';
                        }
                      }}
                      onMouseLeave={(e) => {
                        if (
                          !runningFullPipeline &&
                          transcribing === null &&
                          !transcribingAll &&
                          generatingScenes === null &&
                          !generatingScenesAll &&
                          !improvingAllVideosScenes &&
                          !generatingAllTTSForAllVideos &&
                          !speedingUpAllVideos &&
                          !generatingAllVideos &&
                          !generatingClipsAll &&
                          sceneHandlers &&
                          !uploading &&
                          !reordering
                        ) {
                          e.currentTarget.style.backgroundColor = '#9333ea';
                        }
                      }}
                      className='w-full inline-flex items-center justify-center gap-2 px-3 py-2 truncate text-white text-sm font-bold rounded-md transition-all shadow-md hover:shadow-lg disabled:cursor-not-allowed min-h-[40px] cursor-pointer'
                      title={
                        !sceneHandlers
                          ? 'Scene handlers not ready. Please wait...'
                          : runningFullPipeline
                            ? pipelineStep
                            : 'Run full pipeline: TTS Script → Normalize → CFR → Silence → Transcribe → Scenes → Delete Empty → Clips → Speed Up → Improve → TTS → Sync'
                      }
                    >
                      <Workflow
                        className={`w-4 h-4 ${
                          runningFullPipeline ? 'animate-pulse' : ''
                        }`}
                      />
                      <span className='truncate'>
                        {runningFullPipeline
                          ? pipelineStep.split('...')[0] || 'Processing...'
                          : 'Full Pipeline'}
                      </span>
                    </button>
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Merged Video Display */}
          {mergedVideo.url && (
            <MergedVideoDisplay
              mergedVideo={mergedVideo}
              onClear={clearMergedVideo}
            />
          )}

          {/* Selected Video Info */}
          {selectedOriginalVideo.id && (
            <div className='bg-blue-50 border border-blue-200 rounded-lg p-4 mb-6'>
              <div className='flex items-center justify-between'>
                <div className='flex items-center gap-3'>
                  <div className='w-10 h-10 bg-blue-500 rounded-full flex items-center justify-center'>
                    <Check className='w-6 h-6 text-white' />
                  </div>
                  <div>
                    <h3 className='font-semibold text-blue-900'>
                      Selected Video: #{selectedOriginalVideo.id}
                    </h3>
                    <p className='text-blue-700 text-sm'>
                      Status: {selectedOriginalVideo.status} |
                      {(() => {
                        const filteredScenes = getFilteredData();
                        return filteredScenes.length > 0
                          ? ` ${filteredScenes.length} scene${
                              filteredScenes.length !== 1 ? 's' : ''
                            } available for editing`
                          : ' No scenes found for this video';
                      })()}
                    </p>
                  </div>
                </div>
                <div className='flex items-center gap-2'>
                  <button
                    onClick={() =>
                      selectedOriginalVideo.id &&
                      handleDeleteVideo(selectedOriginalVideo.id)
                    }
                    disabled={
                      deleting === selectedOriginalVideo.id ||
                      !selectedOriginalVideo.id
                    }
                    className='text-red-600 hover:text-red-800 p-2 hover:bg-red-100 rounded-full transition-colors disabled:opacity-50 disabled:cursor-not-allowed'
                    title='Delete video and all related scenes'
                  >
                    {selectedOriginalVideo.id &&
                    deleting === selectedOriginalVideo.id ? (
                      <Loader2 className='w-5 h-5 animate-spin' />
                    ) : (
                      <Trash2 className='w-5 h-5' />
                    )}
                  </button>
                  <button
                    onClick={() => {
                      setSelectedOriginalVideo(null);
                      saveSettingsToLocalStorage();
                    }}
                    className='text-blue-600 hover:text-blue-800 p-2 hover:bg-blue-100 rounded-full transition-colors'
                    title='Clear selection'
                  >
                    <X className='w-5 h-5' />
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* Bulk Status Change Controls */}
          {originalVideos.length > 0 && (
            <div className='bg-gray-50 border border-gray-200 rounded-lg p-4 mb-6'>
              <div className='flex items-center gap-4'>
                <div className='flex items-center gap-2'>
                  <label
                    htmlFor='bulk-status'
                    className='text-sm font-medium text-gray-700'
                  >
                    Change Status for All Videos:
                  </label>
                  <select
                    id='bulk-status'
                    value={bulkStatusChange}
                    onChange={(e) => setBulkStatusChange(e.target.value)}
                    className='px-3 py-1 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500'
                    disabled={updatingBulkStatus}
                  >
                    <option value=''>Select Status</option>
                    <option value='Processing'>Processing</option>
                    <option value='Done'>Done</option>
                    <option value='Pending'>Pending</option>
                  </select>
                </div>
                <button
                  onClick={handleBulkStatusChange}
                  disabled={!bulkStatusChange || updatingBulkStatus}
                  className='px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-md hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2'
                >
                  {updatingBulkStatus ? (
                    <>
                      <div className='w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin'></div>
                      Updating...
                    </>
                  ) : (
                    <>
                      <Check className='w-4 h-4' />
                      Apply to All ({originalVideos.length} videos)
                    </>
                  )}
                </button>
              </div>
            </div>
          )}

          {/* Videos Table */}
          <div className='transition-all duration-200 rounded-lg'>
            {originalVideos.length === 0 ? (
              <div className='text-center py-8'>
                <Video className='w-12 h-12 text-gray-300 mx-auto mb-4' />
                <p className='text-gray-500 text-lg'>
                  No original videos found
                </p>
                <p className='text-gray-400 text-sm mt-2'>
                  Upload a video to get started
                </p>
              </div>
            ) : (
              <div className='overflow-x-auto'>
                {/* Fixed height scrollable container for the table body */}
                <div className='h-[520px] overflow-y-auto'>
                  <table className='w-full'>
                    <thead className='bg-white'>
                      <tr className='border-b border-gray-200'>
                        <th className='sticky top-0 bg-white text-left py-3 px-4 font-semibold text-gray-700 w-8 z-10'>
                          {/* Drag handle column */}
                        </th>
                        <th className='sticky top-0 bg-white text-left py-3 px-4 font-semibold text-gray-700 w-12 z-10'>
                          Select
                        </th>
                        <th className='sticky top-0 bg-white text-left py-3 px-4 font-semibold text-gray-700 z-10'>
                          ID
                        </th>
                        <th className='sticky top-0 bg-white text-left py-3 px-4 font-semibold text-gray-700 z-10'>
                          Title
                        </th>
                        <th className='sticky top-0 bg-white text-left py-3 px-4 font-semibold text-gray-700 z-10'>
                          Status
                        </th>
                        <th className='sticky top-0 bg-white text-left py-3 px-4 font-semibold text-gray-700 z-10'>
                          Video URL
                        </th>
                        <th className='sticky top-0 bg-white text-left py-3 px-4 font-semibold text-gray-700 z-10'>
                          Final Merged Video
                        </th>
                        <th className='sticky top-0 bg-white text-left py-3 px-4 font-semibold text-gray-700 z-10'>
                          Actions
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {originalVideos.map((video, index) => {
                        const isSelected = isRowSelected(video.id);
                        return (
                          <tr
                            key={video.id}
                            draggable={!editingTitle}
                            onDragStart={(e) => handleRowDragStart(e, video.id)}
                            onDragOver={(e) => handleRowDragOver(e, video.id)}
                            onDragLeave={handleRowDragLeave}
                            onDragEnd={handleRowDragEnd}
                            onDrop={(e) => handleRowDrop(e, video.id)}
                            onClick={() => !draggedRow && handleRowClick(video)}
                            className={`border-b border-gray-100 transition-all duration-200 ${
                              draggedRow === video.id
                                ? 'opacity-50 cursor-grabbing'
                                : dragOverRow === video.id
                                  ? 'border-t-4 border-t-blue-500 cursor-pointer'
                                  : 'cursor-pointer'
                            } ${
                              isSelected
                                ? 'bg-blue-50 hover:bg-blue-100 border-blue-200'
                                : index % 2 === 0
                                  ? 'bg-white hover:bg-gray-50'
                                  : 'bg-gray-50/50 hover:bg-gray-100'
                            }`}
                          >
                            {/* Drag Handle */}
                            <td className='py-3 px-2'>
                              <div
                                className='cursor-grab hover:cursor-grabbing p-1 rounded hover:bg-gray-200 transition-colors'
                                onMouseDown={(e) => e.stopPropagation()}
                              >
                                <GripVertical className='w-4 h-4 text-gray-400' />
                              </div>
                            </td>

                            {/* Selection */}
                            <td className='py-3 px-4'>
                              <div
                                className={`w-6 h-6 rounded-full border-2 flex items-center justify-center transition-colors ${
                                  isSelected
                                    ? 'bg-blue-500 border-blue-500'
                                    : 'border-gray-300 hover:border-blue-400'
                                }`}
                              >
                                {isSelected && (
                                  <Check className='w-4 h-4 text-white' />
                                )}
                              </div>
                            </td>

                            {/* ID */}
                            <td className='py-3 px-4'>
                              <span
                                className={`font-medium ${
                                  isSelected ? 'text-blue-900' : 'text-gray-900'
                                }`}
                              >
                                #{video.id}
                              </span>
                            </td>

                            {/* Title (6852) - Editable */}
                            <td className='py-3 px-4'>
                              {editingTitle?.videoId === video.id ? (
                                <div className='flex items-center gap-2'>
                                  <input
                                    type='text'
                                    value={editingTitle.value}
                                    onChange={(e) =>
                                      setEditingTitle((prev) =>
                                        prev
                                          ? { ...prev, value: e.target.value }
                                          : null,
                                      )
                                    }
                                    onKeyDown={(e) =>
                                      handleTitleKeyDown(e, video.id)
                                    }
                                    onBlur={() =>
                                      saveTitleEdit(
                                        video.id,
                                        editingTitle.value,
                                      )
                                    }
                                    className='flex-1 px-2 py-1 border border-gray-300 rounded text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent'
                                    autoFocus
                                    disabled={editingTitle.saving}
                                  />
                                  {editingTitle.saving ? (
                                    <Loader2 className='w-4 h-4 animate-spin text-blue-500' />
                                  ) : (
                                    <button
                                      onClick={() =>
                                        saveTitleEdit(
                                          video.id,
                                          editingTitle.value,
                                        )
                                      }
                                      className='p-1 text-green-600 hover:text-green-800 hover:bg-green-100 rounded transition-colors'
                                      title='Save title'
                                    >
                                      <Save className='w-4 h-4' />
                                    </button>
                                  )}
                                </div>
                              ) : (
                                <div
                                  className='group flex items-center gap-2 cursor-pointer hover:bg-gray-50 rounded px-2 py-1 -mx-2 -my-1'
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    const currentTitle = extractFieldValue(
                                      video.field_6852,
                                    );
                                    startTitleEdit(video.id, currentTitle);
                                  }}
                                >
                                  <span
                                    className={`${
                                      isSelected
                                        ? 'text-blue-900'
                                        : 'text-gray-900'
                                    }`}
                                  >
                                    {extractFieldValue(video.field_6852) ||
                                      'Click to add title'}
                                  </span>
                                  <Edit3 className='w-3 h-3 text-gray-400 opacity-0 group-hover:opacity-100 transition-opacity' />
                                </div>
                              )}
                            </td>

                            {/* Status (6864) - Dropdown */}
                            <td className='py-3 px-4'>
                              <div
                                className='relative'
                                onClick={(e) => e.stopPropagation()}
                              >
                                {updatingStatus === video.id ? (
                                  <div className='flex items-center gap-2 px-3 py-1.5'>
                                    <Loader2 className='w-4 h-4 animate-spin text-blue-500' />
                                    <span className='text-sm text-gray-600'>
                                      Updating...
                                    </span>
                                  </div>
                                ) : (
                                  <select
                                    value={
                                      extractFieldValue(video.field_6864) ||
                                      'Pending'
                                    }
                                    onChange={(e) =>
                                      handleStatusChange(
                                        video.id,
                                        e.target.value,
                                        e,
                                      )
                                    }
                                    className={`px-3 py-1.5 rounded-full text-sm font-medium border-2 cursor-pointer transition-all focus:outline-none focus:ring-2 focus:ring-offset-1 ${
                                      extractFieldValue(video.field_6864) ===
                                      'Done'
                                        ? 'bg-green-100 text-green-800 border-green-300 hover:bg-green-200 focus:ring-green-500'
                                        : extractFieldValue(
                                              video.field_6864,
                                            ) === 'Processing'
                                          ? 'bg-blue-100 text-blue-800 border-blue-300 hover:bg-blue-200 focus:ring-blue-500'
                                          : 'bg-gray-100 text-gray-800 border-gray-300 hover:bg-gray-200 focus:ring-gray-500'
                                    }`}
                                    onClick={(e) => e.stopPropagation()}
                                  >
                                    <option value='Pending'>Pending</option>
                                    <option value='Processing'>
                                      Processing
                                    </option>
                                    <option value='Done'>Done</option>
                                  </select>
                                )}
                              </div>
                            </td>

                            {/* Video Uploaded URL (6881) */}
                            <td className='py-3 px-4'>
                              {(() => {
                                const videoUrl = extractUrl(video.field_6881);
                                return videoUrl ? (
                                  <a
                                    href={videoUrl}
                                    target='_blank'
                                    rel='noopener noreferrer'
                                    className='inline-flex items-center gap-1 text-blue-600 hover:text-blue-800 hover:underline'
                                  >
                                    <Video className='w-4 h-4' />
                                    <span className='truncate max-w-32'>
                                      View Video
                                    </span>
                                    <ExternalLink className='w-3 h-3' />
                                  </a>
                                ) : (
                                  <span className='text-gray-400'>
                                    No video
                                  </span>
                                );
                              })()}
                            </td>

                            {/* Final Merged Video URL (6858) */}
                            <td className='py-3 px-4'>
                              {(() => {
                                const finalVideoUrl = extractUrl(
                                  video.field_6858,
                                );
                                const isCFR =
                                  finalVideoUrl &&
                                  finalVideoUrl.includes('_cfr');
                                return finalVideoUrl ? (
                                  <div className='inline-flex items-center gap-2'>
                                    <a
                                      href={finalVideoUrl}
                                      target='_blank'
                                      rel='noopener noreferrer'
                                      className='inline-flex items-center gap-1 text-green-600 hover:text-green-800 hover:underline'
                                    >
                                      <Video className='w-4 h-4' />
                                      <span className='truncate max-w-32'>
                                        Final Video
                                      </span>
                                      <ExternalLink className='w-3 h-3' />
                                    </a>
                                    {isCFR && (
                                      <span
                                        className='inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-xs font-medium bg-pink-100 text-pink-700'
                                        title='Constant Frame Rate (30fps)'
                                      >
                                        <Film className='w-3 h-3' />
                                        CFR
                                      </span>
                                    )}
                                  </div>
                                ) : (
                                  <span className='text-gray-400'>
                                    Not ready
                                  </span>
                                );
                              })()}
                            </td>

                            {/* Actions */}
                            <td className='py-3 px-4'>
                              <div className='flex items-center gap-2'>
                                <button
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    const videoUrl = extractUrl(
                                      video.field_6881,
                                    );
                                    if (videoUrl) {
                                      handleTranscribeVideo(video.id, videoUrl);
                                    } else {
                                      setError(
                                        'No video URL found for transcription',
                                      );
                                    }
                                  }}
                                  disabled={
                                    transcribing !== null ||
                                    transcribingAll ||
                                    !extractUrl(video.field_6881) ||
                                    !!extractUrl(video.field_6861)
                                  }
                                  className='p-2 text-purple-600 hover:text-purple-800 hover:bg-purple-100 rounded-full transition-colors disabled:opacity-50 disabled:cursor-not-allowed'
                                  title={
                                    transcribing !== null
                                      ? transcribing === video.id
                                        ? 'Transcribing...'
                                        : 'Another transcription in progress'
                                      : transcribingAll
                                        ? 'Bulk transcription in progress'
                                        : !extractUrl(video.field_6881)
                                          ? 'No video URL available'
                                          : !!extractUrl(video.field_6861)
                                            ? 'Video already has captions'
                                            : 'Transcribe video'
                                  }
                                >
                                  {transcribing === video.id ? (
                                    <Loader2 className='w-4 h-4 animate-spin' />
                                  ) : (
                                    <Subtitles className='w-4 h-4' />
                                  )}
                                </button>

                                <button
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    handleGenerateTtsFromVideoScript(video);
                                  }}
                                  disabled={
                                    generatingTtsFromScripts ||
                                    generatingScriptTtsForVideo !== null ||
                                    !(
                                      typeof video.field_6854 === 'string' &&
                                      video.field_6854.trim().length > 0
                                    ) ||
                                    !!extractUrl(video.field_6859)
                                  }
                                  className='p-2 text-orange-600 hover:text-orange-800 hover:bg-orange-100 rounded-full transition-colors disabled:opacity-50 disabled:cursor-not-allowed'
                                  title={
                                    generatingTtsFromScripts
                                      ? 'Batch TTS Script in progress'
                                      : generatingScriptTtsForVideo !== null
                                        ? generatingScriptTtsForVideo ===
                                          video.id
                                          ? 'Generating TTS...'
                                          : 'Another TTS generation in progress'
                                        : !(
                                              typeof video.field_6854 ===
                                                'string' &&
                                              video.field_6854.trim().length > 0
                                            )
                                          ? 'No script available'
                                          : !!extractUrl(video.field_6859)
                                            ? 'TTS audio already exists'
                                            : 'Generate TTS from script'
                                  }
                                >
                                  {generatingScriptTtsForVideo === video.id ? (
                                    <Loader2 className='w-4 h-4 animate-spin' />
                                  ) : (
                                    <Mic2 className='w-4 h-4' />
                                  )}
                                </button>

                                <button
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    handleGenerateVideoFromTtsAudio(video);
                                  }}
                                  disabled={
                                    generatingVideoFromTtsAudioAll ||
                                    generatingVideoFromTtsAudioForVideo !==
                                      null ||
                                    !extractUrl(video.field_6859) ||
                                    !!extractUrl(video.field_6881)
                                  }
                                  className='p-2 text-pink-600 hover:text-pink-800 hover:bg-pink-100 rounded-full transition-colors disabled:opacity-50 disabled:cursor-not-allowed'
                                  title={
                                    generatingVideoFromTtsAudioAll
                                      ? 'Batch TTS Video in progress'
                                      : generatingVideoFromTtsAudioForVideo !==
                                          null
                                        ? generatingVideoFromTtsAudioForVideo ===
                                          video.id
                                          ? 'Generating video from TTS audio...'
                                          : 'Another video generation in progress'
                                        : !extractUrl(video.field_6859)
                                          ? 'No TTS audio available'
                                          : !!extractUrl(video.field_6881)
                                            ? 'Video already exists'
                                            : 'Generate video from TTS audio (30fps)'
                                  }
                                >
                                  {generatingVideoFromTtsAudioForVideo ===
                                  video.id ? (
                                    <Loader2 className='w-4 h-4 animate-spin' />
                                  ) : (
                                    <Film className='w-4 h-4' />
                                  )}
                                </button>

                                <button
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    handleGenerateScenes(video.id);
                                  }}
                                  disabled={
                                    generatingScenes !== null ||
                                    generatingScenesAll ||
                                    (!extractUrl(video.field_6861) &&
                                      !(
                                        typeof video.field_6854 === 'string' &&
                                        video.field_6854.trim().length > 0
                                      )) ||
                                    hasScenes(video)
                                  }
                                  className='p-2 text-green-600 hover:text-green-800 hover:bg-green-100 rounded-full transition-colors disabled:opacity-50 disabled:cursor-not-allowed'
                                  title={
                                    generatingScenes !== null
                                      ? generatingScenes === video.id
                                        ? 'Generating scenes...'
                                        : 'Another scene generation in progress'
                                      : !extractUrl(video.field_6861) &&
                                          !(
                                            typeof video.field_6854 ===
                                              'string' &&
                                            video.field_6854.trim().length > 0
                                          )
                                        ? 'No captions URL or script available'
                                        : hasScenes(video)
                                          ? 'Scenes already generated for this video'
                                          : 'Generate scenes from captions or script'
                                  }
                                >
                                  {generatingScenes === video.id ? (
                                    <Loader2 className='w-4 h-4 animate-spin' />
                                  ) : (
                                    <Grid3x3 className='w-4 h-4' />
                                  )}
                                </button>

                                <button
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    handleGenerateClips(video.id);
                                  }}
                                  disabled={
                                    clipGeneration.generatingClips !== null ||
                                    !hasScenes(video)
                                  }
                                  className='p-2 text-blue-600 hover:text-blue-800 hover:bg-blue-100 rounded-full transition-colors disabled:opacity-50 disabled:cursor-not-allowed'
                                  title={
                                    clipGeneration.generatingClips !== null
                                      ? clipGeneration.generatingClips ===
                                        video.id
                                        ? clipGeneration.clipsProgress
                                          ? `Generating clips... Scene ${clipGeneration.clipsProgress.current}/${clipGeneration.clipsProgress.total} (${clipGeneration.clipsProgress.percentage}%)`
                                          : 'Generating clips...'
                                        : 'Another clip generation in progress'
                                      : !hasScenes(video)
                                        ? 'No scenes available - generate scenes first'
                                        : 'Generate video clips for all scenes'
                                  }
                                >
                                  {clipGeneration.generatingClips ===
                                  video.id ? (
                                    clipGeneration.clipsProgress ? (
                                      <div className='flex items-center space-x-1'>
                                        <Loader2 className='w-4 h-4 animate-spin' />
                                        <span className='text-xs font-medium'>
                                          {clipGeneration.clipsProgress.current}
                                          /{clipGeneration.clipsProgress.total}
                                        </span>
                                      </div>
                                    ) : (
                                      <Loader2 className='w-4 h-4 animate-spin' />
                                    )
                                  ) : (
                                    <Video className='w-4 h-4' />
                                  )}
                                </button>

                                <button
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    const videoUrl = extractUrl(
                                      video.field_6881,
                                    );
                                    if (videoUrl) {
                                      handleNormalizeVideo(video.id, videoUrl);
                                    } else {
                                      setError(
                                        'No video URL found for normalization',
                                      );
                                    }
                                  }}
                                  disabled={
                                    normalizing !== null ||
                                    sceneLoading.normalizingAudioVideo !==
                                      null ||
                                    !extractUrl(video.field_6881) ||
                                    !!extractUrl(video.field_6903) // Already normalized
                                  }
                                  className='p-2 text-orange-600 hover:text-orange-800 hover:bg-orange-100 rounded-full transition-colors disabled:opacity-50 disabled:cursor-not-allowed'
                                  title={
                                    normalizing !== null ||
                                    sceneLoading.normalizingAudioVideo !== null
                                      ? normalizing === video.id ||
                                        sceneLoading.normalizingAudioVideo ===
                                          video.id
                                        ? 'Normalizing audio...'
                                        : 'Another normalization in progress'
                                      : !extractUrl(video.field_6881)
                                        ? 'No video URL available'
                                        : !!extractUrl(video.field_6903)
                                          ? 'Video already normalized'
                                          : 'Normalize audio loudness'
                                  }
                                >
                                  {normalizing === video.id ||
                                  sceneLoading.normalizingAudioVideo ===
                                    video.id ? (
                                    <Loader2 className='w-4 h-4 animate-spin' />
                                  ) : (
                                    <Volume2 className='w-4 h-4' />
                                  )}
                                </button>

                                <button
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    const videoUrl = extractUrl(
                                      video.field_6881,
                                    );
                                    if (videoUrl) {
                                      handleConvertToCFR(video.id, videoUrl);
                                    } else {
                                      setError(
                                        'No video URL found for CFR conversion',
                                      );
                                    }
                                  }}
                                  disabled={
                                    convertingToCFR !== null ||
                                    sceneLoading.convertingToCFRVideo !==
                                      null ||
                                    !extractUrl(video.field_6881) ||
                                    !!extractUrl(video.field_6908) // Already converted to CFR
                                  }
                                  className='p-2 text-purple-600 hover:text-purple-800 hover:bg-purple-100 rounded-full transition-colors disabled:opacity-50 disabled:cursor-not-allowed'
                                  title={
                                    convertingToCFR !== null ||
                                    sceneLoading.convertingToCFRVideo !== null
                                      ? convertingToCFR === video.id ||
                                        sceneLoading.convertingToCFRVideo ===
                                          video.id
                                        ? 'Converting to CFR 30fps...'
                                        : 'Another CFR conversion in progress'
                                      : !extractUrl(video.field_6881)
                                        ? 'No video URL available'
                                        : !!extractUrl(video.field_6908)
                                          ? 'Video already converted to CFR'
                                          : 'Convert to Constant Frame Rate (30fps)'
                                  }
                                >
                                  {convertingToCFR === video.id ||
                                  sceneLoading.convertingToCFRVideo ===
                                    video.id ? (
                                    <Loader2 className='w-4 h-4 animate-spin' />
                                  ) : (
                                    <Film className='w-4 h-4' />
                                  )}
                                </button>

                                <button
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    const videoUrl = extractUrl(
                                      video.field_6881,
                                    );
                                    if (videoUrl) {
                                      handleOptimizeSilence(video.id, videoUrl);
                                    } else {
                                      setError(
                                        'No video URL found for silence optimization',
                                      );
                                    }
                                  }}
                                  disabled={
                                    optimizingSilence !== null ||
                                    sceneLoading.optimizingSilenceVideo !==
                                      null ||
                                    !extractUrl(video.field_6881) ||
                                    !!extractUrl(video.field_6907) // Already silenced
                                  }
                                  className='p-2 text-green-600 hover:text-green-800 hover:bg-green-100 rounded-full transition-colors disabled:opacity-50 disabled:cursor-not-allowed'
                                  title={
                                    optimizingSilence !== null
                                      ? optimizingSilence === video.id
                                        ? `Optimizing silence (${silenceSpeedRate}x speed ${
                                            silenceMuted ? '+ mute' : '+ audio'
                                          })...`
                                        : 'Another silence optimization in progress'
                                      : sceneLoading.optimizingSilenceVideo !==
                                          null
                                        ? sceneLoading.optimizingSilenceVideo ===
                                          video.id
                                          ? 'Optimizing silence in batch mode...'
                                          : 'Batch silence optimization in progress'
                                        : !extractUrl(video.field_6881)
                                          ? 'No video URL available'
                                          : !!extractUrl(video.field_6907)
                                            ? 'Video already optimized for silence'
                                            : `Speed up & mute silent parts (${silenceSpeedRate}x)`
                                  }
                                >
                                  {optimizingSilence === video.id ||
                                  sceneLoading.optimizingSilenceVideo ===
                                    video.id ? (
                                    <Loader2 className='w-4 h-4 animate-spin' />
                                  ) : (
                                    <FastForward className='w-4 h-4' />
                                  )}
                                </button>
                              </div>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                  {/* close overflow-x-auto wrapper */}
                </div>
              </div>
            )}
          </div>

          {/* Final Video Section - Collapsible */}
          <div className='bg-white rounded-lg border border-gray-200 overflow-hidden'>
            {/* Final Video Header */}
            <button
              onClick={() => setIsFinalVideoExpanded(!isFinalVideoExpanded)}
              className='w-full px-4 py-3 flex items-center justify-between hover:bg-gray-50 transition-colors'
            >
              <div className='flex items-center gap-2'>
                <Video className='w-5 h-5 text-green-600' />
                <h3 className='text-lg font-semibold text-gray-900'>
                  Final Video
                </h3>
              </div>
              <div className='flex items-center gap-2'>
                <span className='text-xs text-gray-400'>
                  {isFinalVideoExpanded ? 'Collapse' : 'Expand'}
                </span>
                <svg
                  className={`w-4 h-4 text-gray-400 transition-transform ${
                    isFinalVideoExpanded ? 'rotate-180' : ''
                  }`}
                  fill='none'
                  stroke='currentColor'
                  viewBox='0 0 24 24'
                >
                  <path
                    strokeLinecap='round'
                    strokeLinejoin='round'
                    strokeWidth={2}
                    d='M19 9l-7 7-7-7'
                  />
                </svg>
              </div>
            </button>

            {/* Collapsible Final Video Content */}
            {isFinalVideoExpanded && (
              <div>
                <FinalVideoTable />
              </div>
            )}
          </div>

          {/* Timestamp Display */}
        </div>
      )}
    </div>
  );
}
