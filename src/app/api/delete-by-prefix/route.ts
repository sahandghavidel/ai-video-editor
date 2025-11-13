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
      `[API DELETE BY PREFIX] ========================================`
    );
    console.log(
      `[API DELETE BY PREFIX] Starting deletion for prefix: ${prefix}`
    );

    const bucket = 'nca-toolkit';
    const minioHost = 'http://host.docker.internal:9000';

    // Step 1: List all objects in the bucket
    const listUrl = `${minioHost}/${bucket}/?prefix=${encodeURIComponent(
      prefix
    )}&max-keys=1000`;

    console.log(`[API DELETE BY PREFIX] MinIO host: ${minioHost}`);
    console.log(`[API DELETE BY PREFIX] Bucket: ${bucket}`);
    console.log(`[API DELETE BY PREFIX] List URL: ${listUrl}`);
    console.log(`[API DELETE BY PREFIX] Fetching file list...`);

    const listResponse = await fetch(listUrl, {
      method: 'GET',
    });

    console.log(
      `[API DELETE BY PREFIX] List response status: ${listResponse.status}`
    );
    console.log(
      `[API DELETE BY PREFIX] List response headers:`,
      Object.fromEntries(listResponse.headers.entries())
    );

    if (!listResponse.ok) {
      const errorText = await listResponse.text();
      console.error(
        `[API DELETE BY PREFIX] ❌ Failed to list files: ${listResponse.status}`
      );
      console.error(`[API DELETE BY PREFIX] Error response: ${errorText}`);
      return NextResponse.json(
        {
          success: false,
          error: `Failed to list files: ${listResponse.status} - ${errorText}`,
        },
        { status: listResponse.status }
      );
    }

    const xmlText = await listResponse.text();
    console.log(
      `[API DELETE BY PREFIX] ✓ Received XML response (${xmlText.length} bytes)`
    );

    // Log first 500 characters of XML for debugging
    if (xmlText.length > 0) {
      console.log(
        `[API DELETE BY PREFIX] XML preview: ${xmlText.substring(0, 500)}...`
      );
    }

    // Parse XML to extract file keys
    // Simple regex-based parsing (for production, use a proper XML parser)
    console.log(`[API DELETE BY PREFIX] Parsing XML for file keys...`);
    const keyMatches = xmlText.matchAll(/<Key>([^<]+)<\/Key>/g);
    const fileKeys: string[] = [];

    for (const match of keyMatches) {
      fileKeys.push(match[1]);
    }

    console.log(
      `[API DELETE BY PREFIX] ✓ Found ${fileKeys.length} files matching prefix`
    );

    if (fileKeys.length > 0) {
      console.log(`[API DELETE BY PREFIX] Files to delete:`);
      fileKeys.forEach((key, index) => {
        console.log(`[API DELETE BY PREFIX]   ${index + 1}. ${key}`);
      });
    }

    if (fileKeys.length === 0) {
      console.log(
        `[API DELETE BY PREFIX] ⚠️  No files found matching prefix: ${prefix}`
      );
      return NextResponse.json({
        success: true,
        message: 'No files found matching prefix',
        deletedCount: 0,
        failedCount: 0,
        totalFiles: 0,
        fileKeys: [],
      });
    }

    console.log(
      `[API DELETE BY PREFIX] Starting deletion of ${fileKeys.length} files...`
    );

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
