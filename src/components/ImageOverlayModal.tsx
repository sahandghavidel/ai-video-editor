'use client';

import React, { useState, useRef, useCallback, useEffect } from 'react';
import { X, Upload, Loader2, RotateCcw, Maximize } from 'lucide-react';
import { getSceneById } from '@/lib/baserow-actions';

interface ImageOverlayModalProps {
  isOpen: boolean;
  onClose: () => void;
  videoUrl: string;
  sceneId: number;
  onApply: (
    sceneId: number,
    overlayImage: File,
    position: { x: number; y: number },
    size: { width: number; height: number },
    startTime: number,
    endTime: number
  ) => Promise<void>;
  isApplying?: boolean;
  handleTranscribeScene?: (
    sceneId: number,
    sceneData?: any,
    videoType?: 'original' | 'final'
  ) => Promise<void>;
}

export const ImageOverlayModal: React.FC<ImageOverlayModalProps> = ({
  isOpen,
  onClose,
  videoUrl,
  sceneId,
  onApply,
  isApplying = false,
  handleTranscribeScene,
}) => {
  const [overlayImage, setOverlayImage] = useState<File | null>(null);
  const [overlayImageUrl, setOverlayImageUrl] = useState<string | null>(null);
  const [overlayPosition, setOverlayPosition] = useState({ x: 50, y: 50 }); // percentage
  const [overlaySize, setOverlaySize] = useState({ width: 40, height: 40 }); // percentage
  const [startTime, setStartTime] = useState(0);
  const [endTime, setEndTime] = useState(0);
  const [isDragging, setIsDragging] = useState(false);
  const [isResizing, setIsResizing] = useState(false);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [transcriptionWords, setTranscriptionWords] = useState<Array<{
    word: string;
    start: number;
    end: number;
  }> | null>(null);
  const [selectedWordIndex, setSelectedWordIndex] = useState<number | null>(
    null
  );
  const [isTranscribing, setIsTranscribing] = useState(false);
  const [refetchTrigger, setRefetchTrigger] = useState(0);

  const videoRef = useRef<HTMLVideoElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const previewVideoRef = useRef<HTMLVideoElement>(null);

  const getVideoContentRect = useCallback(() => {
    const video = videoRef.current;
    if (!video) return null;

    // Use the container rect for consistent positioning
    const container = video.parentElement;
    const rect =
      container?.getBoundingClientRect() || video.getBoundingClientRect();
    return rect;
  }, []);

  const handleImageUpload = useCallback(
    (event: React.ChangeEvent<HTMLInputElement>) => {
      const file = event.target.files?.[0];
      if (file && file.type.startsWith('image/')) {
        setOverlayImage(file);
        const url = URL.createObjectURL(file);
        setOverlayImageUrl(url);
      }
    },
    []
  );

  const handleVideoLoad = useCallback(() => {
    const video = videoRef.current;
    if (video && video.duration) {
      setEndTime(video.duration);
    }
  }, []);

  const handleMouseDown = useCallback(
    (event: React.PointerEvent) => {
      if (!overlayImageUrl) return;

      const contentRect = getVideoContentRect();
      if (!contentRect) return;

      const x = event.clientX - contentRect.left;
      const y = event.clientY - contentRect.top;

      // Check if clicking on the overlay image
      const overlayX = overlayPosition.x - overlaySize.width / 2;
      const overlayY = overlayPosition.y - overlaySize.height / 2;

      // Convert to pixels
      const overlayX_px = (overlayX / 100) * contentRect.width;
      const overlayY_px = (overlayY / 100) * contentRect.height;
      const overlayWidth_px = (overlaySize.width / 100) * contentRect.width;
      const overlayHeight_px = (overlaySize.height / 100) * contentRect.height;

      // Check if clicking near edges/corners for resizing (within 10px of edges)
      const edgeThreshold = 10;
      const nearLeftEdge =
        x >= overlayX_px - edgeThreshold && x <= overlayX_px + edgeThreshold;
      const nearRightEdge =
        x >= overlayX_px + overlayWidth_px - edgeThreshold &&
        x <= overlayX_px + overlayWidth_px + edgeThreshold;
      const nearTopEdge =
        y >= overlayY_px - edgeThreshold && y <= overlayY_px + edgeThreshold;
      const nearBottomEdge =
        y >= overlayY_px + overlayHeight_px - edgeThreshold &&
        y <= overlayY_px + overlayHeight_px + edgeThreshold;

      const isNearEdge =
        nearLeftEdge || nearRightEdge || nearTopEdge || nearBottomEdge;

      if (isNearEdge) {
        // Start resizing - determine resize direction based on which edges are near
        const startX = event.clientX;
        const startY = event.clientY;
        const startSize = { ...overlaySize };
        const startPos = { ...overlayPosition };
        const pointerId = event.pointerId;

        setIsResizing(true);

        const handleGlobalPointerMove = (e: PointerEvent) => {
          const rect = getVideoContentRect();
          if (!rect) return;

          let newWidth = startSize.width;
          let newHeight = startSize.height;
          let newX = startPos.x;
          let newY = startPos.y;

          // Handle horizontal resizing
          if (nearLeftEdge) {
            const deltaX = ((e.clientX - startX) / rect.width) * 100;
            newWidth = Math.max(5, startSize.width - deltaX);
            newX = startPos.x + deltaX / 2; // Move position to keep right edge in place
          } else if (nearRightEdge) {
            const deltaX = ((e.clientX - startX) / rect.width) * 100;
            newWidth = Math.max(5, startSize.width + deltaX);
          }

          // Handle vertical resizing
          if (nearTopEdge) {
            const deltaY = ((e.clientY - startY) / rect.height) * 100;
            newHeight = Math.max(5, startSize.height - deltaY);
            newY = startPos.y + deltaY / 2; // Move position to keep bottom edge in place
          } else if (nearBottomEdge) {
            const deltaY = ((e.clientY - startY) / rect.height) * 100;
            newHeight = Math.max(5, startSize.height + deltaY);
          }

          setOverlaySize({
            width: Math.min(newWidth, 100),
            height: Math.min(newHeight, 100),
          });

          // Update position if resizing from top/left
          if (nearLeftEdge || nearTopEdge) {
            setOverlayPosition({
              x: Math.max(0, Math.min(100, newX)),
              y: Math.max(0, Math.min(100, newY)),
            });
          }
        };

        const handleGlobalPointerUp = () => {
          setIsResizing(false);
          document.removeEventListener('pointermove', handleGlobalPointerMove);
          document.removeEventListener('pointerup', handleGlobalPointerUp);
          // Release pointer capture
          try {
            (event.target as Element)?.releasePointerCapture(pointerId);
          } catch (e) {
            // Ignore errors if pointer capture wasn't set
          }
        };

        document.addEventListener('pointermove', handleGlobalPointerMove);
        document.addEventListener('pointerup', handleGlobalPointerUp);

        // Capture pointer to ensure mouse events are received even outside the element
        (event.target as Element).setPointerCapture(event.pointerId);
        event.preventDefault();
      } else if (
        x >= overlayX_px &&
        x <= overlayX_px + overlayWidth_px &&
        y >= overlayY_px &&
        y <= overlayY_px + overlayHeight_px
      ) {
        // Start dragging (center area)
        const startX = event.clientX;
        const startY = event.clientY;
        const startPos = { ...overlayPosition };
        const pointerId = event.pointerId;

        setIsDragging(true);

        const handleGlobalPointerMove = (e: PointerEvent) => {
          const rect = getVideoContentRect();
          if (!rect) return;

          const deltaX = ((e.clientX - startX) / rect.width) * 100;
          const deltaY = ((e.clientY - startY) / rect.height) * 100;

          setOverlayPosition({
            x: Math.max(0, Math.min(100, startPos.x + deltaX)),
            y: Math.max(0, Math.min(100, startPos.y + deltaY)),
          });
        };

        const handleGlobalPointerUp = () => {
          setIsDragging(false);
          document.removeEventListener('pointermove', handleGlobalPointerMove);
          document.removeEventListener('pointerup', handleGlobalPointerUp);
          // Release pointer capture
          try {
            (event.target as Element)?.releasePointerCapture(pointerId);
          } catch (e) {
            // Ignore errors if pointer capture wasn't set
          }
        };

        document.addEventListener('pointermove', handleGlobalPointerMove);
        document.addEventListener('pointerup', handleGlobalPointerUp);

        // Capture pointer to ensure mouse events are received even outside the element
        (event.target as Element).setPointerCapture(event.pointerId);
        event.preventDefault();
      }
    },
    [overlayImageUrl, overlayPosition, overlaySize, getVideoContentRect]
  );

  const handlePointerMove = useCallback(
    (event: React.PointerEvent) => {
      if (!overlayImageUrl) return;

      const contentRect = getVideoContentRect();
      if (!contentRect) return;

      const x = event.clientX - contentRect.left;
      const y = event.clientY - contentRect.top;

      // Check if hovering near edges/corners for resizing
      const overlayX = overlayPosition.x - overlaySize.width / 2;
      const overlayY = overlayPosition.y - overlaySize.height / 2;

      // Convert to pixels
      const overlayX_px = (overlayX / 100) * contentRect.width;
      const overlayY_px = (overlayY / 100) * contentRect.height;
      const overlayWidth_px = (overlaySize.width / 100) * contentRect.width;
      const overlayHeight_px = (overlaySize.height / 100) * contentRect.height;

      // Check if hovering near edges/corners (within 10px of edges)
      const edgeThreshold = 10;
      const nearLeftEdge =
        x >= overlayX_px - edgeThreshold && x <= overlayX_px + edgeThreshold;
      const nearRightEdge =
        x >= overlayX_px + overlayWidth_px - edgeThreshold &&
        x <= overlayX_px + overlayWidth_px + edgeThreshold;
      const nearTopEdge =
        y >= overlayY_px - edgeThreshold && y <= overlayY_px + edgeThreshold;
      const nearBottomEdge =
        y >= overlayY_px + overlayHeight_px - edgeThreshold &&
        y <= overlayY_px + overlayHeight_px + edgeThreshold;

      // Set cursor based on position
      if (nearLeftEdge && nearTopEdge) {
        document.body.style.cursor = 'nw-resize';
      } else if (nearRightEdge && nearTopEdge) {
        document.body.style.cursor = 'ne-resize';
      } else if (nearLeftEdge && nearBottomEdge) {
        document.body.style.cursor = 'sw-resize';
      } else if (nearRightEdge && nearBottomEdge) {
        document.body.style.cursor = 'se-resize';
      } else if (nearLeftEdge || nearRightEdge) {
        document.body.style.cursor = 'ew-resize';
      } else if (nearTopEdge || nearBottomEdge) {
        document.body.style.cursor = 'ns-resize';
      } else if (
        x >= overlayX_px &&
        x <= overlayX_px + overlayWidth_px &&
        y >= overlayY_px &&
        y <= overlayY_px + overlayHeight_px
      ) {
        document.body.style.cursor = 'move';
      } else {
        document.body.style.cursor = 'default';
      }
    },
    [overlayImageUrl, overlayPosition, overlaySize, getVideoContentRect]
  );

  const handlePointerLeave = useCallback(() => {
    document.body.style.cursor = 'default';
  }, []);

  const handlePreview = useCallback(async () => {
    if (!overlayImage) return;

    const formData = new FormData();
    formData.append('videoUrl', videoUrl);
    formData.append('sceneId', sceneId.toString());
    formData.append('overlayImage', overlayImage);
    formData.append('positionX', overlayPosition.x.toString());
    formData.append('positionY', overlayPosition.y.toString());
    formData.append('sizeWidth', overlaySize.width.toString());
    formData.append('sizeHeight', overlaySize.height.toString());
    formData.append('startTime', startTime.toString());
    formData.append('endTime', endTime.toString());
    formData.append('preview', 'true');

    try {
      const response = await fetch('/api/add-image-overlay', {
        method: 'POST',
        body: formData,
      });
      const data = await response.json();
      if (data.success) {
        setPreviewUrl(data.url);
      } else {
        alert('Preview failed: ' + data.error);
      }
    } catch (error) {
      alert('Error generating preview');
    }
  }, [
    overlayImage,
    videoUrl,
    sceneId,
    overlayPosition,
    overlaySize,
    startTime,
    endTime,
  ]);

  const handleApply = useCallback(async () => {
    if (!overlayImage) return;

    await onApply(
      sceneId,
      overlayImage,
      overlayPosition,
      overlaySize,
      startTime,
      endTime
    );
    onClose();
    // Reset state
    setOverlayImage(null);
    setOverlayImageUrl(null);
    setOverlayPosition({ x: 50, y: 50 });
    setOverlaySize({ width: 40, height: 40 });
    setPreviewUrl(null);
  }, [
    overlayImage,
    sceneId,
    overlayPosition,
    overlaySize,
    startTime,
    endTime,
    onApply,
    onClose,
  ]);

  const handleClose = useCallback(() => {
    onClose();
    // Reset state
    setOverlayImage(null);
    setOverlayImageUrl(null);
    setOverlayPosition({ x: 50, y: 50 });
    setOverlaySize({ width: 40, height: 40 });
    setStartTime(0);
    setEndTime(0);
    setPreviewUrl(null);
    setTranscriptionWords(null);
    setSelectedWordIndex(null);
    setSelectedWordIndex(null);
  }, [onClose]);

  // Fetch transcription data
  useEffect(() => {
    if (isOpen && sceneId) {
      const fetchTranscription = async () => {
        try {
          // Fetch scene data from Baserow to get the Captions URL
          const sceneData = await getSceneById(sceneId);

          // Try different possible field names and specific field IDs
          let captionsUrl = null;

          // First try the specific field that contains captions URL
          if (
            sceneData?.['field_6910'] &&
            typeof sceneData['field_6910'] === 'string' &&
            (sceneData['field_6910'].startsWith('http') ||
              sceneData['field_6910'].includes('.json'))
          ) {
            captionsUrl = sceneData['field_6910'];
          }

          // Then try other possible field names
          if (!captionsUrl) {
            captionsUrl =
              sceneData?.['Captions URL'] ||
              sceneData?.['captions_url'] ||
              sceneData?.['CaptionsURL'] ||
              sceneData?.['captions URL'];
          }

          // Finally try other field IDs that might contain captions (only if they look like URLs)
          if (!captionsUrl) {
            const possibleFields = [
              'field_6892',
              'field_6893',
              'field_6894',
              'field_6895',
              'field_6897',
              'field_6898',
              'field_6899',
            ];
            for (const field of possibleFields) {
              const value = sceneData?.[field];
              if (
                value &&
                typeof value === 'string' &&
                (value.startsWith('http') || value.includes('.json'))
              ) {
                captionsUrl = value;
                break;
              }
            }
          }

          if (captionsUrl) {
            const response = await fetch(captionsUrl as string);
            if (response.ok) {
              const data = await response.json();
              setTranscriptionWords(data);
            } else {
              setTranscriptionWords(null);
            }
          } else {
            setTranscriptionWords(null);
          }
        } catch (error) {
          console.error('Failed to fetch transcription:', error);
          setTranscriptionWords(null);
        }
      };
      fetchTranscription();
    } else {
      // Modal is closed, clear transcription data
      setTranscriptionWords(null);
    }
  }, [isOpen, sceneId, refetchTrigger]);

  // Handle keyboard controls
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.code === 'Escape') {
        if (previewUrl) {
          setPreviewUrl(null);
        } else {
          handleClose();
        }
        return;
      }

      if (event.code === 'Space') {
        event.preventDefault();
        const video = previewUrl ? previewVideoRef.current : videoRef.current;
        if (video) {
          if (video.paused) {
            video.play();
          } else {
            video.pause();
          }
        }
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [previewUrl, handleClose]);

  if (!isOpen) return null;

  return (
    <div className='fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50'>
      <div className='bg-white rounded-lg p-8 w-full mx-2 h-[95vh] overflow-hidden'>
        <div className='flex justify-between items-center mb-4'>
          <h2 className='text-xl font-semibold'>Add Image Overlay</h2>
          <button
            onClick={handleClose}
            className='p-1 hover:bg-gray-100 rounded'
          >
            <X className='h-5 w-5' />
          </button>
        </div>

        <div className='grid grid-cols-1 lg:grid-cols-3 gap-6'>
          {/* Video Preview */}
          <div
            className='relative lg:col-span-2'
            onPointerDown={handleMouseDown}
            onPointerMove={handlePointerMove}
            onPointerLeave={handlePointerLeave}
          >
            <video
              ref={videoRef}
              src={videoUrl}
              className='w-full h-full object-contain rounded border'
              controls
              onLoadedMetadata={handleVideoLoad}
            />
            {/* Invisible overlay to capture clicks when there's an overlay - excludes controls area */}
            {overlayImageUrl && (
              <div
                className='absolute pointer-events-auto z-5'
                style={{
                  top: 0,
                  left: 0,
                  right: 0,
                  bottom: '40px', // Leave space for video controls at bottom
                }}
                onPointerDown={(e) => {
                  // Only prevent default if clicking in overlay area
                  const contentRect = getVideoContentRect();
                  if (!contentRect) return;

                  const x = e.clientX - contentRect.left;
                  const y = e.clientY - contentRect.top;

                  const overlayX = overlayPosition.x - overlaySize.width / 2;
                  const overlayY = overlayPosition.y - overlaySize.height / 2;
                  const overlayX_px = (overlayX / 100) * contentRect.width;
                  const overlayY_px = (overlayY / 100) * contentRect.height;
                  const overlayWidth_px =
                    (overlaySize.width / 100) * contentRect.width;
                  const overlayHeight_px =
                    (overlaySize.height / 100) * contentRect.height;

                  // If clicking within overlay bounds, handle overlay interaction
                  if (
                    x >= overlayX_px &&
                    x <= overlayX_px + overlayWidth_px &&
                    y >= overlayY_px &&
                    y <= overlayY_px + overlayHeight_px
                  ) {
                    handleMouseDown(e);
                  } else {
                    // Outside overlay - allow video surface clicks (but not controls)
                    // This will still prevent accidental play/pause on video surface
                    e.preventDefault();
                  }
                }}
              />
            )}
            {overlayImageUrl && (
              <div
                className='absolute border-2 border-blue-500 cursor-move pointer-events-auto z-20'
                style={{
                  left: `${overlayPosition.x}%`,
                  top: `${overlayPosition.y}%`,
                  width: `${overlaySize.width}%`,
                  height: `${overlaySize.height}%`,
                  transform: 'translate(-50%, -50%)',
                }}
                onPointerDown={handleMouseDown}
              >
                <img
                  src={overlayImageUrl}
                  alt='Overlay'
                  className='w-full h-full object-cover'
                  draggable={false}
                  onPointerDown={handleMouseDown}
                />
              </div>
            )}
          </div>

          {/* Controls */}
          <div className='space-y-4'>
            {/* Image Upload */}
            <div>
              <input
                ref={fileInputRef}
                type='file'
                accept='image/*'
                onChange={handleImageUpload}
                className='hidden'
              />
              <button
                onClick={() => fileInputRef.current?.click()}
                className='flex items-center space-x-2 px-4 py-2 border border-gray-300 rounded hover:bg-gray-50'
              >
                <Upload className='h-4 w-4' />
                <span>{overlayImage ? 'Change Image' : 'Upload Image'}</span>
              </button>
              {overlayImage && (
                <p className='text-sm text-gray-600 mt-1'>
                  {overlayImage.name}
                </p>
              )}
            </div>

            {/* Position Controls */}
            {/* Position and Size Controls */}
            {overlayImageUrl && (
              <div className='space-y-2'>
                <div className='flex gap-2 items-end w-full'>
                  <div className='flex-1'>
                    <label className='block text-xs text-gray-600'>X (%)</label>
                    <input
                      type='number'
                      value={overlayPosition.x}
                      onChange={(e) =>
                        setOverlayPosition((prev) => ({
                          ...prev,
                          x: Number(e.target.value),
                        }))
                      }
                      className='w-full px-2 py-1 border border-gray-300 rounded text-sm'
                      min='0'
                      max='100'
                    />
                  </div>
                  <div className='flex-1'>
                    <label className='block text-xs text-gray-600'>Y (%)</label>
                    <input
                      type='number'
                      value={overlayPosition.y}
                      onChange={(e) =>
                        setOverlayPosition((prev) => ({
                          ...prev,
                          y: Number(e.target.value),
                        }))
                      }
                      className='w-full px-2 py-1 border border-gray-300 rounded text-sm'
                      min='0'
                      max='100'
                    />
                  </div>
                  <div className='flex-1'>
                    <label className='block text-xs text-gray-600'>
                      Width (%)
                    </label>
                    <input
                      type='number'
                      value={overlaySize.width}
                      onChange={(e) =>
                        setOverlaySize((prev) => ({
                          ...prev,
                          width: Number(e.target.value),
                        }))
                      }
                      className='w-full px-2 py-1 border border-gray-300 rounded text-sm'
                      min='5'
                      max='100'
                    />
                  </div>
                  <div className='flex-1'>
                    <label className='block text-xs text-gray-600'>
                      Height (%)
                    </label>
                    <input
                      type='number'
                      value={overlaySize.height}
                      onChange={(e) =>
                        setOverlaySize((prev) => ({
                          ...prev,
                          height: Number(e.target.value),
                        }))
                      }
                      className='w-full px-2 py-1 border border-gray-300 rounded text-sm'
                      min='5'
                      max='100'
                    />
                  </div>
                  <div className='flex-shrink-0 mt-4'>
                    <button
                      onClick={() => {
                        setOverlayPosition({ x: 50, y: 50 });
                        setOverlaySize({ width: 40, height: 40 });
                      }}
                      className='px-1 py-1 border border-gray-300 rounded hover:bg-gray-50 text-gray-600 hover:text-gray-800 h-8 flex items-center justify-center'
                      title='Center and reset size'
                    >
                      <RotateCcw className='h-3 w-3' />
                    </button>
                  </div>
                  <div className='flex-shrink-0 mt-4'>
                    <button
                      onClick={() => {
                        setOverlayPosition({ x: 50, y: 50 });
                        setOverlaySize({ width: 100, height: 100 });
                      }}
                      className='px-1 py-1 border border-gray-300 rounded hover:bg-gray-50 text-gray-600 hover:text-gray-800 h-8 flex items-center justify-center'
                      title='Center and maximize size'
                    >
                      <Maximize className='h-3 w-3' />
                    </button>
                  </div>
                </div>
              </div>
            )}

            {/* Timing Controls */}
            {overlayImageUrl && (
              <div className='space-y-2'>
                <label className='block text-sm font-medium'>Timing</label>
                <div className='grid grid-cols-2 gap-2'>
                  <div>
                    <label className='block text-xs text-gray-600'>
                      Start Time (s)
                    </label>
                    <input
                      type='number'
                      value={startTime}
                      onChange={(e) => setStartTime(Number(e.target.value))}
                      className='w-full px-2 py-1 border border-gray-300 rounded text-sm'
                      min='0'
                      step='0.1'
                    />
                    <button
                      onClick={() => {
                        const video = videoRef.current;
                        if (video) {
                          setStartTime(video.currentTime);
                        }
                      }}
                      className='mt-1 w-full px-3 py-1.5 text-xs bg-blue-500 text-white rounded hover:bg-blue-600 font-medium'
                    >
                      Set Current Time
                    </button>
                  </div>
                  <div>
                    <label className='block text-xs text-gray-600'>
                      End Time (s)
                    </label>
                    <input
                      type='number'
                      value={endTime}
                      onChange={(e) => setEndTime(Number(e.target.value))}
                      className='w-full px-2 py-1 border border-gray-300 rounded text-sm'
                      min='0'
                      step='0.1'
                    />
                    <button
                      onClick={() => {
                        const video = videoRef.current;
                        if (video) {
                          setEndTime(video.currentTime);
                        }
                      }}
                      className='mt-1 w-full px-3 py-1.5 text-xs bg-blue-500 text-white rounded hover:bg-blue-600 font-medium'
                    >
                      Set Current Time
                    </button>
                  </div>
                </div>
              </div>
            )}
            {/* Transcription Words */}
            {transcriptionWords && transcriptionWords.length > 0 ? (
              <div className='space-y-2'>
                <div className='max-h-48 overflow-y-auto bg-gray-50 p-3 rounded border'>
                  <div className='flex flex-wrap gap-1'>
                    {transcriptionWords.map((wordData, index) => (
                      <button
                        key={index}
                        onClick={() => {
                          setStartTime(wordData.start);
                          setSelectedWordIndex(index);
                          // Also seek the video to this time
                          if (videoRef.current) {
                            videoRef.current.currentTime = wordData.start;
                          }
                        }}
                        className={`px-3 py-1.5 text-sm font-medium rounded transition-colors ${
                          selectedWordIndex === index
                            ? 'bg-blue-500 text-white border-blue-500'
                            : 'bg-white text-gray-700 border border-gray-300 hover:bg-blue-50 hover:border-blue-300'
                        }`}
                        title={`Click to set start time to ${wordData.start}s`}
                      >
                        {wordData.word}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            ) : (
              handleTranscribeScene && (
                <div className='space-y-2'>
                  <button
                    onClick={async () => {
                      setIsTranscribing(true);
                      try {
                        await handleTranscribeScene(
                          sceneId,
                          undefined,
                          'final'
                        );
                        // Refetch transcription after transcribing
                        setRefetchTrigger((prev) => prev + 1);
                      } catch (error) {
                        console.error('Failed to transcribe:', error);
                      } finally {
                        setIsTranscribing(false);
                      }
                    }}
                    disabled={isTranscribing}
                    className='flex items-center space-x-2 px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 rounded border border-gray-300 disabled:opacity-50 disabled:cursor-not-allowed'
                  >
                    {isTranscribing ? (
                      <Loader2 className='h-4 w-4 animate-spin' />
                    ) : (
                      <span>🎙️</span>
                    )}
                    <span>
                      {isTranscribing
                        ? 'Transcribing...'
                        : 'Transcribe Final Video'}
                    </span>
                  </button>
                </div>
              )
            )}
          </div>
        </div>

        {/* Action Buttons */}
        <div className='flex justify-end space-x-3 mt-6 pt-4 border-t'>
          <button
            onClick={handleClose}
            className='px-4 py-2 text-gray-600 hover:bg-gray-100 rounded'
            disabled={isApplying}
          >
            Cancel
          </button>
          <button
            onClick={handlePreview}
            disabled={!overlayImage || isApplying}
            className='px-4 py-2 bg-green-600 text-white rounded hover:bg-green-700 disabled:opacity-50 disabled:cursor-not-allowed'
          >
            Preview
          </button>
          <button
            onClick={handleApply}
            disabled={!overlayImage || isApplying}
            className='flex items-center space-x-2 px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed'
          >
            {isApplying ? (
              <Loader2 className='animate-spin h-4 w-4' />
            ) : (
              <span>Apply Overlay</span>
            )}
          </button>
        </div>
      </div>

      {/* Preview Video Overlay */}
      {previewUrl && (
        <div
          className='fixed inset-0 bg-black bg-opacity-75 flex items-center justify-center z-[60]'
          onClick={() => setPreviewUrl(null)}
        >
          <div className='relative max-w-4xl max-h-[80vh] w-full mx-4'>
            <button
              onClick={(e) => {
                e.stopPropagation();
                setPreviewUrl(null);
              }}
              className='absolute -top-10 right-0 text-white hover:text-gray-300 text-xl font-bold'
            >
              ✕
            </button>
            <video
              src={previewUrl}
              controls
              autoPlay
              className='w-full h-full rounded-lg'
              onClick={(e) => e.stopPropagation()}
              ref={previewVideoRef}
            />
          </div>
        </div>
      )}
    </div>
  );
};
