'use client';

import React, { useState, useRef, useEffect } from 'react';
import { BaserowRow } from '@/lib/baserow-actions';
import { useAppStore } from '@/store/useAppStore';
import {
  handleImproveAllSentences,
  handleGenerateAllTTS,
  handleGenerateAllVideos,
  handleConcatenateAllVideos,
  handleSpeedUpAllVideos,
  cycleSpeed as cycleThroughSpeeds,
} from '@/utils/batchOperations';
import {
  Loader2,
  Sparkles,
  Mic,
  Film,
  RefreshCw,
  Volume2,
  VolumeX,
  Download,
  ExternalLink,
  X,
  Play,
  Pause,
  Square,
  Save,
  Upload,
  Trash2,
} from 'lucide-react';

interface BatchOperationsProps {
  data: BaserowRow[];
  onRefresh?: () => void;
  refreshing?: boolean;
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

export default function BatchOperations({
  data,
  onRefresh,
  refreshing = false,
  handleSentenceImprovement,
  handleTTSProduce,
  handleVideoGenerate,
}: BatchOperationsProps) {
  const {
    batchOperations,
    modelSelection,
    videoSettings,
    updateVideoSettings,
    startBatchOperation,
    completeBatchOperation,
    setProducingTTS,
    sceneLoading,
    setImprovingSentence,
    setSpeedingUpVideo,
    setGeneratingVideo,
    mergedVideo,
    setMergedVideo,
    clearMergedVideo,
    saveMergedVideoToOriginalTable,
    selectedOriginalVideo,
    saveSettingsToLocalStorage,
    loadSettingsFromLocalStorage,
    clearLocalStorageSettings,
  } = useAppStore();

  // Video player state
  const [isPlaying, setIsPlaying] = useState(false);
  const [showPlayer, setShowPlayer] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [isDragging, setIsDragging] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);

  // Settings save/load state
  const [showSettingsMenu, setShowSettingsMenu] = useState(false);
  const [saveMessage, setSaveMessage] = useState<string | null>(null);
  const [savingToDatabase, setSavingToDatabase] = useState(false);
  const [saveToDbMessage, setSaveToDbMessage] = useState<string | null>(null);

  // Load settings on component mount
  useEffect(() => {
    loadSettingsFromLocalStorage();
  }, [loadSettingsFromLocalStorage]);

