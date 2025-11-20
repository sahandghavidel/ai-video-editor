import { NextRequest, NextResponse } from 'next/server';
import { speedUpVideoWithUpload } from '@/utils/ffmpeg-direct';

export async function POST(request: NextRequest) {
  try {
    const {
      sceneId,
      videoId,
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
    if (![1, 1.125, 1.5, 2, 4, 8].includes(speed)) {
      return NextResponse.json(
        { error: 'Speed must be 1, 1.125, 1.5, 2, 4, or 8' },
        { status: 400 }
      );
    }

    console.log(
      `[SPEEDUP] Scene ${sceneId}: Processing ${speed}x speed-up with${
        muteAudio ? '' : 'out'
      } audio muting`
    );
    const speedUpStartTime = Date.now();

    try {
      // Use direct FFmpeg with hardware acceleration + MinIO upload (same format as clip generation)
      const result = await speedUpVideoWithUpload({
        inputUrl: videoUrl,
        speed: speed,
        muteAudio: muteAudio,
        useHardwareAcceleration: true,
        videoBitrate: '6000k', // Same bitrate as clip generation for consistent format
        sceneId: sceneId.toString(),
        videoId: videoId,
        cleanup: true, // Clean up local files after upload
      });

      const speedUpEndTime = Date.now();
      const processingTime = speedUpEndTime - speedUpStartTime;
      console.log(
        `[SPEEDUP] Scene ${sceneId} completed in ${processingTime}ms (${speed}x speed) - Hardware accelerated + MinIO uploaded!`
      );
      console.log(
        `[UPLOAD] Scene ${sceneId} speed-up uploaded to: ${result.uploadUrl}`
      );

      // Update the scene with the sped-up video URL
      const baserowUpdateStart = Date.now();
      await updateSceneWithSpeedUpUrl(sceneId, result.uploadUrl);
      const baserowUpdateEnd = Date.now();
      console.log(
        `[BASEROW] Scene ${sceneId} updated in ${
          baserowUpdateEnd - baserowUpdateStart
        }ms`
      );

      return NextResponse.json({
        videoUrl: result.uploadUrl,
        message: `Video successfully sped up ${speed}x${
          muteAudio ? ' with audio muted' : ''
        }`,
        processingTime: processingTime,
      });
    } catch (error) {
      console.error(`[SPEEDUP] Failed to process scene ${sceneId}:`, error);
      throw error;
    }
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

// Helper function to get JWT token for Baserow API
async function getJWTToken(): Promise<string> {
  const baserowUrl = process.env.BASEROW_API_URL;
  const email = process.env.BASEROW_EMAIL;
  const password = process.env.BASEROW_PASSWORD;

  if (!baserowUrl || !email || !password) {
    throw new Error('Missing Baserow configuration');
  }

  const response = await fetch(`${baserowUrl}/user/token-auth/`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      email,
      password,
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Authentication failed: ${response.status} ${errorText}`);
  }

  const data = await response.json();
  return data.token;
}

// Function to update scene with speed-up video URL
async function updateSceneWithSpeedUpUrl(
  sceneId: number,
  speedUpVideoUrl: string
) {
  const baserowUrl = process.env.BASEROW_API_URL;

  try {
    const token = await getJWTToken();

    const updateData = {
      field_6886: speedUpVideoUrl, // Videos field (same field updated in clip generation)
    };

    const response = await fetch(
      `${baserowUrl}/database/rows/table/714/${sceneId}/`,
      {
        method: 'PATCH',
        headers: {
          Authorization: `JWT ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(updateData),
      }
    );

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(
        `Failed to update scene with speed-up URL: ${response.status} ${errorText}`
      );
    }

    const result = await response.json();
    return result;
  } catch (error) {
    console.error(`Error updating scene ${sceneId} with speed-up URL:`, error);
    throw error;
  }
}
