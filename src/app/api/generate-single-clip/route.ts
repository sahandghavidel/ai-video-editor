import { NextRequest, NextResponse } from 'next/server';
import { createVideoClipWithUpload } from '@/utils/ffmpeg-direct';

// Import the working authentication from baserow-actions
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

// Function to get original video data
async function getOriginalVideoData(videoId: string) {
  const baserowUrl = process.env.BASEROW_API_URL;
  const token = await getJWTToken();

  const response = await fetch(
    `${baserowUrl}/database/rows/table/713/${videoId}/`,
    {
      headers: {
        Authorization: `JWT ${token}`,
      },
    }
  );

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(
      `Failed to fetch original video: ${response.status} ${errorText}`
    );
  }

  return response.json();
}

// Function to get scene data
async function getSceneData(sceneId: string) {
  const baserowUrl = process.env.BASEROW_API_URL;
  const token = await getJWTToken();

  const response = await fetch(
    `${baserowUrl}/database/rows/table/714/${sceneId}/`,
    {
      headers: {
        Authorization: `JWT ${token}`,
      },
    }
  );

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Failed to fetch scene: ${response.status} ${errorText}`);
  }

  return response.json();
}

// Helper function to extract video URL
function extractVideoUrl(field: any): string | null {
  if (!field) return null;

  if (typeof field === 'string' && field.startsWith('http')) {
    return field;
  }

  if (typeof field === 'object' && field !== null) {
    if (field.url) return field.url;
    if (field.file && field.file.url) return field.file.url;
  }

  if (Array.isArray(field) && field.length > 0) {
    const firstItem = field[0];
    if (firstItem && firstItem.url) return firstItem.url;
    if (firstItem && firstItem.file && firstItem.file.url)
      return firstItem.file.url;
  }

  return null;
}

// Function to create video clip using direct FFmpeg + MinIO upload
async function createVideoClip(videoUrl: string, scene: any) {
  const startTime = parseFloat(scene.field_6898);
  const endTime = parseFloat(scene.field_6897);
  const duration = endTime - startTime;

  console.log(
    `[FFMPEG] Scene ${scene.id}: start=${scene.field_6898}s, end=${scene.field_6897}s, duration=${duration}s`
  );
  console.log(
    `[TIMING] Scene ${
      scene.id
    }: Starting FFmpeg processing at ${new Date().toISOString()}`
  );
  const ffmpegStartTime = Date.now();

  try {
    // Use direct FFmpeg with hardware acceleration + MinIO upload
    const result = await createVideoClipWithUpload({
      inputUrl: videoUrl,
      startTime: scene.field_6898.toString(),
      endTime: scene.field_6897.toString(),
      useHardwareAcceleration: true,
      videoBitrate: '6000k', // High quality for good results
      sceneId: scene.id.toString(),
      cleanup: true, // Clean up local files after upload
    });

    const ffmpegEndTime = Date.now();
    const processingTime = ffmpegEndTime - ffmpegStartTime;
    console.log(
      `[FFMPEG] Scene ${scene.id} completed in ${processingTime}ms (start=${startTime}s) - Hardware accelerated + MinIO uploaded!`
    );
    console.log(`[UPLOAD] Scene ${scene.id} uploaded to: ${result.uploadUrl}`);

    return result.uploadUrl;
  } catch (error) {
    console.error(`[FFMPEG] Failed to process scene ${scene.id}:`, error);
    throw error;
  }
}

// Function to update scene with clip URL
async function updateSceneWithClipUrl(sceneId: number, clipUrl: string) {
  const baserowUrl = process.env.BASEROW_API_URL;

  try {
    const token = await getJWTToken();

    const updateData = {
      field_6886: clipUrl, // Videos field
      field_6888: clipUrl, // Video Clip URL field
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
        `Failed to update scene with clip URL: ${response.status} ${errorText}`
      );
    }

    const result = await response.json();
    return result;
  } catch (error) {
    console.error(`Error updating scene ${sceneId}:`, error);
    throw error;
  }
}

export async function POST(request: NextRequest) {
  try {
    const { sceneId } = await request.json();

    if (!sceneId) {
      return NextResponse.json(
        { error: 'Scene ID is required' },
        { status: 400 }
      );
    }

    console.log('Generating clip for scene:', sceneId);

    // Step 1: Get the scene data
    const scene = await getSceneData(sceneId);

    // Step 2: Get the original video data to get the video URL
    const videoId = scene.field_6889; // Video ID field
    if (!videoId) {
      throw new Error('No video ID found for this scene');
    }

    const originalVideo = await getOriginalVideoData(videoId);
    const videoUrl = extractVideoUrl(originalVideo.field_6881); // Video Uploaded URL

    if (!videoUrl) {
      throw new Error('No video URL found for this scene');
    }

    // Step 3: Create the video clip
    const clipUrl = await createVideoClip(videoUrl, scene);

    // Step 4: Update the scene with the clip URL
    await updateSceneWithClipUrl(scene.id, clipUrl);

    return NextResponse.json({
      success: true,
      message: `Successfully generated clip for scene ${sceneId}`,
      sceneId: scene.id,
      clipUrl,
    });
  } catch (error) {
    console.error('Error generating single clip:', error);
    return NextResponse.json(
      {
        error: `Failed to generate clip: ${
          error instanceof Error ? error.message : 'Unknown error'
        }`,
      },
      { status: 500 }
    );
  }
}
