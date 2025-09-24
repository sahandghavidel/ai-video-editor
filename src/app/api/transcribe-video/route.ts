import { NextRequest, NextResponse } from 'next/server';
import { spawn } from 'child_process';
import path from 'path';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { media_url, model = 'parakeet' } = body;

    if (!media_url) {
      return NextResponse.json(
        { error: 'media_url is required' },
        { status: 400 }
      );
    }

    console.log(`Starting ${model} transcription for:`, media_url);

    // Handle different transcription models
    let transcriptionPromise: Promise<any>;

    if (model === 'parakeet') {
      // Path to the Parakeet transcription script
      const scriptPath = path.join(process.cwd(), 'parakeet-transcribe.py');
      const venvPath = path.join(
        process.cwd(),
        'parakeet-env',
        'bin',
        'python'
      );

      // Run the Parakeet transcription script
      transcriptionPromise = new Promise((resolve, reject) => {
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
    } else if (model === 'small') {
      // Path to the Whisper small transcription script
      const scriptPath = path.join(
        process.cwd(),
        'whisper-small-transcribe.py'
      );
      const venvPath = 'python3'; // Use system python3

      // Run the Whisper small transcription script
      transcriptionPromise = new Promise((resolve, reject) => {
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
    } else if (model === 'tiny') {
      // Path to the Whisper tiny transcription script
      const scriptPath = path.join(process.cwd(), 'whisper-tiny-transcribe.py');
      const venvPath = 'python3'; // Use system python3

      // Run the Whisper tiny transcription script
      transcriptionPromise = new Promise((resolve, reject) => {
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
              new Error(
                `Whisper tiny transcription failed with code ${code}: ${stderr}`
              )
            );
          }
        });

        pythonProcess.on('error', (error) => {
          reject(
            new Error(
              `Failed to start Whisper tiny transcription process: ${error.message}`
            )
          );
        });
      });
    } else {
      return NextResponse.json(
        { error: `Unknown transcription model: ${model}` },
        { status: 400 }
      );
    }

    // Wait for transcription to complete
    const transcriptionResult = await transcriptionPromise;

    console.log(`${model} transcription completed successfully`);

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
