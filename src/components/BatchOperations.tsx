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
import {
  getFixTtsEligibleScenes,
  isSceneFlaggedForFixTts,
  withSceneVoiceOverride,
} from '@/utils/fixTtsBatch';
import { fetchFlaggedScenesForVideo } from '@/features/fix-tts-flagged/fetchFlaggedScenesForVideo';
import { FixFlaggedOnlyButton } from '@/components/fix-tts/FixFlaggedOnlyButton';
import { playSuccessSound } from '@/utils/soundManager';
import {
  formatSceneHasTextField,
  isHasTextRecordFreshForImage,
  parseSceneHasTextField,
} from '@/utils/sceneHasText';
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
  GitMerge,
} from 'lucide-react';

interface BatchOperationsProps {
  data: BaserowRow[];
  onRefresh?: () => void;
  refreshing?: boolean;
  handleAutoFixMismatch: (
    sceneId: number,
    sceneData?: BaserowRow,
    options?: { maxAttempts?: number },
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
    combineScenesSettings,
    sceneVideoGenerationSettings,
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

  const [generatingAllSceneVideos, setGeneratingAllSceneVideos] =
    useState(false);
  const [generatingSceneVideoId, setGeneratingSceneVideoId] = useState<
    number | null
  >(null);

  const [enhancingAllSceneVideos, setEnhancingAllSceneVideos] = useState(false);
  const [enhancingSceneVideoId, setEnhancingSceneVideoId] = useState<
    number | null
  >(null);

  const [upscalingAllSceneImages, setUpscalingAllSceneImages] = useState(false);
  const [upscalingSceneImageId, setUpscalingSceneImageId] = useState<
    number | null
  >(null);

  const [applyingAllUpscaledImages, setApplyingAllUpscaledImages] =
    useState(false);
  const [applyingUpscaledImageSceneId, setApplyingUpscaledImageSceneId] =
    useState<number | null>(null);

  const [applyingAllEnhancedVideos, setApplyingAllEnhancedVideos] =
    useState(false);
  const [applyingEnhancedVideoSceneId, setApplyingEnhancedVideoSceneId] =
    useState<number | null>(null);

  const [promptingAllScenes, setPromptingAllScenes] = useState(false);
  const [promptingSceneId, setPromptingSceneId] = useState<number | null>(null);
  const [fixingLanguageTenScenes, setFixingLanguageTenScenes] = useState(false);
  const [fixingLanguageSceneId, setFixingLanguageSceneId] = useState<
    number | null
  >(null);
  const [
    applyingCurrentVideoWordReplacements,
    setApplyingCurrentVideoWordReplacements,
  ] = useState(false);
  const [fixingOnlyFlaggedScenes, setFixingOnlyFlaggedScenes] = useState(false);
  const [fixingOnlyFlaggedSceneId, setFixingOnlyFlaggedSceneId] = useState<
    number | null
  >(null);

  const [combiningNoSubtitlePairs, setCombiningNoSubtitlePairs] =
    useState(false);
  const [combiningNoSubtitleSceneId, setCombiningNoSubtitleSceneId] = useState<
    number | null
  >(null);

  const playBatchDoneSound = () => {
    playSuccessSound();
  };

  const isSceneFlagged = (scene: unknown): boolean => {
    if (!scene || typeof scene !== 'object') return false;

    return isSceneFlaggedForFixTts(scene as BaserowRow);
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

  const handleCombineNoSubtitlePairs = async () => {
    if (combiningNoSubtitlePairs) return;

    const clearedGeneratedFields: Record<string, unknown> = {
      field_6886: '', // Videos
      field_6888: '', // Video Clip URL
      field_6891: '', // TTS
      field_6910: '', // Captions URL for Scene
      field_7094: '', // Image for Scene
      field_7098: '', // Video for Scene
      field_7095: '', // Upscaled Image for Scene
      field_7096: null, // Flagged
      field_7099: '', // hasText
    };

    // Reuse the subtitle-setting threshold logic used by batch subtitle generation.
    // Subtitles are generated only when charCount < maxChars (strictly less).
    // So scenes with charCount >= maxChars are the ones expected to have no subtitles.
    if (!subtitleGenerationSettings.enableCharLimit) {
      return;
    }

    const maxChars = Math.max(
      1,
      Math.floor(subtitleGenerationSettings.maxChars),
    );
    const skipFirstScenes = Math.max(
      0,
      Math.floor(combineScenesSettings.skipFirstScenes),
    );

    // Sort scenes by start time (field_6896) to process them in order
    const ordered = [...data].sort(
      (a, b) => (Number(a.field_6896) || 0) - (Number(b.field_6896) || 0),
    );
    const sorted = ordered.slice(skipFirstScenes);

    // Eligible scene criteria for this operation:
    // 1) Non-empty sentence (field_6890)
    // 2) Sentence char count is >= subtitle maxChars, matching subtitle skip rule
    const isEligible = (scene: (typeof data)[0]) => {
      const sentence = String(scene['field_6890'] ?? '').trim();
      if (!sentence) return false;
      const charCount = sentence.length;
      return charCount >= maxChars;
    };

    // Greedy left-to-right: find non-overlapping consecutive eligible pairs
    const pairs: (typeof data)[0][][] = [];
    let i = 0;
    while (i < sorted.length - 1) {
      if (isEligible(sorted[i]) && isEligible(sorted[i + 1])) {
        pairs.push([sorted[i], sorted[i + 1]]);
        i += 2; // skip both — each scene used at most once
      } else {
        i += 1;
      }
    }

    if (pairs.length === 0) {
      return;
    }

    setCombiningNoSubtitlePairs(true);
    setCombiningNoSubtitleSceneId(null);

    try {
      for (const [currentScene, nextScene] of pairs) {
        setCombiningNoSubtitleSceneId(currentScene.id);

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

        // PATCH current scene with merged data
        const patchRes = await fetch(`/api/baserow/scenes/${currentScene.id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            field_6890: newSentence,
            field_6901: newOriginal,
            field_6897: newEndTime,
            field_6884: newDuration,
            ...clearedGeneratedFields,
          }),
        });

        if (!patchRes.ok) {
          const t = await patchRes.text().catch(() => '');
          throw new Error(
            `Failed to update scene ${currentScene.id}: ${patchRes.status} ${t}`,
          );
        }

        // DELETE next scene
        const deleteRes = await fetch(`/api/baserow/scenes/${nextScene.id}`, {
          method: 'DELETE',
        });

        if (!deleteRes.ok) {
          const t = await deleteRes.text().catch(() => '');
          throw new Error(
            `Failed to delete scene ${nextScene.id}: ${deleteRes.status} ${t}`,
          );
        }

        await new Promise((resolve) => setTimeout(resolve, 250));
      }

      playBatchDoneSound();
      onRefresh?.();
    } catch (error) {
      console.error('Failed to combine no-subtitle pairs:', error);
    } finally {
      setCombiningNoSubtitlePairs(false);
      setCombiningNoSubtitleSceneId(null);
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

  const onFixLanguageTenScenes = async () => {
    const runId = `fixlang-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const logPrefix = `[FixLanguage x10][${runId}]`;
    const startedAt = Date.now();
    const batchSize = 30;
    const normalizeTextForComparison = (value: string) =>
      String(value).replace(/\s+/g, ' ').trim();

    if (fixingLanguageTenScenes) {
      console.info(
        `${logPrefix} Ignored click: another run is already active.`,
      );
      return;
    }
    if (!modelSelection.selectedModel) {
      console.warn(`${logPrefix} Aborted: no model selected.`);
      return;
    }

    console.info(`${logPrefix} Run started.`, {
      selectedModel: modelSelection.selectedModel,
      totalScenesInView: data.length,
    });

    const mappedScenes = [...data]
      .map((scene) => {
        const sentence = String(scene['field_6890'] ?? '').trim();
        const original = String(
          scene['field_6901'] ?? scene['field_6900'] ?? '',
        ).trim();
        const fixedSentenceConfirmation = String(
          scene['field_7105'] ?? '',
        ).trim();
        const alreadyFixed = Boolean(fixedSentenceConfirmation);

        return {
          scene,
          text: sentence || original,
          alreadyFixed,
        };
      })
      .sort(
        (a, b) => (Number(a.scene.order) || 0) - (Number(b.scene.order) || 0),
      );

    const skippedAlreadyFixed = mappedScenes.filter(
      (item) => item.alreadyFixed,
    );
    const candidateScenes = mappedScenes.filter(
      (item) => Boolean(item.text) && !item.alreadyFixed,
    );

    console.info(`${logPrefix} Eligible scenes identified.`, {
      eligibleCount: candidateScenes.length,
      eligibleSceneIdsPreview: candidateScenes
        .slice(0, 20)
        .map((item) => item.scene.id),
      skippedAlreadyFixedCount: skippedAlreadyFixed.length,
      skippedAlreadyFixedByField7105IdsPreview: skippedAlreadyFixed
        .slice(0, 20)
        .map((item) => item.scene.id),
    });

    if (candidateScenes.length === 0) {
      console.info(`${logPrefix} Aborted: no eligible scenes found.`);
      return;
    }

    const totalBatches = Math.ceil(candidateScenes.length / batchSize);

    console.info(`${logPrefix} Batch plan created.`, {
      batchSize,
      totalEligibleScenes: candidateScenes.length,
      totalBatches,
    });

    setFixingLanguageTenScenes(true);
    setFixingLanguageSceneId(null);

    try {
      let processedSceneCount = 0;
      let updatedScenesCount = 0;
      const failedBatches: Array<{
        batchNumber: number;
        sceneIds: number[];
        error: string;
      }> = [];

      for (let batchIndex = 0; batchIndex < totalBatches; batchIndex += 1) {
        const batchNumber = batchIndex + 1;
        const selectedBatch = candidateScenes.slice(
          batchIndex * batchSize,
          (batchIndex + 1) * batchSize,
        );
        const expectedSceneIds = selectedBatch.map((item) => item.scene.id);
        const expectedSceneIdSet = new Set(expectedSceneIds);
        const expectedTextBySceneId = new Map<number, string>(
          selectedBatch.map((item) => [item.scene.id, item.text]),
        );
        const expectedCount = selectedBatch.length;

        console.info(
          `${logPrefix} Starting batch ${batchNumber}/${totalBatches}.`,
          {
            expectedCount,
            sceneIds: expectedSceneIds,
          },
        );

        try {
          console.info(
            `${logPrefix} Sending batch ${batchNumber}/${totalBatches} to /api/fix-language-scenes...`,
            {
              sceneIds: expectedSceneIds,
              textCharCounts: selectedBatch.map((item) => ({
                sceneId: item.scene.id,
                charCount: item.text.length,
              })),
            },
          );

          const res = await fetch('/api/fix-language-scenes', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              model: modelSelection.selectedModel,
              scenes: selectedBatch.map((item) => ({
                sceneId: item.scene.id,
                text: item.text,
              })),
            }),
          });

          console.info(
            `${logPrefix} Batch ${batchNumber}/${totalBatches} API responded.`,
            {
              status: res.status,
              ok: res.ok,
            },
          );

          let apiRequestId: string | null = null;

          if (!res.ok) {
            let message = `Language fix failed: ${res.status}`;
            try {
              const json = (await res.json().catch(() => null)) as {
                error?: unknown;
                requestId?: unknown;
              } | null;
              apiRequestId =
                typeof json?.requestId === 'string' ? json.requestId : null;
              if (typeof json?.error === 'string' && json.error.trim()) {
                message = json.error;
              }
            } catch {
              const t = await res.text().catch(() => '');
              if (t) {
                message = `${message} ${t}`;
              }
            }
            throw new Error(
              `Batch ${batchNumber}/${totalBatches} failed (apiRequestId=${apiRequestId ?? 'n/a'}): ${message}`,
            );
          }

          const payload = (await res.json().catch(() => null)) as {
            sentences?: unknown;
            requestId?: unknown;
          } | null;

          apiRequestId =
            typeof payload?.requestId === 'string' ? payload.requestId : null;

          console.info(
            `${logPrefix} Batch ${batchNumber}/${totalBatches} response payload parsed.`,
            {
              apiRequestId,
              hasSentencesArray: Array.isArray(payload?.sentences),
              returnedCount: Array.isArray(payload?.sentences)
                ? payload.sentences.length
                : null,
            },
          );

          if (!Array.isArray(payload?.sentences)) {
            throw new Error(
              `Batch ${batchNumber}/${totalBatches} response is missing "sentences" array.`,
            );
          }

          if (payload.sentences.length !== expectedCount) {
            throw new Error(
              `Batch ${batchNumber}/${totalBatches} must return exactly ${expectedCount} sentences, received ${payload.sentences.length}.`,
            );
          }

          const normalizedSentences = payload.sentences.map((item, index) => {
            if (!item || typeof item !== 'object') {
              throw new Error(
                `Batch ${batchNumber}/${totalBatches} has invalid response item at index ${index}.`,
              );
            }

            const sceneId = Number((item as { sceneId?: unknown }).sceneId);
            const sourceTextRaw = (item as { sourceText?: unknown }).sourceText;
            const fixedSentenceRaw = (item as { fixedSentence?: unknown })
              .fixedSentence;
            const sourceText =
              typeof sourceTextRaw === 'string' ? sourceTextRaw.trim() : '';
            const fixedSentence =
              typeof fixedSentenceRaw === 'string'
                ? fixedSentenceRaw.trim()
                : '';

            if (!Number.isFinite(sceneId) || sceneId <= 0) {
              throw new Error(
                `Batch ${batchNumber}/${totalBatches} has invalid sceneId at response index ${index}.`,
              );
            }

            if (!expectedSceneIdSet.has(sceneId)) {
              throw new Error(
                `Batch ${batchNumber}/${totalBatches} returned unexpected sceneId ${sceneId}.`,
              );
            }

            if (!fixedSentence) {
              throw new Error(
                `Batch ${batchNumber}/${totalBatches} returned empty fixed sentence for scene ${sceneId}.`,
              );
            }

            if (!sourceText) {
              throw new Error(
                `Batch ${batchNumber}/${totalBatches} returned empty sourceText for scene ${sceneId}.`,
              );
            }

            const expectedText = expectedTextBySceneId.get(sceneId) || '';
            if (!expectedText) {
              throw new Error(
                `Batch ${batchNumber}/${totalBatches} missing expected input value for scene ${sceneId}.`,
              );
            }

            const expectedNormalized = normalizeTextForComparison(expectedText);
            const returnedNormalized = normalizeTextForComparison(sourceText);
            if (expectedNormalized !== returnedNormalized) {
              throw new Error(
                `Batch ${batchNumber}/${totalBatches} sourceText mismatch for scene ${sceneId}.`,
              );
            }

            return { sceneId, sourceText, fixedSentence };
          });

          console.info(
            `${logPrefix} Batch ${batchNumber}/${totalBatches} response normalization completed.`,
            {
              returnedSceneIds: normalizedSentences.map((item) => item.sceneId),
            },
          );

          const seenIds = new Set<number>();
          for (const item of normalizedSentences) {
            if (seenIds.has(item.sceneId)) {
              throw new Error(
                `Batch ${batchNumber}/${totalBatches} returned duplicate sceneId: ${item.sceneId}.`,
              );
            }
            seenIds.add(item.sceneId);
          }

          const missingIds = expectedSceneIds.filter((id) => !seenIds.has(id));
          if (missingIds.length > 0) {
            throw new Error(
              `Batch ${batchNumber}/${totalBatches} response is missing scene IDs: ${missingIds.join(', ')}.`,
            );
          }

          for (let i = 0; i < normalizedSentences.length; i += 1) {
            const item = normalizedSentences[i];
            setFixingLanguageSceneId(item.sceneId);

            console.info(`${logPrefix} Saving scene text...`, {
              batch: `${batchNumber}/${totalBatches}`,
              batchProgress: `${i + 1}/${normalizedSentences.length}`,
              overallProgress: `${processedSceneCount + 1}/${candidateScenes.length}`,
              sceneId: item.sceneId,
              fixedSentencePreview: item.fixedSentence.slice(0, 80),
              saveFields: ['field_7105', 'field_6890'],
            });

            const patchRes = await fetch(
              `/api/baserow/scenes/${item.sceneId}`,
              {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  field_7105: item.fixedSentence,
                  field_6890: item.fixedSentence,
                }),
              },
            );

            if (!patchRes.ok) {
              const t = await patchRes.text().catch(() => '');
              console.error(`${logPrefix} Failed while saving scene text.`, {
                batch: `${batchNumber}/${totalBatches}`,
                sceneId: item.sceneId,
                status: patchRes.status,
                responseText: t,
              });
              throw new Error(
                `Failed to save fixed sentence for scene ${item.sceneId}: ${patchRes.status} ${t}`,
              );
            }

            processedSceneCount += 1;
            updatedScenesCount += 1;
            await new Promise((resolve) => setTimeout(resolve, 150));
          }

          console.info(
            `${logPrefix} Batch ${batchNumber}/${totalBatches} completed successfully.`,
            {
              updatedInBatch: normalizedSentences.length,
              processedSceneCount,
              totalScenesPlanned: candidateScenes.length,
            },
          );
        } catch (batchError) {
          const errorMessage =
            batchError instanceof Error
              ? batchError.message
              : String(batchError);

          failedBatches.push({
            batchNumber,
            sceneIds: expectedSceneIds,
            error: errorMessage,
          });

          console.error(
            `${logPrefix} Batch ${batchNumber}/${totalBatches} failed. Continuing with next batch.`,
            {
              error: errorMessage,
              sceneIds: expectedSceneIds,
            },
          );
        }

        await new Promise((resolve) => setTimeout(resolve, 200));
      }

      playBatchDoneSound();
      onRefresh?.();

      if (failedBatches.length > 0) {
        console.warn(`${logPrefix} Run completed with failed batches.`, {
          failedBatchCount: failedBatches.length,
          failedBatches,
        });
      }

      console.info(`${logPrefix} Run completed.`, {
        updatedScenes: updatedScenesCount,
        totalEligibleScenes: candidateScenes.length,
        failedBatchCount: failedBatches.length,
        durationMs: Date.now() - startedAt,
      });
    } catch (error) {
      console.error(`${logPrefix} Run failed.`, error);
    } finally {
      setFixingLanguageTenScenes(false);
      setFixingLanguageSceneId(null);
      console.info(`${logPrefix} Run finished.`, {
        durationMs: Date.now() - startedAt,
      });
    }
  };

