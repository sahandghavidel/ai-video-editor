import { NextRequest, NextResponse } from 'next/server';
import { createVideoClipWithUpload } from '@/utils/ffmpeg-direct';
import path from 'path';
import fs from 'fs/promises';

export async function POST(request: NextRequest) {
  try {
    const { videoId } = await request.json();

    if (!videoId) {
      return NextResponse.json(
        { error: 'Video ID is required' },
        { status: 400 }
      );
    }

    // Create a readable stream for Server-Sent Events
    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      async start(controller) {
        try {
          console.log('Generating clips for video:', videoId);

          // Step 1: Get the original video data to get the video URL
          const originalVideo = await getOriginalVideoData(videoId);
          const videoUrl = extractVideoUrl(originalVideo.field_6881); // Video Uploaded URL

          if (!videoUrl) {
            throw new Error('No video URL found for this video');
          }

          // Step 2: Get all scenes for this video
          const scenes = await getScenesForVideo(videoId);

          if (scenes.length === 0) {
            throw new Error('No scenes found for this video');
          }

          // Sort scenes by start time for sequential processing
          scenes.sort((a, b) => {
            const startA = parseFloat(a.field_6898) || 0;
            const startB = parseFloat(b.field_6898) || 0;
            return startA - startB;
          });

          // Send initial progress
          controller.enqueue(
            encoder.encode(
              `data: ${JSON.stringify({
                type: 'progress',
                current: 0,
                total: scenes.length,
                percentage: 0,
                message: `Starting to process ${scenes.length} scenes...`,
              })}\n\n`
            )
          );

          console.log(
            `Found ${scenes.length} scenes to process, sorted by start time`
          );

          // Step 3: Process each scene using direct FFmpeg (much faster!)
          const processedClips = [];
          let skippedCount = 0;

          for (let i = 0; i < scenes.length; i++) {
            const scene = scenes[i];
            const sceneNumber = i + 1;
            const progressPercentage = Math.round(
              (sceneNumber / scenes.length) * 100
            );

            // Check if scene already has a clip in field_6888 (Video Clip URL)
            if (scene.field_6888) {
              const clipValue = scene.field_6888;

              // More careful checking - only skip if there's actually a URL
              let hasClip = false;

              if (typeof clipValue === 'string') {
                // String: check if it's not empty and not just whitespace
                hasClip = clipValue.trim() !== '';
              } else if (Array.isArray(clipValue)) {
                // Array: check if it has items with actual URLs
                hasClip =
                  clipValue.length > 0 &&
                  clipValue.some(
                    (item) =>
                      item &&
                      (typeof item === 'string' ? item.trim() !== '' : item.url)
                  );
              } else if (typeof clipValue === 'object' && clipValue !== null) {
                // Object: check if it has url property
                hasClip = clipValue.url && String(clipValue.url).trim() !== '';
              }

              if (hasClip) {
                skippedCount++;

                // Send skip notification
                controller.enqueue(
                  encoder.encode(
                    `data: ${JSON.stringify({
                      type: 'scene_skipped',
                      sceneId: scene.id,
                      sceneNumber,
                      current: sceneNumber,
                      total: scenes.length,
                      percentage: progressPercentage,
                      message: `Scene ${sceneNumber} already has clip, skipping...`,
                    })}\n\n`
                  )
                );
                continue; // Skip this scene
              }
            }

            // Send progress update
            controller.enqueue(
              encoder.encode(
                `data: ${JSON.stringify({
                  type: 'progress',
                  current: sceneNumber,
                  total: scenes.length,
                  percentage: progressPercentage,
                  message: `Processing scene ${sceneNumber}/${scenes.length} with FFmpeg...`,
                })}\n\n`
              )
            );

            try {
              const clipUrl = await createVideoClipDirect(videoUrl, scene);

              await updateSceneWithClipUrl(scene.id, clipUrl);

              processedClips.push({
                sceneId: scene.id,
                clipUrl,
                sceneNumber,
                progress: progressPercentage,
              });

              // Send scene completion update
              controller.enqueue(
                encoder.encode(
                  `data: ${JSON.stringify({
                    type: 'scene_complete',
                    sceneId: scene.id,
                    sceneNumber,
                    clipUrl,
                    current: sceneNumber,
                    total: scenes.length,
                    percentage: progressPercentage,
                  })}\n\n`
                )
              );
            } catch (error) {
              console.error(
                `Failed to create clip for scene ${scene.id}:`,
                error
              );

              // Send error update
              controller.enqueue(
                encoder.encode(
                  `data: ${JSON.stringify({
                    type: 'scene_error',
                    sceneId: scene.id,
                    sceneNumber,
                    error:
                      error instanceof Error ? error.message : 'Unknown error',
                    current: sceneNumber,
                    total: scenes.length,
                    percentage: progressPercentage,
                  })}\n\n`
                )
              );
              // Continue with next scene even if one fails
            }
          }

          // Send completion
          controller.enqueue(
            encoder.encode(
              `data: ${JSON.stringify({
                type: 'complete',
                totalScenes: scenes.length,
                processedScenes: processedClips.length,
                skippedScenes: skippedCount,
                failedScenes:
                  scenes.length - processedClips.length - skippedCount,
                clips: processedClips,
              })}\n\n`
            )
          );

          controller.close();
        } catch (error) {
          console.error('Error generating clips:', error);
          controller.enqueue(
            encoder.encode(
              `data: ${JSON.stringify({
                type: 'error',
                error: error instanceof Error ? error.message : 'Unknown error',
              })}\n\n`
            )
          );

          controller.close();
        }
      },
    });

    return new Response(stream, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
      },
    });
  } catch (error) {
    console.error('Error in generate-clips API:', error);
    return NextResponse.json(
      {
        error: `Failed to generate clips: ${
          error instanceof Error ? error.message : 'Unknown error'
        }`,
      },
      { status: 500 }
    );
  }
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
    if (typeof firstItem === 'string' && firstItem.startsWith('http')) {
      return firstItem;
    }
    if (typeof firstItem === 'object' && firstItem !== null) {
      if (firstItem.url) return firstItem.url;
      if (firstItem.file && firstItem.file.url) return firstItem.file.url;
    }
  }

  return null;
}

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
      method: 'GET',
      headers: {
        Authorization: `JWT ${token}`,
        'Content-Type': 'application/json',
      },
    }
  );

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(
      `Failed to get original video data: ${response.status} ${errorText}`
    );
  }

  return response.json();
}

