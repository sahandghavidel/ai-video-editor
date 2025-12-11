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
  const [overlaySize, setOverlaySize] = useState({ width: 200, height: 200 }); // pixels
  const [isDragging, setIsDragging] = useState(false);
  const [isResizing, setIsResizing] = useState(false);
  const [dragStart, setDragStart] = useState({ x: 0, y: 0 });

  const videoRef = useRef<HTMLVideoElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

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

      const rect = videoRef.current?.getBoundingClientRect();
      if (!rect) return;

      const x = event.clientX - rect.left;
      const y = event.clientY - rect.top;

      // Check if clicking on the overlay image
      const overlayX =
        (overlayPosition.x / 100) * rect.width - overlaySize.width / 2;
      const overlayY =
        (overlayPosition.y / 100) * rect.height - overlaySize.height / 2;

      if (
        x >= overlayX &&
        x <= overlayX + overlaySize.width &&
        y >= overlayY &&
        y <= overlayY + overlaySize.height
      ) {
        setIsDragging(true);
        setDragStart({
          x: event.clientX - overlayPosition.x,
          y: event.clientY - overlayPosition.y,
        });
      }
    },
    [overlayImageUrl, overlayPosition, overlaySize]
  );

  const handleMouseMove = useCallback(
    (event: React.MouseEvent) => {
      if (isDragging) {
        const rect = videoRef.current?.getBoundingClientRect();
        if (!rect) return;

        const newX = ((event.clientX - dragStart.x) / rect.width) * 100;
        const newY = ((event.clientY - dragStart.y) / rect.height) * 100;

        setOverlayPosition({
          x: Math.max(0, Math.min(100, newX)),
          y: Math.max(0, Math.min(100, newY)),
        });
      }
    },
    [isDragging, dragStart]
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
      setOverlaySize({ width: 200, height: 200 });
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
    setOverlaySize({ width: 200, height: 200 });
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
          <div className='relative'>
            <video
              ref={videoRef}
              src={videoUrl}
              className='w-full rounded border'
              controls
              onMouseDown={handleMouseDown}
              onMouseMove={handleMouseMove}
              onMouseUp={handleMouseUp}
              onMouseLeave={handleMouseUp}
            />
            {overlayImageUrl && (
              <div
                className='absolute border-2 border-blue-500 cursor-move'
                style={{
                  left: `calc(${overlayPosition.x}% - ${
                    overlaySize.width / 2
                  }px)`,
                  top: `calc(${overlayPosition.y}% - ${
                    overlaySize.height / 2
                  }px)`,
                  width: `${overlaySize.width}px`,
                  height: `${overlaySize.height}px`,
                }}
              >
                <img
                  src={overlayImageUrl}
                  alt='Overlay'
                  className='w-full h-full object-cover'
                  draggable={false}
                />
                {/* Resize handle */}
                <div className='absolute bottom-0 right-0 w-4 h-4 bg-blue-500 cursor-se-resize' />
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
                      Width (px)
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
                      min='50'
                      max='1000'
                    />
                  </div>
                  <div>
                    <label className='block text-xs text-gray-600'>
                      Height (px)
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
                      min='50'
                      max='1000'
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
