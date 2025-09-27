'use client';

import { useAppStore } from '@/store/useAppStore';
import { RotateCcw } from 'lucide-react';

interface TTSSettingsProps {
  className?: string;
}

// Default TTS settings
const defaultTTSSettings = {
  temperature: 0.2,
  exaggeration: 0.8,
  cfg_weight: 0.2,
  seed: 1212,
  reference_audio_filename: 'calmS5wave.wav',
};

export default function TTSSettings({ className = '' }: TTSSettingsProps) {
  const { ttsSettings, updateTTSSettings } = useAppStore();

  const handleReset = () => {
    updateTTSSettings(defaultTTSSettings);
  };

  return (
    <div className='p-3 rounded-lg border border-gray-200 bg-white shadow-sm hover:shadow-md transition-shadow duration-200'>
      {/* Header - Compact */}
      <div className='flex items-center justify-between mb-3'>
        <div className='flex items-center space-x-2'>
          <div className='w-4 h-4 bg-purple-500 rounded-full flex items-center justify-center'>
            <span className='text-white text-xs'>🎤</span>
          </div>
          <div>
            <h3 className='text-sm font-semibold text-gray-900'>
              TTS Settings
            </h3>
            <p className='text-xs text-gray-600'>Text-to-Speech parameters</p>
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
        {/* Temperature */}
        <div className='space-y-2'>
          <div className='flex items-center justify-between'>
            <label className='text-xs font-medium text-gray-700'>
              Temperature
            </label>
            <span className='text-xs font-semibold text-blue-600 bg-blue-50 px-1.5 py-0.5 rounded min-w-[2.5rem] text-center'>
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
            className='w-full h-1.5 bg-gray-200 rounded-lg appearance-none cursor-pointer slider'
          />
          <div className='flex justify-between text-xs text-gray-500'>
            <span>0.0</span>
            <span>1.0</span>
          </div>
        </div>

        {/* Exaggeration */}
        <div className='space-y-2'>
          <div className='flex items-center justify-between'>
            <label className='text-xs font-medium text-gray-700'>
              Exaggeration
            </label>
            <span className='text-xs font-semibold text-purple-600 bg-purple-50 px-1.5 py-0.5 rounded min-w-[2.5rem] text-center'>
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
            className='w-full h-1.5 bg-gray-200 rounded-lg appearance-none cursor-pointer slider'
          />
          <div className='flex justify-between text-xs text-gray-500'>
            <span>0.0</span>
            <span>1.0</span>
          </div>
        </div>

        {/* CFG Weight */}
        <div className='space-y-2'>
          <div className='flex items-center justify-between'>
            <label className='text-xs font-medium text-gray-700'>
              CFG Weight
            </label>
            <span className='text-xs font-semibold text-green-600 bg-green-50 px-1.5 py-0.5 rounded min-w-[2.5rem] text-center'>
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
            className='w-full h-1.5 bg-gray-200 rounded-lg appearance-none cursor-pointer slider'
          />
          <div className='flex justify-between text-xs text-gray-500'>
            <span>0.0</span>
            <span>1.0</span>
          </div>
        </div>

        {/* Seed */}
        <div className='flex gap-1 items-center justify-between'>
          <label className='text-xs font-medium text-gray-700'>Seed</label>
          <input
            type='number'
            value={ttsSettings.seed}
            onChange={(e) =>
              updateTTSSettings({ seed: parseInt(e.target.value) || 1212 })
            }
            className='w-full px-2 py-1.5 border border-gray-300 rounded focus:ring-1 focus:ring-blue-500 focus:border-blue-500 transition-colors duration-200 text-xs'
            min='0'
            placeholder='1212'
          />
        </div>

        {/* Reference Audio Filename */}
        <div className='flex gap-1 items-center justify-between'>
          <label className='text-xs font-medium text-gray-700'>Reference</label>
          <input
            type='text'
            value={ttsSettings.reference_audio_filename}
            onChange={(e) =>
              updateTTSSettings({ reference_audio_filename: e.target.value })
            }
            className='w-full px-2 py-1.5 border border-gray-300 rounded focus:ring-1 focus:ring-blue-500 focus:border-blue-500 transition-colors duration-200 text-xs'
            placeholder='calmS5wave.wav'
          />
        </div>
      </div>

      <style jsx>{`
        .slider::-webkit-slider-thumb {
          appearance: none;
          height: 16px;
          width: 16px;
          border-radius: 50%;
          background: #3b82f6;
          cursor: pointer;
          box-shadow: 0 1px 3px rgba(0, 0, 0, 0.1);
          transition: all 0.2s ease;
        }

        .slider::-webkit-slider-thumb:hover {
          background: #2563eb;
          transform: scale(1.1);
          box-shadow: 0 2px 6px rgba(0, 0, 0, 0.15);
        }

        .slider::-moz-range-thumb {
          height: 16px;
          width: 16px;
          border-radius: 50%;
          background: #3b82f6;
          cursor: pointer;
          border: none;
          box-shadow: 0 1px 3px rgba(0, 0, 0, 0.1);
          transition: all 0.2s ease;
        }

        .slider::-moz-range-thumb:hover {
          background: #2563eb;
          transform: scale(1.1);
          box-shadow: 0 2px 6px rgba(0, 0, 0, 0.15);
        }

        .slider::-webkit-slider-track {
          height: 6px;
          border-radius: 3px;
          background: linear-gradient(to right, #e5e7eb, #d1d5db);
        }

        .slider::-moz-range-track {
          height: 6px;
          border-radius: 3px;
          background: linear-gradient(to right, #e5e7eb, #d1d5db);
          border: none;
        }
      `}</style>
    </div>
  );
}
