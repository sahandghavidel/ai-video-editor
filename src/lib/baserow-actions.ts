'use server';

export interface BaserowRow {
  id: number;
  [key: string]: unknown;
}

// Cache the JWT token for the duration of the server action
let cachedToken: string | null = null;
let tokenExpiry: number = 0;

async function getJWTToken(forceRefresh = false): Promise<string> {
  const baserowUrl = process.env.BASEROW_API_URL;
  const email = process.env.BASEROW_EMAIL;
  const password = process.env.BASEROW_PASSWORD;

  if (!baserowUrl || !email || !password) {
    throw new Error(
      'Missing Baserow configuration. Please check your environment variables.'
    );
  }

  // Return cached token if it's still valid (with 5 minute buffer) and not forcing refresh
  if (!forceRefresh && cachedToken && Date.now() < tokenExpiry - 300000) {
    return cachedToken;
  }

  // Clear cached token when refreshing
  cachedToken = null;
  tokenExpiry = 0;

  try {
    console.log('Fetching new JWT token from Baserow...');
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
      console.error('Auth failed with response:', errorText);
      throw new Error(
        `Authentication failed: ${response.status} ${response.statusText} - ${errorText}`
      );
    }

    const data = await response.json();
    cachedToken = data.token;
    // JWT tokens typically expire in 1 hour, cache for 50 minutes to be safe
    tokenExpiry = Date.now() + 50 * 60 * 1000;

    if (!cachedToken) {
      throw new Error('No token received from Baserow');
    }

    console.log('Successfully obtained new JWT token');
    return cachedToken;
  } catch (error) {
    console.error('Error authenticating with Baserow:', error);
    throw error;
  }
}

// Helper function to make API requests with automatic token refresh
async function makeAuthenticatedRequest(
  url: string,
  options: RequestInit = {}
): Promise<Response> {
  async function requestWithToken(token: string): Promise<Response> {
    const response = await fetch(url, {
      ...options,
      headers: {
        ...options.headers,
        Authorization: `JWT ${token}`,
        'Content-Type': 'application/json',
      },
    });

    if (response.status === 401) {
      throw new Error('TOKEN_EXPIRED');
    }

    return response;
  }

  try {
    // First attempt with cached token
    const token = await getJWTToken();
    return await requestWithToken(token);
  } catch (error) {
    // If token expired, try once more with fresh token
    if (error instanceof Error && error.message === 'TOKEN_EXPIRED') {
      console.log('Token expired, refreshing and retrying request...');
      const freshToken = await getJWTToken(true); // Force refresh
      return await requestWithToken(freshToken);
    }

    throw error;
  }
}

export async function getBaserowData(): Promise<BaserowRow[]> {
  const baserowUrl = process.env.BASEROW_API_URL;
  const tableId = process.env.BASEROW_TABLE_ID;

  if (!baserowUrl || !tableId) {
    throw new Error(
      'Missing Baserow configuration. Please check your environment variables.'
    );
  }

  try {
    // Set a high page size to get more rows (Baserow allows up to 200 per request)
    const pageSize = 200;
    let allRows: BaserowRow[] = [];
    let page = 1;
    let hasMore = true;

    while (hasMore) {
      const url = `${baserowUrl}/database/rows/table/${tableId}/?size=${pageSize}&page=${page}`;

      const response = await makeAuthenticatedRequest(url, {
        method: 'GET',
        cache: 'no-store',
      });

      if (!response.ok) {
        const errorText = await response.text();
        console.error('Data fetch failed with response:', errorText);
        throw new Error(
          `Baserow API error: ${response.status} ${response.statusText} - ${errorText}`
        );
      }

      const data = await response.json();
      const results = data.results || [];

      allRows = allRows.concat(results);

      // Check if there are more pages
      hasMore = data.next !== null;
      page++;

      console.log(
        `Fetched page ${page - 1}: ${results.length} rows, Total so far: ${
          allRows.length
        }`
      );
    }

    console.log(`Total rows fetched from Baserow: ${allRows.length}`);
    return allRows;
  } catch (error) {
    console.error('Error fetching Baserow data:', error);
    throw error;
  }
}

