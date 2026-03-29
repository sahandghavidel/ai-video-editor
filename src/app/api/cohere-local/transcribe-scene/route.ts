import { NextRequest, NextResponse } from 'next/server';
import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';

function resolvePythonCommand(options: {
  envVarName: string;
  absoluteCandidates: string[];
  fallbackCommand: string;
}): { command: string; source: string } {
  const configured = process.env[options.envVarName];
  if (configured && configured.trim().length > 0) {
    const trimmed = configured.trim();
    if (trimmed.includes('/') && !fs.existsSync(trimmed)) {
      return {
        command: options.fallbackCommand,
        source: `${options.envVarName} was set but points to a missing path (${trimmed}); falling back to ${options.fallbackCommand}`,
      };
    }
    return { command: trimmed, source: `env:${options.envVarName}` };
  }

  for (const candidate of options.absoluteCandidates) {
    if (fs.existsSync(candidate)) {
      return { command: candidate, source: `auto:${candidate}` };
    }
  }

  return {
    command: options.fallbackCommand,
    source: `fallback:${options.fallbackCommand}`,
  };
}

interface CohereLocalTranscriptionResult {
  response?: {
    text: string;
    segments: Array<{
      start: number;
      end: number;
      text: string;
      words?: Array<{
        word: string;
        start: number;
        end: number;
      }>;
    }>;
    duration: number;
  };
  error?: string;
}

function runWhisperSmallFallback(
  mediaUrl: string,
): Promise<CohereLocalTranscriptionResult> {
  return new Promise((resolve, reject) => {
    const scriptPath = path.join(process.cwd(), 'whisper-small-transcribe.py');
    if (!fs.existsSync(scriptPath)) {
      reject(
        new Error('Fallback script whisper-small-transcribe.py not found'),
      );
      return;
    }

    const { command: pythonCommand } = resolvePythonCommand({
      envVarName: 'WHISPER_PYTHON',
      absoluteCandidates: [
        path.join(process.cwd(), 'whisper-env', 'bin', 'python'),
        path.join(process.cwd(), 'whisper-env', 'bin', 'python3'),
        path.join(process.cwd(), 'whisper-env', 'bin', 'python3.13'),
        path.join(process.cwd(), 'parakeet-env', 'bin', 'python'),
        path.join(process.cwd(), 'parakeet-env', 'bin', 'python3'),
        path.join(process.cwd(), '.venv', 'bin', 'python'),
        path.join(process.cwd(), '.venv', 'bin', 'python3'),
      ],
      fallbackCommand: 'python3',
    });

    const p = spawn(pythonCommand, [scriptPath, mediaUrl], {
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';

    p.stdout.on('data', (d) => {
      stdout += d.toString();
    });

    p.stderr.on('data', (d) => {
      stderr += d.toString();
    });

    p.on('close', (code) => {
      if (code !== 0) {
        reject(
          new Error(
            `Fallback whisper-small failed with code ${code}: ${stderr || stdout}`,
          ),
        );
        return;
      }

      try {
        const parsed = JSON.parse(stdout) as CohereLocalTranscriptionResult;
        resolve(parsed);
      } catch (e) {
        reject(new Error(`Fallback whisper-small parse failed: ${String(e)}`));
      }
    });

    p.on('error', (e) => {
      reject(new Error(`Fallback whisper-small start failed: ${e.message}`));
    });
  });
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const {
      media_url,
      scene_id,
      language = process.env.COHERE_TRANSCRIBE_LANGUAGE || 'en',
      punctuation = process.env.COHERE_TRANSCRIBE_PUNCTUATION === undefined
        ? true
        : process.env.COHERE_TRANSCRIBE_PUNCTUATION !== '0',
      max_new_tokens = Number(
        process.env.COHERE_TRANSCRIBE_MAX_NEW_TOKENS || 512,
      ),
    } = body;

    if (!media_url) {
      return NextResponse.json(
        { error: 'media_url is required' },
        { status: 400 },
      );
    }

    if (!scene_id) {
      return NextResponse.json(
        { error: 'scene_id is required' },
        { status: 400 },
      );
    }

    const scriptPath = path.join(
      process.cwd(),
      'cohere-local',
      'cohere-local-transcribe.py',
    );

    if (!fs.existsSync(scriptPath)) {
      return NextResponse.json(
        {
          error: 'Cohere local script not found',
          details: `Expected: ${scriptPath}`,
        },
        { status: 500 },
      );
    }

    const { command: pythonCommand, source: pythonSource } =
      resolvePythonCommand({
        envVarName: 'COHERE_TRANSCRIBE_PYTHON',
        absoluteCandidates: [
          path.join(process.cwd(), '.venv', 'bin', 'python'),
          path.join(process.cwd(), '.venv', 'bin', 'python3'),
          path.join(process.cwd(), 'parakeet-env', 'bin', 'python'),
          path.join(process.cwd(), 'parakeet-env', 'bin', 'python3'),
          path.join(process.cwd(), 'whisper-env', 'bin', 'python'),
          path.join(process.cwd(), 'whisper-env', 'bin', 'python3'),
        ],
        fallbackCommand: 'python3',
      });

    console.log(
      `[COHERE_LOCAL][scene:${scene_id}] Starting transcription with ${pythonCommand} (${pythonSource})`,
    );

    const transcriptionPromise: Promise<CohereLocalTranscriptionResult> =
      new Promise((resolve, reject) => {
        const pythonProcess = spawn(
          pythonCommand,
          [
            scriptPath,
            String(media_url),
            String(language),
            punctuation ? '1' : '0',
            String(max_new_tokens),
          ],
          {
            stdio: ['pipe', 'pipe', 'pipe'],
          },
        );

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
              const parsed = JSON.parse(
                stdout,
              ) as CohereLocalTranscriptionResult;
              resolve(parsed);
            } catch (parseError) {
              reject(
                new Error(
                  `Failed to parse Cohere local scene transcription JSON: ${String(parseError)}`,
                ),
              );
            }
          } else {
            console.warn(
              `[COHERE_LOCAL][scene:${scene_id}] Cohere failed, trying whisper-small fallback...`,
            );
            runWhisperSmallFallback(String(media_url))
              .then((fallbackResult) => {
                resolve({
                  ...fallbackResult,
                  fallback_used: 'whisper-small',
                } as CohereLocalTranscriptionResult & {
                  fallback_used: string;
                });
              })
              .catch((fallbackError) => {
                reject(
                  new Error(
                    `Cohere local scene transcription failed with code ${code}: ${stderr || stdout}. Fallback also failed: ${fallbackError instanceof Error ? fallbackError.message : String(fallbackError)}`,
                  ),
                );
              });
          }
        });

        pythonProcess.on('error', (error) => {
          reject(
            new Error(
              `Failed to start Cohere local scene transcription process: ${error.message}`,
            ),
          );
        });
      });

    const transcriptionResult = await transcriptionPromise;

    if (transcriptionResult.error) {
      return NextResponse.json(transcriptionResult, { status: 500 });
    }

    return NextResponse.json(transcriptionResult);
  } catch (error) {
    console.error('[COHERE_LOCAL] transcribe-scene error:', error);
    return NextResponse.json(
      {
        error: 'Failed to transcribe scene with Cohere local model',
        details: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 },
    );
  }
}
