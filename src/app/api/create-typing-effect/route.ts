import { NextRequest, NextResponse } from 'next/server';
import { createTypingEffectVideoWithUpload } from '@/utils/ffmpeg-direct';

export async function POST(request: NextRequest) {
  try {
    const { sceneId, videoId, videoUrl, text } = await request.json();

    if (!videoUrl || !text) {
      return NextResponse.json(
        { error: 'Video URL and text are required' },
        { status: 400 }
      );
    }

    console.log(
      `[TYPING] Starting typing effect creation for scene ${
        sceneId || 'unknown'
      } (video ${videoId || 'unknown'})`
    );
    console.log(`[TYPING] Video URL: ${videoUrl}`);
    console.log(`[TYPING] Text: "${text}"`);

    const typingStartTime = Date.now();

    // Create the typing effect video
    const result = await createTypingEffectVideoWithUpload({
      videoUrl,
      text,
      sceneId: sceneId?.toString(),
      videoId: videoId?.toString(),
      cleanup: true, // Clean up local files after upload
    });

    const typingEndTime = Date.now();
    const processingTime = typingEndTime - typingStartTime;

    console.log(
      `[TYPING] Scene ${sceneId || 'unknown'} completed in ${processingTime}ms`
    );
    console.log(
      `[UPLOAD] Scene ${sceneId || 'unknown'} typing effect uploaded to: ${
        result.uploadUrl
      }`
    );

    return NextResponse.json({
      videoUrl: result.uploadUrl,
      message: `Successfully created typing effect video`,
      runTime: `${processingTime}ms`,
      method: 'local_ffmpeg_typing_effect',
    });
  } catch (error) {
    console.error('Error creating typing effect video:', error);
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : 'Unknown error occurred',
      },
      { status: 500 }
    );
  }
}
