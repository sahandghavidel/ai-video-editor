'use client';

import { useAppStore } from '@/store/useAppStore';
import { RotateCcw } from 'lucide-react';

interface TTSSettingsProps {
  className?: string;
}

// Default TTS settings
const defaultTTSSettings = {
  temperature: 0.7,
  exaggeration: 0.5,
  cfg_weight: 0.7,
  seed: 1212,
  reference_audio_filename: 'audio3_enhanced.wav',
};

export default function TTSSettings({ className = '' }: TTSSettingsProps) {
  const { ttsSettings, updateTTSSettings } = useAppStore();

  const handleReset = () => {
    updateTTSSettings(defaultTTSSettings);
  };

  return (
    <div
      className={`mb-6 p-4 sm:p-6 rounded-xl border border-gray-200 bg-gradient-to-br from-white to-gray-50 shadow-sm hover:shadow-md transition-shadow duration-200 ${className}`}
    >
      {/* Header */}
      <div className='flex flex-col sm:flex-row sm:items-center sm:justify-between mb-6'>
        <div>
          <h3 className='text-lg font-semibold text-gray-900 mb-1'>
            🎤 TTS Settings
          </h3>
          <p className='text-sm text-gray-600'>
            Configure text-to-speech parameters
          </p>
        </div>
        <button
          onClick={handleReset}
          className='mt-3 sm:mt-0 inline-flex items-center px-3 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 hover:border-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-colors duration-200'
          title='Reset to default values'
        >
          <RotateCcw className='w-4 h-4 mr-2' />
          Reset
        </button>
      </div>

      {/* Settings Grid */}
      <div className='grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-6'>
        {/* Temperature */}
        <div className='space-y-3'>
          <div className='flex items-center justify-between'>
            <label className='text-sm font-medium text-gray-700'>
              Temperature
            </label>
            <span className='text-sm font-semibold text-blue-600 bg-blue-50 px-2 py-1 rounded-md min-w-[3rem] text-center'>
              {ttsSettings.temperature.toFixed(1)}
            </span>
          </div>
          <input
            type='range'
            min='0'
            max='1'
            step='0.1'
            value={ttsSettings.temperature}
            onChange={(e) =>
              updateTTSSettings({ temperature: parseFloat(e.target.value) })
            }
            className='w-full h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer slider'
          />
          <div className='flex justify-between text-xs text-gray-500'>
            <span>0.0</span>
            <span>Randomness</span>
            <span>1.0</span>
          </div>
        </div>

        {/* Exaggeration */}
        <div className='space-y-3'>
          <div className='flex items-center justify-between'>
            <label className='text-sm font-medium text-gray-700'>
              Exaggeration
            </label>
            <span className='text-sm font-semibold text-purple-600 bg-purple-50 px-2 py-1 rounded-md min-w-[3rem] text-center'>
              {ttsSettings.exaggeration.toFixed(1)}
            </span>
          </div>
          <input
            type='range'
            min='0'
            max='1'
            step='0.1'
            value={ttsSettings.exaggeration}
            onChange={(e) =>
              updateTTSSettings({ exaggeration: parseFloat(e.target.value) })
            }
            className='w-full h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer slider'
          />
          <div className='flex justify-between text-xs text-gray-500'>
            <span>0.0</span>
            <span>Expression</span>
            <span>1.0</span>
          </div>
        </div>

        {/* CFG Weight */}
        <div className='space-y-3'>
          <div className='flex items-center justify-between'>
            <label className='text-sm font-medium text-gray-700'>
              CFG Weight
            </label>
            <span className='text-sm font-semibold text-green-600 bg-green-50 px-2 py-1 rounded-md min-w-[3rem] text-center'>
              {ttsSettings.cfg_weight.toFixed(1)}
            </span>
          </div>
          <input
            type='range'
            min='0'
            max='1'
            step='0.1'
            value={ttsSettings.cfg_weight}
            onChange={(e) =>
              updateTTSSettings({ cfg_weight: parseFloat(e.target.value) })
            }
            className='w-full h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer slider'
          />
          <div className='flex justify-between text-xs text-gray-500'>
            <span>0.0</span>
            <span>Guidance</span>
            <span>1.0</span>
          </div>
        </div>

        {/* Seed */}
        <div className='space-y-3'>
          <label className='text-sm font-medium text-gray-700'>Seed</label>
          <div className='relative'>
            <input
              type='number'
              value={ttsSettings.seed}
              onChange={(e) =>
                updateTTSSettings({ seed: parseInt(e.target.value) || 1212 })
              }
              className='w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-colors duration-200 text-sm'
              min='0'
              placeholder='1212'
            />
          </div>
          <p className='text-xs text-gray-500'>
            Random number for reproducibility
          </p>
        </div>

        {/* Reference Audio Filename */}
        <div className='space-y-3 sm:col-span-2 xl:col-span-2'>
          <label className='text-sm font-medium text-gray-700'>
            Reference Audio Filename
          </label>
          <div className='relative'>
            <input
              type='text'
              value={ttsSettings.reference_audio_filename}
              onChange={(e) =>
                updateTTSSettings({ reference_audio_filename: e.target.value })
              }
              className='w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-colors duration-200 text-sm'
              placeholder='audio3_enhanced.wav'
            />
          </div>
          <p className='text-xs text-gray-500'>
            Voice reference file for cloning
          </p>
        </div>
      </div>

      <style jsx>{`
        .slider::-webkit-slider-thumb {
          appearance: none;
          height: 20px;
          width: 20px;
          border-radius: 50%;
          background: #3b82f6;
          cursor: pointer;
          box-shadow: 0 2px 4px rgba(0, 0, 0, 0.1);
          transition: all 0.2s ease;
        }

        .slider::-webkit-slider-thumb:hover {
          background: #2563eb;
          transform: scale(1.1);
          box-shadow: 0 4px 8px rgba(0, 0, 0, 0.15);
        }

        .slider::-moz-range-thumb {
          height: 20px;
          width: 20px;
          border-radius: 50%;
          background: #3b82f6;
          cursor: pointer;
          border: none;
          box-shadow: 0 2px 4px rgba(0, 0, 0, 0.1);
          transition: all 0.2s ease;
        }

        .slider::-moz-range-thumb:hover {
          background: #2563eb;
          transform: scale(1.1);
          box-shadow: 0 4px 8px rgba(0, 0, 0, 0.15);
        }

        .slider::-webkit-slider-track {
          height: 8px;
          border-radius: 4px;
          background: linear-gradient(to right, #e5e7eb, #d1d5db);
        }

        .slider::-moz-range-track {
          height: 8px;
          border-radius: 4px;
          background: linear-gradient(to right, #e5e7eb, #d1d5db);
          border: none;
        }
      `}</style>
    </div>
  );
}
