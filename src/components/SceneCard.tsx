'use client';

import { BaserowRow, updateBaserowRow } from '@/lib/baserow-actions';
import { useState, useRef, useEffect } from 'react';

// Helper: get original sentence from field_6901

interface SceneCardProps {
  data: BaserowRow[];
  refreshData?: () => void;
  onDataUpdate?: (updatedData: BaserowRow[]) => void;
}

export default function SceneCard({
  data,
  refreshData,
  onDataUpdate,
}: SceneCardProps) {
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editingText, setEditingText] = useState<string>('');
  const [isUpdating, setIsUpdating] = useState<boolean>(false);
  const [isCanceling, setIsCanceling] = useState<boolean>(false);
  const [playingId, setPlayingId] = useState<number | null>(null);
  const [loadingAudio, setLoadingAudio] = useState<number | null>(null);
  const [playingVideoId, setPlayingVideoId] = useState<number | null>(null);
  const [loadingVideo, setLoadingVideo] = useState<number | null>(null);
  const [playingProducedVideoId, setPlayingProducedVideoId] = useState<
    number | null
  >(null);
  const [loadingProducedVideo, setLoadingProducedVideo] = useState<
    number | null
  >(null);
  const [producingTTS, setProducingTTS] = useState<number | null>(null);
  const [generatingVideo, setGeneratingVideo] = useState<number | null>(null);
  const [improvingSentence, setImprovingSentence] = useState<number | null>(
    null
  );
  const [speedingUpVideo, setSpeedingUpVideo] = useState<number | null>(null);
  const [autoGenerateVideo, setAutoGenerateVideo] = useState<boolean>(true);
  const [autoGenerateTTS, setAutoGenerateTTS] = useState<boolean>(false);
  const audioRefs = useRef<Record<number, HTMLAudioElement>>({});
  const videoRefs = useRef<Record<number, HTMLVideoElement>>({});
  const producedVideoRefs = useRef<Record<number, HTMLVideoElement>>({});
  const sceneCardRefs = useRef<Record<number, HTMLDivElement>>({});

  // State for improving all sentences
  // OpenRouter model selection
  const [models, setModels] = useState<any[]>([]);
  const [modelsLoading, setModelsLoading] = useState(false);
  const [modelsError, setModelsError] = useState<string | null>(null);
  const [selectedModel, setSelectedModel] = useState<string | null>(
    'deepseek/deepseek-r1:free'
  );
  const [modelSearch, setModelSearch] = useState('free');

  // TTS Settings
  const [ttsSettings, setTtsSettings] = useState({
    temperature: 0.8,
    exaggeration: 0.3,
    cfg_weight: 0.5,
    seed: 1212,
    reference_audio_filename: 'calmS5wave.wav',
  });

  // Fetch models from API
  const fetchModels = async () => {
    setModelsLoading(true);
    setModelsError(null);
    try {
      const res = await fetch('/api/openrouter-models');
      if (!res.ok) {
        const text = await res.text();
        throw new Error(text || `Model fetch failed: ${res.status}`);
      }
      const json = await res.json();
      setModels(json.data || []);
      // Set default model if not set
      if (!selectedModel && json.data && json.data.length > 0) {
        setSelectedModel(json.data[0].id);
      }
    } catch (err) {
      setModelsError(err instanceof Error ? err.message : String(err));
      setModels([]);
    } finally {
      setModelsLoading(false);
    }
  };

  useEffect(() => {
    fetchModels();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // State for improving all sentences
  const [improvingAll, setImprovingAll] = useState(false);

  // State for generating TTS for all scenes
  const [generatingAllTTS, setGeneratingAllTTS] = useState(false);

  // State for concatenating all videos
  const [concatenatingVideos, setConcatenatingVideos] = useState(false);

  // State for batch speed-up all empty scenes
  const [speedingUpAllVideos, setSpeedingUpAllVideos] = useState(false);

  // Improve all sentences handler
  // Helper to wait for a given ms
  const wait = (ms: number) =>
    new Promise((resolve) => setTimeout(resolve, ms));

  const handleImproveAllSentences = async () => {
    setImprovingAll(true);
    for (const scene of data) {
      const currentSentence = String(
        scene['field_6890'] || scene.field_6890 || ''
      );
      const originalSentence = String(scene['field_6901'] || '');
      // Only improve if the sentence is the same as the original
      if (currentSentence === originalSentence && currentSentence.trim()) {
        await handleSentenceImprovement(
          scene.id,
          currentSentence,
          selectedModel || undefined
        );
        await wait(10000); // 10 seconds delay
      }
      // Otherwise skip
    }
    setImprovingAll(false);
  };

  // Generate TTS for all scenes that have text but no TTS audio
  const handleGenerateAllTTS = async () => {
    setGeneratingAllTTS(true);
    for (const scene of data) {
      const currentSentence = String(
        scene['field_6890'] || scene.field_6890 || ''
      );
      const hasAudio =
        scene['field_6891'] && String(scene['field_6891']).trim();

      // Only generate TTS if scene has text but no audio
      if (currentSentence.trim() && !hasAudio) {
        await handleTTSProduce(scene.id, currentSentence);
        await wait(3000); // 3 seconds delay between generations
      }
    }
    setGeneratingAllTTS(false);
  };

  // Concatenate all videos handler
  const handleConcatenateAllVideos = async () => {
    setConcatenatingVideos(true);
    try {
      // Filter scenes that have videos (field_6886) and sort by order
      const scenesWithVideos = data
        .filter((scene) => {
          const videoUrl = scene['field_6886'];
          return typeof videoUrl === 'string' && videoUrl.trim();
        })
        .sort((a, b) => {
          const orderA = Number(a.order) || 0;
          const orderB = Number(b.order) || 0;
          return orderA - orderB;
        });

      if (scenesWithVideos.length === 0) {
        alert('No videos found to concatenate');
        return;
      }

      // Prepare video URLs for concatenation
      const videoUrls = scenesWithVideos.map((scene) => ({
        video_url: scene['field_6886'] as string,
      }));

      console.log('Concatenating videos:', videoUrls);

      // Call the video concatenation API
      const response = await fetch('/api/concatenate-videos', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          video_urls: videoUrls,
          id: `concatenate_${Date.now()}`,
        }),
      });

      if (!response.ok) {
        let errorMessage = `Video concatenation error: ${response.status}`;
        try {
          const errorData = await response.json();
          errorMessage = errorData.error || errorMessage;
        } catch (parseError) {
          errorMessage = `Video concatenation error: ${response.status} - ${response.statusText}`;
        }
        throw new Error(errorMessage);
      }

      const result = await response.json();
      const concatenatedVideoUrl = result.videoUrl;

      console.log('Concatenated video URL:', concatenatedVideoUrl);

      // Show success message with the video URL
      alert(
        `Videos concatenated successfully!\nVideo URL: ${concatenatedVideoUrl}`
      );

      // You could optionally save this URL to a specific field or create a new record
      // For now, just show the URL to the user
    } catch (error) {
      console.error('Error concatenating videos:', error);
      let errorMessage = 'Failed to concatenate videos';
      if (error instanceof Error) {
        errorMessage = error.message;
      }
      alert(`Error: ${errorMessage}`);
    } finally {
      setConcatenatingVideos(false);
    }
  };

  // Speed up all videos (4x) for scenes with empty sentences handler
  const handleSpeedUpAllVideos = async () => {
    setSpeedingUpAllVideos(true);
    try {
      // Filter scenes that have videos (field_6888) but empty sentences (field_6890)
      const scenesToSpeedUp = data.filter((scene) => {
        const videoUrl = scene['field_6888'];
        const sentence = String(scene['field_6890'] || '');
        return (
          typeof videoUrl === 'string' && videoUrl.trim() && !sentence.trim()
        );
      });

      if (scenesToSpeedUp.length === 0) {
        alert('No videos with empty sentences found to speed up');
        return;
      }

      console.log(
        `Processing ${scenesToSpeedUp.length} videos for 4x speed-up...`
      );

      // Process each video sequentially to avoid overwhelming the server
      for (const scene of scenesToSpeedUp) {
        const videoUrl = scene['field_6888'] as string;

        try {
          console.log(`Speeding up video for scene ${scene.id}:`, videoUrl);

          const response = await fetch('/api/speed-up-video', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              sceneId: scene.id,
              videoUrl,
            }),
          });

          if (!response.ok) {
            let errorMessage = `Speed-up error for scene ${scene.id}: ${response.status}`;
            try {
              const errorData = await response.json();
              errorMessage = errorData.error || errorMessage;
            } catch (parseError) {
              errorMessage = `Speed-up error for scene ${scene.id}: ${response.status} - ${response.statusText}`;
            }
            console.error(errorMessage);
            // Continue with next video instead of stopping
            continue;
          }

          const result = await response.json();
          console.log(
            `Speed-up completed for scene ${scene.id}:`,
            result.videoUrl
          );

          // Small delay between requests to be nice to the server
          await wait(1000);
        } catch (error) {
          console.error(
            `Error speeding up video for scene ${scene.id}:`,
            error
          );
          // Continue with next video
        }
      }

      // Refresh data from server to get all updates
      refreshData?.();

      alert(
        `Batch speed-up completed! Processed ${scenesToSpeedUp.length} videos.`
      );
    } catch (error) {
      console.error('Error in batch speed-up:', error);
      let errorMessage = 'Failed to process batch speed-up';
      if (error instanceof Error) {
        errorMessage = error.message;
      }
      alert(`Error: ${errorMessage}`);
    } finally {
      setSpeedingUpAllVideos(false);
    }
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
    if (playingId === sceneId) {
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
      if (autoGenerateTTS && editingText.trim()) {
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
      if (playingId === sceneId) {
        const audio = audioRefs.current[sceneId];
        if (audio) {
          audio.pause();
          setPlayingId(null);
        }
        return;
      }

      // Stop any currently playing audio
      if (playingId && audioRefs.current[playingId]) {
        audioRefs.current[playingId].pause();
        setPlayingId(null);
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
          setPlayingId(sceneId);
        } catch (error) {
          console.error('Error playing audio:', error);
          setLoadingAudio(null);
          setPlayingId(null);
        }
      }
    } catch (error) {
      console.error('Error in handleAudioPlay:', error);
      setPlayingId(null);
      setLoadingAudio(null);
    }
  };

  const handleAudioPause = (sceneId: number) => {
    const audio = audioRefs.current[sceneId];
    if (audio) {
      audio.pause();
      setPlayingId(null);
    }
  };

  const handleVideoPlay = async (sceneId: number, videoUrl: string) => {
    try {
      // Stop any currently playing video
      if (playingVideoId && videoRefs.current[playingVideoId]) {
        videoRefs.current[playingVideoId].pause();
      }

      // If clicking the same video that's playing, just pause it
      if (playingVideoId === sceneId) {
        setPlayingVideoId(null);
        return;
      }

      setPlayingVideoId(sceneId);
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
              setPlayingVideoId(null);
            });
        }
      }, 100);
    } catch (error) {
      console.error('Error in handleVideoPlay:', error);
      setLoadingVideo(null);
      setPlayingVideoId(null);
    }
  };

  const handleVideoStop = (sceneId: number) => {
    const video = videoRefs.current[sceneId];
    if (video) {
      video.pause();
      setPlayingVideoId(null);
    }
  };

  const handleProducedVideoPlay = async (sceneId: number, videoUrl: string) => {
    try {
      // Stop any currently playing produced video
      if (
        playingProducedVideoId &&
        producedVideoRefs.current[playingProducedVideoId]
      ) {
        producedVideoRefs.current[playingProducedVideoId].pause();
      }

      // If clicking the same video that's playing, just pause it
      if (playingProducedVideoId === sceneId) {
        setPlayingProducedVideoId(null);
        return;
      }

      setPlayingProducedVideoId(sceneId);
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
              setPlayingProducedVideoId(null);
            });
        }
      }, 100);
    } catch (error) {
      console.error('Error in handleProducedVideoPlay:', error);
      setLoadingProducedVideo(null);
      setPlayingProducedVideoId(null);
    }
  };

  const handleProducedVideoStop = (sceneId: number) => {
    const video = producedVideoRefs.current[sceneId];
    if (video) {
      video.pause();
      setPlayingProducedVideoId(null);
    }
  };

  const handleTTSProduce = async (sceneId: number, text: string) => {
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
      const updatedData = data.map((scene) => {
        if (scene.id === sceneId) {
          return { ...scene, field_6891: audioUrl };
        }
        return scene;
      });
      onDataUpdate?.(updatedData);

      // Refresh data from server to ensure consistency
      refreshData?.();

      // Auto-generate video if option is enabled
      if (autoGenerateVideo) {
        const currentScene = data.find((scene) => scene.id === sceneId);
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
  };

  const handleVideoGenerate = async (
    sceneId: number,
    videoUrl: string,
    audioUrl: string
  ) => {
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
      const updatedData = data.map((scene) => {
        if (scene.id === sceneId) {
          return { ...scene, field_6886: generatedVideoUrl };
        }
        return scene;
      });
      onDataUpdate?.(updatedData);

      // Refresh data from server to ensure consistency
      refreshData?.();
    } catch (error) {
      console.error('Error generating synchronized video:', error);
      // You could show a user-friendly error message here
    } finally {
      setGeneratingVideo(null);
    }
  };

  const handleSentenceImprovement = async (
    sceneId: number,
    currentSentence: string,
    modelOverride?: string
  ) => {
    try {
      setImprovingSentence(sceneId);

      // Get all sentences for context
      const allSentences = data
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
          model: modelOverride || selectedModel,
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
      const updatedData = data.map((scene) => {
        if (scene.id === sceneId) {
          return { ...scene, field_6890: improvedSentence };
        }
        return scene;
      });
      onDataUpdate?.(updatedData);

      // Refresh data from server to ensure consistency
      refreshData?.();

      // Auto-generate TTS if option is enabled
      if (autoGenerateTTS && improvedSentence.trim()) {
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
  };

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
      {/* OpenRouter model selection */}
      <div className='mb-4 p-3 rounded border border-gray-200 bg-white'>
        <div className='flex items-center justify-between'>
          <div>
            <h3 className='text-sm font-semibold'>OpenRouter Model</h3>
            {modelsLoading ? (
              <p className='text-xs text-gray-500'>Loading models...</p>
            ) : modelsError ? (
              <p className='text-xs text-red-600'>Error: {modelsError}</p>
            ) : models.length > 0 ? (
              <>
                <input
                  type='text'
                  className='mt-1 mb-2 p-2 border rounded text-sm bg-gray-50 w-full'
                  placeholder='Search models...'
                  value={modelSearch}
                  onChange={(e) => setModelSearch(e.target.value)}
                />
                <select
                  className='p-2 border rounded text-sm bg-gray-50 w-full'
                  value={selectedModel || ''}
                  onChange={(e) => setSelectedModel(e.target.value)}
                >
                  {models
                    .filter((m) =>
                      (m.name || m.id)
                        .toLowerCase()
                        .includes(modelSearch.toLowerCase())
                    )
                    .map((m) => (
                      <option key={m.id} value={m.id}>
                        {m.name || m.id}
                      </option>
                    ))}
                </select>
              </>
            ) : (
              <p className='text-xs text-gray-500'>No models available</p>
            )}
          </div>
          <div className='flex items-center space-x-2'>
            <button
              onClick={fetchModels}
              className='px-2 py-1 text-xs bg-blue-500 text-white rounded hover:bg-blue-600'
              title='Refresh model list'
            >
              Refresh
            </button>
          </div>
        </div>
        {selectedModel && (
          <div className='mt-2 text-xs text-gray-500'>
            <span>
              Selected model:{' '}
              <span className='font-medium'>{selectedModel}</span>
            </span>
          </div>
        )}
      </div>
      {/* TTS Settings */}
      <div className='mb-4 p-3 rounded border border-gray-200 bg-white'>
        <h3 className='text-sm font-semibold mb-3'>TTS Settings</h3>
        <div className='grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4'>
          <div>
            <label className='block text-xs font-medium text-gray-700 mb-1'>
              Temperature ({ttsSettings.temperature})
            </label>
            <input
              type='range'
              min='0'
              max='1'
              step='0.1'
              value={ttsSettings.temperature}
              onChange={(e) =>
                setTtsSettings((prev) => ({
                  ...prev,
                  temperature: parseFloat(e.target.value),
                }))
              }
              className='w-full'
            />
          </div>

          <div>
            <label className='block text-xs font-medium text-gray-700 mb-1'>
              Exaggeration ({ttsSettings.exaggeration})
            </label>
            <input
              type='range'
              min='0'
              max='1'
              step='0.1'
              value={ttsSettings.exaggeration}
              onChange={(e) =>
                setTtsSettings((prev) => ({
                  ...prev,
                  exaggeration: parseFloat(e.target.value),
                }))
              }
              className='w-full'
            />
          </div>

          <div>
            <label className='block text-xs font-medium text-gray-700 mb-1'>
              CFG Weight ({ttsSettings.cfg_weight})
            </label>
            <input
              type='range'
              min='0'
              max='1'
              step='0.1'
              value={ttsSettings.cfg_weight}
              onChange={(e) =>
                setTtsSettings((prev) => ({
                  ...prev,
                  cfg_weight: parseFloat(e.target.value),
                }))
              }
              className='w-full'
            />
          </div>

          <div>
            <label className='block text-xs font-medium text-gray-700 mb-1'>
              Seed
            </label>
            <input
              type='number'
              value={ttsSettings.seed}
              onChange={(e) =>
                setTtsSettings((prev) => ({
                  ...prev,
                  seed: parseInt(e.target.value) || 1212,
                }))
              }
              className='w-full p-2 border rounded text-sm'
              min='0'
            />
          </div>

          <div className='md:col-span-2'>
            <label className='block text-xs font-medium text-gray-700 mb-1'>
              Reference Audio Filename
            </label>
            <input
              type='text'
              value={ttsSettings.reference_audio_filename}
              onChange={(e) =>
                setTtsSettings((prev) => ({
                  ...prev,
                  reference_audio_filename: e.target.value,
                }))
              }
              className='w-full p-2 border rounded text-sm'
              placeholder='audio3_enhanced.wav'
            />
          </div>
        </div>
      </div>
      // ...existing code... // Use selectedModel in your LLM requests, e.g.
      pass as a parameter to your API calls
      <div className='flex flex-col md:flex-row md:items-center md:justify-between mb-6 gap-4'>
        <div>
          <h2 className='text-2xl font-bold text-gray-800'>Scenes</h2>
          <p className='text-gray-600 mt-1'>
            {data.length} scene{data.length !== 1 ? 's' : ''} found
          </p>
        </div>
        <div className='flex flex-col md:flex-row gap-2'>
          <button
            onClick={handleImproveAllSentences}
            disabled={improvingAll}
            className='px-4 py-2 bg-indigo-500 text-white rounded hover:bg-indigo-600 transition-colors flex items-center space-x-2 disabled:opacity-50 disabled:cursor-not-allowed'
            title='Improve all sentences with AI'
          >
            {improvingAll ? (
              <svg
                className='animate-spin h-4 w-4'
                xmlns='http://www.w3.org/2000/svg'
                fill='none'
                viewBox='0 0 24 24'
              >
                <circle
                  className='opacity-25'
                  cx='12'
                  cy='12'
                  r='10'
                  stroke='currentColor'
                  strokeWidth='4'
                ></circle>
                <path
                  className='opacity-75'
                  fill='currentColor'
                  d='M4 12a8 8 0 818-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 714 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z'
                ></path>
              </svg>
            ) : (
              <svg className='h-4 w-4' fill='currentColor' viewBox='0 0 20 20'>
                <path
                  fillRule='evenodd'
                  d='M9.504 1.132a1 1 0 01.992 0l1.75 1a1 1 0 11-.992 1.736L10 3.152l-1.254.716a1 1 0 11-.992-1.736l1.75-1zM5.618 4.504a1 1 0 01-.372 1.364L5.016 6l.23.132a1 1 0 11-.992 1.736L3 7.347V8a1 1 0 01-2 0V6a1 1 0 01.504-.868l3-1.732a1 1 0 011.114.104zM14.382 4.504a1 1 0 011.114-.104l3 1.732A1 1 0 0119 6v2a1 1 0 11-2 0v-.653l-1.254.521a1 1 0 11-.992-1.736l.23-.132-.23-.132a1 1 0 01-.372-1.364zM3 9a1 1 0 012 0v3a1 1 0 11-2 0V9zm14 0a1 1 0 012 0v3a1 1 0 11-2 0V9z'
                  clipRule='evenodd'
                />
              </svg>
            )}
            <span>{improvingAll ? 'Improving All...' : 'AI Improve All'}</span>
          </button>
          <button
            onClick={handleGenerateAllTTS}
            disabled={generatingAllTTS}
            className='px-4 py-2 bg-purple-500 text-white rounded hover:bg-purple-600 transition-colors flex items-center space-x-2 disabled:opacity-50 disabled:cursor-not-allowed'
            title='Generate TTS for all scenes that have text but no audio'
          >
            {generatingAllTTS ? (
              <svg
                className='animate-spin h-4 w-4'
                xmlns='http://www.w3.org/2000/svg'
                fill='none'
                viewBox='0 0 24 24'
              >
                <circle
                  className='opacity-25'
                  cx='12'
                  cy='12'
                  r='10'
                  stroke='currentColor'
                  strokeWidth='4'
                ></circle>
                <path
                  className='opacity-75'
                  fill='currentColor'
                  d='M4 12a8 8 0 818-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 714 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z'
                ></path>
              </svg>
            ) : (
              <svg className='h-4 w-4' fill='currentColor' viewBox='0 0 20 20'>
                <path d='M18 3a1 1 0 00-1.196-.98l-10 2A1 1 0 006 5v6.114a4 4 0 10.894 7.96c.045-.021.09-.043.135-.067l8.056-4.028A1 1 0 0016 14V6.732l2-1.732V3z' />
              </svg>
            )}
            <span>
              {generatingAllTTS ? 'Generating TTS...' : 'Generate TTS for All'}
            </span>
          </button>
          <button
            onClick={handleConcatenateAllVideos}
            disabled={concatenatingVideos}
            className='px-4 py-2 bg-orange-500 text-white rounded hover:bg-orange-600 transition-colors flex items-center space-x-2 disabled:opacity-50 disabled:cursor-not-allowed'
            title='Concatenate all videos into one final video'
          >
            {concatenatingVideos ? (
              <svg
                className='animate-spin h-4 w-4'
                xmlns='http://www.w3.org/2000/svg'
                fill='none'
                viewBox='0 0 24 24'
              >
                <circle
                  className='opacity-25'
                  cx='12'
                  cy='12'
                  r='10'
                  stroke='currentColor'
                  strokeWidth='4'
                ></circle>
                <path
                  className='opacity-75'
                  fill='currentColor'
                  d='M4 12a8 8 0 818-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 714 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z'
                ></path>
              </svg>
            ) : (
              <svg className='h-4 w-4' fill='currentColor' viewBox='0 0 20 20'>
                <path d='M2 6a2 2 0 012-2h5l2 2h5a2 2 0 012 2v6a2 2 0 01-2 2H4a2 2 0 01-2-2V6zM14.553 7.106A1 1 0 0014 8v4a1 1 0 00.553.894l2 1A1 1 0 0018 13V7a1 1 0 00-1.447-.894l-2 1z' />
              </svg>
            )}
            <span>
              {concatenatingVideos
                ? 'Concatenating...'
                : 'Concatenate All Videos'}
            </span>
          </button>
          <button
            onClick={handleSpeedUpAllVideos}
            disabled={speedingUpAllVideos}
            className='px-4 py-2 bg-cyan-500 text-white rounded hover:bg-cyan-600 transition-colors flex items-center space-x-2 disabled:opacity-50 disabled:cursor-not-allowed'
            title='Speed up all videos 4x for scenes with empty sentences'
          >
            {speedingUpAllVideos ? (
              <svg
                className='animate-spin h-4 w-4'
                xmlns='http://www.w3.org/2000/svg'
                fill='none'
                viewBox='0 0 24 24'
              >
                <circle
                  className='opacity-25'
                  cx='12'
                  cy='12'
                  r='10'
                  stroke='currentColor'
                  strokeWidth='4'
                ></circle>
                <path
                  className='opacity-75'
                  fill='currentColor'
                  d='M4 12a8 8 0 818-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 714 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z'
                ></path>
              </svg>
            ) : (
              <svg className='h-4 w-4' fill='currentColor' viewBox='0 0 20 20'>
                <path
                  fillRule='evenodd'
                  d='M10 2L3 7v6l7 5 7-5V7l-7-5zM8 8.1l3-1.8V13l-3-1.8V8.1zm2 5.8l3-1.8v-3l-3 1.8v3z'
                  clipRule='evenodd'
                />
              </svg>
            )}
            <span>
              {speedingUpAllVideos
                ? 'Speeding Up All...'
                : 'Speed Up All Videos (4x)'}
            </span>
          </button>
          {refreshData && (
            <button
              onClick={refreshData}
              className='px-4 py-2 bg-green-500 text-white rounded hover:bg-green-600 transition-colors flex items-center space-x-2'
            >
              <svg
                className='w-4 h-4'
                fill='none'
                stroke='currentColor'
                viewBox='0 0 24 24'
              >
                <path
                  strokeLinecap='round'
                  strokeLinejoin='round'
                  strokeWidth={2}
                  d='M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15'
                />
              </svg>
              <span>Refresh</span>
            </button>
          )}
        </div>
      </div>
      {/* Auto-Generate Options */}
      <div className='mb-6 p-4 bg-gray-50 rounded-lg border border-gray-200'>
        <div className='grid grid-cols-1 md:grid-cols-2 gap-4'>
          {/* Auto-Generate TTS */}
          <label className='flex items-center space-x-3 cursor-pointer'>
            <input
              type='checkbox'
              checked={autoGenerateTTS}
              onChange={(e) => setAutoGenerateTTS(e.target.checked)}
              className='w-4 h-4 text-purple-600 bg-gray-100 border-gray-300 rounded focus:ring-purple-500 focus:ring-2'
            />
            <div className='flex flex-col'>
              <span className='text-sm font-medium text-gray-900'>
                Auto-Generate TTS
              </span>
              <span className='text-xs text-gray-500'>
                Automatically create TTS audio when sentence is saved
              </span>
            </div>
          </label>

          {/* Auto-Generate Videos */}
          <label className='flex items-center space-x-3 cursor-pointer'>
            <input
              type='checkbox'
              checked={autoGenerateVideo}
              onChange={(e) => setAutoGenerateVideo(e.target.checked)}
              className='w-4 h-4 text-blue-600 bg-gray-100 border-gray-300 rounded focus:ring-blue-500 focus:ring-2'
            />
            <div className='flex flex-col'>
              <span className='text-sm font-medium text-gray-900'>
                Auto-Generate Videos
              </span>
              <span className='text-xs text-gray-500'>
                Automatically generate synchronized videos after TTS creation
              </span>
            </div>
          </label>
        </div>
      </div>
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
                          className={`flex items-center space-x-1 px-3 py-1 rounded-full text-xs font-medium transition-colors bg-gray-100 text-gray-700 hover:bg-gray-200 disabled:opacity-50 disabled:cursor-not-allowed`}
                          title='Revert to original sentence'
                        >
                          {revertingId === scene.id ? (
                            <svg
                              className='animate-spin h-3 w-3'
                              xmlns='http://www.w3.org/2000/svg'
                              fill='none'
                              viewBox='0 0 24 24'
                            >
                              <circle
                                className='opacity-25'
                                cx='12'
                                cy='12'
                                r='10'
                                stroke='currentColor'
                                strokeWidth='4'
                              ></circle>
                              <path
                                className='opacity-75'
                                fill='currentColor'
                                d='M4 12a8 8 0 818-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 714 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z'
                              ></path>
                            </svg>
                          ) : (
                            <svg
                              className='h-3 w-3'
                              fill='currentColor'
                              viewBox='0 0 20 20'
                            >
                              <path d='M7.293 14.707a1 1 0 010-1.414L10.586 10 7.293 6.707a1 1 0 111.414-1.414l4 4a1 1 0 010 1.414l-4 4a1 1 0 01-1.414 0z' />
                            </svg>
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
                        producingTTS === scene.id ||
                        !String(
                          scene['field_6890'] || scene.field_6890 || ''
                        ).trim()
                      }
                      className={`flex items-center space-x-1 px-3 py-1 rounded-full text-xs font-medium transition-colors ${
                        producingTTS === scene.id
                          ? 'bg-gray-100 text-gray-500'
                          : 'bg-purple-100 text-purple-700 hover:bg-purple-200'
                      } disabled:opacity-50 disabled:cursor-not-allowed`}
                      title='Generate TTS from sentence'
                    >
                      {producingTTS === scene.id ? (
                        <svg
                          className='animate-spin h-3 w-3'
                          xmlns='http://www.w3.org/2000/svg'
                          fill='none'
                          viewBox='0 0 24 24'
                        >
                          <circle
                            className='opacity-25'
                            cx='12'
                            cy='12'
                            r='10'
                            stroke='currentColor'
                            strokeWidth='4'
                          ></circle>
                          <path
                            className='opacity-75'
                            fill='currentColor'
                            d='M4 12a8 8 0 818-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 714 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z'
                          ></path>
                        </svg>
                      ) : (
                        <svg
                          className='h-3 w-3'
                          fill='currentColor'
                          viewBox='0 0 20 20'
                        >
                          <path d='M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z' />
                        </svg>
                      )}
                      <span>
                        {producingTTS === scene.id
                          ? 'Producing...'
                          : 'Generate TTS'}
                      </span>
                    </button>

                    {/* AI Improvement Button */}
                    <button
                      onClick={() =>
                        handleSentenceImprovement(
                          scene.id,
                          String(scene['field_6890'] || scene.field_6890 || ''),
                          selectedModel || undefined
                        )
                      }
                      disabled={
                        improvingSentence === scene.id ||
                        !String(
                          scene['field_6890'] || scene.field_6890 || ''
                        ).trim()
                      }
                      className={`flex items-center space-x-1 px-3 py-1 rounded-full text-xs font-medium transition-colors ${
                        improvingSentence === scene.id
                          ? 'bg-gray-100 text-gray-500'
                          : 'bg-indigo-100 text-indigo-700 hover:bg-indigo-200'
                      } disabled:opacity-50 disabled:cursor-not-allowed`}
                      title='Improve sentence with AI'
                    >
                      {improvingSentence === scene.id ? (
                        <svg
                          className='animate-spin h-3 w-3'
                          xmlns='http://www.w3.org/2000/svg'
                          fill='none'
                          viewBox='0 0 24 24'
                        >
                          <circle
                            className='opacity-25'
                            cx='12'
                            cy='12'
                            r='10'
                            stroke='currentColor'
                            strokeWidth='4'
                          ></circle>
                          <path
                            className='opacity-75'
                            fill='currentColor'
                            d='M4 12a8 8 0 818-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 714 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z'
                          ></path>
                        </svg>
                      ) : (
                        <svg
                          className='h-3 w-3'
                          fill='currentColor'
                          viewBox='0 0 20 20'
                        >
                          <path
                            fillRule='evenodd'
                            d='M9.504 1.132a1 1 0 01.992 0l1.75 1a1 1 0 11-.992 1.736L10 3.152l-1.254.716a1 1 0 11-.992-1.736l1.75-1zM5.618 4.504a1 1 0 01-.372 1.364L5.016 6l.23.132a1 1 0 11-.992 1.736L3 7.347V8a1 1 0 01-2 0V6a1 1 0 01.504-.868l3-1.732a1 1 0 011.114.104zM14.382 4.504a1 1 0 011.114-.104l3 1.732A1 1 0 0119 6v2a1 1 0 11-2 0v-.653l-1.254.521a1 1 0 11-.992-1.736l.23-.132-.23-.132a1 1 0 01-.372-1.364zM3 9a1 1 0 012 0v3a1 1 0 11-2 0V9zm14 0a1 1 0 012 0v3a1 1 0 11-2 0V9z'
                            clipRule='evenodd'
                          />
                        </svg>
                      )}
                      <span>
                        {improvingSentence === scene.id
                          ? 'Improving...'
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
                          className={`flex items-center space-x-1 px-3 py-1 rounded-full text-xs font-medium transition-colors ${
                            playingId === scene.id
                              ? 'bg-red-100 text-red-700 hover:bg-red-200'
                              : 'bg-blue-100 text-blue-700 hover:bg-blue-200'
                          } disabled:opacity-50 disabled:cursor-not-allowed`}
                          title={
                            playingId === scene.id
                              ? 'Pause audio'
                              : 'Play audio'
                          }
                        >
                          {loadingAudio === scene.id ? (
                            <svg
                              className='animate-spin h-3 w-3'
                              xmlns='http://www.w3.org/2000/svg'
                              fill='none'
                              viewBox='0 0 24 24'
                            >
                              <circle
                                className='opacity-25'
                                cx='12'
                                cy='12'
                                r='10'
                                stroke='currentColor'
                                strokeWidth='4'
                              ></circle>
                              <path
                                className='opacity-75'
                                fill='currentColor'
                                d='M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z'
                              ></path>
                            </svg>
                          ) : playingId === scene.id ? (
                            <svg
                              className='h-3 w-3'
                              fill='currentColor'
                              viewBox='0 0 20 20'
                            >
                              <path
                                fillRule='evenodd'
                                d='M18 10a8 8 0 11-16 0 8 8 0 0116 0zM7 8a1 1 0 012 0v4a1 1 0 11-2 0V8zm5-1a1 1 0 00-1 1v4a1 1 0 102 0V8a1 1 0 00-1-1z'
                                clipRule='evenodd'
                              />
                            </svg>
                          ) : (
                            <svg
                              className='h-3 w-3'
                              fill='currentColor'
                              viewBox='0 0 20 20'
                            >
                              <path
                                fillRule='evenodd'
                                d='M10 18a8 8 0 100-16 8 8 0 000 16zM9.555 7.168A1 1 0 008 8v4a1 1 0 001.555.832l3-2a1 1 0 000-1.664l-3-2z'
                                clipRule='evenodd'
                              />
                            </svg>
                          )}
                          <span>
                            {playingId === scene.id ? 'Pause' : 'Play'}
                          </span>
                        </button>
                      )}

                    {/* Remove TTS Button */}
                    {typeof scene['field_6891'] === 'string' &&
                      scene['field_6891'] && (
                        <button
                          onClick={() => handleRemoveTTS(scene.id)}
                          disabled={removingTTSId === scene.id}
                          className={`flex items-center space-x-1 px-3 py-1 rounded-full text-xs font-medium transition-colors bg-red-100 text-red-700 hover:bg-red-200 disabled:opacity-50 disabled:cursor-not-allowed`}
                          title='Remove TTS audio'
                        >
                          {removingTTSId === scene.id ? (
                            <svg
                              className='animate-spin h-3 w-3'
                              xmlns='http://www.w3.org/2000/svg'
                              fill='none'
                              viewBox='0 0 24 24'
                            >
                              <circle
                                className='opacity-25'
                                cx='12'
                                cy='12'
                                r='10'
                                stroke='currentColor'
                                strokeWidth='4'
                              ></circle>
                              <path
                                className='opacity-75'
                                fill='currentColor'
                                d='M4 12a8 8 0 818-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 714 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z'
                              ></path>
                            </svg>
                          ) : (
                            <svg
                              className='h-3 w-3'
                              fill='currentColor'
                              viewBox='0 0 20 20'
                            >
                              <path
                                fillRule='evenodd'
                                d='M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z'
                                clipRule='evenodd'
                              />
                            </svg>
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
                          className={`flex items-center space-x-1 px-3 py-1 rounded-full text-xs font-medium transition-colors ${
                            playingVideoId === scene.id
                              ? 'bg-purple-100 text-purple-700 hover:bg-purple-200'
                              : 'bg-green-100 text-green-700 hover:bg-green-200'
                          } disabled:opacity-50 disabled:cursor-not-allowed`}
                          title={
                            playingVideoId === scene.id
                              ? 'Stop video'
                              : 'Play video'
                          }
                        >
                          {loadingVideo === scene.id ? (
                            <svg
                              className='animate-spin h-3 w-3'
                              xmlns='http://www.w3.org/2000/svg'
                              fill='none'
                              viewBox='0 0 24 24'
                            >
                              <circle
                                className='opacity-25'
                                cx='12'
                                cy='12'
                                r='10'
                                stroke='currentColor'
                                strokeWidth='4'
                              ></circle>
                              <path
                                className='opacity-75'
                                fill='currentColor'
                                d='M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z'
                              ></path>
                            </svg>
                          ) : playingVideoId === scene.id ? (
                            <svg
                              className='h-3 w-3'
                              fill='currentColor'
                              viewBox='0 0 20 20'
                            >
                              <path
                                fillRule='evenodd'
                                d='M10 18a8 8 0 100-16 8 8 0 000 16zM8 7a1 1 0 012 0v6a1 1 0 11-2 0V7zm4 0a1 1 0 012 0v6a1 1 0 11-2 0V7z'
                                clipRule='evenodd'
                              />
                            </svg>
                          ) : (
                            <svg
                              className='h-3 w-3'
                              fill='currentColor'
                              viewBox='0 0 20 20'
                            >
                              <path d='M2 6a2 2 0 012-2h6l2 2h6a2 2 0 012 2v6a2 2 0 01-2 2H4a2 2 0 01-2-2V6zM14.553 7.106A1 1 0 0014 8v4a1 1 0 00.553.894l2 1A1 1 0 0018 13V7a1 1 0 00-1.447-.894l-2 1z' />
                            </svg>
                          )}
                          <span>
                            {playingVideoId === scene.id ? 'Stop' : 'Video'}
                          </span>
                        </button>
                      )}

                    {/* Speed Up Video Button */}
                    {typeof scene['field_6888'] === 'string' &&
                      scene['field_6888'] && (
                        <button
                          onClick={() => handleSpeedUpVideo(scene.id)}
                          disabled={speedingUpVideo === scene.id}
                          className={`flex items-center space-x-1 px-3 py-1 rounded-full text-xs font-medium transition-colors bg-cyan-100 text-cyan-700 hover:bg-cyan-200 disabled:opacity-50 disabled:cursor-not-allowed`}
                          title='Speed up video 4x and remove audio (saves to field 6886)'
                        >
                          {speedingUpVideo === scene.id ? (
                            <svg
                              className='animate-spin h-3 w-3'
                              xmlns='http://www.w3.org/2000/svg'
                              fill='none'
                              viewBox='0 0 24 24'
                            >
                              <circle
                                className='opacity-25'
                                cx='12'
                                cy='12'
                                r='10'
                                stroke='currentColor'
                                strokeWidth='4'
                              ></circle>
                              <path
                                className='opacity-75'
                                fill='currentColor'
                                d='M4 12a8 8 0 818-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 714 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z'
                              ></path>
                            </svg>
                          ) : (
                            <svg
                              className='h-3 w-3'
                              fill='currentColor'
                              viewBox='0 0 20 20'
                            >
                              <path
                                fillRule='evenodd'
                                d='M10 2L3 7v6l7 5 7-5V7l-7-5zM8 8.1l3-1.8V13l-3-1.8V8.1zm2 5.8l3-1.8v-3l-3 1.8v3z'
                                clipRule='evenodd'
                              />
                            </svg>
                          )}
                          <span>
                            {speedingUpVideo === scene.id
                              ? 'Speeding Up...'
                              : '4x Speed'}
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
                          disabled={generatingVideo === scene.id}
                          className={`flex items-center space-x-1 px-3 py-1 rounded-full text-xs font-medium transition-colors bg-teal-100 text-teal-700 hover:bg-teal-200 disabled:opacity-50 disabled:cursor-not-allowed`}
                          title='Generate synchronized video'
                        >
                          {generatingVideo === scene.id ? (
                            <svg
                              className='animate-spin h-3 w-3'
                              xmlns='http://www.w3.org/2000/svg'
                              fill='none'
                              viewBox='0 0 24 24'
                            >
                              <circle
                                className='opacity-25'
                                cx='12'
                                cy='12'
                                r='10'
                                stroke='currentColor'
                                strokeWidth='4'
                              ></circle>
                              <path
                                className='opacity-75'
                                fill='currentColor'
                                d='M4 12a8 8 0 818-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 714 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z'
                              ></path>
                            </svg>
                          ) : (
                            <svg
                              className='h-3 w-3'
                              fill='currentColor'
                              viewBox='0 0 20 20'
                            >
                              <path
                                fillRule='evenodd'
                                d='M3 4a1 1 0 011-1h12a1 1 0 011 1v2a1 1 0 01-1 1H4a1 1 0 01-1-1V4zm0 4a1 1 0 011-1h12a1 1 0 011 1v2a1 1 0 01-1 1H4a1 1 0 01-1-1V8zm0 4a1 1 0 011-1h12a1 1 0 011 1v2a1 1 0 01-1 1H4a1 1 0 01-1-1v-2z'
                                clipRule='evenodd'
                              />
                            </svg>
                          )}
                          <span>
                            {generatingVideo === scene.id
                              ? 'Generating...'
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
                          className={`flex items-center space-x-1 px-3 py-1 rounded-full text-xs font-medium transition-colors ${
                            playingProducedVideoId === scene.id
                              ? 'bg-orange-100 text-orange-700 hover:bg-orange-200'
                              : 'bg-yellow-100 text-yellow-700 hover:bg-yellow-200'
                          } disabled:opacity-50 disabled:cursor-not-allowed`}
                          title={
                            playingProducedVideoId === scene.id
                              ? 'Stop produced video'
                              : 'Play produced video'
                          }
                        >
                          {loadingProducedVideo === scene.id ? (
                            <svg
                              className='animate-spin h-3 w-3'
                              xmlns='http://www.w3.org/2000/svg'
                              fill='none'
                              viewBox='0 0 24 24'
                            >
                              <circle
                                className='opacity-25'
                                cx='12'
                                cy='12'
                                r='10'
                                stroke='currentColor'
                                strokeWidth='4'
                              ></circle>
                              <path
                                className='opacity-75'
                                fill='currentColor'
                                d='M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 714 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z'
                              ></path>
                            </svg>
                          ) : playingProducedVideoId === scene.id ? (
                            <svg
                              className='h-3 w-3'
                              fill='currentColor'
                              viewBox='0 0 20 20'
                            >
                              <path
                                fillRule='evenodd'
                                d='M10 18a8 8 0 100-16 8 8 0 000 16zM8 7a1 1 0 012 0v6a1 1 0 11-2 0V7zm4 0a1 1 0 012 0v6a1 1 0 11-2 0V7z'
                                clipRule='evenodd'
                              />
                            </svg>
                          ) : (
                            <svg
                              className='h-3 w-3'
                              fill='currentColor'
                              viewBox='0 0 20 20'
                            >
                              <path d='M8 5a1 1 0 011-1h3.5a.5.5 0 01.5.5v2a.5.5 0 01-.5.5H10a1 1 0 01-1-1V5zM5 7a2 2 0 012-2h6a2 2 0 012 2v6a2 2 0 01-2 2H7a2 2 0 01-2-2V7zm7 4a1 1 0 100-2 1 1 0 000 2z' />
                            </svg>
                          )}
                          <span>
                            {playingProducedVideoId === scene.id
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
                    className='text-gray-700 mt-1 leading-relaxed cursor-pointer hover:bg-gray-50 p-2 rounded transition-colors'
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
            {playingVideoId === scene.id && (
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
                    setPlayingVideoId(null);
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
            {playingProducedVideoId === scene.id && (
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
                    setPlayingProducedVideoId(null);
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
            setPlayingId(null);
          }}
        />
      ))}
    </div>
  );
}
