import { NextRequest, NextResponse } from 'next/server';
import { spawn } from 'child_process';
import path from 'path';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { media_url } = body;

    if (!media_url) {
      return NextResponse.json(
        { error: 'media_url is required' },
        { status: 400 }
      );
    }

    console.log('Starting Parakeet transcription for:', media_url);

    // Path to the Parakeet transcription script
    const scriptPath = path.join(process.cwd(), 'parakeet-transcribe.py');
    const venvPath = path.join(process.cwd(), 'parakeet-env', 'bin', 'python');

    // Run the Parakeet transcription script
    const transcriptionPromise = new Promise((resolve, reject) => {
      const pythonProcess = spawn(venvPath, [scriptPath, media_url], {
        stdio: ['pipe', 'pipe', 'pipe'],
      });

      let stdout = '';
      let stderr = '';

      pythonProcess.stdout.on('data', (data) => {
        stdout += data.toString();
      });

      pythonProcess.stderr.on('data', (data) => {
        stderr += data.toString();
      });

      pythonProcess.on('close', (code) => {
        if (code === 0) {
          try {
            // Parse the JSON output from the Python script
            const result = JSON.parse(stdout);
            resolve(result);
          } catch (parseError) {
            reject(
              new Error(`Failed to parse transcription result: ${parseError}`)
            );
          }
        } else {
          reject(
            new Error(`Transcription failed with code ${code}: ${stderr}`)
          );
        }
      });

      pythonProcess.on('error', (error) => {
        reject(
          new Error(`Failed to start transcription process: ${error.message}`)
        );
      });
    });

    // Wait for transcription to complete
    const transcriptionResult = await transcriptionPromise;

    console.log('Parakeet transcription completed successfully');

    return NextResponse.json(transcriptionResult);
  } catch (error) {
    console.error('Error in transcribe API:', error);
    return NextResponse.json(
      {
        error: 'Failed to transcribe video',
        details: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 }
    );
  }
}
