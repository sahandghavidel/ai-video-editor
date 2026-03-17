'use client';

import { useAppStore } from '@/store/useAppStore';
import { GitMerge, RotateCcw } from 'lucide-react';

export default function CombineScenesSettings() {
  const {
    combineScenesSettings,
    updateCombineScenesSettings,
    resetCombineScenesSettings,
  } = useAppStore();

  return (
    <div className='bg-white rounded-lg border border-gray-200 p-4 shadow-sm hover:shadow-md transition-shadow duration-200'>
      <div className='flex items-start justify-between mb-3'>
        <div className='flex items-center gap-2'>
          <GitMerge className='w-5 h-5 text-violet-600' />
          <div>
            <h3 className='font-semibold text-gray-900'>Combine Scenes</h3>
            <p className='text-xs text-gray-600'>
              Settings for pair-combine batch action
            </p>
          </div>
        </div>
        <button
          onClick={resetCombineScenesSettings}
          className='p-1.5 text-gray-500 hover:text-gray-700 hover:bg-gray-100 rounded-md transition-colors duration-200'
          title='Reset combine scenes settings'
          type='button'
        >
          <RotateCcw className='w-3.5 h-3.5' />
        </button>
      </div>

      <div className='space-y-3'>
        <label className='block'>
          <div className='text-sm font-medium text-gray-900 mb-1'>
            Skip first N scenes
          </div>
          <div className='text-xs text-gray-600 mb-2'>
            The combine-pairs action will ignore the first N ordered scenes.
          </div>
          <div className='flex items-center gap-2'>
            <input
              type='number'
              min={0}
              step={1}
              value={
                Number.isFinite(combineScenesSettings.skipFirstScenes)
                  ? combineScenesSettings.skipFirstScenes
                  : 0
              }
              onChange={(e) => {
                const raw = Number(e.target.value);
                updateCombineScenesSettings({ skipFirstScenes: raw });
              }}
              className='w-28 px-2 py-1 text-sm rounded-md border border-gray-300 focus:outline-none focus:ring-2 focus:ring-violet-500 focus:border-violet-500'
            />
            <span className='text-xs text-gray-500'>scenes</span>
          </div>
        </label>

        <div className='text-[11px] text-gray-500 leading-relaxed'>
          Applies to:
          <span className='font-semibold'>
            {' '}
            Batch Operations → Combine Long-Text Pairs
          </span>
          .
        </div>
      </div>
    </div>
  );
}
