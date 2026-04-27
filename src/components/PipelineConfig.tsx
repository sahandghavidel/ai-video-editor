'use client';

import { useAppStore } from '@/store/useAppStore';
import { CheckCircle2, Circle, Settings2, Workflow } from 'lucide-react';
import { useState } from 'react';

interface PipelineConfigProps {
  onRunFullPipeline?: () => void;
  isRunFullPipelineDisabled?: boolean;
  isRunningFullPipeline?: boolean;
  runFullPipelineLabel?: string;
  runFullPipelineTitle?: string;
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
  } = useAppStore();
  const [isExpanded, setIsExpanded] = useState(false);
  const [isSaveTemplateModalOpen, setIsSaveTemplateModalOpen] = useState(false);
  const [templateName, setTemplateName] = useState('');
  const [templateNameError, setTemplateNameError] = useState('');

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
  const enabledStepsCount = activeSteps.length + enabledCombinePassCount;

  return (
    <div className='bg-white rounded-lg shadow-sm border border-gray-200 overflow-hidden'>
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
              {enabledStepsCount} of {steps.length + combinePasses.length} steps
              enabled
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

      {/* Expanded Content */}
      {isExpanded && (
        <div className='px-5 py-3 bg-gray-50 border-t border-gray-200'>
          <div className='flex flex-col gap-3 mb-4 lg:flex-row lg:items-center lg:justify-between'>
            <p className='text-xs text-gray-600'>Select Pipelines</p>
            <div className='flex flex-wrap items-center gap-2'>
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

              {pipelineTemplates.map((template) => (
                <button
                  key={template.id}
                  onClick={() => applyPipelineTemplate(template.id)}
                  className='text-xs sm:text-sm px-3 py-1.5 rounded-full border border-purple-200 bg-white text-purple-700 hover:bg-purple-50 font-medium transition-colors'
                  title={`Apply template: ${template.name}`}
                >
                  {template.name}
                </button>
              ))}
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

            {/* Steps 13+: deleteEmpty onwards */}
            {steps.slice(8).map((step, index) => {
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
                    {13 + index}
                  </span>
                </button>
              );
            })}
          </div>

          {/* Pipeline Flow Preview */}
          <div className='mt-6 p-4 bg-white rounded-lg border border-gray-200'>
            <h3 className='text-sm font-semibold text-gray-700 mb-3'>
              Enabled Pipeline Flow:
            </h3>
            <div className='flex flex-wrap items-center gap-2'>
              {(() => {
                const beforeCombineKeys = [
                  'scriptFromTitle',
                  'ttsScript',
                  'ttsVideo',
                  'normalizeAudio',
                  'convertToCFR',
                  'optimizeSilence',
                  'transcribe',
                  'generateScenes',
                ];
                const combineItems = combinePasses
                  .filter((pass) => pipelineConfig[pass.enabledKey])
                  .map((pass) => ({
                    key: `combinePairsFlow${pass.letter}`,
                    label: `Combine ${pass.letter}`,
                    isCombine: true,
                  }));
                const flowItems = [
                  ...activeSteps
                    .filter((s) => beforeCombineKeys.includes(s.key))
                    .map((s) => ({
                      key: s.key,
                      label: s.label,
                      isCombine: false,
                    })),
                  ...combineItems,
                  ...activeSteps
                    .filter((s) => !beforeCombineKeys.includes(s.key))
                    .map((s) => ({
                      key: s.key,
                      label: s.label,
                      isCombine: false,
                    })),
                ];
                if (flowItems.length === 0) {
                  return (
                    <span className='text-sm text-gray-500 italic'>
                      No steps selected. The pipeline will do nothing.
                    </span>
                  );
                }
                return flowItems.map((item, index) => (
                  <div key={item.key} className='flex items-center gap-2'>
                    <span
                      className={`px-3 py-1 rounded-full text-sm font-medium ${
                        item.isCombine
                          ? 'bg-violet-100 text-violet-700'
                          : 'bg-purple-100 text-purple-700'
                      }`}
                    >
                      {item.label}
                    </span>
                    {index < flowItems.length - 1 && (
                      <span className='text-gray-400'>→</span>
                    )}
                  </div>
                ));
              })()}
            </div>
          </div>

          {/* Warning if no steps selected */}
          {enabledStepsCount === 0 && (
            <div className='mt-4 p-3 bg-yellow-50 border border-yellow-200 rounded-lg'>
              <p className='text-sm text-yellow-800'>
                ⚠️ Warning: No steps are selected. The Full Pipeline button will
                not perform any operations.
              </p>
            </div>
          )}

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
    </div>
  );
}
