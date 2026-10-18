'use client';

import { useAppStore } from '@/store/useAppStore';
import { useState } from 'react';
import { ListMusic, RotateCcw } from 'lucide-react';
import { TTSAudioReferencesModal } from '@/components/TTSAudioReferencesModal';

interface TTSSettingsProps {
  className?: string;
}

// Default TTS settings
const defaultTTSSettings = {
  provider: 'omnivoice' as const,
  seed: 1212,
  reference_audio_filename: 'calmS5wave.wav',
  omniVoice: {
    pythonPath: '',
    modelId: 'k2-fsa/OmniVoice',
    language: '',
    deviceMap: 'mps' as const,
    dtype: 'float16' as const,
    referenceAudioDir: '',
    referenceText: '',
    numStep: 32,
    speed: 1,
  },
};

export default function TTSSettings({ className = '' }: TTSSettingsProps) {
  const { ttsSettings, updateTTSSettings } = useAppStore();
  const [audioReferencesModalOpen, setAudioReferencesModalOpen] =
    useState(false);

  const handleReset = () => {
    updateTTSSettings(defaultTTSSettings);
  };

  return (
    <div
      className={`p-3 rounded-lg border border-gray-200 bg-white shadow-sm hover:shadow-md transition-shadow duration-200 ${className}`}
    >
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
        <div className='flex gap-1 items-center justify-between'>
          <label className='text-xs font-medium text-gray-700'>Provider</label>
          <select
            value={ttsSettings.provider}
            onChange={(e) =>
              updateTTSSettings({
                provider: e.target.value as
                  | 'omnivoice'
                  | 'omnivoice-lora',
              })
            }
            className='w-full px-2 py-1.5 border border-gray-300 rounded focus:ring-1 focus:ring-blue-500 focus:border-blue-500 transition-colors duration-200 text-xs'
          >
            <option value='omnivoice'>OmniVoice (Apple Silicon)</option>
            <option value='omnivoice-lora'>OmniVoice LoRA — Local</option>
          </select>
        </div>

            <button
              onClick={() => setAudioReferencesModalOpen(true)}
              className='inline-flex items-center justify-center gap-2 px-3 py-2 rounded-md border border-indigo-300 bg-indigo-100 text-indigo-800 hover:bg-indigo-200 transition-colors text-xs font-medium'
              title='Manage language-specific local and Gemini TTS presets'
            >
              <ListMusic className='w-4 h-4' />
              Manage Language Presets
            </button>

        {ttsSettings.provider === 'omnivoice-lora' && (
          <p className='text-xs text-indigo-800'>Choose English — Nice LoRA v1 in Manage Language Presets and click Use for English TTS. Persian — LoRA v1 is selected separately with Use for Persian TTS.</p>
        )}
        {ttsSettings.provider === 'omnivoice' && (
          <>
            <div className='rounded-md border border-indigo-200 bg-indigo-50 p-2 text-[11px] text-indigo-800'>
              OmniVoice runs locally via Python on Apple Silicon (MPS). It uses
              your selected reference filename for voice cloning.
            </div>



            <div className='flex gap-1 items-center justify-between'>
              <label className='text-xs font-medium text-gray-700'>
                Shared Seed
              </label>
              <input
                type='number'
                value={ttsSettings.seed}
                onChange={(e) =>
                  updateTTSSettings({ seed: parseInt(e.target.value) || 1212 })
                }
                className='w-full px-2 py-1.5 border border-gray-300 rounded focus:ring-1 focus:ring-blue-500 focus:border-blue-500 transition-colors duration-200 text-xs'
                min='1'
                placeholder='1212'
              />
            </div>

            <div className='flex gap-1 items-center justify-between'>
              <label className='text-xs font-medium text-gray-700'>
                Python Path
              </label>
              <input
                type='text'
                value={ttsSettings.omniVoice.pythonPath}
                onChange={(e) =>
                  updateTTSSettings({
                    omniVoice: {
                      ...ttsSettings.omniVoice,
                      pythonPath: e.target.value,
                    },
                  })
                }
                className='w-full px-2 py-1.5 border border-gray-300 rounded focus:ring-1 focus:ring-blue-500 focus:border-blue-500 transition-colors duration-200 text-xs'
                placeholder='auto (.venv/bin/python)'
              />
            </div>

            <div className='flex gap-1 items-center justify-between'>
              <label className='text-xs font-medium text-gray-700'>
                Model ID
              </label>
              <input
                type='text'
                value={ttsSettings.omniVoice.modelId}
                onChange={(e) =>
                  updateTTSSettings({
                    omniVoice: {
                      ...ttsSettings.omniVoice,
                      modelId: e.target.value,
                    },
                  })
                }
                className='w-full px-2 py-1.5 border border-gray-300 rounded focus:ring-1 focus:ring-blue-500 focus:border-blue-500 transition-colors duration-200 text-xs'
                placeholder='k2-fsa/OmniVoice'
              />
            </div>

            <div className='flex gap-1 items-center justify-between'>
              <label className='text-xs font-medium text-gray-700'>
                Language
              </label>
              <input
                type='text'
                value={ttsSettings.omniVoice.language}
                onChange={(e) =>
                  updateTTSSettings({
                    omniVoice: {
                      ...ttsSettings.omniVoice,
                      language: e.target.value,
                    },
                  })
                }
                className='w-full px-2 py-1.5 border border-gray-300 rounded focus:ring-1 focus:ring-blue-500 focus:border-blue-500 transition-colors duration-200 text-xs'
                placeholder='optional: en, fa, English, Persian'
              />
            </div>

            <div className='flex gap-1 items-center justify-between'>
              <label className='text-xs font-medium text-gray-700'>
                Reference Dir
              </label>
              <input
                type='text'
                value={ttsSettings.omniVoice.referenceAudioDir}
                onChange={(e) =>
                  updateTTSSettings({
                    omniVoice: {
                      ...ttsSettings.omniVoice,
                      referenceAudioDir: e.target.value,
                    },
                  })
                }
                className='w-full px-2 py-1.5 border border-gray-300 rounded focus:ring-1 focus:ring-blue-500 focus:border-blue-500 transition-colors duration-200 text-xs'
                placeholder='auto (omnivoice-local/references)'
              />
            </div>

            <div className='flex gap-1 items-center justify-between'>
              <label className='text-xs font-medium text-gray-700'>
                Reference Text
              </label>
              <textarea
                value={ttsSettings.omniVoice.referenceText}
                onChange={(e) =>
                  updateTTSSettings({
                    omniVoice: {
                      ...ttsSettings.omniVoice,
                      referenceText: e.target.value,
                    },
                  })
                }
                className='w-full px-2 py-1.5 border border-gray-300 rounded focus:ring-1 focus:ring-blue-500 focus:border-blue-500 transition-colors duration-200 text-xs'
                placeholder='optional transcript of the reference audio'
                rows={2}
              />
            </div>

            <div className='grid grid-cols-2 gap-2'>
              <div className='space-y-1'>
                <label className='text-xs font-medium text-gray-700'>
                  Device
                </label>
                <select
                  value={ttsSettings.omniVoice.deviceMap}
                  onChange={(e) =>
                    updateTTSSettings({
                      omniVoice: {
                        ...ttsSettings.omniVoice,
                        deviceMap: e.target.value as 'mps' | 'cpu' | 'auto',
                      },
                    })
                  }
                  className='w-full px-2 py-1.5 border border-gray-300 rounded focus:ring-1 focus:ring-blue-500 focus:border-blue-500 transition-colors duration-200 text-xs'
                >
                  <option value='mps'>mps</option>
                  <option value='auto'>auto</option>
                  <option value='cpu'>cpu</option>
                </select>
              </div>

              <div className='space-y-1'>
                <label className='text-xs font-medium text-gray-700'>
                  DType
                </label>
                <select
                  value={ttsSettings.omniVoice.dtype}
                  onChange={(e) =>
                    updateTTSSettings({
                      omniVoice: {
                        ...ttsSettings.omniVoice,
                        dtype: e.target.value as
                          | 'float16'
                          | 'float32'
                          | 'bfloat16',
                      },
                    })
                  }
                  className='w-full px-2 py-1.5 border border-gray-300 rounded focus:ring-1 focus:ring-blue-500 focus:border-blue-500 transition-colors duration-200 text-xs'
                >
                  <option value='float16'>float16</option>
                  <option value='float32'>float32</option>
                  <option value='bfloat16'>bfloat16</option>
                </select>
              </div>
            </div>

            <div className='grid grid-cols-2 gap-2'>
              <div className='space-y-1'>
                <label className='text-xs font-medium text-gray-700'>
                  Num Step
                </label>
                <input
                  type='number'
                  min='8'
                  max='64'
                  value={ttsSettings.omniVoice.numStep}
                  onChange={(e) =>
                    updateTTSSettings({
                      omniVoice: {
                        ...ttsSettings.omniVoice,
                        numStep: Math.max(
                          8,
                          Math.min(64, parseInt(e.target.value) || 32),
                        ),
                      },
                    })
                  }
                  className='w-full px-2 py-1.5 border border-gray-300 rounded focus:ring-1 focus:ring-blue-500 focus:border-blue-500 transition-colors duration-200 text-xs'
                />
              </div>

              <div className='space-y-1'>
                <label className='text-xs font-medium text-gray-700'>
                  Speed
                </label>
                <input
                  type='number'
                  min='0.5'
                  max='2'
                  step='0.05'
                  value={ttsSettings.omniVoice.speed}
                  onChange={(e) =>
                    updateTTSSettings({
                      omniVoice: {
                        ...ttsSettings.omniVoice,
                        speed: Math.max(
                          0.5,
                          Math.min(2, parseFloat(e.target.value) || 1),
                        ),
                      },
                    })
                  }
                  className='w-full px-2 py-1.5 border border-gray-300 rounded focus:ring-1 focus:ring-blue-500 focus:border-blue-500 transition-colors duration-200 text-xs'
                />
              </div>
            </div>
          </>
        )}

      </div>

      <TTSAudioReferencesModal
        isOpen={audioReferencesModalOpen}
        onClose={() => setAudioReferencesModalOpen(false)}
      />

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
