'use client';

import { useAppStore } from '@/store/useAppStore';
import { Volume2, Sparkles, VolumeX } from 'lucide-react';

export default function AudioEnhancementSettings() {
  const { audioEnhancementMode, setAudioEnhancementMode } = useAppStore();

  const enhancementOptions = [
    {
      value: 'normalize' as const,
      label: 'Normalize',
      description: 'EBU R128 standard',
      icon: Volume2,
    },
    {
      value: 'enhance' as const,
      label: 'AI Enhance',
      description: 'Denoise + Enhance',
      icon: Sparkles,
    },
    {
      value: 'enhance-denoise-only' as const,
      label: 'AI Denoise',
      description: 'Denoise only',
      icon: VolumeX,
    },
  ];

  return (
    <div className='bg-white rounded-lg border border-gray-200 p-4'>
      <div className='flex items-center gap-2 mb-3'>
        <Volume2 className='w-5 h-5 text-purple-600' />
        <h3 className='font-semibold text-gray-900'>Audio Enhancement Mode</h3>
      </div>
      <p className='text-sm text-gray-600 mb-4'>
        Choose audio processing method for normalization step
      </p>
      <div className='grid grid-cols-3 gap-2'>
        {enhancementOptions.map((option) => {
          const Icon = option.icon;
          return (
            <button
              key={option.value}
              onClick={() => setAudioEnhancementMode(option.value)}
              className={`px-3 py-3 rounded-lg border-2 transition-all ${
                audioEnhancementMode === option.value
                  ? 'border-purple-500 bg-purple-50 text-purple-700 font-semibold'
                  : 'border-gray-200 hover:border-gray-300 text-gray-700'
              }`}
              title={option.description}
            >
              <div className='flex flex-col items-center gap-1'>
                <Icon className='w-5 h-5' />
                <div className='text-xs font-semibold'>{option.label}</div>
                <div className='text-xs text-gray-500'>
                  {option.description}
                </div>
              </div>
            </button>
          );
        })}
      </div>
      <div className='mt-3 text-xs text-gray-500'>
        Selected:{' '}
        <span className='font-semibold'>
          {
            enhancementOptions.find((o) => o.value === audioEnhancementMode)
              ?.label
          }
        </span>
        {audioEnhancementMode === 'normalize' &&
          ' - FFmpeg loudnorm filter (EBU R128)'}
        {audioEnhancementMode === 'enhance' &&
          ' - Resemble Enhance (AI denoising + enhancement)'}
        {audioEnhancementMode === 'enhance-denoise-only' &&
          ' - Resemble Enhance (AI denoising only)'}
      </div>
    </div>
  );
}
