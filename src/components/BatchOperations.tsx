'use client';

import React, { useState, useRef, useEffect } from 'react';
import { BaserowRow } from '@/lib/baserow-actions';
import { useAppStore } from '@/store/useAppStore';
import {
  handleImproveAllSentences,
  handleGenerateAllTTS,
  handleGenerateAllVideos,
  handleConcatenateAllVideos,
  handleSpeedUpAllVideos,
  cycleSpeed as cycleThroughSpeeds,
} from '@/utils/batchOperations';
import { playSuccessSound } from '@/utils/soundManager';
import {
  Loader2,
  Sparkles,
  Mic,
  Film,
  Image as ImageIcon,
  RefreshCw,
  Wand2,
  Volume2,
  VolumeX,
  Type,
  Download,
  ExternalLink,
  X,
  Play,
  Pause,
  Square,
  Save,
  Upload,
  Trash2,
} from 'lucide-react';

interface BatchOperationsProps {
  data: BaserowRow[];
  onRefresh?: () => void;
  refreshing?: boolean;
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
  handleTTSProduce: (sceneId: number, text: string) => Promise<void>;
  handleVideoGenerate: (
    sceneId: number,
    videoUrl: string,
    audioUrl: string,
    sceneData?: BaserowRow,
  ) => Promise<void>;
  handleTranscribeScene: (
    sceneId: number,
    sceneData?: BaserowRow,
    videoType?: 'original' | 'final',
    skipRefresh?: boolean,
    skipSound?: boolean,
  ) => Promise<void>;
}

