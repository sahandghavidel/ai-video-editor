'use client';

import React from 'react';
import {
  AppWindow,
  Gift,
  Image as ImageIcon,
  List,
  Loader2,
  Plus,
  RotateCcw,
  Smile,
  Upload,
  Wand2,
  X,
} from 'lucide-react';
import type { TranscriptionWord } from './types';

export type MacWindowTheme = 'dark' | 'light';

type Props = {
  transcriptionWords: TranscriptionWord[] | null;
  customText: string;
  selectedWordText: string | null;
  macWindowTitle: string;
  macWindowTheme: MacWindowTheme;

  onWordClick: (word: TranscriptionWord) => void;
  onWordRightClick: (word: TranscriptionWord) => void;
  onWordDoubleClick: (word: TranscriptionWord) => void;
  onCustomTextChange: (v: string) => void;
  onMacWindowTitleChange: (v: string) => void;
  onMacWindowThemeChange: (v: MacWindowTheme) => void;
  onCustomTextEnter: () => void;
  onAddText: () => void;
  onAddBrandedText: () => void;
  isBrandedTextActive: boolean;
  isBrandedTextLoading: boolean;
  onAddMacWindow: () => void;
  onClearText: () => void;
  onInsertFull: () => void;

  canTranscribe: boolean;
  onTranscribe: () => Promise<void>;
  onRetranscribe: () => Promise<void>;
  isTranscribing: boolean;

  canAutoFixMismatch?: boolean;
  onAutoFixMismatch?: () => Promise<void>;
  isAutoFixingMismatch?: boolean;

  isInsertFullDisabled: boolean;
};

