'use client';

import React from 'react';
import { ChevronDown, ChevronRight, Clock } from 'lucide-react';

type Props = {
  startTime: number;
  endTime: number;
  setStartTime: (v: number) => void;
  setEndTime: (v: number) => void;
  onSetStartFromCurrent: () => void;
  onSetEndFromCurrent: () => void;

  isTintSectionOpen: boolean;
  setIsTintSectionOpen: React.Dispatch<React.SetStateAction<boolean>>;

  tintPalette: string[];
  videoTintColor: string | null;
  setVideoTintColor: (v: string | null) => void;

  videoTintOpacity: number;
  setVideoTintOpacity: (v: number) => void;
  clamp01: (v: number) => number;

  isEditingTintArea: boolean;
  setIsEditingTintArea: React.Dispatch<React.SetStateAction<boolean>>;
  tintInvert: boolean;
  setTintInvert: React.Dispatch<React.SetStateAction<boolean>>;
};

export function TimingTintControls({
  startTime,
  endTime,
  setStartTime,
  setEndTime,
  onSetStartFromCurrent,
  onSetEndFromCurrent,
  isTintSectionOpen,
  setIsTintSectionOpen,
  tintPalette,
  videoTintColor,
  setVideoTintColor,
  videoTintOpacity,
  setVideoTintOpacity,
  clamp01,
  isEditingTintArea,
  setIsEditingTintArea,
  tintInvert,
  setTintInvert,
}: Props) {
  return (
    <div className='bg-gray-50 p-2 rounded-lg border border-gray-200'>
      <span className='sr-only'>Timing</span>
      <div className='grid grid-cols-2 gap-2'>
        <div>
          <label className='sr-only'>Start Time (s)</label>
          <div className='flex gap-2'>
            <input
              type='number'
              value={startTime}
              onChange={(e) => setStartTime(Number(e.target.value))}
              className='w-full px-2 py-1 border border-gray-300 rounded text-sm bg-white'
              min='0'
              step='0.1'
              placeholder='Start s'
            />
            <button
              onClick={onSetStartFromCurrent}
              className='px-2 py-1 text-sm bg-blue-500 text-white rounded hover:bg-blue-600 h-8 w-8 flex items-center justify-center'
              title='Set start to current video time'
              aria-label='Set start to current video time'
            >
              <Clock className='h-4 w-4' />
            </button>
          </div>
        </div>
        <div>
          <label className='sr-only'>End Time (s)</label>
          <div className='flex gap-2'>
            <input
              type='number'
              value={endTime}
              onChange={(e) => setEndTime(Number(e.target.value))}
              className='w-full px-2 py-1 border border-gray-300 rounded text-sm bg-white'
              min='0'
              step='0.1'
              placeholder='End s'
            />
            <button
              onClick={onSetEndFromCurrent}
              className='px-2 py-1 text-sm bg-blue-500 text-white rounded hover:bg-blue-600 h-8 w-8 flex items-center justify-center'
              title='Set end to current video time'
              aria-label='Set end to current video time'
            >
              <Clock className='h-4 w-4' />
            </button>
          </div>
        </div>
      </div>

      <button
        type='button'
        onClick={() => setIsTintSectionOpen((s) => !s)}
        className='mt-2 w-full flex items-center justify-between text-sm text-gray-700'
        aria-expanded={isTintSectionOpen}
      >
        <span>Tint</span>
        {isTintSectionOpen ? (
          <ChevronDown className='h-4 w-4' />
        ) : (
          <ChevronRight className='h-4 w-4' />
        )}
      </button>

      {isTintSectionOpen && (
        <>
          <div className='mt-2 flex items-center justify-between gap-2'>
            <span className='text-sm text-gray-700'>Color</span>
            <div className='flex items-center gap-2'>
              <button
                type='button'
                onClick={() => setVideoTintColor(null)}
                className={`px-2 py-1 text-xs rounded border ${
                  !videoTintColor
                    ? 'border-gray-500 text-gray-900'
                    : 'border-gray-300 text-gray-600'
                } bg-white`}
                aria-label='No tint'
                title='No tint'
              >
                None
              </button>
              {tintPalette.map((c) => (
                <button
                  key={c}
                  type='button'
                  onClick={() => setVideoTintColor(c)}
                  className={`h-6 w-6 rounded border ${
                    videoTintColor === c ? 'border-gray-700' : 'border-gray-300'
                  }`}
                  style={{ backgroundColor: c }}
                  aria-label={`Tint ${c}`}
                  title={`Tint ${c}`}
                />
              ))}
            </div>
          </div>

          <div className='mt-2 flex items-center justify-between gap-2'>
            <span className='text-sm text-gray-700'>Area</span>
            <div className='flex items-center gap-3'>
              <button
                type='button'
                onClick={() => setIsEditingTintArea((s) => !s)}
                className={`px-2 py-1 text-xs rounded border bg-white ${
                  isEditingTintArea
                    ? 'border-gray-700 text-gray-900'
                    : 'border-gray-300 text-gray-700'
                }`}
                title={
                  isEditingTintArea
                    ? 'Finish editing tint area'
                    : 'Edit tint area'
                }
                aria-label={
                  isEditingTintArea
                    ? 'Finish editing tint area'
                    : 'Edit tint area'
                }
              >
                {isEditingTintArea ? 'Done' : 'Edit'}
              </button>

              <label className='flex items-center gap-2 text-sm text-gray-700 select-none'>
                <input
                  type='checkbox'
                  checked={tintInvert}
                  onChange={(e) => setTintInvert(e.target.checked)}
                  className='h-4 w-4'
                />
                Invert
              </label>
            </div>
          </div>

          <div className='mt-2 flex items-center justify-between gap-2'>
            <span className='text-sm text-gray-700'>Strength</span>
            <div className='flex items-center gap-2'>
              <input
                type='range'
                min={0}
                max={1}
                step={0.05}
                value={videoTintOpacity}
                onChange={(e) =>
                  setVideoTintOpacity(clamp01(Number(e.target.value)))
                }
                disabled={!videoTintColor}
                className='w-40'
                aria-label='Tint strength'
              />
              <input
                type='number'
                min={0}
                max={1}
                step={0.05}
                value={videoTintOpacity}
                onChange={(e) =>
                  setVideoTintOpacity(clamp01(Number(e.target.value)))
                }
                disabled={!videoTintColor}
                className='w-20 px-2 py-1 border border-gray-300 rounded text-sm bg-white'
                aria-label='Tint strength number'
              />
            </div>
          </div>
        </>
      )}
    </div>
  );
}