export async function getOriginalVideosData(): Promise<BaserowRow[]> {
  const baserowUrl = process.env.BASEROW_API_URL;
  const originalVideosTableId = '713'; // Original videos table ID

  if (!baserowUrl) {
    throw new Error(
      'Missing Baserow configuration. Please check your environment variables.'
    );
  }

  try {
    // Set a high page size to get more rows (Baserow allows up to 200 per request)
    const pageSize = 200;
    let allRows: BaserowRow[] = [];
    let page = 1;
    let hasMore = true;

    while (hasMore) {
      const url = `${baserowUrl}/database/rows/table/${originalVideosTableId}/?size=${pageSize}&page=${page}`;

      const response = await makeAuthenticatedRequest(url, {
        method: 'GET',
        cache: 'no-store',
      });

      if (!response.ok) {
        const errorText = await response.text();
        console.error(
          'Original videos data fetch failed with response:',
          errorText
        );
        throw new Error(
          `Baserow API error: ${response.status} ${response.statusText} - ${errorText}`
        );
      }

      const data = await response.json();
      const results = data.results || [];

      allRows = allRows.concat(results);

      // Check if there are more pages
      hasMore = data.next !== null;
      page++;

      console.log(
        `Fetched original videos page ${page - 1}: ${
          results.length
        } rows, Total so far: ${allRows.length}`
      );
    }

    console.log(
      `Total original videos fetched from Baserow: ${allRows.length}`
    );
    return allRows;
  } catch (error) {
    console.error('Error fetching original videos data:', error);
    throw error;
  }
}

export async function createBaserowRow(
  rowData: Record<string, unknown>
): Promise<BaserowRow> {
  const baserowUrl = process.env.BASEROW_API_URL;
  const tableId = process.env.BASEROW_TABLE_ID;

  if (!baserowUrl || !tableId) {
    throw new Error(
      'Missing Baserow configuration. Please check your environment variables.'
    );
  }

  try {
    const response = await makeAuthenticatedRequest(
      `${baserowUrl}/database/rows/table/${tableId}/`,
      {
        method: 'POST',
        body: JSON.stringify(rowData),
        cache: 'no-store',
      }
    );

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(
        `Baserow API error: ${response.status} ${response.statusText} - ${errorText}`
      );
    }

    return await response.json();
  } catch (error) {
    console.error('Error creating Baserow row:', error);
    throw error;
  }
}

export async function updateBaserowRow(
  rowId: number,
  rowData: Record<string, unknown>
): Promise<BaserowRow> {
  const baserowUrl = process.env.BASEROW_API_URL;
  const tableId = process.env.BASEROW_TABLE_ID;

  if (!baserowUrl || !tableId) {
    throw new Error(
      'Missing Baserow configuration. Please check your environment variables.'
    );
  }

  try {
    const response = await makeAuthenticatedRequest(
      `${baserowUrl}/database/rows/table/${tableId}/${rowId}/`,
      {
        method: 'PATCH',
        body: JSON.stringify(rowData),
        cache: 'no-store',
      }
    );

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(
        `Baserow API error: ${response.status} ${response.statusText} - ${errorText}`
      );
    }

    return await response.json();
  } catch (error) {
    console.error('Error updating Baserow row:', error);
    throw error;
  }
}

export async function updateSceneRow(
  sceneId: number,
  rowData: Record<string, unknown>
): Promise<BaserowRow> {
  // Call the API route instead of making direct Baserow calls
  const baseUrl = process.env.NEXT_PUBLIC_BASE_URL || 'http://localhost:3000';
  const response = await fetch(`${baseUrl}/api/baserow/scenes/${sceneId}`, {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(rowData),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(
      `Baserow API error: ${response.status} ${response.statusText} - ${errorText}`
    );
  }

  return await response.json();
}

export async function deleteBaserowRow(rowId: number): Promise<void> {
  const baserowUrl = process.env.BASEROW_API_URL;
  const tableId = process.env.BASEROW_TABLE_ID;

  if (!baserowUrl || !tableId) {
    throw new Error(
      'Missing Baserow configuration. Please check your environment variables.'
    );
  }

  try {
    const response = await makeAuthenticatedRequest(
      `${baserowUrl}/database/rows/table/${tableId}/${rowId}/`,
      {
        method: 'DELETE',
        cache: 'no-store',
      }
    );

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(
        `Baserow API error: ${response.status} ${response.statusText} - ${errorText}`
      );
    }
  } catch (error) {
    console.error('Error deleting Baserow row:', error);
    throw error;
  }
}

