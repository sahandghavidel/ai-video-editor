'use client';

import { useAppStore } from '@/store/useAppStore';
import { RotateCcw } from 'lucide-react';

interface TTSSettingsProps {
  className?: string;
}

// Default TTS settings
const defaultTTSSettings = {
  provider: 'chatterbox' as const,
  temperature: 0.8,
  exaggeration: 0.6,
  cfg_weight: 0.5,
  seed: 1212,
  reference_audio_filename: 'calmS5wave.wav',
  fish: {
    apiBaseUrl:
      typeof window !== 'undefined'
        ? 'http://127.0.0.1:8080'
        : process.env.NEXT_PUBLIC_FISH_TTS_BASE_URL || 'http://127.0.0.1:8080',
    apiKey: '',
    referenceId: '',
    format: 'wav' as const,
    latency: 'normal' as const,
    chunk_length: 500,
    max_new_tokens: 4096,
    top_p: 0.8,
    repetition_penalty: 1.1,
    temperature: 0.8,
    use_memory_cache: 'on' as const,
  },
  omniVoice: {
    pythonPath: '',
    modelId: 'k2-fsa/OmniVoice',
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
        <div className='flex gap-1 items-center justify-between'>
          <label className='text-xs font-medium text-gray-700'>Provider</label>
          <select
            value={ttsSettings.provider}
            onChange={(e) =>
              updateTTSSettings({
                provider: e.target.value as
                  | 'chatterbox'
                  | 'fish-s2-pro'
                  | 'omnivoice',
              })
            }
            className='w-full px-2 py-1.5 border border-gray-300 rounded focus:ring-1 focus:ring-blue-500 focus:border-blue-500 transition-colors duration-200 text-xs'
          >
            <option value='chatterbox'>Current TTS (Chatterbox)</option>
            <option value='fish-s2-pro'>Fish Audio S2 Pro</option>
            <option value='omnivoice'>OmniVoice (Apple Silicon)</option>
          </select>
        </div>

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

        {ttsSettings.provider === 'fish-s2-pro' && (
          <>
            <div className='rounded-md border border-cyan-200 bg-cyan-50 p-2 text-[11px] text-cyan-800'>
              Fish S2 Pro uses its own API settings below. Your existing TTS
              model settings remain unchanged.
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
                Fish URL
              </label>
              <input
                type='text'
                value={ttsSettings.fish.apiBaseUrl}
                onChange={(e) =>
                  updateTTSSettings({
                    fish: {
                      ...ttsSettings.fish,
                      apiBaseUrl: e.target.value,
                    },
                  })
                }
                className='w-full px-2 py-1.5 border border-gray-300 rounded focus:ring-1 focus:ring-blue-500 focus:border-blue-500 transition-colors duration-200 text-xs'
                placeholder='http://127.0.0.1:8080'
              />
            </div>

            <div className='flex gap-1 items-center justify-between'>
              <label className='text-xs font-medium text-gray-700'>
                API Key
              </label>
              <input
                type='password'
                value={ttsSettings.fish.apiKey}
                onChange={(e) =>
                  updateTTSSettings({
                    fish: {
                      ...ttsSettings.fish,
                      apiKey: e.target.value,
                    },
                  })
                }
                className='w-full px-2 py-1.5 border border-gray-300 rounded focus:ring-1 focus:ring-blue-500 focus:border-blue-500 transition-colors duration-200 text-xs'
                placeholder='optional bearer token'
              />
            </div>

            <div className='flex gap-1 items-center justify-between'>
              <label className='text-xs font-medium text-gray-700'>
                Reference ID
              </label>
              <input
                type='text'
                value={ttsSettings.fish.referenceId}
                onChange={(e) =>
                  updateTTSSettings({
                    fish: {
                      ...ttsSettings.fish,
                      referenceId: e.target.value,
                    },
                  })
                }
                className='w-full px-2 py-1.5 border border-gray-300 rounded focus:ring-1 focus:ring-blue-500 focus:border-blue-500 transition-colors duration-200 text-xs'
                placeholder='optional: saved voice ID'
              />
            </div>

            <div className='grid grid-cols-2 gap-2'>
              <div className='space-y-1'>
                <label className='text-xs font-medium text-gray-700'>
                  Format
                </label>
                <select
                  value={ttsSettings.fish.format}
                  onChange={(e) =>
                    updateTTSSettings({
                      fish: {
                        ...ttsSettings.fish,
                        format: e.target.value as
                          | 'wav'
                          | 'mp3'
                          | 'opus'
                          | 'pcm',
                      },
                    })
                  }
                  className='w-full px-2 py-1.5 border border-gray-300 rounded focus:ring-1 focus:ring-blue-500 focus:border-blue-500 transition-colors duration-200 text-xs'
                >
                  <option value='wav'>wav</option>
                  <option value='mp3'>mp3</option>
                  <option value='opus'>opus</option>
                  <option value='pcm'>pcm</option>
                </select>
              </div>

              <div className='space-y-1'>
                <label className='text-xs font-medium text-gray-700'>
                  Latency
                </label>
                <select
                  value={ttsSettings.fish.latency}
                  onChange={(e) =>
                    updateTTSSettings({
                      fish: {
                        ...ttsSettings.fish,
                        latency: e.target.value as 'normal' | 'balanced',
                      },
                    })
                  }
                  className='w-full px-2 py-1.5 border border-gray-300 rounded focus:ring-1 focus:ring-blue-500 focus:border-blue-500 transition-colors duration-200 text-xs'
                >
                  <option value='normal'>normal</option>
                  <option value='balanced'>balanced</option>
                </select>
              </div>
            </div>

            <div className='grid grid-cols-2 gap-2'>
              <div className='space-y-1'>
                <label className='text-xs font-medium text-gray-700'>
                  Max New Tokens
                </label>
                <input
                  type='number'
                  min='128'
                  max='8192'
                  value={ttsSettings.fish.max_new_tokens}
                  onChange={(e) =>
                    updateTTSSettings({
                      fish: {
                        ...ttsSettings.fish,
                        max_new_tokens: Math.max(
                          128,
                          Math.min(8192, parseInt(e.target.value) || 1024),
                        ),
                      },
                    })
                  }
                  className='w-full px-2 py-1.5 border border-gray-300 rounded focus:ring-1 focus:ring-blue-500 focus:border-blue-500 transition-colors duration-200 text-xs'
                />
              </div>

              <div className='space-y-1'>
                <label className='text-xs font-medium text-gray-700'>
                  Chunk Length
                </label>
                <input
                  type='number'
                  min='100'
                  max='1000'
                  value={ttsSettings.fish.chunk_length}
                  onChange={(e) =>
                    updateTTSSettings({
                      fish: {
                        ...ttsSettings.fish,
                        chunk_length: Math.max(
                          100,
                          Math.min(1000, parseInt(e.target.value) || 500),
                        ),
                      },
                    })
                  }
                  className='w-full px-2 py-1.5 border border-gray-300 rounded focus:ring-1 focus:ring-blue-500 focus:border-blue-500 transition-colors duration-200 text-xs'
                />
              </div>
            </div>

            <div className='grid grid-cols-2 gap-2'>
              <div className='space-y-1'>
                <label className='text-xs font-medium text-gray-700'>
                  Top P
                </label>
                <input
                  type='number'
                  min='0.1'
                  max='1'
                  step='0.01'
                  value={ttsSettings.fish.top_p}
                  onChange={(e) =>
                    updateTTSSettings({
                      fish: {
                        ...ttsSettings.fish,
                        top_p: Math.max(
                          0.1,
                          Math.min(1, parseFloat(e.target.value) || 0.8),
                        ),
                      },
                    })
                  }
                  className='w-full px-2 py-1.5 border border-gray-300 rounded focus:ring-1 focus:ring-blue-500 focus:border-blue-500 transition-colors duration-200 text-xs'
                />
              </div>

              <div className='space-y-1'>
                <label className='text-xs font-medium text-gray-700'>
                  Temperature
                </label>
                <input
                  type='number'
                  min='0.1'
                  max='1'
                  step='0.01'
                  value={ttsSettings.fish.temperature}
                  onChange={(e) =>
                    updateTTSSettings({
                      fish: {
                        ...ttsSettings.fish,
                        temperature: Math.max(
                          0.1,
                          Math.min(1, parseFloat(e.target.value) || 0.8),
                        ),
                      },
                    })
                  }
                  className='w-full px-2 py-1.5 border border-gray-300 rounded focus:ring-1 focus:ring-blue-500 focus:border-blue-500 transition-colors duration-200 text-xs'
                />
              </div>
            </div>

            <div className='grid grid-cols-2 gap-2'>
              <div className='space-y-1'>
                <label className='text-xs font-medium text-gray-700'>
                  Repetition Penalty
                </label>
                <input
                  type='number'
                  min='0.9'
                  max='2'
                  step='0.01'
                  value={ttsSettings.fish.repetition_penalty}
                  onChange={(e) =>
                    updateTTSSettings({
                      fish: {
                        ...ttsSettings.fish,
                        repetition_penalty: Math.max(
                          0.9,
                          Math.min(2, parseFloat(e.target.value) || 1.1),
                        ),
                      },
                    })
                  }
                  className='w-full px-2 py-1.5 border border-gray-300 rounded focus:ring-1 focus:ring-blue-500 focus:border-blue-500 transition-colors duration-200 text-xs'
                />
              </div>

              <div className='space-y-1'>
                <label className='text-xs font-medium text-gray-700'>
                  Memory Cache
                </label>
                <select
                  value={ttsSettings.fish.use_memory_cache}
                  onChange={(e) =>
                    updateTTSSettings({
                      fish: {
                        ...ttsSettings.fish,
                        use_memory_cache: e.target.value as 'on' | 'off',
                      },
                    })
                  }
                  className='w-full px-2 py-1.5 border border-gray-300 rounded focus:ring-1 focus:ring-blue-500 focus:border-blue-500 transition-colors duration-200 text-xs'
                >
                  <option value='off'>off</option>
                  <option value='on'>on</option>
                </select>
              </div>
            </div>
          </>
        )}

        {ttsSettings.provider === 'chatterbox' && (
          <>
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
                  updateTTSSettings({
                    exaggeration: parseFloat(e.target.value),
                  })
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
              <label className='text-xs font-medium text-gray-700'>
                Reference
              </label>
              <input
                type='text'
                value={ttsSettings.reference_audio_filename}
                onChange={(e) =>
                  updateTTSSettings({
                    reference_audio_filename: e.target.value,
                  })
                }
                className='w-full px-2 py-1.5 border border-gray-300 rounded focus:ring-1 focus:ring-blue-500 focus:border-blue-500 transition-colors duration-200 text-xs'
                placeholder='calmS5wave.wav'
              />
            </div>
          </>
        )}
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
