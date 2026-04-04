import { NextRequest, NextResponse } from 'next/server';
import path from 'path';
import { readdir } from 'fs/promises';
import {
  createVideoClipWithUpload,
  uploadToMinio,
} from '@/utils/ffmpeg-direct';
import { BaserowRow } from '@/lib/baserow-actions';

type BaserowFileField =
  | string
  | {
      url?: string;
      file?: {
        url?: string;
      };
    }
  | Array<{
      url?: string;
      file?: {
        url?: string;
      };
    }>
  | null
  | undefined;

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
    },
  );

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(
      `Failed to fetch original video: ${response.status} ${errorText}`,
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
    },
  );

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Failed to fetch scene: ${response.status} ${errorText}`);
  }

  return response.json();
}

function extractStringField(value: unknown): string {
  if (typeof value === 'string') return value;
  if (typeof value === 'number') return String(value);
  if (value && typeof value === 'object') {
    const maybeValue = value as { value?: unknown };
    if (typeof maybeValue.value === 'string') return maybeValue.value;
    if (typeof maybeValue.value === 'number') return String(maybeValue.value);
  }
  return '';
}

function parseDimension(
  input: string,
): { width: number; height: number } | null {
  const trimmed = input.trim();
  if (!trimmed) return null;

  const match = trimmed.match(/(\d{2,5})\s*[x×X]\s*(\d{2,5})/);
  if (!match) return null;

  const width = Number(match[1]);
  const height = Number(match[2]);
  if (!Number.isFinite(width) || !Number.isFinite(height)) return null;
  if (width <= 0 || height <= 0) return null;
  return { width, height };
}

function parseHexColor(input: string): string | null {
  const trimmed = input.trim();
  if (!trimmed) return null;

  const match = trimmed.match(/#?[0-9a-fA-F]{6}/);
  if (!match) return null;

  const hex = match[0].startsWith('#') ? match[0] : `#${match[0]}`;
  return hex.toUpperCase();
}

function getVideoDimensionAndBg(row: Record<string, unknown>): {
  dimension: string;
  bgColor: string;
} {
  const dimensionRaw = extractStringField(row['field_7092']);
  const bgRaw = extractStringField(row['field_7093']);

  const parsedDim = parseDimension(dimensionRaw);
  const parsedBg = parseHexColor(bgRaw);

  if (!parsedDim) {
    throw new Error(
      `Invalid or missing Dimension (7092) value: "${dimensionRaw}"`,
    );
  }
  if (!parsedBg) {
    throw new Error(`Invalid or missing BG color (7093) value: "${bgRaw}"`);
  }

  return {
    dimension: `${parsedDim.width}x${parsedDim.height}`,
    bgColor: parsedBg,
  };
}

async function uploadStockVideoForScriptScenes(
  dimension: string,
  bgColor: string,
  videoId: string,
): Promise<string> {
  const videosDir = path.join(process.cwd(), 'public', 'videos');
  const entries = await readdir(videosDir);
  const hexNoHash = bgColor.replace('#', '');
  const pattern = new RegExp(`^${dimension}-#?${hexNoHash}\\.mp4$`, 'i');

  const filename = entries.find((entry) => pattern.test(entry));
  if (!filename) {
    throw new Error(
      `No stock video found for ${dimension} and ${bgColor} in public/videos`,
    );
  }

  const filePath = path.join(videosDir, filename);
  const uploadName = `video_${videoId}_clip_${Date.now()}.mp4`;
  return uploadToMinio(filePath, uploadName, 'video/mp4');
}

// Helper function to extract video URL
function extractVideoUrl(field: BaserowFileField): string | null {
  if (!field) return null;

  if (typeof field === 'string' && field.startsWith('http')) {
    return field;
  }

  if (typeof field === 'object' && field !== null && !Array.isArray(field)) {
    const obj = field as { url?: string; file?: { url?: string } };
    if (obj.url) return obj.url;
    if (obj.file && obj.file.url) return obj.file.url;
  }

  if (Array.isArray(field) && field.length > 0) {
    const firstItem = field[0] as unknown;
    if (typeof firstItem === 'object' && firstItem !== null) {
      const obj = firstItem as { url?: string; file?: { url?: string } };
      if (obj.url) return obj.url;
      if (obj.file && obj.file.url) return obj.file.url;
    }
  }

  return null;
}

