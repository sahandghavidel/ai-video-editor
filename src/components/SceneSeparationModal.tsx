'use client';

import React, { useEffect, useRef, useState } from 'react';
import { Loader2, X } from 'lucide-react';

interface SceneSeparationModalProps {
  isOpen: boolean;
  sceneId: number | null;
  videoUrl: string | null;
  captionsUrl: string | null;
  onClose: () => void;
  onApplySeparation?: (editedWords: CaptionWord[]) => Promise<void> | void;
  isApplyingSeparation?: boolean;
  onRetranscribeOriginal?: () => Promise<void> | void;
  isRetranscribing?: boolean;
  isTranscribeBusy?: boolean;
}

type CaptionWord = {
  word: string;
  start: number;
  end: number;
};

const normalizeCaptionWords = (payload: unknown): CaptionWord[] => {
  if (!Array.isArray(payload)) return [];

  return payload
    .map((item) => {
      if (!item || typeof item !== 'object') return null;
      const record = item as Record<string, unknown>;
      const word =
        typeof record.word === 'string'
          ? record.word
          : typeof record.text === 'string'
            ? record.text
            : '';
      const start =
        typeof record.start === 'number' && Number.isFinite(record.start)
          ? record.start
          : 0;
      const end =
        typeof record.end === 'number' && Number.isFinite(record.end)
          ? record.end
          : start;

      const trimmedWord = word.trim();
      if (!trimmedWord) return null;

      return {
        word: trimmedWord,
        start,
        end,
      };
    })
    .filter((item): item is CaptionWord => item !== null);
};

