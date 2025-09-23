import { NextRequest, NextResponse } from 'next/server';
import { spawn } from 'child_process';
import path from 'path';
import fs from 'fs';

// TTS Server management - optimized for fast API-only server
let ttsServerProce; // Brief wait for server initialization (optimized for fast startup)
console.log('⏳ Waiting for TTS server to be ready...');
await new Promise((resolve) => setTimeout(resolve, 3000)); // Increased from 1000ms to 3000ms

// Check server status after startup with retries
let newStatus;
let readinessAttempts = 0;
const maxReadinessAttempts = 5;

while (readinessAttempts < maxReadinessAttempts) {
  newStatus = await checkTTSServer();
  if (newStatus.running) {
    if (newStatus.modelLoaded) {
      console.log('✅ TTS server fully ready with model loaded');
    } else if (newStatus.modelLoading) {
      console.log('✅ TTS server ready, model loading in background');
    } else {
      console.log('✅ TTS server ready, model will load on first request');
    }
    break;
  } else {
    console.log(
      `⏳ TTS server not ready yet (attempt ${
        readinessAttempts + 1
      }/${maxReadinessAttempts}), waiting...`
    );
    await new Promise((resolve) => setTimeout(resolve, 1000));
    readinessAttempts++;
  }
}

// TTS Server management - optimized for fast API-only server
let ttsServerProcess: ReturnType<typeof spawn> | null = null;
let serverTimeout: NodeJS.Timeout | null = null;
const SERVER_TIMEOUT = 5 * 60 * 1000; // 5 minutes
const SERVER_HOST = 'host.docker.internal';
const SERVER_PORT = 8004;
const SERVER_URL = `http://${SERVER_HOST}:${SERVER_PORT}`;

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
        } catch (_error) {
          // eslint-disable-line @typescript-eslint/no-unused-vars
          // Continue checking other paths
        }
      }

      if (!serverPath) {
        throw new Error(
          'Could not find chatterbox-tts-server directory. Please ensure it exists in one of the expected locations.'
        );
      }

      console.log('🚀 Starting optimized TTS server from:', serverPath);

      // Optimized spawn configuration for fast API-only server
      ttsServerProcess = spawn('python3', ['server_api_only.py'], {
        cwd: serverPath,
        stdio: 'ignore', // Don't inherit stdio for independent operation
        detached: true, // Keep server alive independently
        env: { ...process.env, PYTHONUNBUFFERED: '1' }, // Ensure Python output is not buffered
      });

      // Handle process events
      ttsServerProcess.on('close', (code: number) => {
        console.log(`🛑 TTS server exited with code ${code}`);
        ttsServerProcess = null;
        if (serverTimeout) {
          clearTimeout(serverTimeout);
          serverTimeout = null;
        }
      });

      ttsServerProcess.on('error', (error: Error) => {
        console.error('❌ Failed to start TTS server:', error);
        ttsServerProcess = null;
        reject(error);
      });

      // Unref to allow parent to exit independently
      ttsServerProcess.unref();

      // Fast startup detection - server accepts requests immediately
      // Model loads in background as per server_api_only.py
      setTimeout(() => {
        if (ttsServerProcess) {
          console.log('✅ TTS server process started (ready for API requests)');
          resolve();
        }
      }, 500); // Reduced from 2000ms since server starts faster

      // Additional wait to ensure server is fully bound and ready
      setTimeout(() => {
        if (ttsServerProcess) {
          console.log('🔄 TTS server should be fully ready now');
        }
      }, 3000); // Increased from 1500ms to 3000ms
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
  modelLoading: boolean;
}> {
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 2000);

    const response = await fetch(`${SERVER_URL}/health`, {
      method: 'GET',
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    if (response.ok) {
      const data = await response.json();
      return {
        running: data.status === 'healthy' || data.status === 'loading',
        modelLoaded: data.model_loaded || false,
        modelLoading: data.model_loading || false,
      };
    }

    return { running: false, modelLoaded: false, modelLoading: false };
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      console.log('Server check timed out - server might be shutting down');
      return { running: false, modelLoaded: false, modelLoading: false };
    }
    return { running: false, modelLoaded: false, modelLoading: false };
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
      const shutdownResponse = await fetch(`${SERVER_URL}/health`, {
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
    } catch (_error) {
      // eslint-disable-line @typescript-eslint/no-unused-vars
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
      console.log('🚀 TTS server not running, starting it...');
      try {
        await startTTSServer();
        console.log('✅ TTS server started successfully');
      } catch (error) {
        console.error('❌ Failed to start TTS server:', error);
        return NextResponse.json(
          { error: 'Failed to start TTS server' },
          { status: 500 }
        );
      }

      // Brief wait for server initialization (optimized for fast startup)
      console.log('⏳ Waiting for TTS server to be ready...');
      await new Promise((resolve) => setTimeout(resolve, 3000)); // Increased from 1000ms to 3000ms

      // Check server status after startup
      const newStatus = await checkTTSServer();
      if (newStatus.running) {
        if (newStatus.modelLoaded) {
          console.log('✅ TTS server fully ready with model loaded');
        } else if (newStatus.modelLoading) {
          console.log('✅ TTS server ready, model loading in background');
        } else {
          console.log('✅ TTS server ready, model will load on first request');
        }
      } else {
        console.warn('⚠️ TTS server status uncertain, proceeding anyway');
      }
    } else {
      if (serverStatus.modelLoaded) {
        console.log('✅ TTS server fully ready with model loaded');
      } else if (serverStatus.modelLoading) {
        console.log('✅ TTS server ready, model loading in background');
      } else {
        console.log('✅ TTS server running, model will load on first request');
      }
    }

    // Use dynamic TTS settings or defaults
    const settings = ttsSettings || {
      temperature: 0.2,
      exaggeration: 0.8,
      cfg_weight: 0.2,
      seed: 1212,
      reference_audio_filename: 'calmS5wave.wav',
    };

    // Step 1: Generate TTS with retry mechanism
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

    let ttsResponse;
    let retryCount = 0;
    const maxRetries = 3;

    while (retryCount < maxRetries) {
      try {
        ttsResponse = await fetch(`${SERVER_URL}/tts`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(ttsPayload),
        });

        if (ttsResponse.ok) {
          break; // Success, exit retry loop
        }

        // If we get here, the response was not ok
        if (retryCount < maxRetries - 1) {
          console.log(
            `⚠️ TTS request failed (attempt ${
              retryCount + 1
            }/${maxRetries}), retrying in 2s...`
          );
          await new Promise((resolve) => setTimeout(resolve, 2000));
          retryCount++;
        } else {
          throw new Error(`TTS service error: ${ttsResponse.status}`);
        }
      } catch (error) {
        if (
          error instanceof TypeError &&
          error.message.includes('fetch failed') &&
          retryCount < maxRetries - 1
        ) {
          console.log(
            `⚠️ TTS connection failed (attempt ${
              retryCount + 1
            }/${maxRetries}), retrying in 2s...`
          );
          await new Promise((resolve) => setTimeout(resolve, 2000));
          retryCount++;
        } else {
          throw error;
        }
      }
    }

    if (!ttsResponse || !ttsResponse.ok) {
      throw new Error(`TTS service error after ${maxRetries} attempts`);
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
      const errorText = await uploadResponse
        .text()
        .catch(() => 'Unknown error');
      throw new Error(
        `MinIO upload failed (${uploadResponse.status}): ${errorText}`
      );
    }

    console.log('✅ TTS generation completed successfully');

    // Schedule server stop after successful generation
    scheduleServerStop();

    return NextResponse.json({
      audioUrl: uploadUrl,
      filename,
      bucket,
      sceneId,
    });
  } catch (error) {
    console.error('❌ Error generating TTS:', error);

    // Enhanced error categorization
    let statusCode = 500;
    let errorMessage = 'Unknown error occurred';

    if (error instanceof Error) {
      errorMessage = error.message;
      if (error.message.includes('TTS service error')) {
        statusCode = 502; // Bad Gateway
      } else if (error.message.includes('MinIO upload')) {
        statusCode = 502; // Bad Gateway
      } else if (error.message.includes('start TTS server')) {
        statusCode = 503; // Service Unavailable
      }
    }

    return NextResponse.json({ error: errorMessage }, { status: statusCode });
  } finally {
    // Ensure server timeout is scheduled regardless of success/failure
    scheduleServerStop();
  }
}
