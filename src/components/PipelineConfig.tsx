'use client';

import { useAppStore } from '@/store/useAppStore';
import { getLanguageDisplayName } from '@/utils/languageNames';
import { CheckCircle2, Circle, Settings2, Workflow } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';

interface PipelineConfigProps {
  onRunFullPipeline?: () => void;
  isRunFullPipelineDisabled?: boolean;
  isRunningFullPipeline?: boolean;
  runFullPipelineLabel?: string;
  runFullPipelineTitle?: string;
}

type AudioReferenceLanguageEntry = {
  language?: unknown;
  enabled?: unknown;
};

function normalizeLanguageCode(value: unknown): string {
  if (typeof value !== 'string') return '';
  return value.trim().toLowerCase();
}

function toUniqueNormalizedLanguageList(values: unknown): string[] {
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

function arePipelineConfigValuesEqual(left: unknown, right: unknown): boolean {
  if (Array.isArray(left) || Array.isArray(right)) {
    if (!Array.isArray(left) || !Array.isArray(right)) return false;

    if (left.length !== right.length) return false;

    for (let index = 0; index < left.length; index += 1) {
      if (left[index] !== right[index]) return false;
    }

    return true;
  }

  return left === right;
}

export default function PipelineConfig({
  onRunFullPipeline,
  isRunFullPipelineDisabled = false,
  isRunningFullPipeline = false,
  runFullPipelineLabel = 'Full Pipeline',
  runFullPipelineTitle = 'Run full pipeline',
}: PipelineConfigProps) {
  const {
    pipelineConfig,
    pipelineTemplates,
    togglePipelineStep,
    updatePipelineConfig,
    savePipelineTemplate,
    applyPipelineTemplate,
    deletePipelineTemplate,
    reorderPipelineTemplate,
  } = useAppStore();
  const [isExpanded, setIsExpanded] = useState(false);
  const [isSaveTemplateModalOpen, setIsSaveTemplateModalOpen] = useState(false);
  const [templateName, setTemplateName] = useState('');
  const [templateNameError, setTemplateNameError] = useState('');
  const [isTemplateReorderMode, setIsTemplateReorderMode] = useState(false);
  const [draggingTemplateId, setDraggingTemplateId] = useState<string | null>(
    null,
  );
  const [dragOverTemplateId, setDragOverTemplateId] = useState<string | null>(
    null,
  );
  const [
    availableDubbedLanguagesForPipeline,
    setAvailableDubbedLanguagesForPipeline,
  ] = useState<string[]>(['fa']);
  const [
    loadingDubbedLanguagesForPipeline,
    setLoadingDubbedLanguagesForPipeline,
  ] = useState(false);
  const [
    hasLoadedDubbedLanguagesForPipeline,
    setHasLoadedDubbedLanguagesForPipeline,
  ] = useState(false);
  const templateReorderEnabled = isExpanded && isTemplateReorderMode;

  const selectedDubbedLanguagesForPipeline = useMemo(
    () =>
      toUniqueNormalizedLanguageList(
        pipelineConfig.selectedDubbedLanguagesForPipeline,
      ),
    [pipelineConfig.selectedDubbedLanguagesForPipeline],
  );

  // Load available languages when component expands or dubbed language is enabled
  useEffect(() => {
    if (
      isExpanded &&
      pipelineConfig.createDubbedLanguage &&
      !hasLoadedDubbedLanguagesForPipeline
    ) {
      void loadAvailableDubbedLanguagesForPipeline();
    }
  }, [
    isExpanded,
    pipelineConfig.createDubbedLanguage,
    hasLoadedDubbedLanguagesForPipeline,
  ]);

  const loadAvailableDubbedLanguagesForPipeline = useCallback(async () => {
    setLoadingDubbedLanguagesForPipeline(true);

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

      const enabledLanguages = Array.from(
        new Set(
          rawEntries
            .filter(
              (entry) =>
                entry && typeof entry === 'object' && entry.enabled !== false,
            )
            .map((entry) => normalizeLanguageCode(entry.language))
            .filter(Boolean),
        ),
      ).sort();

      setAvailableDubbedLanguagesForPipeline(
        enabledLanguages.length > 0 ? enabledLanguages : ['fa'],
      );
      setHasLoadedDubbedLanguagesForPipeline(true);
    } catch (error) {
      console.error('Failed to load pipeline dubbed languages:', error);
      setAvailableDubbedLanguagesForPipeline(['fa']);
      setHasLoadedDubbedLanguagesForPipeline(false);
    } finally {
      setLoadingDubbedLanguagesForPipeline(false);
    }
  }, []);

  const openSaveTemplateModal = () => {
    setTemplateName('');
    setTemplateNameError('');
    setIsSaveTemplateModalOpen(true);
  };

  const closeSaveTemplateModal = () => {
    setTemplateName('');
    setTemplateNameError('');
    setIsSaveTemplateModalOpen(false);
  };

  const handleSaveTemplate = () => {
    const trimmedName = templateName.trim();

    if (!trimmedName) {
      setTemplateNameError('Please enter a template name.');
      return;
    }

    savePipelineTemplate(trimmedName);
    closeSaveTemplateModal();
  };

  const clearTemplateDragState = () => {
    setDraggingTemplateId(null);
    setDragOverTemplateId(null);
  };

  useEffect(() => {
    if (!templateReorderEnabled) {
      setDraggingTemplateId(null);
      setDragOverTemplateId(null);
    }
  }, [templateReorderEnabled]);

  useEffect(() => {
    if (!isExpanded || !pipelineConfig.createDubbedLanguage) return;
    void loadAvailableDubbedLanguagesForPipeline();
  }, [
    isExpanded,
    pipelineConfig.createDubbedLanguage,
    loadAvailableDubbedLanguagesForPipeline,
  ]);

  useEffect(() => {
    // Only filter when we have a complete loaded list (more than just default ['fa'])
    // and the selected languages don't match available ones
    if (!hasLoadedDubbedLanguagesForPipeline) return;
    if (availableDubbedLanguagesForPipeline.length <= 1) return; // Wait for full load

    const availableSet = new Set(availableDubbedLanguagesForPipeline);
    const filteredSelection = selectedDubbedLanguagesForPipeline.filter(
      (languageCode) => availableSet.has(languageCode),
    );

    // Only update if we actually need to filter out invalid selections
    if (filteredSelection.length === selectedDubbedLanguagesForPipeline.length)
      return;

    // Don't filter if the selection is empty (let user choose)
    if (selectedDubbedLanguagesForPipeline.length === 0) return;

    console.log('Filtering dubbed language selection:', {
      original: selectedDubbedLanguagesForPipeline,
      filtered: filteredSelection,
      available: availableDubbedLanguagesForPipeline,
    });

    updatePipelineConfig({
      selectedDubbedLanguagesForPipeline: filteredSelection,
    });
  }, [
    hasLoadedDubbedLanguagesForPipeline,
    availableDubbedLanguagesForPipeline,
    selectedDubbedLanguagesForPipeline,
    updatePipelineConfig,
  ]);

  const togglePipelineDubbedLanguageSelection = useCallback(
    (languageCode: string) => {
      const normalized = normalizeLanguageCode(languageCode);
      if (!normalized) return;

      const currentSelection = selectedDubbedLanguagesForPipeline;

      if (currentSelection.includes(normalized)) {
        updatePipelineConfig({
          selectedDubbedLanguagesForPipeline: currentSelection.filter(
            (selectedLanguage) => selectedLanguage !== normalized,
          ),
        });
        return;
      }

      updatePipelineConfig({
        selectedDubbedLanguagesForPipeline: [...currentSelection, normalized],
      });
    },
    [selectedDubbedLanguagesForPipeline, updatePipelineConfig],
  );

  const handleTemplateContextDelete = (
    event: React.MouseEvent<HTMLButtonElement>,
    templateId: string,
    templateName: string,
  ) => {
    event.preventDefault();
    event.stopPropagation();

    const shouldDelete =
      typeof window === 'undefined'
        ? true
        : window.confirm(`Delete pipeline template "${templateName}"?`);

    if (!shouldDelete) return;

    deletePipelineTemplate(templateId);
    clearTemplateDragState();
  };

  const handleTemplateDragOver = (
    event: React.DragEvent<HTMLButtonElement>,
    templateId: string,
  ) => {
    if (!templateReorderEnabled) return;
    if (!draggingTemplateId || draggingTemplateId === templateId) return;
    event.preventDefault();

    if (dragOverTemplateId !== templateId) {
      setDragOverTemplateId(templateId);
    }
  };

  const handleTemplateDrop = (
    event: React.DragEvent<HTMLButtonElement>,
    templateId: string,
  ) => {
    if (!templateReorderEnabled) return;
    event.preventDefault();

    if (draggingTemplateId && draggingTemplateId !== templateId) {
      reorderPipelineTemplate(draggingTemplateId, templateId);
    }

    clearTemplateDragState();
  };

  const steps = [
    {
      key: 'scriptFromTitle' as const,
      label: 'Script From Title',
      color: 'text-amber-500',
    },
    {
      key: 'ttsScript' as const,
      label: 'TTS Script',
      color: 'text-orange-500',
    },
    {
      key: 'ttsVideo' as const,
      label: 'TTS Video',
      color: 'text-pink-500',
    },
    {
      key: 'normalizeAudio' as const,
      label: 'Normalize Audio',
      color: 'text-orange-500',
    },
    {
      key: 'convertToCFR' as const,
      label: 'Convert to CFR',
      color: 'text-indigo-500',
    },
    {
      key: 'optimizeSilence' as const,
      label: 'Optimize Silence',
      color: 'text-emerald-500',
    },
    { key: 'transcribe' as const, label: 'Transcribe', color: 'text-blue-500' },
    {
      key: 'generateScenes' as const,
      label: 'Generate Scenes',
      color: 'text-purple-500',
    },
    {
      key: 'deleteEmpty' as const,
      label: 'Delete Empty',
      color: 'text-red-500',
    },
    {
      key: 'generateClips' as const,
      label: 'Generate Clips',
      color: 'text-cyan-500',
    },
    { key: 'speedUp' as const, label: 'Speed Up', color: 'text-yellow-500' },
    {
      key: 'fixLanguageAll' as const,
      label: 'Fix Language All',
      color: 'text-emerald-500',
    },
    { key: 'improve' as const, label: 'Improve', color: 'text-pink-500' },
    {
      key: 'generateTTS' as const,
      label: 'Generate TTS',
      color: 'text-indigo-500',
    },
    { key: 'sync' as const, label: 'Sync Videos', color: 'text-green-500' },
    {
      key: 'transcribeScenesAfterSync' as const,
      label: 'Fix TTS',
      color: 'text-purple-500',
    },
    {
      key: 'fixFlaggedAfterFixTTS' as const,
      label: 'Fix Flagged',
      color: 'text-emerald-500',
    },
    {
      key: 'fixIntroQaAfterFixFlagged' as const,
      label: 'Fix Intro QA',
      color: 'text-cyan-500',
    },
    {
      key: 'promptScenesAfterTranscribe' as const,
      label: 'Prompt Scenes',
      color: 'text-indigo-500',
    },

    // Scene-level post-processing (batch ops)
    {
      key: 'generateSubtitles' as const,
      label: 'Subtitles',
      color: 'text-indigo-500',
    },
    {
      key: 'generateSceneImages' as const,
      label: 'Images',
      color: 'text-purple-500',
    },
    {
      key: 'upscaleSceneImages' as const,
      label: 'Upscale',
      color: 'text-emerald-500',
    },
    {
      key: 'generateSceneVideos' as const,
      label: 'Scene Videos',
      color: 'text-blue-500',
    },
    {
      key: 'enhanceSceneVideos' as const,
      label: 'Enhance Videos',
      color: 'text-pink-500',
    },
    {
      key: 'applyEnhancedVideos' as const,
      label: 'Apply Video',
      color: 'text-yellow-500',
    },
    {
      key: 'applyUpscaledImages' as const,
      label: 'Apply Image',
      color: 'text-cyan-500',
    },
    {
      key: 'mergeScenes' as const,
      label: 'Merge Scenes',
      color: 'text-orange-500',
    },
    {
      key: 'convertFinalToCFR' as const,
      label: 'CFR Final All',
      color: 'text-pink-500',
    },
    {
      key: 'transcribeFinalAll' as const,
      label: 'Transcribe Final All',
      color: 'text-purple-500',
    },
    {
      key: 'createEnSrt' as const,
      label: 'Create En Srt',
      color: 'text-lime-600',
    },
    {
      key: 'createDubbedLanguage' as const,
      label: 'Create Dubbed Lang',
      color: 'text-teal-600',
    },
    {
      key: 'generateYouTubeDescriptions' as const,
      label: 'Description',
      color: 'text-indigo-500',
    },
    {
      key: 'generateYouTubeKeywords' as const,
      label: 'Keywords',
      color: 'text-indigo-500',
    },
    {
      key: 'generateYouTubeTitles' as const,
      label: 'Titles',
      color: 'text-indigo-500',
    },
    {
      key: 'generateYouTubeTimestamps' as const,
      label: 'Timestamps',
      color: 'text-indigo-500',
    },
    {
      key: 'generateThumbnails' as const,
      label: 'Thumbnails',
      color: 'text-indigo-500',
    },
    {
      key: 'downloadAssetsZipAll' as const,
      label: 'Download ZIP All',
      color: 'text-blue-500',
    },
  ];

  const activeSteps = steps.filter((step) => pipelineConfig[step.key]);
  const combinePasses = [
    {
      letter: 'A' as const,
      enabledKey: 'combinePairsEnabledA' as const,
      skipKey: 'combinePairsSkipA' as const,
    },
    {
      letter: 'B' as const,
      enabledKey: 'combinePairsEnabledB' as const,
      skipKey: 'combinePairsSkipB' as const,
    },
    {
      letter: 'C' as const,
      enabledKey: 'combinePairsEnabledC' as const,
      skipKey: 'combinePairsSkipC' as const,
    },
    {
      letter: 'D' as const,
      enabledKey: 'combinePairsEnabledD' as const,
      skipKey: 'combinePairsSkipD' as const,
    },
  ];
  const enabledCombinePassCount = combinePasses.filter(
    (pass) => pipelineConfig[pass.enabledKey],
  ).length;
  const transcribeApplyPasses = [
    {
      letter: 'A' as const,
      enabledKey: 'transcribeApplyGenClips' as const,
      minCharsKey: 'transcribeApplyGenClipsMinChars' as const,
    },
    {
      letter: 'B' as const,
      enabledKey: 'transcribeApplyGenClipsEnabledB' as const,
      minCharsKey: 'transcribeApplyGenClipsMinCharsB' as const,
    },
    {
      letter: 'C' as const,
      enabledKey: 'transcribeApplyGenClipsEnabledC' as const,
      minCharsKey: 'transcribeApplyGenClipsMinCharsC' as const,
    },
    {
      letter: 'D' as const,
      enabledKey: 'transcribeApplyGenClipsEnabledD' as const,
      minCharsKey: 'transcribeApplyGenClipsMinCharsD' as const,
    },
  ];
  const enabledTranscribeApplyPassCount = transcribeApplyPasses.filter(
    (pass) => pipelineConfig[pass.enabledKey],
  ).length;
  const enabledStepsCount =
    activeSteps.length +
    enabledCombinePassCount +
    enabledTranscribeApplyPassCount;
  const totalStepCount =
    steps.length + combinePasses.length + transcribeApplyPasses.length;

  const stepsBeforeTranscribeApply = steps.slice(8, 10); // deleteEmpty, generateClips
  const stepsAfterTranscribeApply = steps.slice(10); // speedUp onward
  const firstStepAfterCombine = 8 + combinePasses.length;
  const transcribeApplyStartNumber =
    firstStepAfterCombine + stepsBeforeTranscribeApply.length + 1;
  const stepsAfterTranscribeApplyStartNumber =
    transcribeApplyStartNumber + transcribeApplyPasses.length;

  const matchingTemplateIds = useMemo(() => {
    const configKeys = Object.keys(pipelineConfig) as Array<
      keyof typeof pipelineConfig
    >;

    const matchedIds = pipelineTemplates
      .filter((template) =>
        configKeys.every((key) =>
          arePipelineConfigValuesEqual(
            template.config[key],
            pipelineConfig[key],
          ),
        ),
      )
      .map((template) => template.id);

    return new Set(matchedIds);
  }, [pipelineConfig, pipelineTemplates]);

  return (
    <div className='pipeline-panel-flat bg-white rounded-lg border border-gray-200 overflow-hidden'>
      {/* Header */}
      <button
        onClick={() => setIsExpanded(!isExpanded)}
        className='w-full px-6 py-4 flex items-center justify-between hover:bg-gray-50 transition-colors'
      >
        <div className='flex items-center gap-3'>
          <Settings2 className='w-5 h-5 text-purple-600' />
          <div className='text-left'>
            <h2 className='text-lg font-semibold text-gray-900'>
              Pipeline Configuration
            </h2>
            <p className='text-sm text-gray-500'>
              {enabledStepsCount} of {totalStepCount} steps enabled
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

      {!isExpanded && (
        <div className='px-6 pb-3'>
          <div className='flex items-center justify-end gap-2 overflow-x-auto'>
            <button
              onClick={onRunFullPipeline}
              disabled={isRunFullPipelineDisabled || !onRunFullPipeline}
              className='inline-flex items-center justify-center gap-1.5 px-2.5 py-1 rounded-md bg-purple-600 hover:bg-purple-700 disabled:bg-purple-300 text-white text-xs font-semibold transition-colors disabled:cursor-not-allowed whitespace-nowrap'
              title={runFullPipelineTitle}
            >
              <Workflow
                className={`w-3.5 h-3.5 ${isRunningFullPipeline ? 'animate-pulse' : ''}`}
              />
              <span className='truncate'>Full Pipeline</span>
            </button>

            {pipelineTemplates.map((template) => {
              const isMatchedTemplate = matchingTemplateIds.has(template.id);
              const isDragOverTarget =
                templateReorderEnabled &&
                dragOverTemplateId === template.id &&
                draggingTemplateId !== template.id;

              return (
                <button
                  key={template.id}
                  draggable={templateReorderEnabled}
                  onClick={() => {
                    if (templateReorderEnabled) return;
                    applyPipelineTemplate(template.id);
                  }}
                  onContextMenu={(event) =>
                    handleTemplateContextDelete(
                      event,
                      template.id,
                      template.name,
                    )
                  }
                  onDragStart={() => {
                    if (!templateReorderEnabled) return;
                    setDraggingTemplateId(template.id);
                    setDragOverTemplateId(null);
                  }}
                  onDragOver={(event) =>
                    handleTemplateDragOver(event, template.id)
                  }
                  onDrop={(event) => handleTemplateDrop(event, template.id)}
                  onDragEnd={clearTemplateDragState}
                  className={`text-xs px-2.5 py-1 rounded-full border font-medium transition-colors whitespace-nowrap ${
                    templateReorderEnabled
                      ? 'cursor-grab active:cursor-grabbing'
                      : 'cursor-pointer'
                  } ${
                    isMatchedTemplate
                      ? 'border-purple-600 bg-purple-600 text-white hover:bg-purple-700'
                      : 'border-purple-200 bg-white text-purple-700 hover:bg-purple-50'
                  } ${isDragOverTarget ? 'ring-2 ring-purple-400 ring-offset-1' : ''}`}
                  title={`Apply template: ${template.name}${
                    isMatchedTemplate ? ' (matches current selection)' : ''
                  }. Right-click to delete.${
                    templateReorderEnabled
                      ? ' Drag to reorder is enabled.'
                      : ' Drag to reorder is disabled (toggle Reorder ON to enable).'
                  }`}
                >
                  {template.name}
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* Expanded Content */}
      {isExpanded && (
        <div className='px-5 py-3 bg-gray-50 border-t border-gray-200'>
          <div className='flex flex-col gap-3 mb-4 lg:flex-row lg:items-center lg:justify-between'>
            <p className='text-xs text-gray-600'>Select Pipelines</p>
            <div className='flex flex-wrap items-center justify-end gap-2 lg:ml-auto'>
              <button
                onClick={onRunFullPipeline}
                disabled={isRunFullPipelineDisabled || !onRunFullPipeline}
                className='inline-flex items-center justify-center gap-2 px-3 py-1.5 rounded-md bg-purple-600 hover:bg-purple-700 disabled:bg-purple-300 text-white text-sm font-semibold transition-colors disabled:cursor-not-allowed'
                title={runFullPipelineTitle}
              >
                <Workflow
                  className={`w-4 h-4 ${isRunningFullPipeline ? 'animate-pulse' : ''}`}
                />
                <span className='truncate'>{runFullPipelineLabel}</span>
              </button>

              <button
                onClick={openSaveTemplateModal}
                className='text-sm px-3 py-1.5 rounded-md border border-purple-300 text-purple-700 hover:bg-purple-50 font-medium transition-colors'
              >
                Save Template
              </button>

              <button
                onClick={() =>
                  setIsTemplateReorderMode((currentValue) => !currentValue)
                }
                className={`text-sm px-3 py-1.5 rounded-md border font-medium transition-colors ${
                  isTemplateReorderMode
                    ? 'border-amber-500 bg-amber-50 text-amber-700 hover:bg-amber-100'
                    : 'border-purple-300 bg-white text-purple-700 hover:bg-purple-50'
                }`}
                title={
                  isTemplateReorderMode
                    ? 'Template reorder mode is ON. Drag template chips to reorder, then turn this OFF for normal fast selection.'
                    : 'Template reorder mode is OFF. Turn ON to drag and reorder templates.'
                }
              >
                {isTemplateReorderMode ? 'Reorder: ON' : 'Reorder: OFF'}
              </button>

              {pipelineTemplates.map((template) => {
                const isMatchedTemplate = matchingTemplateIds.has(template.id);
                const isDragOverTarget =
                  templateReorderEnabled &&
                  dragOverTemplateId === template.id &&
                  draggingTemplateId !== template.id;

                return (
                  <button
                    key={template.id}
                    draggable={templateReorderEnabled}
                    onClick={() => {
                      if (templateReorderEnabled) return;
                      applyPipelineTemplate(template.id);
                    }}
                    onContextMenu={(event) =>
                      handleTemplateContextDelete(
                        event,
                        template.id,
                        template.name,
                      )
                    }
                    onDragStart={() => {
                      if (!templateReorderEnabled) return;
                      setDraggingTemplateId(template.id);
                      setDragOverTemplateId(null);
                    }}
                    onDragOver={(event) =>
                      handleTemplateDragOver(event, template.id)
                    }
                    onDrop={(event) => handleTemplateDrop(event, template.id)}
                    onDragEnd={clearTemplateDragState}
                    className={`text-xs sm:text-sm px-3 py-1.5 rounded-full border font-medium transition-colors ${
                      templateReorderEnabled
                        ? 'cursor-grab active:cursor-grabbing'
                        : 'cursor-pointer'
                    } ${
                      isMatchedTemplate
                        ? 'border-purple-600 bg-purple-600 text-white hover:bg-purple-700'
                        : 'border-purple-200 bg-white text-purple-700 hover:bg-purple-50'
                    } ${isDragOverTarget ? 'ring-2 ring-purple-400 ring-offset-1' : ''}`}
                    title={`Apply template: ${template.name}${
                      isMatchedTemplate ? ' (matches current selection)' : ''
                    }. Right-click to delete.${
                      templateReorderEnabled
                        ? ' Drag to reorder is enabled.'
                        : ' Drag to reorder is disabled (toggle Reorder ON to enable).'
                    }`}
                  >
                    {template.name}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Pipeline Steps Grid */}
          <div className='grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-8 gap-2'>
            {/* Steps 1–8: scriptFromTitle → generateScenes */}
            {steps.slice(0, 8).map((step, index) => {
              const isEnabled = pipelineConfig[step.key];
              return (
                <button
                  key={step.key}
                  onClick={() => togglePipelineStep(step.key)}
                  className={`
                    relative flex flex-col items-center gap-1.5 p-2.5 rounded-md border-2 transition-all
                    ${
                      isEnabled
                        ? 'border-purple-500 bg-purple-50 shadow-sm'
                        : 'border-gray-200 bg-white hover:border-gray-300'
                    }
                  `}
                >
                  {/* Checkbox Icon */}
                  <div className='relative'>
                    {isEnabled ? (
                      <CheckCircle2
                        className={`w-5 h-5 ${step.color}`}
                        strokeWidth={2.5}
                      />
                    ) : (
                      <Circle className='w-5 h-5 text-gray-300' />
                    )}
                  </div>

                  {/* Step Label */}
                  <span
                    className={`text-xs font-medium leading-tight text-center ${
                      isEnabled ? 'text-gray-900' : 'text-gray-500'
                    }`}
                  >
                    {step.label}
                  </span>

                  {/* Step Number Badge */}
                  <span
                    className={`
                    absolute -top-1.5 -right-1.5 w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold
                    ${
                      isEnabled
                        ? 'bg-purple-600 text-white'
                        : 'bg-gray-200 text-gray-500'
                    }
                  `}
                  >
                    {index + 1}
                  </span>
                </button>
              );
            })}

            {/* Steps 9–12: Combine Pairs A/B/C/D with toggle + skip value */}
            {combinePasses.map((pass, i) => {
              const isEnabled = pipelineConfig[pass.enabledKey];
              const val = pipelineConfig[pass.skipKey];
              return (
                <div
                  key={pass.enabledKey}
                  className={`relative flex flex-col items-center justify-between gap-1 p-2 rounded-md border-2 transition-all ${
                    isEnabled
                      ? 'border-violet-500 bg-violet-50 shadow-sm'
                      : 'border-gray-200 bg-white'
                  }`}
                >
                  <button
                    type='button'
                    onClick={() => togglePipelineStep(pass.enabledKey)}
                    className='flex items-center justify-center'
                  >
                    {isEnabled ? (
                      <CheckCircle2
                        className='w-5 h-5 text-violet-500'
                        strokeWidth={2.5}
                      />
                    ) : (
                      <Circle className='w-5 h-5 text-gray-300' />
                    )}
                  </button>
                  <span className='text-xs font-medium leading-tight text-gray-900 text-center'>
                    Combine {pass.letter}
                  </span>
                  <div className='flex items-center gap-1'>
                    <span className='text-[10px] font-semibold text-violet-600 uppercase tracking-wide'>
                      Skip
                    </span>
                    <input
                      type='number'
                      min={1}
                      value={val}
                      onChange={(e) => {
                        const raw = parseInt(e.target.value, 10);
                        if (!isNaN(raw) && raw >= 1) {
                          updatePipelineConfig({ [pass.skipKey]: raw });
                        }
                      }}
                      onClick={(e) => e.stopPropagation()}
                      disabled={!isEnabled}
                      className='w-14 h-6 text-center text-[11px] font-medium border border-violet-300 rounded px-1 bg-white disabled:bg-gray-100 disabled:text-gray-400 focus:outline-none focus:ring-1 focus:ring-violet-500'
                    />
                  </div>
                  <span
                    className={`absolute -top-1.5 -right-1.5 w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold ${
                      isEnabled
                        ? 'bg-violet-600 text-white'
                        : 'bg-gray-200 text-gray-500'
                    }`}
                  >
                    {9 + i}
                  </span>
                </div>
              );
            })}

            {/* Steps 13–14: deleteEmpty + generateClips */}
            {stepsBeforeTranscribeApply.map((step, index) => {
              const isEnabled = pipelineConfig[step.key];

              return (
                <button
                  key={step.key}
                  onClick={() => togglePipelineStep(step.key)}
                  className={`
                    relative flex flex-col items-center gap-1.5 p-2.5 rounded-md border-2 transition-all
                    ${
                      isEnabled
                        ? 'border-purple-500 bg-purple-50 shadow-sm'
                        : 'border-gray-200 bg-white hover:border-gray-300'
                    }
                  `}
                >
                  {/* Checkbox Icon */}
                  <div className='relative'>
                    {isEnabled ? (
                      <CheckCircle2
                        className={`w-5 h-5 ${step.color}`}
                        strokeWidth={2.5}
                      />
                    ) : (
                      <Circle className='w-5 h-5 text-gray-300' />
                    )}
                  </div>

                  {/* Step Label */}
                  <span
                    className={`text-xs font-medium leading-tight text-center ${
                      isEnabled ? 'text-gray-900' : 'text-gray-500'
                    }`}
                  >
                    {step.label}
                  </span>

                  {/* Step Number Badge */}
                  <span
                    className={`
                    absolute -top-1.5 -right-1.5 w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold
                    ${
                      isEnabled
                        ? 'bg-purple-600 text-white'
                        : 'bg-gray-200 text-gray-500'
                    }
                  `}
                  >
                    {firstStepAfterCombine + index + 1}
                  </span>
                </button>
              );
            })}

            {/* Steps 15–18: Trans Apply Gen A/B/C/D with toggle + min value */}
            {transcribeApplyPasses.map((pass, index) => {
              const isEnabled = pipelineConfig[pass.enabledKey];
              const minChars = Math.max(
                0,
                Math.floor(pipelineConfig[pass.minCharsKey]),
              );

              return (
                <div
                  key={pass.enabledKey}
                  className={`relative flex flex-col items-center justify-between gap-1 p-2 rounded-md border-2 transition-all ${
                    isEnabled
                      ? 'border-orange-500 bg-orange-50 shadow-sm'
                      : 'border-gray-200 bg-white'
                  }`}
                >
                  <button
                    type='button'
                    onClick={() => togglePipelineStep(pass.enabledKey)}
                    className='flex items-center justify-center'
                  >
                    {isEnabled ? (
                      <CheckCircle2
                        className='w-5 h-5 text-orange-500'
                        strokeWidth={2.5}
                      />
                    ) : (
                      <Circle className='w-5 h-5 text-gray-300' />
                    )}
                  </button>

                  <span className='text-[11px] font-medium leading-tight text-gray-900 text-center'>
                    Trans Apply Gen {pass.letter}
                  </span>

                  <div className='flex items-center gap-1'>
                    <span className='text-[10px] font-semibold text-orange-600 uppercase tracking-wide'>
                      Min
                    </span>
                    <input
                      type='number'
                      min={0}
                      step={1}
                      value={minChars}
                      onChange={(e) => {
                        const raw = parseInt(e.target.value, 10);
                        updatePipelineConfig({
                          [pass.minCharsKey]: !isNaN(raw) && raw >= 0 ? raw : 0,
                        });
                      }}
                      onClick={(e) => e.stopPropagation()}
                      disabled={!isEnabled}
                      className='w-14 h-6 text-center text-[11px] font-medium border border-orange-300 rounded px-1 bg-white disabled:bg-gray-100 disabled:text-gray-400 focus:outline-none focus:ring-1 focus:ring-orange-500'
                      title='Only scenes with Sentence (6890) length greater than or equal to this value are processed'
                    />
                  </div>

                  <span
                    className={`absolute -top-1.5 -right-1.5 w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold ${
                      isEnabled
                        ? 'bg-orange-600 text-white'
                        : 'bg-gray-200 text-gray-500'
                    }`}
                  >
                    {transcribeApplyStartNumber + index}
                  </span>
                </div>
              );
            })}

            {/* Remaining steps: speedUp onwards */}
            {stepsAfterTranscribeApply.map((step, index) => {
              const isEnabled = pipelineConfig[step.key];

              return (
                <button
                  key={step.key}
                  onClick={() => togglePipelineStep(step.key)}
                  className={`
                    relative flex flex-col items-center gap-1.5 p-2.5 rounded-md border-2 transition-all
                    ${
                      isEnabled
                        ? 'border-purple-500 bg-purple-50 shadow-sm'
                        : 'border-gray-200 bg-white hover:border-gray-300'
                    }
                  `}
                >
                  {/* Checkbox Icon */}
                  <div className='relative'>
                    {isEnabled ? (
                      <CheckCircle2
                        className={`w-5 h-5 ${step.color}`}
                        strokeWidth={2.5}
                      />
                    ) : (
                      <Circle className='w-5 h-5 text-gray-300' />
                    )}
                  </div>

                  {/* Step Label */}
                  <span
                    className={`text-xs font-medium leading-tight text-center ${
                      isEnabled ? 'text-gray-900' : 'text-gray-500'
                    }`}
                  >
                    {step.label}
                  </span>

                  {/* Step Number Badge */}
                  <span
                    className={`
                    absolute -top-1.5 -right-1.5 w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold
                    ${
                      isEnabled
                        ? 'bg-purple-600 text-white'
                        : 'bg-gray-200 text-gray-500'
                    }
                  `}
                  >
                    {stepsAfterTranscribeApplyStartNumber + index}
                  </span>
                </button>
              );
            })}

            {/* Pipeline override: Dubbed language multi-select */}
            {pipelineConfig.createDubbedLanguage && (
              <div className='col-span-full rounded-md border border-teal-200 bg-teal-50 p-3'>
                <div className='flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between'>
                  <div>
                    <p className='text-xs font-semibold text-teal-900'>
                      Create Dubbed Lang — Pipeline Language Override
                    </p>
                    <p className='text-[11px] text-teal-700'>
                      Select one or more languages for pipeline execution. Order
                      follows your selection clicks. When empty, pipeline falls
                      back to the batch-panel language selection.
                    </p>
                  </div>
                  <button
                    type='button'
                    onClick={() => {
                      void loadAvailableDubbedLanguagesForPipeline();
                    }}
                    disabled={
                      isRunningFullPipeline || loadingDubbedLanguagesForPipeline
                    }
                    className='self-start rounded-md border border-teal-300 bg-white px-2 py-1 text-[11px] font-medium text-teal-800 hover:bg-teal-100 disabled:cursor-not-allowed disabled:opacity-60'
                    title='Reload available dubbed languages from Global TTS presets'
                  >
                    {loadingDubbedLanguagesForPipeline ? 'Loading…' : 'Reload'}
                  </button>
                </div>

                <div className='mt-2 flex flex-wrap gap-1'>
                  {selectedDubbedLanguagesForPipeline.length > 0 ? (
                    selectedDubbedLanguagesForPipeline.map(
                      (languageCode, index) => (
                        <span
                          key={languageCode}
                          className='inline-flex items-center rounded-full border border-teal-300 bg-white px-2 py-0.5 text-[11px] font-medium text-teal-900'
                          title={`Execution order ${index + 1}`}
                        >
                          {index + 1}. {getLanguageDisplayName(languageCode)} (
                          {languageCode.toUpperCase()})
                        </span>
                      ),
                    )
                  ) : (
                    <span className='text-[11px] text-teal-700'>
                      No pipeline override selected.
                    </span>
                  )}
                </div>

                <details
                  className={`mt-2 rounded-md border border-teal-200 bg-white p-2 ${
                    isRunningFullPipeline
                      ? 'pointer-events-none opacity-60'
                      : ''
                  }`}
                >
                  <summary className='cursor-pointer text-[11px] font-medium text-teal-900'>
                    Choose pipeline dubbed languages
                  </summary>

                  <div className='mt-2 grid grid-cols-2 gap-2 sm:grid-cols-3 md:grid-cols-4'>
                    {availableDubbedLanguagesForPipeline.map((languageCode) => {
                      const isSelected =
                        selectedDubbedLanguagesForPipeline.includes(
                          languageCode,
                        );

                      return (
                        <label
                          key={languageCode}
                          className='inline-flex items-center gap-1 rounded border border-teal-200 px-2 py-1 text-[11px] text-teal-900'
                        >
                          <input
                            type='checkbox'
                            checked={isSelected}
                            onChange={() =>
                              togglePipelineDubbedLanguageSelection(
                                languageCode,
                              )
                            }
                            disabled={isRunningFullPipeline}
                            className='h-3.5 w-3.5 rounded border-teal-400 text-teal-600 focus:ring-teal-500'
                          />
                          <span>
                            {getLanguageDisplayName(languageCode)} (
                            {languageCode.toUpperCase()})
                          </span>
                        </label>
                      );
                    })}
                  </div>
                </details>
              </div>
            )}
          </div>

          {/* Save Template Modal */}
          {isSaveTemplateModalOpen && (
            <div
              className='fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4'
              onClick={closeSaveTemplateModal}
            >
              <div
                className='w-full max-w-md bg-white rounded-xl shadow-xl border border-gray-200 p-5'
                onClick={(e) => e.stopPropagation()}
              >
                <h3 className='text-base font-semibold text-gray-900'>
                  Save Pipeline Template
                </h3>
                <p className='text-sm text-gray-600 mt-1'>
                  Name this template to reuse the current pipeline selection.
                </p>

                <input
                  type='text'
                  value={templateName}
                  onChange={(e) => {
                    setTemplateName(e.target.value);
                    if (templateNameError) setTemplateNameError('');
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      handleSaveTemplate();
                    }
                    if (e.key === 'Escape') {
                      e.preventDefault();
                      closeSaveTemplateModal();
                    }
                  }}
                  placeholder='e.g. YouTube Full Auto'
                  autoFocus
                  className='mt-4 w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-purple-500 focus:border-purple-500'
                />

                {templateNameError && (
                  <p className='mt-2 text-xs text-red-600'>
                    {templateNameError}
                  </p>
                )}

                <p className='mt-2 text-xs text-gray-500'>
                  Tip: using an existing name updates that template.
                </p>

                <div className='mt-5 flex items-center justify-end gap-2'>
                  <button
                    onClick={closeSaveTemplateModal}
                    className='px-3 py-1.5 text-sm rounded-md border border-gray-300 text-gray-700 hover:bg-gray-50'
                  >
                    Cancel
                  </button>
                  <button
                    onClick={handleSaveTemplate}
                    className='px-3 py-1.5 text-sm rounded-md bg-purple-600 text-white hover:bg-purple-700 disabled:opacity-60 disabled:cursor-not-allowed'
                    disabled={!templateName.trim()}
                  >
                    Save
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      <style jsx>{`
        .pipeline-panel-flat :is(button, [role='button']) {
          transition: none !important;
          box-shadow: none !important;
        }

        .pipeline-panel-flat
          :is(.shadow-sm, .shadow-md, .shadow-lg, .shadow-xl) {
          box-shadow: none !important;
        }
      `}</style>
    </div>
  );
}
