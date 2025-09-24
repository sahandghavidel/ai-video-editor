'use client';

import { useAppStore } from '@/store/useAppStore';
import { Mic, Settings } from 'lucide-react';

export default function TranscriptionModelSelection() {
  const { transcriptionSettings, updateTranscriptionSettings } = useAppStore();

  const transcriptionModels = [
    {
      id: 'parakeet',
      name: 'Parakeet (High Quality)',
      description:
        'Advanced transcription model with excellent accuracy but higher resource usage',
      recommended: false,
    },
    {
      id: 'small',
      name: 'Quality with Punctuation',
      description:
        'Whisper Small model with excellent punctuation and good accuracy, moderate speed',
      recommended: true,
    },
    {
      id: 'tiny',
      name: 'Tiny Model (Fast & Light)',
      description:
        "Lightweight transcription model that's fastest but has poor punctuation",
      recommended: false,
    },
  ];

  const selectedModel = transcriptionModels.find(
    (model) => model.id === transcriptionSettings.selectedModel
  );

  return (
    <div className='mb-6 p-4 sm:p-6 rounded-xl border border-gray-200 bg-gradient-to-br from-white to-gray-50 shadow-sm hover:shadow-md transition-shadow duration-200'>
      {/* Header */}
      <div className='flex items-center space-x-3 mb-6'>
        <div className='p-2 bg-gradient-to-br from-green-500 to-blue-600 rounded-lg shadow-sm'>
          <Mic className='w-5 h-5 text-white' />
        </div>
        <div>
          <h3 className='text-lg font-semibold text-gray-900 mb-1'>
            Transcription Model Selection
          </h3>
          <div className='flex items-center space-x-2'>
            <div className='px-2 py-1 bg-green-100 text-green-700 text-xs rounded-full font-medium'>
              Speech-to-Text
            </div>
            {selectedModel && (
              <div className='px-2 py-1 bg-blue-100 text-blue-700 text-xs rounded-full font-medium'>
                Active
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Content */}
      <div className='space-y-4'>
        {/* Model Selection */}
        <div className='space-y-3'>
          <label className='text-sm font-medium text-gray-700'>
            Choose Transcription Model
          </label>

          <div className='grid gap-3'>
            {transcriptionModels.map((model) => (
              <div
                key={model.id}
                className={`relative p-4 border-2 rounded-lg cursor-pointer transition-all duration-200 ${
                  transcriptionSettings.selectedModel === model.id
                    ? 'border-blue-500 bg-blue-50 shadow-md'
                    : 'border-gray-200 bg-white hover:border-gray-300 hover:shadow-sm'
                }`}
                onClick={() =>
                  updateTranscriptionSettings({ selectedModel: model.id })
                }
              >
                <div className='flex items-start justify-between'>
                  <div className='flex-1'>
                    <div className='flex items-center space-x-2 mb-1'>
                      <h4 className='font-medium text-gray-900'>
                        {model.name}
                      </h4>
                      {model.recommended && (
                        <span className='px-2 py-0.5 bg-green-100 text-green-700 text-xs rounded-full font-medium'>
                          Recommended
                        </span>
                      )}
                    </div>
                    <p className='text-sm text-gray-600 mb-2'>
                      {model.description}
                    </p>
                  </div>

                  <div className='ml-3'>
                    {transcriptionSettings.selectedModel === model.id ? (
                      <div className='w-5 h-5 bg-blue-500 rounded-full flex items-center justify-center'>
                        <div className='w-2 h-2 bg-white rounded-full'></div>
                      </div>
                    ) : (
                      <div className='w-5 h-5 border-2 border-gray-300 rounded-full'></div>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Selected Model Display */}
        {selectedModel && (
          <div className='p-4 bg-green-50 border border-green-200 rounded-xl'>
            <div className='flex items-center space-x-2 mb-2'>
              <div className='w-2 h-2 bg-green-500 rounded-full animate-pulse'></div>
              <p className='text-sm font-medium text-green-800'>
                Currently Selected
              </p>
            </div>
            <p className='text-green-700 font-medium text-sm'>
              {selectedModel.name}
            </p>
            <p className='text-green-600 text-xs mt-1'>
              {selectedModel.description}
            </p>
          </div>
        )}

        {/* Info */}
        <div className='p-3 bg-blue-50 border border-blue-200 rounded-lg'>
          <div className='flex items-start space-x-2'>
            <Settings className='w-4 h-4 text-blue-600 mt-0.5 flex-shrink-0' />
            <div>
              <p className='text-sm font-medium text-blue-800 mb-1'>
                Model Settings
              </p>
              <p className='text-xs text-blue-700'>
                Your selection is automatically saved and will be used for all
                future transcription operations. You can change models at any
                time.
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
