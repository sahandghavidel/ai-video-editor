'use client';

import React, { useEffect, useRef } from 'react';
import { X } from 'lucide-react';

interface SceneSeparationModalProps {
  isOpen: boolean;
  sceneId: number | null;
  videoUrl: string | null;
  onClose: () => void;
}

export default function SceneSeparationModal({
  isOpen,
  sceneId,
  videoUrl,
  onClose,
}: SceneSeparationModalProps) {
  const sceneSeparationVideoRef = useRef<HTMLVideoElement | null>(null);

  useEffect(() => {
    if (!isOpen) return;

    const handleSceneSeparationKeydown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onClose();
        return;
      }

      const target = event.target as EventTarget | null;
      const isTypingTarget =
        target instanceof HTMLInputElement ||
        target instanceof HTMLTextAreaElement ||
        target instanceof HTMLSelectElement ||
        (target instanceof HTMLElement && target.isContentEditable);

      if (isTypingTarget) return;

      const isOneKey =
        event.key === '1' ||
        event.code === 'Digit1' ||
        event.code === 'Numpad1';

      if (!isOneKey) return;

      event.preventDefault();
      const video = sceneSeparationVideoRef.current;
      if (!video) return;

      try {
        video.currentTime = 0;
        const playPromise = video.play();
        if (playPromise && typeof playPromise.catch === 'function') {
          playPromise.catch((error) => {
            console.warn('Could not auto-play separation modal video:', error);
          });
        }
      } catch (error) {
        console.warn('Failed to restart separation modal video:', error);
      }
    };

    document.addEventListener('keydown', handleSceneSeparationKeydown);
    return () =>
      document.removeEventListener('keydown', handleSceneSeparationKeydown);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  return (
    <div
      className='fixed inset-0 z-[70] bg-black/70 p-4 sm:p-6 flex items-center justify-center'
      onClick={onClose}
      role='dialog'
      aria-modal='true'
      aria-label={`Separate scene ${sceneId ?? ''}`.trim()}
    >
      <div
        className='w-full max-w-5xl bg-white rounded-xl shadow-2xl border border-gray-200 overflow-hidden'
        onClick={(e) => e.stopPropagation()}
      >
        <div className='px-4 sm:px-5 py-3 border-b border-gray-200 flex items-center justify-between'>
          <div>
            <h3 className='text-sm sm:text-base font-semibold text-gray-900'>
              Separate Scene {sceneId ?? ''}
            </h3>
            <p className='text-xs text-gray-500 mt-0.5'>
              Step 1: Preview the original scene video (field 6888).
            </p>
          </div>
          <button
            onClick={onClose}
            className='inline-flex items-center justify-center w-8 h-8 rounded-md text-gray-500 hover:text-gray-700 hover:bg-gray-100 transition-colors'
            aria-label='Close separation modal'
            title='Close'
          >
            <X className='h-4 w-4' />
          </button>
        </div>

        <div className='p-4 sm:p-5'>
          {videoUrl ? (
            <video
              ref={sceneSeparationVideoRef}
              src={videoUrl}
              controls
              className='w-full h-auto max-h-[70vh] rounded-lg bg-black'
            >
              Your browser does not support the video tag.
            </video>
          ) : (
            <div className='rounded-lg border border-amber-200 bg-amber-50 text-amber-800 text-sm px-3 py-2'>
              Original video URL is missing for this scene.
            </div>
          )}
        </div>

        <div className='px-4 sm:px-5 pb-4 sm:pb-5 flex justify-end'>
          <button
            onClick={onClose}
            className='px-3 py-1.5 text-xs font-medium rounded-md bg-gray-100 text-gray-700 hover:bg-gray-200 transition-colors'
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
