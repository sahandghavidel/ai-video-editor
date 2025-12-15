'use client';

import React from 'react';
import {
  Gift,
  Image,
  List,
  Loader2,
  Plus,
  RotateCcw,
  Upload,
  X,
} from 'lucide-react';
import type { TranscriptionWord } from './types';

type Props = {
  transcriptionWords: TranscriptionWord[] | null;
  customText: string;
  selectedWordText: string | null;

  onWordClick: (word: TranscriptionWord) => void;
  onWordRightClick: (word: TranscriptionWord) => void;
  onWordDoubleClick: (word: TranscriptionWord) => void;
  onCustomTextChange: (v: string) => void;
  onCustomTextEnter: () => void;
  onAddText: () => void;
  onClearText: () => void;
  onInsertFull: () => void;

  canTranscribe: boolean;
  onTranscribe: () => Promise<void>;
  onRetranscribe: () => Promise<void>;
  isTranscribing: boolean;

  isInsertFullDisabled: boolean;
};

export function TranscriptionControls({
  transcriptionWords,
  customText,
  selectedWordText,
  onWordClick,
  onWordRightClick,
  onWordDoubleClick,
  onCustomTextChange,
  onCustomTextEnter,
  onAddText,
  onClearText,
  onInsertFull,
  canTranscribe,
  onTranscribe,
  onRetranscribe,
  isTranscribing,
  isInsertFullDisabled,
}: Props) {
  const hasWords = !!transcriptionWords && transcriptionWords.length > 0;

  const openGoogleImages = () => {
    const q = customText.trim();
    if (!q) return;
    const url = `https://www.google.com/search?udm=2&q=${encodeURIComponent(
      q
    )}`;
    window.open(url, '_blank', 'noopener,noreferrer');
  };

  const openGiphySearch = () => {
    const q = customText.trim();
    if (!q) return;
    const url = `https://giphy.com/search/${encodeURIComponent(q)}`;
    window.open(url, '_blank', 'noopener,noreferrer');
  };

  if (!hasWords) {
    if (!canTranscribe) return null;
    return (
      <div className='space-y-2'>
        <button
          onClick={onTranscribe}
          disabled={isTranscribing}
          className='p-2 text-gray-700 rounded border border-gray-300 hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center'
          title='Transcribe final video for this scene'
          aria-label='Transcribe final video for this scene'
        >
          {isTranscribing ? (
            <Loader2 className='h-4 w-4 animate-spin' />
          ) : (
            <Upload className='h-4 w-4' />
          )}
          <span className='sr-only'>
            {isTranscribing ? 'Transcribing...' : 'Transcribe Final Video'}
          </span>
        </button>
      </div>
    );
  }

  return (
    <div className='space-y-2'>
      <div className='max-h-48 overflow-y-auto bg-gray-50 p-3 rounded border'>
        <div className='flex flex-wrap gap-1'>
          {transcriptionWords!.map((wordData, index) => (
            <button
              key={index}
              onClick={() => onWordClick(wordData)}
              onDoubleClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                onWordDoubleClick(wordData);
              }}
              onContextMenu={(e) => {
                e.preventDefault();
                e.stopPropagation();
                onWordRightClick(wordData);
              }}
              className='px-3 py-1.5 text-sm font-medium rounded transition-colors bg-white text-gray-700 border border-gray-300 hover:bg-blue-50 hover:border-blue-300'
              title={`Click to set start time to ${wordData.start}s. Double-click to add as overlay. Right-click to set end time to ${wordData.end}s.`}
            >
              {wordData.word}
            </button>
          ))}
        </div>
      </div>

      {/* Custom Text Input */}
      <div className='flex gap-2 mt-3 items-center w-full'>
        <input
          type='text'
          value={customText}
          onChange={(e) => onCustomTextChange(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              onCustomTextEnter();
            }
          }}
          placeholder='Enter custom text for overlay...'
          className='w-2/3 px-3 py-2 text-sm border border-gray-300 rounded focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent'
        />
        <button
          type='button'
          onClick={openGoogleImages}
          disabled={!customText.trim()}
          className='p-2 bg-gray-100 text-gray-700 rounded border border-gray-300 hover:bg-gray-200 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center'
          aria-label='Search Google Images for input text'
          title='Search Google Images'
        >
          <Image className='h-4 w-4' />
        </button>

        <button
          type='button'
          onClick={openGiphySearch}
          disabled={!customText.trim()}
          className='p-2 bg-gray-100 text-gray-700 rounded border border-gray-300 hover:bg-gray-200 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center'
          aria-label='Search Giphy for input text'
          title='Search Giphy'
        >
          <Gift className='h-4 w-4' />
        </button>

        <button
          onClick={onAddText}
          disabled={!customText.trim()}
          className='p-2 bg-green-600 text-white rounded hover:bg-green-700 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center'
          aria-label='Add text as overlay'
        >
          <Plus className='h-4 w-4' />
        </button>
        <button
          type='button'
          onClick={onClearText}
          disabled={!selectedWordText && !customText.trim()}
          className='p-2 bg-gray-100 text-gray-700 rounded border border-gray-300 hover:bg-gray-200 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center'
          aria-label='Clear text overlay'
          title='Clear text overlay'
        >
          <X className='h-4 w-4' />
        </button>

        <button
          onClick={onInsertFull}
          disabled={isInsertFullDisabled}
          className='p-2 bg-gray-100 text-gray-700 rounded border border-gray-300 hover:bg-gray-200 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center'
          aria-label='Insert full transcription'
          title='Insert full transcription into the input field'
        >
          <List className='h-4 w-4' />
        </button>

        {canTranscribe && (
          <button
            onClick={onRetranscribe}
            disabled={isTranscribing}
            className='p-2 text-gray-700 rounded border border-gray-300 hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center'
            title='Retranscribe final video for this scene'
            aria-label='Retranscribe final video for this scene'
          >
            {isTranscribing ? (
              <Loader2 className='h-4 w-4 animate-spin' />
            ) : (
              <RotateCcw className='h-4 w-4' />
            )}
          </button>
        )}
      </div>
    </div>
  );
}
