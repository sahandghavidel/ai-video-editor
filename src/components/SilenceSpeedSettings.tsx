'use client';

import { useAppStore } from '@/store/useAppStore';
import { FastForward } from 'lucide-react';

export default function SilenceSpeedSettings() {
  const { silenceSpeedRate, setSilenceSpeedRate } = useAppStore();

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
      <div className='mt-3 text-xs text-gray-500'>
        Selected: <span className='font-semibold'>{silenceSpeedRate}x</span> - Silence sections will be played at this speed
      </div>
    </div>
  );
}