export default function BatchOperations({
  data,
  onRefresh,
  refreshing = false,
  handleAutoFixMismatch,
  handleSentenceImprovement,
  handleTTSProduce,
  handleVideoGenerate,
}: BatchOperationsProps) {
  const {
    batchOperations,
    modelSelection,
    videoSettings,
    transcriptionSettings,
    subtitleGenerationSettings,
    updateVideoSettings,
    startBatchOperation,
    completeBatchOperation,
    setProducingTTS,
    sceneLoading,
    setImprovingSentence,
    setSpeedingUpVideo,
    setGeneratingVideo,
    setTranscribingScene,
    mergedVideo,
    setMergedVideo,
    clearMergedVideo,
    saveMergedVideoToOriginalTable,
    selectedOriginalVideo,
    saveSettingsToLocalStorage,
    loadSettingsFromLocalStorage,
    clearLocalStorageSettings,
  } = useAppStore();

  // Video player state
  const [isPlaying, setIsPlaying] = useState(false);
  const [showPlayer, setShowPlayer] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [isDragging, setIsDragging] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);

  // Collapsible state - collapsed by default
  const [isExpanded, setIsExpanded] = useState(false);
  const [isSettingsSectionExpanded, setIsSettingsSectionExpanded] =
    useState(false); // Settings section collapsed by default

  // Settings save/load state
  const [showSettingsMenu, setShowSettingsMenu] = useState(false);
  const [saveMessage, setSaveMessage] = useState<string | null>(null);
  const [savingToDatabase, setSavingToDatabase] = useState(false);
  const [saveToDbMessage, setSaveToDbMessage] = useState<string | null>(null);

  const [deletingEmptyScenes, setDeletingEmptyScenes] = useState(false);
  const [deletingEmptySceneId, setDeletingEmptySceneId] = useState<
    number | null
  >(null);

  const [generatingAllSubtitles, setGeneratingAllSubtitles] = useState(false);
  const [generatingSubtitleSceneId, setGeneratingSubtitleSceneId] = useState<
    number | null
  >(null);

  const [generatingAllSceneImages, setGeneratingAllSceneImages] =
    useState(false);
  const [generatingImageSceneId, setGeneratingImageSceneId] = useState<
    number | null
  >(null);

  const [upscalingAllSceneImages, setUpscalingAllSceneImages] = useState(false);
  const [upscalingSceneImageId, setUpscalingSceneImageId] = useState<
    number | null
  >(null);

  const [promptingAllScenes, setPromptingAllScenes] = useState(false);
  const [promptingSceneId, setPromptingSceneId] = useState<number | null>(null);

  const playBatchDoneSound = () => {
    playSuccessSound();
  };

  const isSceneFlagged = (scene: unknown): boolean => {
    if (!scene || typeof scene !== 'object') return false;
    const rec = scene as Record<string, unknown>;
    const raw =
      (scene as { field_7096?: unknown }).field_7096 ?? rec['field_7096'];
    if (raw === true) return true;
    if (!raw) return false;

    if (Array.isArray(raw)) {
      return raw.some((item) => {
        if (!item || typeof item !== 'object') return false;
        const obj = item as Record<string, unknown>;
        const value = obj.value ?? obj.name ?? obj.text ?? obj.title;
        if (value === true) return true;
        if (typeof value === 'string') {
          return value.trim().toLowerCase() === 'true';
        }
        return false;
      });
    }

    if (typeof raw === 'string') {
      return raw.trim().toLowerCase() === 'true';
    }

    if (typeof raw === 'object') {
      const obj = raw as Record<string, unknown>;
      const value = obj.value ?? obj.name ?? obj.text ?? obj.title;
      if (value === true) return true;
      if (typeof value === 'string') {
        return value.trim().toLowerCase() === 'true';
      }
    }

    return false;
  };

  // Load settings on component mount
  useEffect(() => {
    loadSettingsFromLocalStorage();
  }, [loadSettingsFromLocalStorage]);

  // Close settings menu when clicking outside
  useEffect(() => {
    const handleClickOutside = () => {
      if (showSettingsMenu) {
        setShowSettingsMenu(false);
      }
    };

    document.addEventListener('click', handleClickOutside);
    return () => document.removeEventListener('click', handleClickOutside);
  }, [showSettingsMenu]);

  // Video player controls
  const handlePlayPause = () => {
    const video = videoRef.current;
    if (!video) return;

    if (isPlaying) {
      video.pause();
      setIsPlaying(false);
    } else {
      video.play();
      setIsPlaying(true);
    }
  };

  const handleStop = () => {
    const video = videoRef.current;
    if (!video) return;

    video.pause();
    video.currentTime = 0;
    setIsPlaying(false);
    setCurrentTime(0);
  };

  const handleVideoEnded = () => {
    setIsPlaying(false);
    setCurrentTime(0);
  };

  const handleTimeUpdate = () => {
    const video = videoRef.current;
    if (!video || isDragging) return;

    setCurrentTime(video.currentTime);
  };

  const handleLoadedMetadata = () => {
    const video = videoRef.current;
    if (!video) return;

    setDuration(video.duration);
  };

  const handleSeek = (e: React.ChangeEvent<HTMLInputElement>) => {
    const video = videoRef.current;
    if (!video) return;

    const newTime = parseFloat(e.target.value);
    video.currentTime = newTime;
    setCurrentTime(newTime);
  };

  const handleSeekStart = () => {
    setIsDragging(true);
  };

  const handleSeekEnd = () => {
    setIsDragging(false);
  };

  const formatTime = (time: number) => {
    const minutes = Math.floor(time / 60);
    const seconds = Math.floor(time % 60);
    return `${minutes}:${seconds.toString().padStart(2, '0')}`;
  };

  // Settings management functions
  const handleSaveSettings = () => {
    saveSettingsToLocalStorage();
    setSaveMessage('Settings saved successfully!');
    setTimeout(() => setSaveMessage(null), 3000);
  };

  const handleLoadSettings = () => {
    loadSettingsFromLocalStorage();
    setSaveMessage('Settings loaded successfully!');
    setTimeout(() => setSaveMessage(null), 3000);
  };

  const handleClearSettings = () => {
    if (
      confirm(
        'Are you sure you want to clear all saved settings? This will reset everything to defaults.',
      )
    ) {
      clearLocalStorageSettings();
      setSaveMessage('Settings cleared and reset to defaults!');
      setTimeout(() => setSaveMessage(null), 3000);
    }
  };

  const handleDeleteEmptyScenes = async () => {
    if (deletingEmptyScenes) return;

    const emptyScenes = data.filter((scene) => {
      const sentence = String(scene['field_6890'] ?? '').trim();
      const original = String(
        scene['field_6901'] ?? scene['field_6900'] ?? '',
      ).trim();
      return sentence === '' && original === '';
    });

    if (emptyScenes.length === 0) {
      return;
    }

    setDeletingEmptyScenes(true);
    setDeletingEmptySceneId(null);

    try {
      for (const scene of emptyScenes) {
        setDeletingEmptySceneId(scene.id);

        const res = await fetch(`/api/baserow/scenes/${scene.id}`, {
          method: 'DELETE',
        });

        if (!res.ok) {
          const errorText = await res.text();
          throw new Error(
            `Failed to delete scene ${scene.id}: ${res.status} ${errorText}`,
          );
        }

        await new Promise((resolve) => setTimeout(resolve, 250));
      }

      if (onRefresh) {
        onRefresh();
      }
    } catch (error) {
      console.error('Failed to delete empty scenes:', error);
    } finally {
      setDeletingEmptyScenes(false);
      setDeletingEmptySceneId(null);
    }
  };

  const handleSaveMergedVideoToDatabase = async () => {
    if (!mergedVideo.url) {
      setSaveToDbMessage('No merged video available to save');
      setTimeout(() => setSaveToDbMessage(null), 3000);
      return;
    }

    if (!selectedOriginalVideo.id) {
      setSaveToDbMessage('Please select an original video first');
      setTimeout(() => setSaveToDbMessage(null), 3000);
      return;
    }

    setSavingToDatabase(true);
    setSaveToDbMessage(null);

    try {
      await saveMergedVideoToOriginalTable();
      setSaveToDbMessage('Merged video URL saved to database successfully!');
      setTimeout(() => setSaveToDbMessage(null), 3000);
    } catch (error) {
      console.error('Failed to save merged video to database:', error);
      setSaveToDbMessage('Failed to save to database. Please try again.');
      setTimeout(() => setSaveToDbMessage(null), 5000);
    } finally {
      setSavingToDatabase(false);
    }
  };

  const onImproveAllSentences = () => {
    handleImproveAllSentences(
      data,
      handleSentenceImprovement,
      modelSelection.selectedModel,
      startBatchOperation,
      completeBatchOperation,
      setImprovingSentence,
    );
  };

  const onPromptAllScenes = async () => {
    if (promptingAllScenes) return;
    if (!modelSelection.selectedModel) {
      return;
    }

    // Resolve the destination prompt field key once, so we can skip scenes
    // that already have a saved prompt.
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

    if (!promptFieldKey) {
      return;
    }

    const scenesToPrompt = data.filter((scene) => {
      const sentence = String(scene['field_6890'] ?? '').trim();
      const original = String(
        scene['field_6901'] ?? scene['field_6900'] ?? '',
      ).trim();
      if (!(sentence || original)) return false;

      const existingPromptValue = scene[promptFieldKey as keyof typeof scene];
      if (typeof existingPromptValue === 'string') {
        return existingPromptValue.trim().length === 0;
      }

      return true;
    });

    if (scenesToPrompt.length === 0) {
      playBatchDoneSound();
      return;
    }

    setPromptingAllScenes(true);
    setPromptingSceneId(null);

    try {
      for (const scene of scenesToPrompt) {
        setPromptingSceneId(scene.id);

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
          promptFieldKey?: unknown;
        } | null;
        const scenePrompt =
          typeof genData?.scenePrompt === 'string' ? genData.scenePrompt : null;

        if (!scenePrompt || !scenePrompt.trim()) {
          throw new Error(`Empty prompt returned for scene ${scene.id}`);
        }

        const patchRes = await fetch(`/api/baserow/scenes/${scene.id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            [promptFieldKey]: scenePrompt,
          }),
        });

        if (!patchRes.ok) {
          const t = await patchRes.text().catch(() => '');
          throw new Error(
            `Failed to save prompt for scene ${scene.id}: ${patchRes.status} ${t}`,
          );
        }

        await new Promise((resolve) => setTimeout(resolve, 150));
      }

      playBatchDoneSound();

      onRefresh?.();
    } catch (error) {
      console.error('Prompt All failed:', error);
    } finally {
      setPromptingAllScenes(false);
      setPromptingSceneId(null);
    }
  };

  const onGenerateAllTTS = () => {
    handleGenerateAllTTS(
      data,
      handleTTSProduce,
      startBatchOperation,
      completeBatchOperation,
      setProducingTTS,
    );
  };

  const onGenerateAllVideos = () => {
    handleGenerateAllVideos(
      data,
      handleVideoGenerate,
      startBatchOperation,
      completeBatchOperation,
      setGeneratingVideo,
      onRefresh,
    );
  };

  const onConcatenateAllVideos = () => {
    handleConcatenateAllVideos(
      data,
      startBatchOperation,
      completeBatchOperation,
      setMergedVideo,
      selectedOriginalVideo.id,
    );
  };

  const onFixAllFinalTTS = async () => {
    // This batch action must only run for the currently selected original video.
    if (!selectedOriginalVideo.id) return;

    startBatchOperation('transcribingAllFinalScenes');
    try {
      // Run sequentially, ordered, to avoid concurrency issues and ensure robust per-scene comparison.
      const scenesToFix = [...data]
        .filter((scene) => {
          const hasFinal =
            typeof scene['field_6886'] === 'string' &&
            String(scene['field_6886']).trim();
          const hasText = String(scene['field_6890'] || '').trim();
          return Boolean(hasFinal && hasText);
        })
        .sort((a, b) => (Number(a.order) || 0) - (Number(b.order) || 0));

      if (scenesToFix.length === 0) {
        console.log('No scenes with final video + text found to fix.');
        return;
      }

      for (const scene of scenesToFix) {
        setTranscribingScene(scene.id);
        try {
          await handleAutoFixMismatch(scene.id, scene);
        } catch (error) {
          console.error(`Fix TTS failed for scene ${scene.id}:`, error);
        } finally {
          setTranscribingScene(null);
        }

        // Small delay between scenes to be gentle on the backend.
        await new Promise((r) => setTimeout(r, 500));
      }

      onRefresh?.();
    } finally {
      completeBatchOperation('transcribingAllFinalScenes');
      playSuccessSound();
    }
  };

  const withCacheBust = (url: string) => {
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
  };

  const buildTranscriptionTextForCharCount = (words: unknown[]): string => {
    const tokens = words
      .map((w) => {
        if (!w || typeof w !== 'object') return '';
        const maybeWord = (w as { word?: unknown }).word;
        return typeof maybeWord === 'string' ? maybeWord.trim() : '';
      })
      .filter(Boolean);

    // Count spaces too: build the exact text shape we pass to the subtitle
    // renderer (words joined by single spaces).
    return tokens.join(' ');
  };

  const getExistingSceneImageUrl = (scene: BaserowRow): string => {
    const raw =
      scene['field_7094'] ??
      (scene as unknown as { field_7094?: unknown }).field_7094;

    if (typeof raw === 'string') return raw.trim();
    if (!raw) return '';

    // If this ever becomes a Baserow "file" field, it may come back as an array of objects.
    if (Array.isArray(raw) && raw.length > 0) {
      const first = raw[0] as unknown;
      if (typeof first === 'string') return first.trim();
      if (first && typeof first === 'object') {
        const obj = first as Record<string, unknown>;
        const url = obj.url ?? obj.file ?? obj.link;
        if (typeof url === 'string') return url.trim();
      }
      return '';
    }

    if (typeof raw === 'object') {
      const obj = raw as Record<string, unknown>;
      const url = obj.url ?? obj.file ?? obj.link;
      if (typeof url === 'string') return url.trim();
    }

    return '';
  };

  const getExistingUpscaledSceneImageUrl = (scene: BaserowRow): string => {
    const raw =
      scene['field_7095'] ??
      (scene as unknown as { field_7095?: unknown }).field_7095;

    if (typeof raw === 'string') return raw.trim();
    if (!raw) return '';

    // If this ever becomes a Baserow "file" field, it may come back as an array of objects.
    if (Array.isArray(raw) && raw.length > 0) {
      const first = raw[0] as unknown;
      if (typeof first === 'string') return first.trim();
      if (first && typeof first === 'object') {
        const obj = first as Record<string, unknown>;
        const url = obj.url ?? obj.file ?? obj.link;
        if (typeof url === 'string') return url.trim();
      }
      return '';
    }

    if (typeof raw === 'object') {
      const obj = raw as Record<string, unknown>;
      const url = obj.url ?? obj.file ?? obj.link;
      if (typeof url === 'string') return url.trim();
    }

    return '';
  };

  const sceneHasSubtitleInUrl = (scene: BaserowRow): boolean => {
    const finalVideoUrl = String(scene['field_6886'] ?? '').trim();
    return finalVideoUrl.toLowerCase().includes('subtitle');
  };

  const onGenerateAllSceneImages = async () => {
    if (generatingAllSceneImages) return;
    if (!selectedOriginalVideo.id) return;

    const scenesToImage = [...data]
      .filter((scene) => {
        // Skip if already filled
        if (getExistingSceneImageUrl(scene)) return false;

        // Skip if this scene already has subtitles (detected by URL naming)
        if (sceneHasSubtitleInUrl(scene)) return false;

        // Skip empty scenes (API will 400 anyway)
        const sentenceText = String(scene['field_6890'] ?? '').trim();
        return Boolean(sentenceText);
      })
      .sort((a, b) => (Number(a.order) || 0) - (Number(b.order) || 0));

    if (scenesToImage.length === 0) {
      playBatchDoneSound();
      return;
    }

    setGeneratingAllSceneImages(true);
    setGeneratingImageSceneId(null);

    try {
      for (const scene of scenesToImage) {
        setGeneratingImageSceneId(scene.id);

        try {
          const res = await fetch('/api/generate-scene-image', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ sceneId: scene.id }),
          });

          if (!res.ok) {
            const t = await res.text().catch(() => '');
            throw new Error(`Image generation failed (${res.status}) ${t}`);
          }
        } catch (error) {
          console.error(
            `Image generation failed for scene ${scene.id}:`,
            error,
          );
        }

        // Gentle pacing. Note: each request may itself take minutes.
        await new Promise((r) => setTimeout(r, 250));
      }

      onRefresh?.();
      playBatchDoneSound();
    } finally {
      setGeneratingAllSceneImages(false);
      setGeneratingImageSceneId(null);
    }
  };

  const onUpscaleAllSceneImages = async () => {
    if (upscalingAllSceneImages) return;

    const scenesToUpscale = [...data]
      .filter((scene) => {
        // Only upscale scenes that already have a base image
        if (!getExistingSceneImageUrl(scene)) return false;

        // Skip if upscaled already exists
        if (getExistingUpscaledSceneImageUrl(scene)) return false;

        return true;
      })
      .sort((a, b) => (Number(a.order) || 0) - (Number(b.order) || 0));

    if (scenesToUpscale.length === 0) {
      playBatchDoneSound();
      return;
    }

    setUpscalingAllSceneImages(true);
    setUpscalingSceneImageId(null);

    try {
      for (const scene of scenesToUpscale) {
        setUpscalingSceneImageId(scene.id);

        try {
          const res = await fetch('/api/upscale-scene-image', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ sceneId: scene.id, scale: 3 }),
          });

          if (!res.ok) {
            const t = await res.text().catch(() => '');
            throw new Error(`Upscale failed (${res.status}) ${t}`);
          }
        } catch (error) {
          console.error(`Upscale failed for scene ${scene.id}:`, error);
        }

        // Gentle pacing (each upscale may take a while)
        await new Promise((r) => setTimeout(r, 250));
      }

      onRefresh?.();
      playBatchDoneSound();
    } finally {
      setUpscalingAllSceneImages(false);
      setUpscalingSceneImageId(null);
    }
  };

  const onGenerateAllSubtitles = async () => {
    if (generatingAllSubtitles) return;
    if (!selectedOriginalVideo.id) return;

    const scenesToSubtitle = [...data]
      .filter((scene) => {
        if (
          transcriptionSettings.skipFlaggedScenesInSubtitleBatch &&
          isSceneFlagged(scene)
        ) {
          return false;
        }
        const finalVideoUrl = String(scene['field_6886'] ?? '').trim();
        const captionsUrl = String(scene['field_6910'] ?? '').trim();
        return Boolean(finalVideoUrl && captionsUrl);
      })
      .sort((a, b) => (Number(a.order) || 0) - (Number(b.order) || 0));

    if (scenesToSubtitle.length === 0) {
      playBatchDoneSound();
      return;
    }

    setGeneratingAllSubtitles(true);
    setGeneratingSubtitleSceneId(null);

    try {
      for (const scene of scenesToSubtitle) {
        setGeneratingSubtitleSceneId(scene.id);

        const finalVideoUrl = String(scene['field_6886'] ?? '').trim();
        const captionsUrl = String(scene['field_6910'] ?? '').trim();
        const sentenceText = String(scene['field_6890'] ?? '').trim();

        if (!finalVideoUrl || !captionsUrl) continue;

        let transcriptionWords: unknown = null;
        try {
          const capRes = await fetch(withCacheBust(captionsUrl), {
            cache: 'no-store',
          });
          if (capRes.ok) {
            transcriptionWords = await capRes.json();
          }
        } catch (error) {
          console.error(
            `Failed to fetch captions for scene ${scene.id}:`,
            error,
          );
          transcriptionWords = null;
        }

        if (
          !Array.isArray(transcriptionWords) ||
          transcriptionWords.length === 0
        ) {
          console.warn(
            `Skipping scene ${scene.id}: missing/empty transcription words`,
          );
          await new Promise((r) => setTimeout(r, 150));
          continue;
        }

        if (subtitleGenerationSettings.enableCharLimit) {
          const maxChars = Math.max(
            1,
            Math.floor(subtitleGenerationSettings.maxChars),
          );
          // Count based on the scene text (sentence) since we render punctuation
          // from that text now. Fallback to transcription if sentence is missing.
          const textForCharCount =
            sentenceText ||
            buildTranscriptionTextForCharCount(transcriptionWords);
          const charCount = textForCharCount.length;

          // User requested strictly "less than".
          if (charCount >= maxChars) {
            console.log(
              `Skipping scene ${scene.id}: scene text has ${charCount} chars (limit < ${maxChars})`,
            );
            await new Promise((r) => setTimeout(r, 150));
            continue;
          }
        }

        try {
          const res = await fetch('/api/create-subtitle-highlight', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              videoId: selectedOriginalVideo.id,
              sceneId: scene.id,
              videoUrl: finalVideoUrl,
              transcriptionWords,
              displayText: sentenceText,
              position: {
                x: subtitleGenerationSettings.positionXPercent,
                y: subtitleGenerationSettings.positionYPercent,
              },
              size: { height: subtitleGenerationSettings.sizeHeightPercent },
              fontFamily: subtitleGenerationSettings.fontFamily,
              uppercase: true,
            }),
          });

          if (!res.ok) {
            const t = await res.text().catch(() => '');
            throw new Error(`Subtitle generation failed (${res.status}) ${t}`);
          }
        } catch (error) {
          console.error(
            `Subtitle generation failed for scene ${scene.id}:`,
            error,
          );
        }

        // gentle pacing to avoid hammering FFmpeg/server
        await new Promise((r) => setTimeout(r, 300));
      }

      onRefresh?.();
      playBatchDoneSound();
    } finally {
      setGeneratingAllSubtitles(false);
      setGeneratingSubtitleSceneId(null);
    }
  };

  const onSpeedUpAllVideos = () => {
    handleSpeedUpAllVideos(
      data,
      videoSettings.selectedSpeed,
      videoSettings.muteAudio,
      videoSettings.speedUpMode,
      onRefresh,
      startBatchOperation,
      completeBatchOperation,
      setSpeedingUpVideo,
    );
  };

  const cycleSpeed = () => {
    cycleThroughSpeeds(videoSettings.selectedSpeed, updateVideoSettings);
  };

  const cycleSpeedUpMode = () => {
    const modes: Array<'all' | 'emptyOnly' | 'withTextOnly'> = [
      'all',
      'emptyOnly',
      'withTextOnly',
    ];
    const currentIndex = modes.indexOf(videoSettings.speedUpMode);
    const nextIndex = (currentIndex + 1) % modes.length;
    const nextMode = modes[nextIndex];

    // Auto-set speed and audio based on mode
    const autoSettings: Partial<typeof videoSettings> = {
      speedUpMode: nextMode,
    };

    switch (nextMode) {
      case 'emptyOnly':
        // Raw clips: 4x speed, muted
        autoSettings.selectedSpeed = 4;
        autoSettings.muteAudio = true;
        break;
      case 'withTextOnly':
        // Final content: 1x speed, with audio
        autoSettings.selectedSpeed = 1;
        autoSettings.muteAudio = false;
        break;
      case 'all':
        // Keep current settings for "all" mode
        break;
    }

    updateVideoSettings(autoSettings);
  };

  const getSpeedUpModeDisplay = () => {
    switch (videoSettings.speedUpMode) {
      case 'all':
        return 'All Videos';
      case 'emptyOnly':
        return 'Empty Only';
      case 'withTextOnly':
        return 'Text Only';
    }
  };

  const getSpeedUpButtonText = () => {
    switch (videoSettings.speedUpMode) {
      case 'all':
        return 'Speed Up All';
      case 'emptyOnly':
        return 'Speed Up Empty';
      case 'withTextOnly':
        return 'Speed Up Text';
    }
  };

  const getSpeedUpModeTooltip = () => {
    switch (videoSettings.speedUpMode) {
      case 'all':
        return 'Speed up all videos';
      case 'emptyOnly':
        return 'Only speed up videos without text';
      case 'withTextOnly':
        return 'Only speed up videos with text';
    }
  };

  return (
    <div className='relative bg-white rounded-xl shadow-lg border border-gray-200 overflow-hidden mb-8'>
      {/* Clickable Header */}
      <button
        onClick={() => setIsExpanded(!isExpanded)}
        className='w-full px-6 py-4 flex items-center justify-between hover:bg-gray-50 transition-colors'
      >
        <div className='flex items-center gap-3'>
          <Sparkles className='w-6 h-6 text-purple-600' />
          <div className='text-left'>
            <h2 className='text-2xl font-bold text-gray-900'>
              Batch Operations
            </h2>
            <p className='text-gray-600 flex items-center gap-2 text-sm'>
              <span className='inline-flex items-center justify-center w-5 h-5 bg-blue-100 text-blue-800 text-xs font-medium rounded-full'>
                {data.length}
              </span>
              scene{data.length !== 1 ? 's' : ''} available for processing
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
        <div className='p-6'>
          {/* Settings Section - Collapsible */}
          <div className='bg-gray-50 rounded-lg border border-gray-200 mb-6'>
            {/* Settings Header */}
            <button
              onClick={() =>
                setIsSettingsSectionExpanded(!isSettingsSectionExpanded)
              }
              className='w-full px-4 py-3 flex items-center justify-between hover:bg-gray-100 transition-colors rounded-lg'
            >
              <div className='flex items-center gap-2'>
                <Save className='w-5 h-5 text-blue-600' />
                <h3 className='text-lg font-semibold text-gray-900'>
                  Settings & Actions
                </h3>
              </div>
              <div className='flex items-center gap-2'>
                <span className='text-xs text-gray-400'>
                  {isSettingsSectionExpanded
                    ? 'Click to collapse'
                    : 'Click to expand'}
                </span>
                <svg
                  className={`w-4 h-4 text-gray-400 transition-transform ${
                    isSettingsSectionExpanded ? 'rotate-180' : ''
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

            {/* Collapsible Settings Content */}
            {isSettingsSectionExpanded && (
              <div className='px-4 pb-4'>
                <div className='flex items-center gap-3 justify-end'>
                  {/* Settings Dropdown */}
                  <div className='relative'>
                    <button
                      onClick={() => setShowSettingsMenu(!showSettingsMenu)}
                      className='inline-flex items-center gap-2 px-4 py-2.5 bg-blue-500 hover:bg-blue-600 text-white font-medium rounded-lg transition-all duration-200 shadow-sm hover:shadow-md'
                    >
                      <Save className='w-4 h-4' />
                      <span>Settings</span>
                    </button>

                    {/* Settings Dropdown Menu */}
                    {showSettingsMenu && (
                      <div className='absolute right-0 mt-2 w-56 bg-white rounded-lg shadow-lg border border-gray-200 z-10'>
                        <div className='p-2'>
                          <button
                            onClick={handleSaveSettings}
                            className='w-full flex items-center gap-2 px-3 py-2 text-left text-gray-700 hover:bg-gray-100 rounded-md transition-colors'
                          >
                            <Save className='w-4 h-4 text-green-600' />
                            <span>Save Settings</span>
                          </button>
                          <button
                            onClick={handleLoadSettings}
                            className='w-full flex items-center gap-2 px-3 py-2 text-left text-gray-700 hover:bg-gray-100 rounded-md transition-colors'
                          >
                            <Upload className='w-4 h-4 text-blue-600' />
                            <span>Load Settings</span>
                          </button>
                          <button
                            onClick={handleClearSettings}
                            className='w-full flex items-center gap-2 px-3 py-2 text-left text-gray-700 hover:bg-gray-100 rounded-md transition-colors'
                          >
                            <Trash2 className='w-4 h-4 text-red-600' />
                            <span>Clear Settings</span>
                          </button>
                        </div>
                      </div>
                    )}
                  </div>

                  {/* Refresh Button */}
                  {onRefresh && (
                    <button
                      onClick={onRefresh}
                      disabled={refreshing}
                      className='inline-flex items-center gap-2 px-4 py-2.5 bg-emerald-500 hover:bg-emerald-600 disabled:bg-emerald-300 text-white font-medium rounded-lg transition-all duration-200 shadow-sm hover:shadow-md disabled:cursor-not-allowed min-w-[120px] justify-center'
                    >
                      <RefreshCw
                        className={`w-4 h-4 ${
                          refreshing ? 'animate-spin' : ''
                        }`}
                      />
                      <span>
                        {refreshing ? 'Refreshing...' : 'Refresh Data'}
                      </span>
                    </button>
                  )}
                </div>
              </div>
            )}
          </div>

          {/* Save Message */}
          {saveMessage && (
            <div className='absolute top-0 right-0 mt-16 mr-4 bg-green-100 border border-green-400 text-green-700 px-4 py-2 rounded-lg shadow-md z-20'>
              {saveMessage}
            </div>
          )}

          {/* Merged Video Display */}
          {mergedVideo.url && (
            <div className='bg-gradient-to-br from-green-50 to-emerald-100 rounded-lg p-6 border border-green-200 mb-6'>
              <div className='flex items-start justify-between'>
                <div className='flex-1'>
                  <div className='flex items-center gap-3 mb-4'>
                    <div className='p-2 bg-emerald-500 rounded-lg'>
                      <Film className='w-5 h-5 text-white' />
                    </div>
                    <div>
                      <h3 className='font-semibold text-emerald-900 text-lg'>
                        Merged Video Ready
                      </h3>
                      <p className='text-sm text-emerald-700'>
                        Created{' '}
                        {mergedVideo.createdAt
                          ? new Date(mergedVideo.createdAt).toLocaleString()
                          : 'now'}
                      </p>
                    </div>
                  </div>

                  {/* Video Player Section */}
                  <div className='bg-white rounded-lg p-4 border border-emerald-200 mb-4'>
                    <div className='flex items-center justify-between mb-3'>
                      <p className='text-sm text-gray-600 font-medium'>
                        {mergedVideo.fileName}
                      </p>
                      <button
                        onClick={() => setShowPlayer(!showPlayer)}
                        className='text-emerald-600 hover:text-emerald-800 text-sm font-medium'
                      >
                        {showPlayer ? 'Hide Player' : 'Show Player'}
                      </button>
                    </div>

                    {/* Video Player */}
                    {showPlayer && (
                      <div className='mb-4'>
                        <div className='bg-black rounded-lg overflow-hidden'>
                          <video
                            ref={videoRef}
                            src={mergedVideo.url}
                            className='w-full h-auto max-h-96'
                            onEnded={handleVideoEnded}
                            onTimeUpdate={handleTimeUpdate}
                            onLoadedMetadata={handleLoadedMetadata}
                            controls={false}
                            preload='metadata'
                          />
                        </div>
                        {/* Video Controls */}
                        <div className='mt-3 p-3 bg-gray-100 rounded-lg'>
                          {/* Progress Bar */}
                          <div className='mb-3'>
                            <div className='flex items-center gap-2 text-sm text-gray-600 mb-2'>
                              <span>{formatTime(currentTime)}</span>
                              <span>/</span>
                              <span>{formatTime(duration)}</span>
                            </div>
                            <div className='relative'>
                              <input
                                type='range'
                                min='0'
                                max={duration || 0}
                                value={currentTime}
                                onChange={handleSeek}
                                onMouseDown={handleSeekStart}
                                onMouseUp={handleSeekEnd}
                                onTouchStart={handleSeekStart}
                                onTouchEnd={handleSeekEnd}
                                className='w-full h-2 bg-gray-300 rounded-lg appearance-none cursor-pointer focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:ring-opacity-50'
                                style={{
                                  background: `linear-gradient(to right, #10b981 0%, #10b981 ${
                                    duration
                                      ? (currentTime / duration) * 100
                                      : 0
                                  }%, #d1d5db ${
                                    duration
                                      ? (currentTime / duration) * 100
                                      : 0
                                  }%, #d1d5db 100%)`,
                                }}
                              />
                            </div>
                          </div>

                          {/* Control Buttons */}
                          <div className='flex items-center gap-2'>
                            <button
                              onClick={handlePlayPause}
                              className='flex items-center justify-center w-10 h-10 bg-emerald-500 hover:bg-emerald-600 text-white rounded-full transition-colors'
                              title={isPlaying ? 'Pause' : 'Play'}
                            >
                              {isPlaying ? (
                                <Pause className='w-5 h-5 ml-0.5' />
                              ) : (
                                <Play className='w-5 h-5 ml-0.5' />
                              )}
                            </button>
                            <button
                              onClick={handleStop}
                              className='flex items-center justify-center w-10 h-10 bg-gray-500 hover:bg-gray-600 text-white rounded-full transition-colors'
                              title='Stop'
                            >
                              <Square className='w-4 h-4' />
                            </button>
                            <div className='flex-1 text-center'>
                              <span className='text-sm text-gray-600'>
                                {isPlaying ? 'Playing' : 'Paused'}
                              </span>
                            </div>
                          </div>
                        </div>
                      </div>
                    )}

                    {/* Action Buttons */}
                    <div className='flex flex-wrap gap-3'>
                      <button
                        onClick={() => setShowPlayer(!showPlayer)}
                        className='inline-flex items-center gap-2 px-4 py-2 bg-emerald-500 hover:bg-emerald-600 text-white font-medium rounded-lg transition-all duration-200 shadow-sm hover:shadow-md'
                      >
                        <Play className='w-4 h-4' />
                        {showPlayer ? 'Hide Player' : 'Play Video'}
                      </button>
                      <a
                        href={mergedVideo.url}
                        target='_blank'
                        rel='noopener noreferrer'
                        className='inline-flex items-center gap-2 px-4 py-2 bg-blue-500 hover:bg-blue-600 text-white font-medium rounded-lg transition-all duration-200 shadow-sm hover:shadow-md'
                      >
                        <ExternalLink className='w-4 h-4' />
                        Open in New Tab
                      </a>
                      <a
                        href={mergedVideo.url}
                        download={mergedVideo.fileName}
                        className='inline-flex items-center gap-2 px-4 py-2 bg-purple-500 hover:bg-purple-600 text-white font-medium rounded-lg transition-all duration-200 shadow-sm hover:shadow-md'
                      >
                        <Download className='w-4 h-4' />
                        Download
                      </a>
                      <button
                        onClick={() =>
                          mergedVideo.url &&
                          navigator.clipboard.writeText(mergedVideo.url)
                        }
                        className='inline-flex items-center gap-2 px-4 py-2 bg-gray-500 hover:bg-gray-600 text-white font-medium rounded-lg transition-all duration-200 shadow-sm hover:shadow-md'
                      >
                        <Film className='w-4 h-4' />
                        Copy URL
                      </button>
                      <button
                        onClick={handleSaveMergedVideoToDatabase}
                        disabled={savingToDatabase || !selectedOriginalVideo.id}
                        className={`inline-flex items-center gap-2 px-4 py-2 font-medium rounded-lg transition-all duration-200 shadow-sm hover:shadow-md ${
                          selectedOriginalVideo.id
                            ? 'bg-green-500 hover:bg-green-600 text-white'
                            : 'bg-gray-300 text-gray-500 cursor-not-allowed'
                        }`}
                        title={
                          !selectedOriginalVideo.id
                            ? 'Select an original video first'
                            : 'Save merged video URL to original video database'
                        }
                      >
                        {savingToDatabase ? (
                          <Loader2 className='w-4 h-4 animate-spin' />
                        ) : (
                          <Save className='w-4 h-4' />
                        )}
                        {savingToDatabase ? 'Saving...' : 'Save to Database'}
                      </button>
                    </div>

                    {/* Save to Database Message */}
                    {saveToDbMessage && (
                      <div
                        className={`mt-2 text-sm font-medium ${
                          saveToDbMessage.includes('successfully') ||
                          saveToDbMessage.includes('saved')
                            ? 'text-green-600'
                            : 'text-red-600'
                        }`}
                      >
                        {saveToDbMessage}
                      </div>
                    )}
                  </div>
                </div>

                <button
                  onClick={clearMergedVideo}
                  className='ml-4 p-2 text-emerald-600 hover:text-emerald-800 hover:bg-emerald-200 rounded-lg transition-colors'
                  title='Dismiss'
                >
                  <X className='w-5 h-5' />
                </button>
              </div>
            </div>
          )}

          {/* Operation Cards Grid */}
          <div className='grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-6 gap-4'>
            {/* AI Improve All */}
            <div className='bg-gradient-to-br from-indigo-50 to-indigo-100 rounded-lg p-4 border border-indigo-200'>
              <div className='flex items-center gap-2 mb-3'>
                <div className='p-2 bg-indigo-500 rounded-lg'>
                  <Sparkles className='w-4 h-4 text-white' />
                </div>
                <h3 className='font-semibold text-indigo-900'>AI Improve</h3>
              </div>
              <p className='text-sm text-indigo-700 mb-4 leading-relaxed'>
                Enhance all sentences using AI with{' '}
                {modelSelection.selectedModel || 'default model'}
              </p>
              <button
                onClick={onImproveAllSentences}
                disabled={
                  batchOperations.improvingAll ||
                  sceneLoading.improvingSentence !== null
                }
                className='w-full h-12 bg-indigo-500 hover:bg-indigo-600 disabled:bg-indigo-300 text-white font-medium rounded-lg transition-all duration-200 flex items-center justify-center gap-2 shadow-sm hover:shadow-md disabled:cursor-not-allowed'
                title={
                  batchOperations.improvingAll
                    ? 'Improving all sentences with AI...'
                    : sceneLoading.improvingSentence !== null
                      ? `AI is improving sentence for scene ${sceneLoading.improvingSentence}`
                      : 'Improve all sentences with AI'
                }
              >
                {(batchOperations.improvingAll ||
                  sceneLoading.improvingSentence !== null) && (
                  <Loader2 className='w-4 h-4 animate-spin' />
                )}
                <span className='font-medium'>
                  {batchOperations.improvingAll
                    ? sceneLoading.improvingSentence !== null
                      ? `Scene #${sceneLoading.improvingSentence}`
                      : 'Processing...'
                    : sceneLoading.improvingSentence !== null
                      ? `Busy (#${sceneLoading.improvingSentence})`
                      : 'Improve All'}
                </span>
              </button>

              <button
                onClick={onPromptAllScenes}
                disabled={
                  promptingAllScenes ||
                  batchOperations.improvingAll ||
                  sceneLoading.improvingSentence !== null
                }
                className='mt-3 w-full h-12 bg-indigo-500 hover:bg-indigo-600 disabled:bg-indigo-300 text-white font-medium rounded-lg transition-all duration-200 flex items-center justify-center gap-2 shadow-sm hover:shadow-md disabled:cursor-not-allowed'
                title={
                  promptingAllScenes
                    ? promptingSceneId
                      ? `Generating prompt for scene ${promptingSceneId}`
                      : 'Generating prompts for all scenes...'
                    : 'Generate and save prompts for all non-empty scenes'
                }
              >
                {promptingAllScenes && (
                  <Loader2 className='w-4 h-4 animate-spin' />
                )}
                <span className='font-medium'>
                  {promptingAllScenes
                    ? promptingSceneId
                      ? `Prompting #${promptingSceneId}`
                      : 'Processing...'
                    : 'Prompt All'}
                </span>
              </button>
            </div>

            {/* Generate TTS */}
            <div className='bg-gradient-to-br from-purple-50 to-purple-100 rounded-lg p-4 border border-purple-200'>
              <div className='flex items-center gap-2 mb-3'>
                <div className='p-2 bg-purple-500 rounded-lg'>
                  <Mic className='w-4 h-4 text-white' />
                </div>
                <h3 className='font-semibold text-purple-900'>Generate TTS</h3>
              </div>
              <p className='text-sm text-purple-700 mb-4 leading-relaxed'>
                Create audio from text for all scenes missing TTS audio
              </p>
              <button
                onClick={onGenerateAllTTS}
                disabled={
                  batchOperations.generatingAllTTS ||
                  sceneLoading.producingTTS !== null
                }
                className='w-full h-12 bg-purple-500 hover:bg-purple-600 disabled:bg-purple-300 text-white font-medium rounded-lg transition-all duration-200 flex items-center justify-center gap-2 shadow-sm hover:shadow-md disabled:cursor-not-allowed'
                title={
                  batchOperations.generatingAllTTS
                    ? 'Generating TTS for all scenes...'
                    : sceneLoading.producingTTS !== null
                      ? `TTS is being generated for scene ${sceneLoading.producingTTS}`
                      : 'Generate TTS for all scenes'
                }
              >
                {(batchOperations.generatingAllTTS ||
                  sceneLoading.producingTTS !== null) && (
                  <Loader2 className='w-4 h-4 animate-spin' />
                )}
                <span className='font-medium'>
                  {batchOperations.generatingAllTTS
                    ? sceneLoading.producingTTS !== null
                      ? `Scene #${sceneLoading.producingTTS}`
                      : 'Processing...'
                    : sceneLoading.producingTTS !== null
                      ? `Busy (#${sceneLoading.producingTTS})`
                      : 'Generate All'}
                </span>
              </button>
            </div>

            {/* Generate Videos */}
            <div className='bg-gradient-to-br from-teal-50 to-teal-100 rounded-lg p-4 border border-teal-200'>
              <div className='flex items-center gap-2 mb-3'>
                <div className='p-2 bg-teal-500 rounded-lg'>
                  <Film className='w-4 h-4 text-white' />
                </div>
                <h3 className='font-semibold text-teal-900'>Sync Videos</h3>
              </div>

              {/* Transcribe Final Scenes */}
              <div className='bg-gradient-to-br from-emerald-50 to-emerald-100 rounded-lg p-4 border border-emerald-200'>
                <div className='flex items-center gap-2 mb-3'>
                  <div className='p-2 bg-emerald-500 rounded-lg'>
                    <Wand2 className='w-4 h-4 text-white' />
                  </div>
                  <h3 className='font-semibold text-emerald-900'>Fix TTS</h3>
                </div>
                {/* Removed extra description text to keep UI concise */}
                <button
                  onClick={onFixAllFinalTTS}
                  disabled={
                    !selectedOriginalVideo.id ||
                    batchOperations.transcribingAllFinalScenes ||
                    sceneLoading.transcribingScene !== null
                  }
                  className='w-full h-12 bg-emerald-500 hover:bg-emerald-600 disabled:bg-emerald-300 text-white font-medium rounded-lg transition-all duration-200 flex items-center justify-center gap-2 shadow-sm hover:shadow-md disabled:cursor-not-allowed'
                  title={
                    !selectedOriginalVideo.id
                      ? 'Select an original video first'
                      : batchOperations.transcribingAllFinalScenes
                        ? 'Fixing TTS for all scenes (TTS → sync → retranscribe)...'
                        : sceneLoading.transcribingScene !== null
                          ? `Fixing scene ${sceneLoading.transcribingScene}`
                          : 'Fix TTS mismatches for all scenes'
                  }
                >
                  {(batchOperations.transcribingAllFinalScenes ||
                    sceneLoading.transcribingScene !== null) && (
                    <Loader2 className='w-4 h-4 animate-spin' />
                  )}
                  <span className='font-medium'>
                    {batchOperations.transcribingAllFinalScenes
                      ? sceneLoading.transcribingScene !== null
                        ? `Scene #${sceneLoading.transcribingScene}`
                        : 'Processing...'
                      : sceneLoading.transcribingScene !== null
                        ? `Busy (#${sceneLoading.transcribingScene})`
                        : 'Fix All'}
                  </span>
                </button>
              </div>
              {/* Removed extra description text to keep the section concise */}
              <button
                onClick={onGenerateAllVideos}
                disabled={
                  batchOperations.generatingAllVideos ||
                  sceneLoading.generatingVideo !== null
                }
                className='w-full h-12 bg-teal-500 hover:bg-teal-600 disabled:bg-teal-300 text-white font-medium rounded-lg transition-all duration-200 flex items-center justify-center gap-2 shadow-sm hover:shadow-md disabled:cursor-not-allowed'
                title={
                  batchOperations.generatingAllVideos
                    ? 'Generate videos for all scenes with TTS audio...'
                    : sceneLoading.generatingVideo !== null
                      ? `Video is being generated for scene ${sceneLoading.generatingVideo}`
                      : 'Generate synchronized videos'
                }
              >
                {(batchOperations.generatingAllVideos ||
                  sceneLoading.generatingVideo !== null) && (
                  <Loader2 className='w-4 h-4 animate-spin' />
                )}
                <span className='font-medium'>
                  {batchOperations.generatingAllVideos
                    ? sceneLoading.generatingVideo !== null
                      ? `Scene #${sceneLoading.generatingVideo}`
                      : 'Processing...'
                    : sceneLoading.generatingVideo !== null
                      ? `Busy (#${sceneLoading.generatingVideo})`
                      : 'Sync All'}
                </span>
              </button>
            </div>

            {/* Subtitle Generation */}
            <div className='bg-gradient-to-br from-yellow-50 to-yellow-100 rounded-lg p-4 border border-yellow-200'>
              <div className='flex items-center gap-2 mb-3'>
                <div className='p-2 bg-yellow-500 rounded-lg'>
                  <Type className='w-4 h-4 text-white' />
                </div>
                <h3 className='font-semibold text-yellow-900'>Subtitles</h3>
              </div>
              <p className='text-sm text-yellow-800 mb-4 leading-relaxed'>
                Burn in subtitle highlight (grey sentence + highlighted current
                word) for all scenes
              </p>
              <button
                onClick={onGenerateAllSubtitles}
                disabled={!selectedOriginalVideo.id || generatingAllSubtitles}
                className='w-full h-12 bg-yellow-500 hover:bg-yellow-600 disabled:bg-yellow-300 text-white font-medium rounded-lg transition-all duration-200 flex items-center justify-center gap-2 shadow-sm hover:shadow-md disabled:cursor-not-allowed'
                title={
                  !selectedOriginalVideo.id
                    ? 'Select an original video first'
                    : generatingAllSubtitles
                      ? generatingSubtitleSceneId
                        ? `Generating subtitles for scene ${generatingSubtitleSceneId}`
                        : 'Generating subtitles for all scenes...'
                      : 'Generate subtitles for all scenes'
                }
              >
                {generatingAllSubtitles && (
                  <Loader2 className='w-4 h-4 animate-spin' />
                )}
                <span className='font-medium'>
                  {generatingAllSubtitles
                    ? generatingSubtitleSceneId
                      ? `Scene #${generatingSubtitleSceneId}`
                      : 'Processing...'
                    : 'Generate All'}
                </span>
              </button>
            </div>

            {/* Scene Image Generation */}
            <div className='bg-gradient-to-br from-pink-50 to-pink-100 rounded-lg p-4 border border-pink-200'>
              <div className='flex items-center gap-2 mb-3'>
                <div className='p-2 bg-pink-500 rounded-lg'>
                  <ImageIcon className='w-4 h-4 text-white' />
                </div>
                <h3 className='font-semibold text-pink-900'>Images</h3>
              </div>
              <p className='text-sm text-pink-800 mb-4 leading-relaxed'>
                Generate and save “Image for Scene” for scenes that don’t have
                one. Skips scenes whose final video URL includes “subtitle”.
              </p>
              <button
                onClick={onGenerateAllSceneImages}
                disabled={!selectedOriginalVideo.id || generatingAllSceneImages}
                className='w-full h-12 bg-pink-500 hover:bg-pink-600 disabled:bg-pink-300 text-white font-medium rounded-lg transition-all duration-200 flex items-center justify-center gap-2 shadow-sm hover:shadow-md disabled:cursor-not-allowed'
                title={
                  !selectedOriginalVideo.id
                    ? 'Select an original video first'
                    : generatingAllSceneImages
                      ? generatingImageSceneId
                        ? `Generating image for scene ${generatingImageSceneId}`
                        : 'Generating images for all scenes...'
                      : 'Generate images for all scenes'
                }
              >
                {generatingAllSceneImages && (
                  <Loader2 className='w-4 h-4 animate-spin' />
                )}
                <span className='font-medium'>
                  {generatingAllSceneImages
                    ? generatingImageSceneId
                      ? `Scene #${generatingImageSceneId}`
                      : 'Processing...'
                    : 'Generate All'}
                </span>
              </button>
            </div>

            {/* Upscale Scene Images (3x) */}
            <div className='bg-gradient-to-br from-fuchsia-50 to-fuchsia-100 rounded-lg p-4 border border-fuchsia-200'>
              <div className='flex items-center gap-2 mb-3'>
                <div className='p-2 bg-fuchsia-500 rounded-lg flex items-center gap-1'>
                  <ImageIcon className='w-4 h-4 text-white' />
                  <span className='text-white text-xs font-bold'>3x</span>
                </div>
                <h3 className='font-semibold text-fuchsia-900'>Upscale</h3>
              </div>
              <p className='text-sm text-fuchsia-800 mb-4 leading-relaxed'>
                Upscale all scenes that already have “Image for Scene” (7094)
                and do NOT yet have an “Upscaled Image” (7095). Skips scenes
                with upscaled images.
              </p>
              <button
                onClick={onUpscaleAllSceneImages}
                disabled={upscalingAllSceneImages}
                className='w-full h-12 bg-fuchsia-500 hover:bg-fuchsia-600 disabled:bg-fuchsia-300 text-white font-medium rounded-lg transition-all duration-200 flex items-center justify-center gap-2 shadow-sm hover:shadow-md disabled:cursor-not-allowed'
                title={
                  upscalingAllSceneImages
                    ? upscalingSceneImageId
                      ? `Upscaling image for scene ${upscalingSceneImageId}`
                      : 'Upscaling images for all scenes...'
                    : 'Upscale images for all scenes (3x)'
                }
              >
                {upscalingAllSceneImages && (
                  <Loader2 className='w-4 h-4 animate-spin' />
                )}
                <span className='font-medium'>
                  {upscalingAllSceneImages
                    ? upscalingSceneImageId
                      ? `Scene #${upscalingSceneImageId}`
                      : 'Processing...'
                    : 'Upscale All'}
                </span>
              </button>
            </div>

            {/* Speed Up Videos */}
            <div className='bg-gradient-to-br from-blue-50 to-blue-100 rounded-lg p-4 border border-blue-200'>
              <div className='flex items-center gap-2 mb-3'>
                <div className='p-2 bg-blue-500 rounded-lg flex items-center gap-1'>
                  {videoSettings.muteAudio ? (
                    <VolumeX className='w-4 h-4 text-white' />
                  ) : (
                    <Volume2 className='w-4 h-4 text-white' />
                  )}
                  <span className='text-white text-xs font-bold'>
                    {videoSettings.selectedSpeed}x
                  </span>
                </div>
                <h3 className='font-semibold text-blue-900'>Speed Up</h3>
              </div>
              <div className='flex items-center gap-2 mb-3'>
                <button
                  onClick={() =>
                    updateVideoSettings({ muteAudio: !videoSettings.muteAudio })
                  }
                  className='flex items-center gap-1 px-2 py-1 bg-blue-200 hover:bg-blue-300 text-blue-800 text-xs font-medium rounded transition-colors'
                  title={`Click to ${
                    videoSettings.muteAudio ? 'enable' : 'mute'
                  } audio`}
                >
                  {videoSettings.muteAudio ? (
                    <VolumeX className='w-3 h-3' />
                  ) : (
                    <Volume2 className='w-3 h-3' />
                  )}
                  {videoSettings.muteAudio ? 'Muted' : 'Audio'}
                </button>
                <button
                  onClick={cycleSpeed}
                  className='px-2 py-1 bg-blue-200 hover:bg-blue-300 text-blue-800 text-xs font-bold rounded transition-colors'
                  title='Click to cycle through speeds (1x → 1.125x → 1.5x → 2x → 4x → 8x)'
                >
                  {videoSettings.selectedSpeed}x
                </button>
                <button
                  onClick={cycleSpeedUpMode}
                  className={`px-2 py-1 text-xs font-medium rounded transition-colors ${
                    videoSettings.speedUpMode === 'all'
                      ? 'bg-blue-200 hover:bg-blue-300 text-blue-800'
                      : 'bg-blue-500 text-white'
                  }`}
                  title={`Currently: ${getSpeedUpModeTooltip()}. Click to cycle through modes.`}
                >
                  {getSpeedUpModeDisplay()}
                </button>
              </div>
              <button
                onClick={onSpeedUpAllVideos}
                disabled={
                  batchOperations.speedingUpAllVideos ||
                  sceneLoading.speedingUpVideo !== null
                }
                className='w-full h-12 bg-blue-500 hover:bg-blue-600 disabled:bg-blue-300 text-white font-medium rounded-lg transition-all duration-200 flex items-center justify-center gap-2 shadow-sm hover:shadow-md disabled:cursor-not-allowed'
                title={`Speed up ${getSpeedUpModeTooltip().toLowerCase()} ${
                  videoSettings.selectedSpeed
                }x and ${videoSettings.muteAudio ? 'mute' : 'keep'} audio`}
              >
                {(batchOperations.speedingUpAllVideos ||
                  sceneLoading.speedingUpVideo !== null) && (
                  <Loader2 className='w-4 h-4 animate-spin' />
                )}
                <span className='font-medium'>
                  {batchOperations.speedingUpAllVideos
                    ? sceneLoading.speedingUpVideo !== null
                      ? `Scene #${sceneLoading.speedingUpVideo}`
                      : 'Processing...'
                    : sceneLoading.speedingUpVideo !== null
                      ? `Busy (#${sceneLoading.speedingUpVideo})`
                      : getSpeedUpButtonText()}
                </span>
              </button>

              <button
                onClick={handleDeleteEmptyScenes}
                disabled={
                  deletingEmptyScenes ||
                  batchOperations.speedingUpAllVideos ||
                  sceneLoading.speedingUpVideo !== null
                }
                className='w-full h-12 mt-3 bg-red-500 hover:bg-red-600 disabled:bg-red-300 text-white font-medium rounded-lg transition-all duration-200 flex items-center justify-center gap-2 shadow-sm hover:shadow-md disabled:cursor-not-allowed'
                title='Delete empty scenes (both sentence + original are blank)'
              >
                {deletingEmptyScenes && (
                  <Loader2 className='w-4 h-4 animate-spin' />
                )}
                <Trash2 className='w-4 h-4' />
                <span className='font-medium'>
                  {deletingEmptyScenes
                    ? deletingEmptySceneId
                      ? `Deleting #${deletingEmptySceneId}`
                      : 'Deleting...'
                    : 'Delete Empty'}
                </span>
              </button>
            </div>

            {/* Concatenate Videos */}
            <div className='bg-gradient-to-br from-orange-50 to-orange-100 rounded-lg p-4 border border-orange-200'>
              <div className='flex items-center gap-2 mb-3'>
                <div className='p-2 bg-orange-500 rounded-lg'>
                  <Film className='w-4 h-4 text-white' />
                </div>
                <h3 className='font-semibold text-orange-900'>Merge Videos</h3>
              </div>
              <p className='text-sm text-orange-700 mb-4 leading-relaxed'>
                Combine all processed videos into one final video file
              </p>
              <button
                onClick={onConcatenateAllVideos}
                disabled={batchOperations.concatenatingVideos}
                className='w-full h-12 bg-orange-500 hover:bg-orange-600 disabled:bg-orange-300 text-white font-medium rounded-lg transition-all duration-200 flex items-center justify-center gap-2 shadow-sm hover:shadow-md disabled:cursor-not-allowed'
                title='Concatenate all videos into one final video'
              >
                {batchOperations.concatenatingVideos && (
                  <Loader2 className='w-4 h-4 animate-spin' />
                )}
                <span className='font-medium'>
                  {batchOperations.concatenatingVideos
                    ? 'Merging...'
                    : 'Merge All'}
                </span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