// Function to get scenes for a video (with pagination support)
async function getScenesForVideo(videoId: string) {
  const baserowUrl = process.env.BASEROW_API_URL;
  const token = await getJWTToken();

  let allScenes = [];
  let page = 1;
  let hasMorePages = true;
  const pageSize = 200; // Fetch 200 scenes per page

  while (hasMorePages) {
    // Get scenes where Video ID (field_6889) matches the videoId
    const response = await fetch(
      `${baserowUrl}/database/rows/table/714/?filter__field_6889__equal=${videoId}&size=${pageSize}&page=${page}`,
      {
        method: 'GET',
        headers: {
          Authorization: `JWT ${token}`,
          'Content-Type': 'application/json',
        },
      }
    );

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Failed to get scenes: ${response.status} ${errorText}`);
    }

    const data = await response.json();
    const scenes = data.results || [];

    allScenes.push(...scenes);

    // Check if there are more pages
    hasMorePages = data.next !== null && scenes.length === pageSize;
    page++;
  }

  return allScenes;
}

// Function to create video clip using direct FFmpeg (much faster!)
async function createVideoClipDirect(
  videoUrl: string,
  scene: any
): Promise<string> {
  const startTime = parseFloat(scene.field_6898);
  const endTime = parseFloat(scene.field_6897);
  const duration = endTime - startTime;

  console.log(
    `[FFMPEG] Scene ${scene.id}: start=${scene.field_6898}s, end=${scene.field_6897}s, duration=${duration}s`
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
      `[FFMPEG] Scene ${scene.id} completed in ${processingTime}ms (start=${startTime}s)`
    );

    return result.uploadUrl;
  } catch (error) {
    console.error(`[FFMPEG] Failed to process scene ${scene.id}:`, error);
    throw error;
  }
}

// Function to create video clips using NCA toolkit split endpoint (batch processing)
async function createVideoClipsBatch(videoUrl: string, scenes: any[]) {
  const ncaUrl = 'http://host.docker.internal:8080/v1/video/split';

  // Generate unique request ID for tracking
  const requestId = `batch_${Date.now()}`;

  console.log(
    `[BATCH] Processing ${scenes.length} scenes in batch [${requestId}]`
  );
  console.log(
    `[TIMING] Batch: Starting request at ${new Date().toISOString()}`
  );
  const batchStartTime = Date.now();

  const requestBody = {
    video_url: videoUrl,
    splits: scenes.map((scene) => ({
      start: scene.field_6898.toString(),
      end: scene.field_6897.toString(),
    })),
    id: requestId,
    video_preset: 'medium',
    video_crf: 23,
  };

  console.log(
    `[TIMING] Batch: Sending request to NCA at ${new Date().toISOString()}`
  );
  const response = await fetch(ncaUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': 'test-key-123',
    },
    body: JSON.stringify(requestBody),
    signal: AbortSignal.timeout(300000), // Increased timeout to 5 minutes for batch
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(
      `NCA toolkit split failed: ${response.status} ${errorText}`
    );
  }

  const result = await response.json();

  const batchEndTime = Date.now();
  const processingTime = batchEndTime - batchStartTime;
  console.log(
    `[BATCH] Batch completed in ${processingTime}ms for ${scenes.length} scenes`
  );

  // Extract clip URLs from the response
  if (!result.response || !Array.isArray(result.response)) {
    throw new Error('Invalid response format from NCA toolkit split endpoint');
  }

  const clipUrls = result.response.map(
    (item: any) => item.file_url || item.url || item.response
  );

  if (clipUrls.length !== scenes.length) {
    throw new Error(
      `Expected ${scenes.length} clips but got ${clipUrls.length}`
    );
  }

  return clipUrls;
}

// Function to create video clip using NCA toolkit
async function createVideoClip(videoUrl: string, scene: any) {
  const ncaUrl = 'http://host.docker.internal:8080/v1/video/cut';

  const startTime = parseFloat(scene.field_6898);
  const endTime = parseFloat(scene.field_6897);
  const duration = endTime - startTime;

  // Generate unique request ID for tracking
  const requestId = `${scene.id}_${Date.now()}`;

  console.log(
    `Scene ${scene.id}: start=${scene.field_6898}s, end=${scene.field_6897}s, duration=${duration}s [${requestId}]`
  );
  console.log(
    `[TIMING] Scene ${
      scene.id
    }: Starting request at ${new Date().toISOString()}`
  );
  const trimStartTime = Date.now();

  const requestBody = {
    video_url: videoUrl,
    cuts: [
      {
        start: scene.field_6898.toString(),
        end: scene.field_6897.toString(),
      },
    ],
    id: requestId,
    video_preset: 'medium',
    video_crf: 23,
  };

  console.log(
    `[TIMING] Scene ${
      scene.id
    }: Sending request to NCA at ${new Date().toISOString()}`
  );
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

// Function to get a single scene by ID for verification
async function getSceneById(sceneId: number) {
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
    throw new Error(
      `Failed to fetch scene ${sceneId}: ${response.status} ${errorText}`
    );
  }

  return response.json();
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
