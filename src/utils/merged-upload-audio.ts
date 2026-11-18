import { execFile } from 'child_process';
import { promisify } from 'util';
import { transitionWhoosh } from './ffmpeg-merge';

const exec = promisify(execFile);
const rate = 48000;
const inputTolerance = 0.150;
const minFinalTailTolerance = 0.050;

type Stream = { codec_type: string; duration?: string; avg_frame_rate?: string };
export async function probeMergeMedia(file: string) {
  const { stdout } = await exec('ffprobe', ['-v', 'error', '-show_entries',
    'format=duration:stream=codec_type,duration,avg_frame_rate', '-of', 'json', file],
  { timeout: 30000 });
  const data = JSON.parse(stdout) as { streams: Stream[]; format?: { duration?: string } };
  const video = data.streams?.find(stream => stream.codec_type === 'video');
  const audio = data.streams?.find(stream => stream.codec_type === 'audio');
  const formatDuration = Number(data.format?.duration);
  const [numerator, denominator] = (video?.avg_frame_rate || '0/1').split('/').map(Number);
  return {
    videoDuration: video ? Number(video.duration) || formatDuration : 0,
    audioDuration: audio ? Number(audio.duration) || formatDuration : 0,
    formatDuration,
    frameDuration: numerator > 0 && denominator > 0 ? denominator / numerator : 1 / 30,
  };
}

export async function checkMergeAttachments(
  videos: string[], attachments: Map<number, string>, names: string[],
) {
  const inputs = [];
  for (const [index, video] of videos.entries()) {
    const label = `Clip ${index + 1} (${names[index]})`;
    const info = await probeMergeMedia(video).catch(() => null);
    if (!info?.videoDuration || !Number.isFinite(info.videoDuration) || info.videoDuration <= 0) {
      throw new Error(`${label}: could not read the video duration.`);
    }
    const file = attachments.get(index);
    if (file) {
      const audio = await probeMergeMedia(file).catch(() => null);
      if (!audio?.audioDuration || !Number.isFinite(audio.audioDuration) || audio.videoDuration > 0) {
        throw new Error(`${label}: choose a readable audio file for Music & effects.`);
      }
      if (Math.abs(audio.audioDuration - info.videoDuration) > inputTolerance + 1e-6) {
        throw new Error(`${label} is ${info.videoDuration.toFixed(3)} s, but its music and effects are ${audio.audioDuration.toFixed(3)} s. Choose audio that matches this clip within 0.15 s.`);
      }
    }
    inputs.push(info);
  }
  return inputs;
}

export type EffectsTimeline = { durations: number[]; transitionDuration?: number; whoosh?: boolean };

export async function buildMergedEffects(
  mergedVideo: string, output: string, timeline: EffectsTimeline, files: Map<number, string>,
) {
  const video = await probeMergeMedia(mergedVideo);
  const bridge = timeline.transitionDuration || 0;
  const expected = timeline.durations.reduce((total, duration) => total + duration, 0)
    + (timeline.durations.length - 1) * bridge;
  // Concat timestamps and the encoded video frame grid can round the tail differently.
  // Permit a short tail correction while keeping every clip and transition at its original offset.
  const tailTolerance = Math.max(minFinalTailTolerance, video.frameDuration + 0.001);
  if (!Number.isFinite(video.videoDuration) || video.videoDuration <= 0
    || !Number.isFinite(expected)
    || Math.abs(video.videoDuration - expected) > tailTolerance) {
    throw new Error(`The merged video timing differs from the music and effects timeline (expected ${expected.toFixed(3)} s, got ${video.videoDuration.toFixed(3)} s).`);
  }
  const args = ['-nostdin', '-v', 'error', '-y'];
  const filters: string[] = [], segments: string[] = [];
  let offset = 0, input = 0;
  for (const [index, duration] of timeline.durations.entries()) {
    if (index > 0 && bridge) {
      const label = `join${index}`;
      const count = Math.round((offset + bridge) * rate) - Math.round(offset * rate);
      const source = timeline.whoosh ? transitionWhoosh(bridge, index - 1)
        : 'anullsrc=r=48000:cl=stereo';
      filters.push(`${source},aformat=sample_rates=48000:channel_layouts=stereo,apad,atrim=end_sample=${count},asetpts=N/SR/TB[${label}]`);
      segments.push(`[${label}]`);
      offset += bridge;
    }
    const file = files.get(index);
    const label = `clip${index}`;
    const count = Math.round((offset + duration) * rate) - Math.round(offset * rate);
    if (file) args.push('-i', file);
    const source = file ? `[${input++}:a:0]aresample=48000,aformat=sample_rates=48000:channel_layouts=stereo,apad`
      : 'anullsrc=r=48000:cl=stereo';
    filters.push(`${source},atrim=end_sample=${count},asetpts=N/SR/TB[${label}]`);
    segments.push(`[${label}]`);
    offset += duration;
  }
  const frames = Math.round(video.videoDuration * rate);
  filters.push(`${segments.join('')}concat=n=${segments.length}:v=0:a=1,apad,atrim=end_sample=${frames}[out]`);
  await exec('ffmpeg', [...args, '-filter_complex', filters.join(';'), '-map', '[out]',
    '-c:a', 'pcm_s16le', '-rf64', 'auto', output], { timeout: 3600000, maxBuffer: 4 << 20 });
  const audio = await probeMergeMedia(output);
  if (Math.round(audio.audioDuration * rate) !== frames) {
    throw new Error('The exported music and effects WAV does not match the final video duration.');
  }
}
