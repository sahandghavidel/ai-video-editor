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
  Trash2,
  Undo2,
  X,
} from 'lucide-react';
import type { VideoSourceSegment } from './image-overlay-modal/types';

interface VideoEditModalProps {
  isOpen: boolean;
  onClose: () => void;
  videoFile: File | null;
  videoUrl: string | null;
  onUseVideo: (selection: {
    segments: VideoSourceSegment[];
    previewBlob: Blob;
  }) => void;
}

type DragMode = 'start' | 'end' | 'move';
type Thumbnail = { time: number; dataUrl: string };

const MIN_SEGMENT_SECONDS = 0.05;
const FRAME_SECONDS = 1 / 30;

export function VideoEditModal({
  isOpen,
  onClose,
  videoFile,
  videoUrl,
  onUseVideo,
}: VideoEditModalProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const timelineRef = useRef<HTMLDivElement>(null);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [draftStart, setDraftStart] = useState(0);
  const [draftEnd, setDraftEnd] = useState(0);
  const [segments, setSegments] = useState<VideoSourceSegment[]>([]);
  const [activeSegmentIndex, setActiveSegmentIndex] = useState<number | null>(
    null,
  );
  const [undoStack, setUndoStack] = useState<VideoSourceSegment[][]>([]);
  const [redoStack, setRedoStack] = useState<VideoSourceSegment[][]>([]);
  const [thumbnails, setThumbnails] = useState<Thumbnail[]>([]);
  const [timelineZoom, setTimelineZoom] = useState(1);
  const [isPreviewingSelection, setIsPreviewingSelection] = useState(false);
  const [previewSegmentIndex, setPreviewSegmentIndex] = useState(0);
  const [isBuilding, setIsBuilding] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const cloneSegments = (items: VideoSourceSegment[]) =>
    items.map((segment) => ({ ...segment }));

  const commitSegments = (next: VideoSourceSegment[]) => {
    setUndoStack((history) => [...history.slice(-49), cloneSegments(segments)]);
    setRedoStack([]);
    setSegments(next);
    setErrorMessage(null);
  };

  useEffect(() => {
    if (!videoUrl || !videoRef.current) return;
    const video = videoRef.current;
    video.src = videoUrl;

    const updateTime = () => setCurrentTime(video.currentTime || 0);
    const updateDuration = () => {
      if (!Number.isFinite(video.duration) || video.duration === Infinity) return;
      setDuration(video.duration);
      setDraftStart(0);
      setDraftEnd(video.duration);
      setSegments([]);
      setUndoStack([]);
      setRedoStack([]);
      setActiveSegmentIndex(null);
      setErrorMessage(null);
    };

    video.addEventListener('timeupdate', updateTime);
    video.addEventListener('loadedmetadata', updateDuration);
    return () => {
      video.removeEventListener('timeupdate', updateTime);
      video.removeEventListener('loadedmetadata', updateDuration);
    };
  }, [videoUrl]);

  useEffect(() => {
    if (!isOpen || !videoUrl || !(duration > 0)) return;
    let cancelled = false;
    const thumbnailVideo = document.createElement('video');
    thumbnailVideo.muted = true;
    thumbnailVideo.preload = 'auto';
    thumbnailVideo.src = videoUrl;

    const waitForEvent = (eventName: 'loadeddata' | 'seeked') =>
      new Promise<void>((resolve, reject) => {
        const handleSuccess = () => {
          cleanup();
          resolve();
        };
        const handleError = () => {
          cleanup();
          reject(new Error('Unable to read video frames'));
        };
        const cleanup = () => {
          thumbnailVideo.removeEventListener(eventName, handleSuccess);
          thumbnailVideo.removeEventListener('error', handleError);
        };
        thumbnailVideo.addEventListener(eventName, handleSuccess, { once: true });
        thumbnailVideo.addEventListener('error', handleError, { once: true });
      });

    void (async () => {
      try {
        await waitForEvent('loadeddata');
        const count = 12;
        const canvas = document.createElement('canvas');
        canvas.width = 160;
        canvas.height = 90;
        const context = canvas.getContext('2d');
        if (!context) return;
        const next: Thumbnail[] = [];
        for (let index = 0; index < count; index += 1) {
          const time = Math.min(
            Math.max(0, duration - 0.02),
            (duration * index) / Math.max(1, count - 1),
          );
          thumbnailVideo.currentTime = time;
          await waitForEvent('seeked');
          if (cancelled) return;
          context.drawImage(thumbnailVideo, 0, 0, canvas.width, canvas.height);
          next.push({ time, dataUrl: canvas.toDataURL('image/jpeg', 0.65) });
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
  }, [duration, isOpen, videoUrl]);

  const selectedDuration = useMemo(
    () => segments.reduce((total, segment) => total + segment.endTime - segment.startTime, 0),
    [segments],
  );

  const clampTime = (time: number) => Math.max(0, Math.min(duration, time));

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

  const validateSegments = (items: VideoSourceSegment[]) => {
    if (items.length === 0) return 'Add at least one section.';
    for (let index = 0; index < items.length; index += 1) {
      if (items[index].endTime - items[index].startTime < MIN_SEGMENT_SECONDS) {
        return `Section ${index + 1} must have an End after its Start.`;
      }
    }
    return null;
  };

  const seekTo = (time: number, play = false) => {
    const video = videoRef.current;
    if (!video) return;
    video.currentTime = clampTime(time);
    if (play) {
      void video.play().catch(() => {
        // The user can press play manually if autoplay is blocked.
      });
    }
  };

  const stepFrame = (direction: -1 | 1) => {
    videoRef.current?.pause();
    setIsPreviewingSelection(false);
    seekTo(currentTime + direction * FRAME_SECONDS);
  };

  const addDraftSection = () => {
    const nextSegment = {
      startTime: clampTime(draftStart),
      endTime: clampTime(draftEnd),
    };
    const error = validateSegments([nextSegment]);
    if (error) {
      setErrorMessage(error);
      return;
    }
    commitSegments([...segments, nextSegment]);
    setActiveSegmentIndex(segments.length);
  };

  const updateSegment = (
    index: number,
    key: keyof VideoSourceSegment,
    value: number,
  ) => {
    const next = cloneSegments(segments);
    next[index] = { ...next[index], [key]: clampTime(value) };
    commitSegments(next);
  };

  const removeSegment = (index: number) => {
    commitSegments(segments.filter((_, segmentIndex) => segmentIndex !== index));
    setActiveSegmentIndex(null);
  };

  const moveSegment = (index: number, direction: -1 | 1) => {
    const target = index + direction;
    if (target < 0 || target >= segments.length) return;
    const next = cloneSegments(segments);
    [next[index], next[target]] = [next[target], next[index]];
    commitSegments(next);
    setActiveSegmentIndex(target);
  };

  const duplicateSegment = (index: number) => {
    const next = cloneSegments(segments);
    next.splice(index + 1, 0, { ...segments[index] });
    commitSegments(next);
    setActiveSegmentIndex(index + 1);
  };

  const splitAtPlayhead = () => {
    const index = segments.findIndex(
      (segment) =>
        currentTime > segment.startTime + MIN_SEGMENT_SECONDS &&
        currentTime < segment.endTime - MIN_SEGMENT_SECONDS,
    );
    if (index < 0) {
      setErrorMessage('Move the playhead inside a section before splitting.');
      return;
    }
    const next = cloneSegments(segments);
    const segment = next[index];
    next.splice(
      index,
      1,
      { startTime: segment.startTime, endTime: currentTime },
      { startTime: currentTime, endTime: segment.endTime },
    );
    commitSegments(next);
    setActiveSegmentIndex(index + 1);
  };

  const invertSelection = () => {
    const ordered = cloneSegments(segments).sort(
      (a, b) => a.startTime - b.startTime,
    );
    const merged: VideoSourceSegment[] = [];
    ordered.forEach((segment) => {
      const previous = merged[merged.length - 1];
      if (previous && segment.startTime <= previous.endTime) {
        previous.endTime = Math.max(previous.endTime, segment.endTime);
      } else {
        merged.push({ ...segment });
      }
    });
    const gaps: VideoSourceSegment[] = [];
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

  const startSegmentDrag = (
    event: React.PointerEvent,
    index: number,
    mode: DragMode,
  ) => {
    event.preventDefault();
    event.stopPropagation();
    setActiveSegmentIndex(index);
    const timeline = timelineRef.current;
    if (!timeline) return;
    const startX = event.clientX;
    const initial = cloneSegments(segments);
    const original = { ...segments[index] };

    const handleMove = (moveEvent: PointerEvent) => {
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
        const segmentDuration = original.endTime - original.startTime;
        const nextStart = Math.max(
          0,
          Math.min(duration - segmentDuration, original.startTime + deltaSeconds),
        );
        const snappedStart = Math.max(
          0,
          Math.min(duration - segmentDuration, snapTime(nextStart, index)),
        );
        next[index] = {
          startTime: snappedStart,
          endTime: Math.min(duration, snappedStart + segmentDuration),
        };
      }
      setSegments(next);
    };
    const handleUp = () => {
      setUndoStack((history) => [...history.slice(-49), initial]);
      setRedoStack([]);
      document.removeEventListener('pointermove', handleMove);
      document.removeEventListener('pointerup', handleUp);
    };
    document.addEventListener('pointermove', handleMove);
    document.addEventListener('pointerup', handleUp);
  };

  const startSelectedPreview = () => {
    if (segments.length === 0) {
      setErrorMessage('Add at least one section to preview.');
      return;
    }
    setPreviewSegmentIndex(0);
    setActiveSegmentIndex(0);
    setIsPreviewingSelection(true);
    seekTo(segments[0].startTime, true);
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
      const target = event.target as HTMLElement | null;
      if (
        target instanceof HTMLInputElement ||
        target instanceof HTMLTextAreaElement ||
        target instanceof HTMLSelectElement
      ) {
        return;
      }
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'z') {
        event.preventDefault();
        if (event.shiftKey) redo();
        else undo();
        return;
      }
      if (event.key === '[') setDraftStart(currentTime);
      if (event.key === ']') setDraftEnd(currentTime);
      if (event.key.toLowerCase() === 's') splitAtPlayhead();
      if (event.key === 'ArrowLeft') {
        event.preventDefault();
        stepFrame(-1);
      }
      if (event.key === 'ArrowRight') {
        event.preventDefault();
        stepFrame(1);
      }
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
    if (!videoFile) return;
    const selectedSegments =
      segments.length > 0
        ? cloneSegments(segments)
        : [{ startTime: clampTime(draftStart), endTime: clampTime(draftEnd) }];
    const validationError = validateSegments(selectedSegments);
    if (validationError) {
      setErrorMessage(validationError);
      return;
    }

    setIsBuilding(true);
    setErrorMessage(null);
    try {
      const formData = new FormData();
      formData.append('video', videoFile);
      formData.append('segments', JSON.stringify(selectedSegments));
      const response = await fetch('/api/prepare-video-overlay', {
        method: 'POST',
        body: formData,
      });
      if (!response.ok) {
        const data = (await response.json().catch(() => null)) as
          | { error?: string }
          | null;
        throw new Error(data?.error || 'Failed to build overlay clip.');
      }
      onUseVideo({ segments: selectedSegments, previewBlob: await response.blob() });
    } catch (error) {
      setErrorMessage(
        error instanceof Error ? error.message : 'Failed to build overlay clip.',
      );
    } finally {
      setIsBuilding(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div
      className='fixed inset-0 bg-black/75 flex items-center justify-center z-[70]'
      onKeyDown={(event) => {
        if (event.code === 'Escape' && !isBuilding) {
          event.preventDefault();
          event.stopPropagation();
          onClose();
        }
      }}
      tabIndex={-1}
    >
      <div className='bg-white rounded-lg p-4 max-w-7xl max-h-[96vh] w-full mx-4 overflow-y-auto'>
        <div className='flex justify-between items-start mb-3'>
          <div>
            <h3 className='text-lg font-semibold'>Choose Video Sections</h3>
            <p className='text-sm text-gray-500'>
              Drag blue sections and their handles. Excluded gaps are skipped.
            </p>
          </div>
          <button onClick={onClose} disabled={isBuilding} className='p-1 rounded'>
            <X className='h-5 w-5' />
          </button>
        </div>

        <div className='space-y-3'>
          <div className='relative w-full flex justify-center'>
            <video
              ref={videoRef}
              className='bg-black rounded'
              controls
              style={{ maxWidth: '100%', maxHeight: '42vh' }}
            />
          </div>

          <div className='rounded-lg border bg-gray-50 p-3 space-y-3'>
            <div className='flex flex-wrap items-center justify-between gap-2'>
              <div className='flex flex-wrap gap-2'>
                <button onClick={() => stepFrame(-1)} className='px-2 py-1 border rounded'>
                  −1 frame
                </button>
                <button onClick={() => stepFrame(1)} className='px-2 py-1 border rounded'>
                  +1 frame
                </button>
                <button
                  onClick={isPreviewingSelection ? () => {
                    videoRef.current?.pause();
                    setIsPreviewingSelection(false);
                  } : startSelectedPreview}
                  className='inline-flex items-center gap-1 px-3 py-1 bg-indigo-600 text-white rounded'
                >
                  {isPreviewingSelection ? <Pause className='h-4 w-4' /> : <Play className='h-4 w-4' />}
                  {isPreviewingSelection ? 'Stop Selected Preview' : 'Preview Selected Sections'}
                </button>
              </div>
              <label className='flex items-center gap-2 text-sm'>
                Timeline zoom
                <input
                  type='range'
                  min={1}
                  max={8}
                  step={0.25}
                  value={timelineZoom}
                  onChange={(event) => setTimelineZoom(Number(event.target.value))}
                />
                {timelineZoom.toFixed(2)}×
              </label>
            </div>

            <div className='overflow-x-auto rounded bg-gray-900'>
              <div
                ref={timelineRef}
                className='relative h-24 select-none cursor-crosshair'
                style={{ width: `${timelineZoom * 100}%`, minWidth: '100%' }}
                onPointerDown={(event) => {
                  if (!(duration > 0) || event.target !== event.currentTarget) return;
                  const rect = event.currentTarget.getBoundingClientRect();
                  seekTo(((event.clientX - rect.left) / rect.width) * duration);
                  setActiveSegmentIndex(null);
                }}
              >
                <div className='absolute inset-0 flex opacity-45 pointer-events-none'>
                  {thumbnails.map((thumbnail) => (
                    // Data-URL frames are generated locally from the uploaded video.
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      key={thumbnail.time}
                      src={thumbnail.dataUrl}
                      alt=''
                      className='h-full object-cover flex-1 min-w-0'
                    />
                  ))}
                </div>
                {segments.map((segment, index) => {
                  const active = activeSegmentIndex === index;
                  const playing = isPreviewingSelection && previewSegmentIndex === index;
                  return (
                    <div
                      key={`timeline-${index}`}
                      className={`absolute top-2 bottom-2 border-2 cursor-grab ${
                        playing
                          ? 'bg-green-500/65 border-green-300'
                          : active
                            ? 'bg-blue-400/70 border-white'
                            : 'bg-blue-600/65 border-blue-300'
                      }`}
                      style={{
                        left: `${(segment.startTime / Math.max(duration, 0.001)) * 100}%`,
                        width: `${((segment.endTime - segment.startTime) / Math.max(duration, 0.001)) * 100}%`,
                      }}
                      onPointerDown={(event) => startSegmentDrag(event, index, 'move')}
                    >
                      <div
                        className='absolute inset-y-0 left-0 w-3 bg-white/80 cursor-ew-resize'
                        onPointerDown={(event) => startSegmentDrag(event, index, 'start')}
                      />
                      <div className='absolute inset-0 flex items-center justify-center text-white text-xs font-semibold pointer-events-none'>
                        #{index + 1}
                      </div>
                      <div
                        className='absolute inset-y-0 right-0 w-3 bg-white/80 cursor-ew-resize'
                        onPointerDown={(event) => startSegmentDrag(event, index, 'end')}
                      />
                    </div>
                  );
                })}
                <div
                  className='absolute inset-y-0 w-0.5 bg-red-500 z-20 pointer-events-none'
                  style={{ left: `${(currentTime / Math.max(duration, 0.001)) * 100}%` }}
                />
              </div>
            </div>

            <div className='grid grid-cols-1 md:grid-cols-2 gap-3'>
              <label className='text-sm'>
                New Start: {draftStart.toFixed(2)}s
                <input type='range' min={0} max={duration} step={0.01} value={Math.min(draftStart, duration)} onChange={(event) => setDraftStart(Number(event.target.value))} className='w-full' />
              </label>
              <label className='text-sm'>
                New End: {draftEnd.toFixed(2)}s
                <input type='range' min={0} max={duration} step={0.01} value={Math.min(draftEnd, duration)} onChange={(event) => setDraftEnd(Number(event.target.value))} className='w-full' />
              </label>
            </div>

            <div className='flex flex-wrap gap-2'>
              <button onClick={() => setDraftStart(currentTime)} className='px-3 py-1 bg-green-600 text-white rounded'>Set Start [</button>
              <button onClick={() => setDraftEnd(currentTime)} className='px-3 py-1 bg-red-600 text-white rounded'>Set End ]</button>
              <button onClick={addDraftSection} className='inline-flex items-center gap-1 px-3 py-1 bg-blue-600 text-white rounded'><Plus className='h-4 w-4' /> Add Section</button>
              <button onClick={splitAtPlayhead} className='inline-flex items-center gap-1 px-3 py-1 border rounded'><Scissors className='h-4 w-4' /> Split (S)</button>
              <button onClick={() => commitSegments([{ startTime: 0, endTime: duration }])} className='px-3 py-1 border rounded'>Select All</button>
              <button onClick={() => commitSegments([])} className='px-3 py-1 border rounded'>Clear All</button>
              <button onClick={invertSelection} className='px-3 py-1 border rounded'>Invert</button>
              <button onClick={undo} disabled={undoStack.length === 0} className='p-2 border rounded disabled:opacity-40'><Undo2 className='h-4 w-4' /></button>
              <button onClick={redo} disabled={redoStack.length === 0} className='p-2 border rounded disabled:opacity-40'><Redo2 className='h-4 w-4' /></button>
            </div>
          </div>

          <div className='space-y-2 max-h-44 overflow-y-auto'>
            {segments.map((segment, index) => (
              <div key={`row-${index}`} className={`grid grid-cols-[auto_1fr_1fr_repeat(5,auto)] gap-2 items-end rounded border p-2 ${activeSegmentIndex === index ? 'border-blue-500 bg-blue-50' : ''}`} onClick={() => setActiveSegmentIndex(index)}>
                <span className='text-sm font-medium pb-1'>#{index + 1}</span>
                <label className='text-xs'>Start<input type='number' min={0} max={duration} step={0.01} value={segment.startTime} onChange={(event) => updateSegment(index, 'startTime', Number(event.target.value))} className='block w-full border rounded px-2 py-1 text-sm' /></label>
                <label className='text-xs'>End<input type='number' min={0} max={duration} step={0.01} value={segment.endTime} onChange={(event) => updateSegment(index, 'endTime', Number(event.target.value))} className='block w-full border rounded px-2 py-1 text-sm' /></label>
                <button onClick={() => seekTo(segment.startTime, true)} className='p-2 border rounded' title='Preview'><Play className='h-4 w-4' /></button>
                <button onClick={() => duplicateSegment(index)} className='p-2 border rounded' title='Duplicate'><Copy className='h-4 w-4' /></button>
                <button onClick={() => moveSegment(index, -1)} disabled={index === 0} className='p-2 border rounded disabled:opacity-30' title='Move earlier'><ArrowUp className='h-4 w-4' /></button>
                <button onClick={() => moveSegment(index, 1)} disabled={index === segments.length - 1} className='p-2 border rounded disabled:opacity-30' title='Move later'><ArrowDown className='h-4 w-4' /></button>
                <button onClick={() => removeSegment(index)} className='p-2 border border-red-300 text-red-600 rounded' title='Delete'><Trash2 className='h-4 w-4' /></button>
              </div>
            ))}
          </div>

          <div className='flex flex-wrap items-center justify-between gap-3'>
            <div className='text-sm'>
              {segments.length} section{segments.length === 1 ? '' : 's'} · {selectedDuration.toFixed(2)}s combined
              <div className='text-xs text-gray-500'>Shortcuts: [ Start · ] End · S Split · ←/→ frame · Delete · Cmd/Ctrl+Z</div>
              {errorMessage ? <div className='text-red-600 mt-1'>{errorMessage}</div> : null}
            </div>
            <div className='flex gap-2'>
              <button onClick={onClose} disabled={isBuilding} className='px-4 py-2 border rounded'>Cancel</button>
              <button onClick={buildOverlayClip} disabled={!videoFile || isBuilding || !(duration > 0)} className='inline-flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded disabled:opacity-50'>
                {isBuilding ? <Loader2 className='h-4 w-4 animate-spin' /> : null}
                {isBuilding ? 'Building…' : 'Build Overlay Clip'}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
