'use client';

import { useAppStore } from '@/store/useAppStore';
import { CheckCircle2, Circle, Settings2 } from 'lucide-react';
import { useState } from 'react';

export default function PipelineConfig() {
  const {
    pipelineConfig,
    togglePipelineStep,
    resetPipelineConfig,
    updatePipelineConfig,
  } = useAppStore();
  const [isExpanded, setIsExpanded] = useState(false);

  const steps = [
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
  const allSelected = steps.every((step) => pipelineConfig[step.key]);

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
              {activeSteps.length} of {steps.length} steps enabled
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
        <div className='px-6 py-4 bg-gray-50 border-t border-gray-200'>
          <div className='flex items-center justify-between mb-4'>
            <p className='text-sm text-gray-600'>
              Select which steps to include in the Full Pipeline execution
            </p>
            <button
              onClick={resetPipelineConfig}
              className='text-sm text-purple-600 hover:text-purple-700 font-medium'
            >
              Reset to Default
            </button>
          </div>

          {/* Pipeline Steps Grid */}
          <div className='grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3'>
            {/* Steps 1–7: ttsScript → generateScenes */}
            {steps.slice(0, 7).map((step, index) => {
              const isEnabled = pipelineConfig[step.key];
              return (
                <button
                  key={step.key}
                  onClick={() => togglePipelineStep(step.key)}
                  className={`
                    relative flex flex-col items-center gap-2 p-4 rounded-lg border-2 transition-all
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
                        className={`w-6 h-6 ${step.color}`}
                        strokeWidth={2.5}
                      />
                    ) : (
                      <Circle className='w-6 h-6 text-gray-300' />
                    )}
                  </div>

                  {/* Step Label */}
                  <span
                    className={`text-sm font-medium text-center ${
                      isEnabled ? 'text-gray-900' : 'text-gray-500'
                    }`}
                  >
                    {step.label}
                  </span>

                  {/* Step Number Badge */}
                  <span
                    className={`
                    absolute -top-2 -right-2 w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold
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

            {/* Steps 8–11: Combine Pairs A/B/C/D — always active, each with its own skip value */}
            {(['A', 'B', 'C', 'D'] as const).map((letter, i) => {
              const key = `combinePairsSkip${letter}` as
                | 'combinePairsSkipA'
                | 'combinePairsSkipB'
                | 'combinePairsSkipC'
                | 'combinePairsSkipD';
              const val = pipelineConfig[key];
              return (
                <div
                  key={key}
                  className='relative flex flex-col items-center gap-2 p-3 rounded-lg border-2 border-violet-500 bg-violet-50 shadow-sm'
                >
                  <span className='text-xs font-semibold text-violet-600 uppercase tracking-wide'>
                    Skip
                  </span>
                  <input
                    type='number'
                    min={1}
                    value={val}
                    onChange={(e) => {
                      const raw = parseInt(e.target.value, 10);
                      if (!isNaN(raw) && raw >= 1) {
                        updatePipelineConfig({ [key]: raw });
                      }
                    }}
                    onClick={(e) => e.stopPropagation()}
                    className='w-full text-center text-sm font-medium border border-violet-300 rounded px-1 py-0.5 bg-white focus:outline-none focus:ring-1 focus:ring-violet-500'
                  />
                  <span className='text-sm font-medium text-gray-900 text-center'>
                    Combine {letter}
                  </span>
                  <span className='absolute -top-2 -right-2 w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold bg-violet-600 text-white'>
                    {8 + i}
                  </span>
                </div>
              );
            })}

            {/* Steps 12+: deleteEmpty onwards */}
            {steps.slice(7).map((step, index) => {
              const isEnabled = pipelineConfig[step.key];
              return (
                <button
                  key={step.key}
                  onClick={() => togglePipelineStep(step.key)}
                  className={`
                    relative flex flex-col items-center gap-2 p-4 rounded-lg border-2 transition-all
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
                        className={`w-6 h-6 ${step.color}`}
                        strokeWidth={2.5}
                      />
                    ) : (
                      <Circle className='w-6 h-6 text-gray-300' />
                    )}
                  </div>

                  {/* Step Label */}
                  <span
                    className={`text-sm font-medium text-center ${
                      isEnabled ? 'text-gray-900' : 'text-gray-500'
                    }`}
                  >
                    {step.label}
                  </span>

                  {/* Step Number Badge */}
                  <span
                    className={`
                    absolute -top-2 -right-2 w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold
                    ${
                      isEnabled
                        ? 'bg-purple-600 text-white'
                        : 'bg-gray-200 text-gray-500'
                    }
                  `}
                  >
                    {12 + index}
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
                  'ttsScript',
                  'ttsVideo',
                  'normalizeAudio',
                  'convertToCFR',
                  'optimizeSilence',
                  'transcribe',
                  'generateScenes',
                ];
                const combineItems = (['A', 'B', 'C', 'D'] as const).map(
                  (letter) => ({
                    key: `combinePairsFlow${letter}`,
                    label: `Combine ${letter}`,
                    isCombine: true,
                  }),
                );
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
          {activeSteps.length === 0 && (
            <div className='mt-4 p-3 bg-yellow-50 border border-yellow-200 rounded-lg'>
              <p className='text-sm text-yellow-800'>
                ⚠️ Warning: No steps are selected. The Full Pipeline button will
                not perform any operations.
              </p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
