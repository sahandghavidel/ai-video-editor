'use client';

import React from 'react';
import {
  Camera,
  Clipboard,
  Copy,
  Loader2,
  Upload,
  Video,
  X,
} from 'lucide-react';

type Props = {
  fileInputRef: React.RefObject<HTMLInputElement>;
  overlayImage: File | null;
  onImageUpload: (event: React.ChangeEvent<HTMLInputElement>) => void;
  onPickFile: () => void;
  onScreenshot: () => void;
  onCopyToClipboard: () => void;
  onPasteFromClipboard: () => void;
  isPastingFromClipboard?: boolean;
  onRemoveImage: () => void;
  videoFileInputRef: React.RefObject<HTMLInputElement>;
  onVideoUpload: (event: React.ChangeEvent<HTMLInputElement>) => void;
  onPickVideoFile: () => void;
};

export function ImageUploadRow({
  fileInputRef,
  overlayImage,
  onImageUpload,
  onPickFile,
  onScreenshot,
  onCopyToClipboard,
  onPasteFromClipboard,
  isPastingFromClipboard,
  onRemoveImage,
  videoFileInputRef,
  onVideoUpload,
  onPickVideoFile,
}: Props) {
  return (
    <div>
      <input
        ref={fileInputRef}
        type='file'
        accept='image/*'
        onChange={onImageUpload}
        className='hidden'
      />
      <input
        ref={videoFileInputRef}
        type='file'
        accept='video/*'
        onChange={onVideoUpload}
        className='hidden'
      />
      <div className='flex items-center space-x-2'>
        <button
          onClick={onPickFile}
          className='flex items-center justify-center px-2 py-2 border border-gray-300 rounded hover:bg-gray-50 h-10 w-10'
          title={overlayImage ? 'Change Image' : 'Upload Image'}
          aria-label={overlayImage ? 'Change Image' : 'Upload Image'}
        >
          <Upload className='h-4 w-4' />
        </button>
        <button
          onClick={onPickVideoFile}
          className='flex items-center justify-center px-2 py-2 border border-gray-300 rounded hover:bg-gray-50 h-10 w-10'
          title='Upload Video'
          aria-label='Upload Video'
        >
          <Video className='h-4 w-4' />
        </button>
        <button
          onClick={onScreenshot}
          className='flex items-center justify-center px-2 py-2 border border-gray-300 rounded hover:bg-gray-50 h-10 w-10'
          title='Take screenshot from video'
          aria-label='Take screenshot from video'
        >
          <Camera className='h-4 w-4' />
        </button>
        <button
          type='button'
          onClick={onCopyToClipboard}
          disabled={!overlayImage}
          className='flex items-center justify-center px-2 py-2 border border-gray-300 rounded hover:bg-gray-50 h-10 w-10 disabled:opacity-50 disabled:cursor-not-allowed'
          title='Copy image to clipboard'
          aria-label='Copy image to clipboard'
        >
          <Copy className='h-4 w-4' />
        </button>
        <button
          type='button'
          onClick={onPasteFromClipboard}
          disabled={isPastingFromClipboard}
          className='flex items-center justify-center px-2 py-2 border border-gray-300 rounded hover:bg-gray-50 h-10 w-10 disabled:opacity-50 disabled:cursor-not-allowed'
          title='Paste image from clipboard'
          aria-label='Paste image from clipboard'
        >
          {isPastingFromClipboard ? (
            <Loader2 className='h-4 w-4 animate-spin' />
          ) : (
            <Clipboard className='h-4 w-4' />
          )}
        </button>
        {overlayImage && (
          <button
            onClick={onRemoveImage}
            className='flex items-center justify-center px-2 py-2 border border-red-300 text-red-600 rounded hover:bg-red-50 hover:border-red-400 h-10 w-10'
            title='Remove image'
            aria-label='Remove image'
          >
            <X className='h-4 w-4' />
          </button>
        )}
        {overlayImage && (
          <p className='text-xs text-gray-600 ml-2 truncate max-w-[180px]'>
            {overlayImage.name}
          </p>
        )}
      </div>
      {/* Filename is shown inline next to the icons; duplicate bottom filename removed */}
    </div>
  );
}
