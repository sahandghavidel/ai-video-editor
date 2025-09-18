'use client';

import { useAppStore } from '@/store/useAppStore';
import { RotateCcw, Zap, Volume2, VolumeX } from 'lucide-react';

interface VideoSpeedSettingsProps {
  className?: string;
}

// Default video speed settings (only for speed and audio, not auto-generation)
const defaultVideoSpeedSettings = {
  selectedSpeed: 4,
  muteAudio: true,
};

export default function VideoSpeedSettings({
  className = '',
}: VideoSpeedSettingsProps) {
  const { videoSettings, updateVideoSettings } = useAppStore();

  const handleReset = () => {
    // Only reset speed and audio settings, preserve auto-generation settings
    updateVideoSettings(defaultVideoSpeedSettings);
  };

  const speedOptions = [
    { value: 1, label: '1x (Normal Speed)', description: 'Original speed' },
    { value: 2, label: '2x (Double Speed)', description: 'Twice as fast' },
    {
      value: 4,
      label: '4x (Quadruple Speed)',
      description: 'Four times faster',
    },
  ];

  const audioOptions = [
    {
      value: 'mute',
      label: 'Mute Audio (Silent)',
      icon: VolumeX,
      description: 'Remove all audio',
    },
    {
      value: 'keep',
      label: 'Keep Original Audio',
      icon: Volume2,
      description: 'Preserve original audio',
    },
  ];

  return (
    <div
      className={`mb-6 p-4 sm:p-6 rounded-xl border border-gray-200 bg-gradient-to-br from-white to-gray-50 shadow-sm hover:shadow-md transition-shadow duration-200 ${className}`}
    >
      {/* Header */}
      <div className='flex flex-col sm:flex-row sm:items-center sm:justify-between mb-6'>
        <div>
          <h3 className='text-lg font-semibold text-gray-900 mb-1 flex items-center'>
            <Zap className='w-5 h-5 mr-2 text-orange-500' />
            Video Speed Settings
          </h3>
          <p className='text-sm text-gray-600'>
            Configure video processing speed and audio handling
          </p>
        </div>
        <button
          onClick={handleReset}
          className='mt-3 sm:mt-0 inline-flex items-center px-3 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 hover:border-gray-400 focus:outline-none focus:ring-2 focus:ring-orange-500 focus:border-orange-500 transition-colors duration-200'
          title='Reset to default values'
        >
          <RotateCcw className='w-4 h-4 mr-2' />
          Reset
        </button>
      </div>

      {/* Settings Grid */}
      <div className='grid grid-cols-1 lg:grid-cols-3 gap-6'>
        {/* Speed Multiplier */}
        <div className='space-y-3'>
          <label className='text-sm font-medium text-gray-700 flex items-center'>
            <Zap className='w-4 h-4 mr-2 text-orange-500' />
            Speed Multiplier
          </label>
          <div className='relative'>
            <select
              value={videoSettings.selectedSpeed}
              onChange={(e) =>
                updateVideoSettings({ selectedSpeed: Number(e.target.value) })
              }
              className='w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-orange-500 focus:border-orange-500 transition-colors duration-200 text-sm bg-white appearance-none cursor-pointer'
            >
              {speedOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
            <div className='absolute inset-y-0 right-0 flex items-center pr-3 pointer-events-none'>
              <svg
                className='w-4 h-4 text-gray-400'
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
          </div>
          <p className='text-xs text-gray-500'>
            {
              speedOptions.find(
                (opt) => opt.value === videoSettings.selectedSpeed
              )?.description
            }
          </p>
        </div>

        {/* Audio Level */}
        <div className='space-y-3'>
          <label className='text-sm font-medium text-gray-700 flex items-center'>
            {videoSettings.muteAudio ? (
              <VolumeX className='w-4 h-4 mr-2 text-red-500' />
            ) : (
              <Volume2 className='w-4 h-4 mr-2 text-blue-500' />
            )}
            Audio Level
          </label>
          <div className='relative'>
            <select
              value={videoSettings.muteAudio ? 'mute' : 'keep'}
              onChange={(e) =>
                updateVideoSettings({ muteAudio: e.target.value === 'mute' })
              }
              className='w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-orange-500 focus:border-orange-500 transition-colors duration-200 text-sm bg-white appearance-none cursor-pointer'
            >
              {audioOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
            <div className='absolute inset-y-0 right-0 flex items-center pr-3 pointer-events-none'>
              <svg
                className='w-4 h-4 text-gray-400'
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
          </div>
          <p className='text-xs text-gray-500'>
            {
              audioOptions.find(
                (opt) =>
                  opt.value === (videoSettings.muteAudio ? 'mute' : 'keep')
              )?.description
            }
          </p>
        </div>

        {/* Current Configuration Summary */}
        <div className='space-y-3'>
          <label className='text-sm font-medium text-gray-700'>
            Current Configuration
          </label>
          <div className='p-4 bg-gradient-to-r from-orange-50 to-yellow-50 border border-orange-200 rounded-lg'>
            <div className='space-y-2'>
              <div className='flex items-center justify-between'>
                <span className='text-sm text-gray-600'>Speed:</span>
                <span className='text-sm font-semibold text-orange-600 bg-orange-100 px-2 py-1 rounded-md'>
                  {videoSettings.selectedSpeed}x
                </span>
              </div>
              <div className='flex items-center justify-between'>
                <span className='text-sm text-gray-600'>Audio:</span>
                <span
                  className={`text-sm font-semibold px-2 py-1 rounded-md ${
                    videoSettings.muteAudio
                      ? 'text-red-600 bg-red-100'
                      : 'text-blue-600 bg-blue-100'
                  }`}
                >
                  {videoSettings.muteAudio ? 'Muted' : 'Preserved'}
                </span>
              </div>
            </div>
            <div className='mt-3 pt-3 border-t border-orange-200'>
              <p className='text-xs text-gray-500'>
                This configuration applies to both individual scene processing
                and batch operations
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