export async function deleteOriginalVideoRow(rowId: number): Promise<void> {
  const baserowUrl = process.env.BASEROW_API_URL;
  const originalVideosTableId = '713'; // Table 713 for original videos

  if (!baserowUrl) {
    throw new Error(
      'Missing Baserow configuration. Please check your environment variables.'
    );
  }

  try {
    const response = await makeAuthenticatedRequest(
      `${baserowUrl}/database/rows/table/${originalVideosTableId}/${rowId}/`,
      {
        method: 'DELETE',
        cache: 'no-store',
      }
    );

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(
        `Baserow API error: ${response.status} ${response.statusText} - ${errorText}`
      );
    }
  } catch (error) {
    console.error('Error deleting original video row:', error);
    throw error;
  }
}

/**
 * Helper function to delete a file from MinIO
 */
async function deleteFileFromMinio(fileUrl: string): Promise<boolean> {
  if (!fileUrl || typeof fileUrl !== 'string') {
    return false;
  }

  try {
    const response = await fetch(fileUrl, { method: 'DELETE' });
    if (response.ok) {
      console.log(`[MINIO] Deleted: ${fileUrl}`);
      return true;
    } else {
      console.warn(`[MINIO] Delete failed (${response.status}): ${fileUrl}`);
      return false;
    }
  } catch (error) {
    console.error(`[MINIO] Error deleting ${fileUrl}:`, error);
    return false;
  }
}

/**
 * Extract URL from field value (handles both strings and array formats)
 * Only returns valid HTTP/HTTPS URLs
 */
function extractUrlFromField(fieldValue: unknown): string | null {
  if (!fieldValue) return null;

  if (typeof fieldValue === 'string') {
    const trimmed = fieldValue.trim();
    // Only return if it's a valid URL starting with http:// or https://
    if (
      trimmed &&
      (trimmed.startsWith('http://') || trimmed.startsWith('https://'))
    ) {
      return trimmed;
    }
    return null;
  }

  if (Array.isArray(fieldValue) && fieldValue.length > 0) {
    const firstItem = fieldValue[0];
    if (
      typeof firstItem === 'object' &&
      firstItem !== null &&
      'url' in firstItem
    ) {
      const url = (firstItem as { url: string }).url;
      // Validate URL
      if (url && (url.startsWith('http://') || url.startsWith('https://'))) {
        return url;
      }
    }
  }

  return null;
}

