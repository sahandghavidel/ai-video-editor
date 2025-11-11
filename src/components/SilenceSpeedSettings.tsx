'use client';

import { useAppStore } from '@/store/useAppStore';
import { FastForward, Volume2, VolumeX } from 'lucide-react';

export default function SilenceSpeedSettings() {
  const {
    silenceSpeedRate,
    setSilenceSpeedRate,
    silenceMuted,
    setSilenceMuted,
  } = useAppStore();

  const speedOptions = [
    { value: 1, label: '1x', description: 'Normal speed' },
    { value: 2, label: '2x', description: 'Double speed' },
    { value: 4, label: '4x', description: 'Quadruple speed' },
    { value: 8, label: '8x', description: 'Octuple speed' },
  ];

  return (
    <div className='bg-white rounded-lg border border-gray-200 p-4'>
      <div className='flex items-center gap-2 mb-3'>
        <FastForward className='w-5 h-5 text-emerald-600' />
        <h3 className='font-semibold text-gray-900'>Silence Speed Rate</h3>
      </div>
      <p className='text-sm text-gray-600 mb-4'>
        Speed rate for muted silence sections during optimization
      </p>
      <div className='grid grid-cols-4 gap-2'>
        {speedOptions.map((option) => (
          <button
            key={option.value}
            onClick={() => setSilenceSpeedRate(option.value)}
            className={`px-4 py-3 rounded-lg border-2 transition-all ${
              silenceSpeedRate === option.value
                ? 'border-emerald-500 bg-emerald-50 text-emerald-700 font-semibold'
                : 'border-gray-200 hover:border-gray-300 text-gray-700'
            }`}
            title={option.description}
          >
            <div className='text-center'>
              <div className='text-lg font-bold'>{option.label}</div>
              <div className='text-xs text-gray-500'>{option.description}</div>
            </div>
          </button>
        ))}
      </div>

      {/* Mute Toggle */}
      <div className='mt-4 pt-4 border-t border-gray-200'>
        <p className='text-sm text-gray-600 mb-3'>
          Audio during sped-up silence sections
        </p>
        <div className='grid grid-cols-2 gap-2'>
          <button
            onClick={() => setSilenceMuted(true)}
            className={`px-4 py-3 rounded-lg border-2 transition-all flex items-center justify-center gap-2 ${
              silenceMuted
                ? 'border-emerald-500 bg-emerald-50 text-emerald-700 font-semibold'
                : 'border-gray-200 hover:border-gray-300 text-gray-700'
            }`}
            title='Mute audio during sped-up silence'
          >
            <VolumeX className='w-4 h-4' />
            <span>Muted</span>
          </button>
          <button
            onClick={() => setSilenceMuted(false)}
            className={`px-4 py-3 rounded-lg border-2 transition-all flex items-center justify-center gap-2 ${
              !silenceMuted
                ? 'border-emerald-500 bg-emerald-50 text-emerald-700 font-semibold'
                : 'border-gray-200 hover:border-gray-300 text-gray-700'
            }`}
            title='Keep original audio during sped-up silence'
          >
            <Volume2 className='w-4 h-4' />
            <span>Original Audio</span>
          </button>
        </div>
      </div>

      <div className='mt-3 text-xs text-gray-500'>
        Selected:{' '}
        <span className='font-semibold'>{silenceSpeedRate}x speed</span> +
        <span className='font-semibold'>
          {' '}
          {silenceMuted ? 'muted' : 'original audio'}
        </span>
      </div>
    </div>
  );
}
