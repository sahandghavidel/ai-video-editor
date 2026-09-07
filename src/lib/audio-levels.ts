import { spawn } from 'child_process';

export type AudioLevels = { measuredRmsDbfs: number; truePeakDbfs: number };

export async function measureAudioLevels(filePath: string): Promise<AudioLevels> {
  const stderr = await new Promise<string>((resolve, reject) => {
    const child = spawn('ffmpeg', ['-hide_banner', '-nostats', '-i', filePath, '-af', 'astats=metadata=1:reset=0', '-f', 'null', '-'], { stdio: ['ignore', 'ignore', 'pipe'] });
    let output = '';
    child.stderr.on('data', data => { output += String(data); });
    child.on('error', reject);
    child.on('close', code => code === 0 ? resolve(output) : reject(new Error(`Audio level measurement failed (${code}).`)));
  });
  const rmsMatches = [...stderr.matchAll(/RMS level dB:\s*(-?[0-9]+(?:\.[0-9]+)?)/g)];
  const peakMatches = [...stderr.matchAll(/Peak level dB:\s*(-?[0-9]+(?:\.[0-9]+)?)/g)];
  const measuredRmsDbfs = Number(rmsMatches.at(-1)?.[1]);
  const truePeakDbfs = Number(peakMatches.at(-1)?.[1]);
  if (!Number.isFinite(measuredRmsDbfs) || !Number.isFinite(truePeakDbfs)) throw new Error('Unable to measure audio RMS and peak levels.');
  return { measuredRmsDbfs, truePeakDbfs };
}