export async function deleteRelatedScenes(
  originalVideoId: number
): Promise<void> {
  const baserowUrl = process.env.BASEROW_API_URL;
  const scenesTableId = process.env.BASEROW_TABLE_ID; // Table 714 for scenes

  if (!baserowUrl || !scenesTableId) {
    throw new Error(
      'Missing Baserow configuration. Please check your environment variables.'
    );
  }

  try {
    console.log(
      `Starting to delete related scenes for video ${originalVideoId}`
    );

    // Use API filtering to get only scenes that belong to this original video
    const pageSize = 200;
    let allRelatedScenes: BaserowRow[] = [];
    let page = 1;
    let hasMore = true;

    while (hasMore) {
      const url = `${baserowUrl}/database/rows/table/${scenesTableId}/?filter__field_6889__equal=${originalVideoId}&size=${pageSize}&page=${page}`;

      const response = await makeAuthenticatedRequest(url, {
        method: 'GET',
        cache: 'no-store',
      });

      if (!response.ok) {
        const errorText = await response.text();
        console.error('Scenes fetch failed with response:', errorText);
        throw new Error(
          `Baserow API error: ${response.status} ${response.statusText} - ${errorText}`
        );
      }

      const data = await response.json();
      const results = data.results || [];

      allRelatedScenes = allRelatedScenes.concat(results);

      // Check if there are more pages
      hasMore = data.next !== null;
      page++;

      console.log(
        `Fetched page ${
          page - 1
        } for scenes with video ID ${originalVideoId}: ${
          results.length
        } scenes, Total so far: ${allRelatedScenes.length}`
      );
    }

    console.log(
      `Found ${allRelatedScenes.length} related scenes for video ${originalVideoId}:`,
      allRelatedScenes.map((s) => s.id)
    );

    // Delete each related scene sequentially to avoid rate limiting
    const deleteResults: Array<{
      success: boolean;
      sceneId: number;
      error?: unknown;
    }> = [];

    for (const scene of allRelatedScenes) {
      try {
        console.log(
          `Attempting to delete scene ${scene.id} and its MinIO files`
        );

        // Delete all MinIO files associated with this scene
        const minioUrls: string[] = [];

        // Field 6888: Original video clip URL
        const videoUrl = extractUrlFromField(scene.field_6888);
        if (videoUrl) minioUrls.push(videoUrl);

        // Field 6891: TTS audio URL
        const ttsUrl = extractUrlFromField(scene.field_6891);
        if (ttsUrl) minioUrls.push(ttsUrl);

        // Field 6886: Synced/processed video URL
        const syncedUrl = extractUrlFromField(scene.field_6886);
        if (syncedUrl) minioUrls.push(syncedUrl);

        // Field 6897: Generated clip URL
        const clipUrl = extractUrlFromField(scene.field_6897);
        if (clipUrl) minioUrls.push(clipUrl);

        if (minioUrls.length > 0) {
          console.log(
            `[SCENE ${scene.id}] Deleting ${minioUrls.length} MinIO files`
          );

          // Delete all MinIO files (don't wait for all, do sequentially)
          for (const url of minioUrls) {
            await deleteFileFromMinio(url);
            // Small delay between deletes
            await new Promise((resolve) => setTimeout(resolve, 50));
          }
        }

        // Now delete the scene from Baserow
        console.log(`Deleting scene ${scene.id} from table ${scenesTableId}`);
        const response = await makeAuthenticatedRequest(
          `${baserowUrl}/database/rows/table/${scenesTableId}/${scene.id}/`,
          {
            method: 'DELETE',
            cache: 'no-store',
          }
        );

        if (!response.ok) {
          let errorText = 'Unknown error';
          try {
            errorText = await response.text();
          } catch (textError) {
            console.error(
              `Failed to read error response text for scene ${scene.id}:`,
              textError
            );
          }
          console.error(
            `Failed to delete scene ${scene.id}: HTTP ${response.status} ${response.statusText} - ${errorText}`
          );
          deleteResults.push({
            success: false,
            sceneId: scene.id,
            error: new Error(
              `HTTP ${response.status} ${response.statusText}: ${errorText}`
            ),
          });
        } else {
          console.log(`Successfully deleted scene ${scene.id}`);
          deleteResults.push({ success: true, sceneId: scene.id });
        }

        // Small delay to avoid overwhelming the API
        await new Promise((resolve) => setTimeout(resolve, 100));
      } catch (error) {
        console.error(`Error deleting scene ${scene.id}:`, error);
        deleteResults.push({ success: false, sceneId: scene.id, error });
      }
    }

    const successfulDeletes = deleteResults.filter((result) => result.success);
    const failedDeletes = deleteResults.filter((result) => !result.success);

    console.log(
      `Delete summary: ${successfulDeletes.length} successful, ${failedDeletes.length} failed`
    );

    if (failedDeletes.length > 0) {
      console.error(
        'Failed deletes details:',
        failedDeletes.map((f) => ({
          sceneId: f.sceneId,
          error: f.error instanceof Error ? f.error.message : String(f.error),
        }))
      );
      throw new Error(
        `Failed to delete ${failedDeletes.length} out of ${allRelatedScenes.length} scenes`
      );
    }
  } catch (error) {
    console.error('Error deleting related scenes:', error);
    throw error;
  }
}

