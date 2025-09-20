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
} from 'lucide-react';

export default function OriginalVideosList() {
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

  // Get clip generation state from global store
  const {
    clipGeneration,
    setGeneratingClips: setGeneratingClipsGlobal,
    setClipsProgress: setClipsProgressGlobal,
    clearClipGeneration,
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

    const maxSize = 100 * 1024 * 1024; // 100MB
    if (file.size > maxSize) {
      setError('File size must be less than 100MB');
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
    }
  };

  // Transcribe video function
  const handleTranscribeVideo = async (videoId: number, videoUrl: string) => {
    try {
      setTranscribing(videoId);

      // Step 1: Transcribe the video using NCA toolkit
      const transcribeResponse = await fetch('/api/transcribe-video', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          media_url: videoUrl,
          task: 'transcribe',
          include_text: false,
          include_srt: false,
          include_segments: true,
          word_timestamps: true,
          response_type: 'direct',
          language: 'en',
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
    } catch (error) {
      console.error('Error transcribing video:', error);
      setError(
        `Failed to transcribe video: ${
          error instanceof Error ? error.message : 'Unknown error'
        }`
      );
    } finally {
      setTranscribing(null);
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
    } catch (error) {
      console.error('Error in batch transcription:', error);
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
    // Step 1: Transcribe the video using NCA toolkit
    const transcribeResponse = await fetch('/api/transcribe-video', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        media_url: videoUrl,
        task: 'transcribe',
        include_text: false,
        include_srt: false,
        include_segments: true,
        word_timestamps: true,
        response_type: 'direct',
        language: 'en',
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
            className='px-4 py-2 bg-red-500 hover:bg-red-600 text-white rounded-lg transition-colors'
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
      <div className='flex items-center justify-between mb-6'>
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

        <div className='flex items-center gap-3'>
          {/* Upload Button */}
          <div className='relative'>
            <button
              onClick={openFileDialog}
              disabled={uploading}
              className={`inline-flex items-center gap-2 px-4 py-2 ${
                uploading
                  ? 'bg-gray-400 cursor-not-allowed'
                  : 'bg-green-500 hover:bg-green-600'
              } text-white font-medium rounded-lg transition-all duration-200 shadow-sm hover:shadow-md disabled:cursor-not-allowed`}
            >
              {uploading ? (
                <>
                  <Loader2 className='w-4 h-4 animate-spin' />
                  <span>Uploading... {uploadProgress}%</span>
                </>
              ) : (
                <>
                  <Plus className='w-4 h-4' />
                  <span>Upload Video</span>
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
          </div>

          {/* Refresh Button */}
          <button
            onClick={handleRefresh}
            disabled={refreshing || uploading || reordering}
            className='inline-flex items-center gap-2 px-4 py-2 bg-blue-500 hover:bg-blue-600 disabled:bg-blue-300 text-white font-medium rounded-lg transition-all duration-200 shadow-sm hover:shadow-md disabled:cursor-not-allowed'
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
            className='inline-flex items-center gap-2 px-4 py-2 bg-purple-500 hover:bg-purple-600 disabled:bg-purple-300 text-white font-medium rounded-lg transition-all duration-200 shadow-sm hover:shadow-md disabled:cursor-not-allowed'
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
                  ? `Transcribing #${transcribing}...`
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
            className='inline-flex items-center gap-2 px-4 py-2 bg-green-500 hover:bg-green-600 disabled:bg-green-300 text-white font-medium rounded-lg transition-all duration-200 shadow-sm hover:shadow-md disabled:cursor-not-allowed'
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
                  ? `Generating #${generatingScenes}...`
                  : 'Processing...'
                : 'Generate All Scenes'}
            </span>
          </button>
        </div>
      </div>

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
                    Status
                  </th>
                  <th className='text-left py-3 px-4 font-semibold text-gray-700'>
                    Scenes
                  </th>
                  <th className='text-left py-3 px-4 font-semibold text-gray-700'>
                    Final Merged Video
                  </th>
                  <th className='text-left py-3 px-4 font-semibold text-gray-700'>
                    Captions
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

                      {/* Status (6864) */}
                      <td className='py-3 px-4'>
                        {(() => {
                          const status = extractFieldValue(video.field_6864);
                          return (
                            <div className='flex items-center gap-2'>
                              {getStatusIcon(status)}
                              <span
                                className={`px-2 py-1 rounded-full text-xs font-medium ${getStatusColor(
                                  status
                                )}`}
                              >
                                {status || 'Unknown'}
                              </span>
                            </div>
                          );
                        })()}
                      </td>

                      {/* Scenes (6866) */}
                      <td className='py-3 px-4'>
                        {(() => {
                          const sceneData = extractScenes(video.field_6866);
                          if (sceneData.count === 0) {
                            return <span className='text-gray-400'>N/A</span>;
                          }

                          return (
                            <div className='flex items-center gap-2'>
                              <span className='text-gray-700 font-medium'>
                                {sceneData.count} scene
                                {sceneData.count !== 1 ? 's' : ''}
                              </span>
                              {sceneData.scenes.length > 0 && (
                                <div
                                  className='text-xs text-gray-500 bg-gray-100 px-2 py-1 rounded cursor-help'
                                  title={`Scene IDs: ${sceneData.scenes.join(
                                    ', '
                                  )}`}
                                >
                                  IDs: {sceneData.scenes.slice(0, 3).join(', ')}
                                  {sceneData.scenes.length > 3 ? '...' : ''}
                                </div>
                              )}
                            </div>
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

                      {/* Captions URL (6861) */}
                      <td className='py-3 px-4'>
                        {(() => {
                          const captionsUrl = extractUrl(video.field_6861);
                          return captionsUrl ? (
                            <a
                              href={captionsUrl}
                              target='_blank'
                              rel='noopener noreferrer'
                              className='inline-flex items-center gap-1 text-purple-600 hover:text-purple-800 hover:underline'
                            >
                              <Subtitles className='w-4 h-4' />
                              <span className='truncate max-w-32'>
                                Captions
                              </span>
                              <ExternalLink className='w-3 h-3' />
                            </a>
                          ) : (
                            <span className='text-gray-400'>Not available</span>
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
                              !extractUrl(video.field_6881)
                            }
                            className='p-2 text-purple-600 hover:text-purple-800 hover:bg-purple-100 rounded-full transition-colors disabled:opacity-50 disabled:cursor-not-allowed'
                            title={
                              transcribing !== null
                                ? transcribing === video.id
                                  ? 'Transcribing...'
                                  : 'Another transcription in progress'
                                : !extractUrl(video.field_6881)
                                ? 'No video URL available'
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
    </div>
  );
}
