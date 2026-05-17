'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { BaserowRow, getSceneById } from '@/lib/baserow-actions';
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
  type FixTtsAutoFixOptions,
  getFixTtsEligibleScenes,
  hasSceneTtsAudioForFixTts,
  isSceneFlaggedForFixTts,
  parseFixTtsStatus,
  withSceneVoiceOverride,
} from '@/utils/fixTtsBatch';
import { fetchFlaggedScenesForVideo } from '@/features/fix-tts-flagged/fetchFlaggedScenesForVideo';
import { FixFlaggedOnlyButton } from '@/components/fix-tts/FixFlaggedOnlyButton';
import { FixIntroQaButton } from '@/components/fix-tts/FixIntroQaButton';
import { playSuccessSound } from '@/utils/soundManager';
import {
  formatSceneHasTextField,
  isHasTextRecordFreshForImage,
  parseSceneHasTextField,
} from '@/utils/sceneHasText';
import { sanitizeCaptionWordTimestamps } from '@/utils/transcriptionWordCleanup';
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
  Clock,
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
    options?: FixTtsAutoFixOptions,
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

const INTRO_QA_SCENE_LIMIT = 10;
const INTRO_QA_MAX_AUDIO_ATTEMPTS = 3;

type AudioReferenceLanguageEntry = {
  language?: unknown;
  enabled?: unknown;
  isDefault?: unknown;
};

function normalizeLanguageCode(value: unknown): string {
  if (typeof value !== 'string') return '';
  return value.trim().toLowerCase();
}