  // Close settings menu when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (showSettingsMenu) {
        setShowSettingsMenu(false);
      }
    };

    document.addEventListener('click', handleClickOutside);
    return () => document.removeEventListener('click', handleClickOutside);
  }, [showSettingsMenu]);

  // Video player controls
  const handlePlayPause = () => {
    const video = videoRef.current;
    if (!video) return;

    if (isPlaying) {
      video.pause();
      setIsPlaying(false);
    } else {
      video.play();
      setIsPlaying(true);
    }
  };

  const handleStop = () => {
    const video = videoRef.current;
    if (!video) return;

    video.pause();
    video.currentTime = 0;
    setIsPlaying(false);
    setCurrentTime(0);
  };

  const handleVideoEnded = () => {
    setIsPlaying(false);
    setCurrentTime(0);
  };

  const handleTimeUpdate = () => {
    const video = videoRef.current;
    if (!video || isDragging) return;

    setCurrentTime(video.currentTime);
  };

  const handleLoadedMetadata = () => {
    const video = videoRef.current;
    if (!video) return;

    setDuration(video.duration);
  };

  const handleSeek = (e: React.ChangeEvent<HTMLInputElement>) => {
    const video = videoRef.current;
    if (!video) return;

    const newTime = parseFloat(e.target.value);
    video.currentTime = newTime;
    setCurrentTime(newTime);
  };

  const handleSeekStart = () => {
    setIsDragging(true);
  };

  const handleSeekEnd = () => {
    setIsDragging(false);
  };

  const formatTime = (time: number) => {
    const minutes = Math.floor(time / 60);
    const seconds = Math.floor(time % 60);
    return `${minutes}:${seconds.toString().padStart(2, '0')}`;
  };

  // Settings management functions
  const handleSaveSettings = () => {
    saveSettingsToLocalStorage();
    setSaveMessage('Settings saved successfully!');
    setTimeout(() => setSaveMessage(null), 3000);
  };

  const handleLoadSettings = () => {
    loadSettingsFromLocalStorage();
    setSaveMessage('Settings loaded successfully!');
    setTimeout(() => setSaveMessage(null), 3000);
  };

  const handleClearSettings = () => {
    if (
      confirm(
        'Are you sure you want to clear all saved settings? This will reset everything to defaults.'
      )
    ) {
      clearLocalStorageSettings();
      setSaveMessage('Settings cleared and reset to defaults!');
      setTimeout(() => setSaveMessage(null), 3000);
    }
  };

  const handleSaveMergedVideoToDatabase = async () => {
    if (!mergedVideo.url) {
      setSaveToDbMessage('No merged video available to save');
      setTimeout(() => setSaveToDbMessage(null), 3000);
      return;
    }

    if (!selectedOriginalVideo.id) {
      setSaveToDbMessage('Please select an original video first');
      setTimeout(() => setSaveToDbMessage(null), 3000);
      return;
    }

    setSavingToDatabase(true);
    setSaveToDbMessage(null);

    try {
      await saveMergedVideoToOriginalTable();
      setSaveToDbMessage('Merged video URL saved to database successfully!');
      setTimeout(() => setSaveToDbMessage(null), 3000);
    } catch (error) {
      console.error('Failed to save merged video to database:', error);
      setSaveToDbMessage('Failed to save to database. Please try again.');
      setTimeout(() => setSaveToDbMessage(null), 5000);
    } finally {
      setSavingToDatabase(false);
    }
  };

  const onImproveAllSentences = () => {
    handleImproveAllSentences(
      data,
      handleSentenceImprovement,
      modelSelection.selectedModel,
      startBatchOperation,
      completeBatchOperation,
      setImprovingSentence
    );
  };

  const onGenerateAllTTS = () => {
    handleGenerateAllTTS(
      data,
      handleTTSProduce,
      startBatchOperation,
      completeBatchOperation,
      setProducingTTS
    );
  };

  const onGenerateAllVideos = () => {
    handleGenerateAllVideos(
      data,
      handleVideoGenerate,
      startBatchOperation,
      completeBatchOperation,
      setGeneratingVideo,
      onRefresh
    );
  };

  const onConcatenateAllVideos = () => {
    handleConcatenateAllVideos(
      data,
      startBatchOperation,
      completeBatchOperation,
      setMergedVideo
    );
  };

  const onSpeedUpAllVideos = () => {
    handleSpeedUpAllVideos(
      data,
      videoSettings.selectedSpeed,
      videoSettings.muteAudio,
      onRefresh,
      startBatchOperation,
      completeBatchOperation,
      setSpeedingUpVideo
    );
  };

  const cycleSpeed = () => {
    cycleThroughSpeeds(videoSettings.selectedSpeed, updateVideoSettings);
  };

  return (
    <div className='relative bg-white rounded-xl shadow-lg border border-gray-200 p-6 mb-8'>
      {/* Header Section */}
      <div className='flex flex-col lg:flex-row lg:items-center lg:justify-between mb-6'>
        <div className='mb-4 lg:mb-0'>
          <h2 className='text-3xl font-bold text-gray-900 mb-2'>
            Batch Operations
          </h2>
          <p className='text-gray-600 flex items-center gap-2'>
            <span className='inline-flex items-center justify-center w-6 h-6 bg-blue-100 text-blue-800 text-sm font-medium rounded-full'>
              {data.length}
            </span>
            scene{data.length !== 1 ? 's' : ''} available for processing
          </p>
        </div>

        {/* Action Buttons */}
        <div className='flex items-center gap-3 flex-shrink-0'>
          {/* Settings Dropdown */}
          <div className='relative'>
            <button
              onClick={() => setShowSettingsMenu(!showSettingsMenu)}
              className='inline-flex items-center gap-2 px-4 py-2.5 bg-blue-500 hover:bg-blue-600 text-white font-medium rounded-lg transition-all duration-200 shadow-sm hover:shadow-md'
            >
              <Save className='w-4 h-4' />
              <span>Settings</span>
            </button>

            {/* Settings Dropdown Menu */}
            {showSettingsMenu && (
              <div className='absolute right-0 mt-2 w-56 bg-white rounded-lg shadow-lg border border-gray-200 z-10'>
                <div className='p-2'>
                  <button
                    onClick={handleSaveSettings}
                    className='w-full flex items-center gap-2 px-3 py-2 text-left text-gray-700 hover:bg-gray-100 rounded-md transition-colors'
                  >
                    <Save className='w-4 h-4 text-green-600' />
                    <span>Save Settings</span>
                  </button>
                  <button
                    onClick={handleLoadSettings}
                    className='w-full flex items-center gap-2 px-3 py-2 text-left text-gray-700 hover:bg-gray-100 rounded-md transition-colors'
                  >
                    <Upload className='w-4 h-4 text-blue-600' />
                    <span>Load Settings</span>
                  </button>
                  <button
                    onClick={handleClearSettings}
                    className='w-full flex items-center gap-2 px-3 py-2 text-left text-gray-700 hover:bg-gray-100 rounded-md transition-colors'
                  >
                    <Trash2 className='w-4 h-4 text-red-600' />
                    <span>Clear Settings</span>
                  </button>
                </div>
              </div>
            )}
          </div>

          {/* Refresh Button */}
          {onRefresh && (
            <button
              onClick={onRefresh}
              disabled={refreshing}
              className='inline-flex items-center gap-2 px-4 py-2.5 bg-emerald-500 hover:bg-emerald-600 disabled:bg-emerald-300 text-white font-medium rounded-lg transition-all duration-200 shadow-sm hover:shadow-md disabled:cursor-not-allowed min-w-[120px] justify-center'
            >
              <RefreshCw
                className={`w-4 h-4 ${refreshing ? 'animate-spin' : ''}`}
              />
              <span>{refreshing ? 'Refreshing...' : 'Refresh Data'}</span>
            </button>
          )}
        </div>

        {/* Save Message */}
        {saveMessage && (
          <div className='absolute top-0 right-0 mt-16 mr-4 bg-green-100 border border-green-400 text-green-700 px-4 py-2 rounded-lg shadow-md z-20'>
            {saveMessage}
          </div>
        )}
      </div>

      {/* Merged Video Display */}
      {mergedVideo.url && (
        <div className='bg-gradient-to-br from-green-50 to-emerald-100 rounded-lg p-6 border border-green-200 mb-6'>
          <div className='flex items-start justify-between'>
            <div className='flex-1'>
              <div className='flex items-center gap-3 mb-4'>
                <div className='p-2 bg-emerald-500 rounded-lg'>
                  <Film className='w-5 h-5 text-white' />
                </div>
                <div>
                  <h3 className='font-semibold text-emerald-900 text-lg'>
                    Merged Video Ready
                  </h3>
                  <p className='text-sm text-emerald-700'>
                    Created{' '}
                    {mergedVideo.createdAt
                      ? new Date(mergedVideo.createdAt).toLocaleString()
                      : 'now'}
                  </p>
                </div>
              </div>

              {/* Video Player Section */}
              <div className='bg-white rounded-lg p-4 border border-emerald-200 mb-4'>
                <div className='flex items-center justify-between mb-3'>
                  <p className='text-sm text-gray-600 font-medium'>
                    {mergedVideo.fileName}
                  </p>
                  <button
                    onClick={() => setShowPlayer(!showPlayer)}
                    className='text-emerald-600 hover:text-emerald-800 text-sm font-medium'
                  >
                    {showPlayer ? 'Hide Player' : 'Show Player'}
                  </button>
                </div>

                {/* Video Player */}
                {showPlayer && (
                  <div className='mb-4'>
                    <div className='bg-black rounded-lg overflow-hidden'>
                      <video
                        ref={videoRef}
                        src={mergedVideo.url}
                        className='w-full h-auto max-h-96'
                        onEnded={handleVideoEnded}
                        onTimeUpdate={handleTimeUpdate}
                        onLoadedMetadata={handleLoadedMetadata}
                        controls={false}
                        preload='metadata'
                      />
                    </div>
                    {/* Video Controls */}
                    <div className='mt-3 p-3 bg-gray-100 rounded-lg'>
                      {/* Progress Bar */}
                      <div className='mb-3'>
                        <div className='flex items-center gap-2 text-sm text-gray-600 mb-2'>
                          <span>{formatTime(currentTime)}</span>
                          <span>/</span>
                          <span>{formatTime(duration)}</span>
                        </div>
                        <div className='relative'>
                          <input
                            type='range'
                            min='0'
                            max={duration || 0}
                            value={currentTime}
                            onChange={handleSeek}
                            onMouseDown={handleSeekStart}
                            onMouseUp={handleSeekEnd}
                            onTouchStart={handleSeekStart}
                            onTouchEnd={handleSeekEnd}
                            className='w-full h-2 bg-gray-300 rounded-lg appearance-none cursor-pointer focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:ring-opacity-50'
                            style={{
                              background: `linear-gradient(to right, #10b981 0%, #10b981 ${
                                duration ? (currentTime / duration) * 100 : 0
                              }%, #d1d5db ${
                                duration ? (currentTime / duration) * 100 : 0
                              }%, #d1d5db 100%)`,
                            }}
                          />
                        </div>
                      </div>

                      {/* Control Buttons */}
                      <div className='flex items-center gap-2'>
                        <button
                          onClick={handlePlayPause}
                          className='flex items-center justify-center w-10 h-10 bg-emerald-500 hover:bg-emerald-600 text-white rounded-full transition-colors'
                          title={isPlaying ? 'Pause' : 'Play'}
                        >
                          {isPlaying ? (
                            <Pause className='w-5 h-5 ml-0.5' />
                          ) : (
                            <Play className='w-5 h-5 ml-0.5' />
                          )}
                        </button>
                        <button
                          onClick={handleStop}
                          className='flex items-center justify-center w-10 h-10 bg-gray-500 hover:bg-gray-600 text-white rounded-full transition-colors'
                          title='Stop'
                        >
                          <Square className='w-4 h-4' />
                        </button>
                        <div className='flex-1 text-center'>
                          <span className='text-sm text-gray-600'>
                            {isPlaying ? 'Playing' : 'Paused'}
                          </span>
                        </div>
                      </div>
                    </div>
                  </div>
                )}

                {/* Action Buttons */}
                <div className='flex flex-col sm:flex-row gap-3'>
                  <button
                    onClick={() => setShowPlayer(!showPlayer)}
                    className='inline-flex items-center gap-2 px-4 py-2 bg-emerald-500 hover:bg-emerald-600 text-white font-medium rounded-lg transition-all duration-200 shadow-sm hover:shadow-md'
                  >
                    <Play className='w-4 h-4' />
                    {showPlayer ? 'Hide Player' : 'Play Video'}
                  </button>
                  <a
                    href={mergedVideo.url}
                    target='_blank'
                    rel='noopener noreferrer'
                    className='inline-flex items-center gap-2 px-4 py-2 bg-blue-500 hover:bg-blue-600 text-white font-medium rounded-lg transition-all duration-200 shadow-sm hover:shadow-md'
                  >
                    <ExternalLink className='w-4 h-4' />
                    Open in New Tab
                  </a>
                  <a
                    href={mergedVideo.url}
                    download={mergedVideo.fileName}
                    className='inline-flex items-center gap-2 px-4 py-2 bg-purple-500 hover:bg-purple-600 text-white font-medium rounded-lg transition-all duration-200 shadow-sm hover:shadow-md'
                  >
                    <Download className='w-4 h-4' />
                    Download
                  </a>
                  <button
                    onClick={() =>
                      mergedVideo.url &&
                      navigator.clipboard.writeText(mergedVideo.url)
                    }
                    className='inline-flex items-center gap-2 px-4 py-2 bg-gray-500 hover:bg-gray-600 text-white font-medium rounded-lg transition-all duration-200 shadow-sm hover:shadow-md'
                  >
                    <Film className='w-4 h-4' />
                    Copy URL
                  </button>
                  <button
                    onClick={handleSaveMergedVideoToDatabase}
                    disabled={savingToDatabase || !selectedOriginalVideo.id}
                    className={`inline-flex items-center gap-2 px-4 py-2 font-medium rounded-lg transition-all duration-200 shadow-sm hover:shadow-md ${
                      selectedOriginalVideo.id
                        ? 'bg-green-500 hover:bg-green-600 text-white'
                        : 'bg-gray-300 text-gray-500 cursor-not-allowed'
                    }`}
                    title={
                      !selectedOriginalVideo.id
                        ? 'Select an original video first'
                        : 'Save merged video URL to original video database'
                    }
                  >
                    {savingToDatabase ? (
                      <Loader2 className='w-4 h-4 animate-spin' />
                    ) : (
                      <Save className='w-4 h-4' />
                    )}
                    {savingToDatabase ? 'Saving...' : 'Save to Database'}
                  </button>
                </div>

                {/* Save to Database Message */}
                {saveToDbMessage && (
                  <div
                    className={`mt-2 text-sm font-medium ${
                      saveToDbMessage.includes('successfully') ||
                      saveToDbMessage.includes('saved')
                        ? 'text-green-600'
                        : 'text-red-600'
                    }`}
                  >
                    {saveToDbMessage}
                  </div>
                )}
              </div>
            </div>

            <button
              onClick={clearMergedVideo}
              className='ml-4 p-2 text-emerald-600 hover:text-emerald-800 hover:bg-emerald-200 rounded-lg transition-colors'
              title='Dismiss'
            >
              <X className='w-5 h-5' />
            </button>
          </div>
        </div>
      )}

      {/* Operation Cards Grid */}
      <div className='grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-5 gap-4'>
        {/* AI Improve All */}
        <div className='bg-gradient-to-br from-indigo-50 to-indigo-100 rounded-lg p-4 border border-indigo-200'>
          <div className='flex items-center gap-2 mb-3'>
            <div className='p-2 bg-indigo-500 rounded-lg'>
              <Sparkles className='w-4 h-4 text-white' />
            </div>
            <h3 className='font-semibold text-indigo-900'>AI Improve</h3>
          </div>
          <p className='text-sm text-indigo-700 mb-4 leading-relaxed'>
            Enhance all sentences using AI with{' '}
            {modelSelection.selectedModel || 'default model'}
          </p>
          <button
            onClick={onImproveAllSentences}
            disabled={
              batchOperations.improvingAll ||
              sceneLoading.improvingSentence !== null
            }
            className='w-full h-12 bg-indigo-500 hover:bg-indigo-600 disabled:bg-indigo-300 text-white font-medium rounded-lg transition-all duration-200 flex items-center justify-center gap-2 shadow-sm hover:shadow-md disabled:cursor-not-allowed'
            title={
              batchOperations.improvingAll
                ? 'Improving all sentences with AI...'
                : sceneLoading.improvingSentence !== null
                ? `AI is improving sentence for scene ${sceneLoading.improvingSentence}`
                : 'Improve all sentences with AI'
            }
          >
            {(batchOperations.improvingAll ||
              sceneLoading.improvingSentence !== null) && (
              <Loader2 className='w-4 h-4 animate-spin' />
            )}
            <span className='font-medium'>
              {batchOperations.improvingAll
                ? sceneLoading.improvingSentence !== null
                  ? `Scene #${sceneLoading.improvingSentence}`
                  : 'Processing...'
                : sceneLoading.improvingSentence !== null
                ? `Busy (#${sceneLoading.improvingSentence})`
                : 'Improve All'}
            </span>
          </button>
        </div>

        {/* Generate TTS */}
        <div className='bg-gradient-to-br from-purple-50 to-purple-100 rounded-lg p-4 border border-purple-200'>
          <div className='flex items-center gap-2 mb-3'>
            <div className='p-2 bg-purple-500 rounded-lg'>
              <Mic className='w-4 h-4 text-white' />
            </div>
            <h3 className='font-semibold text-purple-900'>Generate TTS</h3>
          </div>
          <p className='text-sm text-purple-700 mb-4 leading-relaxed'>
            Create audio from text for all scenes missing TTS audio
          </p>
          <button
            onClick={onGenerateAllTTS}
            disabled={
              batchOperations.generatingAllTTS ||
              sceneLoading.producingTTS !== null
            }
            className='w-full h-12 bg-purple-500 hover:bg-purple-600 disabled:bg-purple-300 text-white font-medium rounded-lg transition-all duration-200 flex items-center justify-center gap-2 shadow-sm hover:shadow-md disabled:cursor-not-allowed'
            title={
              batchOperations.generatingAllTTS
                ? 'Generating TTS for all scenes...'
                : sceneLoading.producingTTS !== null
                ? `TTS is being generated for scene ${sceneLoading.producingTTS}`
                : 'Generate TTS for all scenes'
            }
          >
            {(batchOperations.generatingAllTTS ||
              sceneLoading.producingTTS !== null) && (
              <Loader2 className='w-4 h-4 animate-spin' />
            )}
            <span className='font-medium'>
              {batchOperations.generatingAllTTS
                ? sceneLoading.producingTTS !== null
                  ? `Scene #${sceneLoading.producingTTS}`
                  : 'Processing...'
                : sceneLoading.producingTTS !== null
                ? `Busy (#${sceneLoading.producingTTS})`
                : 'Generate All'}
            </span>
          </button>
        </div>

        {/* Generate Videos */}
        <div className='bg-gradient-to-br from-teal-50 to-teal-100 rounded-lg p-4 border border-teal-200'>
          <div className='flex items-center gap-2 mb-3'>
            <div className='p-2 bg-teal-500 rounded-lg'>
              <Film className='w-4 h-4 text-white' />
            </div>
            <h3 className='font-semibold text-teal-900'>Sync Videos</h3>
          </div>
          <p className='text-sm text-teal-700 mb-4 leading-relaxed'>
            Create synchronized videos for scenes with video and TTS audio
          </p>
          <button
            onClick={onGenerateAllVideos}
            disabled={
              batchOperations.generatingAllVideos ||
              sceneLoading.generatingVideo !== null
            }
            className='w-full h-12 bg-teal-500 hover:bg-teal-600 disabled:bg-teal-300 text-white font-medium rounded-lg transition-all duration-200 flex items-center justify-center gap-2 shadow-sm hover:shadow-md disabled:cursor-not-allowed'
            title={
              batchOperations.generatingAllVideos
                ? 'Generate videos for all scenes with TTS audio...'
                : sceneLoading.generatingVideo !== null
                ? `Video is being generated for scene ${sceneLoading.generatingVideo}`
                : 'Generate synchronized videos'
            }
          >
            {(batchOperations.generatingAllVideos ||
              sceneLoading.generatingVideo !== null) && (
              <Loader2 className='w-4 h-4 animate-spin' />
            )}
            <span className='font-medium'>
              {batchOperations.generatingAllVideos
                ? sceneLoading.generatingVideo !== null
                  ? `Scene #${sceneLoading.generatingVideo}`
                  : 'Processing...'
                : sceneLoading.generatingVideo !== null
                ? `Busy (#${sceneLoading.generatingVideo})`
                : 'Sync All'}
            </span>
          </button>
        </div>

        {/* Speed Up Videos */}
        <div className='bg-gradient-to-br from-blue-50 to-blue-100 rounded-lg p-4 border border-blue-200'>
          <div className='flex items-center gap-2 mb-3'>
            <div className='p-2 bg-blue-500 rounded-lg flex items-center gap-1'>
              {videoSettings.muteAudio ? (
                <VolumeX className='w-4 h-4 text-white' />
              ) : (
                <Volume2 className='w-4 h-4 text-white' />
              )}
              <span className='text-white text-xs font-bold'>
                {videoSettings.selectedSpeed}x
              </span>
            </div>
            <h3 className='font-semibold text-blue-900'>Speed Up</h3>
          </div>
          <div className='flex items-center gap-2 mb-3'>
            <button
              onClick={() =>
                updateVideoSettings({ muteAudio: !videoSettings.muteAudio })
              }
              className='flex items-center gap-1 px-2 py-1 bg-blue-200 hover:bg-blue-300 text-blue-800 text-xs font-medium rounded transition-colors'
              title={`Click to ${
                videoSettings.muteAudio ? 'enable' : 'mute'
              } audio`}
            >
              {videoSettings.muteAudio ? (
                <VolumeX className='w-3 h-3' />
              ) : (
                <Volume2 className='w-3 h-3' />
              )}
              {videoSettings.muteAudio ? 'Muted' : 'Audio'}
            </button>
            <button
              onClick={cycleSpeed}
              className='px-2 py-1 bg-blue-200 hover:bg-blue-300 text-blue-800 text-xs font-bold rounded transition-colors'
              title='Click to cycle through speeds (1x → 2x → 4x)'
            >
              {videoSettings.selectedSpeed}x
            </button>
          </div>
          <button
            onClick={onSpeedUpAllVideos}
            disabled={
              batchOperations.speedingUpAllVideos ||
              sceneLoading.speedingUpVideo !== null
            }
            className='w-full h-12 bg-blue-500 hover:bg-blue-600 disabled:bg-blue-300 text-white font-medium rounded-lg transition-all duration-200 flex items-center justify-center gap-2 shadow-sm hover:shadow-md disabled:cursor-not-allowed'
            title={`Speed up all videos ${videoSettings.selectedSpeed}x and ${
              videoSettings.muteAudio ? 'mute' : 'keep'
            } audio`}
          >
            {(batchOperations.speedingUpAllVideos ||
              sceneLoading.speedingUpVideo !== null) && (
              <Loader2 className='w-4 h-4 animate-spin' />
            )}
            <span className='font-medium'>
              {batchOperations.speedingUpAllVideos
                ? sceneLoading.speedingUpVideo !== null
                  ? `Scene #${sceneLoading.speedingUpVideo}`
                  : 'Processing...'
                : sceneLoading.speedingUpVideo !== null
                ? `Busy (#${sceneLoading.speedingUpVideo})`
                : 'Speed Up All'}
            </span>
          </button>
        </div>

        {/* Concatenate Videos */}
        <div className='bg-gradient-to-br from-orange-50 to-orange-100 rounded-lg p-4 border border-orange-200'>
          <div className='flex items-center gap-2 mb-3'>
            <div className='p-2 bg-orange-500 rounded-lg'>
              <Film className='w-4 h-4 text-white' />
            </div>
            <h3 className='font-semibold text-orange-900'>Merge Videos</h3>
          </div>
          <p className='text-sm text-orange-700 mb-4 leading-relaxed'>
            Combine all processed videos into one final video file
          </p>
          <button
            onClick={onConcatenateAllVideos}
            disabled={batchOperations.concatenatingVideos}
            className='w-full h-12 bg-orange-500 hover:bg-orange-600 disabled:bg-orange-300 text-white font-medium rounded-lg transition-all duration-200 flex items-center justify-center gap-2 shadow-sm hover:shadow-md disabled:cursor-not-allowed'
            title='Concatenate all videos into one final video'
          >
            {batchOperations.concatenatingVideos && (
              <Loader2 className='w-4 h-4 animate-spin' />
            )}
            <span className='font-medium'>
              {batchOperations.concatenatingVideos ? 'Merging...' : 'Merge All'}
            </span>
          </button>
        </div>
      </div>
    </div>
  );
}
