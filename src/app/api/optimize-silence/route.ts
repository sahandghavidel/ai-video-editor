import { NextRequest, NextResponse } from 'next/server';
import { optimizeSilenceWithUpload } from '@/utils/ffmpeg-silence';

export async function POST(request: NextRequest) {
  try {
    const { videoId, videoUrl, sceneId, options } = await request.json();

    if (!videoId) {
      return NextResponse.json(
        { error: 'Video ID is required' },
        { status: 400 }
      );
    }

    if (!videoUrl) {
      return NextResponse.json(
        { error: 'Video URL is required' },
        { status: 400 }
      );
    }

    console.log(
      `[SILENCE] Video ${videoId}, Scene ${sceneId}: Optimizing silence with options:`,
      options
    );

    const silenceStartTime = Date.now();

    try {
      // Use FFmpeg to optimize silence with MinIO upload
      const result = await optimizeSilenceWithUpload({
        inputUrl: videoUrl,
        videoId: videoId.toString(),
        sceneId: sceneId?.toString(),
        ...options,
      });

      const silenceEndTime = Date.now();
      console.log(
        `[SILENCE] Video ${videoId}, Scene ${sceneId}: Silence optimization completed in ${
          silenceEndTime - silenceStartTime
        }ms`
      );

      return NextResponse.json({
        success: true,
        message: 'Successfully optimized silence',
        data: {
          videoId,
          originalUrl: videoUrl,
          optimizedUrl: result.uploadUrl,
          processingTime: silenceEndTime - silenceStartTime,
          stats: result.stats,
        },
      });
    } catch (silenceError) {
      console.error(
        `[SILENCE] Video ${videoId}, Scene ${sceneId}: Silence optimization failed:`,
        silenceError
      );

      return NextResponse.json(
        {
          error: 'Silence optimization failed',
          details:
            silenceError instanceof Error
              ? silenceError.message
              : 'Unknown error',
          videoId,
          sceneId,
        },
        { status: 500 }
      );
    }
  } catch (error) {
    console.error('[SILENCE] API error:', error);

    return NextResponse.json(
      {
        error: 'Internal server error',
        details: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 }
    );
  }
}
