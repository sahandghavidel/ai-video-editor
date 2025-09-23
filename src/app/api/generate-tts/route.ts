import { NextRequest, NextResponse } from 'next/server';
import { spawn } from 'child_process';
import path from 'path';
import fs from 'fs';

// TTS Server management
let ttsServerProcess: any = null;
let serverTimeout: NodeJS.Timeout | null = null;
const SERVER_TIMEOUT = 5 * 60 * 1000; // 5 minutes

async function startTTSServer(): Promise<void> {
  if (ttsServerProcess) {
    console.log('TTS server already running');
    return;
  }

  // Wait for any previous server to fully shut down
  await waitForServerShutdown();

  return new Promise((resolve, reject) => {
    try {
      // Path to the chatterbox-tts-server directory
      // Try multiple possible locations
      const possiblePaths = [
        path.join(process.cwd(), '..', 'chatterbox-tts-server'),
        path.join(process.env.HOME || '', 'chatterbox-tts-server'),
        path.join('/Users', 'sahand', 'chatterbox-tts-server'),
      ];

      let serverPath = null;
      for (const testPath of possiblePaths) {
        try {
          if (fs.existsSync(path.join(testPath, 'server_api_only.py'))) {
            serverPath = testPath;
            break;
          }
        } catch (error) {
          // Continue checking other paths
        }
      }

      if (!serverPath) {
        throw new Error(
          'Could not find chatterbox-tts-server directory. Please ensure it exists in one of the expected locations.'
        );
      }

      console.log('Starting TTS server from:', serverPath);

      ttsServerProcess = spawn('python3', ['server_api_only.py'], {
        cwd: serverPath,
        stdio: 'ignore', // Don't inherit stdio to prevent hanging
        detached: true, // Keep server alive independently
      });

      // Handle server output (removed since we're using stdio: 'ignore')
      // The server will run independently without piping output to this process

      ttsServerProcess.on('close', (code: number) => {
        console.log(`TTS server exited with code ${code}`);
        ttsServerProcess = null;
        if (serverTimeout) {
          clearTimeout(serverTimeout);
          serverTimeout = null;
        }
      });

      ttsServerProcess.on('error', (error: Error) => {
        console.error('Failed to start TTS server:', error);
        ttsServerProcess = null;
        reject(error);
      });

      // Unref to allow parent to exit independently
      ttsServerProcess.unref();

      // Since we're using server_api_only.py, the server should start much faster
      // Give it a moment to start up
      setTimeout(() => {
        if (ttsServerProcess) {
          console.log('TTS server process started (assuming it\'s ready)');
          resolve();
        }
      }, 2000);
    } catch (error) {
      console.error('Error starting TTS server:', error);
      reject(error);
    }
  });
}

function scheduleServerStop(): void {
  // Clear existing timeout
  if (serverTimeout) {
    clearTimeout(serverTimeout);
  }

  // Schedule new timeout
  serverTimeout = setTimeout(() => {
    if (ttsServerProcess) {
      console.log('Auto-stopping TTS server after 5 minutes of inactivity');
      ttsServerProcess.kill('SIGTERM');

      // Force kill after 5 seconds if it doesn't respond
      setTimeout(() => {
        if (ttsServerProcess) {
          console.log('Force killing TTS server');
          ttsServerProcess.kill('SIGKILL');
          ttsServerProcess = null;
        }
      }, 5000);
    }
    serverTimeout = null;
  }, SERVER_TIMEOUT);
}

async function checkTTSServer(): Promise<{
  running: boolean;
  modelLoaded: boolean;
}> {
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 2000);

    const response = await fetch('http://host.docker.internal:8004/health', {
      method: 'GET',
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    if (response.ok) {
      const data = await response.json();
      return {
        running: data.status === 'healthy',
        modelLoaded: data.model_loaded || false,
      };
    }

    return { running: false, modelLoaded: false };
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      console.log('Server check timed out - server might be shutting down');
      return { running: false, modelLoaded: false };
    }
    return { running: false, modelLoaded: false };
  }
}