export default function BatchOperations({
  data,
  onRefresh,
  refreshing = false,
  handleAutoFixMismatch,
  handleSentenceImprovement,
  handleTTSProduce,
  handleVideoGenerate,
  handleTranscribeScene,
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
  const [fittingFinalVideoDurations, setFittingFinalVideoDurations] =
    useState(false);
  const [
    runningTranscribeApplyGenerateAllScenes,
    setRunningTranscribeApplyGenerateAllScenes,
  ] = useState(false);
  const [
    transcribeApplyGenerateCurrentSceneId,
    setTranscribeApplyGenerateCurrentSceneId,
  ] = useState<number | null>(null);
  const [transcribeApplyGenerateMinChars, setTranscribeApplyGenerateMinChars] =
    useState(150);

  const [generatingAllSubtitles, setGeneratingAllSubtitles] = useState(false);
  const [generatingSubtitleSceneId, setGeneratingSubtitleSceneId] = useState<
    number | null
  >(null);
  const [calculatingFinalVideoDurations, setCalculatingFinalVideoDurations] =
    useState(false);
  const [generatingDurationSrt, setGeneratingDurationSrt] = useState(false);
  const [creatingEnSrt, setCreatingEnSrt] = useState(false);
  const [creatingDubbedEn, setCreatingDubbedEn] = useState(false);
  const [creatingDubbedFa, setCreatingDubbedFa] = useState(false);
  const [dubbingLanguage, setDubbingLanguage] = useState('fa');
  const [availableDubbingLanguages, setAvailableDubbingLanguages] = useState<
    string[]
  >(['fa']);
  const [loadingDubbingLanguages, setLoadingDubbingLanguages] = useState(false);

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
  const [fixingIntroQaScenes, setFixingIntroQaScenes] = useState(false);
  const [fixingIntroQaSceneId, setFixingIntroQaSceneId] = useState<
    number | null
  >(null);
  const [introQaSceneCount, setIntroQaSceneCount] =
    useState(INTRO_QA_SCENE_LIMIT);
  const [introQaGeneratedAudioCount, setIntroQaGeneratedAudioCount] = useState(
    INTRO_QA_MAX_AUDIO_ATTEMPTS,
  );

  const [combiningNoSubtitlePairs, setCombiningNoSubtitlePairs] =
    useState(false);
  const [combiningNoSubtitleSceneId, setCombiningNoSubtitleSceneId] = useState<
    number | null
  >(null);

  const playBatchDoneSound = () => {
    playSuccessSound();
  };

  const loadDubbedLanguages = useCallback(async () => {
    setLoadingDubbingLanguages(true);

    try {
      const response = await fetch('/api/tts-audio-references', {
        method: 'GET',
        cache: 'no-store',
      });

      if (!response.ok) {
        throw new Error(`Failed to load dubbed languages (${response.status})`);
      }

      const payload = (await response.json().catch(() => null)) as {
        entries?: unknown;
      } | null;

      const rawEntries = Array.isArray(payload?.entries)
        ? (payload.entries as AudioReferenceLanguageEntry[])
        : [];

      const enabledEntries = rawEntries.filter(
        (entry) =>
          entry && typeof entry === 'object' && entry.enabled !== false,
      );

      const uniqueLanguages = Array.from(
        new Set(
          enabledEntries
            .map((entry) => normalizeLanguageCode(entry.language))
            .filter(Boolean),
        ),
      ).sort();

      const languages = uniqueLanguages.length > 0 ? uniqueLanguages : ['fa'];
      const defaultLanguage = normalizeLanguageCode(
        enabledEntries.find((entry) => entry.isDefault === true)?.language,
      );

      setAvailableDubbingLanguages(languages);
      setDubbingLanguage((current) => {
        if (languages.includes(current)) return current;
        if (defaultLanguage && languages.includes(defaultLanguage)) {
          return defaultLanguage;
        }
        if (languages.includes('fa')) return 'fa';
        return languages[0];
      });
    } catch (error) {
      console.error(
        'Failed to load dubbed languages for Create Dubbed button:',
        error,
      );
      setAvailableDubbingLanguages(['fa']);
      setDubbingLanguage((current) => current || 'fa');
    } finally {
      setLoadingDubbingLanguages(false);
    }
  }, []);

  const isSceneFlagged = (scene: unknown): boolean => {
    if (!scene || typeof scene !== 'object') return false;

    return isSceneFlaggedForFixTts(scene as BaserowRow);
  };

  // Load settings on component mount
  useEffect(() => {
    loadSettingsFromLocalStorage();
  }, [loadSettingsFromLocalStorage]);

  useEffect(() => {
    if (!isExpanded) return;
    void loadDubbedLanguages();
  }, [isExpanded, loadDubbedLanguages]);

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
        const text = String(scene['field_6890'] ?? '').trim();
        const fixedSentenceConfirmation = String(
          scene['field_7105'] ?? '',
        ).trim();
        const alreadyFixed = Boolean(fixedSentenceConfirmation);

        return {
          scene,
          text,
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

  const parsePositiveSceneIds = (value: unknown): number[] => {
    if (!Array.isArray(value)) return [];

    const unique = new Set<number>();

    for (const entry of value) {
      const parsed = Number.parseInt(String(entry ?? ''), 10);
      if (!Number.isInteger(parsed) || parsed <= 0) continue;
      unique.add(parsed);
    }

    return [...unique];
  };

  const normalizeCaptionWordsForSeparation = (
    payload: unknown,
  ): Array<{ word: string; start: number; end: number }> => {
    if (!Array.isArray(payload)) return [];

    const rawWords = payload
      .map((item) => {
        if (!item || typeof item !== 'object') return null;
        const record = item as Record<string, unknown>;

        const word =
          typeof record.word === 'string'
            ? record.word.trim()
            : typeof record.text === 'string'
              ? record.text.trim()
              : '';

        const start =
          typeof record.start === 'number' && Number.isFinite(record.start)
            ? record.start
            : null;

        const end =
          typeof record.end === 'number' && Number.isFinite(record.end)
            ? record.end
            : start;

        if (!word || start === null || end === null) return null;

        return {
          word,
          start,
          end: Math.max(start, end),
        };
      })
      .filter(
        (
          item,
        ): item is {
          word: string;
          start: number;
          end: number;
        } => item !== null,
      );

    return sanitizeCaptionWordTimestamps(rawWords);
  };

  const parseFiniteOrderRank = (value: unknown): number | null => {
    if (typeof value === 'number' && Number.isFinite(value)) {
      return value;
    }

    if (typeof value === 'string' && value.trim()) {
      const parsed = Number(value);
      if (Number.isFinite(parsed)) {
        return parsed;
      }
    }

    return null;
  };

  const getScenesInRealOrder = (scenes: BaserowRow[]): BaserowRow[] => {
    return [...scenes].sort((a, b) => {
      const sceneOrderA =
        parseFiniteOrderRank(a['field_7104']) ??
        parseFiniteOrderRank((a as { field_7104?: unknown }).field_7104);
      const sceneOrderB =
        parseFiniteOrderRank(b['field_7104']) ??
        parseFiniteOrderRank((b as { field_7104?: unknown }).field_7104);

      if (
        sceneOrderA !== null &&
        sceneOrderB !== null &&
        sceneOrderA !== sceneOrderB
      ) {
        return sceneOrderA - sceneOrderB;
      }

      const fallbackOrderA = parseFiniteOrderRank(a.order);
      const fallbackOrderB = parseFiniteOrderRank(b.order);

      if (
        fallbackOrderA !== null &&
        fallbackOrderB !== null &&
        fallbackOrderA !== fallbackOrderB
      ) {
        return fallbackOrderA - fallbackOrderB;
      }

      return a.id - b.id;
    });
  };

  const onTranscribeApplyGenerateClipsAllScenes = async () => {
    if (runningTranscribeApplyGenerateAllScenes) return;

    const selectedVideoId = Number(selectedOriginalVideo.id);
    if (!Number.isFinite(selectedVideoId) || selectedVideoId <= 0) {
      return;
    }

    const minSentenceCharactersForBatch = Math.max(
      0,
      Number.isFinite(transcribeApplyGenerateMinChars)
        ? Math.floor(transcribeApplyGenerateMinChars)
        : 0,
    );

    const scenesInRealOrder = getScenesInRealOrder(data).filter((scene) => {
      const sceneId = Number(scene.id);
      return Number.isInteger(sceneId) && sceneId > 0;
    });

    if (scenesInRealOrder.length === 0) {
      playBatchDoneSound();
      return;
    }

    const transcribeSceneWithOptions = handleTranscribeScene as unknown as (
      sceneId: number,
      sceneData?: BaserowRow,
      videoType?: 'original' | 'final',
      skipRefresh?: boolean,
      skipSound?: boolean,
      updateSentence?: boolean,
      opts?: {
        throwOnError?: boolean;
        captionsFieldKey?: string;
      },
    ) => Promise<void>;

    setRunningTranscribeApplyGenerateAllScenes(true);
    setTranscribeApplyGenerateCurrentSceneId(null);

    try {
      for (const scene of scenesInRealOrder) {
        const sceneId = Number(scene.id);
        if (!Number.isInteger(sceneId) || sceneId <= 0) {
          continue;
        }

        setTranscribeApplyGenerateCurrentSceneId(sceneId);

        try {
          const targetScene = (await getSceneById(sceneId)) || scene;
          const sentenceText = String(targetScene?.['field_6890'] ?? '').trim();
          const existingOriginalCaptionsUrl = String(
            targetScene?.['field_7120'] ?? '',
          ).trim();

          if (!sentenceText) {
            console.info(
              `[Batch] Scene ${sceneId}: skipping because Sentence (field_6890) is empty.`,
            );
            continue;
          }

          if (sentenceText.length < minSentenceCharactersForBatch) {
            console.info(
              `[Batch] Scene ${sceneId}: skipping because Sentence (field_6890) length (${sentenceText.length}) is below minimum (${minSentenceCharactersForBatch}).`,
            );
            continue;
          }

          if (existingOriginalCaptionsUrl) {
            console.info(
              `[Batch] Scene ${sceneId}: skipping because Original Video Caption for Scene (field_7120) already exists.`,
            );
            continue;
          }

          await transcribeSceneWithOptions(
            sceneId,
            targetScene,
            'original',
            true,
            true,
            false,
            { captionsFieldKey: 'field_7120', throwOnError: true },
          );

          const refreshedScene = (await getSceneById(sceneId)) || targetScene;
          const captionsUrl = String(refreshedScene?.field_7120 || '').trim();

          if (!captionsUrl) {
            console.warn(
              `[Batch] Scene ${sceneId}: missing original captions URL (field_7120). Skipping separation.`,
            );
            continue;
          }

          const captionsResponse = await fetch(withCacheBust(captionsUrl), {
            cache: 'no-store',
          });

          if (!captionsResponse.ok) {
            const errorText = await captionsResponse.text().catch(() => '');
            throw new Error(
              `Failed to load original captions for scene ${sceneId} (${captionsResponse.status}) ${errorText}`,
            );
          }

          const captionsPayload = (await captionsResponse
            .json()
            .catch(() => null)) as unknown;
          const editedWords =
            normalizeCaptionWordsForSeparation(captionsPayload);

          if (!editedWords.length) {
            console.warn(
              `[Batch] Scene ${sceneId}: transcription produced no usable timed words. Skipping separation.`,
            );
            continue;
          }

          const separationResponse = await fetch('/api/separate-scene', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              sceneId,
              editedWords,
            }),
          });

          const separationPayload = (await separationResponse
            .json()
            .catch(() => null)) as {
            error?: unknown;
            createdSceneIds?: unknown;
            skippedNoSplit?: unknown;
          } | null;

          if (!separationResponse.ok) {
            const message =
              typeof separationPayload?.error === 'string'
                ? separationPayload.error
                : `Failed to separate scene ${sceneId} (${separationResponse.status})`;
            throw new Error(message);
          }

          const skippedNoSplit = separationPayload?.skippedNoSplit === true;
          if (skippedNoSplit) {
            console.info(
              `[Batch] Scene ${sceneId}: split skipped because transcription did not create additional scenes.`,
            );
            continue;
          }

          const createdSceneIds = parsePositiveSceneIds(
            separationPayload?.createdSceneIds,
          );
          const clipSceneIds = parsePositiveSceneIds([
            sceneId,
            ...createdSceneIds,
          ]);

          for (const clipSceneId of clipSceneIds) {
            const clipScene = await getSceneById(clipSceneId);
            if (!clipScene) {
              console.warn(
                `[Batch] Scene ${clipSceneId}: not found before clip generation. Skipping clip.`,
              );
              continue;
            }

            const clipVideoId = extractLinkedVideoIdFromScene(clipScene);
            const clipPayload: Record<string, unknown> = {
              sceneId: clipSceneId,
            };

            if (clipVideoId !== null) {
              clipPayload.videoId = clipVideoId;
            }

            const clipResponse = await fetch('/api/generate-single-clip', {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
              },
              body: JSON.stringify(clipPayload),
            });

            if (!clipResponse.ok) {
              const clipErrorText = await clipResponse.text().catch(() => '');
              throw new Error(
                `Failed to generate clip for scene ${clipSceneId} (${clipResponse.status}) ${clipErrorText}`,
              );
            }

            await clipResponse.json().catch(() => null);
            await new Promise((resolve) => setTimeout(resolve, 150));
          }
        } catch (sceneError) {
          console.error(
            `[Batch] Transcribe + Apply + Gen Clips failed for scene ${sceneId}:`,
            sceneError,
          );
        }

        await new Promise((resolve) => setTimeout(resolve, 250));
      }

      onRefresh?.();
      playBatchDoneSound();
    } finally {
      setRunningTranscribeApplyGenerateAllScenes(false);
      setTranscribeApplyGenerateCurrentSceneId(null);
    }
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

  const onFixIntroQaFinalTTS = async () => {
    // Intro-only QA flow:
    // - non-empty sentence scenes only (field_6890)
    // - include the first non-empty sentence scene
    // - then take the first configured intro scene count
    // - ignore confirmed scenes
    // - check existing TTS first; if pass, do sentence check only
    // - if existing fails/missing, generate up to configured audios
    // - if all generated audios fail, choose the best generated attempt
    // - sync/transcribe exactly once for selected generated audio, then sentence-check once
    // - flag with audio reason, and append sentence reason when sentence check fails
    if (!selectedOriginalVideo.id || fixingIntroQaScenes) return;

    const configuredIntroQaSceneCount = Math.max(
      1,
      Number.isFinite(introQaSceneCount)
        ? Math.floor(introQaSceneCount)
        : INTRO_QA_SCENE_LIMIT,
    );
    const configuredIntroQaGeneratedAudioCount = Math.max(
      1,
      Number.isFinite(introQaGeneratedAudioCount)
        ? Math.floor(introQaGeneratedAudioCount)
        : INTRO_QA_MAX_AUDIO_ATTEMPTS,
    );

    const voiceOverride =
      typeof selectedOriginalVideo.ttsVoiceReference === 'string' &&
      selectedOriginalVideo.ttsVoiceReference.trim().length > 0
        ? selectedOriginalVideo.ttsVoiceReference.trim()
        : null;

    type IntroAudioAttempt = {
      attemptNumber: number;
      source: 'existing' | 'generated';
      audioUrl: string;
      pass: boolean;
      reason: string;
      leadingSilenceSec: number | null;
      maxLeadingSilenceSec: number | null;
      maxInternalPauseSec: number | null;
      maxAllowedInternalPauseSec: number | null;
      leadingSilenceSecWithFilter: number | null;
      maxLeadingSilenceSecWithFilter: number | null;
      leadingSilenceSecWithoutFilter: number | null;
      maxLeadingSilenceSecWithoutFilter: number | null;
      maxInternalPauseSecWithFilter: number | null;
      maxAllowedInternalPauseSecWithFilter: number | null;
      maxInternalPauseSecWithoutFilter: number | null;
      maxAllowedInternalPauseSecWithoutFilter: number | null;
    };

    const introScenes = [...data]
      .sort((a, b) => (Number(a.order) || 0) - (Number(b.order) || 0))
      .filter((scene) => String(scene['field_6890'] ?? '').trim().length > 0)
      .slice(0, configuredIntroQaSceneCount);

    const scenesToFix = getFixTtsEligibleScenes(introScenes);

    if (scenesToFix.length === 0) {
      console.log(
        `No intro scenes (first ${configuredIntroQaSceneCount} non-empty sentence scenes) with final video + text found to fix.`,
      );
      return;
    }

    const ttsProduceWithOptions = handleTTSProduce as unknown as (
      sceneId: number,
      text: string,
      sceneData?: BaserowRow,
      opts?: {
        seedOverride?: number;
        throwOnError?: boolean;
        skipAutoSyncAfterTtsGeneration?: boolean;
        suppressRefreshes?: boolean;
      },
    ) => Promise<void>;

    const videoGenerateWithOptions = handleVideoGenerate as unknown as (
      sceneId: number,
      videoUrl: string,
      audioUrl: string,
      sceneData?: BaserowRow,
      zoomLevel?: number,
      panMode?: 'none' | 'zoom' | 'zoomOut' | 'topToBottom',
      opts?: { throwOnError?: boolean; suppressRefreshes?: boolean },
    ) => Promise<void>;

    const transcribeSceneWithOptions = handleTranscribeScene as unknown as (
      sceneId: number,
      sceneData?: BaserowRow,
      videoType?: 'original' | 'final',
      skipRefresh?: boolean,
      skipSound?: boolean,
      updateSentence?: boolean,
      opts?: { throwOnError?: boolean },
    ) => Promise<void>;

    const extractAudioUrl = (raw: unknown): string => {
      if (typeof raw === 'string') return raw.trim();

      if (Array.isArray(raw)) {
        for (const item of raw) {
          const url = extractAudioUrl(item);
          if (url) return url;
        }
        return '';
      }

      if (raw && typeof raw === 'object') {
        const obj = raw as Record<string, unknown>;
        const nestedFile =
          obj.file && typeof obj.file === 'object'
            ? (obj.file as Record<string, unknown>)
            : null;

        const candidates = [
          obj.url,
          obj.value,
          obj.name,
          obj.text,
          nestedFile?.url,
        ];

        for (const candidate of candidates) {
          if (typeof candidate === 'string' && candidate.trim().length > 0) {
            return candidate.trim();
          }
        }
      }

      return '';
    };

    const toNumberOrNull = (value: unknown): number | null => {
      if (typeof value === 'number' && Number.isFinite(value)) {
        return value;
      }

      if (typeof value === 'string' && value.trim()) {
        const parsed = Number(value);
        return Number.isFinite(parsed) ? parsed : null;
      }

      return null;
    };

    const formatLeadSeconds = (value: number | null): string => {
      return value !== null ? `${value.toFixed(3)}s` : 'n/a';
    };

    const formatAttemptBeginGapPair = (attempt: IntroAudioAttempt): string => {
      return `raw=${formatLeadSeconds(attempt.leadingSilenceSecWithoutFilter)}, filtered=${formatLeadSeconds(attempt.leadingSilenceSecWithFilter)}`;
    };

    const formatAttemptMiddleGapPair = (attempt: IntroAudioAttempt): string => {
      return `raw=${formatLeadSeconds(attempt.maxInternalPauseSecWithoutFilter)}, filtered=${formatLeadSeconds(attempt.maxInternalPauseSecWithFilter)}`;
    };

    const formatAttemptGapDetails = (attempt: IntroAudioAttempt): string => {
      return `begin(${formatAttemptBeginGapPair(attempt)}), middle(${formatAttemptMiddleGapPair(attempt)})`;
    };

    const normalizeSentenceForCompare = (value: string): string => {
      return String(value || '')
        .toLowerCase()
        .replace(/[’']/g, '')
        .replace(/[^a-z0-9\s]+/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
    };

    const compactSentenceForCompare = (value: string): string => {
      return String(value || '')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '')
        .trim();
    };

    const summarizeFailedWords = (tokens: string[]): string => {
      if (tokens.length === 0) return 'n/a';
      const maxItems = 8;
      const shown = tokens.slice(0, maxItems).join(', ');
      const more = tokens.length - maxItems;
      return more > 0 ? `${shown} (+${more} more)` : shown;
    };

    const buildIntroGapFailureReason = (attempt: IntroAudioAttempt): string => {
      const beginSec =
        attempt.leadingSilenceSecWithFilter ?? attempt.leadingSilenceSec;
      const beginMax =
        attempt.maxLeadingSilenceSecWithFilter ??
        attempt.maxLeadingSilenceSec ??
        0.4;
      const middleSec =
        attempt.maxInternalPauseSecWithFilter ?? attempt.maxInternalPauseSec;
      const middleMax =
        attempt.maxAllowedInternalPauseSecWithFilter ??
        attempt.maxAllowedInternalPauseSec ??
        0.4;

      const failedParts: string[] = [];
      if (beginSec !== null && beginSec > beginMax) {
        failedParts.push(`Failed Begin ${beginSec.toFixed(3)}s`);
      }
      if (middleSec !== null && middleSec > middleMax) {
        failedParts.push(`Failed Middle ${middleSec.toFixed(3)}s`);
      }

      return failedParts.join(' | ');
    };

    const buildWordLevelMismatchReason = (
      expectedNormalized: string,
      transcriptNormalized: string,
      transcriptRaw: string,
    ): string => {
      const tokenize = (text: string) =>
        String(text || '')
          .split(' ')
          .map((token) => token.trim())
          .filter(Boolean);

      const toCountMap = (tokens: string[]) => {
        const counts = new Map<string, number>();
        for (const token of tokens) {
          counts.set(token, (counts.get(token) ?? 0) + 1);
        }
        return counts;
      };

      const diffTokens = (
        base: Map<string, number>,
        other: Map<string, number>,
      ): string[] => {
        const out: string[] = [];
        for (const [token, baseCount] of base.entries()) {
          const delta = baseCount - (other.get(token) ?? 0);
          for (let i = 0; i < delta; i += 1) {
            out.push(token);
          }
        }
        return out;
      };

      const expectedTokens = tokenize(expectedNormalized);
      const transcriptTokens = tokenize(transcriptNormalized);
      const expectedMap = toCountMap(expectedTokens);
      const transcriptMap = toCountMap(transcriptTokens);

      const expectedOnly = diffTokens(expectedMap, transcriptMap);
      const transcriptOnly = diffTokens(transcriptMap, expectedMap);

      const transcriptDisplay =
        String(transcriptRaw || '').trim() || transcriptNormalized || 'n/a';

      if (expectedOnly.length === 0 && transcriptOnly.length === 0) {
        return `Failed Words: n/a | transcribed: ${transcriptDisplay}.`;
      }

      const failedWords =
        expectedOnly.length > 0 ? expectedOnly : transcriptOnly;

      return `Failed Words: ${summarizeFailedWords(failedWords)} | transcribed: ${transcriptDisplay}.`;
    };

    const compareSentencesOnce = (
      expectedRaw: string,
      transcriptRaw: string,
    ): { pass: boolean; reason: string } => {
      const expected = normalizeSentenceForCompare(expectedRaw);
      const transcript = normalizeSentenceForCompare(transcriptRaw);

      if (!expected) {
        const transcriptDisplay = String(transcriptRaw || '').trim() || 'n/a';
        return {
          pass: false,
          reason: `Failed Words: expected text empty | transcribed: ${transcriptDisplay}.`,
        };
      }

      if (!transcript) {
        return {
          pass: false,
          reason: 'Failed Words: n/a | transcribed: (empty).',
        };
      }

      if (expected === transcript) {
        return { pass: true, reason: '' };
      }

      const expectedCompact = compactSentenceForCompare(expected);
      const transcriptCompact = compactSentenceForCompare(transcript);
      if (
        expectedCompact &&
        transcriptCompact &&
        expectedCompact === transcriptCompact
      ) {
        return { pass: true, reason: '' };
      }

      return {
        pass: false,
        reason: buildWordLevelMismatchReason(
          expected,
          transcript,
          transcriptRaw,
        ),
      };
    };

    const generateRandomSeed = (): number => {
      const maxSeed = 2_147_483_647;
      try {
        if (typeof crypto !== 'undefined' && crypto.getRandomValues) {
          const buf = new Uint32Array(1);
          crypto.getRandomValues(buf);
          const raw = Number(buf[0] || 0);
          return Math.max(1, raw % maxSeed);
        }
      } catch {
        // fallback below
      }

      return Math.max(1, Math.floor(Math.random() * maxSeed));
    };

    const markSceneFlagged = async (
      sceneId: number,
      reason: string,
      _diagnostics?: string | null,
    ) => {
      void _diagnostics;
      const normalizedReason = String(reason || '')
        .trim()
        .slice(0, 1000);

      const latest = await fetchFreshScene(sceneId);
      if (latest && parseFixTtsStatus(latest['field_7096']) === 'confirmed') {
        return;
      }

      try {
        const res = await fetch(`/api/baserow/scenes/${sceneId}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            field_7096: 'true',
            field_7106: normalizedReason,
          }),
        });

        if (!res.ok) {
          const t = await res.text().catch(() => '');
          console.warn(
            `Failed to mark intro QA flag for scene ${sceneId}: ${res.status} ${t}`,
          );
        }
      } catch (error) {
        console.warn(
          `Failed to mark intro QA flag for scene ${sceneId}:`,
          error,
        );
      }
    };

    const clearSceneFlagged = async (
      sceneId: number,
      _diagnostics?: string | null,
    ) => {
      void _diagnostics;
      const latest = await fetchFreshScene(sceneId);
      if (latest && parseFixTtsStatus(latest['field_7096']) === 'confirmed') {
        return;
      }

      try {
        const res = await fetch(`/api/baserow/scenes/${sceneId}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            field_7096: null,
            field_7106: '',
          }),
        });

        if (!res.ok) {
          const t = await res.text().catch(() => '');
          console.warn(
            `Failed to clear intro QA flag for scene ${sceneId}: ${res.status} ${t}`,
          );
        }
      } catch (error) {
        console.warn(
          `Failed to clear intro QA flag for scene ${sceneId}:`,
          error,
        );
      }
    };

    const setSceneAudioUrl = async (sceneId: number, audioUrl: string) => {
      const normalizedAudioUrl = String(audioUrl || '').trim();
      if (!normalizedAudioUrl) return;

      await fetch(`/api/baserow/scenes/${sceneId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ field_6891: normalizedAudioUrl }),
      }).catch(() => {
        // best effort; sync step below still uses selected URL directly
      });
    };

    const sleep = (ms: number) =>
      new Promise<void>((resolve) => setTimeout(resolve, ms));

    const buildIntroQaDiagnosticsSummary = (
      existingAttempt: IntroAudioAttempt | null,
      generatedAttempts: IntroAudioAttempt[],
    ): string => {
      const parts: string[] = [];

      if (existingAttempt) {
        parts.push(
          `existing(${formatAttemptGapDetails(existingAttempt)}, pass=${existingAttempt.pass})`,
        );
      } else {
        parts.push(
          'existing(begin(raw=n/a, filtered=n/a), middle(raw=n/a, filtered=n/a), pass=n/a)',
        );
      }

      for (const attempt of generatedAttempts) {
        parts.push(
          `gen#${attempt.attemptNumber}(${formatAttemptGapDetails(attempt)}, pass=${attempt.pass})`,
        );
      }

      return `Intro QA attempts: ${parts.join('; ')}`;
    };

    const runIntroLeadingSilenceCheck = async (
      sceneId: number,
      audioUrl: string,
      attemptNumber: number,
      source: 'existing' | 'generated',
    ): Promise<IntroAudioAttempt> => {
      const normalizedAudioUrl = String(audioUrl || '').trim();

      if (!normalizedAudioUrl) {
        return {
          attemptNumber,
          source,
          audioUrl: '',
          pass: false,
          reason: `Audio attempt ${attemptNumber} (${source}) failed: missing TTS audio URL.`,
          leadingSilenceSec: null,
          maxLeadingSilenceSec: null,
          maxInternalPauseSec: null,
          maxAllowedInternalPauseSec: null,
          leadingSilenceSecWithFilter: null,
          maxLeadingSilenceSecWithFilter: null,
          leadingSilenceSecWithoutFilter: null,
          maxLeadingSilenceSecWithoutFilter: null,
          maxInternalPauseSecWithFilter: null,
          maxAllowedInternalPauseSecWithFilter: null,
          maxInternalPauseSecWithoutFilter: null,
          maxAllowedInternalPauseSecWithoutFilter: null,
        };
      }

      try {
        type IntroQaMeasurement = {
          ok: boolean;
          pass: boolean;
          leadingSilenceSec: number | null;
          maxLeadingSilenceSec: number | null;
          maxInternalPauseSec: number | null;
          maxAllowedInternalPauseSec: number | null;
          error: string | null;
        };

        const runMeasurement = async (
          preprocessAudioBeforeMeasurement: boolean,
        ): Promise<IntroQaMeasurement> => {
          const qaRes = await fetch('/api/fix-tts-intro-silence-check', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              sceneId,
              audioUrl: normalizedAudioUrl,
              maxLeadingSilenceSec: 0.4,
              maxInternalPauseSec: 0.4,
              maxSilenceRatio: 1,
              preprocessAudioBeforeMeasurement,
            }),
          });

          const payload = (await qaRes.json().catch(() => null)) as {
            pass?: unknown;
            error?: unknown;
            metrics?: {
              leadingSilenceSec?: unknown;
              maxInternalPauseSec?: unknown;
            };
            thresholds?: {
              maxLeadingSilenceSec?: unknown;
              maxInternalPauseSec?: unknown;
            };
          } | null;

          const leadingSilenceSec = toNumberOrNull(
            payload?.metrics?.leadingSilenceSec,
          );
          const maxLeadingSilenceSec = toNumberOrNull(
            payload?.thresholds?.maxLeadingSilenceSec,
          );
          const maxInternalPauseSec = toNumberOrNull(
            payload?.metrics?.maxInternalPauseSec,
          );
          const maxAllowedInternalPauseSec = toNumberOrNull(
            payload?.thresholds?.maxInternalPauseSec,
          );

          if (!qaRes.ok) {
            const qaError =
              typeof payload?.error === 'string' && payload.error.trim()
                ? payload.error.trim()
                : `QA endpoint failed (${qaRes.status})`;

            return {
              ok: false,
              pass: false,
              leadingSilenceSec,
              maxLeadingSilenceSec,
              maxInternalPauseSec,
              maxAllowedInternalPauseSec,
              error: qaError,
            };
          }

          return {
            ok: true,
            pass: payload?.pass === true,
            leadingSilenceSec,
            maxLeadingSilenceSec,
            maxInternalPauseSec,
            maxAllowedInternalPauseSec,
            error: null,
          };
        };

        const withoutFilter = await runMeasurement(false);
        const withFilter = await runMeasurement(true);

        const effective = withFilter.ok ? withFilter : withoutFilter;

        if (!effective.ok) {
          const combinedError = [withFilter.error, withoutFilter.error]
            .filter((item): item is string => Boolean(item))
            .join(' | ');

          return {
            attemptNumber,
            source,
            audioUrl: normalizedAudioUrl,
            pass: false,
            reason: `Audio attempt ${attemptNumber} (${source}) failed: ${combinedError || 'QA checks failed for both filtered and raw measurements.'}`,
            leadingSilenceSec: null,
            maxLeadingSilenceSec: null,
            maxInternalPauseSec: null,
            maxAllowedInternalPauseSec: null,
            leadingSilenceSecWithFilter: withFilter.leadingSilenceSec,
            maxLeadingSilenceSecWithFilter: withFilter.maxLeadingSilenceSec,
            leadingSilenceSecWithoutFilter: withoutFilter.leadingSilenceSec,
            maxLeadingSilenceSecWithoutFilter:
              withoutFilter.maxLeadingSilenceSec,
            maxInternalPauseSecWithFilter: withFilter.maxInternalPauseSec,
            maxAllowedInternalPauseSecWithFilter:
              withFilter.maxAllowedInternalPauseSec,
            maxInternalPauseSecWithoutFilter: withoutFilter.maxInternalPauseSec,
            maxAllowedInternalPauseSecWithoutFilter:
              withoutFilter.maxAllowedInternalPauseSec,
          };
        }

        const pass = effective.pass;
        const maxLeadToDisplay =
          withFilter.maxLeadingSilenceSec ??
          withoutFilter.maxLeadingSilenceSec ??
          effective.maxLeadingSilenceSec;
        const maxMiddleToDisplay =
          withFilter.maxAllowedInternalPauseSec ??
          withoutFilter.maxAllowedInternalPauseSec ??
          effective.maxAllowedInternalPauseSec;

        const beginRaw = formatLeadSeconds(withoutFilter.leadingSilenceSec);
        const beginFiltered = formatLeadSeconds(withFilter.leadingSilenceSec);
        const middleRaw = formatLeadSeconds(withoutFilter.maxInternalPauseSec);
        const middleFiltered = formatLeadSeconds(
          withFilter.maxInternalPauseSec,
        );

        console.info(
          `[Fix Intro QA] scene ${sceneId} ${source} attempt ${attemptNumber} checks: begin(raw=${beginRaw}, filtered=${beginFiltered}, max=${formatLeadSeconds(maxLeadToDisplay)}), middle(raw=${middleRaw}, filtered=${middleFiltered}, max=${formatLeadSeconds(maxMiddleToDisplay)}), selected=${withFilter.ok ? 'filtered' : 'raw'}, pass=${pass}`,
        );

        const reason = pass
          ? ''
          : buildIntroGapFailureReason({
              attemptNumber,
              source,
              audioUrl: normalizedAudioUrl,
              pass,
              reason: '',
              leadingSilenceSec: effective.leadingSilenceSec,
              maxLeadingSilenceSec: effective.maxLeadingSilenceSec,
              maxInternalPauseSec: effective.maxInternalPauseSec,
              maxAllowedInternalPauseSec: effective.maxAllowedInternalPauseSec,
              leadingSilenceSecWithFilter: withFilter.leadingSilenceSec,
              maxLeadingSilenceSecWithFilter: withFilter.maxLeadingSilenceSec,
              leadingSilenceSecWithoutFilter: withoutFilter.leadingSilenceSec,
              maxLeadingSilenceSecWithoutFilter:
                withoutFilter.maxLeadingSilenceSec,
              maxInternalPauseSecWithFilter: withFilter.maxInternalPauseSec,
              maxAllowedInternalPauseSecWithFilter:
                withFilter.maxAllowedInternalPauseSec,
              maxInternalPauseSecWithoutFilter:
                withoutFilter.maxInternalPauseSec,
              maxAllowedInternalPauseSecWithoutFilter:
                withoutFilter.maxAllowedInternalPauseSec,
            }) || 'Intro audio QA failed.';

        return {
          attemptNumber,
          source,
          audioUrl: normalizedAudioUrl,
          pass,
          reason,
          leadingSilenceSec: effective.leadingSilenceSec,
          maxLeadingSilenceSec: effective.maxLeadingSilenceSec,
          maxInternalPauseSec: effective.maxInternalPauseSec,
          maxAllowedInternalPauseSec: effective.maxAllowedInternalPauseSec,
          leadingSilenceSecWithFilter: withFilter.leadingSilenceSec,
          maxLeadingSilenceSecWithFilter: withFilter.maxLeadingSilenceSec,
          leadingSilenceSecWithoutFilter: withoutFilter.leadingSilenceSec,
          maxLeadingSilenceSecWithoutFilter: withoutFilter.maxLeadingSilenceSec,
          maxInternalPauseSecWithFilter: withFilter.maxInternalPauseSec,
          maxAllowedInternalPauseSecWithFilter:
            withFilter.maxAllowedInternalPauseSec,
          maxInternalPauseSecWithoutFilter: withoutFilter.maxInternalPauseSec,
          maxAllowedInternalPauseSecWithoutFilter:
            withoutFilter.maxAllowedInternalPauseSec,
        };
      } catch (error) {
        return {
          attemptNumber,
          source,
          audioUrl: normalizedAudioUrl,
          pass: false,
          reason: `Audio attempt ${attemptNumber} (${source}) QA error: ${error instanceof Error ? error.message : 'Unknown error'}`,
          leadingSilenceSec: null,
          maxLeadingSilenceSec: null,
          maxInternalPauseSec: null,
          maxAllowedInternalPauseSec: null,
          leadingSilenceSecWithFilter: null,
          maxLeadingSilenceSecWithFilter: null,
          leadingSilenceSecWithoutFilter: null,
          maxLeadingSilenceSecWithoutFilter: null,
          maxInternalPauseSecWithFilter: null,
          maxAllowedInternalPauseSecWithFilter: null,
          maxInternalPauseSecWithoutFilter: null,
          maxAllowedInternalPauseSecWithoutFilter: null,
        };
      }
    };

    const pickBestAudioAttempt = (
      attempts: IntroAudioAttempt[],
    ): IntroAudioAttempt | null => {
      const attemptsWithAudio = attempts.filter((item) => item.audioUrl);
      if (attemptsWithAudio.length === 0) return null;

      const toSafeGap = (value: number | null): number =>
        value !== null ? value : Number.POSITIVE_INFINITY;

      const ranked = [...attemptsWithAudio].sort((a, b) => {
        const aBegin = toSafeGap(a.leadingSilenceSec);
        const aMiddle = toSafeGap(a.maxInternalPauseSec);
        const bBegin = toSafeGap(b.leadingSilenceSec);
        const bMiddle = toSafeGap(b.maxInternalPauseSec);

        const aWorst = Math.max(aBegin, aMiddle);
        const bWorst = Math.max(bBegin, bMiddle);
        if (aWorst !== bWorst) return aWorst - bWorst;

        if (aBegin !== bBegin) return aBegin - bBegin;
        if (aMiddle !== bMiddle) return aMiddle - bMiddle;

        return a.attemptNumber - b.attemptNumber;
      });

      return ranked[0] ?? attemptsWithAudio[attemptsWithAudio.length - 1];
    };

    const buildAllGeneratedAttemptsFailureReason = (
      attempts: IntroAudioAttempt[],
      selectedAttempt: IntroAudioAttempt | null,
      existingAttempt?: IntroAudioAttempt | null,
      existingCheckSummary?: string | null,
    ): string => {
      if (selectedAttempt?.reason?.trim()) {
        return selectedAttempt.reason.trim();
      }

      const firstGeneratedFailure = attempts.find((attempt) =>
        Boolean(attempt.reason?.trim()),
      );
      if (firstGeneratedFailure?.reason?.trim()) {
        return firstGeneratedFailure.reason.trim();
      }

      if (existingAttempt?.reason?.trim()) {
        return existingAttempt.reason.trim();
      }

      if (existingCheckSummary?.trim()) {
        return existingCheckSummary.trim();
      }

      return 'Intro audio QA failed.';
    };

    const waitForCaptionsUrl = async (
      sceneId: number,
      opts?: {
        previousUrl?: string;
        requireChanged?: boolean;
        maxRetries?: number;
        delayMs?: number;
      },
    ): Promise<string> => {
      const previous = String(opts?.previousUrl || '').trim();
      const requireChanged = opts?.requireChanged === true;
      const maxRetries = opts?.maxRetries ?? 20;
      const delayMs = opts?.delayMs ?? 300;

      for (let i = 0; i < maxRetries; i += 1) {
        const fresh = await fetchFreshScene(sceneId);
        const captionsUrl = extractAudioUrl(fresh?.['field_6910']);
        if (!captionsUrl) {
          await sleep(delayMs);
          continue;
        }

        if (requireChanged && previous && captionsUrl === previous) {
          await sleep(delayMs);
          continue;
        }

        if (captionsUrl) {
          return captionsUrl;
        }
        await sleep(delayMs);
      }

      return '';
    };

    const waitForAudioUrlChange = async (
      sceneId: number,
      previousAudioUrl?: string,
      maxRetries = 20,
      delayMs = 250,
    ): Promise<string> => {
      const previous = String(previousAudioUrl || '').trim();

      for (let i = 0; i < maxRetries; i += 1) {
        const fresh = await fetchFreshScene(sceneId);
        const audioUrl = extractAudioUrl(fresh?.['field_6891']);
        if (audioUrl && (!previous || audioUrl !== previous)) {
          return audioUrl;
        }
        await sleep(delayMs);
      }

      return '';
    };

    const fetchTranscriptFromCaptions = async (
      captionsUrl: string,
    ): Promise<string> => {
      const normalizedUrl = String(captionsUrl || '').trim();
      if (!normalizedUrl) return '';

      try {
        const capRes = await fetch(withCacheBust(normalizedUrl), {
          cache: 'no-store',
        });
        if (!capRes.ok) return '';

        const words = (await capRes.json().catch(() => null)) as unknown;
        if (!Array.isArray(words)) return '';

        return words
          .map((word) => {
            if (!word || typeof word !== 'object') return '';
            const token = (word as { word?: unknown }).word;
            return typeof token === 'string' ? token.trim() : '';
          })
          .filter(Boolean)
          .join(' ')
          .trim();
      } catch {
        return '';
      }
    };

    const waitForTranscriptFromCaptions = async (
      captionsUrl: string,
      maxRetries = 20,
      delayMs = 300,
    ): Promise<string> => {
      const normalizedUrl = String(captionsUrl || '').trim();
      if (!normalizedUrl) return '';

      for (let i = 0; i < maxRetries; i += 1) {
        const transcript = await fetchTranscriptFromCaptions(normalizedUrl);
        if (transcript) return transcript;
        await sleep(delayMs);
      }

      return '';
    };

    const fetchFreshScene = async (
      sceneId: number,
    ): Promise<BaserowRow | null> => {
      try {
        const row = await getSceneById(sceneId);
        if (!row || typeof row !== 'object') return null;
        return row;
      } catch {
        return null;
      }
    };

    setFixingIntroQaScenes(true);
    setFixingIntroQaSceneId(null);

    try {
      for (const scene of scenesToFix) {
        setFixingIntroQaSceneId(scene.id);
        let introQaDiagnostics: string | null = null;

        try {
          const sceneWithVoiceOverride = withSceneVoiceOverride(
            scene,
            voiceOverride,
          );

          const latestBeforeAttempts =
            (await fetchFreshScene(scene.id)) || sceneWithVoiceOverride;
          if (
            parseFixTtsStatus(latestBeforeAttempts['field_7096']) ===
            'confirmed'
          ) {
            continue;
          }

          const desiredText = String(
            latestBeforeAttempts['field_6890'] ??
              sceneWithVoiceOverride['field_6890'] ??
              '',
          ).trim();
          if (!desiredText) {
            await markSceneFlagged(
              scene.id,
              'Intro QA failed: missing scene text (field_6890).',
            );
            continue;
          }

          const generatedAttempts: IntroAudioAttempt[] = [];
          let existingAttempt: IntroAudioAttempt | null = null;
          let selectedAudioAttempt: IntroAudioAttempt | null = null;
          let existingCheckSummary: string | null = null;

          const hasExistingTtsValue =
            hasSceneTtsAudioForFixTts(latestBeforeAttempts);
          const existingAudioUrl = extractAudioUrl(
            latestBeforeAttempts['field_6891'],
          );
          if (existingAudioUrl) {
            existingAttempt = await runIntroLeadingSilenceCheck(
              scene.id,
              existingAudioUrl,
              1,
              'existing',
            );

            existingCheckSummary = existingAttempt.reason || '';

            const existingFilteredBegin = formatLeadSeconds(
              existingAttempt.leadingSilenceSecWithFilter ??
                existingAttempt.leadingSilenceSec,
            );
            const existingFilteredMiddle = formatLeadSeconds(
              existingAttempt.maxInternalPauseSecWithFilter ??
                existingAttempt.maxInternalPauseSec,
            );

            console.log(
              `[Fix Intro QA] scene ${scene.id} existing audio checks: begin(filtered=${existingFilteredBegin}), middle(filtered=${existingFilteredMiddle}), pass=${existingAttempt.pass}`,
            );

            if (existingAttempt.pass) {
              selectedAudioAttempt = existingAttempt;
            }
          } else if (hasExistingTtsValue) {
            existingCheckSummary =
              'Existing TTS detected in field_6891 but URL was not parseable for intro QA.';
            console.warn(
              `[Fix Intro QA] scene ${scene.id} has existing field_6891 data, but no parseable audio URL was extracted.`,
              latestBeforeAttempts['field_6891'],
            );
          } else {
            existingCheckSummary = 'No existing TTS audio in field_6891.';
            console.log(
              `[Fix Intro QA] scene ${scene.id} has no existing TTS audio (field_6891).`,
            );
          }

          if (!selectedAudioAttempt) {
            for (
              let generatedAttemptNumber = 1;
              generatedAttemptNumber <= configuredIntroQaGeneratedAudioCount;
              generatedAttemptNumber += 1
            ) {
              const beforeGenerate = await fetchFreshScene(scene.id);
              const previousAudioUrl = extractAudioUrl(
                beforeGenerate?.['field_6891'],
              );

              const seed = generateRandomSeed();

              await ttsProduceWithOptions(
                scene.id,
                desiredText,
                sceneWithVoiceOverride,
                {
                  seedOverride: seed,
                  throwOnError: true,
                  skipAutoSyncAfterTtsGeneration: true,
                  suppressRefreshes: true,
                },
              );

              const producedAudioUrl =
                (await waitForAudioUrlChange(
                  scene.id,
                  previousAudioUrl,
                  20,
                  250,
                )) ||
                extractAudioUrl(
                  (await fetchFreshScene(scene.id))?.['field_6891'],
                );

              const checkedGenerated = await runIntroLeadingSilenceCheck(
                scene.id,
                producedAudioUrl,
                generatedAttemptNumber,
                'generated',
              );
              generatedAttempts.push(checkedGenerated);

              if (checkedGenerated.pass) {
                selectedAudioAttempt = checkedGenerated;
                break;
              }
            }
          }

          const allGeneratedFailed =
            selectedAudioAttempt === null && generatedAttempts.length > 0;

          introQaDiagnostics = buildIntroQaDiagnosticsSummary(
            existingAttempt,
            generatedAttempts,
          );

          if (!selectedAudioAttempt) {
            const competitionAttempts: IntroAudioAttempt[] = [
              ...(existingAttempt ? [existingAttempt] : []),
              ...generatedAttempts,
            ];

            selectedAudioAttempt = pickBestAudioAttempt(competitionAttempts);

            if (selectedAudioAttempt) {
              const selectedBegin =
                selectedAudioAttempt.leadingSilenceSec !== null
                  ? `${selectedAudioAttempt.leadingSilenceSec.toFixed(3)}s`
                  : 'n/a';
              const selectedMiddle =
                selectedAudioAttempt.maxInternalPauseSec !== null
                  ? `${selectedAudioAttempt.maxInternalPauseSec.toFixed(3)}s`
                  : 'n/a';
              console.log(
                `[Fix Intro QA] scene ${scene.id} selected ${selectedAudioAttempt.source} attempt ${selectedAudioAttempt.attemptNumber} as best failed candidate (begin=${selectedBegin}, middle=${selectedMiddle}).`,
              );
            }
          }

          if (!selectedAudioAttempt || !selectedAudioAttempt.audioUrl) {
            await markSceneFlagged(
              scene.id,
              'Intro QA failed: could not produce any valid generated TTS audio across attempts.',
              introQaDiagnostics,
            );
            continue;
          }

          let transcriptText = '';
          const selectedIsGenerated =
            selectedAudioAttempt.source === 'generated';

          if (selectedIsGenerated) {
            await setSceneAudioUrl(scene.id, selectedAudioAttempt.audioUrl);

            const freshBeforeSync =
              (await fetchFreshScene(scene.id)) || sceneWithVoiceOverride;
            const sourceVideoUrl =
              typeof freshBeforeSync['field_6888'] === 'string'
                ? String(freshBeforeSync['field_6888']).trim()
                : typeof sceneWithVoiceOverride['field_6888'] === 'string'
                  ? String(sceneWithVoiceOverride['field_6888']).trim()
                  : '';

            if (!sourceVideoUrl) {
              await markSceneFlagged(
                scene.id,
                `Intro QA failed: missing source video URL (field_6888). ${selectedAudioAttempt.reason}`,
                introQaDiagnostics,
              );
              continue;
            }

            await videoGenerateWithOptions(
              scene.id,
              sourceVideoUrl,
              selectedAudioAttempt.audioUrl,
              freshBeforeSync,
              0,
              'none',
              { throwOnError: true, suppressRefreshes: true },
            );

            const sceneForTranscribe =
              (await fetchFreshScene(scene.id)) || freshBeforeSync;
            const previousCaptionsUrl = extractAudioUrl(
              sceneForTranscribe['field_6910'],
            );

            await transcribeSceneWithOptions(
              scene.id,
              sceneForTranscribe,
              'final',
              true,
              true,
              false,
              { throwOnError: true },
            );

            const captionsUrl = await waitForCaptionsUrl(scene.id, {
              previousUrl: previousCaptionsUrl,
              requireChanged: Boolean(previousCaptionsUrl),
              maxRetries: 30,
              delayMs: 300,
            });

            if (!captionsUrl) {
              const audioReason = allGeneratedFailed
                ? buildAllGeneratedAttemptsFailureReason(
                    generatedAttempts,
                    selectedAudioAttempt,
                    existingAttempt,
                    existingCheckSummary,
                  )
                : selectedAudioAttempt.reason
                  ? selectedAudioAttempt.reason
                  : 'Selected generated intro audio attempt was used for sentence validation.';

              await markSceneFlagged(
                scene.id,
                `${audioReason} | Sentence check failed: fresh transcription file was not produced after selected audio sync.`,
                introQaDiagnostics,
              );
              continue;
            }

            transcriptText = await waitForTranscriptFromCaptions(
              captionsUrl,
              20,
              300,
            );
          } else {
            const latestForExistingSelection = await fetchFreshScene(scene.id);
            const latestAudioUrl = extractAudioUrl(
              latestForExistingSelection?.['field_6891'],
            );

            if (
              selectedAudioAttempt.audioUrl &&
              latestAudioUrl !== selectedAudioAttempt.audioUrl
            ) {
              await setSceneAudioUrl(scene.id, selectedAudioAttempt.audioUrl);
            }

            const sceneForSentenceCheck =
              (await fetchFreshScene(scene.id)) || latestBeforeAttempts;
            const existingCaptionsUrl = extractAudioUrl(
              sceneForSentenceCheck['field_6910'],
            );

            transcriptText = await waitForTranscriptFromCaptions(
              existingCaptionsUrl,
              10,
              250,
            );

            if (!transcriptText) {
              await transcribeSceneWithOptions(
                scene.id,
                sceneForSentenceCheck,
                'final',
                true,
                true,
                false,
                { throwOnError: true },
              );

              const refreshedCaptionsUrl = await waitForCaptionsUrl(scene.id, {
                previousUrl: existingCaptionsUrl,
                requireChanged: Boolean(existingCaptionsUrl),
                maxRetries: 30,
                delayMs: 300,
              });

              transcriptText = await waitForTranscriptFromCaptions(
                refreshedCaptionsUrl,
                20,
                300,
              );
            }
          }

          const sentenceCheck = compareSentencesOnce(
            desiredText,
            transcriptText,
          );

          if (sentenceCheck.pass && !allGeneratedFailed) {
            await clearSceneFlagged(scene.id, introQaDiagnostics);
            continue;
          }

          if (allGeneratedFailed) {
            const audioReason = buildAllGeneratedAttemptsFailureReason(
              generatedAttempts,
              selectedAudioAttempt,
              existingAttempt,
              existingCheckSummary,
            );

            if (sentenceCheck.pass) {
              await markSceneFlagged(scene.id, audioReason, introQaDiagnostics);
            } else {
              await markSceneFlagged(
                scene.id,
                `${audioReason} | ${sentenceCheck.reason}`,
                introQaDiagnostics,
              );
            }
            continue;
          }

          if (!sentenceCheck.pass) {
            if (!selectedIsGenerated && existingCheckSummary) {
              await markSceneFlagged(
                scene.id,
                `${existingCheckSummary} | ${sentenceCheck.reason}`,
                introQaDiagnostics,
              );
            } else {
              await markSceneFlagged(
                scene.id,
                sentenceCheck.reason,
                introQaDiagnostics,
              );
            }
          }
        } catch (error) {
          console.error(`Fix Intro QA failed for scene ${scene.id}:`, error);
          await markSceneFlagged(
            scene.id,
            `Fix Intro QA failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
            introQaDiagnostics,
          );
        }

        await new Promise((r) => setTimeout(r, 500));
      }

      onRefresh?.();
    } finally {
      setFixingIntroQaSceneId(null);
      setFixingIntroQaScenes(false);
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

  const parsePositiveNumber = (value: unknown): number | null => {
    const parsed =
      typeof value === 'number'
        ? value
        : typeof value === 'string'
          ? Number(value)
          : Number.NaN;

    if (!Number.isFinite(parsed) || parsed <= 0) {
      return null;
    }

    return parsed;
  };

  const extractLinkedVideoIdFromScene = (scene: BaserowRow): number | null => {
    const raw =
      scene['field_6889'] ??
      (scene as unknown as { field_6889?: unknown }).field_6889;

    const parseId = (candidate: unknown): number | null => {
      const parsed =
        typeof candidate === 'number'
          ? candidate
          : typeof candidate === 'string'
            ? Number(candidate)
            : Number.NaN;

      if (!Number.isInteger(parsed) || parsed <= 0) {
        return null;
      }

      return parsed;
    };

    const parseFromObject = (value: unknown): number | null => {
      if (!value || typeof value !== 'object') return null;
      const obj = value as Record<string, unknown>;

      const direct = parseId(obj.id);
      if (direct !== null) return direct;

      const rowId = parseId(obj.row_id);
      if (rowId !== null) return rowId;

      const row = obj.row;
      if (row && typeof row === 'object') {
        const nested = parseId((row as Record<string, unknown>).id);
        if (nested !== null) return nested;
      }

      return null;
    };

    if (Array.isArray(raw)) {
      for (const item of raw) {
        const direct = parseId(item);
        if (direct !== null) return direct;

        const fromObj = parseFromObject(item);
        if (fromObj !== null) return fromObj;
      }

      return null;
    }

    return parseId(raw) ?? parseFromObject(raw);
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

  const calculateFinalVideoDurationsBatch = async (
    options: { refreshOnDone?: boolean; playSoundOnDone?: boolean } = {},
  ): Promise<boolean> => {
    const { refreshOnDone = true, playSoundOnDone = true } = options;
    if (calculatingFinalVideoDurations) return false;
    if (!selectedOriginalVideo.id) return false;

    const sceneIds = [...data]
      .sort((a, b) => (Number(a.order) || 0) - (Number(b.order) || 0))
      .map((scene) => Number(scene.id))
      .filter((id) => Number.isFinite(id) && id > 0);

    if (sceneIds.length === 0) {
      if (playSoundOnDone) {
        playBatchDoneSound();
      }
      return true;
    }

    setCalculatingFinalVideoDurations(true);

    try {
      // Step 1 is now centralized in /api/create-en-srt.
      // Keep this preflight for UI compatibility and early validation.
      if (refreshOnDone) {
        onRefresh?.();
      }
      if (playSoundOnDone) {
        playBatchDoneSound();
      }
      return true;
    } catch (error) {
      console.error('Final duration preflight failed:', error);
      return false;
    } finally {
      setCalculatingFinalVideoDurations(false);
    }
  };

  const generateDurationSrtBatch = async (
    options: { refreshOnDone?: boolean; playSoundOnDone?: boolean } = {},
  ): Promise<boolean> => {
    const { refreshOnDone = true, playSoundOnDone = true } = options;
    if (generatingDurationSrt) return false;

    const selectedVideoId = Number(selectedOriginalVideo.id);
    if (!Number.isFinite(selectedVideoId) || selectedVideoId <= 0) return false;

    const sceneIds = [...data]
      .sort((a, b) => (Number(a.order) || 0) - (Number(b.order) || 0))
      .map((scene) => Number(scene.id))
      .filter((id) => Number.isFinite(id) && id > 0);

    if (sceneIds.length === 0) return true;

    setGeneratingDurationSrt(true);
    try {
      const res = await fetch('/api/create-en-srt', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ videoId: selectedVideoId, sceneIds }),
      });

      const payload = (await res.json().catch(() => null)) as {
        error?: unknown;
      } | null;

      if (!res.ok) {
        const message =
          typeof payload?.error === 'string'
            ? payload.error
            : `Failed to create EN SRT (${res.status})`;
        throw new Error(message);
      }

      console.log('Create En Srt completed via /api/create-en-srt:', {
        videoId: selectedVideoId,
      });

      if (refreshOnDone) {
        onRefresh?.();
      }
      if (playSoundOnDone) {
        playBatchDoneSound();
      }
      return true;
    } catch (error) {
      console.error('Generate Duration SRT failed:', error);
      return false;
    } finally {
      setGeneratingDurationSrt(false);
    }
  };

  const onCreateEnSrt = async () => {
    if (creatingEnSrt) return;
    if (!selectedOriginalVideo.id) return;

    setCreatingEnSrt(true);
    try {
      const durationOk = await calculateFinalVideoDurationsBatch({
        refreshOnDone: false,
        playSoundOnDone: false,
      });

      if (!durationOk) {
        return;
      }

      const srtOk = await generateDurationSrtBatch({
        refreshOnDone: false,
        playSoundOnDone: false,
      });

      if (!srtOk) {
        return;
      }

      onRefresh?.();
      playBatchDoneSound();
    } finally {
      setCreatingEnSrt(false);
    }
  };

  const onCreateDubbedEn = async () => {
    if (creatingDubbedEn) return;

    const selectedVideoId = Number(selectedOriginalVideo.id);
    if (!Number.isFinite(selectedVideoId) || selectedVideoId <= 0) {
      return;
    }

    setCreatingDubbedEn(true);
    try {
      const res = await fetch('/api/create-dubbed-en', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ videoId: selectedVideoId }),
      });

      const payload = (await res.json().catch(() => null)) as {
        error?: unknown;
        details?: unknown;
      } | null;

      if (!res.ok) {
        const details = Array.isArray(payload?.details)
          ? payload.details
              .map((item) => String(item))
              .filter(Boolean)
              .slice(0, 5)
              .join(' | ')
          : '';
        const message =
          typeof payload?.error === 'string' && payload.error.trim()
            ? payload.error.trim()
            : `Create Dubbed En failed (${res.status})`;

        throw new Error(details ? `${message} — ${details}` : message);
      }

      onRefresh?.();
      playBatchDoneSound();
    } catch (error) {
      console.error('Create Dubbed En failed:', error);
    } finally {
      setCreatingDubbedEn(false);
    }
  };

  const activeDubbedLanguage =
    String(dubbingLanguage || 'fa')
      .trim()
      .toLowerCase() || 'fa';
  const activeDubbedLanguageLabel = activeDubbedLanguage.toUpperCase();

  const onCreateDubbedFa = async () => {
    if (creatingDubbedFa) return;

    const selectedVideoId = Number(selectedOriginalVideo.id);
    if (!Number.isFinite(selectedVideoId) || selectedVideoId <= 0) {
      return;
    }

    setCreatingDubbedFa(true);
    try {
      const res = await fetch('/api/create-dubbed-fa', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          videoId: selectedVideoId,
          language: activeDubbedLanguage,
        }),
      });

      const payload = (await res.json().catch(() => null)) as {
        error?: unknown;
        details?: unknown;
      } | null;

      if (!res.ok) {
        const details = Array.isArray(payload?.details)
          ? payload.details
              .map((item) => String(item))
              .filter(Boolean)
              .slice(0, 5)
              .join(' | ')
          : '';
        const message =
          typeof payload?.error === 'string' && payload.error.trim()
            ? payload.error.trim()
            : `Create Dubbed ${activeDubbedLanguageLabel} failed (${res.status})`;

        throw new Error(details ? `${message} — ${details}` : message);
      }

      onRefresh?.();
      playBatchDoneSound();
    } catch (error) {
      console.error(
        `Create Dubbed ${activeDubbedLanguageLabel} failed:`,
        error,
      );
    } finally {
      setCreatingDubbedFa(false);
    }
  };

  const onFitFinalVideosToDuration = async () => {
    if (fittingFinalVideoDurations || batchOperations.speedingUpAllVideos) {
      return;
    }

    const scenesToFit = [...data]
      .filter((scene) => {
        const finalVideoUrl = getExistingFinalVideoUrl(scene);
        const targetDurationSec = parsePositiveNumber(scene['field_6884']);

        return Boolean(finalVideoUrl) && targetDurationSec !== null;
      })
      .sort((a, b) => (Number(a.order) || 0) - (Number(b.order) || 0));

    if (scenesToFit.length === 0) {
      playBatchDoneSound();
      return;
    }

    setFittingFinalVideoDurations(true);
    startBatchOperation('speedingUpAllVideos');

    try {
      for (const scene of scenesToFit) {
        const finalVideoUrl = getExistingFinalVideoUrl(scene);
        const targetDurationSec = parsePositiveNumber(scene['field_6884']);

        if (!finalVideoUrl || targetDurationSec === null) {
          continue;
        }

        setSpeedingUpVideo(scene.id);

        try {
          const linkedVideoId = extractLinkedVideoIdFromScene(scene);

          const res = await fetch('/api/fit-final-duration', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              sceneId: scene.id,
              videoId: linkedVideoId ?? undefined,
              videoUrl: finalVideoUrl,
              targetDurationSec,
              muteAudio: false,
            }),
          });

          if (!res.ok) {
            const payload = (await res.json().catch(() => null)) as {
              error?: unknown;
            } | null;

            const message =
              typeof payload?.error === 'string'
                ? payload.error
                : `Fit duration failed (${res.status})`;

            throw new Error(message);
          }
        } catch (error) {
          console.error(
            `Fit final duration failed for scene ${scene.id}:`,
            error,
          );
        } finally {
          setSpeedingUpVideo(null);
        }

        await new Promise((resolve) => setTimeout(resolve, 250));
      }

      onRefresh?.();
      playBatchDoneSound();
    } finally {
      setSpeedingUpVideo(null);
      completeBatchOperation('speedingUpAllVideos');
      setFittingFinalVideoDurations(false);
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
            <h2 className='text-xl font-semibold text-gray-900'>
              Batch Operations For Scenes of A Single Video
            </h2>
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

          {/* Workflow Sections */}
          <div className='grid grid-cols-1 xl:grid-cols-2 gap-6'>
            {/* Create */}
            <section className='xl:order-1'>
              <div className='mb-3 flex items-center gap-2'>
                <h3 className='text-lg font-semibold text-slate-900'>Create</h3>
                <span className='text-xs font-medium text-slate-500'>
                  Improve • TTS • Sync
                </span>
              </div>
              <div className='grid grid-cols-1 md:grid-cols-2 2xl:grid-cols-3 gap-3'>
                {/* AI Improve All */}
                <div className='bg-gradient-to-br from-indigo-50 to-indigo-100 rounded-lg p-3 border border-indigo-200'>
                  <div className='flex items-center gap-2 mb-3'>
                    <div className='p-2 bg-indigo-500 rounded-lg'>
                      <Sparkles className='w-4 h-4 text-white' />
                    </div>
                    <h3 className='font-semibold text-indigo-900'>
                      AI Improve
                    </h3>
                  </div>
                  <div className='grid grid-cols-[repeat(auto-fit,minmax(150px,1fr))] gap-2'>
                    <button
                      onClick={onImproveAllSentences}
                      disabled={
                        batchOperations.improvingAll ||
                        sceneLoading.improvingSentence !== null
                      }
                      className='w-full min-h-[44px] px-2 py-2 bg-indigo-500 hover:bg-indigo-600 disabled:bg-indigo-300 text-white text-xs sm:text-sm font-medium rounded-lg transition-all duration-200 flex items-center justify-center text-center leading-tight gap-2 shadow-sm hover:shadow-md disabled:cursor-not-allowed'
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
                      <span className='font-medium text-center leading-tight whitespace-normal break-words'>
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
                      className='w-full min-h-[44px] px-2 py-2 bg-indigo-500 hover:bg-indigo-600 disabled:bg-indigo-300 text-white text-xs sm:text-sm font-medium rounded-lg transition-all duration-200 flex items-center justify-center text-center leading-tight gap-2 shadow-sm hover:shadow-md disabled:cursor-not-allowed'
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
                      <span className='font-medium text-center leading-tight whitespace-normal break-words'>
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
                      className='w-full min-h-[44px] px-2 py-2 bg-indigo-500 hover:bg-indigo-600 disabled:bg-indigo-300 text-white text-xs sm:text-sm font-medium rounded-lg transition-all duration-200 flex items-center justify-center text-center leading-tight gap-2 shadow-sm hover:shadow-md disabled:cursor-not-allowed'
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
                      <span className='font-medium text-center leading-tight whitespace-normal break-words'>
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
                      className='w-full min-h-[44px] px-2 py-2 bg-indigo-500 hover:bg-indigo-600 disabled:bg-indigo-300 text-white text-xs sm:text-sm font-medium rounded-lg transition-all duration-200 flex items-center justify-center text-center leading-tight gap-2 shadow-sm hover:shadow-md disabled:cursor-not-allowed'
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
                      <span className='font-medium text-center leading-tight whitespace-normal break-words'>
                        {applyingCurrentVideoWordReplacements
                          ? 'Applying...'
                          : 'Apply Word Fixes'}
                      </span>
                    </button>
                  </div>
                </div>

                {/* Generate TTS */}
                <div className='bg-gradient-to-br from-purple-50 to-purple-100 rounded-lg p-3 border border-purple-200'>
                  <div className='flex items-center gap-2 mb-3'>
                    <div className='p-2 bg-purple-500 rounded-lg'>
                      <Mic className='w-4 h-4 text-white' />
                    </div>
                    <h3 className='font-semibold text-purple-900'>
                      Generate TTS
                    </h3>
                  </div>
                  <button
                    onClick={onGenerateAllTTS}
                    disabled={
                      batchOperations.generatingAllTTS ||
                      sceneLoading.producingTTS !== null
                    }
                    className='w-full h-10 bg-purple-500 hover:bg-purple-600 disabled:bg-purple-300 text-white text-sm font-medium rounded-lg transition-all duration-200 flex items-center justify-center gap-2 shadow-sm hover:shadow-md disabled:cursor-not-allowed'
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
                <div className='bg-gradient-to-br from-teal-50 to-teal-100 rounded-lg p-3 border border-teal-200'>
                  <div className='flex items-center gap-2 mb-3'>
                    <div className='p-2 bg-teal-500 rounded-lg'>
                      <Film className='w-4 h-4 text-white' />
                    </div>
                    <h3 className='font-semibold text-teal-900'>Sync Videos</h3>
                  </div>

                  {/* Transcribe Final Scenes */}
                  <div className='bg-gradient-to-br from-emerald-50 to-emerald-100 rounded-lg p-3 border border-emerald-200'>
                    <div className='flex items-center gap-2 mb-3'>
                      <div className='p-2 bg-emerald-500 rounded-lg'>
                        <Wand2 className='w-4 h-4 text-white' />
                      </div>
                      <h3 className='font-semibold text-emerald-900'>
                        Fix TTS
                      </h3>
                    </div>
                    <div className='grid grid-cols-2 gap-2'>
                      <button
                        onClick={onFixAllFinalTTS}
                        disabled={
                          !selectedOriginalVideo.id ||
                          fixingIntroQaScenes ||
                          batchOperations.transcribingAllFinalScenes ||
                          sceneLoading.transcribingScene !== null
                        }
                        className='w-full h-10 bg-emerald-500 hover:bg-emerald-600 disabled:bg-emerald-300 text-white text-sm font-medium rounded-lg transition-all duration-200 flex items-center justify-center gap-2 shadow-sm hover:shadow-md disabled:cursor-not-allowed'
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
                          fixingIntroQaScenes ||
                          fixingOnlyFlaggedScenes ||
                          batchOperations.transcribingAllFinalScenes ||
                          sceneLoading.transcribingScene !== null
                        }
                        hasSelectedVideo={Boolean(selectedOriginalVideo.id)}
                        isRunning={fixingOnlyFlaggedScenes}
                        currentSceneId={fixingOnlyFlaggedSceneId}
                        className='mt-0'
                      />

                      <div className='col-span-2 grid grid-cols-2 gap-2'>
                        <label className='flex flex-col gap-1'>
                          <span className='text-[11px] font-medium text-emerald-800'>
                            Intro scenes count
                          </span>
                          <input
                            type='number'
                            min={1}
                            step={1}
                            value={introQaSceneCount}
                            onChange={(e) => {
                              const parsed = parseInt(e.target.value, 10);
                              setIntroQaSceneCount(
                                Number.isFinite(parsed)
                                  ? Math.max(1, parsed)
                                  : INTRO_QA_SCENE_LIMIT,
                              );
                            }}
                            disabled={fixingIntroQaScenes}
                            className='h-9 px-2 text-sm rounded-lg border border-emerald-300 bg-white text-emerald-900 focus:outline-none focus:ring-2 focus:ring-emerald-400 disabled:bg-emerald-100 disabled:text-emerald-500'
                            title='How many intro scenes to process for this button only'
                          />
                        </label>

                        <label className='flex flex-col gap-1'>
                          <span className='text-[11px] font-medium text-emerald-800'>
                            Generated audios
                          </span>
                          <input
                            type='number'
                            min={1}
                            step={1}
                            value={introQaGeneratedAudioCount}
                            onChange={(e) => {
                              const parsed = parseInt(e.target.value, 10);
                              setIntroQaGeneratedAudioCount(
                                Number.isFinite(parsed)
                                  ? Math.max(1, parsed)
                                  : INTRO_QA_MAX_AUDIO_ATTEMPTS,
                              );
                            }}
                            disabled={fixingIntroQaScenes}
                            className='h-9 px-2 text-sm rounded-lg border border-emerald-300 bg-white text-emerald-900 focus:outline-none focus:ring-2 focus:ring-emerald-400 disabled:bg-emerald-100 disabled:text-emerald-500'
                            title='How many generated audio attempts to allow for this button only'
                          />
                        </label>
                      </div>

                      <FixIntroQaButton
                        onClick={onFixIntroQaFinalTTS}
                        disabled={
                          !selectedOriginalVideo.id ||
                          fixingIntroQaScenes ||
                          fixingOnlyFlaggedScenes ||
                          batchOperations.transcribingAllFinalScenes ||
                          sceneLoading.transcribingScene !== null
                        }
                        hasSelectedVideo={Boolean(selectedOriginalVideo.id)}
                        isRunning={fixingIntroQaScenes}
                        currentSceneId={fixingIntroQaSceneId}
                        introLimit={introQaSceneCount}
                        maxAudioAttempts={introQaGeneratedAudioCount}
                        className='col-span-2 mt-0'
                      />
                    </div>
                  </div>
                  <button
                    onClick={onGenerateAllVideos}
                    disabled={
                      batchOperations.generatingAllVideos ||
                      sceneLoading.generatingVideo !== null
                    }
                    className='mt-2 w-full h-10 bg-teal-500 hover:bg-teal-600 disabled:bg-teal-300 text-white text-sm font-medium rounded-lg transition-all duration-200 flex items-center justify-center gap-2 shadow-sm hover:shadow-md disabled:cursor-not-allowed'
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
              </div>
            </section>

            {/* Enhance */}
            <section className='xl:col-span-2 xl:order-3'>
              <div className='mb-3 flex items-center gap-2'>
                <h3 className='text-lg font-semibold text-slate-900'>
                  Enhance
                </h3>
                <span className='text-xs font-medium text-slate-500'>
                  Images • Scene Videos • Upscale • Apply
                </span>
              </div>
              <div className='grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-6 gap-3'>
                {/* Scene Image Generation */}
                <div className='bg-gradient-to-br from-pink-50 to-pink-100 rounded-lg p-3 border border-pink-200'>
                  <div className='flex items-center gap-2 mb-3'>
                    <div className='p-2 bg-pink-500 rounded-lg'>
                      <ImageIcon className='w-4 h-4 text-white' />
                    </div>
                    <h3 className='font-semibold text-pink-900'>Images</h3>
                  </div>
                  <button
                    onClick={onGenerateAllSceneImages}
                    disabled={
                      !selectedOriginalVideo.id || generatingAllSceneImages
                    }
                    className='w-full h-10 bg-pink-500 hover:bg-pink-600 disabled:bg-pink-300 text-white text-sm font-medium rounded-lg transition-all duration-200 flex items-center justify-center gap-2 shadow-sm hover:shadow-md disabled:cursor-not-allowed'
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
                <div className='bg-gradient-to-br from-sky-50 to-sky-100 rounded-lg p-3 border border-sky-200'>
                  <div className='flex items-center gap-2 mb-3'>
                    <div className='p-2 bg-sky-500 rounded-lg flex items-center gap-1'>
                      <Film className='w-4 h-4 text-white' />
                      <span className='text-white text-xs font-bold'>I2V</span>
                    </div>
                    <h3 className='font-semibold text-sky-900'>Scene Videos</h3>
                  </div>
                  <button
                    onClick={onGenerateAllSceneVideos}
                    disabled={generatingAllSceneVideos}
                    className='w-full h-10 bg-sky-500 hover:bg-sky-600 disabled:bg-sky-300 text-white text-sm font-medium rounded-lg transition-all duration-200 flex items-center justify-center gap-2 shadow-sm hover:shadow-md disabled:cursor-not-allowed'
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
                <div className='bg-gradient-to-br from-violet-50 to-violet-100 rounded-lg p-3 border border-violet-200'>
                  <div className='flex items-center gap-2 mb-3'>
                    <div className='p-2 bg-violet-500 rounded-lg flex items-center gap-1'>
                      <Wand2 className='w-4 h-4 text-white' />
                      <span className='text-white text-xs font-bold'>RVE</span>
                    </div>
                    <h3 className='font-semibold text-violet-900'>
                      Enhance Videos
                    </h3>
                  </div>
                  <button
                    onClick={onEnhanceAllSceneVideos}
                    disabled={enhancingAllSceneVideos}
                    className='w-full h-10 bg-violet-500 hover:bg-violet-600 disabled:bg-violet-300 text-white text-sm font-medium rounded-lg transition-all duration-200 flex items-center justify-center gap-2 shadow-sm hover:shadow-md disabled:cursor-not-allowed'
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
                <div className='bg-gradient-to-br from-fuchsia-50 to-fuchsia-100 rounded-lg p-3 border border-fuchsia-200'>
                  <div className='flex items-center gap-2 mb-3'>
                    <div className='p-2 bg-fuchsia-500 rounded-lg flex items-center gap-1'>
                      <ImageIcon className='w-4 h-4 text-white' />
                      <span className='text-white text-xs font-bold'>3x</span>
                    </div>
                    <h3 className='font-semibold text-fuchsia-900'>Upscale</h3>
                  </div>
                  <button
                    onClick={onUpscaleAllSceneImages}
                    disabled={upscalingAllSceneImages}
                    className='w-full h-10 bg-fuchsia-500 hover:bg-fuchsia-600 disabled:bg-fuchsia-300 text-white text-sm font-medium rounded-lg transition-all duration-200 flex items-center justify-center gap-2 shadow-sm hover:shadow-md disabled:cursor-not-allowed'
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
                <div className='bg-gradient-to-br from-rose-50 to-rose-100 rounded-lg p-3 border border-rose-200'>
                  <div className='flex items-center gap-2 mb-3'>
                    <div className='p-2 bg-rose-500 rounded-lg flex items-center gap-1'>
                      <Save className='w-4 h-4 text-white' />
                      <span className='text-white text-xs font-bold'>IMG</span>
                    </div>
                    <h3 className='font-semibold text-rose-900'>Apply Image</h3>
                  </div>
                  <button
                    onClick={onApplyUpscaledImagesAll}
                    disabled={applyingAllUpscaledImages}
                    className='w-full h-10 bg-rose-500 hover:bg-rose-600 disabled:bg-rose-300 text-white text-sm font-medium rounded-lg transition-all duration-200 flex items-center justify-center gap-2 shadow-sm hover:shadow-md disabled:cursor-not-allowed'
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
                <div className='bg-gradient-to-br from-indigo-50 to-indigo-100 rounded-lg p-3 border border-indigo-200'>
                  <div className='flex items-center gap-2 mb-3'>
                    <div className='p-2 bg-indigo-500 rounded-lg flex items-center gap-1'>
                      <Film className='w-4 h-4 text-white' />
                      <span className='text-white text-xs font-bold'>VID</span>
                    </div>
                    <h3 className='font-semibold text-indigo-900'>
                      Apply Video
                    </h3>
                  </div>
                  <button
                    onClick={onApplyEnhancedVideosAll}
                    disabled={applyingAllEnhancedVideos}
                    className='w-full h-10 bg-indigo-500 hover:bg-indigo-600 disabled:bg-indigo-300 text-white text-sm font-medium rounded-lg transition-all duration-200 flex items-center justify-center gap-2 shadow-sm hover:shadow-md disabled:cursor-not-allowed'
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
              </div>
            </section>

            {/* Finalize */}
            <section className='xl:order-2'>
              <div className='mb-3 flex items-center gap-2'>
                <h3 className='text-lg font-semibold text-slate-900'>
                  Finalize
                </h3>
                <span className='text-xs font-medium text-slate-500'>
                  Subtitles • Speed Up • Combine • Merge
                </span>
              </div>
              <div className='grid grid-cols-1 md:grid-cols-2 2xl:grid-cols-3 gap-3'>
                {/* Subtitle Generation */}
                <div className='bg-gradient-to-br from-yellow-50 to-yellow-100 rounded-lg p-3 border border-yellow-200'>
                  <div className='flex items-center gap-2 mb-3'>
                    <div className='p-2 bg-yellow-500 rounded-lg'>
                      <Type className='w-4 h-4 text-white' />
                    </div>
                    <h3 className='font-semibold text-yellow-900'>Subtitles</h3>
                  </div>
                  <button
                    onClick={onGenerateAllSubtitles}
                    disabled={
                      !selectedOriginalVideo.id || generatingAllSubtitles
                    }
                    className='w-full h-10 bg-yellow-500 hover:bg-yellow-600 disabled:bg-yellow-300 text-white text-sm font-medium rounded-lg transition-all duration-200 flex items-center justify-center gap-2 shadow-sm hover:shadow-md disabled:cursor-not-allowed'
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

                  <button
                    onClick={handleCombineNoSubtitlePairs}
                    disabled={combiningNoSubtitlePairs}
                    className='w-full h-10 mt-2 bg-violet-500 hover:bg-violet-600 disabled:bg-violet-300 text-white text-sm font-medium rounded-lg transition-all duration-200 flex items-center justify-center gap-2 shadow-sm hover:shadow-md disabled:cursor-not-allowed'
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

                  <button
                    onClick={onCreateEnSrt}
                    disabled={
                      !selectedOriginalVideo.id ||
                      creatingEnSrt ||
                      calculatingFinalVideoDurations ||
                      generatingDurationSrt
                    }
                    className='w-full h-10 mt-2 bg-lime-600 hover:bg-lime-700 disabled:bg-lime-300 text-white text-sm font-medium rounded-lg transition-all duration-200 flex items-center justify-center gap-2 shadow-sm hover:shadow-md disabled:cursor-not-allowed'
                    title={
                      !selectedOriginalVideo.id
                        ? 'Select an original video first'
                        : creatingEnSrt ||
                            calculatingFinalVideoDurations ||
                            generatingDurationSrt
                          ? calculatingFinalVideoDurations
                            ? 'Step 1/2: Calculating final durations...'
                            : generatingDurationSrt
                              ? 'Step 2/2: Generating and saving SRT...'
                              : 'Creating EN SRT...'
                          : 'Create En Srt: calculate Final Video Duration (7107) first, then generate SRT and save URL to Final Video Captions URL (6872)'
                    }
                  >
                    {(creatingEnSrt ||
                      calculatingFinalVideoDurations ||
                      generatingDurationSrt) && (
                      <Loader2 className='w-4 h-4 animate-spin' />
                    )}
                    {!(
                      creatingEnSrt ||
                      calculatingFinalVideoDurations ||
                      generatingDurationSrt
                    ) && <Clock className='w-4 h-4' />}
                    <span className='font-medium'>
                      {calculatingFinalVideoDurations
                        ? 'Final Duration...'
                        : generatingDurationSrt
                          ? 'Create SRT...'
                          : creatingEnSrt
                            ? 'Processing...'
                            : 'Create En Srt'}
                    </span>
                  </button>

                  <button
                    onClick={onCreateDubbedEn}
                    disabled={!selectedOriginalVideo.id || creatingDubbedEn}
                    className='w-full h-10 mt-2 bg-emerald-600 hover:bg-emerald-700 disabled:bg-emerald-300 text-white text-sm font-medium rounded-lg transition-all duration-200 flex items-center justify-center gap-2 shadow-sm hover:shadow-md disabled:cursor-not-allowed'
                    title={
                      !selectedOriginalVideo.id
                        ? 'Select an original video first'
                        : creatingDubbedEn
                          ? 'Creating scene Dubbed En, merging, and saving Final Dubbed Audio...'
                          : 'Convert EN TTS (6891) to exact scene Duration (6884), save Dubbed En (7108), merge all, fit to Uploaded Video Duration (6909), and save Final Dubbed Audio (7109)'
                    }
                  >
                    {creatingDubbedEn && (
                      <Loader2 className='w-4 h-4 animate-spin' />
                    )}
                    {!creatingDubbedEn && <Volume2 className='w-4 h-4' />}
                    <span className='font-medium'>
                      {creatingDubbedEn ? 'Processing...' : 'Create Dubbed En'}
                    </span>
                  </button>

                  <div className='mt-2'>
                    <label className='block text-[11px] font-medium text-teal-900 mb-1'>
                      Dubbed Language
                      {loadingDubbingLanguages ? ' (loading...)' : ''}
                    </label>
                    <select
                      value={activeDubbedLanguage}
                      onChange={(e) => setDubbingLanguage(e.target.value)}
                      onFocus={() => {
                        void loadDubbedLanguages();
                      }}
                      onPointerDown={() => {
                        void loadDubbedLanguages();
                      }}
                      disabled={creatingDubbedFa}
                      className='w-full h-9 px-2 bg-white border border-teal-300 rounded-lg text-sm text-teal-900 focus:outline-none focus:ring-2 focus:ring-teal-500 disabled:bg-teal-100 disabled:text-teal-500 disabled:cursor-not-allowed'
                      title='Select language preset for Create Dubbed'
                    >
                      {availableDubbingLanguages.map((languageCode) => (
                        <option key={languageCode} value={languageCode}>
                          {languageCode.toUpperCase()}
                        </option>
                      ))}
                    </select>
                  </div>

                  <button
                    onClick={onCreateDubbedFa}
                    disabled={!selectedOriginalVideo.id || creatingDubbedFa}
                    className='w-full h-10 mt-2 bg-teal-600 hover:bg-teal-700 disabled:bg-teal-300 text-white text-sm font-medium rounded-lg transition-all duration-200 flex items-center justify-center gap-2 shadow-sm hover:shadow-md disabled:cursor-not-allowed'
                    title={
                      !selectedOriginalVideo.id
                        ? 'Select an original video first'
                        : creatingDubbedFa
                          ? `Step 1/2 map language SRT into target sentence field. Step 2/2 generate OmniVoice TTS into dubbed field for ${activeDubbedLanguageLabel}...`
                          : `Use language preset ${activeDubbedLanguageLabel} from Global TTS Settings → Manage Language Presets (Baserow fields + OmniVoice params)`
                    }
                  >
                    {creatingDubbedFa && (
                      <Loader2 className='w-4 h-4 animate-spin' />
                    )}
                    {!creatingDubbedFa && <Volume2 className='w-4 h-4' />}
                    <span className='font-medium'>
                      {creatingDubbedFa
                        ? 'Processing...'
                        : `Create Dubbed ${activeDubbedLanguageLabel}`}
                    </span>
                  </button>
                </div>

                {/* Speed Up Videos */}
                <div className='bg-gradient-to-br from-blue-50 to-blue-100 rounded-lg p-3 border border-blue-200'>
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
                        updateVideoSettings({
                          muteAudio: !videoSettings.muteAudio,
                        })
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
                    className='w-full h-10 bg-blue-500 hover:bg-blue-600 disabled:bg-blue-300 text-white text-sm font-medium rounded-lg transition-all duration-200 flex items-center justify-center gap-2 shadow-sm hover:shadow-md disabled:cursor-not-allowed'
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
                    onClick={onFitFinalVideosToDuration}
                    disabled={
                      fittingFinalVideoDurations ||
                      batchOperations.speedingUpAllVideos ||
                      sceneLoading.speedingUpVideo !== null
                    }
                    className='w-full h-10 mt-2 bg-indigo-500 hover:bg-indigo-600 disabled:bg-indigo-300 text-white text-sm font-medium rounded-lg transition-all duration-200 flex items-center justify-center gap-2 shadow-sm hover:shadow-md disabled:cursor-not-allowed'
                    title='Precisely fit each final video (field_6886) to Duration (field_6884) using fixed CFR 30fps + explicit frame add/drop correction'
                  >
                    {(fittingFinalVideoDurations ||
                      sceneLoading.speedingUpVideo !== null) && (
                      <Loader2 className='w-4 h-4 animate-spin' />
                    )}
                    {!fittingFinalVideoDurations &&
                      sceneLoading.speedingUpVideo === null && (
                        <Clock className='w-4 h-4' />
                      )}
                    <span className='font-medium'>
                      {fittingFinalVideoDurations
                        ? sceneLoading.speedingUpVideo !== null
                          ? `Fitting #${sceneLoading.speedingUpVideo}`
                          : 'Fitting...'
                        : sceneLoading.speedingUpVideo !== null
                          ? `Busy (#${sceneLoading.speedingUpVideo})`
                          : 'Fit Final Duration'}
                    </span>
                  </button>

                  <button
                    onClick={handleDeleteEmptyScenes}
                    disabled={
                      deletingEmptyScenes ||
                      batchOperations.speedingUpAllVideos ||
                      sceneLoading.speedingUpVideo !== null
                    }
                    className='w-full h-10 mt-2 bg-red-500 hover:bg-red-600 disabled:bg-red-300 text-white text-sm font-medium rounded-lg transition-all duration-200 flex items-center justify-center gap-2 shadow-sm hover:shadow-md disabled:cursor-not-allowed'
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
                <div className='bg-gradient-to-br from-orange-50 to-orange-100 rounded-lg p-3 border border-orange-200'>
                  <div className='flex items-center gap-2 mb-3'>
                    <div className='p-2 bg-orange-500 rounded-lg'>
                      <Film className='w-4 h-4 text-white' />
                    </div>
                    <h3 className='font-semibold text-orange-900'>
                      Merge Scenes of a Single Video
                    </h3>
                  </div>
                  <button
                    onClick={onConcatenateAllVideos}
                    disabled={batchOperations.concatenatingVideos}
                    className='w-full h-10 bg-orange-500 hover:bg-orange-600 disabled:bg-orange-300 text-white text-sm font-medium rounded-lg transition-all duration-200 flex items-center justify-center gap-2 shadow-sm hover:shadow-md disabled:cursor-not-allowed'
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

                  <button
                    onClick={onTranscribeApplyGenerateClipsAllScenes}
                    disabled={
                      !selectedOriginalVideo.id ||
                      batchOperations.concatenatingVideos ||
                      runningTranscribeApplyGenerateAllScenes
                    }
                    className='w-full mt-2 min-h-[44px] px-2 py-2 bg-orange-500 hover:bg-orange-600 disabled:bg-orange-300 text-white text-xs sm:text-sm font-medium rounded-lg transition-all duration-200 flex items-center justify-center gap-2 text-center leading-tight shadow-sm hover:shadow-md disabled:cursor-not-allowed'
                    title={
                      !selectedOriginalVideo.id
                        ? 'Select an original video first'
                        : runningTranscribeApplyGenerateAllScenes
                          ? transcribeApplyGenerateCurrentSceneId !== null
                            ? `Running Transcribe + Apply + Gen Clips for scene ${transcribeApplyGenerateCurrentSceneId}`
                            : 'Running Transcribe + Apply + Gen Clips for all scenes...'
                          : 'Transcribe original captions, apply separation, and generate clips for all scenes (skips clip generation when separation does not create additional scenes)'
                    }
                  >
                    {runningTranscribeApplyGenerateAllScenes && (
                      <Loader2 className='w-4 h-4 animate-spin' />
                    )}
                    <span className='font-medium whitespace-normal break-words'>
                      {runningTranscribeApplyGenerateAllScenes
                        ? transcribeApplyGenerateCurrentSceneId !== null
                          ? `Scene #${transcribeApplyGenerateCurrentSceneId}`
                          : 'Processing...'
                        : 'Transcribe + Apply + Gen Clips'}
                    </span>
                  </button>

                  <div className='mt-2'>
                    <label className='block text-[11px] font-medium text-orange-900 mb-1'>
                      Min chars in Sentence (6890)
                    </label>
                    <input
                      type='number'
                      min={0}
                      step={1}
                      value={transcribeApplyGenerateMinChars}
                      onChange={(e) => {
                        const parsed = Number.parseInt(e.target.value, 10);
                        setTranscribeApplyGenerateMinChars(
                          Number.isFinite(parsed) ? Math.max(0, parsed) : 0,
                        );
                      }}
                      disabled={runningTranscribeApplyGenerateAllScenes}
                      className='w-full h-9 px-2 bg-white border border-orange-300 rounded-lg text-sm text-orange-900 focus:outline-none focus:ring-2 focus:ring-orange-500 disabled:bg-orange-100 disabled:text-orange-500 disabled:cursor-not-allowed'
                      title='Only scenes with Sentence (field_6890) length greater than or equal to this value will be processed in this batch action'
                    />
                  </div>
                </div>
              </div>
            </section>
          </div>
        </div>
      )}
    </div>
  );
}
