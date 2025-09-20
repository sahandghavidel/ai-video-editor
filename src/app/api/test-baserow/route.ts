import { NextRequest, NextResponse } from 'next/server';

// Function to get JWT token from Baserow
async function getJWTToken() {
  const authUrl = `${process.env.BASEROW_API_URL}/user/token-auth/`;
  const response = await fetch(authUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      email: process.env.BASEROW_EMAIL,
      password: process.env.BASEROW_PASSWORD,
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Authentication failed: ${response.status} ${errorText}`);
  }

  const data = await response.json();
  return data.token;
}

export async function GET(request: NextRequest) {
  try {
    console.log('Testing Baserow connection...');
    console.log('Baserow API URL:', process.env.BASEROW_API_URL);

    // Test 1: Get JWT token
    const token = await getJWTToken();
    console.log('✅ JWT token obtained successfully');

    // Test 2: Fetch a scene from the database
    const sceneResponse = await fetch(
      `${process.env.BASEROW_API_URL}/database/rows/table/714/?size=1`,
      {
        headers: {
          Authorization: `JWT ${token}`,
        },
      }
    );

    if (!sceneResponse.ok) {
      const errorText = await sceneResponse.text();
      throw new Error(
        `Failed to fetch scenes: ${sceneResponse.status} ${errorText}`
      );
    }

    const sceneData = await sceneResponse.json();
    console.log('✅ Successfully fetched scene data');

    // Test 3: Try updating a scene (if we have any)
    if (sceneData.results && sceneData.results.length > 0) {
      const testScene = sceneData.results[0];
      console.log('Testing update on scene:', testScene.id);

      const updateResponse = await fetch(
        `${process.env.BASEROW_API_URL}/database/rows/table/714/${testScene.id}/`,
        {
          method: 'PATCH',
          headers: {
            Authorization: `JWT ${token}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            field_6888: 'test-clip-url.mp4', // Video Clip URL field
          }),
        }
      );

      if (!updateResponse.ok) {
        const errorText = await updateResponse.text();
        throw new Error(
          `Failed to update scene: ${updateResponse.status} ${errorText}`
        );
      }

      const updateResult = await updateResponse.json();
      console.log('✅ Successfully updated scene');

      return NextResponse.json({
        success: true,
        message: 'Baserow connection test successful',
        details: {
          tokenObtained: true,
          sceneFetched: true,
          sceneUpdated: true,
          testSceneId: testScene.id,
          updateResult,
        },
      });
    } else {
      return NextResponse.json({
        success: true,
        message: 'Baserow connection test partially successful',
        details: {
          tokenObtained: true,
          sceneFetched: true,
          sceneUpdated: false,
          reason: 'No scenes found to test update',
        },
      });
    }
  } catch (error) {
    console.error('Baserow connection test failed:', error);
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
        details: {
          baserowUrl: process.env.BASEROW_API_URL,
          email: process.env.BASEROW_EMAIL ? 'set' : 'missing',
          password: process.env.BASEROW_PASSWORD ? 'set' : 'missing',
        },
      },
      { status: 500 }
    );
  }
}
