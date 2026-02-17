'use client';

import { useAppStore } from '@/store/useAppStore';
import { Film, RotateCcw, Clock, Type } from 'lucide-react';

export default function SceneVideoGenerationSettings() {
  const {
    sceneVideoGenerationSettings,
    updateSceneVideoGenerationSettings,
    resetSceneVideoGenerationSettings,
  } = useAppStore();

  const minRaw = sceneVideoGenerationSettings.minDurationSec;
  const maxRaw = sceneVideoGenerationSettings.maxDurationSec;

  const minStr = minRaw === null ? '' : String(minRaw);
  const maxStr = maxRaw === null ? '' : String(maxRaw);

  const hasRange = sceneVideoGenerationSettings.enableDurationRange;

  const rangeInvalid =
    hasRange &&
    minRaw !== null &&
    maxRaw !== null &&
    Number.isFinite(minRaw) &&
    Number.isFinite(maxRaw) &&
    minRaw > maxRaw;

  return (
    <div className='p-3 rounded-lg border border-gray-200 bg-white shadow-sm hover:shadow-md transition-shadow duration-200'>
      <div className='flex items-center justify-between mb-3'>
        <div className='flex items-center space-x-2'>
          <Film className='w-4 h-4 text-indigo-600' />
          <div>
            <h3 className='text-sm font-semibold text-gray-900'>
              Video Generation
            </h3>
            <p className='text-xs text-gray-600'>
              Batch scene image-to-video filters
            </p>
          </div>
        </div>
        <button
          onClick={resetSceneVideoGenerationSettings}
          className='p-1.5 text-gray-500 hover:text-gray-700 hover:bg-gray-100 rounded-md transition-colors duration-200'
          title='Reset to default values'
        >
          <RotateCcw className='w-3.5 h-3.5' />
        </button>
      </div>

      <div className='flex flex-col space-y-3'>
        {/* Duration Range */}
        <div className='space-y-2'>
          <label className='text-xs font-medium text-gray-700 flex items-center justify-between'>
            <span className='flex items-center'>
              <Clock className='w-3.5 h-3.5 mr-1.5 text-blue-600' />
              Duration range (checked first)
            </span>
            <input
              type='checkbox'
              checked={sceneVideoGenerationSettings.enableDurationRange}
              onChange={(e) =>
                updateSceneVideoGenerationSettings({
                  enableDurationRange: e.target.checked,
                })
              }
              className='h-4 w-4 accent-blue-600'
              title='Enable duration filter'
            />
          </label>

          <div className='grid grid-cols-2 gap-2'>
            <div>
              <label className='block text-[11px] text-gray-500 mb-1'>
                Min (sec)
              </label>
              <input
                type='number'
                inputMode='decimal'
                step='0.1'
                min='0'
                value={minStr}
                disabled={!hasRange}
                onChange={(e) =>
                  updateSceneVideoGenerationSettings({
                    minDurationSec: e.target.value,
                  })
                }
                placeholder='e.g. 3'
                className='w-full px-2 py-1.5 border border-gray-300 rounded focus:ring-1 focus:ring-blue-500 focus:border-blue-500 transition-colors duration-200 text-xs bg-white disabled:bg-gray-50'
              />
            </div>
            <div>
              <label className='block text-[11px] text-gray-500 mb-1'>
                Max (sec)
              </label>
              <input
                type='number'
                inputMode='decimal'
                step='0.1'
                min='0'
                value={maxStr}
                disabled={!hasRange}
                onChange={(e) =>
                  updateSceneVideoGenerationSettings({
                    maxDurationSec: e.target.value,
                  })
                }
                placeholder='e.g. 7'
                className='w-full px-2 py-1.5 border border-gray-300 rounded focus:ring-1 focus:ring-blue-500 focus:border-blue-500 transition-colors duration-200 text-xs bg-white disabled:bg-gray-50'
              />
            </div>
          </div>

          {rangeInvalid ? (
            <p className='text-xs text-red-600'>
              Min duration must be ≤ max duration.
            </p>
          ) : (
            <p className='text-xs text-gray-500'>
              Scenes with final video duration outside the range are skipped.
            </p>
          )}
        </div>

        {/* Only no-text */}
        <div className='space-y-2'>
          <label className='text-xs font-medium text-gray-700 flex items-center justify-between'>
            <span className='flex items-center'>
              <Type className='w-3.5 h-3.5 mr-1.5 text-purple-600' />
              Only generate when image has NO text (checked second)
            </span>
            <input
              type='checkbox'
              checked={sceneVideoGenerationSettings.onlyGenerateIfNoText}
              onChange={(e) =>
                updateSceneVideoGenerationSettings({
                  onlyGenerateIfNoText: e.target.checked,
                })
              }
              className='h-4 w-4 accent-purple-600'
              title='Enable text filter'
            />
          </label>
          <p className='text-xs text-gray-500'>
            When enabled, the batch will re-run text detection for the scene
            image and skip if any readable text is found.
          </p>
        </div>
      </div>
    </div>
  );
}