export async function deleteOriginalVideoWithScenes(
  originalVideoId: number,
  enablePrefixCleanup: boolean = true
): Promise<void> {
  const baserowUrl = process.env.BASEROW_API_URL;
  const originalVideosTableId = '713';

  try {
    // STEP 1: Collect all scene MinIO URLs BEFORE deleting scenes
    // This ensures we capture all files that need deletion
    console.log(
      `[VIDEO ${originalVideoId}] Collecting all MinIO files from scenes`
    );
    console.log(
      `[VIDEO ${originalVideoId}] Prefix cleanup enabled: ${enablePrefixCleanup}`
    );

    const sceneMinioUrls: string[] = [];
    const scenesTableId = '714';

    // Fetch all scenes for this video to collect their MinIO URLs
    let allRelatedScenes: BaserowRow[] = [];
    let page = 1;
    let hasMore = true;
    const pageSize = 200;

    while (hasMore) {
      const url = `${baserowUrl}/database/rows/table/${scenesTableId}/?filter__field_6889__equal=${originalVideoId}&size=${pageSize}&page=${page}`;

      try {
        const response = await makeAuthenticatedRequest(url, {
          method: 'GET',
          cache: 'no-store',
        });

        if (response.ok) {
          const data = await response.json();
          const results = data.results || [];
          allRelatedScenes = allRelatedScenes.concat(results);
          hasMore = data.next !== null;
          page++;
        } else {
          hasMore = false;
        }
      } catch (error) {
        console.warn(
          `[VIDEO ${originalVideoId}] Error fetching scenes page ${page}:`,
          error
        );
        hasMore = false;
      }
    }

    console.log(
      `[VIDEO ${originalVideoId}] Found ${allRelatedScenes.length} scenes to process`
    );

    // Collect all MinIO URLs from scenes
    for (const scene of allRelatedScenes) {
      // Field 6888: Original video clip URL
      const videoUrl = extractUrlFromField(scene.field_6888);
      if (videoUrl) sceneMinioUrls.push(videoUrl);

      // Field 6891: TTS audio URL
      const ttsUrl = extractUrlFromField(scene.field_6891);
      if (ttsUrl) sceneMinioUrls.push(ttsUrl);

      // Field 6886: Synced/processed video URL
      const syncedUrl = extractUrlFromField(scene.field_6886);
      if (syncedUrl) sceneMinioUrls.push(syncedUrl);

      // Field 6897: Generated clip URL
      const clipUrl = extractUrlFromField(scene.field_6897);
      if (clipUrl) sceneMinioUrls.push(clipUrl);
    }

    console.log(
      `[VIDEO ${originalVideoId}] Collected ${sceneMinioUrls.length} MinIO URLs from scenes`
    );

    // STEP 2: Fetch the original video data to collect main video MinIO URLs
    console.log(
      `[VIDEO ${originalVideoId}] Fetching video data for MinIO cleanup`
    );

    let originalVideo: BaserowRow | null = null;

    if (baserowUrl) {
      try {
        const response = await makeAuthenticatedRequest(
          `${baserowUrl}/database/rows/table/${originalVideosTableId}/${originalVideoId}/`,
          {
            method: 'GET',
            cache: 'no-store',
          }
        );

        if (response.ok) {
          originalVideo = await response.json();
          console.log(
            `[VIDEO ${originalVideoId}] Successfully fetched video data`
          );
        } else {
          console.warn(
            `[VIDEO ${originalVideoId}] Failed to fetch video data: ${response.status}`
          );
        }
      } catch (fetchError) {
        console.warn(
          `[VIDEO ${originalVideoId}] Error fetching video data:`,
          fetchError
        );
      }
    }

    // STEP 3: Collect MinIO URLs from the original video record
    const videoMinioUrls: string[] = [];

    if (originalVideo) {
      // Field 6858: Final Merged Video URL
      const mergedVideoUrl = extractUrlFromField(originalVideo.field_6858);
      if (mergedVideoUrl) {
        videoMinioUrls.push(mergedVideoUrl);
        console.log(
          `[VIDEO ${originalVideoId}] Found Final Merged Video (6858)`
        );
      }

      // Field 6861: Captions URL
      const captionsUrl = extractUrlFromField(originalVideo.field_6861);
      if (captionsUrl) {
        videoMinioUrls.push(captionsUrl);
        console.log(`[VIDEO ${originalVideoId}] Found Captions (6861)`);
      }

      // Field 6881: Video Uploaded URL
      const uploadedVideoUrl = extractUrlFromField(originalVideo.field_6881);
      if (uploadedVideoUrl) {
        videoMinioUrls.push(uploadedVideoUrl);
        console.log(
          `[VIDEO ${originalVideoId}] Found Video Uploaded URL (6881)`
        );
      }

      // Field 6903: Normalized Video
      const normalizedVideoUrl = extractUrlFromField(originalVideo.field_6903);
      if (normalizedVideoUrl) {
        videoMinioUrls.push(normalizedVideoUrl);
        console.log(`[VIDEO ${originalVideoId}] Found Normalized Video (6903)`);
      }

      // Field 6907: Silenced Video
      const silencedVideoUrl = extractUrlFromField(originalVideo.field_6907);
      if (silencedVideoUrl) {
        videoMinioUrls.push(silencedVideoUrl);
        console.log(`[VIDEO ${originalVideoId}] Found Silenced Video (6907)`);
      }

      // Field 6908: CFR Video
      const cfrVideoUrl = extractUrlFromField(originalVideo.field_6908);
      if (cfrVideoUrl) {
        videoMinioUrls.push(cfrVideoUrl);
        console.log(`[VIDEO ${originalVideoId}] Found CFR Video (6908)`);
      }
    }

    // STEP 4: Delete ALL collected MinIO files (from scenes + from video)
    const allMinioUrls = [...sceneMinioUrls, ...videoMinioUrls];
    const uniqueMinioUrls = [...new Set(allMinioUrls)]; // Remove duplicates

    console.log(
      `[VIDEO ${originalVideoId}] Total MinIO files to delete: ${uniqueMinioUrls.length}`
    );

    if (uniqueMinioUrls.length > 0) {
      let successCount = 0;
      let failCount = 0;

      for (const url of uniqueMinioUrls) {
        try {
          const deleted = await deleteFileFromMinio(url);
          if (deleted) {
            successCount++;
          } else {
            failCount++;
          }
          await new Promise((resolve) => setTimeout(resolve, 50));
        } catch (error) {
          failCount++;
          console.warn(
            `[VIDEO ${originalVideoId}] Failed to delete ${url}:`,
            error
          );
        }
      }

      console.log(
        `[VIDEO ${originalVideoId}] MinIO deletion complete: ${successCount} succeeded, ${failCount} failed`
      );
    }

    // STEP 5: Extra safety - Delete by prefix to catch any orphaned files (if enabled)
    if (enablePrefixCleanup) {
      console.log(
        `[VIDEO ${originalVideoId}] ========================================`
      );
      console.log(
        `[VIDEO ${originalVideoId}] Starting PREFIX-based cleanup for: video_${originalVideoId}_`
      );
      console.log(
        `[VIDEO ${originalVideoId}] ========================================`
      );

      try {
        const prefix = `video_${originalVideoId}_`;
        const bucket = 'nca-toolkit';
        const minioHost = 'http://host.docker.internal:9000';

        // List all files with the prefix (same as individual deletion - direct to MinIO)
        const listUrl = `${minioHost}/${bucket}/?prefix=${encodeURIComponent(
          prefix
        )}&max-keys=1000`;

        console.log(
          `[VIDEO ${originalVideoId}] Listing files from MinIO: ${listUrl}`
        );

        const listResponse = await fetch(listUrl, { method: 'GET' });

        console.log(
          `[VIDEO ${originalVideoId}] List response status: ${listResponse.status}`
        );

        if (!listResponse.ok) {
          console.warn(
            `[VIDEO ${originalVideoId}] ⚠️  Failed to list files: ${listResponse.status}`
          );
        } else {
          const xmlText = await listResponse.text();
          console.log(
            `[VIDEO ${originalVideoId}] Received XML (${xmlText.length} bytes)`
          );

          // Parse XML to extract file keys
          const keyMatches = xmlText.matchAll(/<Key>([^<]+)<\/Key>/g);
          const fileKeys: string[] = [];

          for (const match of keyMatches) {
            fileKeys.push(match[1]);
          }

          console.log(
            `[VIDEO ${originalVideoId}] Found ${fileKeys.length} files with prefix`
          );

          if (fileKeys.length > 0) {
            console.log(`[VIDEO ${originalVideoId}] Files to delete:`);
            fileKeys.forEach((key, index) => {
              console.log(`[VIDEO ${originalVideoId}]   ${index + 1}. ${key}`);
            });

            // Delete each file directly (same method as individual file deletion)
            let prefixSuccessCount = 0;
            let prefixFailCount = 0;

            for (const key of fileKeys) {
              const fileUrl = `${minioHost}/${bucket}/${key}`;
              try {
                const deleted = await deleteFileFromMinio(fileUrl);
                if (deleted) {
                  prefixSuccessCount++;
                } else {
                  prefixFailCount++;
                }
                await new Promise((resolve) => setTimeout(resolve, 50));
              } catch (error) {
                prefixFailCount++;
                console.warn(
                  `[VIDEO ${originalVideoId}] Failed to delete ${key}:`,
                  error
                );
              }
            }

            console.log(
              `[VIDEO ${originalVideoId}] ✅ Prefix cleanup complete: ${prefixSuccessCount} deleted, ${prefixFailCount} failed`
            );
          } else {
            console.log(
              `[VIDEO ${originalVideoId}] No additional files found with prefix`
            );
          }
        }
      } catch (prefixError) {
        console.error(
          `[VIDEO ${originalVideoId}] ❌ EXCEPTION during prefix cleanup:`,
          prefixError
        );
      }

      console.log(
        `[VIDEO ${originalVideoId}] ======================================== END PREFIX CLEANUP`
      );
    } else {
      console.log(
        `[VIDEO ${originalVideoId}] Prefix cleanup is disabled - skipping STEP 5`
      );
    }

    // STEP 6: Delete all related scenes from Baserow
    await deleteRelatedScenes(originalVideoId);

    // STEP 7: Finally, delete the original video row from Baserow
    await deleteOriginalVideoRow(originalVideoId);

    console.log(
      `Successfully deleted original video ${originalVideoId} and all related data from Baserow and MinIO (${uniqueMinioUrls.length} files deleted via fields + prefix cleanup)`
    );
  } catch (error) {
    console.error('Error deleting original video with scenes:', error);
    throw error;
  }
}

