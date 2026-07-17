import { exec, execFile } from 'child_process';
import { promisify } from 'util';
import path from 'path';
import { access, unlink, writeFile } from 'fs/promises';
import { uploadToMinio } from './ffmpeg-direct';
import {
  prepareHyperFramesMergeOverlays,
  type HyperFramesMergeOverlays,
} from './hyperframes-merge-overlays';

const execAsync = promisify(exec);
const execFileAsync = promisify(execFile);
const DEFAULT_MERGE_FFMPEG_TIMEOUT_MS = 2 * 60 * 60 * 1000; // 2 hours
const DEFAULT_FAST_MERGE_FFMPEG_TIMEOUT_MS = 30 * 60 * 1000; // 30 minutes
const DEFAULT_MERGE_FFMPEG_MAX_BUFFER = 100 * 1024 * 1024; // 100MB stderr/stdout

function parsePositiveNumber(value: string | undefined, fallback: number) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function getMergeFfmpegTimeoutMs() {
  return parsePositiveNumber(
    process.env.MERGE_FFMPEG_TIMEOUT_MS,
    DEFAULT_MERGE_FFMPEG_TIMEOUT_MS,
  );
}

function getFastMergeFfmpegTimeoutMs() {
  return parsePositiveNumber(
    process.env.FAST_MERGE_FFMPEG_TIMEOUT_MS,
    DEFAULT_FAST_MERGE_FFMPEG_TIMEOUT_MS,
  );
}

function getMergeFfmpegMaxBuffer() {
  return parsePositiveNumber(
    process.env.MERGE_FFMPEG_MAX_BUFFER,
    DEFAULT_MERGE_FFMPEG_MAX_BUFFER,
  );
}

export interface ConcatenateOptions {
  videoUrls: string[];
  outputPath?: string;
  useHardwareAcceleration?: boolean;
  videoBitrate?: string;
}

type ProbedVideo = {
  duration: number;
  width: number;
  height: number;
  hasAudio: boolean;
};

export interface BrandedTransitionOptions {
  videoUrls: string[];
  outputPath?: string;
  duration?: number;
  includeSoundEffect?: boolean;
  titles?: string[];
}

async function probeVideoForTransition(videoUrl: string): Promise<ProbedVideo> {
  const { stdout } = await execFileAsync(
    'ffprobe',
    [
      '-v',
      'error',
      '-show_entries',
      'format=duration:stream=codec_type,width,height',
      '-of',
      'json',
      videoUrl,
    ],
    {
      timeout: getMergeFfmpegTimeoutMs(),
      maxBuffer: getMergeFfmpegMaxBuffer(),
    },
  );
  const result = JSON.parse(stdout) as {
    format?: { duration?: string };
    streams?: Array<{
      codec_type?: string;
      width?: number;
      height?: number;
    }>;
  };
  const videoStream = result.streams?.find(
    (stream) => stream.codec_type === 'video',
  );
  const duration = Number(result.format?.duration);

  if (
    !videoStream?.width ||
    !videoStream.height ||
    !Number.isFinite(duration) ||
    duration <= 0
  ) {
    throw new Error(`Unable to read video metadata for ${path.basename(videoUrl)}`);
  }

  return {
    duration,
    width: videoStream.width,
    height: videoStream.height,
    hasAudio: Boolean(
      result.streams?.some((stream) => stream.codec_type === 'audio'),
    ),
  };
}

/**
 * Re-encode and merge videos with the JavaScript King diagonal brand wipe.
 * The wipe uses JavaScript King navy, gold, and cool-white bands and optionally mixes a
 * quiet, generated whoosh at every join, so no external media asset is needed.
 */
