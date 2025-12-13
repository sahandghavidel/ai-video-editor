'use client';

import React, { useState, useRef, useCallback, useEffect } from 'react';
import { useAppStore } from '@/store/useAppStore';
import {
  X,
  Upload,
  Loader2,
  RotateCcw,
  Maximize,
  Crop,
  ZoomIn,
  ZoomOut,
  Camera,
  Save,
  List,
  Trash,
  Plus,
  Clock,
  Mic,
  Settings,
} from 'lucide-react';
import { getSceneById } from '@/lib/baserow-actions';
import { Cropper, CropperRef } from 'react-advanced-cropper';
import 'react-advanced-cropper/dist/style.css';

// Helper function to convert hex color to RGB
const hexToRgb = (hex: string) => {
  const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  return result
    ? `${parseInt(result[1], 16)}, ${parseInt(result[2], 16)}, ${parseInt(
        result[3],
        16
      )}`
    : '0, 0, 0';
};

interface ImageOverlayModalProps {
  isOpen: boolean;
  onClose: () => void;
  videoUrl: string;
  sceneId: number;
  onApply: (
    sceneId: number,
    overlayImage: File | null,
    overlayText: string | null,
    position: { x: number; y: number },
    size: { width: number; height: number },
    startTime: number,
    endTime: number,
    textStyling?: TextStyling
  ) => Promise<void>;
  isApplying?: boolean;
  handleTranscribeScene?: (
    sceneId: number,
    sceneData?: any,
    videoType?: 'original' | 'final',
    skipRefresh?: boolean,
    skipSound?: boolean
  ) => Promise<void>;
  onUpdateModalVideoUrl?: (videoUrl: string) => void;
}

type TextStyling = {
  fontColor: string;
  borderWidth: number;
  borderColor: string;
  shadowX: number;
  shadowY: number;
  shadowColor: string;
  shadowOpacity: number;
  fontFamily: string;
  bgColor?: string;
  bgOpacity?: number;
  bgSize?: number;
};

