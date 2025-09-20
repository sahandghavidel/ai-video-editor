'use client';

import React, { useState, useEffect, useRef } from 'react';
import { BaserowRow, getOriginalVideosData } from '@/lib/baserow-actions';
import { useAppStore } from '@/store/useAppStore';
import {
  Loader2,
  Video,
  RefreshCw,
  ExternalLink,
  CheckCircle,
  Clock,
  AlertCircle,
  Upload,
  X,
  Check,
} from 'lucide-react';

export default function OriginalVideosList() {
  const [originalVideos, setOriginalVideos] = useState<BaserowRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [dragOver, setDragOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Global state
  const {
    selectedOriginalVideo,
    setSelectedOriginalVideo,
    saveSettingsToLocalStorage,
    loadSettingsFromLocalStorage,
  } = useAppStore();

  useEffect(() => {
    // Load settings from localStorage on mount
    loadSettingsFromLocalStorage();
  }, [loadSettingsFromLocalStorage]);

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

  const handleDrop = (event: React.DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setDragOver(false);

    const file = event.dataTransfer.files[0];
    if (file) {
      handleFileUpload(file);
    }
  };

  const handleDragOver = (event: React.DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setDragOver(true);
  };

  const handleDragLeave = (event: React.DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setDragOver(false);
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
      setOriginalVideos(data);
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
                  <Upload className='w-4 h-4' />
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
            disabled={refreshing || uploading}
            className='inline-flex items-center gap-2 px-4 py-2 bg-blue-500 hover:bg-blue-600 disabled:bg-blue-300 text-white font-medium rounded-lg transition-all duration-200 shadow-sm hover:shadow-md disabled:cursor-not-allowed'
          >
            <RefreshCw
              className={`w-4 h-4 ${refreshing ? 'animate-spin' : ''}`}
            />
            <span>{refreshing ? 'Refreshing...' : 'Refresh'}</span>
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
                  {selectedOriginalVideo.sceneIds.length > 0
                    ? ` ${selectedOriginalVideo.sceneIds.length} scene${
                        selectedOriginalVideo.sceneIds.length !== 1 ? 's' : ''
                      } linked`
                    : ' No scenes linked'}
                </p>
              </div>
            </div>
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
      )}

      {/* Videos Table */}
      <div
        onDrop={handleDrop}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        className={`transition-all duration-200 rounded-lg ${
          dragOver ? 'bg-blue-50 border-2 border-dashed border-blue-300' : ''
        }`}
      >
        {dragOver && (
          <div className='absolute inset-0 bg-blue-50 bg-opacity-90 flex items-center justify-center z-10 rounded-lg'>
            <div className='text-center'>
              <Upload className='w-12 h-12 text-blue-500 mx-auto mb-4' />
              <p className='text-lg font-medium text-blue-800'>
                Drop video here to upload
              </p>
              <p className='text-sm text-blue-600'>
                Supports video files up to 100MB
              </p>
            </div>
          </div>
        )}

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
                  <th className='text-left py-3 px-4 font-semibold text-gray-700 w-12'>
                    Select
                  </th>
                  <th className='text-left py-3 px-4 font-semibold text-gray-700'>
                    ID
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
                </tr>
              </thead>
              <tbody>
                {originalVideos.map((video, index) => {
                  const isSelected = isRowSelected(video.id);
                  return (
                    <tr
                      key={video.id}
                      onClick={() => handleRowClick(video)}
                      className={`border-b border-gray-100 transition-all duration-200 cursor-pointer ${
                        isSelected
                          ? 'bg-blue-50 hover:bg-blue-100 border-blue-200'
                          : index % 2 === 0
                          ? 'bg-white hover:bg-gray-50'
                          : 'bg-gray-50/50 hover:bg-gray-100'
                      }`}
                    >
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
