import { NextRequest, NextResponse } from 'next/server';
import { convertToCFRWithUpload } from '@/utils/ffmpeg-cfr';

export async function POST(request: NextRequest) {
  try {
    const { videoId, videoUrl, framerate = 30 } = await request.json();

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

    // Validate framerate
    if (typeof framerate !== 'number' || framerate <= 0 || framerate > 120) {
      return NextResponse.json(
        { error: 'Framerate must be a number between 1 and 120' },
        { status: 400 }
      );
    }

    console.log(`[CFR] Video ${videoId}: Converting to CFR ${framerate}fps`);

    const cfrStartTime = Date.now();

    try {
      // Use FFmpeg to convert to CFR with MinIO upload
      const result = await convertToCFRWithUpload({
        inputUrl: videoUrl,
        framerate,
        videoId: videoId.toString(),
      });

      const cfrEndTime = Date.now();
      console.log(
        `[CFR] Video ${videoId}: CFR conversion completed in ${
          cfrEndTime - cfrStartTime
        }ms`
      );

      return NextResponse.json({
        success: true,
        message: `Successfully converted to CFR ${framerate}fps`,
        data: {
          videoId,
          originalUrl: videoUrl,
          cfrUrl: result.uploadUrl,
          framerate,
          processingTime: cfrEndTime - cfrStartTime,
        },
      });
    } catch (cfrError) {
      console.error(`[CFR] Video ${videoId}: CFR conversion failed:`, cfrError);

      return NextResponse.json(
        {
          error: 'CFR conversion failed',
          details:
            cfrError instanceof Error ? cfrError.message : 'Unknown error',
          videoId,
        },
        { status: 500 }
      );
    }
  } catch (error) {
    console.error('[CFR] API error:', error);

    return NextResponse.json(
      {
        error: 'Internal server error',
        details: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 }
    );
  }
}