// Function to create video clip using direct FFmpeg + MinIO upload
async function createVideoClip(
  videoUrl: string,
  scene: BaserowRow,
  videoId?: number,
  startTimeOverride?: number,
  endTimeOverride?: number,
) {
  const startTime =
    typeof startTimeOverride === 'number'
      ? startTimeOverride
      : parseFloat(String(scene.field_6898));
  const endTime =
    typeof endTimeOverride === 'number'
      ? endTimeOverride
      : parseFloat(String(scene.field_6897));
  const duration = endTime - startTime;

  console.log(
    `[FFMPEG] Scene ${scene.id}: start=${scene.field_6898}s, end=${scene.field_6897}s, duration=${duration}s, videoId=${videoId}`,
  );
  console.log(
    `[TIMING] Scene ${
      scene.id
    }: Starting FFmpeg processing at ${new Date().toISOString()}`,
  );
  const ffmpegStartTime = Date.now();

  try {
    // Use direct FFmpeg with hardware acceleration + MinIO upload
    const result = await createVideoClipWithUpload({
      inputUrl: videoUrl,
      startTime: String(startTime),
      endTime: String(endTime),
      // Force CRF-based software encoding for consistent quality.
      // Hardware (videotoolbox) is bitrate-based and can vary scene-to-scene.
      forceSoftwareEncoding: true,
      useHardwareAcceleration: false,
      sceneId: scene.id.toString(),
      videoId: videoId,
      cleanup: true, // Clean up local files after upload
    });

    const ffmpegEndTime = Date.now();
    const processingTime = ffmpegEndTime - ffmpegStartTime;
    console.log(
      `[FFMPEG] Scene ${scene.id} completed in ${processingTime}ms (start=${startTime}s) - CRF software encoded + MinIO uploaded!`,
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
      },
    );

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(
        `Failed to update scene with clip URL: ${response.status} ${errorText}`,
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
    const { sceneId, videoId: requestVideoId } = await request.json();

    if (!sceneId) {
      return NextResponse.json(
        { error: 'Scene ID is required' },
        { status: 400 },
      );
    }

    console.log(
      'Generating clip for scene:',
      sceneId,
      'videoId:',
      requestVideoId,
    );

    // Step 1: Get the scene data
    const scene = await getSceneData(sceneId);

    // Step 2: Get the original video data to get the video URL
    const videoId = scene.field_6889; // Video ID field
    if (!videoId) {
      throw new Error('No video ID found for this scene');
    }

    const originalVideo = await getOriginalVideoData(videoId);
    let videoUrl = extractVideoUrl(originalVideo.field_6881); // Video Uploaded URL
    let usingFallbackStockVideo = false;

    // If no original video URL, try to use stock video from public/videos
    if (!videoUrl) {
      try {
        const { dimension, bgColor } = getVideoDimensionAndBg(originalVideo);
        videoUrl = await uploadStockVideoForScriptScenes(
          dimension,
          bgColor,
          videoId,
        );
        usingFallbackStockVideo = true;
        console.log(
          `Using fallback stock video for scene ${sceneId}: ${videoUrl}`,
        );
      } catch (fallbackError) {
        throw new Error(
          `No video URL found for this scene, and couldn't generate fallback stock video: ${
            fallbackError instanceof Error
              ? fallbackError.message
              : 'Unknown error'
          }`,
        );
      }
    }

    // Step 3: If fallback is used, copy that stock video directly without trimming.
    // Otherwise, generate a trimmed clip from the original uploaded video.
    const clipUrl = usingFallbackStockVideo
      ? videoUrl
      : await createVideoClip(videoUrl, scene, requestVideoId);

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
      { status: 500 },
    );
  }
}
