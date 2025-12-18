'use client';

import React, { useState, useRef, useEffect, useCallback } from 'react';
import { X, Scissors } from 'lucide-react';

interface VideoEditModalProps {
  isOpen: boolean;
  onClose: () => void;
  videoFile: File | null;
  videoUrl: string | null;
  onSaveGif: (gifBlob: Blob) => void;
}

export function VideoEditModal({
  isOpen,
  onClose,
  videoFile,
  videoUrl,
  onSaveGif,
}: VideoEditModalProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [startTime, setStartTime] = useState(0);
  const [endTime, setEndTime] = useState(0);
  const [isProcessing, setIsProcessing] = useState(false);
  const [videoDimensions, setVideoDimensions] = useState({
    width: 0,
    height: 0,
  });

  useEffect(() => {
    if (videoUrl && videoRef.current) {
      const video = videoRef.current;
      video.src = videoUrl;

      const updateTime = () => setCurrentTime(video.currentTime);
      const updateDuration = () => {
        if (!Number.isFinite(video.duration) || video.duration === Infinity)
          return;
        setDuration(video.duration);
        setEndTime(video.duration);
        // Set video dimensions for aspect ratio
        if (video.videoWidth && video.videoHeight) {
          setVideoDimensions({
            width: video.videoWidth,
            height: video.videoHeight,
          });
        }
      };

      const handleLoadedData = () => {
        // Auto-focus the video when it's loaded so keyboard controls work immediately
        video.focus();
      };

      // Keep controls always visible
      const keepControlsVisible = () => {
        const controls = video.querySelector(
          'div[aria-label*="controls"], .video-controls, [part*="controls"]'
        ) as HTMLElement;
        if (controls) {
          controls.style.display = 'flex';
          controls.style.opacity = '1';
          controls.style.visibility = 'visible';
        }
      };

      video.addEventListener('timeupdate', updateTime);
      video.addEventListener('loadedmetadata', updateDuration);
      video.addEventListener('loadeddata', handleLoadedData);
      video.addEventListener('mouseenter', keepControlsVisible);
      video.addEventListener('mousemove', keepControlsVisible);
      video.addEventListener('mouseleave', keepControlsVisible);

      // Force controls to stay visible
      const style = document.createElement('style');
      style.textContent = `
        video::-webkit-media-controls-panel {
          display: flex !important;
          opacity: 1 !important;
          visibility: visible !important;
        }
        video::-webkit-media-controls {
          display: flex !important;
          opacity: 1 !important;
          visibility: visible !important;
        }
        video::-moz-media-controls {
          display: flex !important;
          opacity: 1 !important;
          visibility: visible !important;
        }
      `;
      document.head.appendChild(style);

      return () => {
        video.removeEventListener('timeupdate', updateTime);
        video.removeEventListener('loadedmetadata', updateDuration);
        video.removeEventListener('loadeddata', handleLoadedData);
        video.removeEventListener('mouseenter', keepControlsVisible);
        video.removeEventListener('mousemove', keepControlsVisible);
        video.removeEventListener('mouseleave', keepControlsVisible);
        document.head.removeChild(style);
      };
    }
  }, [videoUrl]);

  const handleModalKeyDown = (e: React.KeyboardEvent) => {
    if (e.code === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      onClose();
    }
  };

  const handleTrim = () => {
    setStartTime(currentTime);
    // Refocus the video so keyboard controls still work
    setTimeout(() => videoRef.current?.focus(), 0);
  };

  const handleTrimEnd = () => {
    setEndTime(currentTime);
    // Refocus the video so keyboard controls still work
    setTimeout(() => videoRef.current?.focus(), 0);
  };

  const convertToGif = useCallback(async () => {
    if (!videoFile) return;

    setIsProcessing(true);

    try {
      const formData = new FormData();
      formData.append('video', videoFile);
      formData.append('startTime', startTime.toString());
      formData.append('endTime', endTime.toString());

      const response = await fetch('/api/video-to-gif', {
        method: 'POST',
        body: formData,
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || 'Failed to convert video');
      }

      const gifBlob = await response.blob();
      onSaveGif(gifBlob);
    } catch (error) {
      console.error('Error converting video to GIF:', error);
      alert('Failed to convert video to GIF. Please try again.');
    } finally {
      setIsProcessing(false);
    }
  }, [videoFile, startTime, endTime, onSaveGif]);

  if (!isOpen) return null;

  return (
    <div
      className='fixed inset-0 bg-black bg-opacity-75 flex items-center justify-center z-[70]'
      onKeyDown={handleModalKeyDown}
      tabIndex={-1}
    >
      <div className='bg-white rounded-lg p-4 max-w-6xl max-h-[95vh] w-full mx-4 overflow-y-auto'>
        <div className='flex justify-between items-center mb-4'>
          <h3 className='text-lg font-semibold'>Edit Video</h3>
          <button onClick={onClose} className='p-1 hover:bg-gray-100 rounded'>
            <X className='h-5 w-5' />
          </button>
        </div>

        <div className='space-y-4'>
          {/* Video Player */}
          <div className='relative w-full flex justify-center'>
            <video
              ref={videoRef}
              className='bg-black rounded'
              controls={true}
              style={{
                width:
                  videoDimensions.width > 0
                    ? Math.min(videoDimensions.width, 1100)
                    : '90%',
                height:
                  videoDimensions.height > 0
                    ? Math.min(
                        videoDimensions.height *
                          (Math.min(videoDimensions.width, 1100) /
                            videoDimensions.width),
                        900
                      )
                    : 'auto',
                maxWidth: '100%',
                maxHeight: '85vh',
              }}
            />
          </div>

          {/* Trim Controls */}
          <div className='space-y-2'>
            <h4 className='font-medium'>Trim Video</h4>
            <div className='flex items-center space-x-2'>
              <button
                onClick={handleTrim}
                className='flex items-center space-x-1 px-3 py-1 bg-green-500 text-white rounded hover:bg-green-600'
              >
                <Scissors className='h-4 w-4' />
                <span>Set Start ({startTime.toFixed(1)}s)</span>
              </button>
              <button
                onClick={handleTrimEnd}
                className='flex items-center space-x-1 px-3 py-1 bg-red-500 text-white rounded hover:bg-red-600'
              >
                <Scissors className='h-4 w-4' />
                <span>Set End ({endTime.toFixed(1)}s)</span>
              </button>
            </div>
          </div>

          {/* Save Button */}
          <div className='flex justify-end space-x-2'>
            <button
              onClick={onClose}
              className='px-4 py-2 border border-gray-300 rounded hover:bg-gray-50'
            >
              Cancel
            </button>
            <button
              onClick={convertToGif}
              disabled={isProcessing}
              className='px-4 py-2 bg-blue-500 text-white rounded hover:bg-blue-600 disabled:opacity-50'
            >
              {isProcessing ? 'Processing...' : 'Save as GIF'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
