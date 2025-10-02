'use client';

import React, { useState, useEffect, useRef } from 'react';
import {
  BaserowRow,
  getOriginalVideosData,
  updateOriginalVideoRow,
  deleteOriginalVideoWithScenes,
  getBaserowData,
} from '@/lib/baserow-actions';
import { useAppStore } from '@/store/useAppStore';
import {
  Loader2,
  Video,
  RefreshCw,
  ExternalLink,
  CheckCircle,
  Clock,
  AlertCircle,
  X,
  Check,
  Edit3,
  Save,
  GripVertical,
  Plus,
  Trash2,
  Subtitles,
  Grid3x3,
  Volume2,
  Mic,
  Upload,
} from 'lucide-react';
import TranscriptionModelSelection from './TranscriptionModelSelection';
import MergedVideoDisplay from './MergedVideoDisplay';
import FinalVideoTable from './FinalVideoTable';
import { playSuccessSound, playErrorSound } from '@/utils/soundManager';
import {
  handleImproveAllSentencesForAllVideos,
  handleGenerateAllTTSForAllVideos as generateAllTTSForAllVideosUtil,
} from '@/utils/batchOperations';
import { Sparkles, Mic2 } from 'lucide-react';

interface SceneHandlers {
  handleSentenceImprovement: (
    sceneId: number,
    sentence: string,
    model?: string
  ) => Promise<void>;
  handleTTSProduce: (sceneId: number, text: string) => Promise<void>;
  handleVideoGenerate: (
    sceneId: number,
    videoUrl: string,
    audioUrl: string
  ) => Promise<void>;
}

interface OriginalVideosListProps {
  sceneHandlers?: SceneHandlers | null;
}

