'use client';

import React, { useState, useCallback, useEffect, useRef } from 'react';
import {
  updateBaserowRow,
  updateSceneRow,
  BaserowRow,
  getSceneById,
} from '@/lib/baserow-actions';
import { useAppStore } from '@/store/useAppStore';
import { cycleSpeed as cycleThroughSpeeds } from '@/utils/batchOperations';
import { playSuccessSound, playErrorSound } from '@/utils/soundManager';
import {
  Loader2,
  Sparkles,
  X,
  Play,
  Pause,
  Video,
  Square,
  CheckCircle,
  Monitor,
  Settings,
  Volume2,
  VolumeX,
  Scissors,
  Keyboard,
  ChevronDown,
  Plus,
  Minus,
  Upload,
  FastForward,
  ImageIcon,
  Wand2,
} from 'lucide-react';
import { ImageOverlayModal } from './ImageOverlayModal';

// Helper: get original sentence from field_6901

interface SceneCardProps {
  data: BaserowRow[];
  refreshData?: () => void;
  refreshing?: boolean;
  onDataUpdate?: (updatedData: BaserowRow[]) => void;
  onHandlersReady?: (handlers: {
    handleAutoFixMismatch: (
      sceneId: number,
      sceneData?: BaserowRow,
    ) => Promise<void>;
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
    handleTranscribeScene: (
      sceneId: number,
      sceneData?: unknown,
      videoType?: 'original' | 'final',
      skipRefresh?: boolean,
      skipSound?: boolean,
    ) => Promise<void>;
    handleTypingEffect: (
      sceneId: number,
      sceneData?: BaserowRow,
    ) => Promise<void>;
    handleConvertToCFR: (
      sceneId: number,
      sceneData?: BaserowRow,
    ) => Promise<void>;
    handleConvertOriginalToCFR: (
      sceneId: number,
      sceneData?: BaserowRow,
      playSound?: boolean,
    ) => Promise<void>;
    handleConvertFinalToCFR: (
      sceneId: number,
      sceneData?: BaserowRow,
      playSound?: boolean,
    ) => Promise<void>;
    handleNormalizeAudio: (
      sceneId: number,
      sceneData?: BaserowRow,
    ) => Promise<void>;
    handleNormalizeOriginalVideo: (
      sceneId: number,
      sceneData?: BaserowRow,
    ) => Promise<void>;
    handleNormalizeFinalVideo: (
      sceneId: number,
      sceneData?: BaserowRow,
    ) => Promise<void>;
    handleOptimizeSilence: (
      sceneId: number,
      sceneData?: BaserowRow,
    ) => Promise<void>;
    handleOptimizeSilenceOriginal: (
      sceneId: number,
      sceneData?: BaserowRow,
      playSound?: boolean,
    ) => Promise<void>;
    handleOptimizeSilenceFinal: (
      sceneId: number,
      sceneData?: BaserowRow,
      playSound?: boolean,
    ) => Promise<void>;
  }) => void;
}

