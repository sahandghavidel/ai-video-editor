import { NextRequest, NextResponse } from 'next/server';

export async function POST(request: NextRequest) {
  try {
    const { videoUrl, audioUrl } = await request.json();

    if (!videoUrl || !audioUrl) {
      return NextResponse.json(
        { error: 'Video URL and audio URL are required' },
        { status: 400 }
      );
    }

    // NCA Toolkit credentials from your Docker setup
    const NCA_API_KEY = 'test-key-123';
    const NCA_BASE_URL = 'http://host.docker.internal:8080';

    // Step 1: Get video duration
    const videoDurationResponse = await fetch(
      `${NCA_BASE_URL}/v1/media/metadata`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': NCA_API_KEY,
        },
        body: JSON.stringify({
          media_url: videoUrl,
        }),
      }
    );

    if (!videoDurationResponse.ok) {
      const errorText = await videoDurationResponse.text();
      console.error(
        'Video metadata error:',
        videoDurationResponse.status,
        errorText
      );
      throw new Error(
        `Video metadata error: ${videoDurationResponse.status} - ${errorText}`
      );
    }

    const videoMetadata = await videoDurationResponse.json();
    const videoDuration = videoMetadata.response.duration;

    // Step 2: Get audio duration
    const audioDurationResponse = await fetch(
      `${NCA_BASE_URL}/v1/media/metadata`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': NCA_API_KEY,
        },
        body: JSON.stringify({
          media_url: audioUrl,
        }),
      }
    );

    if (!audioDurationResponse.ok) {
      const errorText = await audioDurationResponse.text();
      console.error(
        'Audio metadata error:',
        audioDurationResponse.status,
        errorText
      );
      throw new Error(
        `Audio metadata error: ${audioDurationResponse.status} - ${errorText}`
      );
    }

    const audioMetadata = await audioDurationResponse.json();
    const audioDuration = audioMetadata.response.duration;

    // Step 3: Calculate speed ratio and create synchronized video
    const speedRatio = audioDuration / videoDuration;

    const ffmpegPayload = {
      id: 'audio-video-sync',
      inputs: [{ file_url: videoUrl }, { file_url: audioUrl }],
      filters: [
        { filter: `[0:v]setpts=PTS*${speedRatio}[speedv]` },
        {
          filter:
            '[1:a]aresample=44100,volume=1,pan=stereo|c0=0.5*c0|c1=0.5*c0[outa]',
        },
      ],
      outputs: [
        {
          options: [
            { option: '-map', argument: '[speedv]' },
            { option: '-map', argument: '[outa]' },
            { option: '-c:v', argument: 'libx264' },
            { option: '-c:a', argument: 'aac' },
            { option: '-b:a', argument: '192k' },
            { option: '-ar', argument: '44100' },
            { option: '-ac', argument: '2' },
          ],
        },
      ],
    };

    const videoGenerationResponse = await fetch(
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

    if (!videoGenerationResponse.ok) {
      const errorText = await videoGenerationResponse.text();
      console.error(
        'Video generation error:',
        videoGenerationResponse.status,
        errorText
      );
      throw new Error(
        `Video generation error: ${videoGenerationResponse.status} - ${errorText}`
      );
    }

    const generatedVideoResult = await videoGenerationResponse.json();

    const generatedVideoUrl =
      generatedVideoResult.response?.[0]?.file_url ||
      generatedVideoResult.output_url ||
      generatedVideoResult.url ||
      generatedVideoResult.result?.output_url ||
      generatedVideoResult.result?.url ||
      generatedVideoResult.data?.output_url ||
      generatedVideoResult.data?.url;

    if (!generatedVideoUrl) {
      console.error(
        'Could not find video URL in response:',
        generatedVideoResult
      );
      throw new Error(`No video URL returned from generation service`);
    }

    return NextResponse.json({
      videoUrl: generatedVideoUrl,
      videoDuration,
      audioDuration,
      speedRatio,
    });
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
