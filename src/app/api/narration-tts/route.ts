import { execFile } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { NextResponse } from 'next/server';

export const runtime = 'nodejs';

type NarrationTtsAction = 'speak' | 'pause' | 'resume' | 'stop';

function openNarrationPilot(url: URL) {
  return new Promise<void>((resolve, reject) => {
    execFile(
      '/usr/bin/open',
      ['-g', '-a', '/Users/sahand/Applications/Narration Pilot.app', url.toString()],
      (error) => {
        if (error) reject(error);
        else resolve();
      },
    );
  });
}

export async function GET() {
  try {
    const state = JSON.parse(
      await readFile('/tmp/narration-pilot-tts-state.json', 'utf8'),
    ) as { state?: string; updatedAt?: number };
    return NextResponse.json({ ...state, available: true });
  } catch {
    return NextResponse.json({ state: 'idle', available: false });
  }
}

export async function POST(request: Request) {
  if (process.platform !== 'darwin') {
    return NextResponse.json(
      { error: 'Native Narration Pilot TTS is only available on macOS.' },
      { status: 501 },
    );
  }

  let body: { action?: NarrationTtsAction; text?: string };
  try {
    body = (await request.json()) as { action?: NarrationTtsAction; text?: string };
  } catch {
    return NextResponse.json({ error: 'Invalid TTS request.' }, { status: 400 });
  }

  const action = body.action;
  if (!action || !['speak', 'pause', 'resume', 'stop'].includes(action)) {
    return NextResponse.json({ error: 'Unknown TTS action.' }, { status: 400 });
  }

  if (action === 'speak') {
    const text = body.text?.trim() || '';
    if (!text) return NextResponse.json({ error: 'Narration is empty.' }, { status: 400 });
    if (text.length > 20000) {
      return NextResponse.json({ error: 'Narration is too long to send to Narration Pilot.' }, { status: 413 });
    }
  }

  const url = new URL(`narrationpilot://${action}`);
  if (action === 'speak') {
    // URLSearchParams serializes spaces as `+`. The native Narration Pilot
    // URL handler treats `+` literally, so use percent encoding instead.
    // This also keeps a real plus sign in the narration as `%2B`.
    url.search = `?text=${encodeURIComponent(body.text?.trim() || '')}`;
  }

  try {
    await openNarrationPilot(url);
    return NextResponse.json({ ok: true, action });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? `Could not reach Narration Pilot: ${error.message}`
            : 'Could not reach Narration Pilot.',
      },
      { status: 502 },
    );
  }
}