export default function SceneCard({
  data,
  refreshData,
  refreshing = false,
  onDataUpdate,
  onHandlersReady,
}: SceneCardProps) {
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editingText, setEditingText] = useState<string>('');
  const [isUpdating, setIsUpdating] = useState<boolean>(false);
  const [isCanceling, setIsCanceling] = useState<boolean>(false);
  // NOTE: no clearing ref needed now — clearing is triggered from non-edit view
  const [loadingAudio, setLoadingAudio] = useState<number | null>(null);
  const [loadingVideo, setLoadingVideo] = useState<number | null>(null);
  const [loadingProducedVideo, setLoadingProducedVideo] = useState<
    number | null
  >(null);
  const [uploadingSceneVideo, setUploadingSceneVideo] = useState<number | null>(
    null,
  );
  const [applyCfrAfterUpload, setApplyCfrAfterUpload] = useState<boolean>(true);
  const [applyNormalizeAfterUpload, setApplyNormalizeAfterUpload] =
    useState<boolean>(true);
  const [applySilenceAfterUpload, setApplySilenceAfterUpload] =
    useState<boolean>(true);
  const [applyTranscribeAfterUpload, setApplyTranscribeAfterUpload] =
    useState<boolean>(true);
  const audioRefs = useRef<Record<number, HTMLAudioElement>>({});
  const videoRefs = useRef<Record<number, HTMLVideoElement>>({});
  const producedVideoRefs = useRef<Record<number, HTMLVideoElement>>({});
  const dropdownRefs = useRef<Record<number, HTMLDivElement>>({});

  // Use refs to store stable references to props
  const dataRef = useRef(data);
  const onDataUpdateRef = useRef(onDataUpdate);
  const refreshDataRef = useRef(refreshData);

  // Update refs when props change
  useEffect(() => {
    dataRef.current = data;
    onDataUpdateRef.current = onDataUpdate;
    refreshDataRef.current = refreshData;
  }, [data, onDataUpdate, refreshData]);
  const sceneCardRefs = useRef<Record<number, HTMLDivElement>>({});

  // Filter and sort states
  const [sortByDuration, setSortByDuration] = useState<'asc' | 'desc' | null>(
    null,
  );
  const [sortByLastModified, setSortByLastModified] = useState<
    'asc' | 'desc' | null
  >(null);
  const [showOnlyEmptyText, setShowOnlyEmptyText] = useState<boolean>(false);
  const [showOnlyNotEmptyText, setShowOnlyNotEmptyText] =
    useState<boolean>(false);
  const [showTimeAdjustment, setShowTimeAdjustment] = useState<number | null>(
    null,
  );
  const [showRecentlyModifiedTTS, setShowRecentlyModifiedTTS] =
    useState<boolean>(false);
  const [updatingTime, setUpdatingTime] = useState<Set<number>>(new Set());
  const [dropdownPositions, setDropdownPositions] = useState<
    Record<number, 'up' | 'down'>
  >({});
  const [inputValues, setInputValues] = useState<{
    [key: number]: { start: string | undefined; end: string | undefined };
  }>({});
  // Local zoom level state for Sync button (0 = no zoom, cycles by 10%)
  const [syncZoomLevel, setSyncZoomLevel] = useState<number>(0);
  // Local pan mode state - 'none', 'zoom' (zoom pan), 'zoomOut' (zoom out), or 'topToBottom' (vertical pan)
  const [syncPanMode, setSyncPanMode] = useState<
    'none' | 'zoom' | 'zoomOut' | 'topToBottom'
  >('none');
  // Dropdown open state for pan mode selector - stores the scene ID of the open dropdown (null if closed)
  const [panModeDropdownOpen, setPanModeDropdownOpen] = useState<number | null>(
    null,
  );

  // Image overlay modal state
  const [imageOverlayModal, setImageOverlayModal] = useState<{
    isOpen: boolean;
    sceneId: number | null;
    videoUrl: string | null;
  }>({
    isOpen: false,
    sceneId: null,
    videoUrl: null,
  });
  const [addingImageOverlay, setAddingImageOverlay] = useState<number | null>(
    null,
  );

  const [autoFixingMismatchSceneId, setAutoFixingMismatchSceneId] = useState<
    number | null
  >(null);
  const [autoFixMismatchStatus, setAutoFixMismatchStatus] = useState<
    Record<number, string | null>
  >({});

  type CaptionsWord = { word: string; start: number; end: number };

  // State for improving all sentences
  // OpenRouter model selection - now using global state

  // Global settings from store
  const {
    ttsSettings,
    videoSettings,
    transcriptionSettings,
    updateTTSSettings,
    updateVideoSettings,
    updateTranscriptionSettings,
    batchOperations,
    startBatchOperation,
    completeBatchOperation,
    mediaPlayer,
    setPlayingAudio,
    setPlayingVideo,
    setPlayingProducedVideo,
    stopAllMedia,
    modelSelection,
    setSelectedModel,
    setModels,
    setModelsLoading,
    setModelsError,
    setModelSearch,
    fetchModels,
    sceneLoading,
    setProducingTTS,
    setImprovingSentence,
    setSpeedingUpVideo,
    setTranscribingScene,
    setData,
    setGeneratingVideo,
    setConvertingToCFRVideo,
    setNormalizingAudio,
    clipGeneration,
    setGeneratingSingleClip,
    setCreatingTypingEffect,
  } = useAppStore();

  // Click outside handler for time adjustment and settings dropdowns
  useEffect(() => {
    const handleClickOutside = async (event: MouseEvent) => {
      const target = event.target as Element;

      // Handle time adjustment dropdown
      if (showTimeAdjustment !== null) {
        if (!target.closest('[data-time-adjustment-dropdown]')) {
          // Save any pending input values before closing
          const sceneInputValues = inputValues[showTimeAdjustment];
          if (sceneInputValues) {
            if (sceneInputValues.start !== undefined) {
              const startValue = parseFloat(sceneInputValues.start || '0') || 0;
              await handleSetStartTime(showTimeAdjustment, startValue);
            }
            if (sceneInputValues.end !== undefined) {
              const endValue = parseFloat(sceneInputValues.end || '0') || 0;
              await handleSetEndTime(showTimeAdjustment, endValue);
            }
          }
          setShowTimeAdjustment(null);
        }
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [showTimeAdjustment, inputValues]);

  // Helper function to scroll a scene card to the top of the screen
  const scrollCardToTop = (sceneId: number) => {
    const cardElement = sceneCardRefs.current[sceneId];
    console.log('Attempting to scroll card for scene:', sceneId);
    console.log('Card element found:', cardElement);

    if (cardElement) {
      // Scroll with a small delay to ensure the state is updated
      setTimeout(() => {
        cardElement.scrollIntoView({
          behavior: 'smooth',
          block: 'start',
          inline: 'nearest',
        });
        console.log('Scroll command executed for scene:', sceneId);
      }, 150);
    } else {
      console.warn('Card element not found for scene:', sceneId);
    }
  };

  const handleProducedVideoPlay = useCallback(
    async (sceneId: number, videoUrl: string) => {
      try {
        // Stop any currently playing produced video
        if (
          mediaPlayer.playingProducedVideoId &&
          producedVideoRefs.current[mediaPlayer.playingProducedVideoId]
        ) {
          producedVideoRefs.current[mediaPlayer.playingProducedVideoId].pause();
        }

        // Stop any currently playing original video
        if (
          mediaPlayer.playingVideoId &&
          videoRefs.current[mediaPlayer.playingVideoId]
        ) {
          videoRefs.current[mediaPlayer.playingVideoId].pause();
          setPlayingVideo(null);
        }

        // If clicking the same video that's playing, just pause it
        if (mediaPlayer.playingProducedVideoId === sceneId) {
          setPlayingProducedVideo(null);
          return;
        }

        setPlayingProducedVideo(sceneId);
        setLoadingProducedVideo(sceneId);

        // Wait a moment for the video element to be rendered, then scroll
        setTimeout(() => {
          // Scroll the card to the top of the screen
          scrollCardToTop(sceneId);

          const video = producedVideoRefs.current[sceneId];
          if (video) {
            video.src = videoUrl;
            video.playbackRate = videoSettings.playerSpeed;
            video
              .play()
              .then(() => {
                setLoadingProducedVideo(null);
              })
              .catch((error) => {
                console.error('Error playing produced video:', error);
                setLoadingProducedVideo(null);
                setPlayingProducedVideo(null);
              });
          }
        }, 100);
      } catch (error) {
        console.error('Error in handleProducedVideoPlay:', error);
        setLoadingProducedVideo(null);
        setPlayingProducedVideo(null);
      }
    },
    [
      mediaPlayer.playingProducedVideoId,
      mediaPlayer.playingVideoId,
      videoSettings.playerSpeed,
      scrollCardToTop,
    ],
  );

  // Keyboard shortcuts for player speed
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      // When the image overlay modal is open, don't let homepage shortcuts run.
      if (imageOverlayModal.isOpen) return;

      // Only handle shortcuts when not typing in input fields
      if (
        event.target instanceof HTMLInputElement ||
        event.target instanceof HTMLTextAreaElement ||
        event.target instanceof HTMLSelectElement
      ) {
        return;
      }

      // Handle arrow key navigation for final videos
      if (event.key === 'ArrowRight' || event.key === 'ArrowLeft') {
        event.preventDefault();

        // Find the currently playing produced video scene
        const currentPlayingSceneId = mediaPlayer.playingProducedVideoId;
        if (!currentPlayingSceneId) return;

        // Compute filtered and sorted data locally to avoid dependency issues
        let filtered = data;

        // Filter by empty text
        if (showOnlyEmptyText) {
          filtered = filtered.filter((scene) => {
            const sentence = String(
              scene['field_6890'] || scene.field_6890 || '',
            );
            return !sentence.trim();
          });
        }

        // Filter by not-empty original fields
        if (showOnlyNotEmptyText) {
          filtered = filtered.filter((scene) => {
            const orig = String(
              scene['field_6901'] || scene.field_6901 || '',
            ).trim();
            const other = String(
              scene['field_6900'] || scene.field_6900 || '',
            ).trim();
            return !!orig || !!other;
          });
        }

        // Filter by recently modified TTS
        if (showRecentlyModifiedTTS) {
          const oneDayAgo = Date.now() - 10 * 24 * 60 * 60 * 1000;
          filtered = filtered.filter((scene) => {
            const url = scene.field_6891 || scene['field_6891'];
            if (!url || typeof url !== 'string') return false;
            const match = url.match(/_(\d+)\.wav$/);
            if (!match) return false;
            const timestamp = parseInt(match[1]);
            if (isNaN(timestamp)) return false;
            return timestamp >= oneDayAgo;
          });
        }

        // Sort by duration
        if (sortByDuration) {
          filtered = [...filtered].sort((a, b) => {
            const durationA = Number(a.field_6884) || 0;
            const durationB = Number(b.field_6884) || 0;
            if (sortByDuration === 'asc') {
              return durationA - durationB;
            } else {
              return durationB - durationA;
            }
          });
        }

        // Sort by last modified
        if (sortByLastModified) {
          filtered = [...filtered].sort((a, b) => {
            const getLastModified = (scene: Record<string, unknown>) => {
              const lastModified = scene.field_6905 || scene['field_6905'];
              if (!lastModified) return 0;
              if (typeof lastModified === 'string') {
                const date = new Date(lastModified);
                const timestamp = date.getTime();
                return isNaN(timestamp) ? 0 : timestamp;
              } else if (typeof lastModified === 'number') {
                return lastModified;
              }
              return 0;
            };
            const timeA = getLastModified(a);
            const timeB = getLastModified(b);
            if (sortByLastModified === 'asc') {
              return timeA - timeB;
            } else {
              return timeB - timeA;
            }
          });
        }

        // Find the current scene index in filtered and sorted data
        const currentIndex = filtered.findIndex(
          (scene) => scene.id === currentPlayingSceneId,
        );
        if (currentIndex === -1) return;

        // Calculate next/previous index
        let targetIndex;
        if (event.key === 'ArrowRight') {
          targetIndex = currentIndex + 1;
        } else {
          targetIndex = currentIndex - 1;
        }

        // Check bounds
        if (targetIndex < 0 || targetIndex >= filtered.length) return;

        // Get target scene
        const targetScene = filtered[targetIndex];
        const finalVideoUrl =
          targetScene['field_6886'] || targetScene.field_6886;

        // Only navigate if the target scene has a final video
        if (finalVideoUrl && typeof finalVideoUrl === 'string') {
          handleProducedVideoPlay(targetScene.id, finalVideoUrl);
        }

        return;
      }

      let newSpeed: number | null = null;

      // Handle player speed shortcuts
      if (
        event.key === '1' &&
        !event.ctrlKey &&
        !event.metaKey &&
        !event.altKey
      ) {
        event.preventDefault();
        newSpeed = 1;
      } else if (
        event.key === '2' &&
        !event.ctrlKey &&
        !event.metaKey &&
        !event.altKey
      ) {
        event.preventDefault();
        newSpeed = 2;
      }

      if (newSpeed !== null) {
        // For speed 1x, refresh data first to get the newest created content
        if (newSpeed === 1 && refreshDataRef.current) {
          refreshDataRef.current();
        }

        // Restart currently playing video with new speed (temporary change)
        const restartVideo = (
          video: HTMLVideoElement | null,
          sceneId: number,
        ) => {
          if (video) {
            // Find the current scene data to get the latest URL
            const currentScene = dataRef.current.find(
              (scene) => scene.id === sceneId,
            );
            if (currentScene) {
              // Update video source with the latest URL
              const videoUrl =
                mediaPlayer.playingProducedVideoId === sceneId
                  ? currentScene['field_6886'] || currentScene.field_6886
                  : currentScene['field_6888'] || currentScene.field_6888;

              if (videoUrl && typeof videoUrl === 'string') {
                video.src = videoUrl;
              }
            }

            video.currentTime = 0;
            video.playbackRate = newSpeed;
            video.play().catch((error) => {
              console.error('Error restarting video:', error);
            });
          }
        };

        // Check if there's a video currently playing and restart it
        if (mediaPlayer.playingVideoId) {
          const video = videoRefs.current[mediaPlayer.playingVideoId];
          restartVideo(video, mediaPlayer.playingVideoId);
        } else if (mediaPlayer.playingProducedVideoId) {
          const video =
            producedVideoRefs.current[mediaPlayer.playingProducedVideoId];
          restartVideo(video, mediaPlayer.playingProducedVideoId);
        }
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [
    updateVideoSettings,
    mediaPlayer.playingVideoId,
    mediaPlayer.playingProducedVideoId,
    imageOverlayModal.isOpen,
    handleProducedVideoPlay,
    data,
    showOnlyEmptyText,
    showOnlyNotEmptyText,
    sortByDuration,
    sortByLastModified,
    showRecentlyModifiedTTS,
  ]);

  // Local wrapper for cycling through speeds
  const cycleSpeed = () => {
    cycleThroughSpeeds(videoSettings.selectedSpeed, updateVideoSettings);
  };

  // State for revert loading
  const [revertingId, setRevertingId] = useState<number | null>(null);

  // State for removing TTS
  const [removingTTSId, setRemovingTTSId] = useState<number | null>(null);

  // State for clearing video
  const [clearingVideoId, setClearingVideoId] = useState<number | null>(null);

  // Revert to original sentence handler
  const handleRevertToOriginal = async (sceneId: number) => {
    const currentScene = data.find((scene) => scene.id === sceneId);
    if (!currentScene) return;
    const originalSentence = currentScene.field_6901;
    if (!originalSentence || originalSentence === currentScene.field_6890)
      return;
    setRevertingId(sceneId);
    // Optimistic update
    const optimisticData = data.map((scene) =>
      scene.id === sceneId ? { ...scene, field_6890: originalSentence } : scene,
    );
    onDataUpdate?.(optimisticData);
    try {
      await updateSceneRow(sceneId, { field_6890: originalSentence });
      refreshData?.();
    } catch (error) {
      console.error('Failed to revert sentence:', error);
      // Revert optimistic update on error
      onDataUpdate?.(data);
    } finally {
      setRevertingId(null);
    }
  };

  // Remove TTS audio handler
  const handleRemoveTTS = async (sceneId: number) => {
    setRemovingTTSId(sceneId);
    // Stop audio if playing
    if (mediaPlayer.playingAudioId === sceneId) {
      handleAudioPause(sceneId);
    }
    // Optimistic update
    const optimisticData = data.map((scene) =>
      scene.id === sceneId ? { ...scene, field_6891: '' } : scene,
    );
    onDataUpdate?.(optimisticData);
    try {
      await updateSceneRow(sceneId, { field_6891: '' });
      refreshData?.();
    } catch (error) {
      console.error('Failed to remove TTS:', error);
      // Revert optimistic update on error
      onDataUpdate?.(data);
    } finally {
      setRemovingTTSId(null);
    }
  };

  // Clear video field handler
  const handleClearVideo = async (sceneId: number) => {
    setClearingVideoId(sceneId);
    // Stop video if playing
    if (mediaPlayer.playingVideoId === sceneId) {
      handleVideoStop(sceneId);
    }
    // Optimistic update
    const optimisticData = data.map((scene) =>
      scene.id === sceneId ? { ...scene, field_6886: '' } : scene,
    );
    onDataUpdate?.(optimisticData);
    try {
      await updateSceneRow(sceneId, { field_6886: '' });
      refreshData?.();
    } catch (error) {
      console.error('Failed to clear video:', error);
      // Revert optimistic update on error
      onDataUpdate?.(data);
    }
  };

  // State for combining scenes
  const [combiningId, setCombiningId] = useState<number | null>(null);

  // Combine this scene with the next scene (remove next scene, append its text, update timings)
  const handleCombineWithNext = async (sceneId: number) => {
    // Prevent multiple simultaneous combines
    if (combiningId !== null) return;

    const index = filteredAndSortedData.findIndex((s) => s.id === sceneId);
    if (index === -1) return;
    if (index === filteredAndSortedData.length - 1) {
      alert('No next scene to combine with.');
      return;
    }

    const currentScene = filteredAndSortedData[index];
    const nextScene = filteredAndSortedData[index + 1];
    if (!currentScene || !nextScene) return;

    // Prepare new text fields
    const currSentence = String(currentScene.field_6890 || '').trim();
    const nextSentence = String(
      nextScene.field_6890 || nextScene.field_6901 || '',
    ).trim();
    const sep = currSentence && nextSentence ? ' ' : '';
    const newSentence = (currSentence + sep + nextSentence).trim();

    const currOriginal = String(
      currentScene.field_6901 || currentScene.field_6890 || '',
    ).trim();
    const nextOriginal = String(
      nextScene.field_6901 || nextScene.field_6890 || '',
    ).trim();
    const newOriginal = (currOriginal + sep + nextOriginal).trim();

    const newEndTime = Number(nextScene.field_6897) || 0;
    const currentStart = Number(currentScene.field_6896) || 0;
    const newDuration = Math.max(
      0,
      Number((newEndTime - currentStart).toFixed(2)),
    );

    setCombiningId(sceneId);

    // Optimistic update: update current scene and remove next one from local copy
    const optimisticData = data
      .map((s) =>
        s.id === sceneId
          ? {
              ...s,
              field_6890: newSentence,
              field_6901: newOriginal,
              field_6897: newEndTime,
              field_6884: newDuration,
            }
          : s,
      )
      .filter((s) => s.id !== nextScene.id);

    onDataUpdate?.(optimisticData);

    try {
      // Update current scene in Baserow
      await updateSceneRow(sceneId, {
        field_6890: newSentence,
        field_6901: newOriginal,
        field_6897: newEndTime,
        field_6884: newDuration,
      });

      // Delete the next scene row via API
      const res = await fetch(`/api/baserow/scenes/${nextScene.id}`, {
        method: 'DELETE',
      });

      if (!res.ok) {
        const t = await res.text().catch(() => '');
        throw new Error(`Failed to delete next scene: ${res.status} ${t}`);
      }

      playSuccessSound();
      refreshData?.();
    } catch (error) {
      console.error('Failed to combine scenes:', error);
      playErrorSound();
      alert('Failed to combine scenes. Please try again.');
      // Revert optimistic update
      onDataUpdate?.(data);
    } finally {
      setCombiningId(null);
    }
  };

  // Calculate dropdown position based on available space
  const calculateDropdownPosition = (sceneId: number) => {
    const dropdownRef = dropdownRefs.current[sceneId];
    if (!dropdownRef) return 'down';

    const rect = dropdownRef.getBoundingClientRect();
    const dropdownHeight = 300; // Approximate height of dropdown
    const windowHeight = window.innerHeight;
    const spaceBelow = windowHeight - rect.bottom;
    const spaceAbove = rect.top;

    // If there's not enough space below but enough space above, open upwards
    if (spaceBelow < dropdownHeight && spaceAbove > dropdownHeight) {
      return 'up';
    }
    return 'down';
  };

  const handleSceneVideoUpload = async (
    sceneId: number,
    file: File,
    applyCfrAfterUpload: boolean = false,
    applyNormalizeAfterUpload: boolean = false,
    applySilenceAfterUpload: boolean = false,
    applyTranscribeAfterUpload: boolean = true,
  ) => {
    if (!file.type.startsWith('video/')) {
      alert('Please select a video file');
      return;
    }

    const maxSize = 10 * 1024 * 1024 * 1024; // 10GB
    if (file.size > maxSize) {
      alert('File size must be less than 10GB');
      return;
    }

    setUploadingSceneVideo(sceneId);

    try {
      // Get the current scene data to extract video ID
      const currentScene = data.find((scene) => scene.id === sceneId);
      if (!currentScene) {
        throw new Error('Scene not found');
      }

      // Extract videoId from scene data (can be number, string, or array)
      let videoId: number | null = null;
      const videoIdField = currentScene.field_6889;
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

      if (!videoId) {
        throw new Error('Video ID not found for scene');
      }

      const formData = new FormData();
      formData.append('file', file);
      formData.append('sceneId', sceneId.toString());
      formData.append('videoId', videoId.toString());
      formData.append('applyNormalize', applyNormalizeAfterUpload.toString());
      formData.append('applyCfr', applyCfrAfterUpload.toString());
      formData.append('applySilence', applySilenceAfterUpload.toString());
      formData.append('applyTranscribe', applyTranscribeAfterUpload.toString());
      formData.append(
        'transcriptionModel',
        transcriptionSettings.selectedModel,
      );
      formData.append(
        'transcriptionVideoType',
        transcriptionSettings.selectedVideoType,
      );

      console.log('Processing file:', file.name, 'Size:', file.size);
      console.log('Scene ID:', sceneId, 'Video ID:', videoId);
      console.log(
        'Processing options - Normalize:',
        applyNormalizeAfterUpload,
        'CFR:',
        applyCfrAfterUpload,
        'Silence:',
        applySilenceAfterUpload,
        'Transcribe:',
        applyTranscribeAfterUpload,
      );

      const response = await fetch('/api/process-scene-video', {
        method: 'POST',
        body: formData,
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Processing failed');
      }

      const result = await response.json();
      const processedUrl = result.videoUrl;

      console.log('Processing successful, URL:', processedUrl);
      console.log('Updating scene', sceneId, 'with fields 6886 and 6888');

      // Update both Videos (6886) and Video Clip URL (6888) fields in scenes table
      await updateSceneRow(sceneId, {
        field_6886: processedUrl,
        field_6888: processedUrl,
      });

      console.log('Scene update successful');

      // Refresh data from server to ensure consistency
      refreshData?.();

      // Update local state as well for immediate UI feedback
      const updatedData = data.map((scene) =>
        scene.id === sceneId
          ? { ...scene, field_6886: processedUrl, field_6888: processedUrl }
          : scene,
      );
      onDataUpdate?.(updatedData);

      // Play success sound
      playSuccessSound();
    } catch (error) {
      console.error('Failed to process scene video:', error);
      playErrorSound();
      alert('Failed to process video. Please try again.');
    } finally {
      setUploadingSceneVideo(null);
    }
  };

  const handleAdjustStartTime = async (sceneId: number, adjustment: number) => {
    // Prevent multiple simultaneous updates for the same scene
    if (updatingTime.has(sceneId)) return;

    const currentScene = data.find((scene) => scene.id === sceneId);
    if (!currentScene) return;

    setUpdatingTime((prev) => new Set(prev).add(sceneId));

    const currentStartTime = Number(currentScene.field_6896) || 0;
    const currentEndTime = Number(currentScene.field_6897) || 0;
    const newStartTime = Math.max(
      0,
      Number((currentStartTime + adjustment).toFixed(2)),
    );
    const newDuration = Math.max(
      0,
      Number((currentEndTime - newStartTime).toFixed(2)),
    );

    // Optimistic update
    const optimisticData = data.map((scene) =>
      scene.id === sceneId
        ? {
            ...scene,
            field_6896: newStartTime,
            field_6898: newStartTime,
            field_6884: newDuration,
          }
        : scene,
    );
    onDataUpdate?.(optimisticData);

    try {
      await updateSceneRow(sceneId, {
        field_6896: newStartTime,
        field_6898: newStartTime,
        field_6884: newDuration,
      });
      // Removed refreshData call to prevent double updates
    } catch (error) {
      console.error('Failed to adjust start time:', error);
      // Revert optimistic update on error
      onDataUpdate?.(data);
    } finally {
      setUpdatingTime((prev) => {
        const newSet = new Set(prev);
        newSet.delete(sceneId);
        return newSet;
      });
    }
  };

  const handleAdjustEndTime = async (sceneId: number, adjustment: number) => {
    // Prevent multiple simultaneous updates for the same scene
    if (updatingTime.has(sceneId)) return;

    const currentScene = data.find((scene) => scene.id === sceneId);
    if (!currentScene) return;

    setUpdatingTime((prev) => new Set(prev).add(sceneId));

    const currentEndTime = Number(currentScene.field_6897) || 0;
    const currentStartTime = Number(currentScene.field_6896) || 0;
    const newEndTime = Math.max(
      0,
      Number((currentEndTime + adjustment).toFixed(2)),
    );
    const newDuration = Math.max(
      0,
      Number((newEndTime - currentStartTime).toFixed(2)),
    );

    // Optimistic update
    const optimisticData = data.map((scene) =>
      scene.id === sceneId
        ? { ...scene, field_6897: newEndTime, field_6884: newDuration }
        : scene,
    );
    onDataUpdate?.(optimisticData);

    try {
      await updateSceneRow(sceneId, {
        field_6897: newEndTime,
        field_6884: newDuration,
      });
      // Removed refreshData call to prevent double updates
    } catch (error) {
      console.error('Failed to adjust end time:', error);
      // Revert optimistic update on error
      onDataUpdate?.(data);
    } finally {
      setUpdatingTime((prev) => {
        const newSet = new Set(prev);
        newSet.delete(sceneId);
        return newSet;
      });
    }
  };

  const handleSetStartTime = async (sceneId: number, newStartTime: number) => {
    // Prevent multiple simultaneous updates for the same scene
    if (updatingTime.has(sceneId)) return;

    const currentScene = data.find((scene) => scene.id === sceneId);
    if (!currentScene) return;

    setUpdatingTime((prev) => new Set(prev).add(sceneId));

    const clampedStartTime = Math.max(0, Number(newStartTime.toFixed(2)));
    const currentEndTime = Number(currentScene.field_6897) || 0;
    const newDuration = Math.max(
      0,
      Number((currentEndTime - clampedStartTime).toFixed(2)),
    );

    // Optimistic update
    const optimisticData = data.map((scene) =>
      scene.id === sceneId
        ? {
            ...scene,
            field_6896: clampedStartTime,
            field_6898: clampedStartTime,
            field_6884: newDuration,
          }
        : scene,
    );
    onDataUpdate?.(optimisticData);

    try {
      await updateSceneRow(sceneId, {
        field_6896: clampedStartTime,
        field_6898: clampedStartTime,
        field_6884: newDuration,
      });
      // Removed refreshData call to prevent double updates
    } catch (error) {
      console.error('Failed to set start time:', error);
      // Revert optimistic update on error
      onDataUpdate?.(data);
    } finally {
      setUpdatingTime((prev) => {
        const newSet = new Set(prev);
        newSet.delete(sceneId);
        return newSet;
      });
    }
  };

  const handleSetEndTime = async (sceneId: number, newEndTime: number) => {
    // Prevent multiple simultaneous updates for the same scene
    if (updatingTime.has(sceneId)) return;

    const currentScene = data.find((scene) => scene.id === sceneId);
    if (!currentScene) return;

    setUpdatingTime((prev) => new Set(prev).add(sceneId));

    const clampedEndTime = Math.max(0, Number(newEndTime.toFixed(2)));
    const currentStartTime = Number(currentScene.field_6896) || 0;
    const newDuration = Math.max(
      0,
      Number((clampedEndTime - currentStartTime).toFixed(2)),
    );

    // Optimistic update
    const optimisticData = data.map((scene) =>
      scene.id === sceneId
        ? { ...scene, field_6897: clampedEndTime, field_6884: newDuration }
        : scene,
    );
    onDataUpdate?.(optimisticData);

    try {
      await updateSceneRow(sceneId, {
        field_6897: clampedEndTime,
        field_6884: newDuration,
      });
      // Removed refreshData call to prevent double updates
    } catch (error) {
      console.error('Failed to set end time:', error);
      // Revert optimistic update on error
      onDataUpdate?.(data);
    } finally {
      setUpdatingTime((prev) => {
        const newSet = new Set(prev);
        newSet.delete(sceneId);
        return newSet;
      });
    }
  };

  // Speed up video handler
  const handleSpeedUpVideo = useCallback(
    async (sceneId: number, sceneData?: BaserowRow, skipRefresh?: boolean) => {
      const currentScene =
        sceneData || data.find((scene) => scene.id === sceneId);
      if (!currentScene) return;

      const videoUrl = currentScene.field_6888 as string;
      if (!videoUrl || typeof videoUrl !== 'string' || !videoUrl.trim()) {
        console.log('No video found in field 6888 to speed up');
      }

      setSpeedingUpVideo(sceneId);

      try {
        // Extract videoId from sceneData
        let videoId = null;
        if (sceneData) {
          const videoIdField = sceneData['field_6889'];
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
        }

        console.log(
          'Starting speed-up for scene:',
          sceneId,
          'videoId:',
          videoId,
          'with video:',
          videoUrl,
        );

        const response = await fetch('/api/speed-up-video', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            sceneId,
            videoUrl,
            speed: videoSettings.selectedSpeed,
            muteAudio: videoSettings.muteAudio,
            videoId: videoId || undefined,
          }),
        });

        if (!response.ok) {
          let errorMessage = `Speed-up error: ${response.status}`;
          try {
            const errorData = await response.json();
            errorMessage = errorData.error || errorMessage;
          } catch (parseError) {
            errorMessage = `Speed-up error: ${response.status} - ${response.statusText}`;
          }
          throw new Error(errorMessage);
        }

        const result = await response.json();
        console.log('Speed-up result:', result);

        // Optimistic update - update field_6886 with the processed video
        const optimisticData = data.map((scene) =>
          scene.id === sceneId
            ? { ...scene, field_6886: result.videoUrl }
            : scene,
        );
        onDataUpdate?.(optimisticData);

        // Refresh data from server to ensure consistency (skip in batch mode)
        if (!skipRefresh) {
          refreshData?.();
        }
      } catch (error) {
        console.error('Error speeding up video:', error);
        let errorMessage = 'Failed to speed up video';
        if (error instanceof Error) {
          errorMessage = error.message;
        }
        console.log(`Error: ${errorMessage}`);
      } finally {
        setSpeedingUpVideo(null);
      }
    },
    [
      data,
      videoSettings.selectedSpeed,
      videoSettings.muteAudio,
      setSpeedingUpVideo,
      onDataUpdate,
      refreshData,
    ],
  );

  // Transcribe scene handler
  const handleTranscribeScene = useCallback(
    async (
      sceneId: number,
      sceneData?: unknown,
      videoType: 'original' | 'final' = 'original',
      skipRefresh: boolean = false,
      skipSound: boolean = false,
      updateSentence: boolean = true,
      opts?: { throwOnError?: boolean },
    ) => {
      const currentScene =
        (sceneData as BaserowRow | undefined) ||
        data.find((scene) => scene.id === sceneId);
      if (!currentScene) return;

      // Determine which video URL to use
      const videoUrl =
        videoType === 'final'
          ? (currentScene.field_6886 as string)
          : (currentScene.field_6888 as string);

      if (!videoUrl || typeof videoUrl !== 'string' || !videoUrl.trim()) {
        console.log(
          `No ${videoType} video found in field ${
            videoType === 'final' ? '6886' : '6888'
          } to transcribe`,
        );
        return;
      }

      setTranscribingScene(sceneId);

      try {
        console.log(
          `Starting scene transcription for scene: ${sceneId}, video type: ${videoType}, with video:`,
          videoUrl,
        );

        // Step 1: Transcribe the scene video using selected model
        const transcribeResponse = await fetch('/api/transcribe-scene', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            media_url: videoUrl,
            model: transcriptionSettings.selectedModel,
            scene_id: sceneId,
          }),
        });

        if (!transcribeResponse.ok) {
          throw new Error('Failed to transcribe scene');
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
        const filename = `scene_${sceneId}_captions_${timestamp}.json`;

        const formData = new FormData();
        const blob = new Blob([captionsData], { type: 'application/json' });
        formData.append('file', blob, filename);

        const uploadResponse = await fetch('/api/upload-captions', {
          method: 'POST',
          body: formData,
        });

        if (!uploadResponse.ok) {
          throw new Error('Failed to upload scene captions');
        }

        const uploadResult = await uploadResponse.json();
        console.log('Scene captions uploaded successfully:', uploadResult);

        // Step 4: Extract full text from transcription
        const fullText = wordTimestamps.map((word) => word.word).join(' ');
        console.log('Extracted full text from transcription:', fullText);

        // Step 5: Update the scene record with the captions URL (field_6910) and optional sentence text (field_6890)
        const captionsUrl = uploadResult.url || uploadResult.file_url;
        if (captionsUrl) {
          const updateData: Record<string, unknown> = {
            field_6910: captionsUrl, // Captions URL for Scene field
          };

          // Only update the sentence if we have extracted text
          if (updateSentence && fullText.trim()) {
            updateData.field_6890 = fullText.trim(); // Update Sentence field with transcribed text
            console.log('Updating scene sentence with transcribed text');
          }

          const patchRes = await fetch(`/api/baserow/scenes/${sceneId}`, {
            method: 'PATCH',
            headers: {
              'Content-Type': 'application/json',
            },
            body: JSON.stringify(updateData),
          });

          if (!patchRes.ok) {
            const errorText = await patchRes.text();
            throw new Error(
              `Failed to update scene ${sceneId}: ${patchRes.status} ${errorText}`,
            );
          }

          // Optimistic update: merge into the full global store dataset.
          // IMPORTANT: `onDataUpdate` in the page overwrites the store, so it must
          // receive the full dataset, not the currently displayed (filtered) subset.
          const currentStoreData = useAppStore.getState().data;
          const optimisticStoreData = currentStoreData.map((scene) =>
            scene.id === sceneId
              ? {
                  ...scene,
                  field_6910: captionsUrl,
                  ...(updateSentence && fullText.trim()
                    ? { field_6890: fullText.trim() }
                    : {}),
                }
              : scene,
          );
          onDataUpdate?.(optimisticStoreData);
          setData(optimisticStoreData);
        }

        // Refresh data from server to ensure consistency only when not skipped
        if (!skipRefresh) {
          refreshData?.();
        }

        // Play success sound (optional - suppress in batch)
        if (!skipSound) {
          playSuccessSound();
        }
      } catch (error) {
        console.error('Error transcribing scene:', error);

        // Play error sound (we'll keep this audible)
        playErrorSound();

        let errorMessage = 'Failed to transcribe scene';
        if (error instanceof Error) {
          errorMessage = error.message;
        }
        console.log(`Error: ${errorMessage}`);

        if (opts?.throwOnError) {
          throw error;
        }
      } finally {
        setTranscribingScene(null);
      }
    },
    [
      data,
      transcriptionSettings.selectedModel,
      transcriptionSettings.selectedVideoType,
      setTranscribingScene,
      onDataUpdate,
      refreshData,
      playSuccessSound,
      playErrorSound,
    ],
  );

  // Generate single clip handler
  const handleGenerateSingleClip = async (
    sceneId: number,
    sceneData?: BaserowRow,
  ) => {
    const currentScene =
      sceneData || data.find((scene) => scene.id === sceneId);
    if (!currentScene) return;

    const { generatingSingleClip } = clipGeneration;

    // Check if any scene is already generating (only one at a time)
    if (generatingSingleClip !== null) {
      return;
    }

    setGeneratingSingleClip(sceneId);

    // Extract video ID from scene data
    let videoId: number | null = null;
    if (currentScene) {
      const videoIdField = currentScene['field_6889'];
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
    }

    try {
      const response = await fetch('/api/generate-single-clip', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          sceneId,
          videoId: videoId || undefined,
        }),
      });

      if (!response.ok) {
        let errorMessage = `Clip generation error: ${response.status}`;
        try {
          const errorData = await response.json();
          errorMessage = errorData.error || errorMessage;
        } catch (parseError) {
          errorMessage = `Clip generation error: ${response.status} - ${response.statusText}`;
        }
        throw new Error(errorMessage);
      }

      const result = await response.json();
      console.log('Single clip generation result:', result);

      // Optimistic update - update the scene with the new clip URL
      const optimisticData = data.map((scene) =>
        scene.id === sceneId ? { ...scene, field_6897: result.clipUrl } : scene,
      );
      onDataUpdate?.(optimisticData);

      // Refresh data from server to ensure consistency
      refreshData?.();
    } catch (error) {
      console.error('Error generating single clip:', error);
      let errorMessage = 'Failed to generate clip';
      if (error instanceof Error) {
        errorMessage = error.message;
      }
      console.log(`Error: ${errorMessage}`);
    } finally {
      setGeneratingSingleClip(null);
    }
  };

  const handleEditStart = (sceneId: number, currentText: string) => {
    setEditingId(sceneId);
    setEditingText(currentText);
    setIsCanceling(false);
  };

  const handleEditSave = async (sceneId: number) => {
    // Allow saving an empty text (clearing the sentence). Previously we
    // prevented saving when the field was empty; remove that to allow
    // explicit clearing.

    const currentScene = data.find((scene) => scene.id === sceneId);
    if (editingText === currentScene?.field_6890) {
      setEditingId(null);
      setEditingText('');
      return;
    }

    setIsUpdating(true);

    // Optimistic update - immediately update the UI
    const optimisticData = data.map((scene) => {
      if (scene.id === sceneId) {
        return { ...scene, field_6890: editingText };
      }
      return scene;
    });
    onDataUpdate?.(optimisticData);

    try {
      // updateSceneRow returns the updated row data directly or throws an error
      const updatedRow = await updateSceneRow(sceneId, {
        field_6890: editingText,
      });

      setEditingId(null);
      setEditingText('');

      // Refresh data from server to ensure consistency
      refreshData?.();

      // Auto-generate TTS if option is enabled and text was actually changed
      if (videoSettings.autoGenerateTTS && editingText.trim()) {
        // Wait a moment to ensure the text is properly updated
        const sceneData = data.find((s) => s.id === sceneId);
        setTimeout(() => {
          handleTTSProduce(sceneId, editingText, sceneData);
        }, 500);
      }
    } catch (error) {
      console.error('Failed to update scene:', error);

      // Revert optimistic update on error
      onDataUpdate?.(data);

      // You could show a user-friendly error message here
    } finally {
      setIsUpdating(false);
    }
  };

  const handleEditSaveWithoutTTS = async (sceneId: number) => {
    // Allow saving an empty text (clear without generating TTS).

    const currentScene = data.find((scene) => scene.id === sceneId);
    if (editingText === currentScene?.field_6890) {
      setEditingId(null);
      setEditingText('');
      return;
    }

    setIsUpdating(true);

    // Optimistic update - immediately update the UI
    const optimisticData = data.map((scene) => {
      if (scene.id === sceneId) {
        return { ...scene, field_6890: editingText };
      }
      return scene;
    });
    onDataUpdate?.(optimisticData);

    try {
      // updateSceneRow returns the updated row data directly or throws an error
      const updatedRow = await updateSceneRow(sceneId, {
        field_6890: editingText,
      });

      setEditingId(null);
      setEditingText('');

      // Refresh data from server to ensure consistency
      refreshData?.();

      // Note: TTS generation is skipped for this save operation
    } catch (error) {
      console.error('Failed to update scene:', error);

      // Revert optimistic update on error
      onDataUpdate?.(data);

      // You could show a user-friendly error message here
    } finally {
      setIsUpdating(false);
    }
  };

  const handleEditCancel = () => {
    setIsCanceling(true);
    setEditingId(null);
    setEditingText('');
    setTimeout(() => setIsCanceling(false), 100); // Reset after a short delay
  };

  const handleClearSentenceField = useCallback(
    async (sceneId: number) => {
      if (isUpdating) return;
      setIsUpdating(true);

      try {
        // Optimistic update: clear only field_6890 (the editable sentence)
        const optimisticData = data.map((scene) => {
          if (scene.id === sceneId) {
            return { ...scene, field_6890: '' };
          }
          return scene;
        });
        onDataUpdate?.(optimisticData);

        // Persist change to Baserow (only field_6890)
        await updateSceneRow(sceneId, { field_6890: '' });

        // Close editor and clear editingText if open
        setEditingId(null);
        setEditingText('');

        refreshData?.();
      } catch (error) {
        console.error('Failed to clear sentence field:', error);
        // Revert optimistic update on error
        onDataUpdate?.(data);
      } finally {
        setIsUpdating(false);
      }
    },
    [data, onDataUpdate, refreshData, isUpdating],
  );

  const handleKeyDown = (e: React.KeyboardEvent, sceneId: number) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleEditSave(sceneId);
    } else if (e.key === 'Escape') {
      handleEditCancel();
    }
  };

  const handleAudioPlay = async (sceneId: number, audioUrl: string) => {
    try {
      // If the same audio is already playing, pause it
      if (mediaPlayer.playingAudioId === sceneId) {
        const audio = audioRefs.current[sceneId];
        if (audio) {
          audio.pause();
          setPlayingAudio(null);
        }
        return;
      }

      // Stop any currently playing audio
      if (
        mediaPlayer.playingAudioId &&
        audioRefs.current[mediaPlayer.playingAudioId]
      ) {
        audioRefs.current[mediaPlayer.playingAudioId].pause();
        setPlayingAudio(null);
      }

      setLoadingAudio(sceneId);

      // Use the existing audio element from refs
      const audio = audioRefs.current[sceneId];
      if (audio) {
        audio.src = audioUrl;
        audio.currentTime = 0;

        try {
          await audio.play();
          setLoadingAudio(null);
          setPlayingAudio(sceneId);
        } catch (error) {
          console.error('Error playing audio:', error);
          setLoadingAudio(null);
          setPlayingAudio(null);
        }
      }
    } catch (error) {
      console.error('Error in handleAudioPlay:', error);
      setPlayingAudio(null);
      setLoadingAudio(null);
    }
  };

  const handleAudioPause = (sceneId: number) => {
    const audio = audioRefs.current[sceneId];
    if (audio) {
      audio.pause();
      setPlayingAudio(null);
    }
  };

  const handleVideoPlay = async (sceneId: number, videoUrl: string) => {
    try {
      // Stop any currently playing original video
      if (
        mediaPlayer.playingVideoId &&
        videoRefs.current[mediaPlayer.playingVideoId]
      ) {
        videoRefs.current[mediaPlayer.playingVideoId].pause();
      }

      // Stop any currently playing produced video
      if (
        mediaPlayer.playingProducedVideoId &&
        producedVideoRefs.current[mediaPlayer.playingProducedVideoId]
      ) {
        producedVideoRefs.current[mediaPlayer.playingProducedVideoId].pause();
        setPlayingProducedVideo(null);
      }

      // If clicking the same video that's playing, just pause it
      if (mediaPlayer.playingVideoId === sceneId) {
        setPlayingVideo(null);
        return;
      }

      setPlayingVideo(sceneId);
      setLoadingVideo(sceneId);

      // Wait a moment for the video element to be rendered, then scroll
      setTimeout(() => {
        // Scroll the card to the top of the screen
        scrollCardToTop(sceneId);

        const video = videoRefs.current[sceneId];
        if (video) {
          video.src = videoUrl;
          video.playbackRate = videoSettings.playerSpeed;
          video
            .play()
            .then(() => {
              setLoadingVideo(null);
            })
            .catch((error) => {
              console.error('Error playing video:', error);
              setLoadingVideo(null);
              setPlayingVideo(null);
            });
        }
      }, 100);
    } catch (error) {
      console.error('Error in handleVideoPlay:', error);
      setLoadingVideo(null);
      setPlayingVideo(null);
    }
  };

  const handleVideoStop = (sceneId: number) => {
    const video = videoRefs.current[sceneId];
    if (video) {
      video.pause();
      setPlayingVideo(null);
    }
  };

  const handleProducedVideoStop = (sceneId: number) => {
    const video = producedVideoRefs.current[sceneId];
    if (video) {
      video.pause();
      setPlayingProducedVideo(null);
    }
  };

  // Image overlay handlers
  const handleOpenImageOverlayModal = (sceneId: number, videoUrl: string) => {
    setImageOverlayModal({
      isOpen: true,
      sceneId,
      videoUrl,
    });
  };

  const handleApplyImageOverlay = async (
    sceneId: number,
    overlayImage: File | null,
    overlayText: string | null,
    position: { x: number; y: number },
    size: { width: number; height: number },
    startTime: number,
    endTime: number,
    textStyling?: {
      fontColor: string;
      borderWidth: number;
      borderColor: string;
      shadowX: number;
      shadowY: number;
      shadowColor: string;
      shadowOpacity: number;
      fontFamily: string;
    },
    videoTintColor?: string | null,
    videoTintOpacity?: number,
    tintPosition?: { x: number; y: number },
    tintSize?: { width: number; height: number },
    tintInvert?: boolean,
    overlaySound?: string | null,
    overlayAnimation?:
      | 'none'
      | 'bounceIn'
      | 'spring'
      | 'fadeIn'
      | 'miniZoom'
      | 'zoomIn'
      | 'slideLeft'
      | 'slideRight'
      | 'slideUp',
    gifLoop?: boolean,
  ) => {
    try {
      setAddingImageOverlay(sceneId);

      const formData = new FormData();
      formData.append('sceneId', sceneId.toString());
      formData.append('videoUrl', imageOverlayModal.videoUrl!);
      if (overlayImage) {
        formData.append('overlayImage', overlayImage);
        if (overlayImage.type === 'image/gif') {
          formData.append('gifLoop', gifLoop === false ? 'false' : 'true');
        }
      }
      if (overlayText) {
        formData.append('overlayText', overlayText);
        if (textStyling) {
          formData.append('textStyling', JSON.stringify(textStyling));
        }
      }
      formData.append('positionX', position.x.toString());
      formData.append('positionY', position.y.toString());
      formData.append('sizeWidth', size.width.toString());
      formData.append('sizeHeight', size.height.toString());
      formData.append('startTime', startTime.toString());
      formData.append('endTime', endTime.toString());
      if (videoTintColor) {
        formData.append('videoTintColor', videoTintColor);
        if (
          typeof videoTintOpacity === 'number' &&
          Number.isFinite(videoTintOpacity)
        ) {
          formData.append('videoTintOpacity', videoTintOpacity.toString());
        }

        if (tintPosition) {
          formData.append('videoTintPositionX', tintPosition.x.toString());
          formData.append('videoTintPositionY', tintPosition.y.toString());
        }
        if (tintSize) {
          formData.append('videoTintWidth', tintSize.width.toString());
          formData.append('videoTintHeight', tintSize.height.toString());
        }
        if (typeof tintInvert === 'boolean') {
          formData.append('videoTintInvert', tintInvert ? 'true' : 'false');
        }
      }

      if (overlaySound) {
        formData.append('overlaySound', overlaySound);
      }

      if (overlayAnimation) {
        formData.append('overlayAnimation', overlayAnimation);
      }

      const response = await fetch('/api/add-image-overlay', {
        method: 'POST',
        body: formData,
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Failed to add overlay');
      }

      const result = await response.json();

      // Update the scene with the new video URL
      await updateBaserowRow(sceneId, {
        field_6886: result.url, // Update the final video field
      });

      // Refresh data to show the updated video
      if (refreshDataRef.current) {
        refreshDataRef.current();
      }

      playSuccessSound();
    } catch (error) {
      console.error('Error adding image overlay:', error);
      playErrorSound();
      throw error;
    } finally {
      setAddingImageOverlay(null);
    }
  };

  const handleTTSProduce = useCallback(
    async (
      sceneId: number,
      text: string,
      sceneData?: unknown,
      opts?: { seedOverride?: number; throwOnError?: boolean },
    ) => {
      try {
        setProducingTTS(sceneId);

        // Extract video ID from scene data
        let videoId: number | null = null;
        const typedSceneData = sceneData as BaserowRow | undefined;
        if (typedSceneData) {
          const videoIdField = typedSceneData['field_6889'];
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
        }

        // Call our TTS API route that handles generation and MinIO upload
        const response = await fetch('/api/generate-tts', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            text,
            sceneId,
            videoId: videoId || undefined,
            ttsSettings:
              typeof opts?.seedOverride === 'number'
                ? { ...ttsSettings, seed: opts.seedOverride }
                : ttsSettings,
          }),
        });

        if (!response.ok) {
          let errorMessage = `TTS service error: ${response.status}`;
          try {
            const errorData = await response.json();
            errorMessage = errorData.error || errorMessage;
          } catch (parseError) {
            // If response is not JSON, use the status text
            errorMessage = `TTS service error: ${response.status} - ${response.statusText}`;
          }
          throw new Error(errorMessage);
        }

        const result = await response.json();
        const audioUrl = result.audioUrl;

        // Update the Baserow field with the MinIO URL
        const updatedRow = await updateSceneRow(sceneId, {
          field_6891: audioUrl,
        });

        // Update the local data optimistically
        const updatedData = dataRef.current.map((scene) => {
          if (scene.id === sceneId) {
            return { ...scene, field_6891: audioUrl };
          }
          return scene;
        });
        onDataUpdateRef.current?.(updatedData);

        // Refresh data from server to ensure consistency
        refreshDataRef.current?.();

        // Auto-generate video if option is enabled
        if (videoSettings.autoGenerateVideo) {
          // Use sceneData if provided (from batch operation), otherwise look up in dataRef
          const currentScene =
            (typedSceneData as BaserowRow | undefined) ||
            dataRef.current.find((scene) => scene.id === sceneId);
          const videoUrl = currentScene?.field_6888;

          if (typeof videoUrl === 'string' && videoUrl) {
            // Wait a moment to ensure the TTS URL is properly updated
            setTimeout(() => {
              handleVideoGenerate(sceneId, videoUrl, audioUrl, currentScene);
            }, 1000);
          }
        }
      } catch (error) {
        console.error('Error producing TTS:', error);
        // You could show a user-friendly error message here

        if (opts?.throwOnError) {
          throw error;
        }
      } finally {
        setProducingTTS(null);
      }
    },
    [setProducingTTS, ttsSettings, videoSettings.autoGenerateVideo],
  );

  const handleVideoGenerate = useCallback(
    async (
      sceneId: number,
      videoUrl: string,
      audioUrl: string,
      sceneData?: unknown,
      zoomLevel: number = 0,
      panMode: 'none' | 'zoom' | 'zoomOut' | 'topToBottom' = 'none',
      opts?: { throwOnError?: boolean },
    ) => {
      try {
        setGeneratingVideo(sceneId);

        // Extract video ID from scene data
        let videoId: number | null = null;
        const typedSceneData = sceneData as BaserowRow | undefined;
        if (typedSceneData) {
          const videoIdField = typedSceneData['field_6889'];
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
        }

        // Call our API route instead of directly calling NCA service
        const response = await fetch('/api/generate-video', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            videoUrl,
            audioUrl,
            sceneId, // Pass sceneId for better tracking
            videoId: videoId || undefined,
            zoomLevel, // Pass zoom level for video zoom effect
            panMode, // Pass pan mode: 'none', 'zoom', or 'topToBottom'
          }),
        });

        if (!response.ok) {
          let errorMessage = `Video generation error: ${response.status}`;
          try {
            const errorData = await response.json();
            errorMessage = errorData.error || errorMessage;
          } catch (parseError) {
            errorMessage = `Video generation error: ${response.status} - ${response.statusText}`;
          }
          throw new Error(errorMessage);
        }

        const result = await response.json();
        const generatedVideoUrl = result.videoUrl;
        const isCached = result.cached === true;

        console.log(`[SYNC] Received video URL: ${generatedVideoUrl}`);
        console.log(`[SYNC] Updating Baserow scene ${sceneId} with field_6886`);

        // Update the Baserow field with the generated video URL
        const updatedRow = await updateSceneRow(sceneId, {
          field_6886: generatedVideoUrl,
        });

        console.log(`[SYNC] Baserow update result:`, updatedRow);

        // Update the local data optimistically
        const updatedData = dataRef.current.map((scene) => {
          if (scene.id === sceneId) {
            return { ...scene, field_6886: generatedVideoUrl };
          }
          return scene;
        });
        onDataUpdateRef.current?.(updatedData);

        // Only refresh from server if it's NOT a cache hit (to avoid wasteful refetch)
        if (!isCached) {
          refreshDataRef.current?.();
        }
      } catch (error) {
        console.error('Error generating synchronized video:', error);
        // You could show a user-friendly error message here

        if (opts?.throwOnError) {
          throw error;
        }
      } finally {
        setGeneratingVideo(null);
      }
    },
    [setGeneratingVideo],
  );

  const normalizeSpeechTextForCompare = useCallback((s: string) => {
    return String(s || '')
      .toLowerCase()
      .replace(/[’']/g, '')
      .replace(/[^a-z0-9\s]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }, []);

  const withCacheBustSafe = useCallback((url: string) => {
    const u = String(url || '').trim();
    if (!u) return u;
    const lower = u.toLowerCase();
    const looksSigned =
      lower.includes('x-amz-signature=') ||
      lower.includes('x-amz-algorithm=') ||
      lower.includes('x-amz-credential=') ||
      lower.includes('signature=') ||
      lower.includes('x-goog-signature=');
    if (looksSigned) return u;
    const sep = u.includes('?') ? '&' : '?';
    return `${u}${sep}t=${Date.now()}`;
  }, []);

  const fetchSceneCaptionsWords = useCallback(
    async (sceneId: number): Promise<CaptionsWord[] | null> => {
      const scene = await getSceneById(sceneId);
      const captionsUrlRaw =
        scene &&
        typeof (scene as Record<string, unknown>)['field_6910'] === 'string'
          ? String((scene as Record<string, unknown>)['field_6910'])
          : '';
      const captionsUrl = captionsUrlRaw.trim();
      if (!captionsUrl) return null;

      const res = await fetch(withCacheBustSafe(captionsUrl), {
        cache: 'no-store',
      });
      if (!res.ok) return null;
      const data = (await res.json().catch(() => null)) as unknown;
      if (!Array.isArray(data)) return null;

      return data
        .filter((w) => {
          if (!w || typeof w !== 'object') return false;
          const ww = w as Record<string, unknown>;
          return (
            typeof ww.word === 'string' &&
            typeof ww.start === 'number' &&
            typeof ww.end === 'number'
          );
        })
        .map((w) => {
          const ww = w as Record<string, unknown>;
          return {
            word: String(ww.word || ''),
            start: Number(ww.start || 0),
            end: Number(ww.end || 0),
          };
        }) as CaptionsWord[];
    },
    [withCacheBustSafe],
  );

  const waitForCaptionsWords = useCallback(
    async (
      sceneId: number,
      opts?: { maxRetries?: number; delayMs?: number },
    ): Promise<CaptionsWord[] | null> => {
      const maxRetries = opts?.maxRetries ?? 10;
      const delayMs = opts?.delayMs ?? 500;
      for (let i = 0; i < maxRetries; i++) {
        const w = await fetchSceneCaptionsWords(sceneId);
        if (w && w.length > 0) return w;
        await new Promise((r) => setTimeout(r, delayMs));
      }
      return null;
    },
    [fetchSceneCaptionsWords],
  );

  const sleep = useCallback((ms: number) => {
    return new Promise<void>((resolve) => setTimeout(resolve, ms));
  }, []);

  const getStringField = useCallback((row: unknown, key: string): string => {
    if (!row || typeof row !== 'object') return '';
    const v = (row as Record<string, unknown>)[key];
    if (typeof v !== 'string') return '';
    return v.trim();
  }, []);

  const waitForSceneWhere = useCallback(
    async (
      sceneId: number,
      predicate: (scene: Record<string, unknown>) => boolean,
      opts?: { maxRetries?: number; delayMs?: number },
    ): Promise<Record<string, unknown> | null> => {
      const maxRetries = opts?.maxRetries ?? 20;
      const delayMs = opts?.delayMs ?? 500;
      for (let i = 0; i < maxRetries; i++) {
        const scene = (await getSceneById(sceneId)) as Record<string, unknown>;
        if (scene && predicate(scene)) return scene;
        await sleep(delayMs);
      }
      return null;
    },
    [sleep],
  );

  const fetchCaptionsWordsFromUrl = useCallback(
    async (captionsUrl: string): Promise<CaptionsWord[] | null> => {
      const url = String(captionsUrl || '').trim();
      if (!url) return null;

      const res = await fetch(withCacheBustSafe(url), { cache: 'no-store' });
      if (!res.ok) return null;
      const data = (await res.json().catch(() => null)) as unknown;
      if (!Array.isArray(data)) return null;

      return data
        .filter((w) => {
          if (!w || typeof w !== 'object') return false;
          const ww = w as Record<string, unknown>;
          return (
            typeof ww.word === 'string' &&
            typeof ww.start === 'number' &&
            typeof ww.end === 'number'
          );
        })
        .map((w) => {
          const ww = w as Record<string, unknown>;
          return {
            word: String(ww.word || ''),
            start: Number(ww.start || 0),
            end: Number(ww.end || 0),
          };
        }) as CaptionsWord[];
    },
    [withCacheBustSafe],
  );

  const waitForCaptionsWordsFromUrl = useCallback(
    async (
      captionsUrl: string,
      opts?: { maxRetries?: number; delayMs?: number },
    ): Promise<CaptionsWord[] | null> => {
      const maxRetries = opts?.maxRetries ?? 20;
      const delayMs = opts?.delayMs ?? 500;
      for (let i = 0; i < maxRetries; i++) {
        const w = await fetchCaptionsWordsFromUrl(captionsUrl);
        if (w && w.length > 0) return w;
        await sleep(delayMs);
      }
      return null;
    },
    [fetchCaptionsWordsFromUrl, sleep],
  );

  const handleAutoFixMismatch = useCallback(
    async (sceneId: number, sceneData?: BaserowRow) => {
      if (autoFixingMismatchSceneId !== null) return;

      setAutoFixingMismatchSceneId(sceneId);
      setAutoFixMismatchStatus((prev) => ({ ...prev, [sceneId]: null }));

      const setStatus = (msg: string | null) => {
        setAutoFixMismatchStatus((prev) => ({ ...prev, [sceneId]: msg }));
      };

      try {
        const maxAttempts = 3;

        const setFlaggedTrue = async () => {
          try {
            const res = await fetch(`/api/baserow/scenes/${sceneId}`, {
              method: 'PATCH',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ field_7096: 'true' }),
            });
            if (!res.ok) {
              const t = await res.text().catch(() => '');
              console.warn(
                `Failed to set Flagged=true for scene ${sceneId}: ${res.status} ${t}`,
              );
            }
          } catch (e) {
            console.warn(`Failed to set Flagged=true for scene ${sceneId}:`, e);
          }
        };

        const initialScene =
          (sceneData as BaserowRow | undefined) ||
          (dataRef.current.find((s) => s.id === sceneId) as
            | BaserowRow
            | undefined);
        // Always trust Baserow for the latest sentence.
        const initialFromApi = (await getSceneById(sceneId)) as Record<
          string,
          unknown
        > | null;
        const desiredText = String(
          (initialFromApi?.field_6890 as string) ??
            initialScene?.field_6890 ??
            '',
        ).trim();
        if (!desiredText) {
          setStatus('Scene text is empty (field_6890).');
          return;
        }

        const a = normalizeSpeechTextForCompare(desiredText);
        if (!a) {
          setStatus('Scene text normalizes to empty.');
          return;
        }

        const baseVideoUrl = String(
          (initialFromApi?.field_6888 as string) ??
            initialScene?.field_6888 ??
            '',
        ).trim();
        const startingFinalUrl = String(
          (initialFromApi?.field_6886 as string) ??
            initialScene?.field_6886 ??
            '',
        ).trim();
        if (!baseVideoUrl) {
          setStatus('Missing original clip (field_6888).');
          return;
        }
        if (!startingFinalUrl) {
          setStatus('Missing final video (field_6886).');
          return;
        }

        // Bootstrap transcription if missing.
        setStatus('Checking transcription...');
        let words: CaptionsWord[] | null = null;
        let captionsUrl = getStringField(initialFromApi, 'field_6910');
        if (captionsUrl) {
          words = await waitForCaptionsWordsFromUrl(captionsUrl, {
            maxRetries: 6,
            delayMs: 350,
          });
        }
        if (!words) {
          setStatus('No captions yet — transcribing final video...');
          const sceneForTranscribe =
            (await waitForSceneWhere(
              sceneId,
              (s) => Boolean(getStringField(s, 'field_6886')),
              { maxRetries: 10, delayMs: 300 },
            )) || (initialFromApi as Record<string, unknown> | null);

          await handleTranscribeScene(
            sceneId,
            (sceneForTranscribe as unknown) ?? initialScene,
            'final',
            true,
            true,
            false,
            { throwOnError: true },
          );

          const sceneWithCaptions = await waitForSceneWhere(
            sceneId,
            (s) => Boolean(getStringField(s, 'field_6910')),
            { maxRetries: 20, delayMs: 400 },
          );
          captionsUrl = getStringField(sceneWithCaptions, 'field_6910');
          if (captionsUrl) {
            words = await waitForCaptionsWordsFromUrl(captionsUrl, {
              maxRetries: 20,
              delayMs: 400,
            });
          }
        }

        const toTranscriptText = (w: CaptionsWord[] | null) =>
          (w || [])
            .map((x) => String(x.word || '').trim())
            .filter(Boolean)
            .join(' ')
            .trim();

        const b0 = normalizeSpeechTextForCompare(toTranscriptText(words));
        if (a && b0 && a === b0) {
          setStatus('Match — nothing to do.');
          return;
        }

        for (let attempt = 1; attempt <= maxAttempts; attempt++) {
          setStatus(`Attempt ${attempt}/${maxAttempts}: regenerating TTS...`);

          // Use a 32-bit-ish seed.
          const maxSeed = 2_147_483_647;
          let seedBase = 0;
          try {
            if (typeof crypto !== 'undefined' && crypto.getRandomValues) {
              const buf = new Uint32Array(1);
              crypto.getRandomValues(buf);
              seedBase = Number(buf[0] || 0);
            }
          } catch {
            seedBase = 0;
          }
          if (!seedBase) seedBase = Math.floor(Math.random() * maxSeed);
          const seed = Math.max(1, (seedBase + attempt) % maxSeed);

          const beforeTtsScene = (await getSceneById(sceneId)) as Record<
            string,
            unknown
          > | null;
          const prevAudioUrl = getStringField(beforeTtsScene, 'field_6891');

          await handleTTSProduce(sceneId, desiredText, initialScene, {
            seedOverride: seed,
            throwOnError: true,
          });

          const afterTtsScene =
            (await waitForSceneWhere(
              sceneId,
              (s) => {
                const next = getStringField(s, 'field_6891');
                return Boolean(next) && next !== prevAudioUrl;
              },
              { maxRetries: 20, delayMs: 250 },
            )) || ((await getSceneById(sceneId)) as Record<string, unknown>);

          const audioUrl = getStringField(afterTtsScene, 'field_6891');
          const baseVideoUrlNow = getStringField(afterTtsScene, 'field_6888');
          if (!audioUrl.trim())
            throw new Error('Missing TTS audio URL (field_6891).');
          if (!(baseVideoUrlNow || baseVideoUrl).trim())
            throw new Error('Missing original clip URL (field_6888).');

          setStatus(`Attempt ${attempt}/${maxAttempts}: syncing video...`);
          const beforeSyncScene = (await getSceneById(sceneId)) as Record<
            string,
            unknown
          > | null;
          const prevFinalUrl = getStringField(beforeSyncScene, 'field_6886');
          await handleVideoGenerate(
            sceneId,
            (baseVideoUrlNow || baseVideoUrl).trim(),
            audioUrl,
            (afterTtsScene as unknown) ?? undefined,
            0,
            'none',
            { throwOnError: true },
          );

          // Wait for Baserow to reflect the new final video URL (or at least confirm it's present).
          const afterSyncScene =
            (await waitForSceneWhere(
              sceneId,
              (s) => {
                const next = getStringField(s, 'field_6886');
                if (!next) return false;
                // Prefer URL change, but if backend returns same URL we still proceed.
                return next !== prevFinalUrl || attempt === 1;
              },
              { maxRetries: 30, delayMs: 400 },
            )) || ((await getSceneById(sceneId)) as Record<string, unknown>);

          const finalUrlNow = getStringField(afterSyncScene, 'field_6886');
          if (!finalUrlNow) {
            throw new Error('Final video URL not available after sync.');
          }

          setStatus(`Attempt ${attempt}/${maxAttempts}: retranscribing...`);
          // IMPORTANT: Transcribe using a freshly fetched scene so we use the newest final URL.
          const sceneForTranscribe =
            (await waitForSceneWhere(
              sceneId,
              (s) => getStringField(s, 'field_6886') === finalUrlNow,
              { maxRetries: 10, delayMs: 250 },
            )) || afterSyncScene;

          const prevCaptionsUrl = getStringField(
            sceneForTranscribe,
            'field_6910',
          );
          await handleTranscribeScene(
            sceneId,
            (sceneForTranscribe as unknown) ?? undefined,
            'final',
            true,
            true,
            false,
            { throwOnError: true },
          );

          // Wait until captions URL is replaced in Baserow, then fetch from that URL.
          const sceneWithNewCaptions = await waitForSceneWhere(
            sceneId,
            (s) => {
              const next = getStringField(s, 'field_6910');
              return Boolean(next) && next !== prevCaptionsUrl;
            },
            { maxRetries: 30, delayMs: 350 },
          );
          const newCaptionsUrl =
            getStringField(sceneWithNewCaptions, 'field_6910') ||
            getStringField(
              (await getSceneById(sceneId)) as Record<string, unknown>,
              'field_6910',
            );

          const newWords = await waitForCaptionsWordsFromUrl(newCaptionsUrl, {
            maxRetries: 30,
            delayMs: 350,
          });
          const b2 = normalizeSpeechTextForCompare(toTranscriptText(newWords));
          if (a && b2 && a === b2) {
            setStatus(`Fixed — match after ${attempt}/${maxAttempts}.`);
            refreshDataRef.current?.();
            return;
          }
        }

        setStatus('Still mismatched after 3 attempts — flagging.');
        await setFlaggedTrue();
        setStatus('Still mismatched after 3 attempts. (Flagged=true)');
        refreshDataRef.current?.();
      } catch (err) {
        console.error('Auto-fix mismatch failed:', err);
        setStatus(
          err instanceof Error ? err.message : 'Auto-fix mismatch failed',
        );
      } finally {
        setAutoFixingMismatchSceneId(null);
      }
    },
    [
      autoFixingMismatchSceneId,
      dataRef,
      handleTranscribeScene,
      handleTTSProduce,
      handleVideoGenerate,
      getStringField,
      normalizeSpeechTextForCompare,
      sleep,
      waitForCaptionsWordsFromUrl,
      waitForCaptionsWords,
      waitForSceneWhere,
    ],
  );

  const handleSentenceImprovement = useCallback(
    async (
      sceneId: number,
      currentSentence: string,
      modelOverride?: string,
      sceneData?: BaserowRow,
      skipRefresh = false,
      enforceLongerSentences?: boolean,
    ) => {
      setImprovingSentence(sceneId);

      console.log(
        `Improving sentence for scene ${sceneId}: "${currentSentence}"`,
      );

      // Call our sentence improvement API route
      const response = await fetch('/api/improve-sentence', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          currentSentence,
          sceneId,
          model: modelOverride || modelSelection.selectedModel,
          enforceLongerSentences:
            enforceLongerSentences ?? modelSelection.enforceLongerSentences,
        }),
      });

      if (!response.ok) {
        let errorMessage = `Sentence improvement error: ${response.status}`;
        try {
          const errorData = await response.json();
          errorMessage = errorData.error || errorMessage;
        } catch (parseError) {
          errorMessage = `Sentence improvement error: ${response.status} - ${response.statusText}`;
        }
        console.error(`API Error for scene ${sceneId}:`, errorMessage);
        // Don't throw error - just log it and continue
        setImprovingSentence(null);
        return;
      }

      const result = await response.json();
      const improvedSentence = result.improvedSentence;

      console.log(`Improved sentence: "${improvedSentence}"`);

      // Update the Baserow field with the improved sentence
      try {
        await updateSceneRow(sceneId, {
          field_6890: improvedSentence,
        });
      } catch (updateError) {
        console.error(
          `Failed to update Baserow for scene ${sceneId}:`,
          updateError,
        );
        // Don't throw error - just log it and continue
        setImprovingSentence(null);
        return;
      }

      // Update the local data optimistically
      const updatedData = dataRef.current.map((scene) => {
        if (scene.id === sceneId) {
          return { ...scene, field_6890: improvedSentence };
        }
        return scene;
      });
      onDataUpdateRef.current?.(updatedData);

      // Refresh data from server to ensure consistency (skip if requested)
      if (!skipRefresh) {
        refreshDataRef.current?.();
      }

      // Auto-generate TTS if option is enabled
      if (videoSettings.autoGenerateTTS && improvedSentence.trim()) {
        // Wait a moment to ensure the text is properly updated
        setTimeout(() => {
          handleTTSProduce(sceneId, improvedSentence, sceneData);
        }, 1000);
      }

      setImprovingSentence(null);
    },
    [
      setImprovingSentence,
      modelSelection.selectedModel,
      modelSelection.enforceLongerSentences,
      videoSettings.autoGenerateTTS,
    ],
  );

  const handleTypingEffect = useCallback(
    async (sceneId: number, sceneData?: BaserowRow) => {
      try {
        setCreatingTypingEffect(sceneId);

        // Get the scene text
        const sceneText = String(
          sceneData?.['field_6890'] || sceneData?.field_6890 || '',
        ).trim();
        if (!sceneText) {
          throw new Error('No text available for typing effect');
        }

        // Get the original video URL
        const videoUrl = sceneData?.['field_6888'] || sceneData?.field_6888;
        if (!videoUrl || typeof videoUrl !== 'string') {
          throw new Error('No original video available for typing effect');
        }

        // Extract videoId from scene data
        let videoId: number | null = null;
        const videoIdField = sceneData?.['field_6889'];
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

        if (!videoId) {
          throw new Error('Video ID not found for scene');
        }

        // Call the typing effect API
        const response = await fetch('/api/create-typing-effect', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            sceneId,
            videoId,
            videoUrl,
            text: sceneText,
          }),
        });

        if (!response.ok) {
          let errorMessage = `Typing effect error: ${response.status}`;
          try {
            const errorData = await response.json();
            errorMessage = errorData.error || errorMessage;
          } catch (parseError) {
            errorMessage = `Typing effect error: ${response.status} - ${response.statusText}`;
          }
          throw new Error(errorMessage);
        }

        const result = await response.json();
        const typingEffectVideoUrl = result.videoUrl;

        // Update the Baserow field with the typing effect video URL
        const updatedRow = await updateSceneRow(sceneId, {
          field_6886: typingEffectVideoUrl,
        });

        // Update the local data optimistically
        const updatedData = dataRef.current.map((scene) => {
          if (scene.id === sceneId) {
            return { ...scene, field_6886: typingEffectVideoUrl };
          }
          return scene;
        });
        onDataUpdateRef.current?.(updatedData);

        // Refresh data from server
        refreshDataRef.current?.();

        playSuccessSound();
      } catch (error) {
        console.error('Error creating typing effect:', error);
        playErrorSound();
        // You could show a user-friendly error message here
      } finally {
        setCreatingTypingEffect(null);
      }
    },
    [setCreatingTypingEffect],
  );

  const handleConvertToCFR = useCallback(
    async (sceneId: number, sceneData?: BaserowRow) => {
      try {
        setConvertingToCFRVideo(sceneId);

        // Get the video URL to convert from field_6886 (synced/processed video)
        const videoUrl = sceneData?.['field_6886'] || sceneData?.field_6886;
        if (!videoUrl || typeof videoUrl !== 'string') {
          throw new Error('No processed video available for CFR conversion');
        }

        // Extract videoId from scene data
        let videoId: number | null = null;
        const videoIdField = sceneData?.['field_6889'];
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

        if (!videoId) {
          throw new Error('Video ID not found for scene');
        }

        // Call the convert to CFR API
        const response = await fetch('/api/convert-to-cfr', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            videoId: videoId, // Original video ID
            sceneId: sceneId, // Scene ID for proper naming
            videoUrl,
            framerate: 30, // Target framerate of 30 fps
          }),
        });

        if (!response.ok) {
          let errorMessage = `CFR conversion error: ${response.status}`;
          try {
            const errorData = await response.json();
            errorMessage = errorData.error || errorMessage;
          } catch (parseError) {
            errorMessage = `CFR conversion error: ${response.status} - ${response.statusText}`;
          }
          throw new Error(errorMessage);
        }

        const result = await response.json();
        const cfrVideoUrl = result.data?.cfrUrl;

        if (!cfrVideoUrl) {
          throw new Error('No CFR video URL returned from API');
        }

        // Update the Baserow field with the CFR video URL
        // For scenes, we update the synced/processed video field (field_6886)
        const updatedRow = await updateSceneRow(sceneId, {
          field_6886: cfrVideoUrl,
        });

        // Update the local data optimistically
        const updatedData = dataRef.current.map((scene) => {
          if (scene.id === sceneId) {
            return { ...scene, field_6886: cfrVideoUrl };
          }
          return scene;
        });
        onDataUpdateRef.current?.(updatedData);

        // Refresh data from server
        refreshDataRef.current?.();

        playSuccessSound();
      } catch (error) {
        console.error('Error converting scene to CFR:', error);
        playErrorSound();
        // You could show a user-friendly error message here
      } finally {
        setConvertingToCFRVideo(null);
      }
    },
    [setConvertingToCFRVideo],
  );

  // Convert original video to CFR handler
  const handleConvertOriginalToCFR = useCallback(
    async (
      sceneId: number,
      sceneData?: BaserowRow,
      playSound: boolean = true,
    ) => {
      try {
        setConvertingToCFRVideo(sceneId);

        // Get the video URL to convert from field_6888 (original video)
        const videoUrl = sceneData?.['field_6888'] || sceneData?.field_6888;
        if (!videoUrl || typeof videoUrl !== 'string') {
          throw new Error('No original video available for CFR conversion');
        }

        // Extract videoId from scene data
        let videoId: number | null = null;
        const videoIdField = sceneData?.['field_6889'];
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

        if (!videoId) {
          throw new Error('Video ID not found for scene');
        }

        // Call the convert to CFR API
        const response = await fetch('/api/convert-to-cfr', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            videoId: videoId, // Original video ID
            sceneId: sceneId, // Scene ID for proper naming
            videoUrl,
            framerate: 30, // Target framerate of 30 fps
          }),
        });

        if (!response.ok) {
          const errorData = await response.json();
          let errorMessage = 'Failed to convert original video to CFR';
          if (errorData.error) {
            errorMessage = errorData.error;
          } else if (response.status === 400) {
            errorMessage = `Bad request: ${response.status} - ${response.statusText}`;
          } else if (response.status === 500) {
            errorMessage = `Server error: ${response.status} - ${response.statusText}`;
          } else {
            errorMessage = `CFR conversion error: ${response.status} - ${response.statusText}`;
          }
          throw new Error(errorMessage);
        }

        const result = await response.json();
        const cfrVideoUrl = result.data?.cfrUrl;

        if (!cfrVideoUrl) {
          throw new Error('No CFR video URL returned from API');
        }

        // Update the Baserow field with the CFR video URL for original video
        const updatedRow = await updateSceneRow(sceneId, {
          field_6888: cfrVideoUrl,
        });

        // Update the local data optimistically
        const updatedData = dataRef.current.map((scene) => {
          if (scene.id === sceneId) {
            return { ...scene, field_6888: cfrVideoUrl };
          }
          return scene;
        });
        onDataUpdateRef.current?.(updatedData);

        // Refresh data from server
        refreshDataRef.current?.();

        if (playSound) {
          playSuccessSound();
        }
      } catch (error) {
        console.error('Error converting original video to CFR:', error);
        playErrorSound();
        alert(
          `Original video CFR conversion failed: ${
            error instanceof Error ? error.message : 'Unknown error'
          }`,
        );
      } finally {
        setConvertingToCFRVideo(null);
      }
    },
    [setConvertingToCFRVideo],
  );

  // Convert final video to CFR handler
  const handleConvertFinalToCFR = useCallback(
    async (
      sceneId: number,
      sceneData?: BaserowRow,
      playSound: boolean = true,
    ) => {
      try {
        setConvertingToCFRVideo(sceneId);

        // Get the video URL to convert from field_6886 (final/processed video)
        const videoUrl = sceneData?.['field_6886'] || sceneData?.field_6886;
        if (!videoUrl || typeof videoUrl !== 'string') {
          throw new Error('No final video available for CFR conversion');
        }

        // Extract videoId from scene data
        let videoId: number | null = null;
        const videoIdField = sceneData?.['field_6889'];
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

        if (!videoId) {
          throw new Error('Video ID not found for scene');
        }

        // Call the convert to CFR API
        const response = await fetch('/api/convert-to-cfr', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            videoId: videoId, // Original video ID
            sceneId: sceneId, // Scene ID for proper naming
            videoUrl,
            framerate: 30, // Target framerate of 30 fps
          }),
        });

        if (!response.ok) {
          const errorData = await response.json();
          let errorMessage = 'Failed to convert final video to CFR';
          if (errorData.error) {
            errorMessage = errorData.error;
          } else if (response.status === 400) {
            errorMessage = `Bad request: ${response.status} - ${response.statusText}`;
          } else if (response.status === 500) {
            errorMessage = `Server error: ${response.status} - ${response.statusText}`;
          } else {
            errorMessage = `CFR conversion error: ${response.status} - ${response.statusText}`;
          }
          throw new Error(errorMessage);
        }

        const result = await response.json();
        const cfrVideoUrl = result.data?.cfrUrl;

        if (!cfrVideoUrl) {
          throw new Error('No CFR video URL returned from API');
        }

        // Update the Baserow field with the CFR video URL for final video
        const updatedRow = await updateSceneRow(sceneId, {
          field_6886: cfrVideoUrl,
        });

        // Update the local data optimistically
        const updatedData = dataRef.current.map((scene) => {
          if (scene.id === sceneId) {
            return { ...scene, field_6886: cfrVideoUrl };
          }
          return scene;
        });
        onDataUpdateRef.current?.(updatedData);

        // Refresh data from server
        refreshDataRef.current?.();

        if (playSound) {
          playSuccessSound();
        }
      } catch (error) {
        console.error('Error converting final video to CFR:', error);
        playErrorSound();
        alert(
          `Final video CFR conversion failed: ${
            error instanceof Error ? error.message : 'Unknown error'
          }`,
        );
      } finally {
        setConvertingToCFRVideo(null);
      }
    },
    [setConvertingToCFRVideo],
  );

  // Normalize audio handler
  const handleNormalizeAudio = useCallback(
    async (
      sceneId: number,
      sceneData?: BaserowRow,
      playSound: boolean = true,
    ) => {
      try {
        setNormalizingAudio(sceneId);

        // Get the video URL to normalize from field_6886 (synced/processed video)
        const videoUrl = sceneData?.['field_6886'] || sceneData?.field_6886;
        if (!videoUrl || typeof videoUrl !== 'string') {
          throw new Error(
            'No processed video available for audio normalization',
          );
        }

        // Call the normalize audio API
        const response = await fetch('/api/normalize-audio', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            sceneId: sceneId,
            videoUrl,
            targetLoudness: -19, // EBU R128 standard
            loudnessRange: 7,
            truePeak: -2,
          }),
        });

        if (!response.ok) {
          const errorData = await response.json();
          throw new Error(errorData.error || 'Audio normalization failed');
        }

        const result = await response.json();
        const normalizedVideoUrl = result.data?.normalizedUrl;

        if (!normalizedVideoUrl) {
          throw new Error('No normalized video URL returned from API');
        }

        console.log('Audio normalization successful, URL:', normalizedVideoUrl);

        // Update the scene with the normalized video URL
        await updateSceneRow(sceneId, {
          field_6886: normalizedVideoUrl,
        });

        // Update local data optimistically
        const updatedData = dataRef.current.map((scene) => {
          if (scene.id === sceneId) {
            return { ...scene, field_6886: normalizedVideoUrl };
          }
          return scene;
        });
        onDataUpdateRef.current?.(updatedData);

        // Refresh data from server
        refreshDataRef.current?.();

        if (playSound) {
          playSuccessSound();
        }
      } catch (error) {
        console.error('Error normalizing audio:', error);
        playErrorSound();
        alert(
          `Audio normalization failed: ${
            error instanceof Error ? error.message : 'Unknown error'
          }`,
        );
      } finally {
        setNormalizingAudio(null);
      }
    },
    [setNormalizingAudio],
  );

  // Normalize original video handler
  const handleNormalizeOriginalVideo = useCallback(
    async (
      sceneId: number,
      sceneData?: BaserowRow,
      playSound: boolean = true,
    ) => {
      try {
        setNormalizingAudio(sceneId);

        // Get the video URL to normalize from field_6888 (original video)
        const videoUrl = sceneData?.['field_6888'] || sceneData?.field_6888;
        if (!videoUrl || typeof videoUrl !== 'string') {
          throw new Error(
            'No original video available for audio normalization',
          );
        }

        // Extract videoId from scene data
        let videoId: number | null = null;
        const videoIdField = sceneData?.['field_6889'];
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

        // Call the normalize audio API
        const response = await fetch('/api/normalize-audio', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            sceneId: sceneId,
            videoId: videoId,
            videoUrl,
            targetLoudness: -19, // EBU R128 standard
            loudnessRange: 7,
            truePeak: -2,
          }),
        });

        if (!response.ok) {
          const errorData = await response.json();
          throw new Error(errorData.error || 'Audio normalization failed');
        }

        const result = await response.json();
        const normalizedVideoUrl = result.data?.normalizedUrl;

        if (!normalizedVideoUrl) {
          throw new Error('No normalized video URL returned from API');
        }

        console.log(
          'Original video audio normalization successful, URL:',
          normalizedVideoUrl,
        );

        // Update the scene with the normalized video URL for the original video field
        await updateSceneRow(sceneId, {
          field_6888: normalizedVideoUrl,
        });

        // Update local data optimistically
        const updatedData = dataRef.current.map((scene) => {
          if (scene.id === sceneId) {
            return { ...scene, field_6888: normalizedVideoUrl };
          }
          return scene;
        });
        onDataUpdateRef.current?.(updatedData);

        // Refresh data from server
        refreshDataRef.current?.();

        if (playSound) {
          playSuccessSound();
        }
      } catch (error) {
        console.error('Error normalizing original video audio:', error);
        playErrorSound();
        alert(
          `Original video audio normalization failed: ${
            error instanceof Error ? error.message : 'Unknown error'
          }`,
        );
      } finally {
        setNormalizingAudio(null);
      }
    },
    [setNormalizingAudio],
  );

  // Normalize final video handler
  const handleNormalizeFinalVideo = useCallback(
    async (
      sceneId: number,
      sceneData?: BaserowRow,
      playSound: boolean = true,
    ) => {
      try {
        setNormalizingAudio(sceneId);

        // Get the video URL to normalize from field_6886 (final/processed video)
        const videoUrl = sceneData?.['field_6886'] || sceneData?.field_6886;
        if (!videoUrl || typeof videoUrl !== 'string') {
          throw new Error('No final video available for audio normalization');
        }

        // Extract videoId from scene data
        let videoId: number | null = null;
        const videoIdField = sceneData?.['field_6889'];
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

        // Call the normalize audio API
        const response = await fetch('/api/normalize-audio', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            sceneId: sceneId,
            videoId: videoId,
            videoUrl,
            targetLoudness: -19, // EBU R128 standard
            loudnessRange: 7,
            truePeak: -2,
          }),
        });

        if (!response.ok) {
          const errorData = await response.json();
          throw new Error(errorData.error || 'Audio normalization failed');
        }

        const result = await response.json();
        const normalizedVideoUrl = result.data?.normalizedUrl;

        if (!normalizedVideoUrl) {
          throw new Error('No normalized video URL returned from API');
        }

        console.log(
          'Final video audio normalization successful, URL:',
          normalizedVideoUrl,
        );

        // Update the scene with the normalized video URL for the final video field
        await updateSceneRow(sceneId, {
          field_6886: normalizedVideoUrl,
        });

        // Update local data optimistically
        const updatedData = dataRef.current.map((scene) => {
          if (scene.id === sceneId) {
            return { ...scene, field_6886: normalizedVideoUrl };
          }
          return scene;
        });
        onDataUpdateRef.current?.(updatedData);

        // Refresh data from server
        refreshDataRef.current?.();

        if (playSound) {
          playSuccessSound();
        }
      } catch (error) {
        console.error('Error normalizing final video audio:', error);
        playErrorSound();
        alert(
          `Final video audio normalization failed: ${
            error instanceof Error ? error.message : 'Unknown error'
          }`,
        );
      } finally {
        setNormalizingAudio(null);
      }
    },
    [setNormalizingAudio],
  );

  // Optimize silence handler
  const handleOptimizeSilence = useCallback(
    async (sceneId: number, sceneData?: BaserowRow) => {
      try {
        setConvertingToCFRVideo(sceneId); // Reuse the CFR loading state

        // Get the video URL to optimize from field_6886 (final/processed video)
        const videoUrl = sceneData?.['field_6886'] || sceneData?.field_6886;
        if (!videoUrl || typeof videoUrl !== 'string') {
          throw new Error(
            'No processed video available for silence optimization',
          );
        }

        // Extract videoId from scene data
        let videoId: number | null = null;
        const videoIdField = sceneData?.['field_6889'];
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

        if (!videoId) {
          throw new Error('Video ID not found for scene');
        }

        // Call the optimize silence API
        const response = await fetch('/api/optimize-silence', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            videoId: videoId,
            videoUrl,
          }),
        });

        if (!response.ok) {
          let errorMessage = `Silence optimization error: ${response.status}`;
          try {
            const errorData = await response.json();
            errorMessage = errorData.error || errorMessage;
          } catch (parseError) {
            errorMessage = `Silence optimization error: ${response.status} - ${response.statusText}`;
          }
          throw new Error(errorMessage);
        }

        const result = await response.json();
        const optimizedVideoUrl = result.data?.optimizedUrl;

        if (!optimizedVideoUrl) {
          throw new Error('No optimized video URL returned from API');
        }

        // Update the Baserow field with the optimized video URL
        const updatedRow = await updateSceneRow(sceneId, {
          field_6886: optimizedVideoUrl,
        });

        // Update the local data optimistically
        const updatedData = dataRef.current.map((scene) => {
          if (scene.id === sceneId) {
            return { ...scene, field_6886: optimizedVideoUrl };
          }
          return scene;
        });
        onDataUpdateRef.current?.(updatedData);

        // Refresh data from server
        refreshDataRef.current?.();

        playSuccessSound();
      } catch (error) {
        console.error('Error optimizing silence:', error);
        playErrorSound();
        // You could show a user-friendly error message here
      } finally {
        setConvertingToCFRVideo(null);
      }
    },
    [setConvertingToCFRVideo],
  );

  // Optimize silence for original video handler
  const handleOptimizeSilenceOriginal = useCallback(
    async (
      sceneId: number,
      sceneData?: BaserowRow,
      playSound: boolean = true,
    ) => {
      try {
        setConvertingToCFRVideo(sceneId);

        // Get the video URL to optimize from field_6888 (original video)
        const videoUrl = sceneData?.['field_6888'] || sceneData?.field_6888;
        if (!videoUrl || typeof videoUrl !== 'string') {
          throw new Error(
            'No original video available for silence optimization',
          );
        }

        // Extract videoId from scene data
        let videoId: number | null = null;
        const videoIdField = sceneData?.['field_6889'];
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

        if (!videoId) {
          throw new Error('Video ID not found for scene');
        }

        // Call the optimize silence API
        const response = await fetch('/api/optimize-silence', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            videoId: videoId,
            sceneId: sceneId,
            videoUrl,
          }),
        });

        if (!response.ok) {
          const errorData = await response.json();
          let errorMessage = 'Failed to optimize silence for original video';
          if (errorData.error) {
            errorMessage = errorData.error;
          } else if (response.status === 400) {
            errorMessage = `Bad request: ${response.status} - ${response.statusText}`;
          } else if (response.status === 500) {
            errorMessage = `Server error: ${response.status} - ${response.statusText}`;
          } else {
            errorMessage = `Silence optimization error: ${response.status} - ${response.statusText}`;
          }
          throw new Error(errorMessage);
        }

        const result = await response.json();
        const optimizedVideoUrl = result.data?.optimizedUrl;

        if (!optimizedVideoUrl) {
          throw new Error('No optimized video URL returned from API');
        }

        // Update the Baserow field with the optimized video URL for original video
        const updatedRow = await updateSceneRow(sceneId, {
          field_6888: optimizedVideoUrl,
        });

        // Update the local data optimistically
        const updatedData = dataRef.current.map((scene) => {
          if (scene.id === sceneId) {
            return { ...scene, field_6888: optimizedVideoUrl };
          }
          return scene;
        });
        onDataUpdateRef.current?.(updatedData);

        // Refresh data from server
        refreshDataRef.current?.();

        if (playSound) {
          playSuccessSound();
        }
      } catch (error) {
        console.error('Error optimizing silence for original video:', error);
        playErrorSound();
        alert(
          `Original video silence optimization failed: ${
            error instanceof Error ? error.message : 'Unknown error'
          }`,
        );
      } finally {
        setConvertingToCFRVideo(null);
      }
    },
    [setConvertingToCFRVideo],
  );

  // Optimize silence for final video handler
  const handleOptimizeSilenceFinal = useCallback(
    async (
      sceneId: number,
      sceneData?: BaserowRow,
      playSound: boolean = true,
    ) => {
      try {
        setConvertingToCFRVideo(sceneId);

        // Get the video URL to optimize from field_6886 (final/processed video)
        const videoUrl = sceneData?.['field_6886'] || sceneData?.field_6886;
        if (!videoUrl || typeof videoUrl !== 'string') {
          throw new Error('No final video available for silence optimization');
        }

        // Extract videoId from scene data
        let videoId: number | null = null;
        const videoIdField = sceneData?.['field_6889'];
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

        if (!videoId) {
          throw new Error('Video ID not found for scene');
        }

        // Call the optimize silence API
        const response = await fetch('/api/optimize-silence', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            videoId: videoId,
            sceneId: sceneId,
            videoUrl,
          }),
        });

        if (!response.ok) {
          const errorData = await response.json();
          let errorMessage = 'Failed to optimize silence for final video';
          if (errorData.error) {
            errorMessage = errorData.error;
          } else if (response.status === 400) {
            errorMessage = `Bad request: ${response.status} - ${response.statusText}`;
          } else if (response.status === 500) {
            errorMessage = `Server error: ${response.status} - ${response.statusText}`;
          } else {
            errorMessage = `Silence optimization error: ${response.status} - ${response.statusText}`;
          }
          throw new Error(errorMessage);
        }

        const result = await response.json();
        const optimizedVideoUrl = result.data?.optimizedUrl;

        if (!optimizedVideoUrl) {
          throw new Error('No optimized video URL returned from API');
        }

        // Update the Baserow field with the optimized video URL for final video
        const updatedRow = await updateSceneRow(sceneId, {
          field_6886: optimizedVideoUrl,
        });

        // Update the local data optimistically
        const updatedData = dataRef.current.map((scene) => {
          if (scene.id === sceneId) {
            return { ...scene, field_6886: optimizedVideoUrl };
          }
          return scene;
        });
        onDataUpdateRef.current?.(updatedData);

        // Refresh data from server
        refreshDataRef.current?.();

        if (playSound) {
          playSuccessSound();
        }
      } catch (error) {
        console.error('Error optimizing silence for final video:', error);
        playErrorSound();
        alert(
          `Final video silence optimization failed: ${
            error instanceof Error ? error.message : 'Unknown error'
          }`,
        );
      } finally {
        setConvertingToCFRVideo(null);
      }
    },
    [setConvertingToCFRVideo],
  );

  // Expose handler functions to parent component (only once on mount)
  useEffect(() => {
    if (onHandlersReady) {
      onHandlersReady({
        handleAutoFixMismatch,
        handleSentenceImprovement,
        handleTTSProduce,
        handleVideoGenerate,
        handleSpeedUpVideo,
        handleTranscribeScene,
        handleTypingEffect,
        handleConvertToCFR,
        handleConvertOriginalToCFR,
        handleConvertFinalToCFR,
        handleNormalizeAudio,
        handleNormalizeOriginalVideo,
        handleNormalizeFinalVideo,
        handleOptimizeSilence,
        handleOptimizeSilenceOriginal,
        handleOptimizeSilenceFinal,
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [onHandlersReady]);

  // Apply filters and sorting
  const filteredAndSortedData = React.useMemo(() => {
    let filtered = data;

    // Filter by empty text
    if (showOnlyEmptyText) {
      filtered = filtered.filter((scene) => {
        const sentence = String(scene['field_6890'] || scene.field_6890 || '');
        return !sentence.trim();
      });
    }

    // Filter by not-empty original fields: field_6901 or field_6900 (either can be present)
    if (showOnlyNotEmptyText) {
      filtered = filtered.filter((scene) => {
        const orig = String(
          scene['field_6901'] || scene.field_6901 || '',
        ).trim();
        const other = String(
          scene['field_6900'] || scene.field_6900 || '',
        ).trim();
        return !!orig || !!other;
      });
    }

    // Filter by recently modified TTS (last 24 hours)
    if (showRecentlyModifiedTTS) {
      const oneDayAgo = Date.now() - 10 * 24 * 60 * 60 * 1000;

      filtered = filtered.filter((scene) => {
        // Extract timestamp from the TTS URL in field_6891
        const url = scene.field_6891 || scene['field_6891'];
        if (!url || typeof url !== 'string') return false;

        // Extract timestamp from URL (format: tts_ID_TIMESTAMP.wav)
        const match = url.match(/_(\d+)\.wav$/);
        if (!match) return false;

        const timestamp = parseInt(match[1]);
        if (isNaN(timestamp)) return false;

        // Check if within last 24 hours
        return timestamp >= oneDayAgo;
      });
    }

    // Sort by duration
    if (sortByDuration) {
      filtered = [...filtered].sort((a, b) => {
        const durationA = Number(a.field_6884) || 0;
        const durationB = Number(b.field_6884) || 0;

        if (sortByDuration === 'asc') {
          return durationA - durationB;
        } else {
          return durationB - durationA;
        }
      });
    }

    // Sort by last modified
    if (sortByLastModified) {
      filtered = [...filtered].sort((a, b) => {
        const getLastModified = (scene: Record<string, unknown>) => {
          const lastModified = scene.field_6905 || scene['field_6905'];
          if (!lastModified) return 0;

          // Handle different date formats
          if (typeof lastModified === 'string') {
            const date = new Date(lastModified);
            const timestamp = date.getTime();
            console.log(
              'Parsing date:',
              lastModified,
              '-> timestamp:',
              timestamp,
              'valid:',
              !isNaN(timestamp),
            );
            return isNaN(timestamp) ? 0 : timestamp;
          } else if (typeof lastModified === 'number') {
            return lastModified;
          }
          return 0;
        };

        const timeA = getLastModified(a);
        const timeB = getLastModified(b);

        if (sortByLastModified === 'asc') {
          return timeA - timeB;
        } else {
          return timeB - timeA;
        }
      });
    }

    return filtered;
  }, [
    data,
    showOnlyEmptyText,
    showOnlyNotEmptyText,
    sortByDuration,
    sortByLastModified,
    showRecentlyModifiedTTS,
  ]);

  if (!data || data.length === 0) {
    return (
      <div className='flex flex-col items-center justify-center min-h-[400px] text-gray-500'>
        <div className='text-6xl mb-4'>📋</div>
        <h3 className='text-xl font-semibold mb-2'>No Data Available</h3>
        <p className='text-center max-w-md'>
          No scenes found in your Baserow table. Add some data to get started!
        </p>
        <div className='mt-6 space-y-2'>
          {refreshData && (
            <button
              onClick={refreshData}
              className='px-4 py-2 bg-blue-500 text-white rounded hover:bg-blue-600 transition-colors'
            >
              Refresh Data
            </button>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className='w-full'>
      {/* Filter Controls */}
      <div className='mb-6 bg-gray-50 rounded-lg p-4 border border-gray-200'>
        <div className='flex flex-col gap-3'>
          {/* Sort Controls Row */}
          <div className='flex flex-col sm:flex-row sm:flex-wrap sm:justify-between gap-2 sm:gap-3'>
            <div className='flex flex-col sm:flex-row sm:flex-wrap gap-2 sm:gap-3'>
              {/* Duration Sort */}
              <div className='flex items-center gap-2'>
                <label className='text-xs font-medium text-gray-600 whitespace-nowrap'>
                  Duration:
                </label>
                <div className='flex gap-1'>
                  <button
                    onClick={() =>
                      setSortByDuration(sortByDuration === 'asc' ? null : 'asc')
                    }
                    className={`px-2 py-1 text-xs rounded transition-colors ${
                      sortByDuration === 'asc'
                        ? 'bg-blue-500 text-white'
                        : 'bg-white text-gray-700 hover:bg-gray-100 border border-gray-300'
                    }`}
                  >
                    ↑
                  </button>
                  <button
                    onClick={() =>
                      setSortByDuration(
                        sortByDuration === 'desc' ? null : 'desc',
                      )
                    }
                    className={`px-2 py-1 text-xs rounded transition-colors ${
                      sortByDuration === 'desc'
                        ? 'bg-blue-500 text-white'
                        : 'bg-white text-gray-700 hover:bg-gray-100 border border-gray-300'
                    }`}
                  >
                    ↓
                  </button>
                </div>
              </div>

              {/* Last Modified Sort */}
              <div className='flex items-center gap-2'>
                <label className='text-xs font-medium text-gray-600 whitespace-nowrap'>
                  Modified:
                </label>
                <div className='flex gap-1'>
                  <button
                    onClick={() =>
                      setSortByLastModified(
                        sortByLastModified === 'asc' ? null : 'asc',
                      )
                    }
                    className={`px-2 py-1 text-xs rounded transition-colors ${
                      sortByLastModified === 'asc'
                        ? 'bg-blue-500 text-white'
                        : 'bg-white text-gray-700 hover:bg-gray-100 border border-gray-300'
                    }`}
                  >
                    ↑
                  </button>
                  <button
                    onClick={() =>
                      setSortByLastModified(
                        sortByLastModified === 'desc' ? null : 'desc',
                      )
                    }
                    className={`px-2 py-1 text-xs rounded transition-colors ${
                      sortByLastModified === 'desc'
                        ? 'bg-blue-500 text-white'
                        : 'bg-white text-gray-700 hover:bg-gray-100 border border-gray-300'
                    }`}
                  >
                    ↓
                  </button>
                </div>
              </div>

              {/* Divider - hidden on mobile */}
              <div className='hidden sm:block w-px bg-gray-300 self-stretch'></div>

              {/* Filter Buttons */}
              <div className='flex flex-wrap items-center gap-2'>
                <button
                  onClick={() => {
                    // Make Empty / Not Empty mutually exclusive
                    if (!showOnlyEmptyText) setShowOnlyNotEmptyText(false);
                    setShowOnlyEmptyText(!showOnlyEmptyText);
                  }}
                  className={`px-2.5 py-1 text-xs rounded-full transition-colors whitespace-nowrap ${
                    showOnlyEmptyText
                      ? 'bg-green-500 text-white'
                      : 'bg-white text-gray-700 hover:bg-gray-100 border border-gray-300'
                  }`}
                >
                  {showOnlyEmptyText ? '✓ ' : ''}Empty
                </button>
                <button
                  onClick={() => {
                    // Make Not Empty / Empty mutually exclusive
                    if (!showOnlyNotEmptyText) setShowOnlyEmptyText(false);
                    setShowOnlyNotEmptyText(!showOnlyNotEmptyText);
                  }}
                  title='Show scenes where either original (field_6901) or field_6900 has value'
                  className={`px-2.5 py-1 text-xs rounded-full transition-colors whitespace-nowrap ${
                    showOnlyNotEmptyText
                      ? 'bg-purple-500 text-white'
                      : 'bg-white text-gray-700 hover:bg-gray-100 border border-gray-300'
                  }`}
                >
                  {showOnlyNotEmptyText ? '✓ ' : ''}Not Empty
                </button>
                <button
                  onClick={() =>
                    setShowRecentlyModifiedTTS(!showRecentlyModifiedTTS)
                  }
                  className={`px-2.5 py-1 text-xs rounded-full transition-colors whitespace-nowrap ${
                    showRecentlyModifiedTTS
                      ? 'bg-blue-500 text-white'
                      : 'bg-white text-gray-700 hover:bg-gray-100 border border-gray-300'
                  }`}
                >
                  {showRecentlyModifiedTTS ? '✓ ' : ''}TTS
                </button>
                <button
                  onClick={() => {
                    // Find the most recently modified scene
                    const mostRecentScene = data.reduce((latest, current) => {
                      const currentTime =
                        current.field_6905 || current['field_6905'];
                      const latestTime =
                        latest.field_6905 || latest['field_6905'];

                      if (!currentTime) return latest;
                      if (!latestTime) return current;

                      const currentDate =
                        typeof currentTime === 'string'
                          ? new Date(currentTime)
                          : new Date(currentTime as number);
                      const latestDate =
                        typeof latestTime === 'string'
                          ? new Date(latestTime)
                          : new Date(latestTime as number);

                      return currentDate > latestDate ? current : latest;
                    });

                    if (mostRecentScene) {
                      scrollCardToTop(mostRecentScene.id);
                    }
                  }}
                  className='px-2.5 py-1 text-xs rounded-full transition-colors bg-orange-500 text-white hover:bg-orange-600 whitespace-nowrap'
                  title='Scroll to most recently modified scene'
                >
                  📍 Recent
                </button>
              </div>
            </div>

            {/* Results Count - Right Side on Desktop */}
            <div className='text-xs text-gray-500 flex items-center'>
              Showing{' '}
              <span className='font-semibold text-gray-700 mx-1'>
                {filteredAndSortedData.length}
              </span>{' '}
              of{' '}
              <span className='font-semibold text-gray-700 mx-1'>
                {data.length}
              </span>{' '}
              scenes
            </div>
          </div>
        </div>
      </div>

      <div className='w-full flex flex-col space-y-6'>
        {filteredAndSortedData.map((scene) => (
          <div
            key={scene.id}
            ref={(el) => {
              if (el) sceneCardRefs.current[scene.id] = el;
            }}
            className='bg-white rounded-lg shadow-md border border-gray-200 p-6 hover:shadow-lg transition-shadow duration-200'
          >
            {/* Video Player - Only show when video is playing for this scene */}
            {mediaPlayer.playingVideoId === scene.id && (
              <div className='mb-4 bg-black rounded-lg overflow-hidden'>
                <video
                  ref={(el) => {
                    if (el) videoRefs.current[scene.id] = el;
                  }}
                  controls
                  className='w-full h-auto max-h-[620px]'
                  onEnded={() => {
                    // Video ended - no auto-close
                  }}
                  onError={(e) => {
                    console.error('Video error for scene', scene.id, e);
                    setLoadingVideo(null);
                    setPlayingVideo(null);
                  }}
                >
                  Your browser does not support the video tag.
                </video>
              </div>
            )}

            {/* Produced Video Player - Only show when produced video is playing for this scene */}
            {mediaPlayer.playingProducedVideoId === scene.id && (
              <div className='mb-4 bg-black rounded-lg overflow-hidden'>
                <video
                  ref={(el) => {
                    if (el) producedVideoRefs.current[scene.id] = el;
                  }}
                  controls
                  className='w-full h-auto max-h-[620px]'
                  onEnded={() => {
                    // Produced video ended - no auto-close
                  }}
                  onError={(e) => {
                    console.error(
                      'Produced video error for scene',
                      scene.id,
                      e,
                    );
                    setLoadingProducedVideo(null);
                    setPlayingProducedVideo(null);
                  }}
                >
                  Your browser does not support the video tag.
                </video>
              </div>
            )}

            <div className='flex w-full gap-4'>
              {/* ID and Duration - Left Side, Desktop only */}
              <div className='hidden sm:flex flex-row items-center gap-4'>
                <div className='flex items-center gap-2'>
                  <span className='text-xs font-semibold text-gray-500 uppercase tracking-wide'>
                    ID:
                  </span>
                  <span className='text-lg font-bold text-blue-600'>
                    #{scene.id || 'N/A'}{' '}
                    <span className='text-gray-400'>
                      ({String(scene.field_6884 || 'N/A')})
                    </span>
                  </span>
                </div>

                {/* Time Adjustment Dropdown */}
                <div className='relative'>
                  <button
                    onClick={() => {
                      const newState =
                        showTimeAdjustment === scene.id ? null : scene.id;
                      setShowTimeAdjustment(newState);
                      if (newState !== null) {
                        // Calculate position when opening dropdown
                        setTimeout(() => {
                          const position = calculateDropdownPosition(scene.id);
                          setDropdownPositions((prev) => ({
                            ...prev,
                            [scene.id]: position,
                          }));
                        }, 0);
                      }
                    }}
                    className='flex items-center gap-1 px-2 py-1 text-xs font-medium text-gray-600 hover:text-gray-800 hover:bg-gray-100 rounded-md transition-colors duration-200'
                    title='Adjust start/end times'
                  >
                    <Settings className='h-3 w-3' />
                    <ChevronDown
                      className={`h-3 w-3 transition-transform duration-200 ${
                        showTimeAdjustment === scene.id ? 'rotate-180' : ''
                      }`}
                    />
                  </button>

                  {showTimeAdjustment === scene.id && (
                    <div
                      ref={(el) => {
                        if (el) {
                          dropdownRefs.current[scene.id] = el;
                        }
                      }}
                      data-time-adjustment-dropdown
                      className={`absolute ${
                        dropdownPositions[scene.id] === 'up'
                          ? 'bottom-full mb-1'
                          : 'top-full mt-1'
                      } left-0 w-72 bg-white border border-gray-200 rounded-lg shadow-lg z-50 p-3`}
                    >
                      <div className='space-y-3'>
                        <div>
                          <label className='block text-xs font-medium text-gray-700 mb-1'>
                            Start Time
                          </label>
                          <div className='flex items-center gap-2'>
                            <input
                              type='number'
                              step='0.01'
                              min='0'
                              value={
                                inputValues[scene.id]?.start ??
                                Number(scene.field_6896 || 0).toFixed(2)
                              }
                              onChange={(e) => {
                                setInputValues((prev) => ({
                                  ...prev,
                                  [scene.id]: {
                                    ...prev[scene.id],
                                    start: e.target.value,
                                  },
                                }));
                              }}
                              onBlur={() => {
                                const value =
                                  parseFloat(
                                    inputValues[scene.id]?.start || '0',
                                  ) || 0;
                                handleSetStartTime(scene.id, value);
                                // Clear the local input value after setting
                                setInputValues((prev) => ({
                                  ...prev,
                                  [scene.id]: {
                                    ...prev[scene.id],
                                    start: undefined,
                                  },
                                }));
                              }}
                              onKeyDown={(e) => {
                                if (e.key === 'Enter') {
                                  const value =
                                    parseFloat(
                                      inputValues[scene.id]?.start || '0',
                                    ) || 0;
                                  handleSetStartTime(scene.id, value);
                                  setInputValues((prev) => ({
                                    ...prev,
                                    [scene.id]: {
                                      ...prev[scene.id],
                                      start: undefined,
                                    },
                                  }));
                                }
                              }}
                              disabled={updatingTime.has(scene.id)}
                              className='flex-1 px-2 py-1 text-xs border border-gray-300 rounded focus:outline-none focus:ring-1 focus:ring-blue-500 disabled:bg-gray-100 disabled:cursor-not-allowed'
                              placeholder='0.00'
                            />
                            <div className='flex items-center gap-1'>
                              <button
                                onClick={() =>
                                  handleAdjustStartTime(scene.id, -0.1)
                                }
                                disabled={updatingTime.has(scene.id)}
                                className='flex items-center justify-center w-6 h-6 bg-red-100 hover:bg-red-200 disabled:bg-gray-100 disabled:cursor-not-allowed text-red-700 disabled:text-gray-400 rounded transition-colors duration-200'
                                title='Decrease start time by 0.1s'
                              >
                                <Minus className='h-3 w-3' />
                              </button>
                              <button
                                onClick={() =>
                                  handleAdjustStartTime(scene.id, 0.1)
                                }
                                disabled={updatingTime.has(scene.id)}
                                className='flex items-center justify-center w-6 h-6 bg-green-100 hover:bg-green-200 disabled:bg-gray-100 disabled:cursor-not-allowed text-green-700 disabled:text-gray-400 rounded transition-colors duration-200'
                                title='Increase start time by 0.1s'
                              >
                                <Plus className='h-3 w-3' />
                              </button>
                            </div>
                          </div>
                        </div>
                        <div>
                          <label className='block text-xs font-medium text-gray-700 mb-1'>
                            End Time
                          </label>
                          <div className='flex items-center gap-2'>
                            <input
                              type='number'
                              step='0.01'
                              min='0'
                              value={
                                inputValues[scene.id]?.end ??
                                Number(scene.field_6897 || 0).toFixed(2)
                              }
                              onChange={(e) => {
                                setInputValues((prev) => ({
                                  ...prev,
                                  [scene.id]: {
                                    ...prev[scene.id],
                                    end: e.target.value,
                                  },
                                }));
                              }}
                              onBlur={() => {
                                const value =
                                  parseFloat(
                                    inputValues[scene.id]?.end || '0',
                                  ) || 0;
                                handleSetEndTime(scene.id, value);
                                setInputValues((prev) => ({
                                  ...prev,
                                  [scene.id]: {
                                    ...prev[scene.id],
                                    end: undefined,
                                  },
                                }));
                              }}
                              onKeyDown={(e) => {
                                if (e.key === 'Enter') {
                                  const value =
                                    parseFloat(
                                      inputValues[scene.id]?.end || '0',
                                    ) || 0;
                                  handleSetEndTime(scene.id, value);
                                  setInputValues((prev) => ({
                                    ...prev,
                                    [scene.id]: {
                                      ...prev[scene.id],
                                      end: undefined,
                                    },
                                  }));
                                }
                              }}
                              disabled={updatingTime.has(scene.id)}
                              className='flex-1 px-2 py-1 text-xs border border-gray-300 rounded focus:outline-none focus:ring-1 focus:ring-blue-500 disabled:bg-gray-100 disabled:cursor-not-allowed'
                              placeholder='0.00'
                            />
                            <div className='flex items-center gap-1'>
                              <button
                                onClick={() =>
                                  handleAdjustEndTime(scene.id, -0.1)
                                }
                                disabled={updatingTime.has(scene.id)}
                                className='flex items-center justify-center w-6 h-6 bg-red-100 hover:bg-red-200 disabled:bg-gray-100 disabled:cursor-not-allowed text-red-700 disabled:text-gray-400 rounded transition-colors duration-200'
                                title='Decrease end time by 0.1s'
                              >
                                <Minus className='h-3 w-3' />
                              </button>
                              <button
                                onClick={() =>
                                  handleAdjustEndTime(scene.id, 0.1)
                                }
                                disabled={updatingTime.has(scene.id)}
                                className='flex items-center justify-center w-6 h-6 bg-green-100 hover:bg-green-200 disabled:bg-gray-100 disabled:cursor-not-allowed text-green-700 disabled:text-gray-400 rounded transition-colors duration-200'
                                title='Increase end time by 0.1s'
                              >
                                <Plus className='h-3 w-3' />
                              </button>
                            </div>
                          </div>
                        </div>

                        {/* Upload Video Section */}
                        <div className='border-t border-gray-200 pt-3'>
                          <div className='flex items-start gap-3'>
                            <label
                              className={`flex items-center space-x-2 px-3 py-2 text-xs font-medium text-gray-700 hover:bg-gray-50 rounded cursor-pointer border border-gray-200 transition-colors duration-200 ${
                                uploadingSceneVideo === scene.id
                                  ? 'opacity-50 cursor-not-allowed'
                                  : ''
                              }`}
                            >
                              {uploadingSceneVideo === scene.id ? (
                                <Loader2 className='h-3 w-3 animate-spin' />
                              ) : (
                                <Upload className='h-3 w-3' />
                              )}
                              <span>
                                {uploadingSceneVideo === scene.id
                                  ? 'Uploading...'
                                  : 'Upload'}
                              </span>
                              <input
                                type='file'
                                accept='video/*'
                                onChange={(e) => {
                                  const file = e.target.files?.[0];
                                  if (file) {
                                    handleSceneVideoUpload(
                                      scene.id,
                                      file,
                                      applyCfrAfterUpload,
                                      applyNormalizeAfterUpload,
                                      applySilenceAfterUpload,
                                      applyTranscribeAfterUpload,
                                    );
                                    setShowTimeAdjustment(null); // Close dropdown
                                  }
                                  // Reset input
                                  e.target.value = '';
                                }}
                                className='hidden'
                                disabled={uploadingSceneVideo === scene.id}
                              />
                            </label>
                            <div className='flex flex-col space-y-2'>
                              <div className='flex items-center space-x-2'>
                                <input
                                  type='checkbox'
                                  id={`normalize-upload-${scene.id}`}
                                  checked={applyNormalizeAfterUpload}
                                  onChange={(e) =>
                                    setApplyNormalizeAfterUpload(
                                      e.target.checked,
                                    )
                                  }
                                  className='h-4 w-4 text-blue-600 focus:ring-blue-500 border-gray-300 rounded'
                                  disabled={uploadingSceneVideo === scene.id}
                                />
                                <label
                                  htmlFor={`normalize-upload-${scene.id}`}
                                  className='text-xs text-gray-600 cursor-pointer'
                                >
                                  Normalize
                                </label>
                              </div>
                              <div className='flex items-center space-x-2'>
                                <input
                                  type='checkbox'
                                  id={`cfr-upload-${scene.id}`}
                                  checked={applyCfrAfterUpload}
                                  onChange={(e) =>
                                    setApplyCfrAfterUpload(e.target.checked)
                                  }
                                  className='h-4 w-4 text-blue-600 focus:ring-blue-500 border-gray-300 rounded'
                                  disabled={uploadingSceneVideo === scene.id}
                                />
                                <label
                                  htmlFor={`cfr-upload-${scene.id}`}
                                  className='text-xs text-gray-600 cursor-pointer'
                                >
                                  CFR (Both)
                                </label>
                              </div>
                              <div className='flex items-center space-x-2'>
                                <input
                                  type='checkbox'
                                  id={`silence-upload-${scene.id}`}
                                  checked={applySilenceAfterUpload}
                                  onChange={(e) =>
                                    setApplySilenceAfterUpload(e.target.checked)
                                  }
                                  className='h-4 w-4 text-blue-600 focus:ring-blue-500 border-gray-300 rounded'
                                  disabled={uploadingSceneVideo === scene.id}
                                />
                                <label
                                  htmlFor={`silence-upload-${scene.id}`}
                                  className='text-xs text-gray-600 cursor-pointer'
                                >
                                  Silence
                                </label>
                              </div>
                              <div className='flex items-center space-x-2'>
                                <input
                                  type='checkbox'
                                  id={`transcribe-upload-${scene.id}`}
                                  checked={applyTranscribeAfterUpload}
                                  onChange={(e) =>
                                    setApplyTranscribeAfterUpload(
                                      e.target.checked,
                                    )
                                  }
                                  className='h-4 w-4 text-blue-600 focus:ring-blue-500 border-gray-300 rounded'
                                  disabled={uploadingSceneVideo === scene.id}
                                />
                                <label
                                  htmlFor={`transcribe-upload-${scene.id}`}
                                  className='text-xs text-gray-600 cursor-pointer'
                                >
                                  Transcribe
                                </label>
                              </div>
                            </div>
                          </div>
                        </div>

                        {/* Transcribe Section */}
                        {((typeof scene['field_6888'] === 'string' &&
                          scene['field_6888']) ||
                          (typeof scene['field_6886'] === 'string' &&
                            scene['field_6886'])) && (
                          <div className='border-t border-gray-200 pt-3'>
                            <button
                              onClick={() => {
                                handleTranscribeScene(
                                  scene.id,
                                  scene,
                                  transcriptionSettings.selectedVideoType,
                                );
                                setShowTimeAdjustment(null); // Close dropdown
                              }}
                              disabled={sceneLoading.transcribingScene !== null}
                              className={`flex items-center space-x-2 px-3 py-2 text-xs font-medium text-gray-700 hover:bg-gray-50 rounded w-full text-left ${
                                sceneLoading.transcribingScene === scene.id
                                  ? 'opacity-50 cursor-not-allowed'
                                  : sceneLoading.transcribingScene !== null
                                    ? 'opacity-50 cursor-not-allowed'
                                    : ''
                              }`}
                              title={
                                sceneLoading.transcribingScene === scene.id
                                  ? 'Transcribing scene audio...'
                                  : sceneLoading.transcribingScene !== null
                                    ? `Scene transcription is in progress for scene ${sceneLoading.transcribingScene}`
                                    : typeof scene['field_6910'] === 'string' &&
                                        scene['field_6910']
                                      ? 'Scene already transcribed - click to re-transcribe'
                                      : `Transcribe ${transcriptionSettings.selectedVideoType} video and save captions`
                              }
                            >
                              {sceneLoading.transcribingScene === scene.id ? (
                                <Loader2 className='h-3 w-3 animate-spin' />
                              ) : (
                                <div className='flex items-center space-x-1'>
                                  <div
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      updateTranscriptionSettings({
                                        selectedVideoType:
                                          transcriptionSettings.selectedVideoType ===
                                          'original'
                                            ? 'final'
                                            : 'original',
                                      });
                                    }}
                                    className='px-1 py-0.5 text-xs font-bold text-cyan-700 hover:bg-cyan-600/20 rounded transition-colors duration-200 cursor-pointer'
                                    title={`Click to toggle video type (${
                                      transcriptionSettings.selectedVideoType ===
                                      'original'
                                        ? 'final'
                                        : 'original'
                                    })`}
                                  >
                                    {transcriptionSettings.selectedVideoType ===
                                    'original'
                                      ? 'Orig'
                                      : 'Final'}
                                  </div>
                                  <span className='text-xs'>🎙️</span>
                                </div>
                              )}
                              <span>
                                {sceneLoading.transcribingScene === scene.id
                                  ? 'Transcribing...'
                                  : sceneLoading.transcribingScene !== null
                                    ? 'Transcribe Busy'
                                    : typeof scene['field_6910'] === 'string' &&
                                        scene['field_6910']
                                      ? 'Re-transcribe'
                                      : 'Transcribe'}
                              </span>
                            </button>
                          </div>
                        )}

                        {/* Normalize Audio Section */}
                        {((typeof scene['field_6886'] === 'string' &&
                          scene['field_6886']) ||
                          (typeof scene['field_6888'] === 'string' &&
                            scene['field_6888'])) && (
                          <div className='border-t border-gray-200 pt-3'>
                            <div className='flex gap-2'>
                              {/* Normalize Original Video Button */}
                              {typeof scene['field_6888'] === 'string' &&
                                scene['field_6888'] && (
                                  <button
                                    onClick={() => {
                                      handleNormalizeOriginalVideo(
                                        scene.id,
                                        scene,
                                      );
                                      setShowTimeAdjustment(null); // Close dropdown
                                    }}
                                    disabled={
                                      sceneLoading.normalizingAudio !== null
                                    }
                                    className={`flex items-center space-x-1 px-2 py-2 text-xs font-medium text-gray-700 hover:bg-gray-50 rounded flex-1 justify-center ${
                                      sceneLoading.normalizingAudio === scene.id
                                        ? 'opacity-50 cursor-not-allowed'
                                        : sceneLoading.normalizingAudio !== null
                                          ? 'opacity-50 cursor-not-allowed'
                                          : ''
                                    }`}
                                    title={
                                      sceneLoading.normalizingAudio === scene.id
                                        ? 'Normalizing original video audio...'
                                        : sceneLoading.normalizingAudio !== null
                                          ? `Audio normalization is in progress for scene ${sceneLoading.normalizingAudio}`
                                          : 'Normalize original video audio using EBU R128 standard'
                                    }
                                  >
                                    {sceneLoading.normalizingAudio ===
                                    scene.id ? (
                                      <Loader2 className='h-3 w-3 animate-spin' />
                                    ) : (
                                      <Volume2 className='h-3 w-3' />
                                    )}
                                    <span>
                                      {sceneLoading.normalizingAudio ===
                                      scene.id
                                        ? 'Normalizing...'
                                        : 'Original'}
                                    </span>
                                  </button>
                                )}

                              {/* Normalize Final Video Button */}
                              {typeof scene['field_6886'] === 'string' &&
                                scene['field_6886'] && (
                                  <button
                                    onClick={() => {
                                      handleNormalizeFinalVideo(
                                        scene.id,
                                        scene,
                                      );
                                      setShowTimeAdjustment(null); // Close dropdown
                                    }}
                                    disabled={
                                      sceneLoading.normalizingAudio !== null
                                    }
                                    className={`flex items-center space-x-1 px-2 py-2 text-xs font-medium text-gray-700 hover:bg-gray-50 rounded flex-1 justify-center ${
                                      sceneLoading.normalizingAudio === scene.id
                                        ? 'opacity-50 cursor-not-allowed'
                                        : sceneLoading.normalizingAudio !== null
                                          ? 'opacity-50 cursor-not-allowed'
                                          : ''
                                    }`}
                                    title={
                                      sceneLoading.normalizingAudio === scene.id
                                        ? 'Normalizing final video audio...'
                                        : sceneLoading.normalizingAudio !== null
                                          ? `Audio normalization is in progress for scene ${sceneLoading.normalizingAudio}`
                                          : 'Normalize final video audio using EBU R128 standard'
                                    }
                                  >
                                    {sceneLoading.normalizingAudio ===
                                    scene.id ? (
                                      <Loader2 className='h-3 w-3 animate-spin' />
                                    ) : (
                                      <Volume2 className='h-3 w-3' />
                                    )}
                                    <span>
                                      {sceneLoading.normalizingAudio ===
                                      scene.id
                                        ? 'Normalizing...'
                                        : 'Final'}
                                    </span>
                                  </button>
                                )}
                            </div>
                          </div>
                        )}

                        {/* Optimize Silence Section */}
                        {((typeof scene['field_6886'] === 'string' &&
                          scene['field_6886']) ||
                          (typeof scene['field_6888'] === 'string' &&
                            scene['field_6888'])) && (
                          <div className='border-t border-gray-200 pt-3'>
                            <div className='flex gap-2'>
                              {/* Optimize Silence Original Video Button */}
                              {typeof scene['field_6888'] === 'string' &&
                                scene['field_6888'] && (
                                  <button
                                    onClick={() => {
                                      handleOptimizeSilenceOriginal(
                                        scene.id,
                                        scene,
                                      );
                                      setShowTimeAdjustment(null); // Close dropdown
                                    }}
                                    disabled={
                                      sceneLoading.convertingToCFRVideo !== null
                                    }
                                    className={`flex items-center space-x-1 px-2 py-2 text-xs font-medium text-gray-700 hover:bg-gray-50 rounded flex-1 justify-center ${
                                      sceneLoading.convertingToCFRVideo ===
                                      scene.id
                                        ? 'opacity-50 cursor-not-allowed'
                                        : sceneLoading.convertingToCFRVideo !==
                                            null
                                          ? 'opacity-50 cursor-not-allowed'
                                          : ''
                                    }`}
                                    title={
                                      sceneLoading.convertingToCFRVideo ===
                                      scene.id
                                        ? 'Optimizing silence in original video...'
                                        : sceneLoading.convertingToCFRVideo !==
                                            null
                                          ? `Silence optimization is in progress for scene ${sceneLoading.convertingToCFRVideo}`
                                          : 'Detect and speed up silent parts in original video'
                                    }
                                  >
                                    {sceneLoading.convertingToCFRVideo ===
                                    scene.id ? (
                                      <Loader2 className='h-3 w-3 animate-spin' />
                                    ) : (
                                      <FastForward className='h-3 w-3' />
                                    )}
                                    <span>
                                      {sceneLoading.convertingToCFRVideo ===
                                      scene.id
                                        ? 'Optimizing...'
                                        : 'Original Silence'}
                                    </span>
                                  </button>
                                )}

                              {/* Optimize Silence Final Video Button */}
                              {typeof scene['field_6886'] === 'string' &&
                                scene['field_6886'] && (
                                  <button
                                    onClick={() => {
                                      handleOptimizeSilenceFinal(
                                        scene.id,
                                        scene,
                                      );
                                      setShowTimeAdjustment(null); // Close dropdown
                                    }}
                                    disabled={
                                      sceneLoading.convertingToCFRVideo !== null
                                    }
                                    className={`flex items-center space-x-1 px-2 py-2 text-xs font-medium text-gray-700 hover:bg-gray-50 rounded flex-1 justify-center ${
                                      sceneLoading.convertingToCFRVideo ===
                                      scene.id
                                        ? 'opacity-50 cursor-not-allowed'
                                        : sceneLoading.convertingToCFRVideo !==
                                            null
                                          ? 'opacity-50 cursor-not-allowed'
                                          : ''
                                    }`}
                                    title={
                                      sceneLoading.convertingToCFRVideo ===
                                      scene.id
                                        ? 'Optimizing silence in final video...'
                                        : sceneLoading.convertingToCFRVideo !==
                                            null
                                          ? `Silence optimization is in progress for scene ${sceneLoading.convertingToCFRVideo}`
                                          : 'Detect and speed up silent parts in final video'
                                    }
                                  >
                                    {sceneLoading.convertingToCFRVideo ===
                                    scene.id ? (
                                      <Loader2 className='h-3 w-3 animate-spin' />
                                    ) : (
                                      <FastForward className='h-3 w-3' />
                                    )}
                                    <span>
                                      {sceneLoading.convertingToCFRVideo ===
                                      scene.id
                                        ? 'Optimizing...'
                                        : 'Final Silence'}
                                    </span>
                                  </button>
                                )}
                            </div>
                          </div>
                        )}

                        {/* Typing Effect Section */}
                        {typeof scene['field_6888'] === 'string' &&
                          scene['field_6888'] &&
                          String(
                            scene['field_6890'] || scene.field_6890 || '',
                          ).trim() && (
                            <div className='border-t border-gray-200 pt-3'>
                              <button
                                onClick={() => {
                                  handleTypingEffect(scene.id, scene);
                                  setShowTimeAdjustment(null); // Close dropdown
                                }}
                                disabled={
                                  sceneLoading.creatingTypingEffect !== null ||
                                  batchOperations.generatingAllVideos
                                }
                                className={`flex items-center space-x-2 px-3 py-2 text-xs font-medium text-gray-700 hover:bg-gray-50 rounded w-full text-left ${
                                  sceneLoading.creatingTypingEffect === scene.id
                                    ? 'opacity-50 cursor-not-allowed'
                                    : sceneLoading.creatingTypingEffect !==
                                          null ||
                                        batchOperations.generatingAllVideos
                                      ? 'opacity-50 cursor-not-allowed'
                                      : ''
                                }`}
                                title={
                                  sceneLoading.creatingTypingEffect === scene.id
                                    ? 'Creating typing effect for this scene...'
                                    : sceneLoading.creatingTypingEffect !== null
                                      ? `Typing effect is being created for scene ${sceneLoading.creatingTypingEffect}`
                                      : batchOperations.generatingAllVideos
                                        ? 'Batch video generation is in progress'
                                        : 'Create typing effect video with animated text overlay'
                                }
                              >
                                {sceneLoading.creatingTypingEffect ===
                                scene.id ? (
                                  <Loader2 className='h-3 w-3 animate-spin' />
                                ) : (
                                  <Keyboard className='h-3 w-3' />
                                )}
                                <span>
                                  {sceneLoading.creatingTypingEffect ===
                                  scene.id
                                    ? 'Creating Typing Effect...'
                                    : sceneLoading.creatingTypingEffect !==
                                          null ||
                                        batchOperations.generatingAllVideos
                                      ? 'Typing Effect Busy'
                                      : 'Create Typing Effect'}
                                </span>
                              </button>
                            </div>
                          )}

                        {/* Convert to CFR Section */}
                        {((typeof scene['field_6886'] === 'string' &&
                          scene['field_6886']) ||
                          (typeof scene['field_6888'] === 'string' &&
                            scene['field_6888'])) && (
                          <div className='border-t border-gray-200 pt-3'>
                            <div className='flex gap-2'>
                              {/* Convert Original Video to CFR Button */}
                              {typeof scene['field_6888'] === 'string' &&
                                scene['field_6888'] && (
                                  <button
                                    onClick={() => {
                                      handleConvertOriginalToCFR(
                                        scene.id,
                                        scene,
                                      );
                                      setShowTimeAdjustment(null); // Close dropdown
                                    }}
                                    disabled={
                                      sceneLoading.convertingToCFRVideo !== null
                                    }
                                    className={`flex items-center space-x-1 px-2 py-2 text-xs font-medium text-gray-700 hover:bg-gray-50 rounded flex-1 justify-center ${
                                      sceneLoading.convertingToCFRVideo ===
                                      scene.id
                                        ? 'opacity-50 cursor-not-allowed'
                                        : sceneLoading.convertingToCFRVideo !==
                                            null
                                          ? 'opacity-50 cursor-not-allowed'
                                          : ''
                                    }`}
                                    title={
                                      sceneLoading.convertingToCFRVideo ===
                                      scene.id
                                        ? 'Converting original video to CFR...'
                                        : sceneLoading.convertingToCFRVideo !==
                                            null
                                          ? `CFR conversion is in progress for scene ${sceneLoading.convertingToCFRVideo}`
                                          : 'Convert original video to Constant Frame Rate (30fps)'
                                    }
                                  >
                                    {sceneLoading.convertingToCFRVideo ===
                                    scene.id ? (
                                      <Loader2 className='h-3 w-3 animate-spin' />
                                    ) : (
                                      <Video className='h-3 w-3' />
                                    )}
                                    <span>
                                      {sceneLoading.convertingToCFRVideo ===
                                      scene.id
                                        ? 'Converting...'
                                        : 'Original CFR'}
                                    </span>
                                  </button>
                                )}

                              {/* Convert Final Video to CFR Button */}
                              {typeof scene['field_6886'] === 'string' &&
                                scene['field_6886'] && (
                                  <button
                                    onClick={() => {
                                      handleConvertFinalToCFR(scene.id, scene);
                                      setShowTimeAdjustment(null); // Close dropdown
                                    }}
                                    disabled={
                                      sceneLoading.convertingToCFRVideo !== null
                                    }
                                    className={`flex items-center space-x-1 px-2 py-2 text-xs font-medium text-gray-700 hover:bg-gray-50 rounded flex-1 justify-center ${
                                      sceneLoading.convertingToCFRVideo ===
                                      scene.id
                                        ? 'opacity-50 cursor-not-allowed'
                                        : sceneLoading.convertingToCFRVideo !==
                                            null
                                          ? 'opacity-50 cursor-not-allowed'
                                          : ''
                                    }`}
                                    title={
                                      sceneLoading.convertingToCFRVideo ===
                                      scene.id
                                        ? 'Converting final video to CFR...'
                                        : sceneLoading.convertingToCFRVideo !==
                                            null
                                          ? `CFR conversion is in progress for scene ${sceneLoading.convertingToCFRVideo}`
                                          : 'Convert final video to Constant Frame Rate (30fps)'
                                    }
                                  >
                                    {sceneLoading.convertingToCFRVideo ===
                                    scene.id ? (
                                      <Loader2 className='h-3 w-3 animate-spin' />
                                    ) : (
                                      <Video className='h-3 w-3' />
                                    )}
                                    <span>
                                      {sceneLoading.convertingToCFRVideo ===
                                      scene.id
                                        ? 'Converting...'
                                        : 'Final CFR'}
                                    </span>
                                  </button>
                                )}
                            </div>
                          </div>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              </div>

              {/* Media Controls Group - Right Side with flex-1 wrapper */}
              <div className='flex-1 flex justify-end'>
                <div className='flex flex-wrap gap-2'>
                  {/* TTS Produce Button */}
                  <button
                    onClick={() =>
                      handleTTSProduce(
                        scene.id,
                        String(scene['field_6890'] || scene.field_6890 || ''),
                        scene,
                      )
                    }
                    onContextMenu={(e) => {
                      // Right-click: generate with a one-off random seed.
                      e.preventDefault();
                      e.stopPropagation();

                      const randomSeed =
                        typeof crypto !== 'undefined' &&
                        typeof crypto.getRandomValues === 'function'
                          ? crypto.getRandomValues(new Uint32Array(1))[0]
                          : Math.floor(Math.random() * 2 ** 32);

                      void handleTTSProduce(
                        scene.id,
                        String(scene['field_6890'] || scene.field_6890 || ''),
                        scene,
                        { seedOverride: Number(randomSeed) },
                      );
                    }}
                    disabled={
                      sceneLoading.producingTTS !== null ||
                      batchOperations.generatingAllTTS ||
                      !String(
                        scene['field_6890'] || scene.field_6890 || '',
                      ).trim()
                    }
                    className={`flex items-center justify-center space-x-1 px-3 py-1 h-7 min-w-[70px] rounded-full text-xs font-medium transition-colors ${
                      sceneLoading.producingTTS === scene.id
                        ? 'bg-gray-100 text-gray-500'
                        : sceneLoading.producingTTS !== null ||
                            batchOperations.generatingAllTTS
                          ? 'bg-gray-50 text-gray-400'
                          : 'bg-purple-100 text-purple-700 hover:bg-purple-200'
                    } disabled:opacity-50 disabled:cursor-not-allowed`}
                    title={
                      sceneLoading.producingTTS === scene.id
                        ? 'Generating TTS for this scene...'
                        : sceneLoading.producingTTS !== null
                          ? `TTS is being generated for scene ${sceneLoading.producingTTS}`
                          : batchOperations.generatingAllTTS
                            ? 'Batch TTS generation is in progress'
                            : 'Generate TTS from sentence (right-click: random seed)'
                    }
                  >
                    {sceneLoading.producingTTS === scene.id ? (
                      <Loader2 className='animate-spin h-3 w-3' />
                    ) : typeof scene['field_6891'] === 'string' &&
                      scene['field_6891'] ? (
                      <div className='flex items-center space-x-1'>
                        <div
                          onClick={(e) => {
                            e.stopPropagation();
                            handleRemoveTTS(scene.id);
                          }}
                          className='p-0 bg-transparent hover:scale-125 transition-transform duration-200 cursor-pointer'
                          title='Remove TTS audio'
                        >
                          {removingTTSId === scene.id ? (
                            <Loader2 className='animate-spin h-3 w-3' />
                          ) : (
                            <X className='h-3 w-3 text-purple-700' />
                          )}
                        </div>
                        <div
                          onClick={(e) => {
                            e.stopPropagation();
                            handleAudioPlay(
                              scene.id,
                              scene['field_6891'] as string,
                            );
                          }}
                          className='p-0 bg-transparent hover:scale-125 transition-transform duration-200 cursor-pointer'
                          title={
                            mediaPlayer.playingAudioId === scene.id
                              ? 'Pause audio'
                              : 'Play audio'
                          }
                        >
                          {loadingAudio === scene.id ? (
                            <Loader2 className='animate-spin h-3 w-3' />
                          ) : mediaPlayer.playingAudioId === scene.id ? (
                            <Pause className='h-3 w-3 text-purple-700' />
                          ) : (
                            <Play className='h-3 w-3 text-purple-700' />
                          )}
                        </div>
                      </div>
                    ) : (
                      <CheckCircle className='h-3 w-3' />
                    )}
                    <span>
                      {sceneLoading.producingTTS === scene.id
                        ? 'Producing...'
                        : sceneLoading.producingTTS !== null ||
                            batchOperations.generatingAllTTS
                          ? 'TTS Busy'
                          : typeof scene['field_6891'] === 'string' &&
                              scene['field_6891']
                            ? 'TTS'
                            : 'Gen TTS'}
                    </span>
                  </button>

                  {/* AI Improvement Button */}
                  <button
                    onClick={() =>
                      handleSentenceImprovement(
                        scene.id,
                        String(scene['field_6890'] || scene.field_6890 || ''),
                        modelSelection.selectedModel || undefined,
                      )
                    }
                    disabled={
                      sceneLoading.improvingSentence !== null ||
                      batchOperations.improvingAll ||
                      !String(
                        scene['field_6890'] || scene.field_6890 || '',
                      ).trim()
                    }
                    className={`flex items-center justify-center space-x-1 px-1 py-1 h-7 min-w-[70px] rounded-full text-xs font-medium transition-colors ${
                      sceneLoading.improvingSentence === scene.id
                        ? 'bg-gray-100 text-gray-500'
                        : sceneLoading.improvingSentence !== null ||
                            batchOperations.improvingAll
                          ? 'bg-gray-50 text-gray-400'
                          : 'bg-indigo-100 text-indigo-700 hover:bg-indigo-200'
                    } disabled:opacity-50 disabled:cursor-not-allowed`}
                    title={
                      sceneLoading.improvingSentence === scene.id
                        ? 'Improving this sentence...'
                        : sceneLoading.improvingSentence !== null
                          ? `AI is improving sentence for scene ${sceneLoading.improvingSentence}`
                          : batchOperations.improvingAll
                            ? 'Batch AI improvement is in progress'
                            : modelSelection.selectedModel
                              ? `Improve sentence with AI using: ${modelSelection.selectedModel}`
                              : 'Improve sentence with AI (no model selected)'
                    }
                  >
                    {sceneLoading.improvingSentence === scene.id ? (
                      <Loader2 className='animate-spin h-3 w-3' />
                    ) : (
                      <div className='flex items-center space-x-1'>
                        <div
                          onClick={(e) => {
                            e.stopPropagation();
                            handleSentenceImprovement(
                              scene.id,
                              String(
                                scene['field_6890'] || scene.field_6890 || '',
                              ),
                              modelSelection.selectedModel || undefined,
                              scene,
                              false,
                              true, // enforce longer sentences
                            );
                          }}
                          className='p-0 bg-transparent hover:scale-125 transition-transform duration-200 cursor-pointer'
                          title='Detailed AI improvement with longer sentences'
                        >
                          <Sparkles className='h-3 w-3 text-purple-600' />
                        </div>
                        <Sparkles className='h-3 w-3' />
                      </div>
                    )}
                    <span>
                      {sceneLoading.improvingSentence === scene.id
                        ? 'Improving...'
                        : sceneLoading.improvingSentence !== null ||
                            batchOperations.improvingAll
                          ? 'Busy'
                          : 'AI'}
                    </span>
                  </button>

                  {/* Video Play Button */}
                  {typeof scene['field_6888'] === 'string' &&
                    scene['field_6888'] && (
                      <button
                        onClick={() =>
                          handleVideoPlay(
                            scene.id,
                            scene['field_6888'] as string,
                          )
                        }
                        disabled={loadingVideo === scene.id}
                        className={`flex items-center justify-center space-x-1 px-3 py-1 h-7 min-w-[70px] rounded-full text-xs font-medium transition-colors ${
                          mediaPlayer.playingVideoId === scene.id
                            ? 'bg-purple-100 text-purple-700 hover:bg-purple-200'
                            : 'bg-green-100 text-green-700 hover:bg-green-200'
                        } disabled:opacity-50 disabled:cursor-not-allowed`}
                        title={
                          mediaPlayer.playingVideoId === scene.id
                            ? 'Stop'
                            : 'Play'
                        }
                      >
                        {loadingVideo === scene.id ? (
                          <Loader2 className='animate-spin h-3 w-3' />
                        ) : mediaPlayer.playingVideoId === scene.id ? (
                          <Square className='h-3 w-3' />
                        ) : (
                          <Video className='h-3 w-3' />
                        )}
                        <span>
                          {mediaPlayer.playingVideoId === scene.id
                            ? 'Stop'
                            : 'Orig'}
                        </span>
                      </button>
                    )}

                  {/* Speed Up Video Button */}
                  {typeof scene['field_6888'] === 'string' &&
                    scene['field_6888'] && (
                      <button
                        onClick={() => handleSpeedUpVideo(scene.id, scene)}
                        disabled={
                          sceneLoading.speedingUpVideo !== null ||
                          batchOperations.speedingUpAllVideos
                        }
                        className={`flex items-center justify-center space-x-1 px-3 py-1 h-7 min-w-[80px] rounded-full text-xs font-medium transition-all duration-300 disabled:opacity-50 disabled:cursor-not-allowed ${
                          sceneLoading.speedingUpVideo === scene.id
                            ? 'bg-gray-100 text-gray-500'
                            : sceneLoading.speedingUpVideo !== null ||
                                batchOperations.speedingUpAllVideos
                              ? 'bg-gray-50 text-gray-400'
                              : 'bg-blue-100 text-blue-700 hover:bg-blue-200'
                        }`}
                        title={
                          sceneLoading.speedingUpVideo === scene.id
                            ? 'Speed up video processing for this scene...'
                            : sceneLoading.speedingUpVideo !== null
                              ? `Video is being sped up for scene ${sceneLoading.speedingUpVideo}`
                              : batchOperations.speedingUpAllVideos
                                ? 'Batch video speed-up is in progress'
                                : `Speed up video ${
                                    videoSettings.selectedSpeed
                                  }x and ${
                                    videoSettings.muteAudio ? 'mute' : 'keep'
                                  } audio (saves to field 6886)`
                        }
                      >
                        {sceneLoading.speedingUpVideo === scene.id ? (
                          <Loader2 className='animate-spin h-3 w-3' />
                        ) : (
                          <div className='flex items-center space-x-1'>
                            <div
                              onClick={(e) => {
                                e.stopPropagation();
                                updateVideoSettings({
                                  muteAudio: !videoSettings.muteAudio,
                                });
                              }}
                              className='p-0 bg-transparent hover:scale-125 transition-transform duration-200 cursor-pointer'
                              title={`Click to ${
                                videoSettings.muteAudio ? 'enable' : 'mute'
                              } audio`}
                            >
                              {videoSettings.muteAudio ? (
                                <VolumeX className='h-3 w-3 text-blue-700' />
                              ) : (
                                <Volume2 className='h-3 w-3 text-blue-700' />
                              )}
                            </div>
                            <div
                              onClick={(e) => {
                                e.stopPropagation();
                                cycleSpeed();
                              }}
                              className='px-1 py-0.5 text-xs font-bold text-blue-700 hover:bg-blue-600/20 rounded transition-colors duration-200 cursor-pointer'
                              title='Click to cycle through speeds (1x → 1.125x → 1.5x → 2x → 4x → 8x)'
                            >
                              {videoSettings.selectedSpeed}x
                            </div>
                          </div>
                        )}
                        <span>
                          {sceneLoading.speedingUpVideo === scene.id
                            ? 'Processing...'
                            : sceneLoading.speedingUpVideo !== null ||
                                batchOperations.speedingUpAllVideos
                              ? 'Speed Busy'
                              : 'Speed'}
                        </span>
                      </button>
                    )}

                  {/* Generate Clip Button */}
                  {typeof scene['field_6889'] === 'string' &&
                    scene['field_6889'] && (
                      <button
                        onClick={() =>
                          handleGenerateSingleClip(scene.id, scene)
                        }
                        disabled={
                          clipGeneration.generatingSingleClip !== null ||
                          clipGeneration.generatingClips !== null
                        }
                        className={`flex items-center justify-center space-x-1 px-3 py-1 h-7 min-w-[80px] rounded-full text-xs font-medium transition-all duration-300 disabled:opacity-50 disabled:cursor-not-allowed ${
                          clipGeneration.generatingSingleClip === scene.id
                            ? 'bg-purple-100 text-purple-500'
                            : clipGeneration.generatingSingleClip !== null ||
                                clipGeneration.generatingClips !== null
                              ? 'bg-gray-50 text-gray-400'
                              : 'bg-purple-100 text-purple-700 hover:bg-purple-200'
                        }`}
                        title={
                          clipGeneration.generatingSingleClip === scene.id
                            ? 'Generating clip for this scene...'
                            : clipGeneration.generatingSingleClip !== null
                              ? `Clip is being generated for scene ${clipGeneration.generatingSingleClip}`
                              : clipGeneration.generatingClips !== null
                                ? 'Bulk clip generation is in progress'
                                : 'Generate video clip for this scene'
                        }
                      >
                        {clipGeneration.generatingSingleClip === scene.id ? (
                          <Loader2 className='animate-spin h-3 w-3' />
                        ) : typeof scene['field_6886'] === 'string' &&
                          scene['field_6886'] ? (
                          <div className='flex items-center space-x-1'>
                            <div
                              onClick={(e) => {
                                e.stopPropagation();
                                handleClearVideo(scene.id);
                              }}
                              className='p-0 bg-transparent hover:scale-125 transition-transform duration-200 cursor-pointer'
                              title='Clear processed video (field 6886)'
                            >
                              {clearingVideoId === scene.id ? (
                                <Loader2 className='animate-spin h-3 w-3' />
                              ) : (
                                <X className='h-3 w-3 text-purple-700' />
                              )}
                            </div>
                            <Scissors className='h-3 w-3' />
                          </div>
                        ) : (
                          <Scissors className='h-3 w-3' />
                        )}
                        <span>
                          {clipGeneration.generatingSingleClip === scene.id
                            ? 'Generating...'
                            : clipGeneration.generatingSingleClip !== null ||
                                clipGeneration.generatingClips !== null
                              ? 'Clip Busy'
                              : 'Gen'}
                        </span>
                      </button>
                    )}

                  {/* Generate Video Button */}
                  {typeof scene['field_6888'] === 'string' &&
                    scene['field_6888'] &&
                    typeof scene['field_6891'] === 'string' &&
                    scene['field_6891'] && (
                      <button
                        onClick={() =>
                          handleVideoGenerate(
                            scene.id,
                            scene['field_6888'] as string,
                            scene['field_6891'] as string,
                            scene,
                            syncZoomLevel,
                            syncPanMode,
                          )
                        }
                        disabled={
                          sceneLoading.generatingVideo !== null ||
                          batchOperations.generatingAllVideos
                        }
                        className={`flex items-center justify-center space-x-1 px-3 py-1 h-7 min-w-[90px] rounded-full text-xs font-medium transition-colors ${
                          sceneLoading.generatingVideo === scene.id
                            ? 'bg-gray-100 text-gray-500'
                            : sceneLoading.generatingVideo !== null ||
                                batchOperations.generatingAllVideos
                              ? 'bg-gray-50 text-gray-400'
                              : 'bg-teal-100 text-teal-700 hover:bg-teal-200'
                        } disabled:opacity-50 disabled:cursor-not-allowed`}
                        title={
                          sceneLoading.generatingVideo === scene.id
                            ? 'Generating synchronized video for this scene...'
                            : sceneLoading.generatingVideo !== null
                              ? `Video is being generated for scene ${sceneLoading.generatingVideo}`
                              : batchOperations.generatingAllVideos
                                ? 'Batch video generation is in progress'
                                : `Generate synchronized video (Zoom: ${syncZoomLevel}%${
                                    syncPanMode !== 'none'
                                      ? ` ${syncPanMode}`
                                      : ''
                                  })`
                        }
                      >
                        {sceneLoading.generatingVideo === scene.id ? (
                          <Loader2 className='animate-spin h-3 w-3' />
                        ) : (
                          <>
                            <Settings className='h-3 w-3' />
                            <div
                              onClick={(e) => {
                                e.stopPropagation();
                                // Cycle zoom: 0 -> 10 -> 20 -> 30 -> 40 -> 50 -> 0
                                setSyncZoomLevel((prev) =>
                                  prev >= 50 ? 0 : prev + 10,
                                );
                              }}
                              className='px-1 py-0.5 text-xs font-bold text-teal-700 hover:bg-teal-600/20 rounded transition-colors duration-200 cursor-pointer'
                              title='Click to cycle zoom level (0% → 10% → 20% → 30% → 40% → 50% → 0%)'
                            >
                              {syncZoomLevel}%
                            </div>
                            <div className='relative'>
                              <div
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setPanModeDropdownOpen((prev) =>
                                    prev === scene.id ? null : scene.id,
                                  );
                                }}
                                className={`px-1 py-0.5 text-xs font-bold rounded transition-colors duration-200 cursor-pointer ${
                                  syncPanMode !== 'none'
                                    ? 'text-orange-700 bg-orange-200 hover:bg-orange-300'
                                    : 'text-teal-700 hover:bg-teal-600/20'
                                }`}
                                title='Click to select pan mode'
                              >
                                {syncPanMode === 'none'
                                  ? '▼'
                                  : syncPanMode === 'zoom'
                                    ? 'Z▼'
                                    : syncPanMode === 'zoomOut'
                                      ? 'O▼'
                                      : 'T▼'}
                              </div>
                              {panModeDropdownOpen === scene.id && (
                                <div
                                  className='absolute top-full left-0 mt-1 bg-white border border-gray-200 rounded-lg shadow-lg z-50 min-w-[120px]'
                                  onClick={(e) => e.stopPropagation()}
                                >
                                  <div
                                    onClick={() => {
                                      setSyncPanMode('none');
                                      setPanModeDropdownOpen(null);
                                    }}
                                    className={`px-3 py-1.5 text-xs cursor-pointer hover:bg-gray-100 ${
                                      syncPanMode === 'none'
                                        ? 'bg-gray-100 font-bold'
                                        : ''
                                    }`}
                                  >
                                    None
                                  </div>
                                  <div
                                    onClick={() => {
                                      setSyncPanMode('zoom');
                                      setPanModeDropdownOpen(null);
                                    }}
                                    className={`px-3 py-1.5 text-xs cursor-pointer hover:bg-gray-100 ${
                                      syncPanMode === 'zoom'
                                        ? 'bg-orange-100 font-bold text-orange-700'
                                        : ''
                                    }`}
                                  >
                                    Zoom In
                                  </div>
                                  <div
                                    onClick={() => {
                                      setSyncPanMode('zoomOut');
                                      setPanModeDropdownOpen(null);
                                    }}
                                    className={`px-3 py-1.5 text-xs cursor-pointer hover:bg-gray-100 ${
                                      syncPanMode === 'zoomOut'
                                        ? 'bg-orange-100 font-bold text-orange-700'
                                        : ''
                                    }`}
                                  >
                                    Zoom Out
                                  </div>
                                  <div
                                    onClick={() => {
                                      setSyncPanMode('topToBottom');
                                      setPanModeDropdownOpen(null);
                                    }}
                                    className={`px-3 py-1.5 text-xs cursor-pointer hover:bg-gray-100 ${
                                      syncPanMode === 'topToBottom'
                                        ? 'bg-orange-100 font-bold text-orange-700'
                                        : ''
                                    }`}
                                  >
                                    Top to Bottom
                                  </div>
                                </div>
                              )}
                            </div>
                          </>
                        )}
                        <span>
                          {sceneLoading.generatingVideo === scene.id
                            ? 'Generating...'
                            : sceneLoading.generatingVideo !== null
                              ? 'Video Busy'
                              : batchOperations.generatingAllVideos
                                ? 'Video Busy'
                                : 'Sync'}
                        </span>
                      </button>
                    )}

                  {/* Image Overlay Button */}
                  {typeof scene['field_6886'] === 'string' &&
                    scene['field_6886'] && (
                      <>
                        <button
                          onClick={() => {
                            void handleAutoFixMismatch(
                              scene.id,
                              scene as BaserowRow,
                            );
                          }}
                          aria-label={
                            autoFixingMismatchSceneId === scene.id
                              ? 'Fix mismatch (running)'
                              : 'Fix mismatch'
                          }
                          disabled={
                            addingImageOverlay === scene.id ||
                            autoFixingMismatchSceneId !== null
                          }
                          className={`inline-flex items-center justify-center w-9 h-7 rounded-full text-xs font-medium transition-colors ${
                            autoFixingMismatchSceneId === scene.id
                              ? 'bg-gray-100 text-gray-500'
                              : 'bg-emerald-100 text-emerald-700 hover:bg-emerald-200'
                          } disabled:opacity-50 disabled:cursor-not-allowed`}
                          title={
                            autoFixMismatchStatus[scene.id]
                              ? `Fix mismatch: ${autoFixMismatchStatus[scene.id]}`
                              : 'Fix mismatch: compare scene text vs transcription; if different, regenerate TTS + sync + retranscribe (max 3 tries)'
                          }
                        >
                          {autoFixingMismatchSceneId === scene.id ? (
                            <Loader2 className='animate-spin h-3 w-3' />
                          ) : (
                            <Wand2 className='h-3 w-3' />
                          )}
                        </button>

                        <button
                          onClick={() =>
                            handleOpenImageOverlayModal(
                              scene.id,
                              scene['field_6886'] as string,
                            )
                          }
                          disabled={addingImageOverlay === scene.id}
                          className={`flex items-center justify-center space-x-1 px-3 py-1 h-7 min-w-[80px] rounded-full text-xs font-medium transition-colors ${
                            addingImageOverlay === scene.id
                              ? 'bg-gray-100 text-gray-500'
                              : 'bg-rose-100 text-rose-700 hover:bg-rose-200'
                          } disabled:opacity-50 disabled:cursor-not-allowed`}
                          title='Add image overlay to final video'
                        >
                          {addingImageOverlay === scene.id ? (
                            <Loader2 className='animate-spin h-3 w-3' />
                          ) : (
                            <ImageIcon className='h-3 w-3' />
                          )}
                          <span>
                            {addingImageOverlay === scene.id
                              ? 'Adding...'
                              : 'Image'}
                          </span>
                        </button>
                      </>
                    )}

                  {/* Combine Next Scene Button */}
                  <button
                    onClick={async (e) => {
                      e.stopPropagation();
                      if (!confirm('Combine the next scene into this one?'))
                        return;
                      await handleCombineWithNext(scene.id);
                    }}
                    disabled={combiningId === scene.id}
                    className={`flex items-center justify-center space-x-1 px-1 py-1 h-7 min-w-[65px] rounded-full text-xs font-medium transition-colors ${
                      combiningId === scene.id
                        ? 'bg-gray-100 text-gray-500'
                        : 'bg-violet-100 text-violet-700 hover:bg-violet-200'
                    } disabled:opacity-50 disabled:cursor-not-allowed`}
                    title='Combine this scene with the next scene'
                  >
                    {combiningId === scene.id ? (
                      <Loader2 className='animate-spin h-3 w-3' />
                    ) : (
                      <FastForward className='h-3 w-3' />
                    )}
                    <span>Com</span>
                  </button>

                  {/* Produced Video Button - LAST */}
                  {typeof scene['field_6886'] === 'string' &&
                    scene['field_6886'] && (
                      <button
                        onClick={() =>
                          handleProducedVideoPlay(
                            scene.id,
                            scene['field_6886'] as string,
                          )
                        }
                        disabled={loadingProducedVideo === scene.id}
                        className={`flex items-center justify-center space-x-1 px-3 py-1 h-7 min-w-[85px] rounded-full text-xs font-medium transition-colors ${
                          mediaPlayer.playingProducedVideoId === scene.id
                            ? 'bg-orange-100 text-orange-700 hover:bg-orange-200'
                            : 'bg-yellow-100 text-yellow-700 hover:bg-yellow-200'
                        } disabled:opacity-50 disabled:cursor-not-allowed`}
                        title={
                          mediaPlayer.playingProducedVideoId === scene.id
                            ? 'Stop'
                            : 'Play'
                        }
                      >
                        {loadingProducedVideo === scene.id ? (
                          <Loader2 className='animate-spin h-3 w-3' />
                        ) : mediaPlayer.playingProducedVideoId === scene.id ? (
                          <Pause className='h-3 w-3' />
                        ) : (
                          <Monitor className='h-3 w-3' />
                        )}
                        <span>
                          {mediaPlayer.playingProducedVideoId === scene.id
                            ? 'Stop'
                            : 'Final Vid'}
                        </span>
                      </button>
                    )}
                </div>
              </div>
            </div>
            {editingId === scene.id ? (
              <div className='mt-1'>
                <textarea
                  value={editingText}
                  onChange={(e) => setEditingText(e.target.value)}
                  onKeyDown={(e) => handleKeyDown(e, scene.id)}
                  onBlur={(e) => {
                    // Only save on blur if we're not canceling and not clicking on save buttons
                    const relatedTarget = e.relatedTarget as HTMLElement;
                    const isClickingSaveButton =
                      relatedTarget?.tagName === 'BUTTON' &&
                      (relatedTarget.textContent?.includes('Save') ||
                        relatedTarget.textContent?.includes('Cancel'));

                    if (!isCanceling && !isClickingSaveButton) {
                      handleEditSave(scene.id);
                    }
                  }}
                  className='w-full p-2 border border-blue-300 rounded focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none'
                  rows={3}
                  autoFocus
                  disabled={isUpdating}
                  placeholder='Enter sentence...'
                />
                <div className='flex justify-end space-x-2 mt-2'>
                  <button
                    onClick={handleEditCancel}
                    className='px-3 py-1 text-xs text-gray-600 hover:text-gray-800'
                    disabled={isUpdating}
                  >
                    Cancel
                  </button>
                  <button
                    onClick={() => handleEditSave(scene.id)}
                    className='px-3 py-1 text-xs bg-blue-500 text-white rounded hover:bg-blue-600 disabled:opacity-50'
                    disabled={isUpdating}
                  >
                    Save
                  </button>
                  <button
                    onClick={() => handleEditSaveWithoutTTS(scene.id)}
                    className='px-3 py-1 text-xs bg-green-500 text-white rounded hover:bg-green-600 disabled:opacity-50'
                    disabled={isUpdating}
                    title='Save without generating TTS'
                  >
                    Save (No TTS)
                  </button>
                </div>
              </div>
            ) : (
              <div
                className='text-gray-700 mt-1 leading-relaxed cursor-pointer hover:bg-gray-50 p-2 rounded transition-colors line-clamp-1'
                onClick={() =>
                  handleEditStart(
                    scene.id,
                    String(scene['field_6890'] || scene.field_6890 || ''),
                  )
                }
                onContextMenu={(e) => {
                  // Right-click on the non-edit container:
                  // - If the editable sentence (field_6890) is empty, restore from original (field_6901)
                  // - Otherwise, clear the editable sentence
                  e.preventDefault();
                  if (isUpdating) return;
                  const currentScene = data.find((s) => s.id === scene.id);
                  const editable = String(currentScene?.field_6890 || '');
                  const original = String(currentScene?.field_6901 || '');
                  if (!editable && original) {
                    // Restore original into editable (same as revert button)
                    void handleRevertToOriginal(scene.id);
                  } else {
                    void handleClearSentenceField(scene.id);
                  }
                }}
                title={(() => {
                  const original = String(
                    scene?.field_6901 || scene.field_6901 || '',
                  );
                  const base =
                    'Click to edit (Right-click to clear sentence; if empty, restore original)';
                  return original ? `Original: ${original}\n${base}` : base;
                })()}
              >
                {String(
                  scene['field_6890'] ||
                    scene.field_6890 ||
                    'No sentence - Click to add',
                )}
              </div>
            )}
          </div>
        ))}
      </div>
      {/* Hidden audio elements for playback */}
      {data.map((scene) => (
        <audio
          key={`audio-${scene.id}`}
          ref={(el) => {
            if (el) audioRefs.current[scene.id] = el;
          }}
          onEnded={() => handleAudioPause(scene.id)}
          onError={(e) => {
            console.error('Audio error for scene', scene.id, e);
            setLoadingAudio(null);
            setPlayingAudio(null);
          }}
        />
      ))}

      {/* Floating Scroll to Top Button */}
      {!imageOverlayModal.isOpen && (
        <button
          onClick={() => {
            // Scroll to just above the first scene
            if (filteredAndSortedData.length > 0) {
              const firstScene = filteredAndSortedData[0];
              const cardElement = sceneCardRefs.current[firstScene.id];
              if (cardElement) {
                const cardTop =
                  cardElement.getBoundingClientRect().top + window.pageYOffset;
                const offsetTop = cardTop - 100; // 100px above the first scene
                window.scrollTo({
                  top: Math.max(0, offsetTop), // Ensure we don't go above the page
                  behavior: 'smooth',
                });
              }
            }
          }}
          className='fixed bottom-8 right-8 z-40 w-14 h-14 bg-blue-600 text-white rounded-full shadow-2xl hover:bg-blue-700 hover:shadow-3xl transition-all duration-300 flex items-center justify-center border-2 border-white'
          title='Scroll to first scene'
        >
          <svg
            className='w-7 h-7'
            fill='none'
            stroke='currentColor'
            viewBox='0 0 24 24'
            xmlns='http://www.w3.org/2000/svg'
          >
            <path
              strokeLinecap='round'
              strokeLinejoin='round'
              strokeWidth={2}
              d='M5 10l7-7m0 0l7 7m-7-7v18'
            />
          </svg>
        </button>
      )}

      {/* Image Overlay Modal */}
      <ImageOverlayModal
        isOpen={imageOverlayModal.isOpen}
        onClose={() =>
          setImageOverlayModal((prev) => ({
            ...prev,
            isOpen: false,
          }))
        }
        videoUrl={imageOverlayModal.videoUrl || ''}
        sceneId={imageOverlayModal.sceneId || 0}
        onApply={handleApplyImageOverlay}
        onUpdateModalVideoUrl={(newUrl) =>
          setImageOverlayModal((prev) => ({
            ...prev,
            videoUrl: newUrl,
          }))
        }
        isApplying={addingImageOverlay !== null}
        handleTranscribeScene={handleTranscribeScene}
      />
    </div>
  );
}