export default function OriginalVideosList({
  sceneHandlers,
}: OriginalVideosListProps) {
  const [originalVideos, setOriginalVideos] = useState<BaserowRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [editingTitle, setEditingTitle] = useState<{
    videoId: number;
    value: string;
    saving: boolean;
  } | null>(null);
  const [draggedRow, setDraggedRow] = useState<number | null>(null);
  const [dragOverRow, setDragOverRow] = useState<number | null>(null);
  const [reordering, setReordering] = useState(false);
  const [deleting, setDeleting] = useState<number | null>(null);
  const [transcribing, setTranscribing] = useState<number | null>(null);
  const [transcribingAll, setTranscribingAll] = useState(false);
  const [generatingScenes, setGeneratingScenes] = useState<number | null>(null);
  const [generatingScenesAll, setGeneratingScenesAll] = useState(false);
  const [normalizing, setNormalizing] = useState<number | null>(null);
  const [mergingFinalVideos, setMergingFinalVideos] = useState(false);
  const [generatingTimestamps, setGeneratingTimestamps] = useState(false);
  const [timestampData, setTimestampData] = useState<string>('');
  const [improvingAllVideosScenes, setImprovingAllVideosScenes] =
    useState(false);
  const [currentProcessingVideoId, setCurrentProcessingVideoId] = useState<
    number | null
  >(null);
  const [generatingAllTTSForAllVideos, setGeneratingAllTTSForAllVideos] =
    useState(false);

  // Get clip generation state from global store
  const {
    clipGeneration,
    setGeneratingClips: setGeneratingClipsGlobal,
    setClipsProgress: setClipsProgressGlobal,
    clearClipGeneration,
    setMergedVideo,
  } = useAppStore();
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Global state
  const {
    selectedOriginalVideo,
    setSelectedOriginalVideo,
    saveSettingsToLocalStorage,
    loadSettingsFromLocalStorage,
    getFilteredData,
    mergedVideo,
    clearMergedVideo,
    transcriptionSettings,
    data: allScenesData,
    modelSelection,
    sceneLoading,
    setImprovingSentence,
    setCurrentlyProcessingVideo,
    batchOperations,
    startBatchOperation,
    completeBatchOperation,
    setProducingTTS,
  } = useAppStore();

  useEffect(() => {
    // Load settings from localStorage on mount
    loadSettingsFromLocalStorage();
  }, [loadSettingsFromLocalStorage]);

  // Refresh the original videos list when a merged video is saved
  useEffect(() => {
    if (mergedVideo.url && selectedOriginalVideo.id) {
      // Small delay to ensure the database update is complete
      const timer = setTimeout(() => {
        fetchOriginalVideos(true);
      }, 1000);

      return () => clearTimeout(timer);
    }
  }, [mergedVideo.url, selectedOriginalVideo.id]);

  // Load timestamp data from localStorage on mount
  useEffect(() => {
    const savedTimestampData = localStorage.getItem('final-video-data');
    if (savedTimestampData) {
      try {
        const parsedData = JSON.parse(savedTimestampData);
        // Handle both old string format and new object format
        if (typeof parsedData === 'string') {
          setTimestampData(parsedData);
        } else if (parsedData && parsedData.timestamp) {
          setTimestampData(parsedData.timestamp);
        }
      } catch (error) {
        // If parsing fails, treat as old string format
        setTimestampData(savedTimestampData);
      }
    }
  }, []);

  // Helper function to extract value from Baserow field
  const extractFieldValue = (field: any): string => {
    if (!field) return '';

    // If it's already a string, return it
    if (typeof field === 'string') return field;

    // If it's an array, join with commas
    if (Array.isArray(field)) {
      return field
        .map((item) => {
          if (typeof item === 'object' && item !== null) {
            // Try to extract meaningful value from object
            return (
              item.value ||
              item.name ||
              item.text ||
              item.title ||
              JSON.stringify(item)
            );
          }
          return String(item);
        })
        .join(', ');
    }

    // If it's an object, try to extract meaningful value
    if (typeof field === 'object' && field !== null) {
      // Common Baserow field patterns
      if (field.url) return field.url;
      if (field.value) return field.value;
      if (field.name) return field.name;
      if (field.text) return field.text;
      if (field.title) return field.title;

      // If none of the above, convert to string
      return JSON.stringify(field);
    }

    return String(field);
  };

  // Helper function to extract and format scenes
  const extractScenes = (field: any): { count: number; scenes: string[] } => {
    if (!field) return { count: 0, scenes: [] };

    let sceneList: string[] = [];

    // If it's already a string with comma-separated values
    if (typeof field === 'string') {
      sceneList = field
        .split(',')
        .map((s) => s.trim())
        .filter((s) => s.length > 0);
    }
    // If it's an array
    else if (Array.isArray(field)) {
      sceneList = field
        .map((item) => {
          if (typeof item === 'object' && item !== null) {
            return (
              item.value || item.name || item.text || item.title || String(item)
            );
          }
          return String(item);
        })
        .filter((s) => s.length > 0);
    }
    // If it's an object, try to extract meaningful value
    else if (typeof field === 'object' && field !== null) {
      const value =
        field.value ||
        field.name ||
        field.text ||
        field.title ||
        JSON.stringify(field);
      sceneList = String(value)
        .split(',')
        .map((s) => s.trim())
        .filter((s) => s.length > 0);
    } else {
      sceneList = String(field)
        .split(',')
        .map((s) => s.trim())
        .filter((s) => s.length > 0);
    }

    return { count: sceneList.length, scenes: sceneList };
  };

  // Helper function to extract URL from field
  const extractUrl = (field: any): string | null => {
    if (!field) return null;

    // If it's a string that looks like a URL
    if (
      typeof field === 'string' &&
      (field.startsWith('http') || field.startsWith('/'))
    ) {
      return field;
    }

    // If it's an object with url property
    if (typeof field === 'object' && field !== null) {
      if (field.url) return field.url;
      if (field.file && field.file.url) return field.file.url;
    }

    // If it's an array, get the first URL
    if (Array.isArray(field) && field.length > 0) {
      const firstItem = field[0];
      if (typeof firstItem === 'string' && firstItem.startsWith('http')) {
        return firstItem;
      }
      if (typeof firstItem === 'object' && firstItem !== null) {
        if (firstItem.url) return firstItem.url;
        if (firstItem.file && firstItem.file.url) return firstItem.file.url;
      }
    }

    return null;
  };

  // Helper function to check if video has scenes
  const hasScenes = (video: BaserowRow): boolean => {
    const scenesField = video.field_6866; // Scenes field
    if (!scenesField) return false;

    // If it's an array and has items
    if (Array.isArray(scenesField) && scenesField.length > 0) {
      return true;
    }

    // If it's a number (single scene ID)
    if (typeof scenesField === 'number') {
      return true;
    }

    // If it's a string with content
    if (typeof scenesField === 'string' && scenesField.trim() !== '') {
      return true;
    }

    return false;
  };

  const handleFileUpload = async (file: File) => {
    if (!file.type.startsWith('video/')) {
      setError('Please select a video file');
      return;
    }

    const maxSize = 10 * 1024 * 1024 * 1024; // 10GB
    if (file.size > maxSize) {
      setError('File size must be less than 10GB');
      return;
    }

    setUploading(true);
    setUploadProgress(0);
    setError(null);

    try {
      const formData = new FormData();
      formData.append('file', file);

      const response = await fetch('/api/upload-video', {
        method: 'POST',
        body: formData,
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Upload failed');
      }

      const result = await response.json();

      // Refresh the videos list to show the new upload
      await fetchOriginalVideos(true);

      setUploadProgress(100);
      setTimeout(() => {
        setUploading(false);
        setUploadProgress(0);
      }, 1000);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Upload failed');
      setUploading(false);
      setUploadProgress(0);
    }
  };

  const handleFileSelect = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) {
      handleFileUpload(file);
    }
  };

  const openFileDialog = () => {
    fileInputRef.current?.click();
  };

  const handleRowClick = (video: BaserowRow) => {
    const videoUrl = extractUrl(video.field_6881);
    const status = extractFieldValue(video.field_6864);
    const sceneData = extractScenes(video.field_6866);

    // Convert scene IDs to numbers if they exist
    const sceneIds = sceneData.scenes
      .map((id) => {
        const numId = parseInt(id, 10);
        return isNaN(numId) ? 0 : numId;
      })
      .filter((id) => id > 0);

    setSelectedOriginalVideo(video.id, videoUrl, status, sceneIds);

    // Save to localStorage
    saveSettingsToLocalStorage();
  };

  const isRowSelected = (videoId: number) => {
    return selectedOriginalVideo.id === videoId;
  };

  const fetchOriginalVideos = async (isRefresh = false) => {
    try {
      if (isRefresh) {
        setRefreshing(true);
      } else {
        setLoading(true);
      }
      setError(null);

      const data = await getOriginalVideosData();

      // Sort by order field (if exists), otherwise by ID
      const sortedData = data.sort((a, b) => {
        const orderA = Number(a.field_6902) || a.id;
        const orderB = Number(b.field_6902) || b.id;
        return orderA - orderB;
      });

      setOriginalVideos(sortedData);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : 'Failed to fetch original videos'
      );
      console.error('Error fetching original videos:', err);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => {
    fetchOriginalVideos();
  }, []);

  const handleRefresh = () => {
    fetchOriginalVideos(true);
  };

  const getStatusIcon = (status: string) => {
    switch (status?.toLowerCase()) {
      case 'completed':
      case 'complete':
        return <CheckCircle className='w-4 h-4 text-green-500' />;
      case 'processing':
      case 'in progress':
        return <Clock className='w-4 h-4 text-yellow-500' />;
      default:
        return <AlertCircle className='w-4 h-4 text-gray-400' />;
    }
  };

  const getStatusColor = (status: string) => {
    switch (status?.toLowerCase()) {
      case 'completed':
      case 'complete':
        return 'bg-green-100 text-green-800';
      case 'processing':
      case 'in progress':
        return 'bg-yellow-100 text-yellow-800';
      default:
        return 'bg-gray-100 text-gray-600';
    }
  };

  // Drag and drop handlers for reordering
  const handleRowDragStart = (e: React.DragEvent, videoId: number) => {
    setDraggedRow(videoId);
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/html', videoId.toString());
  };

  const handleRowDragOver = (e: React.DragEvent, videoId: number) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    setDragOverRow(videoId);
  };

  const handleRowDragLeave = () => {
    setDragOverRow(null);
  };

  const handleRowDragEnd = () => {
    setDraggedRow(null);
    setDragOverRow(null);
  };

  const handleRowDrop = async (e: React.DragEvent, targetVideoId: number) => {
    e.preventDefault();

    if (!draggedRow || draggedRow === targetVideoId) {
      setDraggedRow(null);
      setDragOverRow(null);
      return;
    }

    setReordering(true);

    try {
      // Create a new array with updated order
      const currentVideos = [...originalVideos];
      const draggedIndex = currentVideos.findIndex((v) => v.id === draggedRow);
      const targetIndex = currentVideos.findIndex(
        (v) => v.id === targetVideoId
      );

      if (draggedIndex === -1 || targetIndex === -1) return;

      // Remove the dragged item and insert it at the target position
      const [draggedVideo] = currentVideos.splice(draggedIndex, 1);
      currentVideos.splice(targetIndex, 0, draggedVideo);

      // Update order values (1-based indexing)
      const updates: Promise<any>[] = [];
      currentVideos.forEach((video, index) => {
        const newOrder = index + 1;
        // Update both local state and database
        video.field_6902 = newOrder;
        updates.push(
          updateOriginalVideoRow(video.id, { field_6902: newOrder })
        );
      });

      // Update local state optimistically
      setOriginalVideos(currentVideos);

      // Save all order changes to database
      await Promise.all(updates);

      console.log(
        `Reordered videos: moved video ${draggedRow} to position ${
          targetIndex + 1
        }`
      );
    } catch (error) {
      console.error('Failed to reorder videos:', error);
      // Refresh data to revert optimistic update
      fetchOriginalVideos(true);
    } finally {
      setReordering(false);
      setDraggedRow(null);
      setDragOverRow(null);
    }
  };

  // Title editing functions
  const startTitleEdit = (videoId: number, currentTitle: string) => {
    setEditingTitle({
      videoId,
      value: currentTitle,
      saving: false,
    });
  };

  const cancelTitleEdit = () => {
    setEditingTitle(null);
  };

  const saveTitleEdit = async (videoId: number, newTitle: string) => {
    if (!editingTitle || editingTitle.videoId !== videoId) return;

    setEditingTitle((prev) => (prev ? { ...prev, saving: true } : null));

    try {
      await updateOriginalVideoRow(videoId, {
        field_6852: newTitle,
      });

      // Update local state
      setOriginalVideos((prevVideos) =>
        prevVideos.map((video) =>
          video.id === videoId ? { ...video, field_6852: newTitle } : video
        )
      );

      setEditingTitle(null);
    } catch (error) {
      console.error('Failed to update title:', error);
      // Could add toast notification here
    }
  };

  const handleTitleKeyDown = (e: React.KeyboardEvent, videoId: number) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      if (editingTitle) {
        saveTitleEdit(videoId, editingTitle.value);
      }
    } else if (e.key === 'Escape') {
      e.preventDefault();
      cancelTitleEdit();
    }
  };

  // Delete video function
  const handleDeleteVideo = async (videoId: number) => {
    setDeleting(videoId);

    try {
      // Delete the video and all related scenes
      await deleteOriginalVideoWithScenes(videoId);

      // Remove from local state
      setOriginalVideos((prev) => prev.filter((v) => v.id !== videoId));

      // Clear selection if this video was selected
      if (selectedOriginalVideo.id === videoId) {
        setSelectedOriginalVideo(null);
        saveSettingsToLocalStorage();
      }

      console.log(`Successfully deleted video ${videoId} and related scenes`);
    } catch (error) {
      console.error('Failed to delete video:', error);
      alert('Failed to delete video. Please try again.');
    } finally {
      setDeleting(null);
      // add sound effect
      playSuccessSound();
    }
  };

  // Transcribe video function
  const handleTranscribeVideo = async (videoId: number, videoUrl: string) => {
    try {
      setTranscribing(videoId);

      // Step 1: Transcribe the video using selected model
      const transcribeResponse = await fetch('/api/transcribe-video', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          media_url: videoUrl,
          model: transcriptionSettings.selectedModel,
        }),
      });

      if (!transcribeResponse.ok) {
        throw new Error('Failed to transcribe video');
      }

      const transcriptionData = await transcribeResponse.json();

      // Step 2: Process the response to extract word timestamps
      const wordTimestamps = [];
      const segments = transcriptionData.response?.segments;

      if (segments && segments.length > 0) {
        for (const segment of segments) {
          if (segment.words) {
            for (const wordObj of segment.words) {
              wordTimestamps.push({
                word: wordObj.word.trim(),
                start: wordObj.start,
                end: wordObj.end,
              });
            }
          }
        }
      }

      // Step 3: Upload the captions file to Baserow
      const captionsData = JSON.stringify(wordTimestamps);
      const filename = `captions_${videoId}.json`;

      const formData = new FormData();
      const blob = new Blob([captionsData], { type: 'application/json' });
      formData.append('file', blob, filename);

      const uploadResponse = await fetch('/api/upload-captions', {
        method: 'POST',
        body: formData,
      });

      if (!uploadResponse.ok) {
        throw new Error('Failed to upload captions');
      }

      const uploadResult = await uploadResponse.json();
      console.log('Captions uploaded successfully:', uploadResult);

      // Step 4: Update the original video record with the captions URL
      const captionsUrl = uploadResult.url || uploadResult.file_url;
      if (captionsUrl) {
        await updateOriginalVideoRow(videoId, {
          field_6861: captionsUrl, // Captions URL field
        });
      }

      // Refresh the table to show any updates
      await handleRefresh();

      // Play success sound for transcription completion
      playSuccessSound();
    } catch (error) {
      console.error('Error transcribing video:', error);

      // Play error sound for transcription failure
      playErrorSound();

      setError(
        `Failed to transcribe video: ${
          error instanceof Error ? error.message : 'Unknown error'
        }`
      );
    } finally {
      setTranscribing(null);
    }
  };

  const handleNormalizeVideo = async (videoId: number, videoUrl: string) => {
    try {
      setNormalizing(videoId);

      // Call the normalize audio API
      const normalizeResponse = await fetch('/api/normalize-audio', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          sceneId: videoId, // Use videoId as sceneId for original video normalization
          videoUrl: videoUrl,
        }),
      });

      if (!normalizeResponse.ok) {
        const errorData = await normalizeResponse.json();
        throw new Error(errorData.error || 'Failed to normalize audio');
      }

      const normalizeData = await normalizeResponse.json();
      console.log('Audio normalized successfully:', normalizeData);

      // Update the original video record with the normalized video URL
      if (normalizeData.data?.normalizedUrl) {
        await updateOriginalVideoRow(videoId, {
          field_6903: normalizeData.data.normalizedUrl, // Normalized Video URL field
          field_6881: normalizeData.data.normalizedUrl, // Normalized Video URL field
        });
      }

      // Refresh the table to show any updates
      await handleRefresh();

      // Play success sound for normalization completion
      playSuccessSound();
    } catch (error) {
      console.error('Error normalizing video:', error);

      // Play error sound for normalization failure
      playErrorSound();

      setError(
        `Failed to normalize video: ${
          error instanceof Error ? error.message : 'Unknown error'
        }`
      );
    } finally {
      setNormalizing(null);
    }
  };

  // Transcribe all videos that don't have captions
  const handleTranscribeAll = async () => {
    try {
      setTranscribingAll(true);

      // Filter videos that have video URLs but no captions URLs
      const videosToTranscribe = originalVideos.filter((video) => {
        const videoUrl = extractUrl(video.field_6881);
        const captionsUrl = extractUrl(video.field_6861);
        return videoUrl && !captionsUrl; // Has video but no captions
      });

      if (videosToTranscribe.length === 0) {
        alert('No videos found that need transcription');
        return;
      }

      console.log(
        `Starting transcription for ${videosToTranscribe.length} videos...`
      );

      // Process videos one by one to avoid overwhelming the API
      for (const video of videosToTranscribe) {
        const videoUrl = extractUrl(video.field_6881);
        if (videoUrl) {
          console.log(`Transcribing video ${video.id}...`);
          setTranscribing(video.id);

          try {
            await handleTranscribeVideoInternal(video.id, videoUrl);
            console.log(`Successfully transcribed video ${video.id}`);
          } catch (error) {
            console.error(`Failed to transcribe video ${video.id}:`, error);
            // Continue with next video even if one fails
          }
        }
      }

      console.log('Batch transcription completed');
      await handleRefresh();

      // Play success sound for batch transcription completion
      playSuccessSound();
    } catch (error) {
      console.error('Error in batch transcription:', error);

      // Play error sound for batch transcription failure
      playErrorSound();

      setError(
        `Failed to transcribe all videos: ${
          error instanceof Error ? error.message : 'Unknown error'
        }`
      );
    } finally {
      setTranscribing(null);
      setTranscribingAll(false);
    }
  };

  // Internal transcription function (without UI state management)
  const handleTranscribeVideoInternal = async (
    videoId: number,
    videoUrl: string
  ) => {
    // Step 1: Transcribe the video using selected model
    const transcribeResponse = await fetch('/api/transcribe-video', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        media_url: videoUrl,
        model: transcriptionSettings.selectedModel,
      }),
    });

    if (!transcribeResponse.ok) {
      throw new Error('Failed to transcribe video');
    }

    const transcriptionData = await transcribeResponse.json();

    // Step 2: Process the response to extract word timestamps
    const wordTimestamps = [];
    const segments = transcriptionData.response?.segments;

    if (segments && segments.length > 0) {
      for (const segment of segments) {
        if (segment.words) {
          for (const wordObj of segment.words) {
            wordTimestamps.push({
              word: wordObj.word.trim(),
              start: wordObj.start,
              end: wordObj.end,
            });
          }
        }
      }
    }

    // Step 3: Upload the captions file to MinIO
    const captionsData = JSON.stringify(wordTimestamps);
    const filename = `captions_${videoId}.json`;

    const formData = new FormData();
    const blob = new Blob([captionsData], { type: 'application/json' });
    formData.append('file', blob, filename);

    const uploadResponse = await fetch('/api/upload-captions', {
      method: 'POST',
      body: formData,
    });

    if (!uploadResponse.ok) {
      throw new Error('Failed to upload captions');
    }

    const uploadResult = await uploadResponse.json();

    // Step 4: Update the original video record with the captions URL
    const captionsUrl = uploadResult.url || uploadResult.file_url;
    if (captionsUrl) {
      await updateOriginalVideoRow(videoId, {
        field_6861: captionsUrl, // Captions URL field
      });
    }
  };

  // Generate Scenes for individual video
  const handleGenerateScenes = async (videoId: number) => {
    try {
      setGeneratingScenes(videoId);
      setError(null);

      // Find the video to get captions URL
      const video = originalVideos.find((v) => v.id === videoId);
      const captionsUrl = extractUrl(video?.field_6861);

      if (!captionsUrl) {
        throw new Error('No captions URL found for this video');
      }

      console.log('Generating scenes for video:', videoId);

      const response = await fetch('/api/generate-scenes', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          videoId,
          captionsUrl,
        }),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Failed to generate scenes');
      }

      const result = await response.json();
      console.log('Scenes generated successfully:', result);

      // Refresh the data to show any changes
      await handleRefresh();
    } catch (error) {
      console.error('Error generating scenes:', error);
      setError(
        `Failed to generate scenes: ${
          error instanceof Error ? error.message : 'Unknown error'
        }`
      );
    } finally {
      setGeneratingScenes(null);
    }
  };

  // Generate Scenes for all videos
  const handleGenerateScenesAll = async () => {
    try {
      setGeneratingScenesAll(true);

      // Filter videos that have captions URLs but no scenes
      const videosToProcess = originalVideos.filter((video) => {
        const captionsUrl = extractUrl(video.field_6861);
        return captionsUrl && !hasScenes(video); // Has captions but no scenes
      });

      if (videosToProcess.length === 0) {
        alert('No videos found with captions that need scene generation');
        return;
      }

      console.log(
        `Starting scene generation for ${videosToProcess.length} videos...`
      );

      // Process videos one by one
      for (const video of videosToProcess) {
        const captionsUrl = extractUrl(video.field_6861);
        if (captionsUrl) {
          console.log(`Generating scenes for video ${video.id}...`);
          setGeneratingScenes(video.id);

          try {
            await handleGenerateScenesInternal(video.id, captionsUrl);
            console.log(`Successfully generated scenes for video ${video.id}`);
          } catch (error) {
            console.error(
              `Failed to generate scenes for video ${video.id}:`,
              error
            );
            // Continue with next video even if one fails
          }
        }
      }

      console.log('Batch scene generation completed');
      await handleRefresh();
    } catch (error) {
      console.error('Error in batch scene generation:', error);
      setError(
        `Failed to generate scenes for all videos: ${
          error instanceof Error ? error.message : 'Unknown error'
        }`
      );
    } finally {
      setGeneratingScenes(null);
      setGeneratingScenesAll(false);
    }
  };

  // Internal scene generation function (without UI state management)
  const handleGenerateScenesInternal = async (
    videoId: number,
    captionsUrl: string
  ) => {
    const response = await fetch('/api/generate-scenes', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        videoId,
        captionsUrl,
      }),
    });

    if (!response.ok) {
      const errorData = await response.json();
      throw new Error(errorData.error || 'Failed to generate scenes');
    }

    return response.json();
  };

  // Improve All Scenes for All Videos
  const handleImproveAllVideosScenes = async () => {
    if (!sceneHandlers) {
      alert(
        'Scene handlers are not available yet. Please wait a moment and try again.'
      );
      return;
    }

    try {
      setImprovingAllVideosScenes(true);

      // Get all scenes from the store
      if (!allScenesData || allScenesData.length === 0) {
        alert('No scenes found to improve');
        return;
      }

      console.log(
        `Starting AI improvement for all videos with ${allScenesData.length} scenes...`
      );
      console.log('All scenes data:', allScenesData);

      await handleImproveAllSentencesForAllVideos(
        allScenesData,
        sceneHandlers.handleSentenceImprovement,
        modelSelection.selectedModel,
        setImprovingAllVideosScenes,
        setCurrentProcessingVideoId,
        setImprovingSentence
      );

      console.log('Batch improvement completed for all videos');

      // Refresh the original videos list to show any updates
      await handleRefresh();

      // Note: Success sound is already played in the batch operation utility
    } catch (error) {
      console.error('Error improving all videos scenes:', error);

      // Play error sound
      playErrorSound();

      setError(
        `Failed to improve all videos scenes: ${
          error instanceof Error ? error.message : 'Unknown error'
        }`
      );
    } finally {
      setImprovingAllVideosScenes(false);
      setCurrentProcessingVideoId(null);
    }
  };

  // Generate TTS for All Scenes in All Videos
  const handleGenerateAllTTSForAllVideos = async () => {
    if (!sceneHandlers) {
      alert(
        'Scene handlers are not available yet. Please wait a moment and try again.'
      );
      return;
    }

    try {
      setGeneratingAllTTSForAllVideos(true);

      // Get all scenes from the store
      if (!allScenesData || allScenesData.length === 0) {
        alert('No scenes found to generate TTS');
        return;
      }

      console.log(
        `Starting TTS generation for all videos with ${allScenesData.length} scenes...`
      );
      console.log('All scenes data:', allScenesData);

      await generateAllTTSForAllVideosUtil(
        allScenesData,
        sceneHandlers.handleTTSProduce,
        setGeneratingAllTTSForAllVideos,
        setCurrentProcessingVideoId,
        setProducingTTS
      );

      console.log('Batch TTS generation completed for all videos');

      // Refresh the original videos list to show any updates
      await handleRefresh();

      // Note: Success sound is already played in the batch operation utility
    } catch (error) {
      console.error('Error generating TTS for all videos scenes:', error);

      // Play error sound
      playErrorSound();

      setError(
        `Failed to generate TTS for all videos scenes: ${
          error instanceof Error ? error.message : 'Unknown error'
        }`
      );
    } finally {
      setGeneratingAllTTSForAllVideos(false);
      setCurrentProcessingVideoId(null);
    }
  };

  // Merge All Final Videos
  const handleMergeAllFinalVideos = async () => {
    try {
      setMergingFinalVideos(true);
      setError(null);

      // Filter videos that have Final Merged Video URLs and Order values
      const videosWithFinalVideos = originalVideos.filter((video) => {
        const finalVideoUrl = extractUrl(video.field_6858); // Final Merged Video URL
        const order = video.field_6902; // Order field
        console.log(
          `Video ${video.id}: field_6858=${video.field_6858}, extracted URL=${finalVideoUrl}, order=${order}`
        );
        return finalVideoUrl && order !== null && order !== undefined;
      });

      console.log(
        `Found ${videosWithFinalVideos.length} videos with final merged videos`
      );

      if (videosWithFinalVideos.length === 0) {
        alert('No videos found with final merged videos to merge');
        return;
      }

      // Sort videos by Order (field_6902)
      videosWithFinalVideos.sort((a, b) => {
        const orderA = parseInt(String(a.field_6902)) || 0;
        const orderB = parseInt(String(b.field_6902)) || 0;
        console.log(
          `Sorting: Video ${a.id} order=${orderA}, Video ${b.id} order=${orderB}`
        );
        return orderA - orderB;
      });

      console.log(
        'Sorted videos:',
        videosWithFinalVideos.map((v) => ({
          id: v.id,
          order: v.field_6902,
          url: extractUrl(v.field_6858),
        }))
      );

      // Extract video URLs in order
      const videoUrls = videosWithFinalVideos.map((video) =>
        extractUrl(video.field_6858)
      );

      console.log('Final video URLs to merge:', videoUrls);

      console.log(
        `Merging ${videoUrls.length} final videos in order:`,
        videoUrls
      );

      // Call the concatenate API with fast mode
      const response = await fetch('/api/concatenate-videos', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          video_urls: videoUrls,
          fast_mode: true, // Use fast merging without re-encoding
        }),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Failed to merge final videos');
      }

      const result = await response.json();
      console.log('Final videos merged successfully:', result);

      // Save the merged video URL to global state and local storage (without saving to Baserow)
      const mergedVideoUrl = result.videoUrl || result.url || result.video_url;
      const fileName = `final-merged-videos-${Date.now()}.mp4`;
      console.log('Setting merged video:', mergedVideoUrl, fileName);

      // Set merged video directly in store without triggering Baserow save
      useAppStore.setState({
        mergedVideo: {
          url: mergedVideoUrl,
          createdAt: new Date(),
          fileName: fileName,
        },
      });

      // Also save to localStorage with final-video-data key
      try {
        const existingData = localStorage.getItem('final-video-data');
        let dataObject = {};

        if (existingData) {
          try {
            dataObject = JSON.parse(existingData);
          } catch (parseError) {
            // If parsing fails, start with empty object
            dataObject = {};
          }
        }

        // Update with final video URL
        const updatedData = {
          ...dataObject,
          finalVideoUrl: mergedVideoUrl,
          mergedAt: new Date().toISOString(),
        };

        localStorage.setItem('final-video-data', JSON.stringify(updatedData));

        // Dispatch custom event to notify other components of localStorage update
        window.dispatchEvent(new CustomEvent('localStorageUpdate'));

        console.log('Saved final video URL to localStorage:', mergedVideoUrl);
      } catch (storageError) {
        console.warn(
          'Failed to save final video URL to localStorage:',
          storageError
        );
      }

      // Verify the state was set
      setTimeout(() => {
        const currentState = useAppStore.getState().mergedVideo;
        console.log('Current mergedVideo state:', currentState);
      }, 100);

      // Play success sound
      playSuccessSound();
    } catch (error) {
      console.error('Error merging final videos:', error);

      // Play error sound
      playErrorSound();

      setError(
        `Failed to merge final videos: ${
          error instanceof Error ? error.message : 'Unknown error'
        }`
      );
    } finally {
      setMergingFinalVideos(false);
    }
  };

  // Generate Timestamps for Final Videos
  const handleGenerateTimestamps = async () => {
    try {
      setGeneratingTimestamps(true);
      setError(null);

      // Filter videos that have Final Merged Video URLs, Titles, and Order values
      const videosWithTimestamps = originalVideos.filter((video) => {
        const finalVideoUrl = extractUrl(video.field_6858); // Final Merged Video URL
        const title = video.field_6852; // Title field
        const order = video.field_6902; // Order field
        return finalVideoUrl && title && order !== null && order !== undefined;
      });

      if (videosWithTimestamps.length === 0) {
        alert(
          'No videos found with final merged videos, titles, and order values'
        );
        return;
      }

      // Sort videos by Order (field_6902)
      videosWithTimestamps.sort((a, b) => {
        const orderA = parseInt(String(a.field_6902)) || 0;
        const orderB = parseInt(String(b.field_6902)) || 0;
        return orderA - orderB;
      });

      console.log(
        'Generating timestamps for videos:',
        videosWithTimestamps.map((v) => ({
          title: v.field_6852,
          order: v.field_6902,
          url: extractUrl(v.field_6858),
        }))
      );

      // Calculate cumulative timestamps
      let cumulativeSeconds = 0;
      const timestampLines: string[] = [];

      for (const video of videosWithTimestamps) {
        try {
          // Get video duration
          const videoUrl = extractUrl(video.field_6858);
          const response = await fetch('/api/get-video-duration', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({ videoUrl }),
          });

          if (!response.ok) {
            throw new Error('Failed to get video duration');
          }

          const durationData = await response.json();
          const durationSeconds = durationData.duration || 0;

          // Format timestamp
          const timestamp = formatTimestamp(cumulativeSeconds);
          const title = String(video.field_6852);

          timestampLines.push(`${timestamp} - ${title}`);

          // Add duration to cumulative time
          cumulativeSeconds += durationSeconds;
        } catch (durationError) {
          console.warn(
            `Failed to get duration for video ${video.id}, using 0:`,
            durationError
          );
          // Still add the timestamp with 0 duration
          const timestamp = formatTimestamp(cumulativeSeconds);
          const title = String(video.field_6852);
          timestampLines.push(`${timestamp} - ${title}`);
        }
      }

      // Create final timestamp text
      const timestampText = timestampLines.join('\n');

      // Set timestamp data
      setTimestampData(timestampText);

      // Save to localStorage - preserve existing data
      const existingData = localStorage.getItem('final-video-data');
      let dataObject: any = {};

      if (existingData) {
        try {
          dataObject = JSON.parse(existingData);
        } catch (parseError) {
          dataObject = {};
        }
      }

      // Update with timestamp data
      const updatedData = {
        ...dataObject,
        timestamp: timestampText,
        createdAt: new Date().toISOString(),
        videoCount: videosWithTimestamps.length,
      };

      localStorage.setItem('final-video-data', JSON.stringify(updatedData));

      // Dispatch custom event to notify other components of localStorage update
      window.dispatchEvent(new CustomEvent('localStorageUpdate'));

      console.log('Generated timestamps:', timestampText);

      // Play success sound
      playSuccessSound();
    } catch (error) {
      console.error('Error generating timestamps:', error);

      // Play error sound
      playErrorSound();

      setError(
        `Failed to generate timestamps: ${
          error instanceof Error ? error.message : 'Unknown error'
        }`
      );
    } finally {
      setGeneratingTimestamps(false);
    }
  };

  // Helper function to format seconds into HH:MM:SS or MM:SS
  const formatTimestamp = (seconds: number): string => {
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const secs = Math.floor(seconds % 60);

    if (hours > 0) {
      return `${hours}:${minutes.toString().padStart(2, '0')}:${secs
        .toString()
        .padStart(2, '0')}`;
    } else {
      return `${minutes}:${secs.toString().padStart(2, '0')}`;
    }
  };

  // Generate Clips for video
  const handleGenerateClips = async (videoId: number) => {
    try {
      setGeneratingClipsGlobal(videoId);
      setClipsProgressGlobal({ current: 0, total: 1, percentage: 0 });
      setError(null);

      console.log('Generating clips for video:', videoId);

      // Use EventSource for Server-Sent Events
      const eventSource = new EventSource('/api/generate-clips', {
        // Note: EventSource doesn't support POST directly, so we need to use a different approach
      });

      // Alternative: Use fetch with streaming
      const response = await fetch('/api/generate-clips', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          videoId,
        }),
      });

      if (!response.ok) {
        throw new Error('Failed to start clip generation');
      }

      const reader = response.body?.getReader();
      const decoder = new TextDecoder();

      if (!reader) {
        throw new Error('No response body available');
      }

      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();

        if (done) break;

        buffer += decoder.decode(value, { stream: true });

        // Process complete lines
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (line.startsWith('data: ')) {
            try {
              const data = JSON.parse(line.slice(6));

              switch (data.type) {
                case 'progress':
                  setClipsProgressGlobal({
                    current: data.current,
                    total: data.total,
                    percentage: data.percentage,
                  });
                  break;

                case 'scene_complete':
                  setClipsProgressGlobal({
                    current: data.current,
                    total: data.total,
                    percentage: data.percentage,
                  });
                  break;

                case 'scene_error':
                  console.error(
                    `Scene ${data.sceneNumber} failed:`,
                    data.error
                  );
                  setClipsProgressGlobal({
                    current: data.current,
                    total: data.total,
                    percentage: data.percentage,
                  });
                  break;

                case 'complete':
                  console.log('Clips generation completed:', data);
                  setClipsProgressGlobal({
                    current: data.processedScenes,
                    total: data.totalScenes,
                    percentage: 100,
                  });

                  // Play success sound for batch completion
                  playSuccessSound();

                  // Refresh the data to show any changes
                  await handleRefresh();
                  break;

                case 'error':
                  throw new Error(data.error);
              }
            } catch (parseError) {
              console.error('Error parsing SSE data:', parseError);
            }
          }
        }
      }
    } catch (error) {
      console.error('Error generating clips:', error);

      // Play error sound for batch failure
      playErrorSound();

      setError(
        `Failed to generate clips: ${
          error instanceof Error ? error.message : 'Unknown error'
        }`
      );
    } finally {
      // Small delay to show completion before clearing
      setTimeout(() => {
        clearClipGeneration();
      }, 2000);
    }
  };

  if (loading) {
    return (
      <div className='bg-white rounded-xl shadow-lg border border-gray-200 p-6 mb-8'>
        <div className='flex items-center justify-center py-8'>
          <Loader2 className='w-6 h-6 animate-spin text-blue-500 mr-2' />
          <span className='text-gray-600'>Loading original videos...</span>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className='bg-white rounded-xl shadow-lg border border-gray-200 p-6 mb-8'>
        <div className='flex items-center justify-between'>
          <div className='flex items-center text-red-600'>
            <AlertCircle className='w-5 h-5 mr-2' />
            <span>Error loading original videos: {error}</span>
          </div>
          <button
            onClick={handleRefresh}
            className='px-4 py-2 bg-red-500 hover:bg-red-600 text-white rounded-lg transition-colors truncate'
          >
            Retry
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className='bg-white rounded-xl shadow-lg border border-gray-200 p-6 mb-8'>
      {/* Header */}
      <div className='mb-6'>
        <div className='flex items-center justify-between mb-4'>
          <div>
            <h2 className='text-2xl font-bold text-gray-900 flex items-center gap-2'>
              <Video className='w-6 h-6 text-blue-500' />
              Original Videos
            </h2>
            <p className='text-gray-600 mt-1'>
              {originalVideos.length} video
              {originalVideos.length !== 1 ? 's' : ''} in library
            </p>
          </div>
        </div>

        {/* Action Buttons - Full Width Grid Layout */}
        <div className='w-full'>
          <div
            className='grid gap-2'
            style={{
              gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))',
            }}
          >
            {/* Upload Button */}
            <button
              onClick={openFileDialog}
              disabled={uploading}
              className={`w-full inline-flex items-center justify-center gap-2 px-3 py-2 truncate ${
                uploading
                  ? 'bg-gray-400 cursor-not-allowed'
                  : 'bg-green-500 hover:bg-green-600'
              } text-white text-sm font-medium rounded-md transition-all shadow-sm hover:shadow disabled:cursor-not-allowed min-h-[40px]`}
              title={
                uploading
                  ? `Uploading... ${uploadProgress}%`
                  : 'Upload a new video'
              }
            >
              {uploading ? (
                <>
                  <Loader2 className='w-4 h-4 animate-spin' />
                  <span className='truncate'>
                    Uploading... {uploadProgress}%
                  </span>
                </>
              ) : (
                <>
                  <Upload className='w-4 h-4' />
                  <span>Upload</span>
                </>
              )}
            </button>

            <input
              ref={fileInputRef}
              type='file'
              accept='video/*'
              onChange={handleFileSelect}
              className='hidden'
            />

            {/* Primary Actions */}
            {/* Refresh Button */}
            <button
              onClick={handleRefresh}
              disabled={refreshing || uploading || reordering}
              className='w-full inline-flex items-center justify-center gap-2 px-3 py-2 truncate bg-blue-500 hover:bg-blue-600 disabled:bg-blue-300 text-white text-sm font-medium rounded-md transition-all shadow-sm hover:shadow disabled:cursor-not-allowed min-h-[40px]'
              title='Refresh the videos list'
            >
              <RefreshCw
                className={`w-4 h-4 ${
                  refreshing || reordering ? 'animate-spin' : ''
                }`}
              />
              <span>
                {reordering
                  ? 'Reordering...'
                  : refreshing
                  ? 'Refreshing...'
                  : 'Refresh'}
              </span>
            </button>

            {/* Transcribe All Button */}
            <button
              onClick={handleTranscribeAll}
              disabled={
                transcribing !== null ||
                transcribingAll ||
                uploading ||
                reordering
              }
              className='w-full inline-flex items-center justify-center gap-2 px-3 py-2 truncate bg-purple-500 hover:bg-purple-600 disabled:bg-purple-300 text-white text-sm font-medium rounded-md transition-all shadow-sm hover:shadow disabled:cursor-not-allowed min-h-[40px]'
              title={
                transcribing !== null || transcribingAll
                  ? 'Transcription in progress...'
                  : 'Transcribe all videos without captions'
              }
            >
              <Subtitles
                className={`w-4 h-4 ${transcribingAll ? 'animate-pulse' : ''}`}
              />
              <span>
                {transcribingAll
                  ? transcribing !== null
                    ? `#${transcribing}...`
                    : 'Processing...'
                  : 'Transcribe All'}
              </span>
            </button>

            {/* Generate All Scenes Button */}
            <button
              onClick={handleGenerateScenesAll}
              disabled={
                generatingScenes !== null ||
                generatingScenesAll ||
                uploading ||
                reordering
              }
              className='w-full inline-flex items-center justify-center gap-2 px-3 py-2 truncate bg-green-500 hover:bg-green-600 disabled:bg-green-300 text-white text-sm font-medium rounded-md transition-all shadow-sm hover:shadow disabled:cursor-not-allowed min-h-[40px]'
              title={
                generatingScenes !== null || generatingScenesAll
                  ? 'Scene generation in progress...'
                  : 'Generate scenes for all videos with captions'
              }
            >
              <Grid3x3
                className={`w-4 h-4 ${
                  generatingScenesAll ? 'animate-pulse' : ''
                }`}
              />
              <span>
                {generatingScenesAll
                  ? generatingScenes !== null
                    ? `#${generatingScenes}...`
                    : 'Processing...'
                  : 'Generate Scenes'}
              </span>
            </button>

            {/* Processing Actions */}
            {/* Improve All Videos Button */}
            <button
              onClick={handleImproveAllVideosScenes}
              disabled={
                improvingAllVideosScenes ||
                sceneLoading.improvingSentence !== null ||
                !sceneHandlers ||
                uploading ||
                reordering
              }
              className='w-full inline-flex items-center justify-center gap-2 px-3 py-2 truncate bg-indigo-500 hover:bg-indigo-600 disabled:bg-indigo-300 text-white text-sm font-medium rounded-md transition-all shadow-sm hover:shadow disabled:cursor-not-allowed min-h-[40px]'
              title={
                !sceneHandlers
                  ? 'Scene handlers not ready. Please wait...'
                  : improvingAllVideosScenes
                  ? 'Improving all scenes for all videos...'
                  : 'Improve all scenes for all videos with AI'
              }
            >
              <Sparkles
                className={`w-4 h-4 ${
                  improvingAllVideosScenes ? 'animate-pulse' : ''
                }`}
              />
              <span>
                {improvingAllVideosScenes
                  ? currentProcessingVideoId !== null
                    ? `V${currentProcessingVideoId}`
                    : sceneLoading.improvingSentence !== null
                    ? `S${sceneLoading.improvingSentence}`
                    : 'Processing...'
                  : 'Improve All'}
              </span>
            </button>

            {/* Generate TTS All Videos Button */}
            <button
              onClick={handleGenerateAllTTSForAllVideos}
              disabled={
                generatingAllTTSForAllVideos ||
                sceneLoading.producingTTS !== null ||
                !sceneHandlers ||
                uploading ||
                reordering
              }
              className='w-full inline-flex items-center justify-center gap-2 px-3 py-2 truncate bg-purple-500 hover:bg-purple-600 disabled:bg-purple-300 text-white text-sm font-medium rounded-md transition-all shadow-sm hover:shadow disabled:cursor-not-allowed min-h-[40px]'
              title={
                !sceneHandlers
                  ? 'Scene handlers not ready. Please wait...'
                  : generatingAllTTSForAllVideos
                  ? 'Generating TTS for all scenes in all videos...'
                  : 'Generate TTS for all scenes in all videos'
              }
            >
              <Mic2
                className={`w-4 h-4 ${
                  generatingAllTTSForAllVideos ? 'animate-pulse' : ''
                }`}
              />
              <span>
                {generatingAllTTSForAllVideos
                  ? currentProcessingVideoId !== null
                    ? `V${currentProcessingVideoId}`
                    : sceneLoading.producingTTS !== null
                    ? `S${sceneLoading.producingTTS}`
                    : 'Processing...'
                  : 'TTS All'}
              </span>
            </button>

            {/* Merge All Final Videos Button */}
            <button
              onClick={handleMergeAllFinalVideos}
              disabled={
                mergingFinalVideos ||
                uploading ||
                reordering ||
                transcribing !== null ||
                transcribingAll ||
                generatingScenes !== null ||
                generatingScenesAll
              }
              className='w-full inline-flex items-center justify-center gap-2 px-3 py-2 truncate bg-orange-500 hover:bg-orange-600 disabled:bg-orange-300 text-white text-sm font-medium rounded-md transition-all shadow-sm hover:shadow disabled:cursor-not-allowed min-h-[40px]'
              title={
                mergingFinalVideos
                  ? 'Merging final videos...'
                  : 'Merge all final merged videos in order'
              }
            >
              <Video
                className={`w-4 h-4 ${
                  mergingFinalVideos ? 'animate-pulse' : ''
                }`}
              />
              <span>{mergingFinalVideos ? 'Merging...' : 'Merge Final'}</span>
            </button>

            {/* Final Actions */}
            {/* Generate Timestamps Button */}
            <button
              onClick={handleGenerateTimestamps}
              disabled={
                generatingTimestamps ||
                uploading ||
                reordering ||
                transcribing !== null ||
                transcribingAll ||
                generatingScenes !== null ||
                generatingScenesAll ||
                mergingFinalVideos
              }
              className='w-full inline-flex items-center justify-center gap-2 px-3 py-2 truncate bg-teal-500 hover:bg-teal-600 disabled:bg-teal-300 text-white text-sm font-medium rounded-md transition-all shadow-sm hover:shadow disabled:cursor-not-allowed min-h-[40px]'
              title={
                generatingTimestamps
                  ? 'Generating timestamps...'
                  : 'Generate timestamps for final merged videos'
              }
            >
              <Clock
                className={`w-4 h-4 ${
                  generatingTimestamps ? 'animate-pulse' : ''
                }`}
              />
              <span>
                {generatingTimestamps ? 'Generating...' : 'Timestamps'}
              </span>
            </button>
          </div>
        </div>
      </div>

      {/* Merged Video Display */}
      {mergedVideo.url && (
        <MergedVideoDisplay
          mergedVideo={mergedVideo}
          onClear={clearMergedVideo}
        />
      )}

      {/* Selected Video Info */}
      {selectedOriginalVideo.id && (
        <div className='bg-blue-50 border border-blue-200 rounded-lg p-4 mb-6'>
          <div className='flex items-center justify-between'>
            <div className='flex items-center gap-3'>
              <div className='w-10 h-10 bg-blue-500 rounded-full flex items-center justify-center'>
                <Check className='w-6 h-6 text-white' />
              </div>
              <div>
                <h3 className='font-semibold text-blue-900'>
                  Selected Video: #{selectedOriginalVideo.id}
                </h3>
                <p className='text-blue-700 text-sm'>
                  Status: {selectedOriginalVideo.status} |
                  {(() => {
                    const filteredScenes = getFilteredData();
                    return filteredScenes.length > 0
                      ? ` ${filteredScenes.length} scene${
                          filteredScenes.length !== 1 ? 's' : ''
                        } available for editing`
                      : ' No scenes found for this video';
                  })()}
                </p>
              </div>
            </div>
            <div className='flex items-center gap-2'>
              <button
                onClick={() =>
                  selectedOriginalVideo.id &&
                  handleDeleteVideo(selectedOriginalVideo.id)
                }
                disabled={
                  deleting === selectedOriginalVideo.id ||
                  !selectedOriginalVideo.id
                }
                className='text-red-600 hover:text-red-800 p-2 hover:bg-red-100 rounded-full transition-colors disabled:opacity-50 disabled:cursor-not-allowed'
                title='Delete video and all related scenes'
              >
                {selectedOriginalVideo.id &&
                deleting === selectedOriginalVideo.id ? (
                  <Loader2 className='w-5 h-5 animate-spin' />
                ) : (
                  <Trash2 className='w-5 h-5' />
                )}
              </button>
              <button
                onClick={() => {
                  setSelectedOriginalVideo(null);
                  saveSettingsToLocalStorage();
                }}
                className='text-blue-600 hover:text-blue-800 p-2 hover:bg-blue-100 rounded-full transition-colors'
                title='Clear selection'
              >
                <X className='w-5 h-5' />
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Videos Table */}
      <div className='transition-all duration-200 rounded-lg'>
        {originalVideos.length === 0 ? (
          <div className='text-center py-8'>
            <Video className='w-12 h-12 text-gray-300 mx-auto mb-4' />
            <p className='text-gray-500 text-lg'>No original videos found</p>
            <p className='text-gray-400 text-sm mt-2'>
              Upload a video to get started
            </p>
          </div>
        ) : (
          <div className='overflow-x-auto'>
            <table className='w-full'>
              <thead>
                <tr className='border-b border-gray-200'>
                  <th className='text-left py-3 px-4 font-semibold text-gray-700 w-8'>
                    {/* Drag handle column */}
                  </th>
                  <th className='text-left py-3 px-4 font-semibold text-gray-700 w-12'>
                    Select
                  </th>
                  <th className='text-left py-3 px-4 font-semibold text-gray-700'>
                    ID
                  </th>
                  <th className='text-left py-3 px-4 font-semibold text-gray-700'>
                    Title
                  </th>
                  <th className='text-left py-3 px-4 font-semibold text-gray-700'>
                    Video URL
                  </th>
                  <th className='text-left py-3 px-4 font-semibold text-gray-700'>
                    Final Merged Video
                  </th>
                  <th className='text-left py-3 px-4 font-semibold text-gray-700'>
                    Actions
                  </th>
                </tr>
              </thead>
              <tbody>
                {originalVideos.map((video, index) => {
                  const isSelected = isRowSelected(video.id);
                  return (
                    <tr
                      key={video.id}
                      draggable={!editingTitle}
                      onDragStart={(e) => handleRowDragStart(e, video.id)}
                      onDragOver={(e) => handleRowDragOver(e, video.id)}
                      onDragLeave={handleRowDragLeave}
                      onDragEnd={handleRowDragEnd}
                      onDrop={(e) => handleRowDrop(e, video.id)}
                      onClick={() => !draggedRow && handleRowClick(video)}
                      className={`border-b border-gray-100 transition-all duration-200 ${
                        draggedRow === video.id
                          ? 'opacity-50 cursor-grabbing'
                          : dragOverRow === video.id
                          ? 'border-t-4 border-t-blue-500 cursor-pointer'
                          : 'cursor-pointer'
                      } ${
                        isSelected
                          ? 'bg-blue-50 hover:bg-blue-100 border-blue-200'
                          : index % 2 === 0
                          ? 'bg-white hover:bg-gray-50'
                          : 'bg-gray-50/50 hover:bg-gray-100'
                      }`}
                    >
                      {/* Drag Handle */}
                      <td className='py-3 px-2'>
                        <div
                          className='cursor-grab hover:cursor-grabbing p-1 rounded hover:bg-gray-200 transition-colors'
                          onMouseDown={(e) => e.stopPropagation()}
                        >
                          <GripVertical className='w-4 h-4 text-gray-400' />
                        </div>
                      </td>

                      {/* Selection */}
                      <td className='py-3 px-4'>
                        <div
                          className={`w-6 h-6 rounded-full border-2 flex items-center justify-center transition-colors ${
                            isSelected
                              ? 'bg-blue-500 border-blue-500'
                              : 'border-gray-300 hover:border-blue-400'
                          }`}
                        >
                          {isSelected && (
                            <Check className='w-4 h-4 text-white' />
                          )}
                        </div>
                      </td>

                      {/* ID */}
                      <td className='py-3 px-4'>
                        <span
                          className={`font-medium ${
                            isSelected ? 'text-blue-900' : 'text-gray-900'
                          }`}
                        >
                          #{video.id}
                        </span>
                      </td>

                      {/* Title (6852) - Editable */}
                      <td className='py-3 px-4'>
                        {editingTitle?.videoId === video.id ? (
                          <div className='flex items-center gap-2'>
                            <input
                              type='text'
                              value={editingTitle.value}
                              onChange={(e) =>
                                setEditingTitle((prev) =>
                                  prev
                                    ? { ...prev, value: e.target.value }
                                    : null
                                )
                              }
                              onKeyDown={(e) => handleTitleKeyDown(e, video.id)}
                              onBlur={() =>
                                saveTitleEdit(video.id, editingTitle.value)
                              }
                              className='flex-1 px-2 py-1 border border-gray-300 rounded text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent'
                              autoFocus
                              disabled={editingTitle.saving}
                            />
                            {editingTitle.saving ? (
                              <Loader2 className='w-4 h-4 animate-spin text-blue-500' />
                            ) : (
                              <button
                                onClick={() =>
                                  saveTitleEdit(video.id, editingTitle.value)
                                }
                                className='p-1 text-green-600 hover:text-green-800 hover:bg-green-100 rounded transition-colors'
                                title='Save title'
                              >
                                <Save className='w-4 h-4' />
                              </button>
                            )}
                          </div>
                        ) : (
                          <div
                            className='group flex items-center gap-2 cursor-pointer hover:bg-gray-50 rounded px-2 py-1 -mx-2 -my-1'
                            onClick={(e) => {
                              e.stopPropagation();
                              const currentTitle = extractFieldValue(
                                video.field_6852
                              );
                              startTitleEdit(video.id, currentTitle);
                            }}
                          >
                            <span
                              className={`${
                                isSelected ? 'text-blue-900' : 'text-gray-900'
                              }`}
                            >
                              {extractFieldValue(video.field_6852) ||
                                'Click to add title'}
                            </span>
                            <Edit3 className='w-3 h-3 text-gray-400 opacity-0 group-hover:opacity-100 transition-opacity' />
                          </div>
                        )}
                      </td>

                      {/* Video Uploaded URL (6881) */}
                      <td className='py-3 px-4'>
                        {(() => {
                          const videoUrl = extractUrl(video.field_6881);
                          return videoUrl ? (
                            <a
                              href={videoUrl}
                              target='_blank'
                              rel='noopener noreferrer'
                              className='inline-flex items-center gap-1 text-blue-600 hover:text-blue-800 hover:underline'
                            >
                              <Video className='w-4 h-4' />
                              <span className='truncate max-w-32'>
                                View Video
                              </span>
                              <ExternalLink className='w-3 h-3' />
                            </a>
                          ) : (
                            <span className='text-gray-400'>No video</span>
                          );
                        })()}
                      </td>

                      {/* Final Merged Video URL (6858) */}
                      <td className='py-3 px-4'>
                        {(() => {
                          const finalVideoUrl = extractUrl(video.field_6858);
                          return finalVideoUrl ? (
                            <a
                              href={finalVideoUrl}
                              target='_blank'
                              rel='noopener noreferrer'
                              className='inline-flex items-center gap-1 text-green-600 hover:text-green-800 hover:underline'
                            >
                              <Video className='w-4 h-4' />
                              <span className='truncate max-w-32'>
                                Final Video
                              </span>
                              <ExternalLink className='w-3 h-3' />
                            </a>
                          ) : (
                            <span className='text-gray-400'>Not ready</span>
                          );
                        })()}
                      </td>

                      {/* Actions */}
                      <td className='py-3 px-4'>
                        <div className='flex items-center gap-2'>
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              const videoUrl = extractUrl(video.field_6881);
                              if (videoUrl) {
                                handleTranscribeVideo(video.id, videoUrl);
                              } else {
                                setError(
                                  'No video URL found for transcription'
                                );
                              }
                            }}
                            disabled={
                              transcribing !== null ||
                              transcribingAll ||
                              !extractUrl(video.field_6881) ||
                              !!extractUrl(video.field_6861)
                            }
                            className='p-2 text-purple-600 hover:text-purple-800 hover:bg-purple-100 rounded-full transition-colors disabled:opacity-50 disabled:cursor-not-allowed'
                            title={
                              transcribing !== null
                                ? transcribing === video.id
                                  ? 'Transcribing...'
                                  : 'Another transcription in progress'
                                : transcribingAll
                                ? 'Bulk transcription in progress'
                                : !extractUrl(video.field_6881)
                                ? 'No video URL available'
                                : !!extractUrl(video.field_6861)
                                ? 'Video already has captions'
                                : 'Transcribe video'
                            }
                          >
                            {transcribing === video.id ? (
                              <Loader2 className='w-4 h-4 animate-spin' />
                            ) : (
                              <Subtitles className='w-4 h-4' />
                            )}
                          </button>

                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              const captionsUrl = extractUrl(video.field_6861);
                              if (captionsUrl) {
                                handleGenerateScenes(video.id);
                              } else {
                                setError(
                                  'No captions URL found for scene generation'
                                );
                              }
                            }}
                            disabled={
                              generatingScenes !== null ||
                              generatingScenesAll ||
                              !extractUrl(video.field_6861) ||
                              hasScenes(video)
                            }
                            className='p-2 text-green-600 hover:text-green-800 hover:bg-green-100 rounded-full transition-colors disabled:opacity-50 disabled:cursor-not-allowed'
                            title={
                              generatingScenes !== null
                                ? generatingScenes === video.id
                                  ? 'Generating scenes...'
                                  : 'Another scene generation in progress'
                                : !extractUrl(video.field_6861)
                                ? 'No captions URL available'
                                : hasScenes(video)
                                ? 'Scenes already generated for this video'
                                : 'Generate scenes from captions'
                            }
                          >
                            {generatingScenes === video.id ? (
                              <Loader2 className='w-4 h-4 animate-spin' />
                            ) : (
                              <Grid3x3 className='w-4 h-4' />
                            )}
                          </button>

                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              handleGenerateClips(video.id);
                            }}
                            disabled={
                              clipGeneration.generatingClips !== null ||
                              !hasScenes(video)
                            }
                            className='p-2 text-blue-600 hover:text-blue-800 hover:bg-blue-100 rounded-full transition-colors disabled:opacity-50 disabled:cursor-not-allowed'
                            title={
                              clipGeneration.generatingClips !== null
                                ? clipGeneration.generatingClips === video.id
                                  ? clipGeneration.clipsProgress
                                    ? `Generating clips... Scene ${clipGeneration.clipsProgress.current}/${clipGeneration.clipsProgress.total} (${clipGeneration.clipsProgress.percentage}%)`
                                    : 'Generating clips...'
                                  : 'Another clip generation in progress'
                                : !hasScenes(video)
                                ? 'No scenes available - generate scenes first'
                                : 'Generate video clips for all scenes'
                            }
                          >
                            {clipGeneration.generatingClips === video.id ? (
                              clipGeneration.clipsProgress ? (
                                <div className='flex items-center space-x-1'>
                                  <Loader2 className='w-4 h-4 animate-spin' />
                                  <span className='text-xs font-medium'>
                                    {clipGeneration.clipsProgress.current}/
                                    {clipGeneration.clipsProgress.total}
                                  </span>
                                </div>
                              ) : (
                                <Loader2 className='w-4 h-4 animate-spin' />
                              )
                            ) : (
                              <Video className='w-4 h-4' />
                            )}
                          </button>

                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              const videoUrl = extractUrl(video.field_6881);
                              if (videoUrl) {
                                handleNormalizeVideo(video.id, videoUrl);
                              } else {
                                setError(
                                  'No video URL found for normalization'
                                );
                              }
                            }}
                            disabled={
                              normalizing !== null ||
                              !extractUrl(video.field_6881) ||
                              !!extractUrl(video.field_6903) // Already normalized
                            }
                            className='p-2 text-orange-600 hover:text-orange-800 hover:bg-orange-100 rounded-full transition-colors disabled:opacity-50 disabled:cursor-not-allowed'
                            title={
                              normalizing !== null
                                ? normalizing === video.id
                                  ? 'Normalizing audio...'
                                  : 'Another normalization in progress'
                                : !extractUrl(video.field_6881)
                                ? 'No video URL available'
                                : !!extractUrl(video.field_6903)
                                ? 'Video already normalized'
                                : 'Normalize audio loudness'
                            }
                          >
                            {normalizing === video.id ? (
                              <Loader2 className='w-4 h-4 animate-spin' />
                            ) : (
                              <Volume2 className='w-4 h-4' />
                            )}
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Final Video Table */}
      <FinalVideoTable />

      {/* Timestamp Display */}
    </div>
  );
}