export const ImageOverlayModal: React.FC<ImageOverlayModalProps> = ({
  isOpen,
  onClose,
  videoUrl,
  sceneId,
  onApply,
  isApplying = false,
  handleTranscribeScene,
  onUpdateModalVideoUrl,
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
  const [selectedWordText, setSelectedWordText] = useState<string | null>(null);
  const [customText, setCustomText] = useState<string>('');
  const [textOverlayPosition, setTextOverlayPosition] = useState({
    x: 50,
    y: 80,
  }); // percentage
  const [textOverlaySize, setTextOverlaySize] = useState({
    width: 20,
    height: 10,
  }); // percentage
  const [textStyling, setTextStyling] = useState<TextStyling>(() => {
    // Load default styling from localStorage, or use fallback defaults
    const saved = localStorage.getItem('defaultTextStyling');
    return saved
      ? JSON.parse(saved)
      : {
          fontColor: '#ffffff',
          borderWidth: 3,
          borderColor: '#000000',
          shadowX: 8,
          shadowY: 8,
          shadowColor: '#000000',
          shadowOpacity: 0.9,
          fontFamily: 'Helvetica',
          // Background (box) settings for text overlay
          bgColor: '#000000',
          bgOpacity: 0.65,
          bgSize: 8, // px padding for background around text
        };
  });
  // Saved text styling presets, persisted in localStorage
  const [savedTextStyles, setSavedTextStyles] = useState<
    { name: string; style: typeof textStyling }[]
  >([]);
  const [showSavedStyles, setShowSavedStyles] = useState(false);

  // Load saved styles from localStorage on mount
  useEffect(() => {
    try {
      const stored = localStorage.getItem('savedTextStyles');
      if (stored) {
        console.log('Loading savedTextStyles from localStorage:', stored);
        const parsed = JSON.parse(stored) as {
          name: string;
          style: typeof textStyling;
        }[];
        setSavedTextStyles(parsed);
      }
    } catch (e) {
      console.error('Failed to load saved text styles:', e);
    }
  }, []);

  // Previously we wrote savedTextStyles on every state change, which could
  // overwrite loaded values on mount due to timing; we now only write to
  // localStorage explicitly when saving/deleting presets so we avoid race conditions.

  const saveCurrentTextStyle = useCallback(() => {
    const name = prompt('Enter a name for this text style preset');
    if (!name) return;
    // avoid duplicates
    if (savedTextStyles.some((s) => s.name === name)) {
      alert('A preset with that name already exists');
      return;
    }
    console.log('Saving preset', name, textStyling);
    setSavedTextStyles((prev) => {
      const next = [...prev, { name, style: textStyling }];
      return next;
    });
    try {
      const next = [...savedTextStyles, { name, style: textStyling }];
      localStorage.setItem('savedTextStyles', JSON.stringify(next));
      console.log('Saved preset to localStorage', next);
    } catch (e) {
      console.error('Failed to persist savedTextStyles during save', e);
    }
    setShowSavedStyles(false);
  }, [savedTextStyles, textStyling]);

  const applySavedTextStyle = useCallback(
    (preset: { name: string; style: typeof textStyling }) => {
      setTextStyling(preset.style);
      setShowSavedStyles(false);
    },
    []
  );

  const deleteSavedTextStyle = useCallback((name: string) => {
    if (!confirm(`Delete preset ${name}?`)) return;
    const next = savedTextStyles.filter((s) => s.name !== name);
    setSavedTextStyles(next);
    try {
      localStorage.setItem('savedTextStyles', JSON.stringify(next));
      console.log('Updated localStorage after delete', next);
    } catch (e) {
      console.error('Failed to persist savedTextStyles during delete', e);
    }
  }, []);
  const [isDraggingText, setIsDraggingText] = useState(false);
  const [isResizingText, setIsResizingText] = useState(false);
  const [isTranscribing, setIsTranscribing] = useState(false);
  const [refetchTrigger, setRefetchTrigger] = useState(0);
  const [containerRect, setContainerRect] = useState<{
    width: number;
    height: number;
  } | null>(null);

  // Cropping state
  const [isCropping, setIsCropping] = useState(false);
  const cropperRef = useRef<CropperRef>(null);
  const [originalImageAspectRatio, setOriginalImageAspectRatio] = useState<
    number | null
  >(null);

  // Actual image dimensions in pixels
  const [actualImageDimensions, setActualImageDimensions] = useState<{
    width: number;
    height: number;
  } | null>(null);

  // Store the original video URL when the modal opens
  const [originalVideoUrl, setOriginalVideoUrl] = useState<string | null>(null);

  const videoRef = useRef<HTMLVideoElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const previewVideoRef = useRef<HTMLVideoElement>(null);

  const getVideoContentRect = useCallback(() => {
    const video = videoRef.current;
    if (!video) return null;

    // Use the video element's rect for overlay positioning
    const rect = video.getBoundingClientRect();
    return rect;
  }, []);

  const handleImageUpload = useCallback(
    (event: React.ChangeEvent<HTMLInputElement>) => {
      const file = event.target.files?.[0];
      if (file && file.type.startsWith('image/')) {
        setOverlayImage(file);
        const url = URL.createObjectURL(file);
        setOverlayImageUrl(url);
        // Clear text overlay when adding image
        setSelectedWordText(null);
        setCustomText('');

        // Calculate original aspect ratio
        const img = new Image();
        img.onload = () => {
          const aspectRatio = img.width / img.height;
          setOriginalImageAspectRatio(aspectRatio);
          setActualImageDimensions({ width: img.width, height: img.height });

          // Set overlay size to show image at its actual pixel dimensions
          // Assuming HD video (1920x1080), calculate percentage to show actual size
          const videoWidth = 1920; // Assume HD width
          const videoHeight = 1080; // Assume HD height

          const widthPercent = (img.width / videoWidth) * 100;
          const heightPercent = (img.height / videoHeight) * 100;

          setOverlaySize({
            width: Math.min(widthPercent, 100),
            height: Math.min(heightPercent, 100),
          });
        };
        img.src = url;
      }
    },
    []
  );

  const handleRemoveImage = useCallback(() => {
    setOverlayImage(null);
    setOverlayImageUrl(null);
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  }, []);

  const handleScreenshot = useCallback(() => {
    const video = videoRef.current;
    if (!video) return;

    const canvas = document.createElement('canvas');
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const ctx = canvas.getContext('2d');
    if (ctx) {
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
      canvas.toBlob((blob) => {
        if (blob) {
          const file = new File([blob], 'screenshot.png', {
            type: 'image/png',
          });
          setOverlayImage(file);
          const url = URL.createObjectURL(file);
          setOverlayImageUrl(url);
          // Clear text overlay when adding image
          setSelectedWordText(null);
          setCustomText('');

          // Calculate original aspect ratio
          const aspectRatio = canvas.width / canvas.height;
          setOriginalImageAspectRatio(aspectRatio);
          setActualImageDimensions({
            width: canvas.width,
            height: canvas.height,
          });

          // Set overlay size to show image at its actual pixel dimensions
          // Assuming HD video (1920x1080), calculate percentage to show actual size
          const videoWidth = 1920; // Assume HD width
          const videoHeight = 1080; // Assume HD height

          const widthPercent = (canvas.width / videoWidth) * 100;
          const heightPercent = (canvas.height / videoHeight) * 100;

          setOverlaySize({
            width: Math.min(widthPercent, 100),
            height: Math.min(heightPercent, 100),
          });
        }
      }, 'image/png');
    }
  }, []);

  const applyCrop = useCallback(async () => {
    console.log('applyCrop called');
    if (!cropperRef.current || !overlayImageUrl) {
      console.log('Missing cropperRef.current or overlayImageUrl');
      return;
    }

    const coordinates = cropperRef.current.getCoordinates();
    const canvas = cropperRef.current.getCanvas();

    console.log('Coordinates:', coordinates);
    console.log('Canvas:', canvas);

    if (!coordinates || !canvas) {
      console.log('Missing coordinates or canvas');
      return;
    }

    // Convert canvas to blob
    canvas.toBlob((blob) => {
      if (blob) {
        console.log('Blob created, size:', blob.size);
        const croppedFile = new File([blob], 'cropped-image.png', {
          type: 'image/png',
        });
        const croppedUrl = URL.createObjectURL(croppedFile);

        setOverlayImage(croppedFile);
        setOverlayImageUrl(croppedUrl);

        // Update aspect ratio for the cropped image
        const newAspectRatio = coordinates.width / coordinates.height;
        setOriginalImageAspectRatio(newAspectRatio);
        setActualImageDimensions({
          width: coordinates.width,
          height: coordinates.height,
        });

        // Auto-reset overlay size to cropped image natural size
        setOverlayPosition({ x: 50, y: 50 });
        const videoWidth = 1920; // Assume HD width
        const videoHeight = 1080; // Assume HD height

        const widthPercent = (coordinates.width / videoWidth) * 100;
        const heightPercent = (coordinates.height / videoHeight) * 100;

        setOverlaySize({
          width: Math.min(widthPercent, 100),
          height: Math.min(heightPercent, 100),
        });

        // Reset crop state
        setIsCropping(false);
        console.log('Crop applied successfully');
      } else {
        console.log('Failed to create blob');
      }
    }, 'image/png');
  }, [cropperRef, overlayImageUrl]);

  const handleVideoLoad = useCallback(() => {
    const video = videoRef.current;
    if (video && video.duration) {
      setEndTime(video.duration);

      // Update container rect when video loads
      const rect = getVideoContentRect();
      if (rect) {
        setContainerRect({ width: rect.width, height: rect.height });
      }
    }
  }, [getVideoContentRect]);

  // Ensure video element updates when videoUrl changes
  useEffect(() => {
    const video = videoRef.current;
    if (video && originalVideoUrl && video.src !== originalVideoUrl) {
      video.src = originalVideoUrl;
      video.load();
    }
  }, [originalVideoUrl]);

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

          // Allow free resizing without maintaining aspect ratio
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

  const handleTextMouseDown = useCallback(
    (event: React.PointerEvent) => {
      if (!selectedWordText) return;

      const contentRect = containerRect
        ? {
            width: containerRect.width,
            height: containerRect.height,
            left: 0,
            top: 0,
          }
        : getVideoContentRect();
      if (!contentRect) return;

      const x = event.clientX - contentRect.left;
      const y = event.clientY - contentRect.top;

      // Check if clicking on the text overlay (calculate based on text content using percentages)
      const textWidthPercent = Math.min(
        95,
        (selectedWordText.length <= 3
          ? 35
          : selectedWordText.length <= 7
          ? 55
          : selectedWordText.length <= 12
          ? 70
          : 85) *
          (textOverlaySize.width / 20)
      );
      const textHeightPercent = Math.max(
        10,
        Math.min(85, (textOverlaySize.width / 100) * 60)
      );
      const textX = textOverlayPosition.x - textWidthPercent / 2;
      const textY = textOverlayPosition.y - textHeightPercent / 2;

      // Convert to pixels
      const textX_px = (textX / 100) * contentRect.width;
      const textY_px = (textY / 100) * contentRect.height;
      const textWidth_px = (textWidthPercent / 100) * contentRect.width;
      const textHeight_px = (textHeightPercent / 100) * contentRect.height;

      // Check if clicking near edges/corners for resizing (within 10px of edges)
      const edgeThreshold = 10;
      const nearLeftEdge =
        x >= textX_px - edgeThreshold && x <= textX_px + edgeThreshold;
      const nearRightEdge =
        x >= textX_px + textWidth_px - edgeThreshold &&
        x <= textX_px + textWidth_px + edgeThreshold;
      const nearTopEdge =
        y >= textY_px - edgeThreshold && y <= textY_px + edgeThreshold;
      const nearBottomEdge =
        y >= textY_px + textHeight_px - edgeThreshold &&
        y <= textY_px + textHeight_px + edgeThreshold;

      const isNearEdge =
        nearLeftEdge || nearRightEdge || nearTopEdge || nearBottomEdge;

      if (isNearEdge) {
        // Start resizing - determine resize direction based on which edges are near
        const startX = event.clientX;
        const startY = event.clientY;
        const startSize = { ...textOverlaySize };
        const startPos = { ...textOverlayPosition };
        const pointerId = event.pointerId;

        setIsResizingText(true);

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

          setTextOverlaySize({
            width: Math.min(newWidth, 100),
            height: Math.min(newHeight, 100),
          });

          // Update position if resizing from top/left
          if (nearLeftEdge || nearTopEdge) {
            setTextOverlayPosition({
              x: Math.max(0, Math.min(100, newX)),
              y: Math.max(0, Math.min(100, newY)),
            });
          }
        };

        const handleGlobalPointerUp = () => {
          setIsResizingText(false);
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
        x >= textX_px &&
        x <= textX_px + textWidth_px &&
        y >= textY_px &&
        y <= textY_px + textHeight_px
      ) {
        // Start dragging (center area)
        const startX = event.clientX;
        const startY = event.clientY;
        const startPos = { ...textOverlayPosition };
        const pointerId = event.pointerId;

        setIsDraggingText(true);

        const handleGlobalPointerMove = (e: PointerEvent) => {
          const rect = getVideoContentRect();
          if (!rect) return;

          const deltaX = ((e.clientX - startX) / rect.width) * 100;
          const deltaY = ((e.clientY - startY) / rect.height) * 100;

          setTextOverlayPosition({
            x: Math.max(0, Math.min(100, startPos.x + deltaX)),
            y: Math.max(0, Math.min(100, startPos.y + deltaY)),
          });
        };

        const handleGlobalPointerUp = () => {
          setIsDraggingText(false);
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
    [
      selectedWordText,
      textOverlayPosition,
      textOverlaySize,
      getVideoContentRect,
      containerRect,
    ]
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
    if (!overlayImage && !selectedWordText) return;
    if (!originalVideoUrl) return;
    console.log('handlePreview: textStyling', textStyling);

    const formData = new FormData();
    formData.append('videoUrl', originalVideoUrl);
    formData.append('sceneId', sceneId.toString());
    if (overlayImage) {
      formData.append('overlayImage', overlayImage);
    }
    if (selectedWordText) {
      formData.append('overlayText', selectedWordText);
    }
    formData.append(
      'positionX',
      (overlayImage ? overlayPosition.x : textOverlayPosition.x).toString()
    );
    formData.append(
      'positionY',
      (overlayImage ? overlayPosition.y : textOverlayPosition.y).toString()
    );
    formData.append(
      'sizeWidth',
      (overlayImage ? overlaySize.width : textOverlaySize.width).toString()
    );
    formData.append(
      'sizeHeight',
      (overlayImage ? overlaySize.height : textOverlaySize.height).toString()
    );
    formData.append('startTime', startTime.toString());
    formData.append('endTime', endTime.toString());
    formData.append('preview', 'true');
    if (selectedWordText && textStyling) {
      formData.append('textStyling', JSON.stringify(textStyling));
    }

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
    selectedWordText,
    originalVideoUrl,
    sceneId,
    overlayPosition,
    textOverlayPosition,
    overlaySize,
    textOverlaySize,
    startTime,
    endTime,
    textStyling,
  ]);

  const handleApply = useCallback(async () => {
    if (!overlayImage && !selectedWordText) return;

    try {
      console.log(
        'handleApply: sending textStyling',
        selectedWordText ? textStyling : undefined
      );
      // Apply overlay to the CURRENT video playing in the modal
      await onApply(
        sceneId,
        overlayImage,
        selectedWordText,
        overlayImage ? overlayPosition : textOverlayPosition,
        overlayImage ? overlaySize : textOverlaySize,
        startTime,
        endTime,
        selectedWordText ? textStyling : undefined
      );

      // After applying, fetch the scene from the DB to get the updated video URL
      // Retry a few times in case the DB update hasn't fully propagated
      const maxRetries = 6;
      let attempts = 0;
      let sceneData: any = null;
      let newUrl: string | undefined;
      while (attempts < maxRetries) {
        // eslint-disable-next-line no-await-in-loop
        sceneData = await getSceneById(sceneId);
        newUrl = sceneData?.field_6886 as string | undefined;
        if (newUrl && newUrl !== originalVideoUrl) break;
        // eslint-disable-next-line no-await-in-loop
        await new Promise((res) => setTimeout(res, 500));
        attempts++;
      }

      if (newUrl) {
        setOriginalVideoUrl(newUrl);
        // Notify parent so subsequent applies use the new video URL
        if (onUpdateModalVideoUrl) {
          onUpdateModalVideoUrl(newUrl);
        }
      }

      // Force a refetch of transcription and other modal data
      // but avoid triggering this refetch during batch operations to prevent
      // per-loop data refreshes that lead to UI flicker.
      if (!useAppStore.getState().batchOperations.transcribingAllFinalScenes) {
        setRefetchTrigger((prev) => prev + 1);
      }

      // Reset overlay state to defaults (like opening a fresh modal) but keep it open
      setOverlayImage(null);
      setOverlayImageUrl(null);
      setOverlayPosition({ x: 50, y: 50 });
      setOverlaySize({ width: 40, height: 40 });
      setPreviewUrl(null);
      setSelectedWordText(null);
      setCustomText('');
      setStartTime(0);
      setEndTime(0);
      setIsCropping(false);
      setOriginalImageAspectRatio(null);
      setActualImageDimensions(null);
      setTextOverlayPosition({ x: 50, y: 80 });
      setTextOverlaySize({ width: 20, height: 10 });
      setTextStyling(() => {
        const saved = localStorage.getItem('defaultTextStyling');
        return saved
          ? JSON.parse(saved)
          : {
              fontColor: '#ffffff',
              borderWidth: 3,
              borderColor: '#000000',
              shadowX: 8,
              shadowY: 8,
              shadowColor: '#000000',
              shadowOpacity: 0.9,
              fontFamily: 'Helvetica',
              bgColor: '#000000',
              bgOpacity: 0.65,
              bgSize: 8,
            };
      });
    } catch (error) {
      console.error('Failed to apply overlay and refresh modal:', error);
    }
  }, [
    overlayImage,
    selectedWordText,
    sceneId,
    overlayPosition,
    overlaySize,
    textOverlayPosition,
    textOverlaySize,
    startTime,
    endTime,
    onApply,
    originalVideoUrl,
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
    setSelectedWordText(null);
    setCustomText('');
    setSelectedWordText(null);
  }, [onClose]);

  // Fetch transcription data
  useEffect(() => {
    if (isOpen && sceneId) {
      // Clear any leftover preview state when modal opens
      setPreviewUrl(null);
      // Set the original video URL when we have a valid video URL
      if (videoUrl && videoUrl.trim() !== '') {
        setOriginalVideoUrl(videoUrl);
      }

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
  }, [isOpen, sceneId, refetchTrigger, videoUrl]);

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
        // If an input or editable element is focused, allow the spacebar to
        // insert text rather than control player playback.
        const target = event.target as Element | null;
        if (
          target instanceof HTMLInputElement ||
          target instanceof HTMLTextAreaElement ||
          target instanceof HTMLSelectElement ||
          (target instanceof HTMLElement && target.isContentEditable)
        ) {
          return; // allow normal typing behavior
        }

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

  // Update container dimensions
  useEffect(() => {
    const updateContainerRect = () => {
      const rect = getVideoContentRect();
      if (rect) {
        setContainerRect({ width: rect.width, height: rect.height });
      }
    };

    // Update immediately
    updateContainerRect();

    // Update on window resize
    window.addEventListener('resize', updateContainerRect);
    return () => window.removeEventListener('resize', updateContainerRect);
  }, [getVideoContentRect]);

  // Update container dimensions
  useEffect(() => {
    const updateContainerRect = () => {
      const rect = getVideoContentRect();
      if (rect) {
        setContainerRect({ width: rect.width, height: rect.height });
      }
    };

    // Update immediately
    updateContainerRect();

    // Update on window resize
    window.addEventListener('resize', updateContainerRect);
    return () => window.removeEventListener('resize', updateContainerRect);
  }, [getVideoContentRect]);

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
            {originalVideoUrl ? (
              <video
                key={originalVideoUrl}
                ref={videoRef}
                src={originalVideoUrl}
                className='w-full h-full object-contain rounded border'
                controls
                crossOrigin='anonymous'
                onLoadedMetadata={handleVideoLoad}
              />
            ) : (
              <div className='w-full h-full flex items-center justify-center bg-gray-100 rounded border'>
                <div className='text-gray-500 text-center'>
                  <div className='text-lg mb-2'>📹</div>
                  <div>Loading video...</div>
                </div>
              </div>
            )}
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
                  className='w-full h-full object-contain'
                  draggable={false}
                  onPointerDown={handleMouseDown}
                />
              </div>
            )}
            {selectedWordText && (
              <div
                className='absolute border-2 border-green-500 cursor-move pointer-events-auto z-10 rounded'
                style={{
                  left: `${textOverlayPosition.x}%`,
                  top: `${textOverlayPosition.y}%`,
                  transform: 'translate(-50%, -50%)',
                  width: `${
                    Math.min(
                      95,
                      (selectedWordText.length <= 3
                        ? 35
                        : selectedWordText.length <= 7
                        ? 55
                        : selectedWordText.length <= 12
                        ? 70
                        : 85) *
                        (textOverlaySize.width / 20)
                    ) // Scale with font size
                  }%`,
                  height: `${Math.max(
                    10,
                    Math.min(85, (textOverlaySize.width / 100) * 60)
                  )}%`,
                  fontSize: `${Math.max(
                    8,
                    (textOverlaySize.width / 100) * 120
                  )}px`,
                }}
                onPointerDown={handleTextMouseDown}
              >
                <div
                  className='w-full h-full flex items-center justify-center font-bold select-none whitespace-nowrap'
                  style={{
                    color: textStyling.fontColor,
                    textShadow: `${textStyling.shadowX}px ${
                      textStyling.shadowY
                    }px 0px rgba(${hexToRgb(textStyling.shadowColor)}, ${
                      textStyling.shadowOpacity
                    })`,
                    WebkitTextStroke:
                      textStyling.borderWidth > 0
                        ? `${textStyling.borderWidth}px ${textStyling.borderColor}`
                        : 'none',
                    fontWeight: 'bold',
                    fontFamily: textStyling.fontFamily,
                    backgroundColor: textStyling.bgColor
                      ? `rgba(${hexToRgb(textStyling.bgColor)}, ${
                          textStyling.bgOpacity ?? 1
                        })`
                      : undefined,
                    padding: textStyling.bgSize
                      ? `${textStyling.bgSize}px`
                      : undefined,
                    borderRadius: textStyling.bgSize ? '4px' : undefined,
                  }}
                >
                  {selectedWordText}
                </div>
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
              <div className='flex items-center space-x-2'>
                <button
                  onClick={() => fileInputRef.current?.click()}
                  className='flex items-center justify-center px-2 py-2 border border-gray-300 rounded hover:bg-gray-50 h-10 w-10'
                  title={overlayImage ? 'Change Image' : 'Upload Image'}
                  aria-label={overlayImage ? 'Change Image' : 'Upload Image'}
                >
                  <Upload className='h-4 w-4' />
                </button>
                <button
                  onClick={handleScreenshot}
                  className='flex items-center justify-center px-2 py-2 border border-gray-300 rounded hover:bg-gray-50 h-10 w-10'
                  title='Take screenshot from video'
                  aria-label='Take screenshot from video'
                >
                  <Camera className='h-4 w-4' />
                </button>
                {overlayImage && (
                  <button
                    onClick={handleRemoveImage}
                    className='flex items-center justify-center px-2 py-2 border border-red-300 text-red-600 rounded hover:bg-red-50 hover:border-red-400 h-10 w-10'
                    title='Remove image'
                    aria-label='Remove image'
                  >
                    <X className='h-4 w-4' />
                  </button>
                )}
                {overlayImage && (
                  <p className='text-xs text-gray-600 ml-2 truncate max-w-[180px]'>
                    {overlayImage.name}
                  </p>
                )}
              </div>
              {/* Filename is shown inline next to the icons; duplicate bottom filename removed */}
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
                      Image Width (px)
                    </label>
                    <input
                      type='number'
                      value={actualImageDimensions?.width || 0}
                      readOnly
                      className='w-full px-2 py-1 border border-gray-300 rounded text-sm bg-gray-50'
                    />
                  </div>
                  <div className='flex-1'>
                    <label className='block text-xs text-gray-600'>
                      Image Height (px)
                    </label>
                    <input
                      type='number'
                      value={actualImageDimensions?.height || 0}
                      readOnly
                      className='w-full px-2 py-1 border border-gray-300 rounded text-sm bg-gray-50'
                    />
                  </div>
                </div>
                <div className='flex gap-2 items-end w-full'>
                  <div className='flex-1'>
                    <label className='block text-xs text-gray-600'>
                      Overlay Width (%)
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
                      Overlay Height (%)
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
                        // Reset to actual image size
                        if (actualImageDimensions) {
                          const videoWidth = 1920; // Assume HD width
                          const videoHeight = 1080; // Assume HD height

                          const widthPercent =
                            (actualImageDimensions.width / videoWidth) * 100;
                          const heightPercent =
                            (actualImageDimensions.height / videoHeight) * 100;

                          setOverlaySize({
                            width: Math.min(widthPercent, 100),
                            height: Math.min(heightPercent, 100),
                          });
                        } else {
                          setOverlaySize({ width: 25, height: 25 });
                        }
                      }}
                      className='px-1 py-1 border border-gray-300 rounded hover:bg-gray-50 text-gray-600 hover:text-gray-800 h-8 flex items-center justify-center'
                      title='Center and reset to natural size'
                    >
                      <RotateCcw className='h-3 w-3' />
                    </button>
                  </div>
                  <div className='flex-shrink-0 mt-4'>
                    <button
                      onClick={() => {
                        setOverlayPosition({ x: 50, y: 50 });
                        // Maximize to fill video
                        setOverlaySize({ width: 100, height: 100 });
                      }}
                      className='px-1 py-1 border border-gray-300 rounded hover:bg-gray-50 text-gray-600 hover:text-gray-800 h-8 flex items-center justify-center'
                      title='Center and maximize size'
                    >
                      <Maximize className='h-3 w-3' />
                    </button>
                  </div>
                  <div className='flex-shrink-0 mt-4'>
                    <button
                      onClick={() => {
                        setIsCropping(true);
                      }}
                      className='px-1 py-1 border border-gray-300 rounded hover:bg-gray-50 text-gray-600 hover:text-gray-800 h-8 flex items-center justify-center'
                      title='Crop image'
                    >
                      <Crop className='h-3 w-3' />
                    </button>
                  </div>
                  <div className='flex-shrink-0 mt-4'>
                    <button
                      onClick={() => {
                        // Zoom out - scale both dimensions by 0.9 (10% smaller)
                        setOverlaySize((prev) => ({
                          width: Math.max(5, prev.width * 0.9),
                          height: Math.max(5, prev.height * 0.9),
                        }));
                      }}
                      className='px-1 py-1 border border-gray-300 rounded hover:bg-gray-50 text-gray-600 hover:text-gray-800 h-8 flex items-center justify-center'
                      title='Zoom out (scale down 10%)'
                    >
                      <ZoomOut className='h-3 w-3' />
                    </button>
                  </div>
                  <div className='flex-shrink-0 mt-4'>
                    <button
                      onClick={() => {
                        // Zoom in - scale both dimensions by 1.1 (10% larger)
                        setOverlaySize((prev) => ({
                          width: Math.min(100, prev.width * 1.1),
                          height: Math.min(100, prev.height * 1.1),
                        }));
                      }}
                      className='px-1 py-1 border border-gray-300 rounded hover:bg-gray-50 text-gray-600 hover:text-gray-800 h-8 flex items-center justify-center'
                      title='Zoom in (scale up 10%)'
                    >
                      <ZoomIn className='h-3 w-3' />
                    </button>
                  </div>
                </div>
              </div>
            )}

            {/* Timing Controls */}
            {(overlayImageUrl || selectedWordText) && (
              <div className='bg-gray-50 p-2 rounded-lg border border-gray-200'>
                <span className='sr-only'>Timing</span>
                <div className='grid grid-cols-2 gap-2'>
                  <div>
                    <label className='sr-only'>Start Time (s)</label>
                    <div className='flex gap-2'>
                      <input
                        type='number'
                        value={startTime}
                        onChange={(e) => setStartTime(Number(e.target.value))}
                        className='w-full px-2 py-1 border border-gray-300 rounded text-sm bg-white'
                        min='0'
                        step='0.1'
                        placeholder='Start s'
                      />
                      <button
                        onClick={() => {
                          const video = videoRef.current;
                          if (video) {
                            setStartTime(video.currentTime);
                          }
                        }}
                        className='px-2 py-1 text-sm bg-blue-500 text-white rounded hover:bg-blue-600 h-8 w-8 flex items-center justify-center'
                        title='Set start to current video time'
                        aria-label='Set start to current video time'
                      >
                        <Clock className='h-4 w-4' />
                      </button>
                    </div>
                  </div>
                  <div>
                    <label className='sr-only'>End Time (s)</label>
                    <div className='flex gap-2'>
                      <input
                        type='number'
                        value={endTime}
                        onChange={(e) => setEndTime(Number(e.target.value))}
                        className='w-full px-2 py-1 border border-gray-300 rounded text-sm bg-white'
                        min='0'
                        step='0.1'
                        placeholder='End s'
                      />
                      <button
                        onClick={() => {
                          const video = videoRef.current;
                          if (video) {
                            setEndTime(video.currentTime);
                          }
                        }}
                        className='px-2 py-1 text-sm bg-blue-500 text-white rounded hover:bg-blue-600 h-8 w-8 flex items-center justify-center'
                        title='Set end to current video time'
                        aria-label='Set end to current video time'
                      >
                        <Clock className='h-4 w-4' />
                      </button>
                    </div>
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
                          setCustomText(wordData.word); // Add word to input field instead of directly selecting it
                          // Also seek the video to this time
                          if (videoRef.current) {
                            videoRef.current.currentTime = wordData.start;
                          }
                        }}
                        className={`px-3 py-1.5 text-sm font-medium rounded transition-colors bg-white text-gray-700 border border-gray-300 hover:bg-blue-50 hover:border-blue-300`}
                        title={`Click to set start time to ${wordData.start}s`}
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
                    onChange={(e) => setCustomText(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        // Prevent default 'Enter' behavior (like form submit)
                        e.preventDefault();
                        if (customText.trim()) {
                          setSelectedWordText(customText.trim());
                          // Clear image overlay when adding text
                          setOverlayImage(null);
                          setOverlayImageUrl(null);
                          if (fileInputRef.current) {
                            fileInputRef.current.value = '';
                          }
                        }
                      }
                    }}
                    placeholder='Enter custom text for overlay...'
                    className='w-2/3 px-3 py-2 text-sm border border-gray-300 rounded focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent'
                  />
                  <button
                    onClick={() => {
                      if (customText.trim()) {
                        setSelectedWordText(customText.trim());
                        // Clear image overlay when adding text
                        setOverlayImage(null);
                        setOverlayImageUrl(null);
                        if (fileInputRef.current) {
                          fileInputRef.current.value = '';
                        }
                      }
                    }}
                    disabled={!customText.trim()}
                    className='p-2 bg-green-600 text-white rounded hover:bg-green-700 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center'
                    aria-label='Add text as overlay'
                  >
                    <Plus className='h-4 w-4' />
                  </button>
                  {/* Insert All Text into input */}
                  <button
                    onClick={() => {
                      if (transcriptionWords && transcriptionWords.length > 0) {
                        const allText = transcriptionWords
                          .map((w) => w.word)
                          .join(' ');
                        setCustomText(allText);
                      }
                    }}
                    disabled={
                      !transcriptionWords ||
                      transcriptionWords.length === 0 ||
                      customText.trim() ===
                        (transcriptionWords || [])
                          .map((w) => w.word)
                          .join(' ')
                          .trim()
                    }
                    className='p-2 bg-gray-100 text-gray-700 rounded border border-gray-300 hover:bg-gray-200 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center'
                    aria-label='Insert full transcription'
                    title='Insert full transcription into the input field'
                  >
                    <List className='h-4 w-4' />
                  </button>
                  {/* Retranscribe Button - visible when a transcription handler is present */}
                  {handleTranscribeScene && (
                    <button
                      onClick={async () => {
                        setIsTranscribing(true);
                        try {
                          await handleTranscribeScene(
                            sceneId,
                            undefined,
                            'final'
                          );
                          // Refetch transcription after transcribing (guarded for batch)
                          if (
                            !useAppStore.getState().batchOperations
                              .transcribingAllFinalScenes
                          ) {
                            setRefetchTrigger((prev) => prev + 1);
                          }
                        } catch (error) {
                          console.error('Failed to retranscribe:', error);
                        } finally {
                          setIsTranscribing(false);
                        }
                      }}
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
                        // but skip during batch to avoid per-loop refetch
                        if (
                          !useAppStore.getState().batchOperations
                            .transcribingAllFinalScenes
                        ) {
                          setRefetchTrigger((prev) => prev + 1);
                        }
                      } catch (error) {
                        console.error('Failed to transcribe:', error);
                      } finally {
                        setIsTranscribing(false);
                      }
                    }}
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
                    {/* keep sr-only text for accessibility */}
                    <span className='sr-only'>
                      {isTranscribing
                        ? 'Transcribing...'
                        : 'Transcribe Final Video'}
                    </span>
                  </button>
                </div>
              )
            )}

            {/* Text Position and Size Controls */}
            {selectedWordText && (
              <div className='space-y-2'>
                <div className='flex gap-2 items-end w-full'>
                  <div className='flex-1'>
                    <label className='block text-xs text-gray-600'>X (%)</label>
                    <input
                      type='number'
                      value={textOverlayPosition.x}
                      onChange={(e) =>
                        setTextOverlayPosition((prev) => ({
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
                      value={textOverlayPosition.y}
                      onChange={(e) =>
                        setTextOverlayPosition((prev) => ({
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
                      Font Size (%)
                    </label>
                    <input
                      type='number'
                      value={textOverlaySize.width}
                      onChange={(e) =>
                        setTextOverlaySize((prev) => ({
                          ...prev,
                          width: Number(e.target.value),
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
                        setTextOverlayPosition({ x: 50, y: 80 });
                        setTextOverlaySize({ width: 20, height: 10 });
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
                        setTextOverlayPosition({ x: 50, y: 50 });
                        setTextOverlaySize({ width: 100, height: 100 });
                      }}
                      className='px-1 py-1 border border-gray-300 rounded hover:bg-gray-50 text-gray-600 hover:text-gray-800 h-8 flex items-center justify-center'
                      title='Center and maximize size'
                    >
                      <Maximize className='h-3 w-3' />
                    </button>
                  </div>
                </div>

                {/* Text Styling Controls */}
                <div className='space-y-1 mt-2'>
                  <div className='flex items-center gap-2 mb-2'>
                    <Settings className='h-4 w-4 text-gray-600' />
                    <span className='sr-only'>Text Styling</span>
                  </div>
                  <div className='flex flex-wrap gap-1 items-end'>
                    <div className='flex flex-col'>
                      <label className='sr-only'>Font</label>
                      <select
                        value={textStyling.fontFamily}
                        onChange={(e) =>
                          setTextStyling((prev) => ({
                            ...prev,
                            fontFamily: e.target.value,
                          }))
                        }
                        className='w-20 px-1 py-0.5 border border-gray-300 rounded text-xs'
                      >
                        <option value='Helvetica'>Helvetica</option>
                        <option value='ArialHB'>Arial</option>
                        <option value='Courier'>Courier</option>
                        <option value='Geneva'>Geneva</option>
                        <option value='Times'>Times</option>
                      </select>
                    </div>
                    <div className='flex flex-col'>
                      <label className='sr-only'>Color</label>
                      <input
                        type='color'
                        value={textStyling.fontColor}
                        onChange={(e) =>
                          setTextStyling((prev) => ({
                            ...prev,
                            fontColor: e.target.value,
                          }))
                        }
                        className='w-12 h-6 border border-gray-300 rounded cursor-pointer'
                      />
                    </div>
                    <div className='flex flex-col'>
                      <label className='sr-only'>Border</label>
                      <div className='flex gap-1'>
                        <input
                          type='number'
                          value={textStyling.borderWidth}
                          onChange={(e) =>
                            setTextStyling((prev) => ({
                              ...prev,
                              borderWidth: Number(e.target.value),
                            }))
                          }
                          className='w-12 px-1 py-0.5 border border-gray-300 rounded text-xs'
                          min='0'
                          max='10'
                        />
                        <input
                          type='color'
                          value={textStyling.borderColor}
                          onChange={(e) =>
                            setTextStyling((prev) => ({
                              ...prev,
                              borderColor: e.target.value,
                            }))
                          }
                          className='w-6 h-6 border border-gray-300 rounded cursor-pointer'
                        />
                      </div>
                    </div>
                    <div className='flex flex-col'>
                      <label className='sr-only'>Shadow XY</label>
                      <div className='flex gap-1'>
                        <input
                          type='number'
                          value={textStyling.shadowX}
                          onChange={(e) =>
                            setTextStyling((prev) => ({
                              ...prev,
                              shadowX: Number(e.target.value),
                            }))
                          }
                          className='w-10 px-1 py-0.5 border border-gray-300 rounded text-xs'
                          min='0'
                          max='20'
                          placeholder='X'
                        />
                        <input
                          type='number'
                          value={textStyling.shadowY}
                          onChange={(e) =>
                            setTextStyling((prev) => ({
                              ...prev,
                              shadowY: Number(e.target.value),
                            }))
                          }
                          className='w-10 px-1 py-0.5 border border-gray-300 rounded text-xs'
                          min='0'
                          max='20'
                          placeholder='Y'
                        />
                      </div>
                    </div>
                    <div className='flex flex-col'>
                      <label className='sr-only'>Opacity</label>
                      <input
                        type='number'
                        value={textStyling.shadowOpacity}
                        onChange={(e) =>
                          setTextStyling((prev) => ({
                            ...prev,
                            shadowOpacity: Number(e.target.value),
                          }))
                        }
                        className='w-12 px-1 py-0.5 border border-gray-300 rounded text-xs'
                        min='0'
                        max='1'
                        step='0.1'
                      />
                    </div>
                    <div className='flex flex-col'>
                      <label className='sr-only'>Shadow</label>
                      <input
                        type='color'
                        value={textStyling.shadowColor}
                        onChange={(e) =>
                          setTextStyling((prev) => ({
                            ...prev,
                            shadowColor: e.target.value,
                          }))
                        }
                        className='w-12 h-6 border border-gray-300 rounded cursor-pointer'
                      />
                    </div>
                    <div className='flex flex-col'>
                      <label className='sr-only'>BG Color</label>
                      <input
                        type='color'
                        value={textStyling.bgColor ?? '#000000'}
                        onChange={(e) =>
                          setTextStyling((prev) => ({
                            ...prev,
                            bgColor: e.target.value,
                          }))
                        }
                        className='w-12 h-6 border border-gray-300 rounded cursor-pointer'
                      />
                    </div>
                    <div className='flex flex-col'>
                      <label className='sr-only'>BG Opacity</label>
                      <input
                        type='number'
                        value={textStyling.bgOpacity ?? 0.65}
                        onChange={(e) =>
                          setTextStyling((prev) => ({
                            ...prev,
                            bgOpacity: Number(e.target.value),
                          }))
                        }
                        className='w-20 px-1 py-0.5 border border-gray-300 rounded text-xs'
                        min={0}
                        max={1}
                        step={0.05}
                      />
                    </div>
                    <div className='flex flex-col'>
                      <label className='sr-only'>BG Size</label>
                      <input
                        type='number'
                        value={textStyling.bgSize ?? 8}
                        onChange={(e) =>
                          setTextStyling((prev) => ({
                            ...prev,
                            bgSize: Number(e.target.value),
                          }))
                        }
                        className='w-20 px-1 py-0.5 border border-gray-300 rounded text-xs'
                        min={0}
                        max={200}
                      />
                    </div>
                    <button
                      onClick={() => {
                        const saved =
                          localStorage.getItem('defaultTextStyling');
                        setTextStyling(
                          saved
                            ? JSON.parse(saved)
                            : {
                                fontColor: '#ffffff',
                                borderWidth: 3,
                                borderColor: '#000000',
                                shadowX: 8,
                                shadowY: 8,
                                shadowColor: '#000000',
                                shadowOpacity: 0.9,
                                fontFamily: 'Helvetica',
                                bgColor: '#000000',
                                bgOpacity: 0.65,
                                bgSize: 8,
                              }
                        );
                      }}
                      className='flex items-center justify-center px-2 py-1 text-sm bg-gray-500 text-white rounded hover:bg-gray-600 h-8'
                    >
                      <RotateCcw className='h-4 w-4' />
                    </button>
                    <button
                      onClick={() => {
                        localStorage.setItem(
                          'defaultTextStyling',
                          JSON.stringify(textStyling)
                        );
                        alert('Text styling saved as default!');
                      }}
                      className='flex items-center justify-center px-2 py-1 text-sm bg-blue-500 text-white rounded hover:bg-blue-600 h-8'
                    >
                      <Save className='h-4 w-4' />
                    </button>
                    <button
                      onClick={saveCurrentTextStyle}
                      className='flex items-center justify-center px-2 py-1 text-sm bg-green-500 text-white rounded hover:bg-green-600 h-8'
                      title='Save text styling as preset'
                    >
                      <Save className='h-4 w-4' />
                      <span className='sr-only'>Save</span>
                    </button>
                    <div className='relative'>
                      <button
                        onClick={() => setShowSavedStyles((s) => !s)}
                        className='flex items-center gap-1 justify-center px-2 py-1 text-sm bg-gray-100 border border-gray-300 rounded hover:bg-gray-200 h-8'
                        title='Saved presets'
                      >
                        <List className='h-4 w-4' />
                        <span className='sr-only'>Presets</span>
                        <span className='ml-1 inline-flex items-center justify-center bg-gray-200 text-xs rounded-full w-5 h-5'>
                          {savedTextStyles.length}
                        </span>
                      </button>
                      {showSavedStyles && (
                        <div className='absolute z-10 right-0 mt-1 bg-white border rounded shadow-md w-56 p-2'>
                          {savedTextStyles.length === 0 ? (
                            <div className='text-xs text-gray-500'>
                              No presets saved
                            </div>
                          ) : (
                            <ul className='space-y-1'>
                              {savedTextStyles.map((s) => (
                                <li
                                  key={s.name}
                                  className='flex items-center justify-between'
                                >
                                  <button
                                    onClick={() => applySavedTextStyle(s)}
                                    className='text-sm text-left text-gray-700 hover:text-black w-full'
                                  >
                                    {s.name}
                                  </button>
                                  <button
                                    onClick={() => deleteSavedTextStyle(s.name)}
                                    className='text-red-500 hover:text-red-700 ml-2'
                                    title='Delete preset'
                                  >
                                    <Trash className='h-4 w-4' />
                                  </button>
                                </li>
                              ))}
                            </ul>
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              </div>
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
            disabled={!(overlayImage || selectedWordText) || isApplying}
            className='px-4 py-2 bg-green-600 text-white rounded hover:bg-green-700 disabled:opacity-50 disabled:cursor-not-allowed'
          >
            Preview
          </button>
          <button
            onClick={handleApply}
            disabled={!(overlayImage || selectedWordText) || isApplying}
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

      {/* Cropping Modal */}
      {isCropping && overlayImageUrl && (
        <div className='fixed inset-0 bg-black bg-opacity-75 flex items-center justify-center z-[60]'>
          <div className='bg-white rounded-lg p-6 max-w-4xl max-h-[90vh] w-full mx-4'>
            <div className='flex justify-between items-center mb-4'>
              <h3 className='text-lg font-semibold'>Crop Image</h3>
              <button
                onClick={() => {
                  setIsCropping(false);
                }}
                className='p-1 hover:bg-gray-100 rounded'
              >
                <X className='h-5 w-5' />
              </button>
            </div>
            <div className='flex flex-col items-center space-y-4'>
              <div className='flex space-x-4 w-full'>
                {/* Crop Selection */}
                <div className='flex-1'>
                  <h4 className='text-sm font-medium mb-2'>Select Crop Area</h4>
                  <div className='max-h-[50vh] overflow-auto border rounded'>
                    <div
                      className='relative h-96 w-full border bg-gray-100'
                      style={{ minHeight: '384px' }}
                    >
                      <Cropper
                        key={overlayImageUrl}
                        src={overlayImageUrl}
                        ref={cropperRef}
                        className={'w-full h-full'}
                        style={{
                          height: '100%',
                          width: '100%',
                          backgroundColor: '#f3f4f6',
                        }}
                        stencilProps={{
                          aspectRatio: undefined,
                        }}
                        checkOrientation={false}
                        onReady={() => {
                          console.log(
                            'Cropper ready, ref:',
                            cropperRef.current
                          );
                        }}
                      />
                    </div>
                  </div>
                </div>
              </div>
              <div className='flex space-x-2'>
                <button
                  onClick={() => {
                    setIsCropping(false);
                  }}
                  className='px-4 py-2 border border-gray-300 rounded hover:bg-gray-50'
                >
                  Cancel
                </button>
                <button
                  onClick={async () => {
                    console.log(
                      'Apply crop clicked, cropperRef.current:',
                      cropperRef.current
                    );
                    console.log('overlayImage:', overlayImage);
                    if (cropperRef.current && overlayImage) {
                      console.log('Calling applyCrop');
                      await applyCrop();
                    } else {
                      console.log('Conditions not met for applyCrop');
                    }
                  }}
                  className='px-4 py-2 bg-blue-500 text-white rounded hover:bg-blue-600'
                  disabled={!overlayImage}
                >
                  Apply Crop
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

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
              crossOrigin='anonymous'
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