export default function SceneSeparationModal({
  isOpen,
  sceneId,
  videoUrl,
  captionsUrl,
  onClose,
  onApplySeparation,
  isApplyingSeparation = false,
  onRetranscribeOriginal,
  isRetranscribing = false,
  isTranscribeBusy = false,
}: SceneSeparationModalProps) {
  const sceneSeparationVideoRef = useRef<HTMLVideoElement | null>(null);
  const [captionWords, setCaptionWords] = useState<CaptionWord[]>([]);
  const [loadingWords, setLoadingWords] = useState(false);
  const [wordsError, setWordsError] = useState<string | null>(null);
  const [applyError, setApplyError] = useState<string | null>(null);
  const [editingWordIndex, setEditingWordIndex] = useState<number | null>(null);
  const [editingWordValue, setEditingWordValue] = useState('');

  const commitWordEdit = () => {
    if (editingWordIndex === null) return;

    const nextWord = editingWordValue.trim();
    if (!nextWord) {
      setEditingWordIndex(null);
      setEditingWordValue('');
      return;
    }

    setCaptionWords((prev) =>
      prev.map((word, index) =>
        index === editingWordIndex ? { ...word, word: nextWord } : word,
      ),
    );
    setEditingWordIndex(null);
    setEditingWordValue('');
  };

  const cancelWordEdit = () => {
    setEditingWordIndex(null);
    setEditingWordValue('');
  };

  const handleApplySeparation = async () => {
    if (!sceneId) {
      setApplyError('No active scene selected.');
      return;
    }

    if (!captionWords.length) {
      setApplyError(
        'No caption words available to split. Re-transcribe original first.',
      );
      return;
    }

    if (!onApplySeparation) {
      setApplyError('Apply action is not available right now.');
      return;
    }

    setApplyError(null);

    try {
      await onApplySeparation(captionWords);
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : 'Failed to apply scene separation.';
      setApplyError(message);
    }
  };

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

  useEffect(() => {
    if (!isOpen) return;

    if (!captionsUrl) {
      setCaptionWords([]);
      setWordsError(null);
      setLoadingWords(false);
      setApplyError(null);
      setEditingWordIndex(null);
      setEditingWordValue('');
      return;
    }

    let cancelled = false;

    const loadCaptionWords = async () => {
      setLoadingWords(true);
      setWordsError(null);

      try {
        const separator = captionsUrl.includes('?') ? '&' : '?';
        const response = await fetch(
          `${captionsUrl}${separator}t=${Date.now()}`,
          {
            cache: 'no-store',
          },
        );

        if (!response.ok) {
          throw new Error(`Failed to load captions (${response.status})`);
        }

        const payload = (await response.json()) as unknown;
        if (cancelled) return;

        setCaptionWords(normalizeCaptionWords(payload));
        setApplyError(null);
        setEditingWordIndex(null);
        setEditingWordValue('');
      } catch (error) {
        if (cancelled) return;
        const message =
          error instanceof Error
            ? error.message
            : 'Failed to load caption words.';
        setWordsError(message);
        setCaptionWords([]);
      } finally {
        if (!cancelled) {
          setLoadingWords(false);
        }
      }
    };

    void loadCaptionWords();

    return () => {
      cancelled = true;
    };
  }, [isOpen, captionsUrl]);

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
        className='w-full max-w-6xl bg-white rounded-xl shadow-2xl border border-gray-200 overflow-hidden'
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
              className='w-full h-auto max-h-[48vh] rounded-lg bg-black'
            >
              Your browser does not support the video tag.
            </video>
          ) : (
            <div className='rounded-lg border border-amber-200 bg-amber-50 text-amber-800 text-sm px-3 py-2'>
              Original video URL is missing for this scene.
            </div>
          )}

          <div className='mt-4 rounded-lg border border-gray-200 overflow-hidden'>
            <div className='px-3 py-2 bg-gray-50 border-b border-gray-200'>
              <h4 className='text-xs sm:text-sm font-semibold text-gray-800'>
                Original Video Caption for Scene (7120)
              </h4>
              <p className='text-[11px] sm:text-xs text-gray-500 mt-0.5'>
                Click a word to edit it (for punctuation/dot adjustments).
              </p>
            </div>

            <div className='p-3 max-h-[9rem] overflow-y-auto'>
              {loadingWords ? (
                <div className='flex items-center gap-2 text-sm text-gray-500'>
                  <Loader2 className='h-3.5 w-3.5 animate-spin' />
                  <span>Loading caption words...</span>
                </div>
              ) : wordsError ? (
                <div className='rounded-md border border-amber-200 bg-amber-50 text-amber-800 text-sm px-2.5 py-2'>
                  {wordsError}
                </div>
              ) : captionWords.length === 0 ? (
                <div className='text-sm text-gray-500'>
                  No caption words loaded yet. Re-transcribe original to load
                  words.
                </div>
              ) : (
                <div className='flex flex-wrap gap-2'>
                  {captionWords.map((item, index) => {
                    if (editingWordIndex === index) {
                      return (
                        <input
                          key={`edit-${index}`}
                          value={editingWordValue}
                          onChange={(e) => setEditingWordValue(e.target.value)}
                          onBlur={commitWordEdit}
                          onKeyDown={(event) => {
                            if (event.key === 'Enter') {
                              event.preventDefault();
                              commitWordEdit();
                            } else if (event.key === 'Escape') {
                              event.preventDefault();
                              cancelWordEdit();
                            }
                          }}
                          autoFocus
                          className='min-w-[72px] px-2.5 py-1.5 text-sm rounded border border-cyan-300 focus:outline-none focus:ring-1 focus:ring-cyan-500'
                        />
                      );
                    }

                    return (
                      <button
                        key={`${index}-${item.start}-${item.end}-${item.word}`}
                        onClick={() => {
                          setEditingWordIndex(index);
                          setEditingWordValue(item.word);
                        }}
                        className='px-2.5 py-1.5 text-sm rounded border border-gray-300 bg-white text-gray-700 hover:bg-gray-100 transition-colors'
                        title='Click to edit this word'
                      >
                        {item.word}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        </div>

        <div className='px-4 sm:px-5 pb-4 sm:pb-5 space-y-2'>
          <div className='flex items-center justify-between gap-3'>
            <button
              onClick={() => {
                void onRetranscribeOriginal?.();
              }}
              disabled={!sceneId || isTranscribeBusy || isApplyingSeparation}
              className={`inline-flex items-center justify-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${
                isRetranscribing
                  ? 'bg-cyan-100 text-cyan-700'
                  : 'bg-cyan-600 text-white hover:bg-cyan-700'
              }`}
              title={
                isRetranscribing
                  ? 'Re-transcribing original scene video...'
                  : isTranscribeBusy
                    ? 'Another scene transcription is already in progress'
                    : 'Re-transcribe the original scene video (field 6888)'
              }
            >
              {isRetranscribing ? (
                <Loader2 className='h-3.5 w-3.5 animate-spin' />
              ) : (
                <span className='text-[11px] leading-none'>🎙️</span>
              )}
              <span>
                {isRetranscribing
                  ? 'Transcribing...'
                  : 'Re-Transcribe Original'}
              </span>
            </button>

            <div className='flex items-center gap-2'>
              <button
                onClick={() => {
                  void handleApplySeparation();
                }}
                disabled={
                  !sceneId ||
                  !captionWords.length ||
                  loadingWords ||
                  isRetranscribing ||
                  isApplyingSeparation ||
                  !onApplySeparation
                }
                className={`inline-flex items-center justify-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${
                  isApplyingSeparation
                    ? 'bg-fuchsia-100 text-fuchsia-700'
                    : 'bg-fuchsia-600 text-white hover:bg-fuchsia-700'
                }`}
                title='Apply split using edited words and create separated scenes'
              >
                {isApplyingSeparation ? (
                  <Loader2 className='h-3.5 w-3.5 animate-spin' />
                ) : (
                  <span className='text-[11px] leading-none'>✂️</span>
                )}
                <span>
                  {isApplyingSeparation ? 'Applying...' : 'Apply Separation'}
                </span>
              </button>

              <button
                onClick={onClose}
                disabled={isApplyingSeparation}
                className='px-3 py-1.5 text-xs font-medium rounded-md bg-gray-100 text-gray-700 hover:bg-gray-200 transition-colors disabled:opacity-50 disabled:cursor-not-allowed'
              >
                Close
              </button>
            </div>
          </div>

          {applyError ? (
            <div className='rounded-md border border-rose-200 bg-rose-50 text-rose-700 text-xs px-2.5 py-2'>
              {applyError}
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
