'use client';

import { useAppStore } from '@/store/useAppStore';
import { CheckCircle2, Circle, Settings2 } from 'lucide-react';
import { useState } from 'react';

export default function PipelineConfig() {
  const { pipelineConfig, togglePipelineStep, resetPipelineConfig } =
    useAppStore();
  const [isExpanded, setIsExpanded] = useState(false);

  const steps = [
    {
      key: 'ttsScript' as const,
      label: 'TTS Script',
      color: 'text-orange-500',
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
      label: 'Transcribe Scenes',
      color: 'text-purple-500',
    },
    {
      key: 'promptScenesAfterTranscribe' as const,
      label: 'Prompt Scenes',
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
            {steps.map((step) => {
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
                    {steps.indexOf(step) + 1}
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
              {activeSteps.length > 0 ? (
                activeSteps.map((step, index) => (
                  <div key={step.key} className='flex items-center gap-2'>
                    <span
                      className={`px-3 py-1 rounded-full text-sm font-medium bg-purple-100 text-purple-700`}
                    >
                      {step.label}
                    </span>
                    {index < activeSteps.length - 1 && (
                      <span className='text-gray-400'>→</span>
                    )}
                  </div>
                ))
              ) : (
                <span className='text-sm text-gray-500 italic'>
                  No steps selected. The pipeline will do nothing.
                </span>
              )}
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
