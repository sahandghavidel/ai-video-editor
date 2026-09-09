import { spawn } from 'child_process';

type FFprobeStream = {
  codec_type?: string;
  duration?: string | number;
  duration_ts?: string | number;
  sample_rate?: string | number;
  time_base?: string;
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

export async function probeVideoTimelineMetrics(
  videoUrl: string,
  timelineSampleRate = 44100,
): Promise<{ durationSeconds: number; audioTimelineSamples: number }> {
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

  const audioStream = (probe.streams ?? []).find(
    (stream) => stream.codec_type === 'audio',
  );
  if (!audioStream) {
    return { durationSeconds: duration, audioTimelineSamples: 0 };
  }

  const durationTs = parseNumberish(audioStream.duration_ts);
  const timeBaseParts = String(audioStream.time_base ?? '').split('/');
  const timeBaseNumerator = Number(timeBaseParts[0]);
  const timeBaseDenominator = Number(timeBaseParts[1]);
  const streamDuration = parseNumberish(audioStream.duration);
  const sampleRate = parseNumberish(audioStream.sample_rate);

  let audioTimelineSamples = Number.NaN;
  if (
    Number.isInteger(durationTs) &&
    durationTs > 0 &&
    Number.isFinite(timeBaseNumerator) &&
    timeBaseNumerator > 0 &&
    Number.isFinite(timeBaseDenominator) &&
    timeBaseDenominator > 0
  ) {
    audioTimelineSamples = Math.round(
      (durationTs * timeBaseNumerator * timelineSampleRate) /
        timeBaseDenominator,
    );
  } else if (Number.isFinite(streamDuration) && streamDuration > 0) {
    audioTimelineSamples = Math.round(streamDuration * timelineSampleRate);
  } else if (Number.isFinite(sampleRate) && sampleRate > 0) {
    audioTimelineSamples = Math.round(duration * timelineSampleRate);
  }

  if (!Number.isInteger(audioTimelineSamples) || audioTimelineSamples <= 0) {
    audioTimelineSamples = 0;
  }

  return { durationSeconds: duration, audioTimelineSamples };
}

export async function probeVideoDurationSeconds(videoUrl: string): Promise<number> {
  const metrics = await probeVideoTimelineMetrics(videoUrl);
  return metrics.durationSeconds;
}
