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
            {selectedModel && (
              <span className='px-1.5 py-0.5 bg-blue-100 text-blue-600 text-xs rounded-full'>
                Active
              </span>
            )}
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
                          Recommended
                        </span>
                      )}
                    </div>
                    <p className='text-xs text-gray-600'>{model.description}</p>
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

        {/* Selected Model Display - Compact */}
        {selectedModel && (
          <div className='p-2 bg-green-50 border border-green-200 rounded-lg'>
            <p className='text-xs font-medium text-green-800 mb-1'>Selected</p>
            <p className='text-green-700 font-medium text-xs'>
              {selectedModel.name}
            </p>
            <p className='text-green-600 text-xs mt-0.5'>
              {selectedModel.description}
            </p>
          </div>
        )}

        {/* Info - Compact */}
        <div className='p-2 bg-blue-50 border border-blue-200 rounded-lg'>
          <div className='flex items-start space-x-2'>
            <Settings className='w-3.5 h-3.5 text-blue-600 mt-0.5 flex-shrink-0' />
            <p className='text-xs text-blue-700'>
              Settings are auto-saved and apply to all transcription operations.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
