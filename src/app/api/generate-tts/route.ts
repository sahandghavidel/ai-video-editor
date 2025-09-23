import { NextRequest, NextResponse } from 'next/server';
import { spawn } from 'child_process';
import path from 'path';
import fs from 'fs';

// TTS Server management - optimized for fast API-only server
let ttsServerProcess: ReturnType<typeof spawn> | null = null;
let serverTimeout: NodeJS.Timeout | null = null;
let timeoutScheduledAt: number = 0; // Track when timeout was scheduled
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
        const wasRunning = ttsServerProcess !== null;
        ttsServerProcess = null;

        // Only clear timeout if server exited normally (not killed by us)
        if (serverTimeout && code !== null) {
          // code is null when killed by us
          console.log('🔄 Server exited naturally, clearing shutdown timeout');
          clearTimeout(serverTimeout);
          serverTimeout = null;
          timeoutScheduledAt = 0;
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
  const now = Date.now();

  // Clear existing timeout
  if (serverTimeout) {
    const timeRemaining = Math.max(
      0,
      timeoutScheduledAt + SERVER_TIMEOUT - now
    );
    console.log(
      `🔄 Clearing existing server shutdown timeout (${Math.round(
        timeRemaining / 1000
      )}s remaining)`
    );
    clearTimeout(serverTimeout);
    serverTimeout = null;
    timeoutScheduledAt = 0;
  } else {
    console.log('ℹ️ No existing timeout to clear');
  }

  // Schedule new timeout
  const fireTime = now + SERVER_TIMEOUT;
  console.log('⏰ Scheduling server shutdown in 5 minutes');
  timeoutScheduledAt = now;
  serverTimeout = setTimeout(async () => {
    const actualDelay = Date.now() - timeoutScheduledAt;
    const expectedDelay = SERVER_TIMEOUT;
    console.log('⏰ Server shutdown timeout fired');

    // Double-check if we should still shut down (in case a request came in and cleared this timeout)
    if (serverTimeout === null) {
      console.log('ℹ️ Timeout was cleared, skipping shutdown');
      return;
    }

    // Check if server is still running before attempting to kill
    const serverStatus = await checkTTSServer();

    if (serverStatus.running) {
      console.log('🛑 Auto-stopping TTS server after 5 minutes of inactivity');

      if (ttsServerProcess) {
        ttsServerProcess.kill('SIGTERM');

        // Force kill after 5 seconds if it doesn't respond
        setTimeout(() => {
          if (ttsServerProcess) {
            console.log('💀 Force killing TTS server');
            ttsServerProcess.kill('SIGKILL');
            ttsServerProcess = null;
          }
        }, 5000);
      } else {
        console.log(
          '⚠️ No TTS server process found to kill, but server appears to be running'
        );
        // Try to shutdown via API as fallback
        try {
          await fetch(`${SERVER_URL}/shutdown`, { method: 'POST' });
          console.log('🔄 Shutdown request sent via API');
        } catch (error) {
          console.error('❌ Failed to shutdown via API:', error);
        }
      }
    } else {
      console.log('✅ TTS server already stopped naturally');
    }

    serverTimeout = null;
    timeoutScheduledAt = 0;
  }, SERVER_TIMEOUT);

  console.log('✅ Server shutdown timeout scheduled');
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

    // If server is already running, reset the shutdown timeout
    if (serverStatus.running) {
      console.log('🔄 Server already running, resetting shutdown timeout');
      scheduleServerStop(); // This will clear existing timeout and set a new one
    }

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

      // Wait for server to be fully ready with model loaded
      console.log('⏳ Waiting for TTS server to be ready...');
      let readinessAttempts = 0;
      const maxReadinessAttempts = 15; // 15 attempts = ~30 seconds max wait
      let currentStatus = await checkTTSServer();

      while (readinessAttempts < maxReadinessAttempts) {
        if (currentStatus.running && currentStatus.modelLoaded) {
          console.log('✅ TTS server fully ready with model loaded');
          break;
        } else if (currentStatus.running && currentStatus.modelLoading) {
          console.log(
            `⏳ TTS server ready, model still loading (attempt ${
              readinessAttempts + 1
            }/${maxReadinessAttempts})`
          );
        } else if (currentStatus.running) {
          console.log(
            `⏳ TTS server running but status uncertain (attempt ${
              readinessAttempts + 1
            }/${maxReadinessAttempts})`
          );
        } else {
          console.log(
            `⏳ TTS server not ready yet (attempt ${
              readinessAttempts + 1
            }/${maxReadinessAttempts})`
          );
        }

        await new Promise((resolve) => setTimeout(resolve, 2000)); // Wait 2 seconds between checks
        currentStatus = await checkTTSServer();
        readinessAttempts++;
      }

      if (!currentStatus.running || !currentStatus.modelLoaded) {
        console.warn(
          '⚠️ TTS server not fully ready after waiting, but proceeding anyway'
        );
      }
    } else {
      // Server is already running, but check if model is loaded
      if (serverStatus.modelLoaded) {
        console.log('✅ TTS server fully ready with model loaded');
      } else {
        console.log(
          '⏳ TTS server running but model not loaded yet, waiting...'
        );
        let readinessAttempts = 0;
        const maxReadinessAttempts = 10; // 10 attempts = ~20 seconds max wait
        let currentStatus = serverStatus;

        while (
          readinessAttempts < maxReadinessAttempts &&
          !currentStatus.modelLoaded
        ) {
          if (currentStatus.modelLoading) {
            console.log(
              `⏳ Model still loading (attempt ${
                readinessAttempts + 1
              }/${maxReadinessAttempts})`
            );
          } else {
            console.log(
              `⏳ Waiting for model to load (attempt ${
                readinessAttempts + 1
              }/${maxReadinessAttempts})`
            );
          }

          await new Promise((resolve) => setTimeout(resolve, 2000)); // Wait 2 seconds between checks
          currentStatus = await checkTTSServer();
          readinessAttempts++;
        }

        if (currentStatus.modelLoaded) {
          console.log('✅ Model loaded successfully');
        } else {
          console.warn(
            '⚠️ Model not loaded after waiting, but proceeding anyway'
          );
        }
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

    // Step 1: Generate TTS (server should be fully ready now)
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

    const ttsResponse = await fetch(`${SERVER_URL}/tts`, {
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
  }
}
