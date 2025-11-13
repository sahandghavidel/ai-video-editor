/**
 * Client-safe MinIO utilities
 * These functions can be used in both client and server components
 */

/**
 * Delete a file from MinIO storage via API endpoint
 * @param fileUrl - The full URL of the file to delete
 * @returns Promise<boolean> - true if deletion succeeded, false otherwise
 */
export async function deleteFromMinio(fileUrl: string): Promise<boolean> {
  try {
    console.log(`[MINIO CLIENT] Requesting deletion of file: ${fileUrl}`);

    const response = await fetch('/api/delete-from-minio', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ fileUrl }),
    });

    const result = await response.json();

    if (result.success) {
      console.log(`[MINIO CLIENT] Successfully deleted: ${fileUrl}`);
      return true;
    } else {
      console.warn(
        `[MINIO CLIENT] Delete failed: ${result.error || 'Unknown error'}`
      );
      return false;
    }
  } catch (error) {
    console.error('[MINIO CLIENT] Error deleting file:', error);
    return false;
  }
}

/**
 * Delete all files from MinIO that match a specific prefix
 * Safely deletes files matching video_XXX_* pattern
 * @param prefix - The prefix to match (e.g., "video_820_")
 * @returns Promise<{success: boolean, deletedCount: number, message: string}>
 */
export async function deleteByPrefixFromMinio(prefix: string): Promise<{
  success: boolean;
  deletedCount: number;
  failedCount: number;
  message: string;
}> {
  try {
    console.log(
      `[MINIO CLIENT] Requesting bulk deletion for prefix: ${prefix}`
    );

    const response = await fetch('/api/delete-by-prefix', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ prefix }),
    });

    const result = await response.json();

    if (result.success) {
      console.log(
        `[MINIO CLIENT] Successfully deleted ${result.deletedCount} files with prefix: ${prefix}`
      );
      return {
        success: true,
        deletedCount: result.deletedCount || 0,
        failedCount: result.failedCount || 0,
        message: result.message || 'Files deleted successfully',
      };
    } else {
      console.warn(
        `[MINIO CLIENT] Bulk delete failed: ${result.error || 'Unknown error'}`
      );
      return {
        success: false,
        deletedCount: 0,
        failedCount: 0,
        message: result.error || 'Unknown error',
      };
    }
  } catch (error) {
    console.error('[MINIO CLIENT] Error in bulk delete:', error);
    return {
      success: false,
      deletedCount: 0,
      failedCount: 0,
      message: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}
