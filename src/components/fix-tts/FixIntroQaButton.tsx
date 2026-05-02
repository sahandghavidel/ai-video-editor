'use client';

import { Loader2 } from 'lucide-react';

interface FixIntroQaButtonProps {
  onClick: () => void;
  disabled: boolean;
  hasSelectedVideo: boolean;
  isRunning: boolean;
  currentSceneId: number | null;
  introLimit?: number;
  maxAudioAttempts?: number;
  className?: string;
}

export function FixIntroQaButton({
  onClick,
  disabled,
  hasSelectedVideo,
  isRunning,
  currentSceneId,
  introLimit = 10,
  maxAudioAttempts = 3,
  className = '',
}: FixIntroQaButtonProps) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={`w-full h-10 bg-emerald-500 hover:bg-emerald-600 disabled:bg-emerald-300 text-white text-sm font-medium rounded-lg transition-all duration-200 flex items-center justify-center gap-2 shadow-sm hover:shadow-md disabled:cursor-not-allowed ${className}`}
      title={
        !hasSelectedVideo
          ? 'Select an original video first'
          : isRunning
            ? currentSceneId !== null
              ? `Fixing intro QA for scene ${currentSceneId}`
              : `Fixing intro QA for first ${introLimit} scenes (up to ${maxAudioAttempts} generated audios)...`
            : `Fix intro scenes with text+silence QA (first ${introLimit} scenes, up to ${maxAudioAttempts} generated audios)`
      }
    >
      {isRunning && <Loader2 className='w-4 h-4 animate-spin' />}
      <span className='font-medium'>
        {isRunning
          ? currentSceneId !== null
            ? `Intro #${currentSceneId}`
            : 'Processing...'
          : 'Fix Intro QA'}
      </span>
    </button>
  );
}
