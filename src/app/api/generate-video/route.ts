import { NextRequest, NextResponse } from 'next/server';
import { syncVideoWithUpload } from '@/utils/ffmpeg-sync';

export async function POST(request: NextRequest) {
  try {
    const { videoUrl, audioUrl, sceneId, videoId } = await request.json();

    if (!videoUrl || !audioUrl) {
      return NextResponse.json(
        { error: 'Video URL and audio URL are required' },
        { status: 400 }
      );
    }

    console.log(
      `[SYNC] Starting video-audio sync for scene ${sceneId || 'unknown'}`
    );
    console.log(`[SYNC] Video URL: ${videoUrl}`);
    console.log(`[SYNC] Audio URL: ${audioUrl}`);

    // Extract timestamp from TTS URL (format: video_123_scene_456_tts_TIMESTAMP.wav or tts_ID_TIMESTAMP.wav)
    let ttsTimestamp: string | null = null;
    const ttsMatch = audioUrl.match(/tts_(\d+)\.wav$/);
    if (ttsMatch && ttsMatch[1]) {
      ttsTimestamp = ttsMatch[1];
      console.log(`[SYNC] Extracted TTS timestamp: ${ttsTimestamp}`);

      // Check if sync with this timestamp already exists
      const expectedSyncUrl =
        videoId && sceneId
          ? `http://host.docker.internal:9000/nca-toolkit/video_${videoId}_scene_${sceneId}_synced_${ttsTimestamp}.mp4`
          : `http://host.docker.internal:9000/nca-toolkit/scene_${sceneId}_synced_${ttsTimestamp}.mp4`;
      try {
        const checkResponse = await fetch(expectedSyncUrl, { method: 'HEAD' });
        if (checkResponse.ok) {
          console.log(
            `[SYNC] Found existing synced video with same TTS timestamp: ${expectedSyncUrl}`
          );
          console.log(`[SYNC] Skipping regeneration - returning cached sync`);
          return NextResponse.json({
            videoUrl: expectedSyncUrl,
            message: `Using cached synchronized video (TTS timestamp: ${ttsTimestamp})`,
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
        useHardwareAcceleration: true,
        videoBitrate: '6000k', // Same bitrate as speed-up function for consistent format
        cleanup: true, // Clean up local files after upload
        useAdvancedSync: true, // Use duration-based speed adjustment (like NCA toolkit)
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
