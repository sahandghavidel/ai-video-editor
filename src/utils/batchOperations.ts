import { BaserowRow } from '@/lib/baserow-actions';

// Helper to wait for a given ms
export const wait = (ms: number) =>
  new Promise((resolve) => setTimeout(resolve, ms));

// Batch operation: Improve all sentences with AI
export const handleImproveAllSentences = async (
  data: BaserowRow[],
  handleSentenceImprovement: (
    sceneId: number,
    sentence: string,
    model?: string
  ) => Promise<void>,
  selectedModel: string | null,
  startBatchOperation: (operation: 'improvingAll') => void,
  completeBatchOperation: (operation: 'improvingAll') => void,
  setImprovingSentence: (sceneId: number | null) => void
) => {
  startBatchOperation('improvingAll');
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
  completeBatchOperation('improvingAll');
};

// Batch operation: Generate TTS for all scenes that have text but no TTS audio
export const handleGenerateAllTTS = async (
  data: BaserowRow[],
  handleTTSProduce: (sceneId: number, text: string) => Promise<void>,
  startBatchOperation: (operation: 'generatingAllTTS') => void,
  completeBatchOperation: (operation: 'generatingAllTTS') => void,
  setProducingTTS: (sceneId: number | null) => void
) => {
  startBatchOperation('generatingAllTTS');
  for (const scene of data) {
    const currentSentence = String(
      scene['field_6890'] || scene.field_6890 || ''
    );
    const hasAudio = scene['field_6891'] && String(scene['field_6891']).trim();

    // Only generate TTS if scene has text but no audio
    if (currentSentence.trim() && !hasAudio) {
      setProducingTTS(scene.id);
      try {
        await handleTTSProduce(scene.id, currentSentence);
        await wait(3000); // 3 seconds delay between generations
      } finally {
        setProducingTTS(null);
      }
    }
  }
  completeBatchOperation('generatingAllTTS');
};

// Batch operation: Generate videos for all scenes that have both video and TTS audio
export const handleGenerateAllVideos = async (
  data: BaserowRow[],
  handleVideoGenerate: (
    sceneId: number,
    videoUrl: string,
    audioUrl: string
  ) => Promise<void>,
  startBatchOperation: (operation: 'generatingAllVideos') => void,
  completeBatchOperation: (operation: 'generatingAllVideos') => void,
  setGeneratingVideo: (sceneId: number | null) => void,
  onRefresh?: () => void
) => {
  startBatchOperation('generatingAllVideos');

  try {
    // Filter scenes that have both video (field_6888) and TTS audio (field_6891)
    const scenesToGenerate = data.filter((scene) => {
      const videoUrl = scene['field_6888'];
      const audioUrl = scene['field_6891'];
      return (
        typeof videoUrl === 'string' &&
        videoUrl.trim() &&
        typeof audioUrl === 'string' &&
        audioUrl.trim()
      );
    });

    if (scenesToGenerate.length === 0) {
      alert('No scenes found with both video and TTS audio to generate videos');
      return;
    }

    for (const scene of scenesToGenerate) {
      setGeneratingVideo(scene.id);
      try {
        await handleVideoGenerate(
          scene.id,
          scene['field_6888'] as string,
          scene['field_6891'] as string
        );
        await wait(2000); // 2 seconds delay between generations
      } catch (error) {
        console.error(`Error generating video for scene ${scene.id}:`, error);
        // Continue with next video
      } finally {
        setGeneratingVideo(null);
      }
    }

    // Refresh data from server to get all updates
    onRefresh?.();
  } catch (error) {
    console.error('Error in batch video generation:', error);
    let errorMessage = 'Failed to process batch video generation';
    if (error instanceof Error) {
      errorMessage = error.message;
    }
    alert(`Error: ${errorMessage}`);
  } finally {
    completeBatchOperation('generatingAllVideos');
  }
};

// Batch operation: Concatenate all videos into one final video
export const handleConcatenateAllVideos = async (
  data: BaserowRow[],
  startBatchOperation: (operation: 'concatenatingVideos') => void,
  completeBatchOperation: (operation: 'concatenatingVideos') => void
) => {
  startBatchOperation('concatenatingVideos');
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
    completeBatchOperation('concatenatingVideos');
  }
};

// Batch operation: Speed up all videos for scenes with empty sentences
export const handleSpeedUpAllVideos = async (
  data: BaserowRow[],
  selectedSpeed: number,
  muteAudio: boolean,
  onRefresh: (() => void) | undefined,
  startBatchOperation: (operation: 'speedingUpAllVideos') => void,
  completeBatchOperation: (operation: 'speedingUpAllVideos') => void,
  setSpeedingUpVideo: (sceneId: number | null) => void
) => {
  startBatchOperation('speedingUpAllVideos');
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
      `Processing ${scenesToSpeedUp.length} videos for ${selectedSpeed}x speed-up...`
    );

    // Process each video sequentially to avoid overwhelming the server
    for (const scene of scenesToSpeedUp) {
      const videoUrl = scene['field_6888'] as string;

      setSpeedingUpVideo(scene.id);
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
            speed: selectedSpeed,
            muteAudio: muteAudio,
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
        console.error(`Error speeding up video for scene ${scene.id}:`, error);
        // Continue with next video
      } finally {
        setSpeedingUpVideo(null);
      }
    }

    // Refresh data from server to get all updates
    onRefresh?.();
  } catch (error) {
    console.error('Error in batch speed-up:', error);
    let errorMessage = 'Failed to process batch speed-up';
    if (error instanceof Error) {
      errorMessage = error.message;
    }
    alert(`Error: ${errorMessage}`);
  } finally {
    completeBatchOperation('speedingUpAllVideos');
  }
};

// Utility function for cycling through speed options
export const cycleSpeed = (
  currentSpeed: number,
  updateVideoSettings: (updates: { selectedSpeed: number }) => void
) => {
  const speedOptions = [1, 2, 4];
  const currentIndex = speedOptions.indexOf(currentSpeed);
  const nextIndex = (currentIndex + 1) % speedOptions.length;
  updateVideoSettings({ selectedSpeed: speedOptions[nextIndex] });
};
