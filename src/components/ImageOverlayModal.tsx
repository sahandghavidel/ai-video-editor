'use client';

import React, { useState, useRef, useCallback } from 'react';
import { X, Upload, Loader2 } from 'lucide-react';

interface ImageOverlayModalProps {
  isOpen: boolean;
  onClose: () => void;
  videoUrl: string;
  sceneId: number;
  onApply: (
    sceneId: number,
    overlayImage: File,
    position: { x: number; y: number },
    size: { width: number; height: number }
  ) => Promise<void>;
  isApplying?: boolean;
}

export const ImageOverlayModal: React.FC<ImageOverlayModalProps> = ({
  isOpen,
  onClose,
  videoUrl,
  sceneId,
  onApply,
  isApplying = false,
}) => {
  const [overlayImage, setOverlayImage] = useState<File | null>(null);
  const [overlayImageUrl, setOverlayImageUrl] = useState<string | null>(null);
  const [overlayPosition, setOverlayPosition] = useState({ x: 50, y: 50 }); // percentage
  const [overlaySize, setOverlaySize] = useState({ width: 20, height: 20 }); // percentage
  const [isDragging, setIsDragging] = useState(false);
  const [isResizing, setIsResizing] = useState(false);
  const [dragStart, setDragStart] = useState({ x: 0, y: 0 });
  const [resizeStartSize, setResizeStartSize] = useState({
    width: 20,
    height: 20,
  });

  const videoRef = useRef<HTMLVideoElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

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

  const handleMouseDown = useCallback(
    (event: React.MouseEvent) => {
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

      // Check if clicking on resize handle (bottom-right corner)
      const resizeHandleX = overlayX_px + overlayWidth_px - 12; // 12px is handle size
      const resizeHandleY = overlayY_px + overlayHeight_px - 12;

      if (
        x >= resizeHandleX &&
        x <= resizeHandleX + 12 &&
        y >= resizeHandleY &&
        y <= resizeHandleY + 12
      ) {
        setIsResizing(true);
        setDragStart({
          x: event.clientX,
          y: event.clientY,
        });
        setResizeStartSize(overlaySize);
      } else if (
        x >= overlayX_px &&
        x <= overlayX_px + overlayWidth_px &&
        y >= overlayY_px &&
        y <= overlayY_px + overlayHeight_px
      ) {
        setIsDragging(true);
        setDragStart({
          x:
            event.clientX -
            contentRect.left -
            overlayX_px -
            overlayWidth_px / 2,
          y:
            event.clientY -
            contentRect.top -
            overlayY_px -
            overlayHeight_px / 2,
        });
      }
    },
    [overlayImageUrl, overlayPosition, overlaySize, getVideoContentRect]
  );

  const handleMouseMove = useCallback(
    (event: React.MouseEvent) => {
      if (isDragging) {
        const contentRect = getVideoContentRect();
        if (!contentRect) return;

        const newX =
          ((event.clientX - contentRect.left - dragStart.x) /
            contentRect.width) *
          100;
        const newY =
          ((event.clientY - contentRect.top - dragStart.y) /
            contentRect.height) *
          100;

        setOverlayPosition({
          x: Math.max(0, Math.min(100, newX)),
          y: Math.max(0, Math.min(100, newY)),
        });
      } else if (isResizing) {
        const contentRect = getVideoContentRect();
        if (!contentRect) return;

        const deltaX =
          ((event.clientX - dragStart.x) / contentRect.width) * 100;
        const deltaY =
          ((event.clientY - dragStart.y) / contentRect.height) * 100;

        const newWidth = Math.max(5, resizeStartSize.width + deltaX);
        const newHeight = Math.max(5, resizeStartSize.height + deltaY);

        setOverlaySize({
          width: Math.min(newWidth, 100), // Max 100%
          height: Math.min(newHeight, 100), // Max 100%
        });
      }
    },
    [
      isDragging,
      isResizing,
      dragStart,
      overlaySize,
      resizeStartSize,
      getVideoContentRect,
    ]
  );

  const handleMouseUp = useCallback(() => {
    setIsDragging(false);
    setIsResizing(false);
  }, []);

  const handleApply = useCallback(async () => {
    if (!overlayImage) return;

    try {
      await onApply(sceneId, overlayImage, overlayPosition, overlaySize);
      onClose();
      // Reset state
      setOverlayImage(null);
      setOverlayImageUrl(null);
      setOverlayPosition({ x: 50, y: 50 });
      setOverlaySize({ width: 20, height: 20 });
    } catch (error) {
      console.error('Failed to apply image overlay:', error);
    }
  }, [overlayImage, sceneId, overlayPosition, overlaySize, onApply, onClose]);

  const handleClose = useCallback(() => {
    onClose();
    // Reset state
    setOverlayImage(null);
    setOverlayImageUrl(null);
    setOverlayPosition({ x: 50, y: 50 });
    setOverlaySize({ width: 20, height: 20 });
    setResizeStartSize({ width: 20, height: 20 });
  }, [onClose]);

  if (!isOpen) return null;

  return (
    <div className='fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50'>
      <div className='bg-white rounded-lg p-6 max-w-4xl w-full mx-4 max-h-[90vh] overflow-hidden'>
        <div className='flex justify-between items-center mb-4'>
          <h2 className='text-xl font-semibold'>Add Image Overlay</h2>
          <button
            onClick={handleClose}
            className='p-1 hover:bg-gray-100 rounded'
          >
            <X className='h-5 w-5' />
          </button>
        </div>

        <div className='grid grid-cols-1 lg:grid-cols-2 gap-6'>
          {/* Video Preview */}
          <div
            className='relative aspect-video'
            onMouseDown={handleMouseDown}
            onMouseMove={handleMouseMove}
            onMouseUp={handleMouseUp}
            onMouseLeave={handleMouseUp}
          >
            <video
              ref={videoRef}
              src={videoUrl}
              className='w-full h-full object-contain rounded border'
              controls
            />
            {overlayImageUrl && (
              <div
                className='absolute border-2 border-blue-500 cursor-move'
                style={{
                  left: `${overlayPosition.x}%`,
                  top: `${overlayPosition.y}%`,
                  width: `${overlaySize.width}%`,
                  height: `${overlaySize.height}%`,
                  transform: 'translate(-50%, -50%)',
                }}
                onMouseDown={handleMouseDown}
              >
                <img
                  src={overlayImageUrl}
                  alt='Overlay'
                  className='w-full h-full object-cover'
                  draggable={false}
                  onMouseDown={handleMouseDown}
                />
                {/* Resize handle */}
                <div
                  className='absolute bottom-0 right-0 w-12 h-12 bg-blue-500 cursor-se-resize rounded-sm opacity-80 hover:opacity-100 border-2 border-white'
                  onMouseDown={(e) => {
                    e.stopPropagation();
                    setIsResizing(true);
                    setDragStart({
                      x: e.clientX,
                      y: e.clientY,
                    });
                    setResizeStartSize(overlaySize);
                  }}
                />
              </div>
            )}
          </div>

          {/* Controls */}
          <div className='space-y-4'>
            {/* Image Upload */}
            <div>
              <label className='block text-sm font-medium mb-2'>
                Overlay Image
              </label>
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
            {overlayImageUrl && (
              <div className='space-y-2'>
                <label className='block text-sm font-medium'>Position</label>
                <div className='grid grid-cols-2 gap-2'>
                  <div>
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
                  <div>
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
                </div>
              </div>
            )}

            {/* Size Controls */}
            {overlayImageUrl && (
              <div className='space-y-2'>
                <label className='block text-sm font-medium'>Size</label>
                <div className='grid grid-cols-2 gap-2'>
                  <div>
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
                  <div>
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
                </div>
              </div>
            )}

            {/* Instructions */}
            <div className='text-sm text-gray-600 bg-gray-50 p-3 rounded'>
              <p className='font-medium mb-1'>Instructions:</p>
              <ul className='list-disc list-inside space-y-1'>
                <li>Upload an image to overlay on the video</li>
                <li>Drag the image to position it</li>
                <li>Adjust size and position using the controls</li>
                <li>Click "Apply" to permanently embed the image</li>
              </ul>
            </div>
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
    </div>
  );
};
