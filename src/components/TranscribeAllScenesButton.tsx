'use client';

import { Loader2, Subtitles } from 'lucide-react';

type TranscribeAllScenesButtonProps = {
  onClick: () => void;
  disabled?: boolean;
  hasSelectedVideo?: boolean;
  isRunning: boolean;
  currentSceneId: number | null;
};

export default function TranscribeAllScenesButton({
  onClick,
  disabled = false,
  hasSelectedVideo = true,
  isRunning,
  currentSceneId,
}: TranscribeAllScenesButtonProps) {
  const title = !hasSelectedVideo
    ? 'Select an original video first'
    : isRunning
      ? currentSceneId !== null
        ? `Transcribing scene ${currentSceneId}`
        : 'Transcribing all scenes...'
      : 'Transcribe all scene final videos (field_6886) and save captions to field_6910';

  const label = isRunning
    ? currentSceneId !== null
      ? `Scene #${currentSceneId}`
      : 'Processing...'
    : 'Transcribe All Scenes';

  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className='w-full h-10 mt-2 bg-purple-500 hover:bg-purple-600 disabled:bg-purple-300 text-white text-sm font-medium rounded-lg transition-all duration-200 flex items-center justify-center gap-2 shadow-sm hover:shadow-md disabled:cursor-not-allowed'
      title={title}
    >
      {isRunning ? (
        <Loader2 className='w-4 h-4 animate-spin' />
      ) : (
        <Subtitles className='w-4 h-4' />
      )}
      <span className='font-medium'>{label}</span>
    </button>
  );
}