export function TranscriptionControls({
  transcriptionWords,
  customText,
  selectedWordText,
  macWindowTitle,
  macWindowTheme,
  onWordClick,
  onWordRightClick,
  onWordDoubleClick,
  onCustomTextChange,
  onMacWindowTitleChange,
  onMacWindowThemeChange,
  onCustomTextEnter,
  onAddText,
  onAddBrandedText,
  isBrandedTextActive,
  isBrandedTextLoading,
  onAddMacWindow,
  onClearText,
  onInsertFull,
  canTranscribe,
  onTranscribe,
  onRetranscribe,
  isTranscribing,
  canAutoFixMismatch,
  onAutoFixMismatch,
  isAutoFixingMismatch,
  isInsertFullDisabled,
}: Props) {
  const hasWords = !!transcriptionWords && transcriptionWords.length > 0;

  const openGoogleImages = () => {
    const q = customText.trim();
    const url = `https://www.google.com/search?udm=2&q=${encodeURIComponent(
      q,
    )}`;
    window.open(url, '_blank', 'noopener,noreferrer');
  };

  const openGiphySearch = () => {
    const q = customText.trim();
    const url = q
      ? `https://giphy.com/search/${encodeURIComponent(q)}`
      : 'https://giphy.com/search/';
    window.open(url, '_blank', 'noopener,noreferrer');
  };

  const openNotoEmojiSearch = () => {
    const q = customText.trim();
    const url = `https://googlefonts.github.io/noto-emoji-animation/?icon.query=${encodeURIComponent(
      q,
    )}`;
    window.open(url, '_blank', 'noopener,noreferrer');
  };

  if (!hasWords) {
    if (!canTranscribe) return null;
    return (
      <div className='space-y-2'>
        <div className='flex items-center gap-2'>
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

          {canAutoFixMismatch && onAutoFixMismatch && (
            <button
              onClick={onAutoFixMismatch}
              disabled={isTranscribing || !!isAutoFixingMismatch}
              className='p-2 text-gray-700 rounded border border-gray-300 hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center'
              title='Auto-fix mismatch: will transcribe if needed, then regenerate TTS + sync + retranscribe (max 2 tries)'
              aria-label='Auto-fix mismatch between scene text and transcription'
            >
              {isAutoFixingMismatch ? (
                <Loader2 className='h-4 w-4 animate-spin' />
              ) : (
                <Wand2 className='h-4 w-4' />
              )}
            </button>
          )}
        </div>
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
        <textarea
          rows={1}
          value={customText}
          onChange={(e) => onCustomTextChange(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              onCustomTextEnter();
            }
          }}
          placeholder='Enter text (Shift+Enter for a new line)...'
          className='w-2/3 min-h-10 max-h-28 px-3 py-2 text-sm border border-gray-300 rounded resize-y focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent'
        />
        <button
          type='button'
          onClick={openGoogleImages}
          className='p-2 bg-gray-100 text-gray-700 rounded border border-gray-300 hover:bg-gray-200 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center'
          aria-label='Search Google Images for input text'
          title='Search Google Images'
        >
          <ImageIcon className='h-4 w-4' />
        </button>

        <button
          type='button'
          onClick={openGiphySearch}
          className='p-2 bg-gray-100 text-gray-700 rounded border border-gray-300 hover:bg-gray-200 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center'
          aria-label='Search Giphy for input text'
          title='Search Giphy'
        >
          <Gift className='h-4 w-4' />
        </button>

        <button
          type='button'
          onClick={openNotoEmojiSearch}
          className='p-2 bg-gray-100 text-gray-700 rounded border border-gray-300 hover:bg-gray-200 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center'
          aria-label='Search Noto Emoji for input text'
          title='Search Noto Emoji'
        >
          <Smile className='h-4 w-4' />
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
          onClick={onAddBrandedText}
          disabled={!customText.trim() || isBrandedTextLoading}
          className={`p-2 text-white rounded disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center ${
            isBrandedTextActive
              ? 'bg-amber-500 hover:bg-amber-600'
              : 'bg-blue-700 hover:bg-blue-800'
          }`}
          aria-label='Add branded text template'
          title='Add the fixed JavaScript King branded text template'
        >
          {isBrandedTextLoading ? (
            <Loader2 className='h-4 w-4 animate-spin' />
          ) : (
            <Wand2 className='h-4 w-4' />
          )}
        </button>
        <button
          type='button'
          onClick={onAddMacWindow}
          disabled={!customText.trim()}
          className='p-2 bg-gray-100 text-gray-700 rounded border border-gray-300 hover:bg-gray-200 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center'
          aria-label='Add text inside a Mac-style window'
          title='Add as Mac window'
        >
          <AppWindow className='h-4 w-4' />
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

        {canAutoFixMismatch && onAutoFixMismatch && (
          <button
            onClick={onAutoFixMismatch}
            disabled={isTranscribing || !!isAutoFixingMismatch}
            className='p-2 text-gray-700 rounded border border-gray-300 hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center'
            title='If transcription differs from the scene text, regenerate TTS with a new random seed, sync video, and retranscribe (max 2 tries)'
            aria-label='Auto-fix mismatch between scene text and transcription'
          >
            {isAutoFixingMismatch ? (
              <Loader2 className='h-4 w-4 animate-spin' />
            ) : (
              <Wand2 className='h-4 w-4' />
            )}
          </button>
        )}
      </div>

      <div className='flex gap-2 items-center w-full'>
        <input
          type='text'
          value={macWindowTitle}
          onChange={(e) => onMacWindowTitleChange(e.target.value)}
          placeholder='Optional window title'
          aria-label='Mac window title'
          className='min-w-0 flex-1 h-10 px-3 text-sm border border-gray-300 rounded focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent'
        />
        <label className='flex items-center gap-2 text-sm text-gray-700'>
          <span>Window theme</span>
          <select
            value={macWindowTheme}
            onChange={(e) =>
              onMacWindowThemeChange(e.target.value as MacWindowTheme)
            }
            aria-label='Mac window theme'
            className='h-10 px-3 text-sm bg-white border border-gray-300 rounded focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent'
          >
            <option value='dark'>Dark</option>
            <option value='light'>Light</option>
          </select>
        </label>
      </div>
    </div>
  );
}
