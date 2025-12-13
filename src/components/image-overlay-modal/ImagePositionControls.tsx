'use client';

import React from 'react';
import { Crop, Maximize, RotateCcw, ZoomIn, ZoomOut } from 'lucide-react';

type Props = {
  overlayPosition: { x: number; y: number };
  setOverlayPosition: React.Dispatch<
    React.SetStateAction<{ x: number; y: number }>
  >;
  overlaySize: { width: number; height: number };
  setOverlaySize: React.Dispatch<
    React.SetStateAction<{ width: number; height: number }>
  >;
  actualImageDimensions: { width: number; height: number } | null;
  onCrop: () => void;
  onCenterResetNatural: () => void;
  onCenterMaximize: () => void;
  onZoomOut: () => void;
  onZoomIn: () => void;
};

export function ImagePositionControls({
  overlayPosition,
  setOverlayPosition,
  overlaySize,
  setOverlaySize,
  actualImageDimensions,
  onCrop,
  onCenterResetNatural,
  onCenterMaximize,
  onZoomOut,
  onZoomIn,
}: Props) {
  return (
    <div className='space-y-2'>
      <div className='flex gap-2 items-end w-full'>
        <div className='flex-1'>
          <label className='block text-xs text-gray-600'>X (%)</label>
          <input
            type='number'
            value={overlayPosition.x}
            onChange={(e) =>
              setOverlayPosition((prev) => ({
                ...prev,
                x: Number(e.target.value),
              }))
            }
            className='w-full px-2 py-1 border border-gray-300 rounded text-sm'
            min='0'
            max='100'
          />
        </div>
        <div className='flex-1'>
          <label className='block text-xs text-gray-600'>Y (%)</label>
          <input
            type='number'
            value={overlayPosition.y}
            onChange={(e) =>
              setOverlayPosition((prev) => ({
                ...prev,
                y: Number(e.target.value),
              }))
            }
            className='w-full px-2 py-1 border border-gray-300 rounded text-sm'
            min='0'
            max='100'
          />
        </div>
        <div className='flex-1'>
          <label className='block text-xs text-gray-600'>
            Image Width (px)
          </label>
          <input
            type='number'
            value={actualImageDimensions?.width || 0}
            readOnly
            className='w-full px-2 py-1 border border-gray-300 rounded text-sm bg-gray-50'
          />
        </div>
        <div className='flex-1'>
          <label className='block text-xs text-gray-600'>
            Image Height (px)
          </label>
          <input
            type='number'
            value={actualImageDimensions?.height || 0}
            readOnly
            className='w-full px-2 py-1 border border-gray-300 rounded text-sm bg-gray-50'
          />
        </div>
      </div>

      <div className='flex gap-2 items-end w-full'>
        <div className='flex-1'>
          <label className='block text-xs text-gray-600'>
            Overlay Width (%)
          </label>
          <input
            type='number'
            value={overlaySize.width}
            onChange={(e) =>
              setOverlaySize((prev) => ({
                ...prev,
                width: Number(e.target.value),
              }))
            }
            className='w-full px-2 py-1 border border-gray-300 rounded text-sm'
            min='5'
            max='100'
          />
        </div>
        <div className='flex-1'>
          <label className='block text-xs text-gray-600'>
            Overlay Height (%)
          </label>
          <input
            type='number'
            value={overlaySize.height}
            onChange={(e) =>
              setOverlaySize((prev) => ({
                ...prev,
                height: Number(e.target.value),
              }))
            }
            className='w-full px-2 py-1 border border-gray-300 rounded text-sm'
            min='5'
            max='100'
          />
        </div>

        <div className='flex-shrink-0 mt-4'>
          <button
            onClick={onCenterResetNatural}
            className='px-1 py-1 border border-gray-300 rounded hover:bg-gray-50 text-gray-600 hover:text-gray-800 h-8 flex items-center justify-center'
            title='Center and reset to natural size'
          >
            <RotateCcw className='h-3 w-3' />
          </button>
        </div>
        <div className='flex-shrink-0 mt-4'>
          <button
            onClick={onCenterMaximize}
            className='px-1 py-1 border border-gray-300 rounded hover:bg-gray-50 text-gray-600 hover:text-gray-800 h-8 flex items-center justify-center'
            title='Center and maximize size'
          >
            <Maximize className='h-3 w-3' />
          </button>
        </div>
        <div className='flex-shrink-0 mt-4'>
          <button
            onClick={onCrop}
            className='px-1 py-1 border border-gray-300 rounded hover:bg-gray-50 text-gray-600 hover:text-gray-800 h-8 flex items-center justify-center'
            title='Crop image'
          >
            <Crop className='h-3 w-3' />
          </button>
        </div>
        <div className='flex-shrink-0 mt-4'>
          <button
            onClick={onZoomOut}
            className='px-1 py-1 border border-gray-300 rounded hover:bg-gray-50 text-gray-600 hover:text-gray-800 h-8 flex items-center justify-center'
            title='Zoom out (scale down 10%)'
          >
            <ZoomOut className='h-3 w-3' />
          </button>
        </div>
        <div className='flex-shrink-0 mt-4'>
          <button
            onClick={onZoomIn}
            className='px-1 py-1 border border-gray-300 rounded hover:bg-gray-50 text-gray-600 hover:text-gray-800 h-8 flex items-center justify-center'
            title='Zoom in (scale up 10%)'
          >
            <ZoomIn className='h-3 w-3' />
          </button>
        </div>
      </div>
    </div>
  );
}