  const onApplyWordReplacementsCurrentVideo = async () => {
    if (applyingCurrentVideoWordReplacements) return;

    const selectedVideoId = Number(selectedOriginalVideo.id);
    if (!Number.isFinite(selectedVideoId) || selectedVideoId <= 0) {
      return;
    }

    setApplyingCurrentVideoWordReplacements(true);

    try {
      const res = await fetch('/api/apply-tts-word-replacements', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ videoId: selectedVideoId }),
      });

      const payload = (await res.json().catch(() => null)) as {
        error?: unknown;
        message?: unknown;
        scannedScenes?: unknown;
        changedScenes?: unknown;
        updatedScenes?: unknown;
        failedUpdates?: unknown;
      } | null;

      if (!res.ok) {
        const message =
          typeof payload?.error === 'string'
            ? payload.error
            : `Failed to apply word replacements (${res.status})`;
        throw new Error(message);
      }

      console.info('[TTS Word Replacements][Current Video] Completed.', {
        selectedVideoId,
        message:
          typeof payload?.message === 'string' ? payload.message : undefined,
        scannedScenes: Number(payload?.scannedScenes ?? 0),
        changedScenes: Number(payload?.changedScenes ?? 0),
        updatedScenes: Number(payload?.updatedScenes ?? 0),
        failedCount: Array.isArray(payload?.failedUpdates)
          ? payload.failedUpdates.length
          : 0,
      });

      playBatchDoneSound();
      onRefresh?.();
    } catch (error) {
      console.error(
        '[TTS Word Replacements][Current Video] Failed to apply.',
        error,
      );
    } finally {
      setApplyingCurrentVideoWordReplacements(false);
    }
  };

  const onGenerateAllTTS = () => {
    const voiceOverride =
      typeof selectedOriginalVideo.ttsVoiceReference === 'string' &&
      selectedOriginalVideo.ttsVoiceReference.trim().length > 0
        ? selectedOriginalVideo.ttsVoiceReference.trim()
        : null;

    const dataForTts = voiceOverride
      ? data.map((scene) => ({ ...scene, field_6860: voiceOverride }))
      : data;

    handleGenerateAllTTS(
      dataForTts,
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

    const voiceOverride =
      typeof selectedOriginalVideo.ttsVoiceReference === 'string' &&
      selectedOriginalVideo.ttsVoiceReference.trim().length > 0
        ? selectedOriginalVideo.ttsVoiceReference.trim()
        : null;

    startBatchOperation('transcribingAllFinalScenes');
    try {
      // Run sequentially, ordered, to avoid concurrency issues and ensure robust per-scene comparison.
      const scenesToFix = getFixTtsEligibleScenes(data);

      if (scenesToFix.length === 0) {
        console.log('No scenes with final video + text found to fix.');
        return;
      }

      const runFixPass = async (
        scenes: BaserowRow[],
        passLabel: string,
      ): Promise<void> => {
        for (const scene of scenes) {
          setTranscribingScene(scene.id);
          try {
            const sceneWithVoiceOverride = withSceneVoiceOverride(
              scene,
              voiceOverride,
            );

            await handleAutoFixMismatch(scene.id, sceneWithVoiceOverride);
          } catch (error) {
            console.error(
              `Fix TTS failed for scene ${scene.id} (${passLabel}):`,
              error,
            );
          } finally {
            setTranscribingScene(null);
          }

          // Small delay between scenes to be gentle on the backend.
          await new Promise((r) => setTimeout(r, 500));
        }
      };

      await runFixPass(scenesToFix, 'initial');

      onRefresh?.();
    } finally {
      completeBatchOperation('transcribingAllFinalScenes');
      playSuccessSound();
    }
  };

  const onFixOnlyFlaggedFinalTTS = async () => {
    // Separate flagged-only flow: fetch once for all scenes in selected video,
    // filter flagged=true server-side, then process only those scene IDs.
    if (!selectedOriginalVideo.id) return;

    const selectedVideoId =
      typeof selectedOriginalVideo.id === 'number'
        ? selectedOriginalVideo.id
        : parseInt(String(selectedOriginalVideo.id), 10);

    if (!Number.isFinite(selectedVideoId) || selectedVideoId <= 0) {
      return;
    }

    const voiceOverride =
      typeof selectedOriginalVideo.ttsVoiceReference === 'string' &&
      selectedOriginalVideo.ttsVoiceReference.trim().length > 0
        ? selectedOriginalVideo.ttsVoiceReference.trim()
        : null;

    setFixingOnlyFlaggedScenes(true);
    setFixingOnlyFlaggedSceneId(null);

    try {
      const flaggedScenes = await fetchFlaggedScenesForVideo(selectedVideoId);

      if (flaggedScenes.length === 0) {
        console.log(
          `No flagged scenes found for video ${selectedVideoId} (flagged=true).`,
        );
        return;
      }

      for (const scene of flaggedScenes) {
        setFixingOnlyFlaggedSceneId(scene.id);

        try {
          const sceneWithVoiceOverride = withSceneVoiceOverride(
            scene,
            voiceOverride,
          );

          await handleAutoFixMismatch(scene.id, sceneWithVoiceOverride, {
            maxAttempts: 1,
          });
        } catch (error) {
          console.error(
            `Fix flagged-only TTS failed for scene ${scene.id}:`,
            error,
          );
        }

        await new Promise((r) => setTimeout(r, 500));
      }

      onRefresh?.();
    } catch (error) {
      console.error('Fix flagged-only TTS failed:', error);
    } finally {
      setFixingOnlyFlaggedScenes(false);
      setFixingOnlyFlaggedSceneId(null);
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

  const extractUrlFromSceneField = (raw: unknown): string => {
    if (typeof raw === 'string') return raw.trim();
    if (!raw) return '';

    if (Array.isArray(raw) && raw.length > 0) {
      const first = raw[0] as unknown;
      return extractUrlFromSceneField(first);
    }

    if (typeof raw === 'object') {
      const obj = raw as Record<string, unknown>;
      const url = obj.url ?? (obj.file as { url?: unknown } | undefined)?.url;
      if (typeof url === 'string') return url.trim();
    }

    return String(raw).trim();
  };

  const getExistingSceneImageUrl = (scene: BaserowRow): string => {
    return extractUrlFromSceneField(
      scene['field_7094'] ??
        (scene as unknown as { field_7094?: unknown }).field_7094,
    );
  };

  const getExistingUpscaledSceneImageUrl = (scene: BaserowRow): string => {
    return extractUrlFromSceneField(
      scene['field_7095'] ??
        (scene as unknown as { field_7095?: unknown }).field_7095,
    );
  };

  const getExistingFinalVideoUrl = (scene: BaserowRow): string => {
    return extractUrlFromSceneField(
      scene['field_6886'] ??
        (scene as unknown as { field_6886?: unknown }).field_6886,
    );
  };

  const getExistingSceneVideoUrl = (scene: BaserowRow): string => {
    return extractUrlFromSceneField(
      scene['field_7098'] ??
        (scene as unknown as { field_7098?: unknown }).field_7098,
    );
  };

  const getSceneHasTextParsed = (scene: BaserowRow) => {
    // New field: hasText (7099) is a single-line text value like: "true|<imageUrl>".
    // Legacy field: hasText (7097) was a single-select and may still exist on older rows.
    const raw =
      scene['field_7099'] ??
      (scene as unknown as { field_7099?: unknown }).field_7099 ??
      scene['field_7097'] ??
      (scene as unknown as { field_7097?: unknown }).field_7097;
    return parseSceneHasTextField(raw);
  };

  const sceneAlreadyAppliedOutput = (scene: BaserowRow): boolean => {
    const finalUrl = getExistingFinalVideoUrl(scene);
    if (!finalUrl) return false;

    try {
      const pathname = new URL(finalUrl).pathname;
      const filename = pathname.split('/').filter(Boolean).pop() ?? '';
      if (!filename) return false;

      const direct = new RegExp(`(^|_)scene_${scene.id}_applied_`, 'i');
      return direct.test(filename);
    } catch {
      return false;
    }
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

  const getVideoDurationSeconds = async (videoUrl: string): Promise<number> => {
    const res = await fetch('/api/get-video-duration', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ videoUrl }),
    });

    if (!res.ok) {
      const t = await res.text().catch(() => '');
      throw new Error(`Duration probe failed (${res.status}) ${t}`);
    }

    const data = (await res.json().catch(() => null)) as {
      duration?: unknown;
    } | null;

    const d =
      typeof data?.duration === 'number'
        ? data.duration
        : Number.isFinite(Number(data?.duration))
          ? Number(data?.duration)
          : Number.NaN;
    if (!Number.isFinite(d) || d <= 0) throw new Error('Invalid duration');
    return d;
  };

  const detectNoTextForImageUrl = async (
    imageUrl: string,
  ): Promise<{ hasText: boolean }> => {
    const res = await fetch('/api/detect-text-in-image?accurate=1', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ imageUrl }),
    });
    if (!res.ok) {
      const t = await res.text().catch(() => '');
      throw new Error(`Text detect failed (${res.status}) ${t}`);
    }
    const data = (await res.json().catch(() => null)) as { hasText?: unknown };
    return { hasText: Boolean(data?.hasText) };
  };

  const onGenerateAllSceneVideos = async () => {
    if (generatingAllSceneVideos) return;

    const scenesToGenerate = [...data]
      .filter((scene) => {
        // Permanent: must have a base image.
        const imgUrl = getExistingSceneImageUrl(scene);
        if (!imgUrl) return false;

        // Permanent: skip if scene video already exists.
        const existing = getExistingSceneVideoUrl(scene);
        if (existing) return false;

        return true;
      })
      .sort((a, b) => (Number(a.order) || 0) - (Number(b.order) || 0));

    if (scenesToGenerate.length === 0) {
      playBatchDoneSound();
      return;
    }

    setGeneratingAllSceneVideos(true);
    setGeneratingSceneVideoId(null);

    try {
      for (const scene of scenesToGenerate) {
        setGeneratingSceneVideoId(scene.id);

        // Dynamic condition #2 (order requirement): duration check FIRST.
        if (sceneVideoGenerationSettings.enableDurationRange) {
          const finalUrl = getExistingFinalVideoUrl(scene);
          if (!finalUrl) {
            await new Promise((r) => setTimeout(r, 50));
            continue;
          }

          try {
            const d = await getVideoDurationSeconds(finalUrl);
            const min = sceneVideoGenerationSettings.minDurationSec;
            const max = sceneVideoGenerationSettings.maxDurationSec;

            if (typeof min === 'number' && Number.isFinite(min) && d < min) {
              await new Promise((r) => setTimeout(r, 50));
              continue;
            }
            if (typeof max === 'number' && Number.isFinite(max) && d > max) {
              await new Promise((r) => setTimeout(r, 50));
              continue;
            }
          } catch (error) {
            console.error(
              `Duration check failed for scene ${scene.id}:`,
              error,
            );
            await new Promise((r) => setTimeout(r, 150));
            continue;
          }
        }

        // Dynamic condition #1: only generate when image has NO text.
        if (sceneVideoGenerationSettings.onlyGenerateIfNoText) {
          const imgUrl = getExistingSceneImageUrl(scene);
          if (!imgUrl) {
            await new Promise((r) => setTimeout(r, 50));
            continue;
          }

          // New method: only trust a stored hasText value if it's for THIS exact image URL.
          // This automatically invalidates the stored value whenever the image changes.
          const parsed = getSceneHasTextParsed(scene);
          const isFresh = isHasTextRecordFreshForImage({
            parsed,
            imageUrl: imgUrl,
          });
          if (isFresh && parsed.hasText === true) {
            await new Promise((r) => setTimeout(r, 50));
            continue;
          }

          try {
            // If we have a fresh, explicit false for this image, skip re-checking.
            let hasText: boolean;
            if (isFresh && parsed.hasText === false) {
              hasText = false;
            } else {
              const detected = await detectNoTextForImageUrl(imgUrl);
              hasText = Boolean(detected.hasText);

              // Best-effort persistence for both true/false, encoded with the source image URL.
              try {
                await fetch(`/api/baserow/scenes/${scene.id}`, {
                  method: 'PATCH',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({
                    field_7099: formatSceneHasTextField({
                      hasText,
                      imageUrl: imgUrl,
                    }),
                  }),
                });
              } catch {
                // ignore best-effort persistence
              }
            }

            if (hasText) {
              await new Promise((r) => setTimeout(r, 50));
              continue;
            }
          } catch (error) {
            console.error(
              `Text detection failed for scene ${scene.id}:`,
              error,
            );
            await new Promise((r) => setTimeout(r, 150));
            continue;
          }
        }

        // Generate scene video (field_7098)
        try {
          const maxAttempts = 3;
          for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
            const res = await fetch('/api/generate-scene-video', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ sceneId: scene.id }),
            });

            // Treat server skip as a skip (idempotency).
            if (res.status === 409) {
              await new Promise((r) => setTimeout(r, 150));
              break;
            }

            if (res.ok) break;

            const t = await res.text().catch(() => '');
            let retryable = false;
            let taskId: string | null = null;
            try {
              const j = JSON.parse(t) as {
                retryable?: unknown;
                taskId?: unknown;
              };
              retryable = Boolean(j?.retryable);
              taskId =
                typeof j?.taskId === 'string' && j.taskId.trim()
                  ? j.taskId.trim()
                  : null;
            } catch {
              // ignore
            }

            const isServerish = res.status >= 500;
            const canRetry =
              attempt < maxAttempts && (retryable || isServerish);
            if (!canRetry) {
              throw new Error(
                `Scene video generation failed (${res.status})${taskId ? ` taskId=${taskId}` : ''} ${t}`,
              );
            }

            const delayMs = 750 * attempt;
            console.warn(
              `Scene video generation transient failure for scene ${scene.id} (attempt ${attempt}/${maxAttempts}, status ${res.status})${taskId ? ` taskId=${taskId}` : ''}. Retrying in ${delayMs}ms...`,
            );
            await new Promise((r) => setTimeout(r, delayMs));
          }
        } catch (error) {
          console.error(
            `Scene video generation failed for scene ${scene.id}:`,
            error,
          );
        }

        // Gentle pacing (each request may take a while)
        await new Promise((r) => setTimeout(r, 250));
      }

      onRefresh?.();
      playBatchDoneSound();
    } finally {
      setGeneratingAllSceneVideos(false);
      setGeneratingSceneVideoId(null);
    }
  };

  const onEnhanceAllSceneVideos = async () => {
    if (enhancingAllSceneVideos) return;

    const scenesToEnhance = [...data]
      .filter((scene) => {
        // Match the modal button's intent: enhance the saved scene video (7098).
        const sceneVideoUrl = getExistingSceneVideoUrl(scene);
        if (!sceneVideoUrl) return false;
        if (
          !(
            sceneVideoUrl.startsWith('http://') ||
            sceneVideoUrl.startsWith('https://')
          )
        ) {
          return false;
        }

        // Skip if it already looks enhanced (modal would just get a 409 anyway).
        if (sceneVideoUrl.includes('_enhanced_')) return false;

        return true;
      })
      .sort((a, b) => (Number(a.order) || 0) - (Number(b.order) || 0));

    if (scenesToEnhance.length === 0) {
      playBatchDoneSound();
      return;
    }

    setEnhancingAllSceneVideos(true);
    setEnhancingSceneVideoId(null);

    try {
      for (const scene of scenesToEnhance) {
        setEnhancingSceneVideoId(scene.id);

        try {
          const res = await fetch('/api/enhance-scene-video', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ sceneId: scene.id }),
          });

          // Mirror modal behavior: already-enhanced is a friendly no-op.
          if (res.status === 409) {
            await new Promise((r) => setTimeout(r, 150));
            continue;
          }

          if (!res.ok) {
            const t = await res.text().catch(() => '');
            throw new Error(`Enhance failed (${res.status}) ${t}`);
          }
        } catch (error) {
          console.error(`Enhance failed for scene ${scene.id}:`, error);
        }

        // Gentle pacing (each enhance may take minutes)
        await new Promise((r) => setTimeout(r, 250));
      }

      onRefresh?.();
      playBatchDoneSound();
    } finally {
      setEnhancingAllSceneVideos(false);
      setEnhancingSceneVideoId(null);
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

  const onApplyUpscaledImagesAll = async () => {
    if (applyingAllUpscaledImages) return;

    const scenesToApply = [...data]
      .filter((scene) => {
        // Only scenes with upscaled image
        if (!getExistingUpscaledSceneImageUrl(scene)) return false;

        // Must have a final video URL to apply onto
        const finalUrl = getExistingFinalVideoUrl(scene);
        if (!finalUrl) return false;

        // Skip if already applied (image or video)
        if (sceneAlreadyAppliedOutput(scene)) return false;

        return true;
      })
      .sort((a, b) => (Number(a.order) || 0) - (Number(b.order) || 0));

    if (scenesToApply.length === 0) {
      playBatchDoneSound();
      return;
    }

    setApplyingAllUpscaledImages(true);
    setApplyingUpscaledImageSceneId(null);

    try {
      for (const scene of scenesToApply) {
        setApplyingUpscaledImageSceneId(scene.id);

        try {
          const res = await fetch('/api/apply-upscaled-scene-image', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ sceneId: scene.id }),
          });

          // The API also returns 409 when already applied; treat as a skip.
          if (res.status === 409) {
            await new Promise((r) => setTimeout(r, 150));
            continue;
          }

          if (!res.ok) {
            const t = await res.text().catch(() => '');
            throw new Error(`Apply image failed (${res.status}) ${t}`);
          }
        } catch (error) {
          console.error(
            `Apply upscaled image failed for scene ${scene.id}:`,
            error,
          );
        }

        // Gentle pacing (each apply may take a while)
        await new Promise((r) => setTimeout(r, 250));
      }

      onRefresh?.();
      playBatchDoneSound();
    } finally {
      setApplyingAllUpscaledImages(false);
      setApplyingUpscaledImageSceneId(null);
    }
  };

  const onApplyEnhancedVideosAll = async () => {
    if (applyingAllEnhancedVideos) return;

    const scenesToApply = [...data]
      .filter((scene) => {
        // Must have a final video URL to apply onto
        const finalUrl = getExistingFinalVideoUrl(scene);
        if (!finalUrl) return false;

        // Must have an enhanced scene video URL (field_7098)
        const enhancedUrl = getExistingSceneVideoUrl(scene);
        if (!enhancedUrl) return false;
        if (
          !(
            enhancedUrl.startsWith('http://') ||
            enhancedUrl.startsWith('https://')
          )
        ) {
          return false;
        }

        // Match the API heuristic: we only apply videos that look enhanced.
        if (!enhancedUrl.includes('_enhanced_')) return false;

        // Skip if already applied (image or video)
        if (sceneAlreadyAppliedOutput(scene)) return false;

        return true;
      })
      .sort((a, b) => (Number(a.order) || 0) - (Number(b.order) || 0));

    if (scenesToApply.length === 0) {
      playBatchDoneSound();
      return;
    }

    setApplyingAllEnhancedVideos(true);
    setApplyingEnhancedVideoSceneId(null);

    try {
      for (const scene of scenesToApply) {
        setApplyingEnhancedVideoSceneId(scene.id);

        try {
          const res = await fetch('/api/apply-enhanced-scene-video', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ sceneId: scene.id }),
          });

          // The API returns 409 when already applied; treat as a skip.
          if (res.status === 409) {
            await new Promise((r) => setTimeout(r, 150));
            continue;
          }

          if (!res.ok) {
            const t = await res.text().catch(() => '');
            throw new Error(`Apply video failed (${res.status}) ${t}`);
          }
        } catch (error) {
          console.error(
            `Apply enhanced video failed for scene ${scene.id}:`,
            error,
          );
        }

        // Gentle pacing (each apply may take a while)
        await new Promise((r) => setTimeout(r, 250));
      }

      onRefresh?.();
      playBatchDoneSound();
    } finally {
      setApplyingAllEnhancedVideos(false);
      setApplyingEnhancedVideoSceneId(null);
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
              Batch Operations For Scenes of A Single Video
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
                  fixingLanguageTenScenes ||
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

              <button
                onClick={onFixLanguageTenScenes}
                disabled={
                  fixingLanguageTenScenes ||
                  promptingAllScenes ||
                  batchOperations.improvingAll ||
                  sceneLoading.improvingSentence !== null
                }
                className='mt-3 w-full h-12 bg-indigo-500 hover:bg-indigo-600 disabled:bg-indigo-300 text-white font-medium rounded-lg transition-all duration-200 flex items-center justify-center gap-2 shadow-sm hover:shadow-md disabled:cursor-not-allowed'
                title={
                  fixingLanguageTenScenes
                    ? fixingLanguageSceneId
                      ? `Fixing language for scene ${fixingLanguageSceneId}`
                      : 'Fixing language in 10-scene batches...'
                    : 'Fix language for all eligible scenes in 10-scene batches'
                }
              >
                {fixingLanguageTenScenes && (
                  <Loader2 className='w-4 h-4 animate-spin' />
                )}
                <span className='font-medium'>
                  {fixingLanguageTenScenes
                    ? fixingLanguageSceneId
                      ? `Fixing #${fixingLanguageSceneId}`
                      : 'Processing...'
                    : 'Fix Language All'}
                </span>
              </button>

              <button
                onClick={onApplyWordReplacementsCurrentVideo}
                disabled={
                  !selectedOriginalVideo.id ||
                  applyingCurrentVideoWordReplacements ||
                  fixingLanguageTenScenes ||
                  promptingAllScenes ||
                  batchOperations.improvingAll ||
                  sceneLoading.improvingSentence !== null
                }
                className='mt-3 w-full h-12 bg-indigo-500 hover:bg-indigo-600 disabled:bg-indigo-300 text-white font-medium rounded-lg transition-all duration-200 flex items-center justify-center gap-2 shadow-sm hover:shadow-md disabled:cursor-not-allowed'
                title={
                  !selectedOriginalVideo.id
                    ? 'Select an original video first'
                    : applyingCurrentVideoWordReplacements
                      ? 'Applying saved word replacements to scenes of current video...'
                      : `Apply saved word replacements to scenes of selected video #${selectedOriginalVideo.id}`
                }
              >
                {applyingCurrentVideoWordReplacements && (
                  <Loader2 className='w-4 h-4 animate-spin' />
                )}
                <span className='font-medium'>
                  {applyingCurrentVideoWordReplacements
                    ? 'Applying...'
                    : 'Apply Word Fixes'}
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

                <FixFlaggedOnlyButton
                  onClick={onFixOnlyFlaggedFinalTTS}
                  disabled={
                    !selectedOriginalVideo.id ||
                    fixingOnlyFlaggedScenes ||
                    batchOperations.transcribingAllFinalScenes ||
                    sceneLoading.transcribingScene !== null
                  }
                  hasSelectedVideo={Boolean(selectedOriginalVideo.id)}
                  isRunning={fixingOnlyFlaggedScenes}
                  currentSceneId={fixingOnlyFlaggedSceneId}
                />
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

            {/* Generate Scene Videos (Image→Video) */}
            <div className='bg-gradient-to-br from-sky-50 to-sky-100 rounded-lg p-4 border border-sky-200'>
              <div className='flex items-center gap-2 mb-3'>
                <div className='p-2 bg-sky-500 rounded-lg flex items-center gap-1'>
                  <Film className='w-4 h-4 text-white' />
                  <span className='text-white text-xs font-bold'>I2V</span>
                </div>
                <h3 className='font-semibold text-sky-900'>Scene Videos</h3>
              </div>
              <p className='text-sm text-sky-800 mb-4 leading-relaxed'>
                Generate and save “Video for Scene” (7098) from “Image for
                Scene” (7094). Always skips scenes with missing images or an
                existing scene video. Dynamic filters come from Global Settings
                (duration range → text check).
              </p>
              <button
                onClick={onGenerateAllSceneVideos}
                disabled={generatingAllSceneVideos}
                className='w-full h-12 bg-sky-500 hover:bg-sky-600 disabled:bg-sky-300 text-white font-medium rounded-lg transition-all duration-200 flex items-center justify-center gap-2 shadow-sm hover:shadow-md disabled:cursor-not-allowed'
                title={
                  generatingAllSceneVideos
                    ? generatingSceneVideoId
                      ? `Generating scene video for scene ${generatingSceneVideoId}`
                      : 'Generating scene videos for all scenes...'
                    : 'Generate scene videos for all eligible scenes'
                }
              >
                {generatingAllSceneVideos && (
                  <Loader2 className='w-4 h-4 animate-spin' />
                )}
                <span className='font-medium'>
                  {generatingAllSceneVideos
                    ? generatingSceneVideoId
                      ? `Scene #${generatingSceneVideoId}`
                      : 'Processing...'
                    : 'Generate All'}
                </span>
              </button>
            </div>

            {/* Enhance / Upscale Scene Videos (REAL-Video-Enhancer) */}
            <div className='bg-gradient-to-br from-violet-50 to-violet-100 rounded-lg p-4 border border-violet-200'>
              <div className='flex items-center gap-2 mb-3'>
                <div className='p-2 bg-violet-500 rounded-lg flex items-center gap-1'>
                  <Wand2 className='w-4 h-4 text-white' />
                  <span className='text-white text-xs font-bold'>RVE</span>
                </div>
                <h3 className='font-semibold text-violet-900'>
                  Enhance Videos
                </h3>
              </div>
              <p className='text-sm text-violet-800 mb-4 leading-relaxed'>
                Enhance “Video for Scene” (7098) for all scenes that have a
                scene video and do not yet look enhanced. Uses the same
                endpoint/skip behavior as the modal “Enhance” button (409 =
                already enhanced).
              </p>
              <button
                onClick={onEnhanceAllSceneVideos}
                disabled={enhancingAllSceneVideos}
                className='w-full h-12 bg-violet-500 hover:bg-violet-600 disabled:bg-violet-300 text-white font-medium rounded-lg transition-all duration-200 flex items-center justify-center gap-2 shadow-sm hover:shadow-md disabled:cursor-not-allowed'
                title={
                  enhancingAllSceneVideos
                    ? enhancingSceneVideoId
                      ? `Enhancing scene video for scene ${enhancingSceneVideoId}`
                      : 'Enhancing scene videos for all scenes...'
                    : 'Enhance scene videos for all eligible scenes'
                }
              >
                {enhancingAllSceneVideos && (
                  <Loader2 className='w-4 h-4 animate-spin' />
                )}
                <span className='font-medium'>
                  {enhancingAllSceneVideos
                    ? enhancingSceneVideoId
                      ? `Scene #${enhancingSceneVideoId}`
                      : 'Processing...'
                    : 'Enhance All'}
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

            {/* Apply Upscaled Images */}
            <div className='bg-gradient-to-br from-rose-50 to-rose-100 rounded-lg p-4 border border-rose-200'>
              <div className='flex items-center gap-2 mb-3'>
                <div className='p-2 bg-rose-500 rounded-lg flex items-center gap-1'>
                  <Save className='w-4 h-4 text-white' />
                  <span className='text-white text-xs font-bold'>IMG</span>
                </div>
                <h3 className='font-semibold text-rose-900'>Apply Image</h3>
              </div>
              <p className='text-sm text-rose-800 mb-4 leading-relaxed'>
                Apply “Upscaled Image for Scene” (7095) over the current final
                video (6886) for all scenes that have an upscaled image. Skips
                scenes that are already applied.
              </p>
              <button
                onClick={onApplyUpscaledImagesAll}
                disabled={applyingAllUpscaledImages}
                className='w-full h-12 bg-rose-500 hover:bg-rose-600 disabled:bg-rose-300 text-white font-medium rounded-lg transition-all duration-200 flex items-center justify-center gap-2 shadow-sm hover:shadow-md disabled:cursor-not-allowed'
                title={
                  applyingAllUpscaledImages
                    ? applyingUpscaledImageSceneId
                      ? `Applying upscaled image for scene ${applyingUpscaledImageSceneId}`
                      : 'Applying upscaled images for all scenes...'
                    : 'Apply upscaled images for all scenes'
                }
              >
                {applyingAllUpscaledImages && (
                  <Loader2 className='w-4 h-4 animate-spin' />
                )}
                <span className='font-medium'>
                  {applyingAllUpscaledImages
                    ? applyingUpscaledImageSceneId
                      ? `Scene #${applyingUpscaledImageSceneId}`
                      : 'Processing...'
                    : 'Apply All'}
                </span>
              </button>
            </div>

            {/* Apply Enhanced Videos */}
            <div className='bg-gradient-to-br from-indigo-50 to-indigo-100 rounded-lg p-4 border border-indigo-200'>
              <div className='flex items-center gap-2 mb-3'>
                <div className='p-2 bg-indigo-500 rounded-lg flex items-center gap-1'>
                  <Film className='w-4 h-4 text-white' />
                  <span className='text-white text-xs font-bold'>VID</span>
                </div>
                <h3 className='font-semibold text-indigo-900'>Apply Video</h3>
              </div>
              <p className='text-sm text-indigo-800 mb-4 leading-relaxed'>
                Apply “Video for Scene” (7098) on top of the current final video
                (6886) for all scenes where the scene video looks enhanced
                (filename contains “_enhanced_”). Skips scenes that are already
                applied.
              </p>
              <button
                onClick={onApplyEnhancedVideosAll}
                disabled={applyingAllEnhancedVideos}
                className='w-full h-12 bg-indigo-500 hover:bg-indigo-600 disabled:bg-indigo-300 text-white font-medium rounded-lg transition-all duration-200 flex items-center justify-center gap-2 shadow-sm hover:shadow-md disabled:cursor-not-allowed'
                title={
                  applyingAllEnhancedVideos
                    ? applyingEnhancedVideoSceneId
                      ? `Applying enhanced video for scene ${applyingEnhancedVideoSceneId}`
                      : 'Applying enhanced videos for all scenes...'
                    : 'Apply enhanced videos for all scenes'
                }
              >
                {applyingAllEnhancedVideos && (
                  <Loader2 className='w-4 h-4 animate-spin' />
                )}
                <span className='font-medium'>
                  {applyingAllEnhancedVideos
                    ? applyingEnhancedVideoSceneId
                      ? `Scene #${applyingEnhancedVideoSceneId}`
                      : 'Processing...'
                    : 'Apply All'}
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

            {/* Combine Pairs (Subtitle Settings Based) */}
            <div className='bg-gradient-to-br from-violet-50 to-violet-100 rounded-lg p-4 border border-violet-200'>
              <div className='flex items-center gap-2 mb-3'>
                <div className='p-2 bg-violet-500 rounded-lg'>
                  <GitMerge className='w-4 h-4 text-white' />
                </div>
                <h3 className='font-semibold text-violet-900'>
                  Combine Long-Text Pairs
                </h3>
              </div>
              <p className='text-sm text-violet-800 mb-4 leading-relaxed'>
                Find consecutive scene pairs where both have a non-empty
                sentence and char count is at least the subtitle Max chars
                limit. This uses the same subtitle setting rule (charCount &gt;=
                maxChars means subtitle is skipped). Greedy left-to-right — each
                scene used at most once.
              </p>
              <p className='text-xs text-violet-700 mb-3'>
                Skipping first{' '}
                <span className='font-semibold'>
                  {Math.max(
                    0,
                    Math.floor(combineScenesSettings.skipFirstScenes),
                  )}
                </span>{' '}
                ordered scene(s) from Global Settings.
              </p>
              <button
                onClick={handleCombineNoSubtitlePairs}
                disabled={combiningNoSubtitlePairs}
                className='w-full h-12 bg-violet-500 hover:bg-violet-600 disabled:bg-violet-300 text-white font-medium rounded-lg transition-all duration-200 flex items-center justify-center gap-2 shadow-sm hover:shadow-md disabled:cursor-not-allowed'
                title='Combine consecutive pairs based on subtitle character-limit settings'
              >
                {combiningNoSubtitlePairs && (
                  <Loader2 className='w-4 h-4 animate-spin' />
                )}
                <span className='font-medium'>
                  {combiningNoSubtitlePairs
                    ? combiningNoSubtitleSceneId !== null
                      ? `Scene #${combiningNoSubtitleSceneId}`
                      : 'Processing...'
                    : 'Combine Pairs'}
                </span>
              </button>
            </div>

            {/* Concatenate Videos */}
            <div className='bg-gradient-to-br from-orange-50 to-orange-100 rounded-lg p-4 border border-orange-200'>
              <div className='flex items-center gap-2 mb-3'>
                <div className='p-2 bg-orange-500 rounded-lg'>
                  <Film className='w-4 h-4 text-white' />
                </div>
                <h3 className='font-semibold text-orange-900'>
                  Merge Scenes of a Single Video
                </h3>
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
                    : 'Merge All Scenes'}
                </span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
