'use client';

import { useAppStore } from '@/store/useAppStore';
import { RotateCcw, Zap, Volume2, VolumeX, Filter, Play } from 'lucide-react';

interface VideoSpeedSettingsProps {
  className?: string;
}

// Default video speed settings (only for speed and audio, not auto-generation)
const defaultVideoSpeedSettings = {
  selectedSpeed: 4,
  muteAudio: true,
  speedUpMode: 'emptyOnly' as const,
  playerSpeed: 1,
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
    {
      value: 1.125,
      label: '1.125x (Slightly Faster)',
      description: '12.5% faster',
    },
    {
      value: 1.5,
      label: '1.5x (50% Faster)',
      description: 'One and a half times faster',
    },
    { value: 2, label: '2x (Double Speed)', description: 'Twice as fast' },
    {
      value: 4,
      label: '4x (Quadruple Speed)',
      description: 'Four times faster',
    },
    {
      value: 8,
      label: '8x (Octuple Speed)',
      description: 'Eight times faster',
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

  const speedUpModeOptions = [
    {
      value: 'all',
      label: 'All Videos',
      description: 'Speed up all videos',
    },
    {
      value: 'emptyOnly',
      label: 'Empty Only (Raw Clips)',
      description: 'Only videos without text',
    },
    {
      value: 'withTextOnly',
      label: 'With Text Only (Final)',
      description: 'Only videos with text content',
    },
  ];

  const playerSpeedOptions = [
    { value: 1, label: '1x (Normal)', description: 'Normal playback speed' },
    { value: 1.25, label: '1.25x', description: '25% faster playback' },
    { value: 1.5, label: '1.5x', description: '50% faster playback' },
    { value: 1.75, label: '1.75x', description: '75% faster playback' },
    { value: 2, label: '2x (Double)', description: 'Double speed playback' },
  ];

  return (
    <div className='p-3 rounded-lg border border-gray-200 bg-white shadow-sm hover:shadow-md transition-shadow duration-200'>
      {/* Header - Compact */}
      <div className='flex items-center justify-between mb-3'>
        <div className='flex items-center space-x-2'>
          <Zap className='w-4 h-4 text-orange-500' />
          <div>
            <h3 className='text-sm font-semibold text-gray-900'>Video Speed</h3>
            <p className='text-xs text-gray-600'>Processing speed & audio</p>
          </div>
        </div>
        <button
          onClick={handleReset}
          className='p-1.5 text-gray-500 hover:text-gray-700 hover:bg-gray-100 rounded-md transition-colors duration-200'
          title='Reset to default values'
        >
          <RotateCcw className='w-3.5 h-3.5' />
        </button>
      </div>

      {/* Settings - Vertical Stack */}
      <div className='flex flex-col space-y-3'>
        {/* Speed Multiplier */}
        <div className='space-y-2'>
          <label className='text-xs font-medium text-gray-700 flex items-center'>
            <Zap className='w-3.5 h-3.5 mr-1.5 text-orange-500' />
            Speed Multiplier
          </label>
          <select
            value={videoSettings.selectedSpeed}
            onChange={(e) =>
              updateVideoSettings({ selectedSpeed: Number(e.target.value) })
            }
            className='w-full px-2 py-1.5 border border-gray-300 rounded focus:ring-1 focus:ring-orange-500 focus:border-orange-500 transition-colors duration-200 text-xs bg-white appearance-none cursor-pointer'
          >
            {speedOptions.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
          <p className='text-xs text-gray-500'>
            {
              speedOptions.find(
                (opt) => opt.value === videoSettings.selectedSpeed
              )?.description
            }
          </p>
        </div>

        {/* Audio Level */}
        <div className='space-y-2'>
          <label className='text-xs font-medium text-gray-700 flex items-center'>
            {videoSettings.muteAudio ? (
              <VolumeX className='w-3.5 h-3.5 mr-1.5 text-red-500' />
            ) : (
              <Volume2 className='w-3.5 h-3.5 mr-1.5 text-blue-500' />
            )}
            Audio Level
          </label>
          <select
            value={videoSettings.muteAudio ? 'mute' : 'keep'}
            onChange={(e) =>
              updateVideoSettings({ muteAudio: e.target.value === 'mute' })
            }
            className='w-full px-2 py-1.5 border border-gray-300 rounded focus:ring-1 focus:ring-orange-500 focus:border-orange-500 transition-colors duration-200 text-xs bg-white appearance-none cursor-pointer'
          >
            {audioOptions.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
          <p className='text-xs text-gray-500'>
            {
              audioOptions.find(
                (opt) =>
                  opt.value === (videoSettings.muteAudio ? 'mute' : 'keep')
              )?.description
            }
          </p>
        </div>

        {/* Speed Up Mode Filter */}
        <div className='space-y-2'>
          <label className='text-xs font-medium text-gray-700 flex items-center'>
            <Filter className='w-3.5 h-3.5 mr-1.5 text-purple-500' />
            Speed Up Filter
          </label>
          <select
            value={videoSettings.speedUpMode}
            onChange={(e) =>
              updateVideoSettings({
                speedUpMode: e.target.value as
                  | 'all'
                  | 'emptyOnly'
                  | 'withTextOnly',
              })
            }
            className='w-full px-2 py-1.5 border border-gray-300 rounded focus:ring-1 focus:ring-orange-500 focus:border-orange-500 transition-colors duration-200 text-xs bg-white appearance-none cursor-pointer'
          >
            {speedUpModeOptions.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
          <p className='text-xs text-gray-500'>
            {
              speedUpModeOptions.find(
                (opt) => opt.value === videoSettings.speedUpMode
              )?.description
            }
          </p>
        </div>

        {/* Player Speed */}
        <div className='space-y-2'>
          <label className='text-xs font-medium text-gray-700 flex items-center'>
            <Play className='w-3.5 h-3.5 mr-1.5 text-green-500' />
            Player Speed
          </label>
          <select
            value={videoSettings.playerSpeed}
            onChange={(e) =>
              updateVideoSettings({ playerSpeed: Number(e.target.value) })
            }
            className='w-full px-2 py-1.5 border border-gray-300 rounded focus:ring-1 focus:ring-green-500 focus:border-green-500 transition-colors duration-200 text-xs bg-white appearance-none cursor-pointer'
          >
            {playerSpeedOptions.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
          <p className='text-xs text-gray-500'>
            {
              playerSpeedOptions.find(
                (opt) => opt.value === videoSettings.playerSpeed
              )?.description
            }
          </p>
        </div>

        {/* Current Configuration Summary */}
        <div className='space-y-2'>
          <label className='text-xs font-medium text-gray-700'>
            Configuration
          </label>
          <div className='p-2 bg-orange-50 border border-orange-200 rounded-lg space-y-1'>
            <div className='flex items-center justify-between'>
              <span className='text-xs text-gray-600'>Speed:</span>
              <span className='text-xs font-semibold text-orange-600 bg-orange-100 px-1.5 py-0.5 rounded'>
                {videoSettings.selectedSpeed}x
              </span>
            </div>
            <div className='flex items-center justify-between'>
              <span className='text-xs text-gray-600'>Audio:</span>
              <span
                className={`text-xs font-semibold px-1.5 py-0.5 rounded ${
                  videoSettings.muteAudio
                    ? 'text-red-600 bg-red-100'
                    : 'text-blue-600 bg-blue-100'
                }`}
              >
                {videoSettings.muteAudio ? 'Muted' : 'Preserved'}
              </span>
            </div>
            <div className='flex items-center justify-between'>
              <span className='text-xs text-gray-600'>Filter:</span>
              <span className='text-xs font-semibold text-purple-600 bg-purple-100 px-1.5 py-0.5 rounded'>
                {speedUpModeOptions.find(
                  (opt) => opt.value === videoSettings.speedUpMode
                )?.label || 'All'}
              </span>
            </div>
            <div className='flex items-center justify-between'>
              <span className='text-xs text-gray-600'>Player:</span>
              <span className='text-xs font-semibold text-green-600 bg-green-100 px-1.5 py-0.5 rounded'>
                {videoSettings.playerSpeed}x
              </span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
