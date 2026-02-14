'use client';

import { useAppStore } from '@/store/useAppStore';
import { Mic } from 'lucide-react';

export default function TranscriptionModelSelection() {
  const { transcriptionSettings, updateTranscriptionSettings } = useAppStore();

  const transcriptionModels = [
    {
      id: 'parakeet',
      name: 'Parakeet',
      description: '',
      recommended: false,
    },
    {
      id: 'small',
      name: 'Small',
      description: '',
      recommended: true,
    },
    {
      id: 'tiny',
      name: 'Tiny',
      description: '',
      recommended: false,
    },
  ];

  return (
    <div className='p-3 rounded-lg border border-gray-200 bg-white shadow-sm hover:shadow-md transition-shadow duration-200'>
      {/* Header - Compact */}
      <div className='flex items-center space-x-2 mb-3'>
        <Mic className='w-4 h-4 text-green-500' />
        <div>
          <h3 className='text-sm font-semibold text-gray-900'>Transcription</h3>
          <div className='flex items-center space-x-1'>
            <span className='px-1.5 py-0.5 bg-green-100 text-green-600 text-xs rounded-full'>
              Speech-to-Text
            </span>
          </div>
        </div>
      </div>

      {/* Content - Compact */}
      <div className='space-y-3'>
        {/* Model Selection - Compact */}
        <div className='space-y-2'>
          <div className='grid gap-2'>
            {transcriptionModels.map((model) => (
              <div
                key={model.id}
                className={`relative p-3 border rounded-lg cursor-pointer transition-all duration-200 ${
                  transcriptionSettings.selectedModel === model.id
                    ? 'border-blue-500 bg-blue-50'
                    : 'border-gray-200 bg-white hover:border-gray-300'
                }`}
                onClick={() =>
                  updateTranscriptionSettings({ selectedModel: model.id })
                }
              >
                <div className='flex items-start justify-between'>
                  <div className='flex-1'>
                    <div className='flex items-center space-x-2 mb-1'>
                      <h4 className='text-sm font-medium text-gray-900'>
                        {model.name}
                      </h4>
                      {model.recommended && (
                        <span className='px-1.5 py-0.5 bg-green-100 text-green-700 text-xs rounded-full'>
                          Rec
                        </span>
                      )}
                    </div>
                  </div>
                  <div className='ml-2'>
                    {transcriptionSettings.selectedModel === model.id ? (
                      <div className='w-4 h-4 bg-blue-500 rounded-full flex items-center justify-center'>
                        <div className='w-1.5 h-1.5 bg-white rounded-full'></div>
                      </div>
                    ) : (
                      <div className='w-4 h-4 border-2 border-gray-300 rounded-full'></div>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Options */}
        <div className='pt-1 border-t border-gray-200'>
          <label className='flex items-center justify-between gap-3 text-sm text-gray-700 select-none cursor-pointer'>
            <span>
              Skip flagged scenes
              <span className='ml-2 text-xs text-gray-400'>
                (applies to Subtitles batch)
              </span>
            </span>
            <input
              type='checkbox'
              className='h-4 w-4 accent-blue-600'
              checked={Boolean(
                transcriptionSettings.skipFlaggedScenesInSubtitleBatch,
              )}
              onChange={(e) =>
                updateTranscriptionSettings({
                  skipFlaggedScenesInSubtitleBatch: e.target.checked,
                })
              }
            />
          </label>
        </div>
      </div>
    </div>
  );
}
