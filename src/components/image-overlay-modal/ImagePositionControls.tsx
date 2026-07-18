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
  sizeHeightPerWidth: number;
  onCrop: () => void;
  canCrop?: boolean;
  mediaLabel?: 'Image' | 'Video';
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
  sizeHeightPerWidth,
  onCrop,
  canCrop = true,
  mediaLabel = 'Image',
  onCenterResetNatural,
  onCenterMaximize,
  onZoomOut,
  onZoomIn,
}: Props) {
  const clamp = (value: number, min: number, max: number) =>
    Math.max(min, Math.min(max, Number.isFinite(value) ? value : min));

  const updatePosition = (axis: 'x' | 'y', value: number) => {
    const size = axis === 'x' ? overlaySize.width : overlaySize.height;
    const halfSize = size / 2;
    setOverlayPosition((previous) => ({
      ...previous,
      [axis]: clamp(value, halfSize, 100 - halfSize),
    }));
  };

  const updateSize = (axis: 'width' | 'height', value: number) => {
    const ratio =
      Number.isFinite(sizeHeightPerWidth) && sizeHeightPerWidth > 0
        ? sizeHeightPerWidth
        : overlaySize.height / Math.max(overlaySize.width, 0.001);
    const minWidth = Math.max(5, 5 / ratio);
    const maxWidth = Math.min(100, 100 / ratio);
    const requestedWidth = axis === 'width' ? value : value / ratio;
    const nextWidth = clamp(requestedWidth, minWidth, maxWidth);
    const nextSize = {
      width: nextWidth,
      height: nextWidth * ratio,
    };
    setOverlaySize(nextSize);
    setOverlayPosition((previous) => {
      return {
        x: clamp(
          previous.x,
          nextSize.width / 2,
          100 - nextSize.width / 2,
        ),
        y: clamp(
          previous.y,
          nextSize.height / 2,
          100 - nextSize.height / 2,
        ),
      };
    });
  };

  return (
    <div className='space-y-2'>
      <div className='flex gap-2 items-end w-full'>
        <div className='flex-1'>
          <label className='block text-xs text-gray-600'>X (%)</label>
          <input
            type='number'
            value={overlayPosition.x}
            onChange={(e) => updatePosition('x', Number(e.target.value))}
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
            onChange={(e) => updatePosition('y', Number(e.target.value))}
            className='w-full px-2 py-1 border border-gray-300 rounded text-sm'
            min='0'
            max='100'
          />
        </div>
        <div className='flex-1'>
          <label className='block text-xs text-gray-600'>
            {mediaLabel} Width (px)
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
            {mediaLabel} Height (px)
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
            onChange={(e) => updateSize('width', Number(e.target.value))}
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
            onChange={(e) => updateSize('height', Number(e.target.value))}
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
        {canCrop && (
          <div className='flex-shrink-0 mt-4'>
            <button
              onClick={onCrop}
              className='px-1 py-1 border border-gray-300 rounded hover:bg-gray-50 text-gray-600 hover:text-gray-800 h-8 flex items-center justify-center'
              title='Crop image'
            >
              <Crop className='h-3 w-3' />
            </button>
          </div>
        )}
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
      <p className='text-[11px] text-gray-500'>
        Drag to move · Handles resize proportionally · Option/Alt + drag crops
      </p>
    </div>
  );
}
