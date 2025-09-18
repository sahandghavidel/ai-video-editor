'use client';

import React, { useState, useCallback, useEffect, useRef } from 'react';
import { updateBaserowRow, BaserowRow } from '@/lib/baserow-actions';
import { useAppStore } from '@/store/useAppStore';
import { cycleSpeed as cycleThroughSpeeds } from '@/utils/batchOperations';
import {
  Loader2,
  Sparkles,
  X,
  Play,
  Pause,
  Video,
  Square,
  RotateCcw,
  CheckCircle,
  Monitor,
  Settings,
  Volume2,
  VolumeX,
} from 'lucide-react';

// Helper: get original sentence from field_6901

interface SceneCardProps {
  data: BaserowRow[];
  refreshData?: () => void;
  refreshing?: boolean;
  onDataUpdate?: (updatedData: BaserowRow[]) => void;
  onHandlersReady?: (handlers: {
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
  }) => void;
}

export default function SceneCard({
  data,
  refreshData,
  refreshing = false,
  onDataUpdate,
  onHandlersReady,
}: SceneCardProps) {
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editingText, setEditingText] = useState<string>('');
  const [isUpdating, setIsUpdating] = useState<boolean>(false);
  const [isCanceling, setIsCanceling] = useState<boolean>(false);
  const [loadingAudio, setLoadingAudio] = useState<number | null>(null);
  const [loadingVideo, setLoadingVideo] = useState<number | null>(null);
  const [loadingProducedVideo, setLoadingProducedVideo] = useState<
    number | null
  >(null);
  const audioRefs = useRef<Record<number, HTMLAudioElement>>({});
  const videoRefs = useRef<Record<number, HTMLVideoElement>>({});
  const producedVideoRefs = useRef<Record<number, HTMLVideoElement>>({});

  // Use refs to store stable references to props
  const dataRef = useRef(data);
  const onDataUpdateRef = useRef(onDataUpdate);
  const refreshDataRef = useRef(refreshData);

  // Update refs when props change
  useEffect(() => {
    dataRef.current = data;
    onDataUpdateRef.current = onDataUpdate;
    refreshDataRef.current = refreshData;
  }, [data, onDataUpdate, refreshData]);
  const sceneCardRefs = useRef<Record<number, HTMLDivElement>>({});

  // State for improving all sentences
  // OpenRouter model selection - now using global state

  // Global settings from store
  const {
    ttsSettings,
    videoSettings,
    updateTTSSettings,
    updateVideoSettings,
    batchOperations,
    startBatchOperation,
    completeBatchOperation,
    mediaPlayer,
    setPlayingAudio,
    setPlayingVideo,
    setPlayingProducedVideo,
    stopAllMedia,
    modelSelection,
    setSelectedModel,
    setModels,
    setModelsLoading,
    setModelsError,
    setModelSearch,
    fetchModels,
    sceneLoading,
    setProducingTTS,
    setImprovingSentence,
    setSpeedingUpVideo,
    setGeneratingVideo,
  } = useAppStore();

  // Fetch models from API - using global action
  useEffect(() => {
    fetchModels();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Local wrapper for cycling through speeds
  const cycleSpeed = () => {
    cycleThroughSpeeds(videoSettings.selectedSpeed, updateVideoSettings);
  };

  // State for revert loading
  const [revertingId, setRevertingId] = useState<number | null>(null);

  // State for removing TTS
  const [removingTTSId, setRemovingTTSId] = useState<number | null>(null);

  // Revert to original sentence handler
  const handleRevertToOriginal = async (sceneId: number) => {
    const currentScene = data.find((scene) => scene.id === sceneId);
    if (!currentScene) return;
    const originalSentence = currentScene.field_6901;
    if (!originalSentence || originalSentence === currentScene.field_6890)
      return;
    setRevertingId(sceneId);
    // Optimistic update
    const optimisticData = data.map((scene) =>
      scene.id === sceneId ? { ...scene, field_6890: originalSentence } : scene
    );
    onDataUpdate?.(optimisticData);
    try {
      await updateBaserowRow(sceneId, { field_6890: originalSentence });
      refreshData?.();
    } catch (error) {
      console.error('Failed to revert sentence:', error);
      // Revert optimistic update on error
      onDataUpdate?.(data);
    } finally {
      setRevertingId(null);
    }
  };

  // Remove TTS audio handler
  const handleRemoveTTS = async (sceneId: number) => {
    setRemovingTTSId(sceneId);
    // Stop audio if playing
    if (mediaPlayer.playingAudioId === sceneId) {
      handleAudioPause(sceneId);
    }
    // Optimistic update
    const optimisticData = data.map((scene) =>
      scene.id === sceneId ? { ...scene, field_6891: '' } : scene
    );
    onDataUpdate?.(optimisticData);
    try {
      await updateBaserowRow(sceneId, { field_6891: '' });
      refreshData?.();
    } catch (error) {
      console.error('Failed to remove TTS:', error);
      // Revert optimistic update on error
      onDataUpdate?.(data);
    } finally {
      setRemovingTTSId(null);
    }
  };

  // Speed up video handler
  const handleSpeedUpVideo = async (sceneId: number) => {
    const currentScene = data.find((scene) => scene.id === sceneId);
    if (!currentScene) return;

    const videoUrl = currentScene.field_6888 as string;
    if (!videoUrl || typeof videoUrl !== 'string' || !videoUrl.trim()) {
      alert('No video found in field 6888 to speed up');
      return;
    }

    setSpeedingUpVideo(sceneId);

    try {
      console.log(
        'Starting speed-up for scene:',
        sceneId,
        'with video:',
        videoUrl
      );

      const response = await fetch('/api/speed-up-video', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          sceneId,
          videoUrl,
          speed: videoSettings.selectedSpeed,
          muteAudio: videoSettings.muteAudio,
        }),
      });

      if (!response.ok) {
        let errorMessage = `Speed-up error: ${response.status}`;
        try {
          const errorData = await response.json();
          errorMessage = errorData.error || errorMessage;
        } catch (parseError) {
          errorMessage = `Speed-up error: ${response.status} - ${response.statusText}`;
        }
        throw new Error(errorMessage);
      }

      const result = await response.json();
      console.log('Speed-up result:', result);

      // Optimistic update - update field_6886 with the processed video
      const optimisticData = data.map((scene) =>
        scene.id === sceneId ? { ...scene, field_6886: result.videoUrl } : scene
      );
      onDataUpdate?.(optimisticData);

      // Refresh data from server to ensure consistency
      refreshData?.();
    } catch (error) {
      console.error('Error speeding up video:', error);
      let errorMessage = 'Failed to speed up video';
      if (error instanceof Error) {
        errorMessage = error.message;
      }
      alert(`Error: ${errorMessage}`);
    } finally {
      setSpeedingUpVideo(null);
    }
  };

  // Helper function to scroll a scene card to the top of the screen
  const scrollCardToTop = (sceneId: number) => {
    const cardElement = sceneCardRefs.current[sceneId];
    console.log('Attempting to scroll card for scene:', sceneId);
    console.log('Card element found:', cardElement);

    if (cardElement) {
      // Scroll with a small delay to ensure the state is updated
      setTimeout(() => {
        cardElement.scrollIntoView({
          behavior: 'smooth',
          block: 'start',
          inline: 'nearest',
        });
        console.log('Scroll command executed for scene:', sceneId);
      }, 150);
    } else {
      console.warn('Card element not found for scene:', sceneId);
    }
  };

  const handleEditStart = (sceneId: number, currentText: string) => {
    setEditingId(sceneId);
    setEditingText(currentText);
    setIsCanceling(false);
  };

  const handleEditSave = async (sceneId: number) => {
    if (!editingText.trim()) {
      return;
    }

    const currentScene = data.find((scene) => scene.id === sceneId);
    if (editingText === currentScene?.field_6890) {
      setEditingId(null);
      setEditingText('');
      return;
    }

    setIsUpdating(true);

    // Optimistic update - immediately update the UI
    const optimisticData = data.map((scene) => {
      if (scene.id === sceneId) {
        return { ...scene, field_6890: editingText };
      }
      return scene;
    });
    onDataUpdate?.(optimisticData);

    try {
      // updateBaserowRow returns the updated row data directly or throws an error
      const updatedRow = await updateBaserowRow(sceneId, {
        field_6890: editingText,
      });

      setEditingId(null);
      setEditingText('');

      // Refresh data from server to ensure consistency
      refreshData?.();

      // Auto-generate TTS if option is enabled and text was actually changed
      if (videoSettings.autoGenerateTTS && editingText.trim()) {
        // Wait a moment to ensure the text is properly updated
        setTimeout(() => {
          handleTTSProduce(sceneId, editingText);
        }, 500);
      }
    } catch (error) {
      console.error('Failed to update scene:', error);

      // Revert optimistic update on error
      onDataUpdate?.(data);

      // You could show a user-friendly error message here
    } finally {
      setIsUpdating(false);
    }
  };

  const handleEditCancel = () => {
    setIsCanceling(true);
    setEditingId(null);
    setEditingText('');
    setTimeout(() => setIsCanceling(false), 100); // Reset after a short delay
  };

  const handleKeyDown = (e: React.KeyboardEvent, sceneId: number) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleEditSave(sceneId);
    } else if (e.key === 'Escape') {
      handleEditCancel();
    }
  };

  const handleAudioPlay = async (sceneId: number, audioUrl: string) => {
    try {
      // If the same audio is already playing, pause it
      if (mediaPlayer.playingAudioId === sceneId) {
        const audio = audioRefs.current[sceneId];
        if (audio) {
          audio.pause();
          setPlayingAudio(null);
        }
        return;
      }

      // Stop any currently playing audio
      if (
        mediaPlayer.playingAudioId &&
        audioRefs.current[mediaPlayer.playingAudioId]
      ) {
        audioRefs.current[mediaPlayer.playingAudioId].pause();
        setPlayingAudio(null);
      }

      setLoadingAudio(sceneId);

      // Use the existing audio element from refs
      const audio = audioRefs.current[sceneId];
      if (audio) {
        audio.src = audioUrl;
        audio.currentTime = 0;

        try {
          await audio.play();
          setLoadingAudio(null);
          setPlayingAudio(sceneId);
        } catch (error) {
          console.error('Error playing audio:', error);
          setLoadingAudio(null);
          setPlayingAudio(null);
        }
      }
    } catch (error) {
      console.error('Error in handleAudioPlay:', error);
      setPlayingAudio(null);
      setLoadingAudio(null);
    }
  };

  const handleAudioPause = (sceneId: number) => {
    const audio = audioRefs.current[sceneId];
    if (audio) {
      audio.pause();
      setPlayingAudio(null);
    }
  };

  const handleVideoPlay = async (sceneId: number, videoUrl: string) => {
    try {
      // Stop any currently playing video
      if (
        mediaPlayer.playingVideoId &&
        videoRefs.current[mediaPlayer.playingVideoId]
      ) {
        videoRefs.current[mediaPlayer.playingVideoId].pause();
      }

      // If clicking the same video that's playing, just pause it
      if (mediaPlayer.playingVideoId === sceneId) {
        setPlayingVideo(null);
        return;
      }

      setPlayingVideo(sceneId);
      setLoadingVideo(sceneId);

      // Wait a moment for the video element to be rendered
      setTimeout(() => {
        const video = videoRefs.current[sceneId];
        if (video) {
          video.src = videoUrl;
          video
            .play()
            .then(() => {
              setLoadingVideo(null);
            })
            .catch((error) => {
              console.error('Error playing video:', error);
              setLoadingVideo(null);
              setPlayingVideo(null);
            });
        }
      }, 100);
    } catch (error) {
      console.error('Error in handleVideoPlay:', error);
      setLoadingVideo(null);
      setPlayingVideo(null);
    }
  };

  const handleVideoStop = (sceneId: number) => {
    const video = videoRefs.current[sceneId];
    if (video) {
      video.pause();
      setPlayingVideo(null);
    }
  };

  const handleProducedVideoPlay = async (sceneId: number, videoUrl: string) => {
    try {
      // Stop any currently playing produced video
      if (
        mediaPlayer.playingProducedVideoId &&
        producedVideoRefs.current[mediaPlayer.playingProducedVideoId]
      ) {
        producedVideoRefs.current[mediaPlayer.playingProducedVideoId].pause();
      }

      // If clicking the same video that's playing, just pause it
      if (mediaPlayer.playingProducedVideoId === sceneId) {
        setPlayingProducedVideo(null);
        return;
      }

      setPlayingProducedVideo(sceneId);
      setLoadingProducedVideo(sceneId);

      // Wait a moment for the video element to be rendered, then scroll
      setTimeout(() => {
        // Scroll the card to the top of the screen
        scrollCardToTop(sceneId);

        const video = producedVideoRefs.current[sceneId];
        if (video) {
          video.src = videoUrl;
          video
            .play()
            .then(() => {
              setLoadingProducedVideo(null);
            })
            .catch((error) => {
              console.error('Error playing produced video:', error);
              setLoadingProducedVideo(null);
              setPlayingProducedVideo(null);
            });
        }
      }, 100);
    } catch (error) {
      console.error('Error in handleProducedVideoPlay:', error);
      setLoadingProducedVideo(null);
      setPlayingProducedVideo(null);
    }
  };

  const handleProducedVideoStop = (sceneId: number) => {
    const video = producedVideoRefs.current[sceneId];
    if (video) {
      video.pause();
      setPlayingProducedVideo(null);
    }
  };

  const handleTTSProduce = useCallback(
    async (sceneId: number, text: string) => {
      try {
        setProducingTTS(sceneId);

        // Call our TTS API route that handles generation and MinIO upload
        const response = await fetch('/api/generate-tts', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            text,
            sceneId,
            ttsSettings,
          }),
        });

        if (!response.ok) {
          let errorMessage = `TTS service error: ${response.status}`;
          try {
            const errorData = await response.json();
            errorMessage = errorData.error || errorMessage;
          } catch (parseError) {
            // If response is not JSON, use the status text
            errorMessage = `TTS service error: ${response.status} - ${response.statusText}`;
          }
          throw new Error(errorMessage);
        }

        const result = await response.json();
        const audioUrl = result.audioUrl;

        // Update the Baserow field with the MinIO URL
        const updatedRow = await updateBaserowRow(sceneId, {
          field_6891: audioUrl,
        });

        // Update the local data optimistically
        const updatedData = dataRef.current.map((scene) => {
          if (scene.id === sceneId) {
            return { ...scene, field_6891: audioUrl };
          }
          return scene;
        });
        onDataUpdateRef.current?.(updatedData);

        // Refresh data from server to ensure consistency
        refreshDataRef.current?.();

        // Auto-generate video if option is enabled
        if (videoSettings.autoGenerateVideo) {
          const currentScene = dataRef.current.find(
            (scene) => scene.id === sceneId
          );
          const videoUrl = currentScene?.field_6888;

          if (typeof videoUrl === 'string' && videoUrl) {
            // Wait a moment to ensure the TTS URL is properly updated
            setTimeout(() => {
              handleVideoGenerate(sceneId, videoUrl, audioUrl);
            }, 1000);
          }
        }
      } catch (error) {
        console.error('Error producing TTS:', error);
        // You could show a user-friendly error message here
      } finally {
        setProducingTTS(null);
      }
    },
    [setProducingTTS, ttsSettings, videoSettings.autoGenerateVideo]
  );

  const handleVideoGenerate = useCallback(
    async (sceneId: number, videoUrl: string, audioUrl: string) => {
      try {
        setGeneratingVideo(sceneId);

        // Call our API route instead of directly calling NCA service
        const response = await fetch('/api/generate-video', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            videoUrl,
            audioUrl,
          }),
        });

        if (!response.ok) {
          let errorMessage = `Video generation error: ${response.status}`;
          try {
            const errorData = await response.json();
            errorMessage = errorData.error || errorMessage;
          } catch (parseError) {
            errorMessage = `Video generation error: ${response.status} - ${response.statusText}`;
          }
          throw new Error(errorMessage);
        }

        const result = await response.json();
        const generatedVideoUrl = result.videoUrl;

        // Update the Baserow field with the generated video URL
        const updatedRow = await updateBaserowRow(sceneId, {
          field_6886: generatedVideoUrl,
        });

        // Update the local data optimistically
        const updatedData = dataRef.current.map((scene) => {
          if (scene.id === sceneId) {
            return { ...scene, field_6886: generatedVideoUrl };
          }
          return scene;
        });
        onDataUpdateRef.current?.(updatedData);

        // Refresh data from server to ensure consistency
        refreshDataRef.current?.();
      } catch (error) {
        console.error('Error generating synchronized video:', error);
        // You could show a user-friendly error message here
      } finally {
        setGeneratingVideo(null);
      }
    },
    [setGeneratingVideo]
  );

  const handleSentenceImprovement = useCallback(
    async (
      sceneId: number,
      currentSentence: string,
      modelOverride?: string
    ) => {
      try {
        setImprovingSentence(sceneId);

        // Get all sentences for context
        const allSentences = dataRef.current
          .map((scene) => String(scene['field_6890'] || scene.field_6890 || ''))
          .filter((sentence) => sentence.trim());

        console.log(
          `Improving sentence for scene ${sceneId}: "${currentSentence}"`
        );

        // Call our sentence improvement API route
        const response = await fetch('/api/improve-sentence', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            currentSentence,
            allSentences,
            sceneId,
            model: modelOverride || modelSelection.selectedModel,
          }),
        });

        if (!response.ok) {
          let errorMessage = `Sentence improvement error: ${response.status}`;
          try {
            const errorData = await response.json();
            errorMessage = errorData.error || errorMessage;
          } catch (parseError) {
            errorMessage = `Sentence improvement error: ${response.status} - ${response.statusText}`;
          }
          throw new Error(errorMessage);
        }

        const result = await response.json();
        const improvedSentence = result.improvedSentence;

        console.log(`Improved sentence: "${improvedSentence}"`);

        // Update the Baserow field with the improved sentence
        const updatedRow = await updateBaserowRow(sceneId, {
          field_6890: improvedSentence,
        });

        // Update the local data optimistically
        const updatedData = dataRef.current.map((scene) => {
          if (scene.id === sceneId) {
            return { ...scene, field_6890: improvedSentence };
          }
          return scene;
        });
        onDataUpdateRef.current?.(updatedData);

        // Refresh data from server to ensure consistency
        refreshDataRef.current?.();

        // Auto-generate TTS if option is enabled
        if (videoSettings.autoGenerateTTS && improvedSentence.trim()) {
          // Wait a moment to ensure the text is properly updated
          setTimeout(() => {
            handleTTSProduce(sceneId, improvedSentence);
          }, 1000);
        }
      } catch (error) {
        console.error('Error improving sentence:', error);

        // Show user-friendly error message
        let errorMessage = 'Failed to improve sentence';
        if (error instanceof Error) {
          errorMessage = error.message;
        }

        // You could implement a toast notification or alert here
        alert(`Error: ${errorMessage}`);
      } finally {
        setImprovingSentence(null);
      }
    },
    [
      setImprovingSentence,
      modelSelection.selectedModel,
      videoSettings.autoGenerateTTS,
    ]
  );

  // Expose handler functions to parent component
  useEffect(() => {
    if (onHandlersReady) {
      onHandlersReady({
        handleSentenceImprovement,
        handleTTSProduce,
        handleVideoGenerate,
      });
    }
  }, [
    onHandlersReady,
    handleSentenceImprovement,
    handleTTSProduce,
    handleVideoGenerate,
  ]);

  if (!data || data.length === 0) {
    return (
      <div className='flex flex-col items-center justify-center min-h-[400px] text-gray-500'>
        <div className='text-6xl mb-4'>📋</div>
        <h3 className='text-xl font-semibold mb-2'>No Data Available</h3>
        <p className='text-center max-w-md'>
          No scenes found in your Baserow table. Add some data to get started!
        </p>
        <div className='mt-6 space-y-2'>
          {refreshData && (
            <button
              onClick={refreshData}
              className='px-4 py-2 bg-blue-500 text-white rounded hover:bg-blue-600 transition-colors'
            >
              Refresh Data
            </button>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className='w-full max-w-7xl mx-auto'>
      <div className='grid gap-4'>
        {data.map((scene) => (
          <div
            key={scene.id}
            ref={(el) => {
              if (el) sceneCardRefs.current[scene.id] = el;
            }}
            className='bg-white rounded-lg shadow-md border border-gray-200 p-6 hover:shadow-lg transition-shadow duration-200'
          >
            <div className='flex items-center justify-between'>
              {/* Left side - ID and Order */}
              <div className='flex items-center space-x-8'>
                {/* ID */}
                <div>
                  <label className='text-xs font-semibold text-gray-500 uppercase tracking-wide'>
                    ID
                  </label>
                  <div className='text-2xl font-bold text-blue-600 mt-1'>
                    #{scene.id || 'N/A'}
                  </div>
                </div>

                {/* Order */}
                <div>
                  <label className='text-xs font-semibold text-gray-500 uppercase tracking-wide'>
                    Order
                  </label>
                  <div className='text-lg font-semibold text-gray-800 mt-1'>
                    {scene.order ? Math.round(Number(scene.order)) : 'Not set'}
                  </div>
                </div>
              </div>

              {/* Right side - Sentence */}
              <div className='flex-1 ml-8'>
                <div className='flex items-center justify-between'>
                  <label className='text-xs font-semibold text-gray-500 uppercase tracking-wide'>
                    Sentence{' '}
                    {isUpdating && editingId === scene.id && '(Saving...)'}
                  </label>
                  {/* Media Controls Group */}
                  <div className='flex items-center space-x-2'>
                    {/* Revert to Original Button */}
                    {typeof scene['field_6901'] === 'string' &&
                      scene['field_6901'] &&
                      scene['field_6901'] !== scene['field_6890'] && (
                        <button
                          onClick={() => handleRevertToOriginal(scene.id)}
                          disabled={revertingId === scene.id}
                          className={`flex items-center justify-center space-x-1 px-3 py-1 h-7 min-w-[80px] rounded-full text-xs font-medium transition-colors bg-gray-100 text-gray-700 hover:bg-gray-200 disabled:opacity-50 disabled:cursor-not-allowed`}
                          title='Revert to original sentence'
                        >
                          {revertingId === scene.id ? (
                            <Loader2 className='animate-spin h-3 w-3' />
                          ) : (
                            <RotateCcw className='h-3 w-3' />
                          )}
                          <span>
                            {revertingId === scene.id
                              ? 'Reverting...'
                              : 'Revert'}
                          </span>
                        </button>
                      )}
                    {/* TTS Produce Button */}
                    <button
                      onClick={() =>
                        handleTTSProduce(
                          scene.id,
                          String(scene['field_6890'] || scene.field_6890 || '')
                        )
                      }
                      disabled={
                        sceneLoading.producingTTS !== null ||
                        batchOperations.generatingAllTTS ||
                        !String(
                          scene['field_6890'] || scene.field_6890 || ''
                        ).trim()
                      }
                      className={`flex items-center justify-center space-x-1 px-3 py-1 h-7 min-w-[100px] rounded-full text-xs font-medium transition-colors ${
                        sceneLoading.producingTTS === scene.id
                          ? 'bg-gray-100 text-gray-500'
                          : sceneLoading.producingTTS !== null ||
                            batchOperations.generatingAllTTS
                          ? 'bg-gray-50 text-gray-400'
                          : 'bg-purple-100 text-purple-700 hover:bg-purple-200'
                      } disabled:opacity-50 disabled:cursor-not-allowed`}
                      title={
                        sceneLoading.producingTTS === scene.id
                          ? 'Generating TTS for this scene...'
                          : sceneLoading.producingTTS !== null
                          ? `TTS is being generated for scene ${sceneLoading.producingTTS}`
                          : batchOperations.generatingAllTTS
                          ? 'Batch TTS generation is in progress'
                          : 'Generate TTS from sentence'
                      }
                    >
                      {sceneLoading.producingTTS === scene.id ? (
                        <Loader2 className='animate-spin h-3 w-3' />
                      ) : (
                        <CheckCircle className='h-3 w-3' />
                      )}
                      <span>
                        {sceneLoading.producingTTS === scene.id
                          ? 'Producing...'
                          : sceneLoading.producingTTS !== null ||
                            batchOperations.generatingAllTTS
                          ? 'TTS Busy'
                          : 'Generate TTS'}
                      </span>
                    </button>

                    {/* AI Improvement Button */}
                    <button
                      onClick={() =>
                        handleSentenceImprovement(
                          scene.id,
                          String(scene['field_6890'] || scene.field_6890 || ''),
                          modelSelection.selectedModel || undefined
                        )
                      }
                      disabled={
                        sceneLoading.improvingSentence !== null ||
                        batchOperations.improvingAll ||
                        !String(
                          scene['field_6890'] || scene.field_6890 || ''
                        ).trim()
                      }
                      className={`flex items-center justify-center space-x-1 px-3 py-1 h-7 min-w-[90px] rounded-full text-xs font-medium transition-colors ${
                        sceneLoading.improvingSentence === scene.id
                          ? 'bg-gray-100 text-gray-500'
                          : sceneLoading.improvingSentence !== null ||
                            batchOperations.improvingAll
                          ? 'bg-gray-50 text-gray-400'
                          : 'bg-indigo-100 text-indigo-700 hover:bg-indigo-200'
                      } disabled:opacity-50 disabled:cursor-not-allowed`}
                      title={
                        sceneLoading.improvingSentence === scene.id
                          ? 'Improving this sentence...'
                          : sceneLoading.improvingSentence !== null
                          ? `AI is improving sentence for scene ${sceneLoading.improvingSentence}`
                          : batchOperations.improvingAll
                          ? 'Batch AI improvement is in progress'
                          : modelSelection.selectedModel
                          ? `Improve sentence with AI using: ${modelSelection.selectedModel}`
                          : 'Improve sentence with AI (no model selected)'
                      }
                    >
                      {sceneLoading.improvingSentence === scene.id ? (
                        <Loader2 className='animate-spin h-3 w-3' />
                      ) : (
                        <Sparkles className='h-3 w-3' />
                      )}
                      <span>
                        {sceneLoading.improvingSentence === scene.id
                          ? 'Improving...'
                          : sceneLoading.improvingSentence !== null ||
                            batchOperations.improvingAll
                          ? 'AI Busy'
                          : 'AI Improve'}
                      </span>
                    </button>

                    {/* TTS Audio Button */}
                    {typeof scene['field_6891'] === 'string' &&
                      scene['field_6891'] && (
                        <button
                          onClick={() =>
                            handleAudioPlay(
                              scene.id,
                              scene['field_6891'] as string
                            )
                          }
                          disabled={loadingAudio === scene.id}
                          className={`flex items-center justify-center space-x-1 px-3 py-1 h-7 min-w-[70px] rounded-full text-xs font-medium transition-colors ${
                            mediaPlayer.playingAudioId === scene.id
                              ? 'bg-red-100 text-red-700 hover:bg-red-200'
                              : 'bg-blue-100 text-blue-700 hover:bg-blue-200'
                          } disabled:opacity-50 disabled:cursor-not-allowed`}
                          title={
                            mediaPlayer.playingAudioId === scene.id
                              ? 'Pause audio'
                              : 'Play audio'
                          }
                        >
                          {loadingAudio === scene.id ? (
                            <Loader2 className='animate-spin h-3 w-3' />
                          ) : mediaPlayer.playingAudioId === scene.id ? (
                            <Pause className='h-3 w-3' />
                          ) : (
                            <Play className='h-3 w-3' />
                          )}
                          <span>
                            {mediaPlayer.playingAudioId === scene.id
                              ? 'Pause'
                              : 'Play'}
                          </span>
                        </button>
                      )}

                    {/* Remove TTS Button */}
                    {typeof scene['field_6891'] === 'string' &&
                      scene['field_6891'] && (
                        <button
                          onClick={() => handleRemoveTTS(scene.id)}
                          disabled={removingTTSId === scene.id}
                          className={`flex items-center justify-center space-x-1 px-3 py-1 h-7 min-w-[95px] rounded-full text-xs font-medium transition-colors bg-red-100 text-red-700 hover:bg-red-200 disabled:opacity-50 disabled:cursor-not-allowed`}
                          title='Remove TTS audio'
                        >
                          {removingTTSId === scene.id ? (
                            <Loader2 className='animate-spin h-3 w-3' />
                          ) : (
                            <X className='h-3 w-3' />
                          )}
                          <span>
                            {removingTTSId === scene.id
                              ? 'Removing...'
                              : 'Remove TTS'}
                          </span>
                        </button>
                      )}

                    {/* Video Play Button */}
                    {typeof scene['field_6888'] === 'string' &&
                      scene['field_6888'] && (
                        <button
                          onClick={() =>
                            handleVideoPlay(
                              scene.id,
                              scene['field_6888'] as string
                            )
                          }
                          disabled={loadingVideo === scene.id}
                          className={`flex items-center justify-center space-x-1 px-3 py-1 h-7 min-w-[70px] rounded-full text-xs font-medium transition-colors ${
                            mediaPlayer.playingVideoId === scene.id
                              ? 'bg-purple-100 text-purple-700 hover:bg-purple-200'
                              : 'bg-green-100 text-green-700 hover:bg-green-200'
                          } disabled:opacity-50 disabled:cursor-not-allowed`}
                          title={
                            mediaPlayer.playingVideoId === scene.id
                              ? 'Stop video'
                              : 'Play video'
                          }
                        >
                          {loadingVideo === scene.id ? (
                            <Loader2 className='animate-spin h-3 w-3' />
                          ) : mediaPlayer.playingVideoId === scene.id ? (
                            <Square className='h-3 w-3' />
                          ) : (
                            <Video className='h-3 w-3' />
                          )}
                          <span>
                            {mediaPlayer.playingVideoId === scene.id
                              ? 'Stop'
                              : 'Video'}
                          </span>
                        </button>
                      )}

                    {/* Speed Up Video Button */}
                    {typeof scene['field_6888'] === 'string' &&
                      scene['field_6888'] && (
                        <button
                          onClick={() => handleSpeedUpVideo(scene.id)}
                          disabled={
                            sceneLoading.speedingUpVideo !== null ||
                            batchOperations.speedingUpAllVideos
                          }
                          className={`flex items-center justify-center space-x-1 px-3 py-1 h-7 min-w-[80px] rounded-full text-xs font-medium transition-all duration-300 disabled:opacity-50 disabled:cursor-not-allowed ${
                            sceneLoading.speedingUpVideo === scene.id
                              ? 'bg-gray-100 text-gray-500'
                              : sceneLoading.speedingUpVideo !== null ||
                                batchOperations.speedingUpAllVideos
                              ? 'bg-gray-50 text-gray-400'
                              : 'bg-blue-100 text-blue-700 hover:bg-blue-200'
                          }`}
                          title={
                            sceneLoading.speedingUpVideo === scene.id
                              ? 'Speed up video processing for this scene...'
                              : sceneLoading.speedingUpVideo !== null
                              ? `Video is being sped up for scene ${sceneLoading.speedingUpVideo}`
                              : batchOperations.speedingUpAllVideos
                              ? 'Batch video speed-up is in progress'
                              : `Speed up video ${
                                  videoSettings.selectedSpeed
                                }x and ${
                                  videoSettings.muteAudio ? 'mute' : 'keep'
                                } audio (saves to field 6886)`
                          }
                        >
                          {sceneLoading.speedingUpVideo === scene.id ? (
                            <Loader2 className='animate-spin h-3 w-3' />
                          ) : (
                            <div className='flex items-center space-x-1'>
                              <div
                                onClick={(e) => {
                                  e.stopPropagation();
                                  updateVideoSettings({
                                    muteAudio: !videoSettings.muteAudio,
                                  });
                                }}
                                className='p-0 bg-transparent hover:scale-125 transition-transform duration-200 cursor-pointer'
                                title={`Click to ${
                                  videoSettings.muteAudio ? 'enable' : 'mute'
                                } audio`}
                              >
                                {videoSettings.muteAudio ? (
                                  <VolumeX className='h-3 w-3 text-blue-700' />
                                ) : (
                                  <Volume2 className='h-3 w-3 text-blue-700' />
                                )}
                              </div>
                              <div
                                onClick={(e) => {
                                  e.stopPropagation();
                                  cycleSpeed();
                                }}
                                className='px-1 py-0.5 text-xs font-bold text-blue-700 hover:bg-blue-600/20 rounded transition-colors duration-200 cursor-pointer'
                                title='Click to cycle through speeds (1x → 2x → 4x)'
                              >
                                {videoSettings.selectedSpeed}x
                              </div>
                            </div>
                          )}
                          <span>
                            {sceneLoading.speedingUpVideo === scene.id
                              ? 'Processing...'
                              : sceneLoading.speedingUpVideo !== null ||
                                batchOperations.speedingUpAllVideos
                              ? 'Speed Busy'
                              : 'Speed'}
                          </span>
                        </button>
                      )}

                    {/* Generate Video Button */}
                    {typeof scene['field_6888'] === 'string' &&
                      scene['field_6888'] &&
                      typeof scene['field_6891'] === 'string' &&
                      scene['field_6891'] && (
                        <button
                          onClick={() =>
                            handleVideoGenerate(
                              scene.id,
                              scene['field_6888'] as string,
                              scene['field_6891'] as string
                            )
                          }
                          disabled={
                            sceneLoading.generatingVideo !== null ||
                            batchOperations.generatingAllVideos
                          }
                          className={`flex items-center justify-center space-x-1 px-3 py-1 h-7 min-w-[90px] rounded-full text-xs font-medium transition-colors ${
                            sceneLoading.generatingVideo === scene.id
                              ? 'bg-gray-100 text-gray-500'
                              : sceneLoading.generatingVideo !== null ||
                                batchOperations.generatingAllVideos
                              ? 'bg-gray-50 text-gray-400'
                              : 'bg-teal-100 text-teal-700 hover:bg-teal-200'
                          } disabled:opacity-50 disabled:cursor-not-allowed`}
                          title={
                            sceneLoading.generatingVideo === scene.id
                              ? 'Generating synchronized video for this scene...'
                              : sceneLoading.generatingVideo !== null
                              ? `Video is being generated for scene ${sceneLoading.generatingVideo}`
                              : batchOperations.generatingAllVideos
                              ? 'Batch video generation is in progress'
                              : 'Generate synchronized video'
                          }
                        >
                          {sceneLoading.generatingVideo === scene.id ? (
                            <Loader2 className='animate-spin h-3 w-3' />
                          ) : (
                            <Settings className='h-3 w-3' />
                          )}
                          <span>
                            {sceneLoading.generatingVideo === scene.id
                              ? 'Generating...'
                              : sceneLoading.generatingVideo !== null
                              ? 'Video Busy'
                              : batchOperations.generatingAllVideos
                              ? 'Video Busy'
                              : 'Generate'}
                          </span>
                        </button>
                      )}

                    {/* Produced Video Button */}
                    {typeof scene['field_6886'] === 'string' &&
                      scene['field_6886'] && (
                        <button
                          onClick={() =>
                            handleProducedVideoPlay(
                              scene.id,
                              scene['field_6886'] as string
                            )
                          }
                          disabled={loadingProducedVideo === scene.id}
                          className={`flex items-center justify-center space-x-1 px-3 py-1 h-7 min-w-[85px] rounded-full text-xs font-medium transition-colors ${
                            mediaPlayer.playingProducedVideoId === scene.id
                              ? 'bg-orange-100 text-orange-700 hover:bg-orange-200'
                              : 'bg-yellow-100 text-yellow-700 hover:bg-yellow-200'
                          } disabled:opacity-50 disabled:cursor-not-allowed`}
                          title={
                            mediaPlayer.playingProducedVideoId === scene.id
                              ? 'Stop produced video'
                              : 'Play produced video'
                          }
                        >
                          {loadingProducedVideo === scene.id ? (
                            <Loader2 className='animate-spin h-3 w-3' />
                          ) : mediaPlayer.playingProducedVideoId ===
                            scene.id ? (
                            <Pause className='h-3 w-3' />
                          ) : (
                            <Monitor className='h-3 w-3' />
                          )}
                          <span>
                            {mediaPlayer.playingProducedVideoId === scene.id
                              ? 'Stop'
                              : 'Produced'}
                          </span>
                        </button>
                      )}
                  </div>
                </div>
                {editingId === scene.id ? (
                  <div className='mt-1'>
                    <textarea
                      value={editingText}
                      onChange={(e) => setEditingText(e.target.value)}
                      onKeyDown={(e) => handleKeyDown(e, scene.id)}
                      onBlur={() => {
                        // Only save on blur if we're not canceling
                        if (!isCanceling) {
                          handleEditSave(scene.id);
                        }
                      }}
                      className='w-full p-2 border border-blue-300 rounded focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none'
                      rows={3}
                      autoFocus
                      disabled={isUpdating}
                      placeholder='Enter sentence...'
                    />
                    <div className='flex justify-end space-x-2 mt-2'>
                      <button
                        onClick={handleEditCancel}
                        className='px-3 py-1 text-xs text-gray-600 hover:text-gray-800'
                        disabled={isUpdating}
                      >
                        Cancel
                      </button>
                      <button
                        onClick={() => handleEditSave(scene.id)}
                        className='px-3 py-1 text-xs bg-blue-500 text-white rounded hover:bg-blue-600 disabled:opacity-50'
                        disabled={isUpdating}
                      >
                        Save
                      </button>
                    </div>
                  </div>
                ) : (
                  <div
                    className='text-gray-700 mt-1 leading-relaxed cursor-pointer hover:bg-gray-50 p-2 rounded transition-colors line-clamp-1'
                    onClick={() =>
                      handleEditStart(
                        scene.id,
                        String(scene['field_6890'] || scene.field_6890 || '')
                      )
                    }
                    title='Click to edit'
                  >
                    {String(
                      scene['field_6890'] ||
                        scene.field_6890 ||
                        'No sentence - Click to add'
                    )}
                  </div>
                )}
              </div>
            </div>

            {/* Video Player - Only show when video is playing for this scene */}
            {mediaPlayer.playingVideoId === scene.id && (
              <div className='mt-4 bg-black rounded-lg overflow-hidden'>
                <video
                  ref={(el) => {
                    if (el) videoRefs.current[scene.id] = el;
                  }}
                  controls
                  className='w-full h-auto max-h-96'
                  onEnded={() => {
                    // Video ended - no auto-close
                  }}
                  onError={(e) => {
                    console.error('Video error for scene', scene.id, e);
                    setLoadingVideo(null);
                    setPlayingVideo(null);
                  }}
                >
                  Your browser does not support the video tag.
                </video>
                <div className='flex justify-end p-2 bg-gray-900'>
                  <button
                    onClick={() => handleVideoStop(scene.id)}
                    className='px-3 py-1 text-xs bg-red-600 text-white rounded hover:bg-red-700 transition-colors'
                  >
                    Close Video
                  </button>
                </div>
              </div>
            )}

            {/* Produced Video Player - Only show when produced video is playing for this scene */}
            {mediaPlayer.playingProducedVideoId === scene.id && (
              <div className='mt-4 bg-black rounded-lg overflow-hidden'>
                <video
                  ref={(el) => {
                    if (el) producedVideoRefs.current[scene.id] = el;
                  }}
                  controls
                  className='w-full h-auto max-h-96'
                  onEnded={() => {
                    // Produced video ended - no auto-close
                  }}
                  onError={(e) => {
                    console.error(
                      'Produced video error for scene',
                      scene.id,
                      e
                    );
                    setLoadingProducedVideo(null);
                    setPlayingProducedVideo(null);
                  }}
                >
                  Your browser does not support the video tag.
                </video>
                <div className='flex justify-between items-center p-2 bg-gray-900'>
                  <span className='text-xs text-gray-300'>Produced Video</span>
                  <button
                    onClick={() => handleProducedVideoStop(scene.id)}
                    className='px-3 py-1 text-xs bg-red-600 text-white rounded hover:bg-red-700 transition-colors'
                  >
                    Close Video
                  </button>
                </div>
              </div>
            )}
          </div>
        ))}
      </div>
      {/* Hidden audio elements for playback */}
      {data.map((scene) => (
        <audio
          key={`audio-${scene.id}`}
          ref={(el) => {
            if (el) audioRefs.current[scene.id] = el;
          }}
          onEnded={() => handleAudioPause(scene.id)}
          onError={(e) => {
            console.error('Audio error for scene', scene.id, e);
            setLoadingAudio(null);
            setPlayingAudio(null);
          }}
        />
      ))}
    </div>
  );
}
