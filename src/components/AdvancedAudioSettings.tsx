'use client';

import { useAppStore } from '@/store/useAppStore';
import { ChevronDown, ChevronUp } from 'lucide-react';
import { useState } from 'react';

export default function AdvancedAudioSettings() {
  const { advancedAudioSettings, updateAdvancedAudioSettings } = useAppStore();
  const [isExpanded, setIsExpanded] = useState(false);

  return (
    <div className='bg-white rounded-lg shadow p-6 border border-gray-200'>
      <div className='flex items-center justify-between mb-4'>
        <div>
          <h2 className='text-lg font-semibold text-gray-900'>
            Advanced Audio Enhancement Settings
          </h2>
          <p className='text-sm text-gray-500 mt-1'>
            Fine-tune the AI audio enhancement parameters
          </p>
        </div>
        <button
          onClick={() => setIsExpanded(!isExpanded)}
          className='flex items-center gap-2 px-4 py-2 text-sm font-medium text-purple-700 bg-purple-50 border border-purple-200 rounded-lg hover:bg-purple-100 transition-colors'
        >
          {isExpanded ? (
            <>
              Hide <ChevronUp className='w-4 h-4' />
            </>
          ) : (
            <>
              Show <ChevronDown className='w-4 h-4' />
            </>
          )}
        </button>
      </div>

      {isExpanded && (
        <div className='space-y-6 pt-4 border-t border-gray-200'>
          {/* Solver Selection */}
          <div>
            <label className='block text-sm font-medium text-gray-700 mb-2'>
              CFM ODE Solver
              <span className='ml-2 text-xs text-gray-500 font-normal'>
                (Midpoint is recommended)
              </span>
            </label>
            <div className='grid grid-cols-3 gap-2'>
              {(['midpoint', 'rk4', 'euler'] as const).map((solver) => (
                <button
                  key={solver}
                  onClick={() => updateAdvancedAudioSettings({ solver })}
                  className={`px-4 py-2 rounded-lg border-2 transition-colors ${
                    advancedAudioSettings.solver === solver
                      ? 'border-purple-500 bg-purple-50 text-purple-700'
                      : 'border-gray-200 bg-white text-gray-700 hover:border-purple-300'
                  }`}
                >
                  {solver === 'midpoint' && 'Midpoint'}
                  {solver === 'rk4' && 'RK4'}
                  {solver === 'euler' && 'Euler'}
                </button>
              ))}
            </div>
            <p className='text-xs text-gray-500 mt-2'>
              {advancedAudioSettings.solver === 'midpoint' &&
                'Balanced quality and speed (recommended)'}
              {advancedAudioSettings.solver === 'rk4' &&
                'Higher accuracy, slower processing'}
              {advancedAudioSettings.solver === 'euler' &&
                'Faster processing, lower accuracy'}
            </p>
          </div>

          {/* NFE Slider */}
          <div>
            <label className='block text-sm font-medium text-gray-700 mb-2'>
              Number of Function Evaluations (NFE)
              <span className='ml-2 text-xs text-gray-500 font-normal'>
                (higher = better quality but slower)
              </span>
            </label>
            <div className='flex items-center gap-4'>
              <input
                type='range'
                min='32'
                max='128'
                step='16'
                value={advancedAudioSettings.nfe}
                onChange={(e) =>
                  updateAdvancedAudioSettings({ nfe: parseInt(e.target.value) })
                }
                className='flex-1 h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer accent-purple-600'
              />
              <span className='text-sm font-medium text-gray-900 w-12 text-right'>
                {advancedAudioSettings.nfe}
              </span>
            </div>
            <div className='flex justify-between text-xs text-gray-500 mt-1'>
              <span>32 (Fast)</span>
              <span>64 (Default)</span>
              <span>128 (Best)</span>
            </div>
          </div>

          {/* Tau Slider */}
          <div>
            <label className='block text-sm font-medium text-gray-700 mb-2'>
              CFM Prior Temperature (τ)
              <span className='ml-2 text-xs text-gray-500 font-normal'>
                (higher can improve quality but may reduce stability)
              </span>
            </label>
            <div className='flex items-center gap-4'>
              <input
                type='range'
                min='0'
                max='1'
                step='0.1'
                value={advancedAudioSettings.tau}
                onChange={(e) =>
                  updateAdvancedAudioSettings({
                    tau: parseFloat(e.target.value),
                  })
                }
                className='flex-1 h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer accent-purple-600'
              />
              <span className='text-sm font-medium text-gray-900 w-12 text-right'>
                {advancedAudioSettings.tau.toFixed(1)}
              </span>
            </div>
            <div className='flex justify-between text-xs text-gray-500 mt-1'>
              <span>0.0 (Stable)</span>
              <span>0.5 (Default)</span>
              <span>1.0 (Quality)</span>
            </div>
          </div>

          {/* Lambda Slider */}
          <div>
            <label className='block text-sm font-medium text-gray-700 mb-2'>
              Denoise Strength (λ)
              <span className='ml-2 text-xs text-gray-500 font-normal'>
                (controls noise removal intensity)
              </span>
            </label>
            <div className='flex items-center gap-4'>
              <input
                type='range'
                min='0'
                max='1'
                step='0.1'
                value={advancedAudioSettings.lambd}
                onChange={(e) =>
                  updateAdvancedAudioSettings({
                    lambd: parseFloat(e.target.value),
                  })
                }
                className='flex-1 h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer accent-purple-600'
              />
              <span className='text-sm font-medium text-gray-900 w-12 text-right'>
                {advancedAudioSettings.lambd.toFixed(1)}
              </span>
            </div>
            <div className='flex justify-between text-xs text-gray-500 mt-1'>
              <span>0.0 (No Denoise)</span>
              <span>0.5 (Partial)</span>
              <span>1.0 (Full)</span>
            </div>
          </div>

          {/* Reset Button */}
          <div className='pt-4 border-t border-gray-200'>
            <button
              onClick={() =>
                updateAdvancedAudioSettings({
                  solver: 'midpoint',
                  nfe: 64,
                  tau: 0.5,
                  lambd: 1.0,
                })
              }
              className='px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors'
            >
              Reset to Defaults
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
