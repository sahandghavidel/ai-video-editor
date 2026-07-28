'use client';

import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowDown,
  ArrowUp,
  Copy,
  Loader2,
  Pause,
  Play,
  Plus,
  Redo2,
  Scissors,
  Sparkles,
  Trash2,
  Undo2,
  X,
} from 'lucide-react';
import type {
  AiIntroClipSuggestion,
  AiIntroSourceSegment,
  AiIntroSuggestionResponse,
} from './types';

type Props = {
  isOpen: boolean;
  sceneId: number;
  sourceVideoUrl: string;
  targetStartTime: number;
  targetEndTime: number;
  model: string | null;
  onClose: () => void;
  onUseVideo: (selection: {
    segments: AiIntroSourceSegment[];
    previewBlob: Blob;
  }) => void;
};

const MIN_SEGMENT_SECONDS = 0.05;
const FRAME_SECONDS = 1 / 30;

function cloneSegments(
  segments: AiIntroSourceSegment[],
): AiIntroSourceSegment[] {
  return segments.map((segment) => ({ ...segment }));
}

export function AiIntroVideoSectionsModal({
  isOpen,
  sceneId,
  sourceVideoUrl,
  targetStartTime,
  targetEndTime,
  model,
  onClose,
  onUseVideo,
}: Props) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const timelineRef = useRef<HTMLDivElement>(null);
  const [duration, setDuration] = useState(0);
  const [currentTime, setCurrentTime] = useState(0);
  const [draftStart, setDraftStart] = useState(0);
  const [draftEnd, setDraftEnd] = useState(0);
  const [segments, setSegments] = useState<AiIntroSourceSegment[]>([]);
  const [activeSegmentIndex, setActiveSegmentIndex] = useState<number | null>(
    null,
  );
  const [thumbnails, setThumbnails] = useState<
    Array<{ time: number; dataUrl: string }>
  >([]);
  const [timelineZoom, setTimelineZoom] = useState(1);
  const [undoStack, setUndoStack] = useState<AiIntroSourceSegment[][]>([]);
  const [redoStack, setRedoStack] = useState<AiIntroSourceSegment[][]>([]);
  const [isPreviewingSelection, setIsPreviewingSelection] = useState(false);
  const [previewSegmentIndex, setPreviewSegmentIndex] = useState(0);
  const [suggestions, setSuggestions] = useState<AiIntroClipSuggestion[]>([]);
  const [isSuggesting, setIsSuggesting] = useState(false);
  const [isBuilding, setIsBuilding] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const targetDuration = Math.max(0, targetEndTime - targetStartTime);

  useEffect(() => {
    if (!isOpen) return;
    setSegments([]);
    setSuggestions([]);
    setDuration(0);
    setDraftStart(0);
    setDraftEnd(0);
    setCurrentTime(0);
    setActiveSegmentIndex(null);
    setUndoStack([]);
    setRedoStack([]);
    setIsPreviewingSelection(false);
    setPreviewSegmentIndex(0);
    setIsSuggesting(false);
    setIsBuilding(false);
    setError(null);
  }, [isOpen, sourceVideoUrl]);

  useEffect(() => {
    if (!isOpen || !sourceVideoUrl || !(duration > 0)) return;
    let cancelled = false;
    const thumbnailVideo = document.createElement('video');
    thumbnailVideo.muted = true;
    thumbnailVideo.preload = 'auto';
    thumbnailVideo.src = sourceVideoUrl;

    const waitForEvent = (eventName: 'loadeddata' | 'seeked') =>
      new Promise<void>((resolve, reject) => {
        const cleanup = () => {
          thumbnailVideo.removeEventListener(eventName, handleSuccess);
          thumbnailVideo.removeEventListener('error', handleError);
        };
        const handleSuccess = () => {
          cleanup();
          resolve();
        };
        const handleError = () => {
          cleanup();
          reject(new Error('Unable to read original-video frames.'));
        };
        thumbnailVideo.addEventListener(eventName, handleSuccess, {
          once: true,
        });
        thumbnailVideo.addEventListener('error', handleError, { once: true });
      });

    void (async () => {
      try {
        await waitForEvent('loadeddata');
        const canvas = document.createElement('canvas');
        canvas.width = 160;
        canvas.height = 90;
        const context = canvas.getContext('2d');
        if (!context) return;
        const next: Array<{ time: number; dataUrl: string }> = [];
        for (let index = 0; index < 12; index += 1) {
          const time = Math.min(
            Math.max(0, duration - 0.02),
            (duration * index) / 11,
          );
          thumbnailVideo.currentTime = time;
          await waitForEvent('seeked');
          if (cancelled) return;
          context.drawImage(thumbnailVideo, 0, 0, 160, 90);
          next.push({
            time,
            dataUrl: canvas.toDataURL('image/jpeg', 0.65),
          });
        }
        if (!cancelled) setThumbnails(next);
      } catch {
        if (!cancelled) setThumbnails([]);
      }
    })();

    return () => {
      cancelled = true;
      thumbnailVideo.removeAttribute('src');
      thumbnailVideo.load();
    };
  }, [duration, isOpen, sourceVideoUrl]);

  const selectedDuration = useMemo(
    () =>
      segments.reduce(
        (total, segment) => total + segment.endTime - segment.startTime,
        0,
      ),
    [segments],
  );
  const findSuggestionForSegment = (segment: AiIntroSourceSegment) =>
    suggestions.find(
      (suggestion) =>
        Math.max(segment.startTime, suggestion.sourceStartTime) <
        Math.min(segment.endTime, suggestion.sourceEndTime),
    );

  const commitSegments = (next: AiIntroSourceSegment[]) => {
    setUndoStack((history) => [...history.slice(-49), cloneSegments(segments)]);
    setRedoStack([]);
    setSegments(next);
    setError(null);
  };

  const clampTime = (value: number) =>
    Math.max(0, Math.min(duration, value));

  const validate = (items: AiIntroSourceSegment[]): string | null => {
    if (items.length === 0) return 'Add at least one source section.';
    if (items.length > 6) return 'Use no more than six source sections.';
    for (let index = 0; index < items.length; index += 1) {
      const segment = items[index];
      if (
        !Number.isFinite(segment.startTime) ||
        !Number.isFinite(segment.endTime) ||
        segment.endTime - segment.startTime < MIN_SEGMENT_SECONDS
      ) {
        return `Section ${index + 1} needs an End after its Start.`;
      }
    }
    return null;
  };

  const updateSegment = (
    index: number,
    key: keyof AiIntroSourceSegment,
    value: number,
  ) => {
    const next = cloneSegments(segments);
    next[index] = { ...next[index], [key]: clampTime(value) };
    commitSegments(next);
    setError(null);
    setActiveSegmentIndex(index);
  };

  const seekTo = (value: number, play = false) => {
    const next = clampTime(value);
    setCurrentTime(next);
    if (videoRef.current) {
      videoRef.current.currentTime = next;
      if (play) {
        void videoRef.current.play().catch(() => {
          // The user can resume manually if autoplay is blocked.
        });
      }
    }
  };

  const stepFrame = (direction: -1 | 1) => {
    setIsPreviewingSelection(false);
    seekTo(currentTime + direction * FRAME_SECONDS);
  };

  const seekBySeconds = (seconds: number) => {
    setIsPreviewingSelection(false);
    seekTo(currentTime + seconds);
  };

  const addDraft = () => {
    const next = {
      startTime: clampTime(draftStart),
      endTime: clampTime(draftEnd),
    };
    const validationError = validate([next]);
    if (validationError) {
      setError(validationError);
      return;
    }
    commitSegments([...segments, next]);
    setActiveSegmentIndex(segments.length);
    setError(null);
  };

  const splitAtPlayhead = () => {
    const index = segments.findIndex(
      (segment) =>
        currentTime > segment.startTime + MIN_SEGMENT_SECONDS &&
        currentTime < segment.endTime - MIN_SEGMENT_SECONDS,
    );
    if (index < 0) {
      setError('Move the playhead inside a selected section before splitting.');
      return;
    }
    const next = cloneSegments(segments);
    const active = next[index];
    next.splice(
      index,
      1,
      { startTime: active.startTime, endTime: currentTime },
      { startTime: currentTime, endTime: active.endTime },
    );
    commitSegments(next);
    setActiveSegmentIndex(index + 1);
    setError(null);
  };

  const moveSegment = (index: number, direction: -1 | 1) => {
    const target = index + direction;
    if (target < 0 || target >= segments.length) return;
    const next = cloneSegments(segments);
    [next[index], next[target]] = [next[target], next[index]];
    commitSegments(next);
    setActiveSegmentIndex(target);
  };

  const removeSegment = (index: number) => {
    commitSegments(
      segments.filter((_, segmentIndex) => segmentIndex !== index),
    );
    setActiveSegmentIndex(null);
  };

  const duplicateSegment = (index: number) => {
    const next = cloneSegments(segments);
    next.splice(index + 1, 0, { ...segments[index] });
    commitSegments(next);
    setActiveSegmentIndex(index + 1);
  };

  const invertSelection = () => {
    const ordered = cloneSegments(segments).sort(
      (a, b) => a.startTime - b.startTime,
    );
    const merged: AiIntroSourceSegment[] = [];
    ordered.forEach((segment) => {
      const previous = merged[merged.length - 1];
      if (previous && segment.startTime <= previous.endTime) {
        previous.endTime = Math.max(previous.endTime, segment.endTime);
      } else {
        merged.push({ ...segment });
      }
    });
    const gaps: AiIntroSourceSegment[] = [];
    let cursor = 0;
    merged.forEach((segment) => {
      if (segment.startTime - cursor >= MIN_SEGMENT_SECONDS) {
        gaps.push({ startTime: cursor, endTime: segment.startTime });
      }
      cursor = Math.max(cursor, segment.endTime);
    });
    if (duration - cursor >= MIN_SEGMENT_SECONDS) {
      gaps.push({ startTime: cursor, endTime: duration });
    }
    commitSegments(gaps);
    setActiveSegmentIndex(null);
  };

  const undo = () => {
    const previous = undoStack[undoStack.length - 1];
    if (!previous) return;
    setRedoStack((history) => [...history, cloneSegments(segments)]);
    setSegments(cloneSegments(previous));
    setUndoStack((history) => history.slice(0, -1));
    setActiveSegmentIndex(null);
  };

  const redo = () => {
    const next = redoStack[redoStack.length - 1];
    if (!next) return;
    setUndoStack((history) => [...history, cloneSegments(segments)]);
    setSegments(cloneSegments(next));
    setRedoStack((history) => history.slice(0, -1));
    setActiveSegmentIndex(null);
  };

  const snapTime = (time: number, ignoredIndex?: number) => {
    const candidates = [Math.round(time), currentTime];
    segments.forEach((segment, index) => {
      if (index !== ignoredIndex) {
        candidates.push(segment.startTime, segment.endTime);
      }
    });
    const threshold = Math.max(0.04, duration / (700 * timelineZoom));
    let result = clampTime(time);
    let closestDistance = threshold;
    candidates.forEach((candidate) => {
      const distance = Math.abs(candidate - time);
      if (distance <= closestDistance) {
        result = clampTime(candidate);
        closestDistance = distance;
      }
    });
    return result;
  };

  const startSegmentDrag = (
    event: React.PointerEvent,
    index: number,
    mode: 'start' | 'end' | 'move',
  ) => {
    event.preventDefault();
    event.stopPropagation();
    const timeline = timelineRef.current;
    if (!timeline) return;
    setActiveSegmentIndex(index);
    const initial = cloneSegments(segments);
    const original = { ...segments[index] };
    const startX = event.clientX;
    let hasMoved = false;

    const handleMove = (moveEvent: PointerEvent) => {
      if (Math.abs(moveEvent.clientX - startX) < 3) return;
      hasMoved = true;
      const deltaSeconds =
        ((moveEvent.clientX - startX) / timeline.getBoundingClientRect().width) *
        duration;
      const next = cloneSegments(initial);
      if (mode === 'start') {
        next[index].startTime = Math.min(
          original.endTime - MIN_SEGMENT_SECONDS,
          snapTime(original.startTime + deltaSeconds, index),
        );
      } else if (mode === 'end') {
        next[index].endTime = Math.max(
          original.startTime + MIN_SEGMENT_SECONDS,
          snapTime(original.endTime + deltaSeconds, index),
        );
      } else {
        const sectionDuration = original.endTime - original.startTime;
        const nextStart = Math.max(
          0,
          Math.min(
            duration - sectionDuration,
            original.startTime + deltaSeconds,
          ),
        );
        const snappedStart = Math.max(
          0,
          Math.min(
            duration - sectionDuration,
            snapTime(nextStart, index),
          ),
        );
        next[index] = {
          startTime: snappedStart,
          endTime: Math.min(duration, snappedStart + sectionDuration),
        };
      }
      setSegments(next);
    };
    const handleUp = () => {
      if (hasMoved) {
        setUndoStack((history) => [...history.slice(-49), initial]);
        setRedoStack([]);
      }
      document.removeEventListener('pointermove', handleMove);
      document.removeEventListener('pointerup', handleUp);
    };
    document.addEventListener('pointermove', handleMove);
    document.addEventListener('pointerup', handleUp);
  };

  const startSelectedPreview = () => {
    const validationError = validate(segments);
    if (validationError) {
      setError(validationError);
      return;
    }
    setPreviewSegmentIndex(0);
    setActiveSegmentIndex(0);
    setIsPreviewingSelection(true);
    seekTo(segments[0].startTime, true);
  };

  const requestAiSuggestions = async () => {
    if (!(targetDuration > 0) || targetDuration > 30) {
      setError(
        'Choose a valid transcript range up to 30 seconds before requesting AI clips.',
      );
      return;
    }

    setIsSuggesting(true);
    setError(null);
    try {
      const response = await fetch('/api/suggest-ai-intro-clip', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sceneId,
          targetStartTime,
          targetEndTime,
          model,
        }),
      });
      const result = (await response.json().catch(() => null)) as
        | (AiIntroSuggestionResponse & { error?: string })
        | null;
      if (!response.ok || !result?.suggestions.length) {
        throw new Error(
          result?.error || 'The LLM returned no usable clip suggestions.',
        );
      }

      const next = result.suggestions.map((suggestion) => ({
        startTime: suggestion.sourceStartTime,
        endTime: suggestion.sourceEndTime,
      }));
      videoRef.current?.pause();
      setIsPreviewingSelection(false);
      setSuggestions(result.suggestions);
      commitSegments(next);
      setDraftStart(next[0].startTime);
      setDraftEnd(next[0].endTime);
      setActiveSegmentIndex(0);
      seekTo(next[0].startTime);
    } catch (suggestionError) {
      setError(
        suggestionError instanceof Error
          ? suggestionError.message
          : 'Failed to suggest clips.',
      );
    } finally {
      setIsSuggesting(false);
    }
  };

  useEffect(() => {
    if (!isPreviewingSelection) return;
    const segment = segments[previewSegmentIndex];
    const video = videoRef.current;
    if (!segment || !video) {
      setIsPreviewingSelection(false);
      return;
    }
    let animationFrame = 0;
    const jumpAndPlay = (time: number) => {
      video.currentTime = Math.max(0, Math.min(duration, time));
      void video.play().catch(() => {
        // The user can resume manually if autoplay is blocked.
      });
    };
    const followSelection = () => {
      const playbackTime = video.currentTime || 0;
      if (playbackTime < segment.startTime - 0.03) {
        jumpAndPlay(segment.startTime);
      } else if (playbackTime >= segment.endTime - 0.03) {
        const nextIndex = previewSegmentIndex + 1;
        if (nextIndex < segments.length) {
          setPreviewSegmentIndex(nextIndex);
          setActiveSegmentIndex(nextIndex);
          jumpAndPlay(segments[nextIndex].startTime);
          return;
        }
        video.pause();
        setIsPreviewingSelection(false);
        return;
      }
      animationFrame = window.requestAnimationFrame(followSelection);
    };
    followSelection();
    return () => window.cancelAnimationFrame(animationFrame);
  }, [duration, isPreviewingSelection, previewSegmentIndex, segments]);

  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.code === 'Space') {
        event.preventDefault();
        event.stopPropagation();
        if (event.repeat) return;
        setIsPreviewingSelection(false);
        const video = videoRef.current;
        if (!video) return;
        if (video.paused) {
          void video.play().catch(() => {
            // The user can try again if the browser blocks playback.
          });
        } else {
          video.pause();
        }
        return;
      }

      const target = event.target as HTMLElement | null;
      if (
        target instanceof HTMLInputElement ||
        target instanceof HTMLTextAreaElement ||
        target instanceof HTMLSelectElement ||
        target?.isContentEditable
      ) {
        return;
      }
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'z') {
        event.preventDefault();
        if (event.shiftKey) redo();
        else undo();
        return;
      }
      if (event.metaKey || event.ctrlKey) return;
      if (event.key === 'ArrowLeft') {
        event.preventDefault();
        if (event.altKey) stepFrame(-1);
        else seekBySeconds(event.shiftKey ? -5 : -1);
        return;
      }
      if (event.key === 'ArrowRight') {
        event.preventDefault();
        if (event.altKey) stepFrame(1);
        else seekBySeconds(event.shiftKey ? 5 : 1);
        return;
      }
      if (event.altKey || event.shiftKey) return;
      if (event.key === '[') setDraftStart(currentTime);
      if (event.key === ']') setDraftEnd(currentTime);
      if (event.key.toLowerCase() === 's') splitAtPlayhead();
      if (
        (event.key === 'Delete' || event.key === 'Backspace') &&
        activeSegmentIndex != null
      ) {
        event.preventDefault();
        removeSegment(activeSegmentIndex);
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  });

  const buildOverlayClip = async () => {
    const validationError = validate(segments);
    if (validationError) {
      setError(validationError);
      return;
    }
    setIsBuilding(true);
    setError(null);
    try {
      const response = await fetch('/api/prepare-ai-intro-overlay', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sceneId,
          segments,
        }),
      });
      if (!response.ok) {
        const result = (await response.json().catch(() => null)) as {
          error?: string;
        } | null;
        throw new Error(result?.error || 'Failed to build overlay clip.');
      }
      onUseVideo({
        segments: cloneSegments(segments),
        previewBlob: await response.blob(),
      });
    } catch (buildError) {
      setError(
        buildError instanceof Error
          ? buildError.message
          : 'Failed to build overlay clip.',
      );
    } finally {
      setIsBuilding(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div
      className='fixed inset-0 z-[90] flex items-center justify-center bg-black/75'
      onKeyDown={(event) => {
        if (event.code === 'Escape' && !isBuilding) {
          event.preventDefault();
          event.stopPropagation();
          onClose();
        }
      }}
      tabIndex={-1}
    >
      <div className='mx-4 max-h-[96vh] w-full max-w-7xl overflow-y-auto rounded-lg bg-white p-4'>
        <div className='mb-3 flex items-start justify-between'>
          <div>
            <h3 className='text-lg font-semibold'>Choose Video Sections</h3>
            <p className='text-sm text-gray-500'>
              Select original-video sections manually, or ask AI to suggest
              them from the selected transcript words.
            </p>
          </div>
          <button
            onClick={onClose}
            disabled={isBuilding}
            className='rounded p-1 disabled:opacity-40'
          >
            <X className='h-5 w-5' />
          </button>
        </div>

        <div className='space-y-3'>
          <div className='relative flex w-full justify-center'>
            <video
              ref={videoRef}
              src={sourceVideoUrl}
              controls
              preload='metadata'
              className='rounded bg-black'
              style={{ maxWidth: '100%', maxHeight: '42vh' }}
              onLoadedMetadata={(event) => {
                const nextDuration = event.currentTarget.duration;
                if (Number.isFinite(nextDuration) && nextDuration > 0) {
                  setDuration(nextDuration);
                  setDraftEnd((current) =>
                    current > 0 ? Math.min(current, nextDuration) : nextDuration,
                  );
                }
                seekTo(0);
              }}
              onTimeUpdate={(event) =>
                setCurrentTime(event.currentTarget.currentTime || 0)
              }
            />
          </div>

          <div className='space-y-3 rounded-lg border bg-gray-50 p-3'>
            <div className='flex flex-wrap items-center justify-between gap-2'>
              <div className='flex flex-wrap gap-2'>
                <button
                  onClick={() => stepFrame(-1)}
                  className='rounded border px-2 py-1'
                >
                  −1 frame
                </button>
                <button
                  onClick={() => stepFrame(1)}
                  className='rounded border px-2 py-1'
                >
                  +1 frame
                </button>
                <button
                  onClick={
                    isPreviewingSelection
                      ? () => {
                          videoRef.current?.pause();
                          setIsPreviewingSelection(false);
                        }
                      : startSelectedPreview
                  }
                  disabled={segments.length === 0}
                  className='inline-flex items-center gap-1 rounded bg-indigo-600 px-3 py-1 text-white disabled:opacity-50'
                >
                  {isPreviewingSelection ? (
                    <Pause className='h-4 w-4' />
                  ) : (
                    <Play className='h-4 w-4' />
                  )}
                  {isPreviewingSelection
                    ? 'Stop Selected Preview'
                    : 'Preview Selected Sections'}
                </button>
                <button
                  type='button'
                  onClick={() => void requestAiSuggestions()}
                  disabled={isSuggesting || isBuilding}
                  className='inline-flex items-center gap-1 rounded bg-violet-600 px-3 py-1 text-white hover:bg-violet-700 disabled:opacity-50'
                  title={`Suggest original-video clips for the ${targetStartTime.toFixed(2)}–${targetEndTime.toFixed(2)}s transcript range`}
                >
                  {isSuggesting ? (
                    <Loader2 className='h-4 w-4 animate-spin' />
                  ) : (
                    <Sparkles className='h-4 w-4' />
                  )}
                  {isSuggesting
                    ? 'Suggesting Clips…'
                    : 'AI Clip for Selected Words'}
                </button>
                <span className='self-center text-xs text-gray-500'>
                  Arrow: 1s · Shift+Arrow: 5s · Option/Alt+Arrow: 1 frame
                </span>
              </div>
              <label className='flex items-center gap-2 text-sm'>
                Timeline zoom
                <input
                  type='range'
                  min={1}
                  max={8}
                  step={0.25}
                  value={timelineZoom}
                  onChange={(event) =>
                    setTimelineZoom(Number(event.currentTarget.value))
                  }
                />
                {timelineZoom.toFixed(2)}×
              </label>
            </div>

            <div className='overflow-x-auto rounded bg-gray-900'>
              <div
                ref={timelineRef}
                className='relative h-24 cursor-crosshair select-none'
                style={{ width: `${timelineZoom * 100}%`, minWidth: '100%' }}
                onPointerDown={(event) => {
                  if (!(duration > 0) || event.target !== event.currentTarget) {
                    return;
                  }
                  const rect = event.currentTarget.getBoundingClientRect();
                  seekTo(((event.clientX - rect.left) / rect.width) * duration);
                  setActiveSegmentIndex(null);
                }}
              >
                <div className='pointer-events-none absolute inset-0 flex opacity-45'>
                  {thumbnails.map((thumbnail) => (
                    // Frames are generated locally from the same-origin AI route.
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      key={thumbnail.time}
                      src={thumbnail.dataUrl}
                      alt=''
                      className='h-full min-w-0 flex-1 object-cover'
                    />
                  ))}
                </div>
                {segments.map((segment, index) => {
                  const active = activeSegmentIndex === index;
                  const playing =
                    isPreviewingSelection && previewSegmentIndex === index;
                  return (
                    <div
                      key={`timeline-${index}`}
                      className={`absolute bottom-2 top-2 cursor-grab border-2 ${
                        playing
                          ? 'border-green-300 bg-green-500/65'
                          : active
                            ? 'border-white bg-blue-400/70'
                            : 'border-blue-300 bg-blue-600/65'
                      }`}
                      style={{
                        left: `${(segment.startTime / Math.max(duration, 0.001)) * 100}%`,
                        width: `${((segment.endTime - segment.startTime) / Math.max(duration, 0.001)) * 100}%`,
                      }}
                      title='Drag to move. Double-click to move the playhead to this section.'
                      onPointerDown={(event) =>
                        startSegmentDrag(event, index, 'move')
                      }
                      onDoubleClick={(event) => {
                        if (
                          (event.target as HTMLElement).closest(
                            '[data-segment-resize-handle]',
                          )
                        ) {
                          return;
                        }
                        event.preventDefault();
                        event.stopPropagation();
                        videoRef.current?.pause();
                        setIsPreviewingSelection(false);
                        setActiveSegmentIndex(index);
                        seekTo(segment.startTime);
                      }}
                    >
                      <div
                        data-segment-resize-handle
                        className='absolute inset-y-0 left-0 w-3 cursor-ew-resize bg-white/80'
                        onPointerDown={(event) =>
                          startSegmentDrag(event, index, 'start')
                        }
                      />
                      <div className='pointer-events-none absolute inset-0 flex items-center justify-center text-xs font-semibold text-white'>
                        #{index + 1}
                      </div>
                      <div
                        data-segment-resize-handle
                        className='absolute inset-y-0 right-0 w-3 cursor-ew-resize bg-white/80'
                        onPointerDown={(event) =>
                          startSegmentDrag(event, index, 'end')
                        }
                      />
                    </div>
                  );
                })}
                <div
                  className='pointer-events-none absolute inset-y-0 z-20 w-0.5 bg-red-500'
                  style={{
                    left: `${(currentTime / Math.max(duration, 0.001)) * 100}%`,
                  }}
                />
              </div>
            </div>

            <div className='grid grid-cols-1 gap-3 md:grid-cols-2'>
              <label className='text-sm'>
                New Start: {draftStart.toFixed(2)}s
                <input
                  type='range'
                  min={0}
                  max={duration}
                  step={0.01}
                  value={Math.min(draftStart, duration)}
                  onChange={(event) =>
                    setDraftStart(Number(event.currentTarget.value))
                  }
                  className='w-full'
                />
              </label>
              <label className='text-sm'>
                New End: {draftEnd.toFixed(2)}s
                <input
                  type='range'
                  min={0}
                  max={duration}
                  step={0.01}
                  value={Math.min(draftEnd, duration)}
                  onChange={(event) =>
                    setDraftEnd(Number(event.currentTarget.value))
                  }
                  className='w-full'
                />
              </label>
            </div>

            <div className='flex flex-wrap gap-2'>
              <button
                onClick={() => setDraftStart(currentTime)}
                className='rounded bg-green-600 px-3 py-1 text-white'
              >
                Set Start [
              </button>
              <button
                onClick={() => setDraftEnd(currentTime)}
                className='rounded bg-red-600 px-3 py-1 text-white'
              >
                Set End ]
              </button>
              <button
                onClick={addDraft}
                className='inline-flex items-center gap-1 rounded bg-blue-600 px-3 py-1 text-white'
              >
                <Plus className='h-4 w-4' /> Add Section
              </button>
              <button
                onClick={splitAtPlayhead}
                className='inline-flex items-center gap-1 rounded border px-3 py-1'
              >
                <Scissors className='h-4 w-4' /> Split (S)
              </button>
              <button
                onClick={() =>
                  commitSegments([{ startTime: 0, endTime: duration }])
                }
                className='rounded border px-3 py-1'
              >
                Select All
              </button>
              <button
                onClick={() => commitSegments([])}
                className='rounded border px-3 py-1'
              >
                Clear All
              </button>
              <button
                onClick={invertSelection}
                className='rounded border px-3 py-1'
              >
                Invert
              </button>
              <button
                onClick={undo}
                disabled={undoStack.length === 0}
                className='rounded border p-2 disabled:opacity-40'
              >
                <Undo2 className='h-4 w-4' />
              </button>
              <button
                onClick={redo}
                disabled={redoStack.length === 0}
                className='rounded border p-2 disabled:opacity-40'
              >
                <Redo2 className='h-4 w-4' />
              </button>
            </div>
          </div>

          <div className='max-h-48 space-y-2 overflow-y-auto'>
            {segments.map((segment, index) => {
              const suggestion = findSuggestionForSegment(segment);
              return (
                <div
                  key={`row-${index}`}
                  className={`rounded border p-2 ${
                    activeSegmentIndex === index
                      ? 'border-blue-500 bg-blue-50'
                      : ''
                  }`}
                  onClick={() => setActiveSegmentIndex(index)}
                >
                  <div className='grid grid-cols-[auto_1fr_1fr_repeat(5,auto)] items-end gap-2'>
                    <span className='pb-1 text-sm font-medium'>#{index + 1}</span>
                    <label className='text-xs'>
                      Start
                      <input
                        type='number'
                        min={0}
                        max={duration}
                        step={0.01}
                        value={segment.startTime}
                        onChange={(event) =>
                          updateSegment(
                            index,
                            'startTime',
                            Number(event.currentTarget.value),
                          )
                        }
                        className='block w-full rounded border px-2 py-1 text-sm'
                      />
                    </label>
                    <label className='text-xs'>
                      End
                      <input
                        type='number'
                        min={0}
                        max={duration}
                        step={0.01}
                        value={segment.endTime}
                        onChange={(event) =>
                          updateSegment(
                            index,
                            'endTime',
                            Number(event.currentTarget.value),
                          )
                        }
                        className='block w-full rounded border px-2 py-1 text-sm'
                      />
                    </label>
                    <button
                      onClick={() => seekTo(segment.startTime, true)}
                      className='rounded border p-2'
                      title='Preview'
                    >
                      <Play className='h-4 w-4' />
                    </button>
                    <button
                      onClick={() => duplicateSegment(index)}
                      className='rounded border p-2'
                      title='Duplicate'
                    >
                      <Copy className='h-4 w-4' />
                    </button>
                    <button
                      onClick={() => moveSegment(index, -1)}
                      disabled={index === 0}
                      className='rounded border p-2 disabled:opacity-30'
                      title='Move earlier'
                    >
                      <ArrowUp className='h-4 w-4' />
                    </button>
                    <button
                      onClick={() => moveSegment(index, 1)}
                      disabled={index === segments.length - 1}
                      className='rounded border p-2 disabled:opacity-30'
                      title='Move later'
                    >
                      <ArrowDown className='h-4 w-4' />
                    </button>
                    <button
                      onClick={() => removeSegment(index)}
                      className='rounded border border-red-300 p-2 text-red-600'
                      title='Delete'
                    >
                      <Trash2 className='h-4 w-4' />
                    </button>
                  </div>
                  {suggestion ? (
                    <div className='mt-2 text-xs text-violet-700'>
                      “{suggestion.transcript}” · {suggestion.reason}
                    </div>
                  ) : null}
                </div>
              );
            })}
          </div>

          <div className='flex flex-wrap items-center justify-between gap-3'>
            <div className='text-sm'>
              {segments.length} section{segments.length === 1 ? '' : 's'} ·{' '}
              {selectedDuration.toFixed(2)}s combined
              <div className='text-xs text-gray-500'>
                Overlay target {targetStartTime.toFixed(2)}–
                {targetEndTime.toFixed(2)}s ({targetDuration.toFixed(2)}s)
                {targetDuration > 0 && selectedDuration > 0
                  ? ` · ${(selectedDuration / targetDuration).toFixed(2)}× automatic speed`
                  : ''}
              </div>
              <div className='text-xs text-gray-500'>
                Shortcuts: Space Play/Pause · [ Start · ] End · S Split ·
                ←/→ 1s · Shift+←/→ 5s · Option/Alt+←/→ frame · Delete ·
                Cmd/Ctrl+Z
              </div>
              {error ? <div className='mt-1 text-red-600'>{error}</div> : null}
            </div>
            <div className='flex gap-2'>
              <button
                onClick={onClose}
                disabled={isBuilding}
                className='rounded border px-4 py-2'
              >
                Cancel
              </button>
              <button
                onClick={() => void buildOverlayClip()}
                disabled={isBuilding || segments.length === 0}
                className='inline-flex items-center gap-2 rounded bg-blue-600 px-4 py-2 text-white disabled:opacity-50'
              >
                {isBuilding ? (
                  <Loader2 className='h-4 w-4 animate-spin' />
                ) : null}
                {isBuilding ? 'Building…' : 'Build Overlay Clip'}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
