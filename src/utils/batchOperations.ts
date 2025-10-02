import { BaserowRow } from '@/lib/baserow-actions';
import { playSuccessSound } from './soundManager';

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
  // Play success sound when batch operation completes
  playSuccessSound();
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
  // Play success sound when batch operation completes
  playSuccessSound();
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
    // Play success sound when batch operation completes
    playSuccessSound();
  }
};

// Batch operation: Concatenate all videos into one final video
export const handleConcatenateAllVideos = async (
  data: BaserowRow[],
  startBatchOperation: (operation: 'concatenatingVideos') => void,
  completeBatchOperation: (operation: 'concatenatingVideos') => void,
  setMergedVideo: (url: string, fileName?: string) => void
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

    // Save the merged video URL to global state
    const fileName = `merged-video-${
      new Date().toISOString().split('T')[0]
    }.mp4`;
    setMergedVideo(concatenatedVideoUrl, fileName);

    console.log('Videos concatenated successfully! URL saved to global state.');

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
    // Play success sound when batch operation completes
    playSuccessSound();
  }
};

// Batch operation: Speed up all videos for scenes with empty sentences
export const handleSpeedUpAllVideos = async (
  data: BaserowRow[],
  selectedSpeed: number,
  muteAudio: boolean,
  speedUpMode: 'all' | 'emptyOnly' | 'withTextOnly',
  onRefresh: (() => void) | undefined,
  startBatchOperation: (operation: 'speedingUpAllVideos') => void,
  completeBatchOperation: (operation: 'speedingUpAllVideos') => void,
  setSpeedingUpVideo: (sceneId: number | null) => void
) => {
  startBatchOperation('speedingUpAllVideos');
  try {
    // Filter scenes based on the speedUpMode setting
    const scenesToSpeedUp = data.filter((scene) => {
      const videoUrl = scene['field_6888'];
      const sentence = String(scene['field_6890'] || '');

      // Always require a video to be present
      if (!(typeof videoUrl === 'string' && videoUrl.trim())) {
        return false;
      }

      // Filter based on speed up mode
      switch (speedUpMode) {
        case 'emptyOnly':
          // Only include scenes with empty sentences
          return !sentence.trim();
        case 'withTextOnly':
          // Only include scenes with text content
          return sentence.trim() !== '';
        case 'all':
        default:
          // Include all scenes with videos
          return true;
      }
    });

    if (scenesToSpeedUp.length === 0) {
      const messages = {
        emptyOnly: 'No videos with empty sentences found to speed up',
        withTextOnly: 'No videos with text content found to speed up',
        all: 'No videos found to speed up',
      };
      alert(messages[speedUpMode]);
      return;
    }

    const filterDescriptions = {
      emptyOnly: 'videos with empty sentences',
      withTextOnly: 'videos with text content',
      all: 'videos',
    };
    console.log(
      `Processing ${scenesToSpeedUp.length} ${filterDescriptions[speedUpMode]} for ${selectedSpeed}x speed-up...`
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
    // Play success sound when batch operation completes
    playSuccessSound();
  }
};

// Utility function for cycling through speed options
export const cycleSpeed = (
  currentSpeed: number,
  updateVideoSettings: (updates: { selectedSpeed: number }) => void
) => {
  const speedOptions = [1, 1.125, 1.5, 2, 4, 8];
  const currentIndex = speedOptions.indexOf(currentSpeed);
  const nextIndex = (currentIndex + 1) % speedOptions.length;
  updateVideoSettings({ selectedSpeed: speedOptions[nextIndex] });
};

// Batch operation: Improve all sentences for all videos (not filtered by selected video)
export const handleImproveAllSentencesForAllVideos = async (
  allData: BaserowRow[],
  handleSentenceImprovement: (
    sceneId: number,
    sentence: string,
    model?: string
  ) => Promise<void>,
  selectedModel: string | null,
  setImprovingAllVideos: (isImproving: boolean) => void,
  setCurrentlyProcessingVideo: (videoId: number | null) => void,
  setImprovingSentence: (sceneId: number | null) => void
) => {
  setImprovingAllVideos(true);

  try {
    console.log('=== Starting Improve All Videos Batch Operation ===');
    console.log('Total scenes to process:', allData.length);
    console.log('Selected model:', selectedModel);

    // Group scenes by video ID
    const scenesByVideo = new Map<number, BaserowRow[]>();

    for (const scene of allData) {
      // Extract video ID from field_6889 (Videos ID field - references Original Videos table)
      const videoIdField = scene['field_6889'];
      let videoId: number | null = null;

      console.log(`Scene ${scene.id} field_6889:`, videoIdField);

      if (typeof videoIdField === 'number') {
        videoId = videoIdField;
      } else if (typeof videoIdField === 'string') {
        videoId = parseInt(videoIdField, 10);
      } else if (Array.isArray(videoIdField) && videoIdField.length > 0) {
        // If it's an array, get the first item
        const firstId =
          typeof videoIdField[0] === 'object'
            ? videoIdField[0].id || videoIdField[0].value
            : videoIdField[0];
        videoId = parseInt(String(firstId), 10);
      }

      console.log(`Scene ${scene.id} extracted videoId:`, videoId);

      if (videoId && !isNaN(videoId)) {
        if (!scenesByVideo.has(videoId)) {
          scenesByVideo.set(videoId, []);
        }
        scenesByVideo.get(videoId)?.push(scene);
      } else {
        console.warn(`Scene ${scene.id} has no valid video ID, skipping`);
      }
    }

    console.log(
      `Grouped into ${scenesByVideo.size} videos:`,
      Array.from(scenesByVideo.keys())
    );

    if (scenesByVideo.size === 0) {
      console.warn('No videos found with valid scenes!');
      return;
    }

    let totalProcessed = 0;
    let totalImproved = 0;

    // Process each video's scenes
    for (const [videoId, scenes] of scenesByVideo.entries()) {
      setCurrentlyProcessingVideo(videoId);
      console.log(
        `\n--- Processing video #${videoId} with ${scenes.length} scenes ---`
      );

      for (const scene of scenes) {
        const currentSentence = String(
          scene['field_6890'] || scene.field_6890 || ''
        );
        const originalSentence = String(scene['field_6901'] || '');

        console.log(`Scene ${scene.id}:`);
        console.log('  Current sentence:', currentSentence);
        console.log('  Original sentence:', originalSentence);
        console.log('  Are they equal?', currentSentence === originalSentence);
        console.log('  Has content?', currentSentence.trim() !== '');

        // Only improve if the sentence is the same as the original
        if (currentSentence === originalSentence && currentSentence.trim()) {
          console.log(`  ✓ Will improve scene ${scene.id}`);
          setImprovingSentence(scene.id);
          try {
            await handleSentenceImprovement(
              scene.id,
              currentSentence,
              selectedModel || undefined
            );
            totalImproved++;
            console.log(`  ✓ Successfully improved scene ${scene.id}`);
            await wait(10000); // 10 seconds delay
          } catch (error) {
            console.error(`  ✗ Failed to improve scene ${scene.id}:`, error);
            // Continue with next scene even if one fails
          } finally {
            setImprovingSentence(null);
          }
        } else {
          console.log(
            `  ✗ Skipping scene ${scene.id} (already improved or empty)`
          );
        }
        totalProcessed++;
      }

      console.log(`--- Completed video #${videoId} ---`);
    }

    console.log('\n=== Batch Improvement Summary ===');
    console.log(`Total scenes processed: ${totalProcessed}`);
    console.log(`Total scenes improved: ${totalImproved}`);
    console.log('=================================\n');

    // Play success sound when batch operation completes
    playSuccessSound();
  } catch (error) {
    console.error('Error in batch improvement for all videos:', error);
    throw error;
  } finally {
    setCurrentlyProcessingVideo(null);
    setImprovingAllVideos(false);
  }
};

// Batch operation: Generate TTS for all scenes in all videos (not filtered by selected video)
export const handleGenerateAllTTSForAllVideos = async (
  allData: BaserowRow[],
  handleTTSProduce: (sceneId: number, text: string) => Promise<void>,
  setGeneratingAllVideos: (isGenerating: boolean) => void,
  setCurrentlyProcessingVideo: (videoId: number | null) => void,
  setProducingTTS: (sceneId: number | null) => void
) => {
  setGeneratingAllVideos(true);

  try {
    console.log('=== Starting Generate TTS for All Videos Batch Operation ===');
    console.log('Total scenes to process:', allData.length);

    // Group scenes by video ID
    const scenesByVideo = new Map<number, BaserowRow[]>();

    for (const scene of allData) {
      // Extract video ID from field_6889 (Videos ID field - references Original Videos table)
      const videoIdField = scene['field_6889'];
      let videoId: number | null = null;

      console.log(`Scene ${scene.id} field_6889:`, videoIdField);

      if (typeof videoIdField === 'number') {
        videoId = videoIdField;
      } else if (typeof videoIdField === 'string') {
        videoId = parseInt(videoIdField, 10);
      } else if (Array.isArray(videoIdField) && videoIdField.length > 0) {
        // If it's an array, get the first item
        const firstId =
          typeof videoIdField[0] === 'object'
            ? videoIdField[0].id || videoIdField[0].value
            : videoIdField[0];
        videoId = parseInt(String(firstId), 10);
      }

      console.log(`Scene ${scene.id} extracted videoId:`, videoId);

      if (videoId && !isNaN(videoId)) {
        if (!scenesByVideo.has(videoId)) {
          scenesByVideo.set(videoId, []);
        }
        scenesByVideo.get(videoId)?.push(scene);
      } else {
        console.warn(`Scene ${scene.id} has no valid video ID, skipping`);
      }
    }

    console.log(
      `Grouped into ${scenesByVideo.size} videos:`,
      Array.from(scenesByVideo.keys())
    );

    if (scenesByVideo.size === 0) {
      console.warn('No videos found with valid scenes!');
      return;
    }

    let totalProcessed = 0;
    let totalGenerated = 0;

    // Process each video's scenes
    for (const [videoId, scenes] of scenesByVideo.entries()) {
      setCurrentlyProcessingVideo(videoId);
      console.log(
        `\n--- Processing video #${videoId} with ${scenes.length} scenes ---`
      );

      for (const scene of scenes) {
        const currentSentence = String(
          scene['field_6890'] || scene.field_6890 || ''
        );
        const hasAudio =
          scene['field_6891'] && String(scene['field_6891']).trim();

        console.log(`Scene ${scene.id}:`);
        console.log('  Current sentence:', currentSentence);
        console.log('  Has audio?', !!hasAudio);
        console.log('  Has text content?', currentSentence.trim() !== '');

        // Only generate TTS if scene has text but no audio
        if (currentSentence.trim() && !hasAudio) {
          console.log(`  ✓ Will generate TTS for scene ${scene.id}`);
          setProducingTTS(scene.id);
          try {
            await handleTTSProduce(scene.id, currentSentence);
            totalGenerated++;
            console.log(`  ✓ Successfully generated TTS for scene ${scene.id}`);
            await wait(3000); // 3 seconds delay between generations
          } catch (error) {
            console.error(
              `  ✗ Failed to generate TTS for scene ${scene.id}:`,
              error
            );
            // Continue with next scene even if one fails
          } finally {
            setProducingTTS(null);
          }
        } else {
          console.log(
            `  ✗ Skipping scene ${scene.id} (already has audio or no text)`
          );
        }
        totalProcessed++;
      }

      console.log(`--- Completed video #${videoId} ---`);
    }

    console.log('\n=== Batch TTS Generation Summary ===');
    console.log(`Total scenes processed: ${totalProcessed}`);
    console.log(`Total TTS generated: ${totalGenerated}`);
    console.log('====================================\n');

    // Play success sound when batch operation completes
    playSuccessSound();
  } catch (error) {
    console.error('Error in batch TTS generation for all videos:', error);
    throw error;
  } finally {
    setCurrentlyProcessingVideo(null);
    setGeneratingAllVideos(false);
  }
};
