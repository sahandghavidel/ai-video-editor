import { NextRequest, NextResponse } from 'next/server';

/**
 * Delete all files from MinIO that start with a specific prefix
 * Safely deletes files matching video_XXX_* pattern
 */
export async function POST(request: NextRequest) {
  try {
    const { prefix } = await request.json();

    if (!prefix) {
      return NextResponse.json(
        { success: false, error: 'Prefix is required' },
        { status: 400 }
      );
    }

    // Safety check: ensure prefix matches expected pattern (video_NUMBER_)
    const prefixPattern = /^video_\d+_/;
    if (!prefixPattern.test(prefix)) {
      return NextResponse.json(
        {
          success: false,
          error: 'Invalid prefix format. Must be video_NUMBER_',
        },
        { status: 400 }
      );
    }

    console.log(
      `[API DELETE BY PREFIX] Starting deletion for prefix: ${prefix}`
    );

    const bucket = 'nca-toolkit';
    const minioHost = 'http://host.docker.internal:9000';

    // Step 1: List all objects in the bucket
    // MinIO's S3-compatible API doesn't have a simple list endpoint via HTTP
    // We'll use a workaround: try to list files using AWS SDK patterns
    // For now, we'll use the bucket listing endpoint with prefix parameter

    const listUrl = `${minioHost}/${bucket}/?prefix=${encodeURIComponent(
      prefix
    )}&max-keys=1000`;

    console.log(`[API DELETE BY PREFIX] Listing files with URL: ${listUrl}`);

    const listResponse = await fetch(listUrl, {
      method: 'GET',
    });

    if (!listResponse.ok) {
      console.warn(
        `[API DELETE BY PREFIX] Failed to list files: ${listResponse.status}`
      );
      return NextResponse.json(
        {
          success: false,
          error: `Failed to list files: ${listResponse.status}`,
        },
        { status: listResponse.status }
      );
    }

    const xmlText = await listResponse.text();
    console.log(
      `[API DELETE BY PREFIX] Received XML response (${xmlText.length} bytes)`
    );

    // Parse XML to extract file keys
    // Simple regex-based parsing (for production, use a proper XML parser)
    const keyMatches = xmlText.matchAll(/<Key>([^<]+)<\/Key>/g);
    const fileKeys: string[] = [];

    for (const match of keyMatches) {
      fileKeys.push(match[1]);
    }

    console.log(
      `[API DELETE BY PREFIX] Found ${fileKeys.length} files to delete`
    );

    if (fileKeys.length === 0) {
      return NextResponse.json({
        success: true,
        message: 'No files found matching prefix',
        deletedCount: 0,
        fileKeys: [],
      });
    }

    // Step 2: Delete each file
    const deletionResults = [];
    let successCount = 0;
    let failCount = 0;

    for (const key of fileKeys) {
      const fileUrl = `${minioHost}/${bucket}/${key}`;
      console.log(`[API DELETE BY PREFIX] Deleting: ${fileUrl}`);

      try {
        const deleteResponse = await fetch(fileUrl, {
          method: 'DELETE',
        });

        if (deleteResponse.ok || deleteResponse.status === 204) {
          successCount++;
          deletionResults.push({ file: key, success: true });
          console.log(`[API DELETE BY PREFIX] ✓ Deleted: ${key}`);
        } else {
          failCount++;
          deletionResults.push({
            file: key,
            success: false,
            error: `Status ${deleteResponse.status}`,
          });
          console.warn(
            `[API DELETE BY PREFIX] ✗ Failed to delete ${key}: ${deleteResponse.status}`
          );
        }

        // Small delay to avoid overwhelming MinIO
        await new Promise((resolve) => setTimeout(resolve, 50));
      } catch (error) {
        failCount++;
        deletionResults.push({
          file: key,
          success: false,
          error: error instanceof Error ? error.message : 'Unknown error',
        });
        console.error(`[API DELETE BY PREFIX] ✗ Error deleting ${key}:`, error);
      }
    }

    console.log(
      `[API DELETE BY PREFIX] Completed: ${successCount} deleted, ${failCount} failed`
    );

    return NextResponse.json({
      success: true,
      message: `Deleted ${successCount} of ${fileKeys.length} files`,
      deletedCount: successCount,
      failedCount: failCount,
      totalFiles: fileKeys.length,
      results: deletionResults,
    });
  } catch (error) {
    console.error('[API DELETE BY PREFIX] Error:', error);
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 }
    );
  }
}