export async function createOriginalVideoRow(
  rowData: Record<string, unknown>
): Promise<BaserowRow> {
  const baserowUrl = process.env.BASEROW_API_URL;
  const originalVideosTableId = '713'; // Table 713 for original videos

  if (!baserowUrl) {
    throw new Error(
      'Missing Baserow configuration. Please check your environment variables.'
    );
  }

  try {
    const response = await makeAuthenticatedRequest(
      `${baserowUrl}/database/rows/table/${originalVideosTableId}/`,
      {
        method: 'POST',
        body: JSON.stringify(rowData),
        cache: 'no-store',
      }
    );

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(
        `Baserow API error: ${response.status} ${response.statusText} - ${errorText}`
      );
    }

    return await response.json();
  } catch (error) {
    console.error('Error creating original video row:', error);
    throw error;
  }
}

export async function getOriginalVideoRow(rowId: number): Promise<BaserowRow> {
  const baserowUrl = process.env.BASEROW_API_URL;
  const originalVideosTableId = '713'; // Table 713 for original videos

  if (!baserowUrl) {
    throw new Error(
      'Missing Baserow configuration. Please check your environment variables.'
    );
  }

  try {
    const response = await makeAuthenticatedRequest(
      `${baserowUrl}/database/rows/table/${originalVideosTableId}/${rowId}/`,
      {
        method: 'GET',
        cache: 'no-store',
      }
    );

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(
        `Baserow API error: ${response.status} ${response.statusText} - ${errorText}`
      );
    }

    return await response.json();
  } catch (error) {
    console.error('Error fetching original video row:', error);
    throw error;
  }
}