export async function concatenateVideosWithBrandedTransitions(
  options: BrandedTransitionOptions,
): Promise<string> {
  const {
    videoUrls,
    outputPath,
    duration = 0.95,
    includeSoundEffect = true,
    titles = [],
  } = options;

  if (videoUrls.length < 2) {
    throw new Error('At least two videos are required for transitions');
  }

  const probes = await Promise.all(videoUrls.map(probeVideoForTransition));
  const shortestDuration = Math.min(...probes.map((probe) => probe.duration));
  const transitionDuration = Math.min(duration, shortestDuration / 2);
  if (transitionDuration < 0.1) {
    throw new Error('The selected videos are too short for a transition');
  }

  const targetWidth = probes[0].width - (probes[0].width % 2);
  const targetHeight = probes[0].height - (probes[0].height % 2);
  const outputFileName =
    outputPath ||
    `merged_transition_${Date.now()}_${Math.random().toString(36).slice(2, 11)}.mp4`;
  const fullOutputPath = path.resolve('/tmp', outputFileName);
  const filters: string[] = [];
  let hyperFramesOverlays: HyperFramesMergeOverlays | null = null;
  const incomingTitles = videoUrls.slice(1).map((videoUrl, index) => {
    const suppliedTitle = titles[index + 1]?.trim();
    return suppliedTitle || path.parse(path.basename(videoUrl)).name;
  });

  try {
    hyperFramesOverlays = await prepareHyperFramesMergeOverlays(incomingTitles);
  } catch (error) {
    console.warn(
      '[MERGE] HyperFrames overlays unavailable; using the FFmpeg brand fallback:',
      error,
    );
  }

  probes.forEach((probe, index) => {
    filters.push(
      `[${index}:v]scale=${targetWidth}:${targetHeight}:force_original_aspect_ratio=decrease,` +
        `pad=${targetWidth}:${targetHeight}:(ow-iw)/2:(oh-ih)/2:color=black,` +
        'fps=30,format=yuv420p,setsar=1,settb=AVTB,setpts=PTS-STARTPTS' +
        `[v${index}]`,
    );

    if (probe.hasAudio) {
      filters.push(
        `[${index}:a]aresample=48000:async=1:first_pts=0,` +
          `aformat=sample_fmts=fltp:sample_rates=48000:channel_layouts=stereo,` +
          `apad,atrim=duration=${probe.duration.toFixed(6)},asetpts=PTS-STARTPTS[a${index}]`,
      );
    } else {
      filters.push(
        `anullsrc=r=48000:cl=stereo,atrim=duration=${probe.duration.toFixed(6)},` +
          `asetpts=PTS-STARTPTS[a${index}]`,
      );
    }
  });

  // q is the pixel's diagonal position. f sweeps from off-screen left to
  // off-screen right, carrying restrained JavaScript King color bands with it.
  const q = '(X/W+0.35*Y/H)/1.35';
  // FFmpeg's xfade P value runs from 1 to 0, so invert it to make the wipe
  // travel from the outgoing clip (A) into the incoming clip (B).
  const progress = '(1-P)';
  const easedProgress = `(${progress}*${progress}*(3-2*${progress}))`;
  const f = `(${easedProgress}*1.56-0.56)`;
  const navy = 'if(eq(PLANE,0),37,if(eq(PLANE,1),146,117))';
  const electricBlue = 'if(eq(PLANE,0),117,if(eq(PLANE,1),196,68))';
  const gold = 'if(eq(PLANE,0),190,if(eq(PLANE,1),42,161))';
  const cyan = 'if(eq(PLANE,0),155,if(eq(PLANE,1),174,77))';
  const transitionExpression =
    `if(lt(${q},${f}),B,` +
    `if(lt(${q},${f}+0.34),${navy},` +
    `if(lt(${q},${f}+0.46),${electricBlue},` +
    `if(lt(${q},${f}+0.54),${gold},` +
    `if(lt(${q},${f}+0.56),${cyan},A)))))`;

  let videoLabel = 'v0';
  let audioLabel = 'a0';
  const transitionStarts: number[] = [];
  let accumulatedDuration = probes[0].duration;

  for (let index = 1; index < probes.length; index++) {
    const transitionStart = accumulatedDuration - transitionDuration;
    transitionStarts.push(transitionStart);
    filters.push(
      hyperFramesOverlays
        ? `[${videoLabel}][v${index}]xfade=transition=fade:` +
            `duration=${transitionDuration.toFixed(3)}:` +
            `offset=${transitionStart.toFixed(6)}[vx${index}]`
        : `[${videoLabel}][v${index}]xfade=transition=custom:` +
            `duration=${transitionDuration.toFixed(3)}:` +
            `offset=${transitionStart.toFixed(6)}:` +
            `expr='${transitionExpression}'[vx${index}]`,
    );
    filters.push(
      `[${audioLabel}][a${index}]acrossfade=d=${transitionDuration.toFixed(3)}:` +
        'c1=tri:c2=tri' +
        `[ax${index}]`,
    );
    videoLabel = `vx${index}`;
    audioLabel = `ax${index}`;
    accumulatedDuration += probes[index].duration - transitionDuration;
  }

  if (hyperFramesOverlays) {
    const firstOverlayInput = videoUrls.length;

    for (let index = 0; index < transitionStarts.length; index++) {
      const transitionInput = firstOverlayInput + index * 2;
      const titleInput = transitionInput + 1;
      const transitionStart = transitionStarts[index];
      filters.push(
        `[${transitionInput}:v]scale=${targetWidth}:${targetHeight},format=rgba,` +
          `setpts=PTS-STARTPTS+${transitionStart.toFixed(6)}/TB[hftransition${index}]`,
      );
      filters.push(
        `[${videoLabel}][hftransition${index}]overlay=0:0:` +
          `eof_action=pass:format=auto[hftransitioned${index}]`,
      );
      videoLabel = `hftransitioned${index}`;

      if (hyperFramesOverlays.titlePaths[index]) {
        const titleStart = transitionStart + transitionDuration + 0.1;
        const nextTransition = transitionStarts[index + 1] ?? Number.POSITIVE_INFINITY;
        const visibleDuration = Math.min(
          hyperFramesOverlays.titleDuration,
          nextTransition - titleStart - 0.15,
        );
        if (visibleDuration >= 0.7) {
          filters.push(
            `[${titleInput}:v]trim=duration=${visibleDuration.toFixed(3)},` +
              `scale=${targetWidth}:${targetHeight},format=rgba,` +
              `setpts=PTS-STARTPTS+${titleStart.toFixed(6)}/TB[hftitle${index}]`,
          );
          filters.push(
            `[${videoLabel}][hftitle${index}]overlay=0:0:` +
              `eof_action=pass:format=auto[hftitled${index}]`,
          );
          videoLabel = `hftitled${index}`;
        }
      }
    }
  } else if (titles.length > 1) {
    const titleFiles = await Promise.all(
      titles.slice(1).map(async (title, index) => {
        const titlePath = path.join(
          path.dirname(videoUrls[0]),
          `transition-title-${index + 1}.txt`,
        );
        await writeFile(titlePath, title.toUpperCase(), 'utf8');
        return titlePath.replace(/:/g, '\\:').replace(/'/g, "\\'");
      }),
    );
    for (let index = 0; index < titleFiles.length; index++) {
      // Let the incoming video settle before the thumbnail-inspired lower-third enters.
      const start = transitionStarts[index] + transitionDuration + 0.1;
      const nextTransition = transitionStarts[index + 1] ?? Number.POSITIVE_INFINITY;
      const end = Math.min(start + 3.2, nextTransition - 0.15);
      if (end - start < 0.7) continue;
      const fontSize = Math.max(32, Math.round(targetHeight * 0.054));
      const border = Math.max(14, Math.round(targetHeight * 0.018));
      const accentFontSize = Math.max(30, Math.round(targetHeight * 0.05));
      const accentBorder = Math.max(14, Math.round(targetHeight * 0.016));
      const textOutline = Math.max(2, Math.round(targetHeight * 0.0018));
      const accentFinalX = Math.round(targetWidth * 0.05);
      const titleFinalX = Math.round(targetWidth * 0.066);
      const y = Math.round(targetHeight * 0.7);
      const exitStart = end - 0.3;
      const makeXExpression = (finalX: number, entranceStart: number) =>
        `if(lt(t,${(entranceStart + 0.3).toFixed(3)}),-tw+(t-${entranceStart.toFixed(3)})/0.3*(${finalX}+tw),` +
        `if(lt(t,${exitStart.toFixed(3)}),${finalX},` +
        `${finalX}+(t-${exitStart.toFixed(3)})/0.3*(-tw-${finalX})))`;
      const accentXExpression = makeXExpression(accentFinalX, start);
      const titleXExpression = makeXExpression(titleFinalX, start + 0.06);
      filters.push(
        `[${videoLabel}]drawtext=font='Impact':text='I':` +
          `fontsize=${accentFontSize}:fontcolor=0xFFD21C:` +
          `borderw=${Math.max(2, Math.round(accentBorder * 0.18))}:bordercolor=0xFFD21C:` +
          `shadowcolor=0x50B9FF@0.35:shadowx=0:shadowy=3:` +
          `x='${accentXExpression}':y=${y}:` +
          `enable='between(t,${start.toFixed(3)},${end.toFixed(3)})'[accent${index}]`,
      );
      filters.push(
        `[accent${index}]drawtext=font='Impact':textfile='${titleFiles[index]}':` +
          `fontsize=${fontSize}:fontcolor=0xF4F8FF:` +
          `box=1:boxcolor=0x071B3D@0.94:boxborderw=${border}:` +
          `borderw=${textOutline}:bordercolor=0x168BFF@0.78:` +
          `shadowcolor=0x50B9FF@0.28:shadowx=0:shadowy=3:` +
          `x='${titleXExpression}':y=${y}:` +
          `enable='between(t,${(start + 0.06).toFixed(3)},${end.toFixed(3)})'[titled${index}]`,
      );
      videoLabel = `titled${index}`;
    }
  }

  if (includeSoundEffect) {
    const whooshLabels = transitionStarts.map((start, index) => {
      const delayMs = Math.max(0, Math.round(start * 1000));
      const label = `whoosh${index}`;
      filters.push(
        `anoisesrc=d=${transitionDuration.toFixed(3)}:c=pink:r=48000:a=0.085,` +
          'highpass=f=280,lowpass=f=4300,' +
          `afade=t=in:st=0:d=${(transitionDuration * 0.42).toFixed(3)},` +
          `afade=t=out:st=${(transitionDuration * 0.42).toFixed(3)}:` +
          `d=${(transitionDuration * 0.58).toFixed(3)},` +
          `adelay=${delayMs}|${delayMs}[${label}]`,
      );
      return `[${label}]`;
    });
    filters.push(
      `[${audioLabel}]${whooshLabels.join('')}amix=inputs=${whooshLabels.length + 1}:` +
        'duration=first:dropout_transition=0:normalize=0,alimiter=limit=0.95[aout]',
    );
    audioLabel = 'aout';
  }

  const ffmpegArgs = ['-y'];
  videoUrls.forEach((url) => ffmpegArgs.push('-i', url));
  if (hyperFramesOverlays) {
    transitionStarts.forEach((_, index) => {
      // FFmpeg's native VP9 decoder drops WebM alpha; libvpx-vp9 preserves it.
      ffmpegArgs.push('-c:v', 'libvpx-vp9', '-i', hyperFramesOverlays.transitionPath);
      ffmpegArgs.push(
        '-c:v',
        'libvpx-vp9',
        '-i',
        hyperFramesOverlays.titlePaths[index],
      );
    });
  }
  ffmpegArgs.push(
    '-filter_complex',
    filters.join(';'),
    '-map',
    `[${videoLabel}]`,
    '-map',
    `[${audioLabel}]`,
    '-c:v',
    'libx264',
    '-preset',
    'medium',
    '-crf',
    '20',
    '-pix_fmt',
    'yuv420p',
    '-c:a',
    'aac',
    '-b:a',
    '128k',
    '-ar',
    '48000',
    '-ac',
    '2',
    '-movflags',
    '+faststart',
    '-avoid_negative_ts',
    'make_zero',
    fullOutputPath,
  );

  try {
    await execFileAsync('ffmpeg', ffmpegArgs, {
      timeout: getMergeFfmpegTimeoutMs(),
      maxBuffer: getMergeFfmpegMaxBuffer(),
    });
    await access(fullOutputPath);
    return fullOutputPath;
  } catch (error) {
    try {
      await unlink(fullOutputPath);
    } catch {
      // Ignore cleanup errors.
    }
    throw new Error(
      `FFmpeg branded transition merge failed: ${
        error instanceof Error ? error.message : 'Unknown error'
      }`,
    );
  }
}

/**
 * Fast video concatenation using FFmpeg with direct HTTP URLs
 * This approach directly uses HTTP URLs like the NCA toolkit
 */
export async function concatenateVideosWithFFmpeg(
  options: ConcatenateOptions
): Promise<string> {
  const {
    videoUrls,
    outputPath,
    useHardwareAcceleration = true,
    videoBitrate = '6000k',
  } = options;

  if (!videoUrls || videoUrls.length === 0) {
    throw new Error('At least one video URL is required for concatenation');
  }

  if (videoUrls.length === 1) {
    // If only one video, just return the URL (no concatenation needed)
    return videoUrls[0];
  }

  // Create a unique output filename
  const outputFileName =
    outputPath ||
    `merged_${Date.now()}_${Math.random().toString(36).substr(2, 9)}.mp4`;
  const fullOutputPath = path.resolve('/tmp', outputFileName);

  // Try hardware acceleration first, then fallback to software
  const attempts = useHardwareAcceleration
    ? ['hardware', 'software']
    : ['software'];

  for (let i = 0; i < attempts.length; i++) {
    const attempt = attempts[i];
    const isHardware = attempt === 'hardware';

    try {
      console.log(
        `[MERGE] Starting merge of ${videoUrls.length} videos using ${attempt} encoding`
      );

      // Build FFmpeg command with multiple inputs (direct HTTP URLs)
      const ffmpegCommand = [
        'ffmpeg',
        '-y',
        '-threads',
        '0',
        '-filter_threads',
        '0',
      ];

      // Add all video URLs as inputs
      videoUrls.forEach((url) => {
        ffmpegCommand.push('-i', `"${url}"`);
      });

      // Build filter complex for concatenation
      // For n videos: [0:v][0:a][1:v][1:a]...[n-1:v][n-1:a]concat=n=n:v=1:a=1[outv][outa]
      const videoInputs = videoUrls
        .map((_, index) => `[${index}:v][${index}:a]`)
        .join('');
      const filterComplex = `"${videoInputs}concat=n=${videoUrls.length}:v=1:a=1[outv][outa]"`;

      ffmpegCommand.push('-filter_complex', filterComplex);
      ffmpegCommand.push('-map', '[outv]', '-map', '[outa]');
      if (isHardware) {
        ffmpegCommand.push(
          '-c:v',
          'h264_videotoolbox',
          '-b:v',
          videoBitrate,
          '-allow_sw',
          '1',
          '-realtime',
          '0'
        );
      } else {
        ffmpegCommand.push(
          '-c:v',
          'libx264',
          '-threads',
          '0',
          '-preset',
          'medium',
          '-crf',
          '20',
          '-pix_fmt',
          'yuv420p'
        );
      }

      // Audio encoding (same as other functions for consistency)
      ffmpegCommand.push(
        '-c:a',
        'aac',
        '-b:a',
        '128k',
        '-ar',
        '48000',
        '-ac',
        '2',
        '-avoid_negative_ts',
        'make_zero',
        `"${fullOutputPath}"`
      );

      const commandString = ffmpegCommand.join(' ');
      const execStartTime = Date.now();
      const timeoutMs = getMergeFfmpegTimeoutMs();

      const { stdout, stderr } = await execAsync(commandString, {
        timeout: timeoutMs,
        maxBuffer: getMergeFfmpegMaxBuffer(),
      });

      const execEndTime = Date.now();
      console.log(
        `FFmpeg merge completed in ${
          execEndTime - execStartTime
        }ms (${attempt} encoding, ${videoUrls.length} videos)`
      );

      // Check if output file exists
      await access(fullOutputPath);

      return fullOutputPath;
    } catch (error) {
      console.error(`FFmpeg ${attempt} merge encoding failed:`, error);

      // Clean up output file if it exists
      try {
        await unlink(fullOutputPath);
      } catch (cleanupError) {
        // Ignore cleanup errors
      }

      // If this was the last attempt, throw the error
      if (i === attempts.length - 1) {
        throw new Error(
          `FFmpeg merge processing failed after ${attempts.length} attempts: ${
            error instanceof Error ? error.message : 'Unknown error'
          }`
        );
      }
    }
  }

  throw new Error('FFmpeg merge processing failed: No successful attempts');
}

/**
 * Complete workflow: FFmpeg concatenate + MinIO upload + local cleanup
 */
export async function concatenateVideosWithUpload(
  options: ConcatenateOptions & {
    sceneIds?: string[];
    videoId?: number | string;
    cleanup?: boolean;
  }
): Promise<{ localPath: string; uploadUrl: string }> {
  const { sceneIds, videoId, cleanup = true, ...concatOptions } = options;

  let localPath: string | null = null;

  try {
    // Step 1: Concatenate the videos using FFmpeg
    localPath = await concatenateVideosWithFFmpeg(concatOptions);

    // Step 2: Generate filename for upload
    const timestamp = Date.now();
    let filename: string;

    if (videoId) {
      // Special case for final merged videos
      if (videoId === 'final_merged') {
        filename = `final_merged_video_${timestamp}.mp4`;
      } else {
        filename = `video_${videoId}_merged_${timestamp}.mp4`;
      }
    } else if (sceneIds && sceneIds.length > 0) {
      filename = `merged_scenes_${sceneIds.join('_')}_${timestamp}.mp4`;
    } else {
      filename = `merged_video_${timestamp}.mp4`;
    }

    // Step 3: Upload to MinIO
    const uploadUrl = await uploadToMinio(localPath, filename, 'video/mp4');

    // Step 4: Cleanup local file if requested
    if (cleanup && localPath) {
      try {
        await unlink(localPath);
      } catch (cleanupError) {
        console.warn(`Failed to cleanup local file: ${cleanupError}`);
      }
    }

    return {
      localPath: cleanup ? '' : localPath,
      uploadUrl,
    };
  } catch (error) {
    // Cleanup on error
    if (localPath) {
      try {
        await unlink(localPath);
      } catch (cleanupError) {
        // Ignore cleanup errors
      }
    }

    throw error;
  }
}

/**
 * Fast concatenation using HTTP URLs directly with concat demuxer (like NCA toolkit)
 * Uses protocol_whitelist to allow HTTP URLs with concat demuxer
 */
export async function concatenateVideosFast(
  videoUrls: string[],
  outputPath?: string
): Promise<string> {
  if (!videoUrls || videoUrls.length === 0) {
    throw new Error('At least one video URL is required for concatenation');
  }

  if (videoUrls.length === 1) {
    return videoUrls[0];
  }

  const outputFileName =
    outputPath ||
    `merged_fast_${Date.now()}_${Math.random().toString(36).substr(2, 9)}.mp4`;
  const fullOutputPath = path.resolve('/tmp', outputFileName);
  const concatListPath = path.resolve('/tmp', `concat_fast_${Date.now()}.txt`);

  try {
    console.log(
      `[MERGE] Creating concat list for ${videoUrls.length} HTTP URLs...`
    );

    // Create concat list file content with HTTP URLs directly
    const concatListContent = videoUrls
      .map((url) => `file '${url}'`)
      .join('\n');

    await writeFile(concatListPath, concatListContent, 'utf8');

    // Use concat demuxer with protocol whitelist to allow HTTP URLs (like NCA toolkit)
    const ffmpegCommand = [
      'ffmpeg',
      '-y',
      '-protocol_whitelist',
      'file,http,https,tcp,tls,crypto', // Allow HTTP protocols
      '-f',
      'concat',
      '-safe',
      '0',
      '-i',
      `"${concatListPath}"`,
      '-c',
      'copy', // Copy streams without re-encoding - FASTEST!
      `"${fullOutputPath}"`,
    ];

    const commandString = ffmpegCommand.join(' ');
    const execStartTime = Date.now();

    console.log(
      `[MERGE] Running FFmpeg concat with HTTP URLs (NCA toolkit style)...`
    );

    const { stdout, stderr } = await execAsync(commandString, {
      timeout: getFastMergeFfmpegTimeoutMs(),
      maxBuffer: getMergeFfmpegMaxBuffer(),
    });

    const execEndTime = Date.now();
    console.log(
      `[MERGE] FFmpeg fast merge completed in ${
        execEndTime - execStartTime
      }ms (HTTP URLs + copy mode, ${videoUrls.length} videos)`
    );

    // Check if output file exists
    await access(fullOutputPath);

    return fullOutputPath;
  } catch (error) {
    console.error('FFmpeg fast merge with HTTP URLs failed:', error);

    // Clean up output file if it exists
    try {
      await unlink(fullOutputPath);
    } catch (cleanupError) {
      // Ignore cleanup errors
    }

    throw new Error(
      `FFmpeg fast merge failed: ${
        error instanceof Error ? error.message : 'Unknown error'
      }`
    );
  } finally {
    // Clean up concat list file
    try {
      await unlink(concatListPath);
    } catch (cleanupError) {
      // Ignore cleanup errors
    }
  }
}
