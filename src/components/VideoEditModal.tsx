'use client';

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Loader2, Play, Plus, Scissors, Trash2, X } from 'lucide-react';
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

const MIN_SEGMENT_SECONDS = 0.05;

export function VideoEditModal({
  isOpen,
  onClose,
  videoFile,
  videoUrl,
  onUseVideo,
}: VideoEditModalProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [draftStart, setDraftStart] = useState(0);
  const [draftEnd, setDraftEnd] = useState(0);
  const [segments, setSegments] = useState<VideoSourceSegment[]>([]);
  const [isBuilding, setIsBuilding] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [videoDimensions, setVideoDimensions] = useState({ width: 0, height: 0 });

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
      setErrorMessage(null);
      if (video.videoWidth && video.videoHeight) {
        setVideoDimensions({ width: video.videoWidth, height: video.videoHeight });
      }
    };
    const focusVideo = () => video.focus();

    video.addEventListener('timeupdate', updateTime);
    video.addEventListener('loadedmetadata', updateDuration);
    video.addEventListener('loadeddata', focusVideo);
    return () => {
      video.removeEventListener('timeupdate', updateTime);
      video.removeEventListener('loadedmetadata', updateDuration);
      video.removeEventListener('loadeddata', focusVideo);
    };
  }, [videoUrl]);

  const selectedDuration = useMemo(
    () => segments.reduce((total, segment) => total + segment.endTime - segment.startTime, 0),
    [segments],
  );

  const normalizeSegments = (items: VideoSourceSegment[]) =>
    items
      .map((segment) => ({
        startTime: Math.max(0, Math.min(duration, segment.startTime)),
        endTime: Math.max(0, Math.min(duration, segment.endTime)),
      }))
      .sort((a, b) => a.startTime - b.startTime);

  const validateSegments = (items: VideoSourceSegment[]) => {
    if (items.length === 0) return 'Add at least one section.';
    for (let index = 0; index < items.length; index += 1) {
      const segment = items[index];
      if (segment.endTime - segment.startTime < MIN_SEGMENT_SECONDS) {
        return `Section ${index + 1} must have an End after its Start.`;
      }
      if (index > 0 && segment.startTime < items[index - 1].endTime) {
        return `Section ${index + 1} overlaps the previous section.`;
      }
    }
    return null;
  };

  const addDraftSection = () => {
    const next = normalizeSegments([
      ...segments,
      { startTime: draftStart, endTime: draftEnd },
    ]);
    const error = validateSegments(next);
    if (error) {
      setErrorMessage(error);
      return;
    }
    setSegments(next);
    setErrorMessage(null);
  };

  const updateSegment = (
    index: number,
    key: keyof VideoSourceSegment,
    value: number,
  ) => {
    setSegments((current) =>
      current.map((segment, segmentIndex) =>
        segmentIndex === index ? { ...segment, [key]: value } : segment,
      ),
    );
    setErrorMessage(null);
  };

  const seekTo = (time: number) => {
    const video = videoRef.current;
    if (!video) return;
    video.currentTime = Math.max(0, Math.min(duration, time));
    void video.play().catch(() => {
      // The user can press play manually if autoplay is blocked.
    });
  };

  const buildOverlayClip = async () => {
    if (!videoFile) return;
    const selectedSegments = normalizeSegments(
      segments.length > 0
        ? segments
        : [{ startTime: draftStart, endTime: draftEnd }],
    );
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
      const previewBlob = await response.blob();
      onUseVideo({ segments: selectedSegments, previewBlob });
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
      <div className='bg-white rounded-lg p-4 max-w-6xl max-h-[95vh] w-full mx-4 overflow-y-auto'>
        <div className='flex justify-between items-center mb-4'>
          <div>
            <h3 className='text-lg font-semibold'>Choose Video Sections</h3>
            <p className='text-sm text-gray-500'>
              Add every part you want to keep. Gaps will be removed.
            </p>
          </div>
          <button
            onClick={onClose}
            disabled={isBuilding}
            className='p-1 hover:bg-gray-100 rounded disabled:opacity-50'
          >
            <X className='h-5 w-5' />
          </button>
        </div>

        <div className='space-y-4'>
          <div className='relative w-full flex justify-center'>
            <video
              ref={videoRef}
              className='bg-black rounded'
              controls
              style={{
                width:
                  videoDimensions.width > 0
                    ? Math.min(videoDimensions.width, 1100)
                    : '90%',
                height: 'auto',
                maxWidth: '100%',
                maxHeight: '48vh',
              }}
            />
          </div>

          <div className='rounded-lg border border-gray-200 bg-gray-50 p-3 space-y-3'>
            <div
              className='relative h-12 rounded bg-gray-200 overflow-hidden cursor-pointer'
              onClick={(event) => {
                if (!(duration > 0)) return;
                const rect = event.currentTarget.getBoundingClientRect();
                seekTo(((event.clientX - rect.left) / rect.width) * duration);
              }}
            >
              {segments.map((segment, index) => (
                <div
                  key={`${segment.startTime}-${segment.endTime}-${index}`}
                  className='absolute top-0 bottom-0 bg-blue-500/80 border-x-2 border-blue-700'
                  style={{
                    left: `${(segment.startTime / Math.max(duration, 0.001)) * 100}%`,
                    width: `${((segment.endTime - segment.startTime) / Math.max(duration, 0.001)) * 100}%`,
                  }}
                  title={`Section ${index + 1}: ${segment.startTime.toFixed(2)}s–${segment.endTime.toFixed(2)}s`}
                />
              ))}
              <div
                className='absolute top-0 bottom-0 w-0.5 bg-red-600 z-10'
                style={{
                  left: `${(currentTime / Math.max(duration, 0.001)) * 100}%`,
                }}
              />
            </div>

            <div className='grid grid-cols-1 md:grid-cols-2 gap-3'>
              <label className='text-sm'>
                New section start: {draftStart.toFixed(2)}s
                <input
                  type='range'
                  min={0}
                  max={Math.max(0, duration)}
                  step={0.01}
                  value={Math.min(draftStart, duration)}
                  onChange={(event) => setDraftStart(Number(event.target.value))}
                  className='w-full'
                />
              </label>
              <label className='text-sm'>
                New section end: {draftEnd.toFixed(2)}s
                <input
                  type='range'
                  min={0}
                  max={Math.max(0, duration)}
                  step={0.01}
                  value={Math.min(draftEnd, duration)}
                  onChange={(event) => setDraftEnd(Number(event.target.value))}
                  className='w-full'
                />
              </label>
            </div>

            <div className='flex flex-wrap gap-2'>
              <button
                onClick={() => setDraftStart(currentTime)}
                className='inline-flex items-center gap-1 px-3 py-1 bg-green-600 text-white rounded hover:bg-green-700'
              >
                <Scissors className='h-4 w-4' /> Set Start
              </button>
              <button
                onClick={() => setDraftEnd(currentTime)}
                className='inline-flex items-center gap-1 px-3 py-1 bg-red-600 text-white rounded hover:bg-red-700'
              >
                <Scissors className='h-4 w-4' /> Set End
              </button>
              <button
                onClick={addDraftSection}
                className='inline-flex items-center gap-1 px-3 py-1 bg-blue-600 text-white rounded hover:bg-blue-700'
              >
                <Plus className='h-4 w-4' /> Add Section
              </button>
            </div>
          </div>

          <div className='space-y-2'>
            {segments.map((segment, index) => (
              <div
                key={`row-${index}`}
                className='grid grid-cols-[auto_1fr_1fr_auto_auto] gap-2 items-end rounded border p-2'
              >
                <span className='text-sm font-medium pb-1'>#{index + 1}</span>
                <label className='text-xs text-gray-600'>
                  Start
                  <input
                    type='number'
                    min={0}
                    max={duration}
                    step={0.01}
                    value={segment.startTime}
                    onChange={(event) =>
                      updateSegment(index, 'startTime', Number(event.target.value))
                    }
                    className='block w-full border rounded px-2 py-1 text-sm'
                  />
                </label>
                <label className='text-xs text-gray-600'>
                  End
                  <input
                    type='number'
                    min={0}
                    max={duration}
                    step={0.01}
                    value={segment.endTime}
                    onChange={(event) =>
                      updateSegment(index, 'endTime', Number(event.target.value))
                    }
                    className='block w-full border rounded px-2 py-1 text-sm'
                  />
                </label>
                <button
                  onClick={() => seekTo(segment.startTime)}
                  className='p-2 border rounded hover:bg-gray-50'
                  title='Preview from this section'
                >
                  <Play className='h-4 w-4' />
                </button>
                <button
                  onClick={() =>
                    setSegments((current) =>
                      current.filter((_, segmentIndex) => segmentIndex !== index),
                    )
                  }
                  className='p-2 border border-red-300 text-red-600 rounded hover:bg-red-50'
                  title='Remove section'
                >
                  <Trash2 className='h-4 w-4' />
                </button>
              </div>
            ))}
          </div>

          <div className='flex flex-wrap items-center justify-between gap-3'>
            <div className='text-sm text-gray-700'>
              {segments.length} section{segments.length === 1 ? '' : 's'} ·{' '}
              {selectedDuration.toFixed(2)}s combined
              {errorMessage ? (
                <div className='text-red-600 mt-1'>{errorMessage}</div>
              ) : null}
            </div>
            <div className='flex gap-2'>
              <button
                onClick={onClose}
                disabled={isBuilding}
                className='px-4 py-2 border border-gray-300 rounded hover:bg-gray-50 disabled:opacity-50'
              >
                Cancel
              </button>
              <button
                onClick={buildOverlayClip}
                disabled={!videoFile || isBuilding || !(duration > 0)}
                className='inline-flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50'
              >
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
