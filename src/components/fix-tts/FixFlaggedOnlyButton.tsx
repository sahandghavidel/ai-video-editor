'use client';

import { Loader2 } from 'lucide-react';

interface FixFlaggedOnlyButtonProps {
  onClick: () => void;
  disabled: boolean;
  hasSelectedVideo: boolean;
  isRunning: boolean;
  currentSceneId: number | null;
}

export function FixFlaggedOnlyButton({
  onClick,
  disabled,
  hasSelectedVideo,
  isRunning,
  currentSceneId,
}: FixFlaggedOnlyButtonProps) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className='mt-3 w-full h-12 bg-emerald-500 hover:bg-emerald-600 disabled:bg-emerald-300 text-white font-medium rounded-lg transition-all duration-200 flex items-center justify-center gap-2 shadow-sm hover:shadow-md disabled:cursor-not-allowed'
      title={
        !hasSelectedVideo
          ? 'Select an original video first'
          : isRunning
            ? currentSceneId !== null
              ? `Fixing flagged scene ${currentSceneId}`
              : 'Fixing only scenes where Flagged (7096) is true...'
            : 'Fix only scenes where Flagged (7096) is true'
      }
    >
      {isRunning && <Loader2 className='w-4 h-4 animate-spin' />}
      <span className='font-medium'>
        {isRunning
          ? currentSceneId !== null
            ? `Flagged #${currentSceneId}`
            : 'Processing...'
          : 'Fix Flagged'}
      </span>
    </button>
  );
}
