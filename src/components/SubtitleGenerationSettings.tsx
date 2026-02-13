'use client';

import { useAppStore } from '@/store/useAppStore';
import { RotateCcw, Subtitles } from 'lucide-react';

export default function SubtitleGenerationSettings() {
  const {
    subtitleGenerationSettings,
    updateSubtitleGenerationSettings,
    resetSubtitleGenerationSettings,
  } = useAppStore();

  const { enableCharLimit, maxChars } = subtitleGenerationSettings;

  return (
    <div className='bg-white rounded-lg border border-gray-200 p-4 shadow-sm hover:shadow-md transition-shadow duration-200'>
      <div className='flex items-start justify-between mb-3'>
        <div className='flex items-center gap-2'>
          <Subtitles className='w-5 h-5 text-yellow-600' />
          <div>
            <h3 className='font-semibold text-gray-900'>Subtitles</h3>
            <p className='text-xs text-gray-600'>
              Batch subtitle generation filters
            </p>
          </div>
        </div>
        <button
          onClick={resetSubtitleGenerationSettings}
          className='p-1.5 text-gray-500 hover:text-gray-700 hover:bg-gray-100 rounded-md transition-colors duration-200'
          title='Reset subtitle settings'
          type='button'
        >
          <RotateCcw className='w-3.5 h-3.5' />
        </button>
      </div>

      <div className='space-y-3'>
        <label className='flex items-start gap-3 cursor-pointer'>
          <input
            type='checkbox'
            checked={enableCharLimit}
            onChange={(e) =>
              updateSubtitleGenerationSettings({
                enableCharLimit: e.target.checked,
              })
            }
            className='mt-1 w-5 h-5 text-yellow-600 bg-white border-2 border-gray-300 rounded-md focus:ring-2 focus:ring-yellow-500 focus:border-yellow-500 transition-colors duration-200'
          />
          <div className='flex-1 min-w-0'>
            <div className='text-sm font-medium text-gray-900'>
              Only generate when transcription is shorter than a limit
            </div>
            <div className='text-xs text-gray-600'>
              Counts characters from the transcription text (including
              punctuation).
            </div>
          </div>
        </label>

        <div className='flex items-center gap-2'>
          <div className='text-xs text-gray-700 whitespace-nowrap'>
            Max chars:
          </div>
          <input
            type='number'
            min={1}
            step={1}
            value={Number.isFinite(maxChars) ? maxChars : 100}
            disabled={!enableCharLimit}
            onChange={(e) => {
              const raw = Number(e.target.value);
              updateSubtitleGenerationSettings({ maxChars: raw });
            }}
            className={`w-28 px-2 py-1 text-sm rounded-md border focus:outline-none focus:ring-2 transition-colors ${
              enableCharLimit
                ? 'border-gray-300 focus:ring-yellow-500 focus:border-yellow-500'
                : 'border-gray-200 bg-gray-50 text-gray-400'
            }`}
          />
          <div className='text-xs text-gray-500'>characters</div>
        </div>

        <div className='text-[11px] text-gray-500 leading-relaxed'>
          Applies to:{' '}
          <span className='font-semibold'>
            Batch Operations → Subtitles → Generate All
          </span>
          .
        </div>
      </div>
    </div>
  );
}
