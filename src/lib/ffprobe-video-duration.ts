import { spawn } from 'child_process';

type FFprobeStream = {
  duration?: string | number;
};

type FFprobeOutput = {
  format?: { duration?: string | number };
  streams?: FFprobeStream[];
};

function runSpawnCapture(
  command: string,
  args: string[],
): Promise<{ stdout: string; stderr: string; code: number }> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';

    child.stdout.on('data', (data) => (stdout += String(data)));
    child.stderr.on('data', (data) => (stderr += String(data)));
    child.on('error', reject);
    child.on('close', (code) => resolve({ stdout, stderr, code: code ?? -1 }));
  });
}

function parseNumberish(value?: string | number): number {
  if (typeof value === 'number') return value;
  if (typeof value === 'string') {
    const number = Number(value);
    return Number.isFinite(number) ? number : Number.NaN;
  }
  return Number.NaN;
}

export async function probeVideoDurationSeconds(videoUrl: string): Promise<number> {
  const { stdout, stderr, code } = await runSpawnCapture('ffprobe', [
    '-v',
    'quiet',
    '-print_format',
    'json',
    '-show_format',
    '-show_streams',
    videoUrl,
  ]);

  if (code !== 0) {
    throw new Error(`ffprobe failed (${code}): ${stderr.slice(0, 2000)}`);
  }

  const probe = (JSON.parse(stdout) ?? {}) as FFprobeOutput;
  const candidates: number[] = [];
  const formatDuration = parseNumberish(probe.format?.duration);

  if (Number.isFinite(formatDuration) && formatDuration > 0) {
    candidates.push(formatDuration);
  }

  for (const stream of probe.streams ?? []) {
    const streamDuration = parseNumberish(stream.duration);
    if (Number.isFinite(streamDuration) && streamDuration > 0) {
      candidates.push(streamDuration);
    }
  }

  const duration = candidates.length > 0 ? Math.max(...candidates) : Number.NaN;
  if (!Number.isFinite(duration) || duration <= 0) {
    throw new Error('Unable to determine video duration with ffprobe');
  }

  return duration;
}
