import { NextRequest, NextResponse } from 'next/server';
import {
  concatenateVideosWithUpload,
  concatenateVideosFast,
} from '@/utils/ffmpeg-merge';
import { deleteFromMinio } from '@/utils/minio-client';

type VideoUrlInput = string | { video_url: string };

export async function POST(request: NextRequest) {
  try {
    const {
      video_urls,
      id,
      fast_mode = true,
      old_merged_url,
    } = await request.json();

    if (!video_urls || !Array.isArray(video_urls) || video_urls.length === 0) {
      return NextResponse.json(
        { error: 'video_urls array is required and must not be empty' },
        { status: 400 }
      );
    }

    // Extract URLs from the video_urls array
    const videoUrls = video_urls.map((videoObj: VideoUrlInput) => {
      if (typeof videoObj === 'string') {
        return videoObj;
      }
      if (videoObj.video_url) {
        return videoObj.video_url;
      }
      throw new Error(
        'Each video_urls item must have a valid video_url string'
      );
    });

    console.log(
      `[MERGE] Starting ${fast_mode ? 'fast' : 'standard'} merge of ${
        videoUrls.length
      } videos`
    );

    // Delete old merged video from MinIO if provided
    if (old_merged_url && typeof old_merged_url === 'string') {
      console.log(`[MERGE] Deleting old merged video: ${old_merged_url}`);
      const deleted = await deleteFromMinio(old_merged_url);
      if (deleted) {
        console.log(`[MERGE] Successfully deleted old merged video`);
      } else {
        console.warn(
          `[MERGE] Failed to delete old merged video (continuing anyway)`
        );
      }
    }

    const mergeStartTime = Date.now();

    let result;

    if (fast_mode) {
      try {
        // Try fast concatenation first (copy mode - no re-encoding)
        const localPath = await concatenateVideosFast(videoUrls);

        // Upload to MinIO
        const { uploadUrl } = await concatenateVideosWithUpload({
          videoUrls: [localPath], // Just upload the already merged file
          videoId: id,
          cleanup: true,
        });

        result = { videoUrl: uploadUrl };
      } catch (error) {
        console.log(
          '[MERGE] Fast mode failed, falling back to standard mode:',
          error
        );

        // Fallback to standard concatenation with re-encoding
        const { uploadUrl } = await concatenateVideosWithUpload({
          videoUrls,
          videoId: id,
          useHardwareAcceleration: true,
          videoBitrate: '6000k',
          cleanup: true,
        });

        result = { videoUrl: uploadUrl };
      }
    } else {
      // Standard concatenation with re-encoding
      const { uploadUrl } = await concatenateVideosWithUpload({
        videoUrls,
        videoId: id,
        useHardwareAcceleration: true,
        videoBitrate: '6000k',
        cleanup: true,
      });

      result = { videoUrl: uploadUrl };
    }

    const mergeEndTime = Date.now();
    const processingTime = mergeEndTime - mergeStartTime;

    console.log(
      `[MERGE] Completed in ${processingTime}ms - Output: ${result.videoUrl}`
    );

    return NextResponse.json({
      videoUrl: result.videoUrl,
      id: id || `merge_${Date.now()}`,
      message: `Successfully merged ${videoUrls.length} videos using direct FFmpeg`,
      runTime: `${processingTime}ms`,
      method: fast_mode ? 'fast_copy' : 'standard_encode',
    });
  } catch (error) {
    console.error('[MERGE] Error concatenating videos:', error);
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : 'Unknown error occurred',
      },
      { status: 500 }
    );
  }
}
