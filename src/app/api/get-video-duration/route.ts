import { NextRequest, NextResponse } from 'next/server';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

export async function POST(request: NextRequest) {
  try {
    const { videoUrl } = await request.json();

    if (!videoUrl) {
      return NextResponse.json(
        { error: 'videoUrl is required' },
        { status: 400 }
      );
    }

    console.log(`[DURATION] Getting duration for: ${videoUrl}`);

    // Use ffprobe to get video duration
    const ffprobeCommand = `ffprobe -v quiet -print_format json -show_format "${videoUrl}"`;

    const { stdout } = await execAsync(ffprobeCommand);
    const metadata = JSON.parse(stdout);

    const duration = parseFloat(metadata.format?.duration || '0');

    console.log(`[DURATION] Video duration: ${duration} seconds`);

    return NextResponse.json({
      duration,
      formatted: formatDuration(duration),
    });
  } catch (error) {
    console.error('[DURATION] Error getting video duration:', error);
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : 'Unknown error occurred',
        duration: 0, // Return 0 as fallback
      },
      { status: 500 }
    );
  }
}

// Helper function to format duration in HH:MM:SS
function formatDuration(seconds: number): string {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = Math.floor(seconds % 60);

  if (hours > 0) {
    return `${hours}:${minutes.toString().padStart(2, '0')}:${secs
      .toString()
      .padStart(2, '0')}`;
  } else {
    return `${minutes}:${secs.toString().padStart(2, '0')}`;
  }
}
