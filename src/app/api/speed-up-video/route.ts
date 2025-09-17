import { NextRequest, NextResponse } from 'next/server';
import { updateBaserowRow } from '@/lib/baserow-actions';

export async function POST(request: NextRequest) {
  try {
    const {
      sceneId,
      videoUrl,
      speed = 4,
      muteAudio = true,
    } = await request.json();

    if (!sceneId) {
      return NextResponse.json(
        { error: 'Scene ID is required' },
        { status: 400 }
      );
    }

    if (!videoUrl) {
      return NextResponse.json(
        { error: 'Video URL from field_6888 is required' },
        { status: 400 }
      );
    }

    // Validate speed parameter
    if (![1, 2, 4].includes(speed)) {
      return NextResponse.json(
        { error: 'Speed must be 1, 2, or 4' },
        { status: 400 }
      );
    }

    // NCA Toolkit credentials from your Docker setup
    const NCA_API_KEY = 'test-key-123';
    const NCA_BASE_URL = 'http://host.docker.internal:8080';

    // Create FFmpeg command to speed up both video and audio by specified speed (same approach as generate-video)
    const audioFilter = muteAudio
      ? `[0:a]atempo=${speed}.0,volume=0[a_processed]` // Mute audio but keep stream
      : `[0:a]atempo=${speed}.0[a_processed]`; // Keep original volume

    const ffmpegPayload = {
      id: `speed-up-video-${sceneId}-${Date.now()}`,
      inputs: [{ file_url: videoUrl }],
      filters: [
        // Speed up video by specified speed
        { filter: `[0:v]setpts=PTS/${speed}[v_fast]` },
        // Speed up audio by specified speed and conditionally mute
        { filter: audioFilter },
      ],
      outputs: [
        {
          options: [
            { option: '-map', argument: '[v_fast]' },
            { option: '-map', argument: '[a_processed]' },
            { option: '-c:v', argument: 'libx264' },
            { option: '-c:a', argument: 'aac' },
            { option: '-b:a', argument: '192k' },
            { option: '-ar', argument: '44100' },
            { option: '-ac', argument: '2' },
          ],
        },
      ],
    };

    console.log(
      'Speed-up video payload:',
      JSON.stringify(ffmpegPayload, null, 2)
    );

    // Call NCA Toolkit to process the video
    const videoProcessingResponse = await fetch(
      `${NCA_BASE_URL}/v1/ffmpeg/compose`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': NCA_API_KEY,
        },
        body: JSON.stringify(ffmpegPayload),
      }
    );

    if (!videoProcessingResponse.ok) {
      const errorText = await videoProcessingResponse.text();
      console.error(
        'Video processing error:',
        videoProcessingResponse.status,
        errorText
      );
      throw new Error(
        `Video processing error: ${videoProcessingResponse.status} - ${errorText}`
      );
    }

    const processedVideoResult = await videoProcessingResponse.json();
    console.log('Processed video result:', processedVideoResult);

    // Extract the processed video URL from various possible response formats
    const processedVideoUrl =
      processedVideoResult.response?.[0]?.file_url ||
      processedVideoResult.output_url ||
      processedVideoResult.url ||
      processedVideoResult.result?.output_url ||
      processedVideoResult.result?.url ||
      processedVideoResult.data?.output_url ||
      processedVideoResult.data?.url;

    if (!processedVideoUrl) {
      console.error(
        'Could not find processed video URL in response:',
        processedVideoResult
      );
      throw new Error('No processed video URL returned from service');
    }

    console.log('Speed-up video URL:', processedVideoUrl);

    // Update field_6886 with the processed video URL
    await updateBaserowRow(sceneId, {
      field_6886: processedVideoUrl,
    });

    return NextResponse.json({
      videoUrl: processedVideoUrl,
      message: `Video successfully sped up ${speed}x with audio muted`,
    });
  } catch (error) {
    console.error('Error processing speed-up video:', error);
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : 'Unknown error occurred',
      },
      { status: 500 }
    );
  }
}
