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