async function waitForServerShutdown(): Promise<void> {
  console.log('Waiting for previous TTS server to shut down...');
  let attempts = 0;
  const maxAttempts = 10; // 10 seconds max wait

  while (attempts < maxAttempts) {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 1000);

      // Use health endpoint for shutdown check
      const shutdownResponse = await fetch('http://host.docker.internal:8004/health', {
        method: 'GET',
        signal: controller.signal,
      });
      // Server is shut down if health check fails
      if (!shutdownResponse.ok) {
        throw new Error('Server is down');
      }

      clearTimeout(timeoutId);
      // If we get here, server is still responding, wait longer
      await new Promise((resolve) => setTimeout(resolve, 1000));
      attempts++;
    } catch (error) {
      // Server is no longer responding, it's shut down
      console.log('Previous TTS server has shut down');
      return;
    }
  }

  console.log('Previous TTS server shutdown timeout, proceeding anyway');
}

export async function POST(request: NextRequest) {
  try {
    const { text, sceneId, ttsSettings } = await request.json();

    if (!text || !sceneId) {
      return NextResponse.json(
        { error: 'Text and sceneId are required' },
        { status: 400 }
      );
    }

    // Check if TTS server is running, start if not
    const serverStatus = await checkTTSServer();
    console.log('TTS server status:', serverStatus);

    if (!serverStatus.running) {
      console.log('TTS server not running, starting it...');
      try {
        await startTTSServer();
        console.log('TTS server started successfully');
      } catch (error) {
        console.error('Failed to start TTS server:', error);
        return NextResponse.json(
          { error: 'Failed to start TTS server' },
          { status: 500 }
        );
      }

      // Wait for server to be ready (much faster now)
      console.log('Waiting for TTS server to be ready...');
      await new Promise((resolve) => setTimeout(resolve, 1000));

      // Check again if model is loaded
      const newStatus = await checkTTSServer();
      if (!newStatus.modelLoaded) {
        console.log('Model still loading, but server is ready for requests');
      }
    } else if (!serverStatus.modelLoaded) {
      console.log(
        'TTS server running but model still loading - proceeding anyway'
      );
    } else {
      console.log('TTS server is fully ready');
    }

    // Use dynamic TTS settings or defaults
    const settings = ttsSettings || {
      temperature: 0.2,
      exaggeration: 0.8,
      cfg_weight: 0.2,
      seed: 1212,
      reference_audio_filename: 'calmS5wave.wav',
    };

    // Step 1: Generate TTS
    const ttsPayload = {
      text: text,
      temperature: settings.temperature,
      exaggeration: settings.exaggeration,
      cfg_weight: settings.cfg_weight,
      speed_factor: 1,
      seed: settings.seed,
      language: 'en',
      voice_mode: 'clone',
      split_text: true,
      chunk_size: 50,
      output_format: 'wav',
      reference_audio_filename: settings.reference_audio_filename,
    };

    const ttsResponse = await fetch('http://host.docker.internal:8004/tts', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(ttsPayload),
    });

    if (!ttsResponse.ok) {
      throw new Error(`TTS service error: ${ttsResponse.status}`);
    }

    // Get the audio file as buffer
    const audioBuffer = await ttsResponse.arrayBuffer();

    // Step 2: Upload to MinIO
    const timestamp = Date.now();
    const filename = `tts_${sceneId}_${timestamp}.wav`;
    const bucket = 'nca-toolkit';
    const uploadUrl = `http://host.docker.internal:9000/${bucket}/${filename}`;

    // Upload to MinIO
    const uploadResponse = await fetch(uploadUrl, {
      method: 'PUT',
      headers: {
        'Content-Type': 'audio/wav',
      },
      body: audioBuffer,
    });

    if (!uploadResponse.ok) {
      throw new Error(`MinIO upload error: ${uploadResponse.status}`);
    }

    // Schedule server stop after successful generation
    scheduleServerStop();

    return NextResponse.json({
      audioUrl: uploadUrl,
      filename,
      bucket,
      sceneId,
    });
  } catch (error) {
    console.error('Error generating TTS:', error);
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : 'Unknown error occurred',
      },
      { status: 500 }
    );
  } finally {
    // Schedule server timeout after TTS generation
    scheduleServerStop();
  }
}
