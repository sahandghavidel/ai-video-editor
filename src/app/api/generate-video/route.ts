import { NextRequest, NextResponse } from 'next/server';
import { syncVideoWithUpload } from '@/utils/ffmpeg-sync';

export async function POST(request: NextRequest) {
  try {
    const {
      videoUrl,
      audioUrl,
      sceneId,
      videoId,
      zoomLevel = 0,
      panMode = 'none',
    } = await request.json();

    if (!videoUrl || !audioUrl) {
      return NextResponse.json(
        { error: 'Video URL and audio URL are required' },
        { status: 400 }
      );
    }

    console.log(
      `[SYNC] Starting video-audio sync for scene ${
        sceneId || 'unknown'
      } (zoom: ${zoomLevel}%${panMode !== 'none' ? ` ${panMode}` : ''})`
    );
    console.log(`[SYNC] Video URL: ${videoUrl}`);
    console.log(`[SYNC] Audio URL: ${audioUrl}`);

    // Extract timestamp from TTS URL
    // Formats: tts_SCENEID_TIMESTAMP.wav or tts_TIMESTAMP.wav or video_ID_scene_ID_tts_TIMESTAMP.wav
    let ttsTimestamp: string | null = null;

    // Try pattern 1: tts_SCENEID_TIMESTAMP.wav (2 numbers)
    let ttsMatch = audioUrl.match(/tts_\d+_(\d{13})\.wav/);
    if (ttsMatch && ttsMatch[1]) {
      ttsTimestamp = ttsMatch[1];
      console.log(`[SYNC] ✅ Extracted TTS timestamp: ${ttsTimestamp}`);
    } else {
      // Try pattern 2: tts_TIMESTAMP.wav (1 number - 13 digits)
      ttsMatch = audioUrl.match(/tts_(\d{13})\.wav/);
      if (ttsMatch && ttsMatch[1]) {
        ttsTimestamp = ttsMatch[1];
        console.log(`[SYNC] ✅ Extracted TTS timestamp: ${ttsTimestamp}`);
      } else {
        // Try pattern 3: Generic - last 13-digit number before .wav
        ttsMatch = audioUrl.match(/_(\d{13})\.wav/);
        if (ttsMatch && ttsMatch[1]) {
          ttsTimestamp = ttsMatch[1];
          console.log(
            `[SYNC] ✅ Extracted TTS timestamp (generic): ${ttsTimestamp}`
          );
        } else {
          console.log(
            `[SYNC] ⚠️ Could not extract TTS timestamp from: ${audioUrl}`
          );
        }
      }
    }

    // Extract timestamp from video URL
    // Try multiple patterns: clip, speed, or any generic _TIMESTAMP.mp4 pattern
    let clipTimestamp: string | null = null;

    // Pattern 1: clip_TIMESTAMP.mp4
    const clipMatch = videoUrl.match(/clip_(\d+)\.mp4/);
    if (clipMatch && clipMatch[1]) {
      clipTimestamp = clipMatch[1];
      console.log(`[SYNC] ✅ Extracted clip timestamp: ${clipTimestamp}`);
    } else {
      console.log(`[SYNC] ⚠️ No clip pattern found, trying other patterns...`);

      // Pattern 2: speed_TIMESTAMP.mp4
      const speedMatch = videoUrl.match(/speed_(\d+)\.mp4/);
      if (speedMatch && speedMatch[1]) {
        clipTimestamp = speedMatch[1];
        console.log(`[SYNC] ✅ Extracted speed-up timestamp: ${clipTimestamp}`);
      } else {
        // Pattern 3: Generic pattern - any _TIMESTAMP.mp4 at the end
        const genericMatch = videoUrl.match(/_(\d{13})\.mp4/);
        if (genericMatch && genericMatch[1]) {
          clipTimestamp = genericMatch[1];
          console.log(
            `[SYNC] ✅ Extracted generic video timestamp: ${clipTimestamp}`
          );
        } else {
          console.log(
            `[SYNC] ⚠️ Could not extract any timestamp from video URL: ${videoUrl}`
          );
        }
      }
    }

    // Check if sync with both timestamps already exists (including zoom level and pan mode in filename)
    const panSuffix = panMode !== 'none' ? `_${panMode}` : '';
    const zoomSuffix = `_zoom${zoomLevel}${panSuffix}`;
    if (ttsTimestamp && clipTimestamp) {
      const expectedSyncUrl =
        videoId && sceneId
          ? `http://host.docker.internal:9000/nca-toolkit/video_${videoId}_scene_${sceneId}_synced_${ttsTimestamp}_${clipTimestamp}${zoomSuffix}.mp4`
          : `http://host.docker.internal:9000/nca-toolkit/scene_${sceneId}_synced_${ttsTimestamp}_${clipTimestamp}${zoomSuffix}.mp4`;
      try {
        const checkResponse = await fetch(expectedSyncUrl, { method: 'HEAD' });
        if (checkResponse.ok) {
          console.log(
            `[SYNC] Found existing synced video with same TTS, clip timestamps, zoom level and pan mode: ${expectedSyncUrl}`
          );
          console.log(`[SYNC] Skipping regeneration - returning cached sync`);
          return NextResponse.json({
            videoUrl: expectedSyncUrl,
            message: `Using cached synchronized video (TTS: ${ttsTimestamp}, Clip: ${clipTimestamp}, Zoom: ${zoomLevel}%${
              panMode !== 'none' ? ` ${panMode}` : ''
            })`,
            cached: true,
            method: 'cache_hit',
          });
        }
      } catch (checkError) {
        console.log(`[SYNC] No existing sync found, will generate new one`);
      }
    }

    const syncStartTime = Date.now();

    try {
      // Use local FFmpeg sync with hardware acceleration and consistent encoding
      const result = await syncVideoWithUpload({
        videoUrl: videoUrl,
        audioUrl: audioUrl,
        sceneId: sceneId?.toString(),
        videoId: videoId,
        ttsTimestamp: ttsTimestamp || undefined, // Pass the TTS timestamp to preserve it
        clipTimestamp: clipTimestamp || undefined, // Pass the clip timestamp to track video changes
        useHardwareAcceleration: true,
        videoBitrate: '6000k', // Same bitrate as speed-up function for consistent format
        cleanup: true, // Clean up local files after upload
        useAdvancedSync: true, // Use duration-based speed adjustment (like NCA toolkit)
        zoomLevel: zoomLevel, // Pass zoom level to FFmpeg
        panMode: panMode, // Pass pan mode: 'none', 'zoom', or 'topToBottom'
      });

      const syncEndTime = Date.now();
      const processingTime = syncEndTime - syncStartTime;

      console.log(
        `[SYNC] Scene ${
          sceneId || 'unknown'
        } completed in ${processingTime}ms - Hardware accelerated + MinIO uploaded!`
      );
      console.log(
        `[UPLOAD] Scene ${sceneId || 'unknown'} sync uploaded to: ${
          result.uploadUrl
        }`
      );

      return NextResponse.json({
        videoUrl: result.uploadUrl,
        message: `Successfully synchronized video and audio using local FFmpeg`,
        runTime: `${processingTime}ms`,
        method: 'local_ffmpeg_hardware',
      });
    } catch (error) {
      console.error('[SYNC] Local FFmpeg sync failed:', error);
      throw error;
    }
  } catch (error) {
    console.error('Error generating synchronized video:', error);
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : 'Unknown error occurred',
      },
      { status: 500 }
    );
  }
}
