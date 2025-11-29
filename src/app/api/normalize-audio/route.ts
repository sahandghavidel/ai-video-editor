import { NextRequest, NextResponse } from 'next/server';
import { normalizeAudioWithUpload } from '@/utils/ffmpeg-normalize';

export async function POST(request: NextRequest) {
  try {
    const {
      sceneId,
      videoId,
      videoUrl,
      targetLoudness = -19, // Changed from -23 to -16 LUFS for louder audio
      loudnessRange = 7,
      truePeak = -2,
    } = await request.json();

    if (!sceneId) {
      return NextResponse.json(
        { error: 'Scene ID is required' },
        { status: 400 }
      );
    }

    if (!videoUrl) {
      return NextResponse.json(
        { error: 'Video URL is required' },
        { status: 400 }
      );
    }

    // Validate loudness parameters
    if (
      typeof targetLoudness !== 'number' ||
      targetLoudness > 0 ||
      targetLoudness < -50
    ) {
      return NextResponse.json(
        { error: 'Target loudness must be a number between -50 and 0 LUFS' },
        { status: 400 }
      );
    }

    if (
      typeof loudnessRange !== 'number' ||
      loudnessRange <= 0 ||
      loudnessRange > 20
    ) {
      return NextResponse.json(
        { error: 'Loudness range must be a number between 0 and 20 LU' },
        { status: 400 }
      );
    }

    if (typeof truePeak !== 'number' || truePeak > 0 || truePeak < -20) {
      return NextResponse.json(
        { error: 'True peak must be a number between -20 and 0 dBTP' },
        { status: 400 }
      );
    }

    console.log(
      `[NORMALIZE] Scene ${sceneId}: Normalizing audio to ${targetLoudness} LUFS, range ${loudnessRange} LU, true peak ${truePeak} dBTP`
    );

    const normalizeStartTime = Date.now();

    try {
      // Use FFmpeg loudnorm filter with MinIO upload
      const result = await normalizeAudioWithUpload({
        inputUrl: videoUrl,
        targetLoudness,
        loudnessRange,
        truePeak,
        videoId: videoId?.toString(),
        sceneId: sceneId.toString(),
      });

      const normalizeEndTime = Date.now();
      console.log(
        `[NORMALIZE] Scene ${sceneId}: Audio normalization completed in ${
          normalizeEndTime - normalizeStartTime
        }ms`
      );

      return NextResponse.json({
        success: true,
        message: `Successfully normalized audio using EBU R128 standard`,
        data: {
          sceneId,
          originalUrl: videoUrl,
          normalizedUrl: result.uploadUrl,
          targetLoudness,
          loudnessRange,
          truePeak,
          processingTime: normalizeEndTime - normalizeStartTime,
        },
      });
    } catch (normalizeError) {
      console.error(
        `[NORMALIZE] Scene ${sceneId}: Normalization failed:`,
        normalizeError
      );

      return NextResponse.json(
        {
          error: 'Audio normalization failed',
          details:
            normalizeError instanceof Error
              ? normalizeError.message
              : 'Unknown error',
          sceneId,
        },
        { status: 500 }
      );
    }
  } catch (error) {
    console.error('[NORMALIZE] API error:', error);

    return NextResponse.json(
      {
        error: 'Internal server error',
        details: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 }
    );
  }
}