export async function updateOriginalVideoRow(
  rowId: number,
  rowData: Record<string, unknown>
): Promise<void> {
  const baserowUrl = process.env.BASEROW_API_URL;
  const originalVideosTableId = '713'; // Table 713 for original videos

  if (!baserowUrl) {
    throw new Error(
      'Missing Baserow configuration. Please check your environment variables.'
    );
  }

  try {
    const response = await makeAuthenticatedRequest(
      `${baserowUrl}/database/rows/table/${originalVideosTableId}/${rowId}/`,
      {
        method: 'PATCH',
        body: JSON.stringify(rowData),
        cache: 'no-store',
      }
    );

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(
        `Baserow API error: ${response.status} ${response.statusText} - ${errorText}`
      );
    }

    // No return value needed
  } catch (error) {
    console.error('Error updating original video row:', error);
    throw error;
  }
}

export async function getSceneById(
  sceneId: number
): Promise<BaserowRow | null> {
  const baserowUrl = process.env.BASEROW_API_URL;
  const scenesTableId = '714'; // Scenes table

  if (!baserowUrl) {
    throw new Error(
      'Missing Baserow configuration. Please check your environment variables.'
    );
  }

  try {
    const url = `${baserowUrl}/database/rows/table/${scenesTableId}/${sceneId}/`;

    const response = await makeAuthenticatedRequest(url, {
      method: 'GET',
      cache: 'no-store',
    });

    if (!response.ok) {
      if (response.status === 404) {
        return null; // Scene not found
      }
      const errorText = await response.text();
      console.error('Scene fetch failed with response:', errorText);
      throw new Error(
        `Baserow API error: ${response.status} ${response.statusText} - ${errorText}`
      );
    }

    return await response.json();
  } catch (error) {
    console.error('Error fetching scene:', error);
    throw error;
  }
}
