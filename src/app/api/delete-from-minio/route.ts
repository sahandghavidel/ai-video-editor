import { NextRequest, NextResponse } from 'next/server';

export async function POST(request: NextRequest) {
  try {
    const { fileUrl } = await request.json();

    if (!fileUrl) {
      return NextResponse.json(
        { success: false, error: 'File URL is required' },
        { status: 400 }
      );
    }

    console.log(`[API] Attempting to delete from MinIO: ${fileUrl}`);

    const deleteResponse = await fetch(fileUrl, {
      method: 'DELETE',
    });

    if (deleteResponse.ok || deleteResponse.status === 204) {
      console.log(`[API] Successfully deleted from MinIO: ${fileUrl}`);
      return NextResponse.json({
        success: true,
        message: 'File deleted successfully',
      });
    } else {
      console.warn(
        `[API] MinIO delete failed with status ${deleteResponse.status}`
      );
      return NextResponse.json(
        {
          success: false,
          error: `Delete failed with status ${deleteResponse.status}`,
        },
        { status: deleteResponse.status }
      );
    }
  } catch (error) {
    console.error('[API] Error deleting from MinIO:', error);
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 }
    );
  }
}
