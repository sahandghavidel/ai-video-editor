import { NextRequest, NextResponse } from 'next/server';

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

// Function to create video clip using NCA toolkit
async function createVideoClip(videoUrl: string, scene: any) {
  const ncaUrl = 'http://host.docker.internal:8080/v1/video/trim';

  const startTime = parseFloat(scene.field_6898);
  const endTime = parseFloat(scene.field_6897);
  const duration = endTime - startTime;

  // Generate unique request ID for tracking
  const requestId = `${scene.id}_${Date.now()}`;

  console.log(
    `Scene ${scene.id}: start=${startTime}s, end=${endTime}s, duration=${duration}s [${requestId}]`
  );
  const trimStartTime = Date.now();

  const requestBody = {
    video_url: videoUrl,
    start: scene.field_6898.toString(),
    end: scene.field_6897.toString(),
    id: requestId,
    video_preset: 'medium',
    video_crf: 23,
  };

  const response = await fetch(ncaUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': 'test-key-123',
    },
    body: JSON.stringify(requestBody),
    signal: AbortSignal.timeout(120000), // Increased timeout to 2 minutes
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`NCA toolkit trim failed: ${response.status} ${errorText}`);
  }

  const result = await response.json();

  const trimEndTime = Date.now();
  const processingTime = trimEndTime - trimStartTime;
  console.log(
    `Scene ${scene.id} trim completed in ${processingTime}ms (start=${startTime}s)`
  );

  // Extract the clip URL from the response
  const clipUrl =
    result.response || result.clip_url || result.url || result.file_url;

  if (!clipUrl) {
    throw new Error('No clip URL returned from NCA toolkit');
  }

  return clipUrl;
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
