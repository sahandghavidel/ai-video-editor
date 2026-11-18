import { NextRequest, NextResponse } from 'next/server';
import { createWriteStream } from 'fs';
import { randomUUID } from 'crypto';
import { mkdtemp, rm, unlink } from 'fs/promises';
import Busboy from 'busboy';
import os from 'os';
import path from 'path';
import { Readable } from 'stream';
import {
  createOriginalVideoRow,
  getOriginalVideosData,
  getOriginalVideoRow,
  updateOriginalVideoRow,
  BaserowRow,
} from '@/lib/baserow-actions';
import {
  concatenateVideosFast,
  concatenateVideosWithBrandedTransitions,
  concatenateVideosWithFFmpeg,
} from '@/utils/ffmpeg-merge';
import { uploadToMinio } from '@/utils/ffmpeg-direct';
import {
  buildMergedEffects,
  checkMergeAttachments,
  type EffectsTimeline,
} from '@/utils/merged-upload-audio';

export const runtime = 'nodejs';
export const maxDuration = 3600;

const MAX_FILE_SIZE = 10 * 1024 * 1024 * 1024; // 10 GB per source video
const activeUploads = new Set<string>();
const uploadIdPattern = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;
const MAX_TOTAL_SIZE = 50 * 1024 * 1024 * 1024; // 50 GB per merge request

type ParsedUpload = {
  tempPaths: string[];
  attachments: Map<number, string>;
  uploadId: string;
  files: Array<{ name: string; contentType: string; size: number }>;
  titleBase: string | null;
  renderNormally: boolean;
  addTransitions: boolean;
  includeTransitionSound: boolean;
  showTransitionTitles: boolean;
  transitionTitles: string[];
};

function jsonFailure(error: string) {
  return NextResponse.json({
    success: false,
    error,
  });
}

function sanitizeName(value: string): string {
  return value
    .trim()
    .replace(/\.[^/.]+$/, '')
    .replace(/[^a-zA-Z0-9._ -]/g, '')
    .replace(/\s+/g, ' ')
    .slice(0, 120);
}

function sanitizeTransitionTitle(value: unknown, fallback: string): string {
  if (typeof value !== 'string') return fallback;
  return (
    value
      .replace(/[\u0000-\u001f\u007f]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 80) || fallback
  );
}

function sanitizePathSegment(value: string): string {
  return (
    value
      .trim()
      .replace(/\.[^/.]+$/, '')
      .replace(/[^a-zA-Z0-9._-]/g, '_')
      .replace(/_+/g, '_')
      .slice(0, 120) || 'video'
  );
}

function getExtension(filename: string): string {
  const extension = path.extname(filename).replace(/^\./, '').toLowerCase();
  return extension || 'mp4';
}

function generateUniqueTitle(baseName: string, videos: BaserowRow[]): string {
  const fallbackBaseName = baseName.trim() || 'Merged Video';
  const existingTitles = videos
    .map((video) => {
      const title = video.field_6852;
      return typeof title === 'string' ? title.toLowerCase() : '';
    })
    .filter((title) => title.length > 0);

  let candidate = fallbackBaseName;
  let counter = 1;
  while (existingTitles.includes(candidate.toLowerCase())) {
    candidate = `${fallbackBaseName} (${counter})`;
    counter++;
  }

  return candidate;
}

function mergedObjectNames(rowId: number, uploadId: string) {
  return {
    video: `video_${rowId}_raw_merged_${uploadId}.mp4`,
    effects: `video_${rowId}_music_and_effects_${uploadId}.wav`,
  };
}

function matchesObject(url: unknown, filename: string) {
  return typeof url === 'string' && url.endsWith('/' + filename);
}

export async function POST(request: NextRequest) {
  let tempDir: string | null = null;
  let mergedLocalPath: string | null = null;
  let lockedUpload: string | null = null;

  try {
    const contentType = request.headers.get('content-type') || '';
    if (!contentType.toLowerCase().includes('multipart/form-data')) {
      return jsonFailure('Expected multipart/form-data request body');
    }

    const contentLength = Number(request.headers.get('content-length') || 0);
    if (Number.isFinite(contentLength) && contentLength > MAX_TOTAL_SIZE) {
      return jsonFailure('Total selected video and audio size must be less than 50 GB');
    }

    if (!request.body) {
      return jsonFailure('Request body is required');
    }

    tempDir = await mkdtemp(path.join(os.tmpdir(), 'merged-upload-'));
    const parsedUpload = await parseMultipartUpload(
      request,
      tempDir,
      contentType,
    );
    const { files, tempPaths, attachments, uploadId, titleBase: parsedTitleBase } = parsedUpload;
    const {
      renderNormally,
      addTransitions,
      includeTransitionSound,
      showTransitionTitles,
      transitionTitles,
    } =
      parsedUpload;

    if (files.length === 0) {
      return jsonFailure('Select at least one video file');
    }

    const invalidFile = files.find((file) => !file.contentType.startsWith('video/'));
    if (invalidFile) {
      return jsonFailure(`${invalidFile.name} is not a video file`);
    }

    if ([...attachments.keys()].some(index => index >= files.length)) {
      return jsonFailure('A music and effects file points to a video outside the merge list.');
    }
    if (activeUploads.has(uploadId)) return jsonFailure('This merge upload is already running.');
    activeUploads.add(uploadId);
    lockedUpload = uploadId;

    const inputs = await checkMergeAttachments(tempPaths, attachments, files.map(file => file.name));
    const existingVideos = await getOriginalVideosData();
    const committed = existingVideos.find(row => {
      const names = mergedObjectNames(row.id, uploadId);
      return (matchesObject(row.field_6881, names.video) && matchesObject(row.field_7433, names.effects))
        || (matchesObject(row.field_6881, `merged_upload_${uploadId}.mp4`)
          && matchesObject(row.field_7433, `merged_upload_${uploadId}_music_and_effects.wav`));
    });
    if (committed) {
      return NextResponse.json({ success: true, rowId: committed.id, videoUrl: committed.field_6881,
        musicEffectsUrl: committed.field_7433, title: committed.field_6852, mergedFiles: files.length });
    }

    const effectsPath = path.join(tempDir, 'music-and-effects.wav');
    async function renderPlainVideo(useHardwareAcceleration: boolean) {
      let joins: number[] = [];
      const video = await concatenateVideosWithFFmpeg({
        videoUrls: tempPaths, useHardwareAcceleration, videoBitrate: '6000k',
        onSegmentEnds: ends => { joins = ends.slice(0, -1); },
        silentInputDurations: new Map(inputs.flatMap((clip, index) =>
          clip.audioDuration > 0 ? [] : [[index, clip.videoDuration]])),
      });
      const durations = joins.map((end, index) => end - (joins[index - 1] ?? 0));
      durations.push(inputs[inputs.length - 1].videoDuration);
      return { video, durations };
    }
    let timeline: EffectsTimeline | undefined;
    if (files.length === 1) {
      const [source] = tempPaths;
      mergedLocalPath = !renderNormally && getExtension(files[0].name) === 'mp4'
        ? source
        : await concatenateVideosWithFFmpeg({
            videoUrls: tempPaths,
            outputPath: path.join(tempDir, 'rendered.mp4'),
            forceSingleEncode: true,
            useHardwareAcceleration: false,
            silentInputDurations: inputs[0].audioDuration ? undefined : new Map([[0, inputs[0].videoDuration]]),
          });
      await buildMergedEffects(mergedLocalPath, effectsPath, { durations: [inputs[0].videoDuration] }, attachments);
    } else if (renderNormally && addTransitions) {
      mergedLocalPath = await concatenateVideosWithBrandedTransitions({
        videoUrls: tempPaths,
        duration: 0.95,
        includeSoundEffect: includeTransitionSound,
        showTitles: showTransitionTitles,
        titles: showTransitionTitles
          ? files.map((file, index) => sanitizeTransitionTitle(
              transitionTitles[index], file.name.replace(/\.[^/.]+$/, ''),
            ))
          : [],
        onTimeline: (durations, transitionDuration) => {
          timeline = { durations, transitionDuration, whoosh: includeTransitionSound };
        },
      });
      if (!timeline) throw new Error('Could not verify the transition boundaries.');
      await buildMergedEffects(mergedLocalPath, effectsPath, timeline, attachments);
    } else if (renderNormally) {
      const normal = await renderPlainVideo(false);
      mergedLocalPath = normal.video;
      await buildMergedEffects(mergedLocalPath, effectsPath, { durations: normal.durations }, attachments);
    } else {
      try {
        const inputDurations = inputs.map(clip => clip.formatDuration);
        if (inputDurations.some(duration => !Number.isFinite(duration) || duration <= 0)) {
          throw new Error('Could not verify clip boundaries for a fast merge.');
        }
        mergedLocalPath = await concatenateVideosFast(tempPaths, path.join(tempDir, 'fast-merged.mp4'), inputDurations);
        const fastTimeline = { durations: inputs.map((clip, index) => index < inputs.length - 1
          ? clip.formatDuration : clip.videoDuration) };
        await buildMergedEffects(mergedLocalPath, effectsPath, fastTimeline, attachments);
      } catch (fastError) {
        console.log('[MERGED_UPLOAD] Fast merge or timing check failed, falling back to re-encode:', fastError);
        const normal = await renderPlainVideo(true);
        mergedLocalPath = normal.video;
        await buildMergedEffects(mergedLocalPath, effectsPath, { durations: normal.durations }, attachments);
      }
    }

    async function upload(file: string, name: string, type: string, label: string) {
      try { return await uploadToMinio(file, name, type); }
      catch (error) {
        throw new Error(`${label} upload failed: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
    // The row ID is assigned by Baserow. Keep the upload ID in the pending title
    // so a retry can recover the reservation even if the create response was lost.
    const pendingSuffix = ` [merge upload ${uploadId}]`;
    const currentVideos = await getOriginalVideosData();
    const pending = currentVideos.find(row =>
      typeof row.field_6852 === 'string' && row.field_6852.endsWith(pendingSuffix),
    );
    if (pending?.field_6881 || pending?.field_7433) {
      throw new Error('The reserved video row already has media URLs. Review that row before retrying.');
    }
    const titleBase = sanitizeName(parsedTitleBase || files[0].name);
    const uniqueTitle = pending && typeof pending.field_6852 === 'string'
      ? pending.field_6852.slice(0, -pendingSuffix.length)
      : generateUniqueTitle(titleBase, currentVideos);
    const row = pending ?? await createOriginalVideoRow({
      field_6864: 'Pending',
      field_6902: currentVideos.reduce((max, video) => Math.max(max, Number(video.field_6902) || 0), 0) + 1,
      field_6852: uniqueTitle + pendingSuffix,
    });
    if (!Number.isSafeInteger(row.id) || row.id <= 0) {
      throw new Error('Baserow did not return a video row ID for this merge.');
    }

    const names = mergedObjectNames(row.id, uploadId);
    const videoUrl = await upload(mergedLocalPath, names.video, 'video/mp4', 'Merged video');
    const musicEffectsUrl = await upload(effectsPath, names.effects, 'audio/wav', 'Music and effects');
    await updateOriginalVideoRow(row.id, {
      field_6864: 'Processing', field_6852: uniqueTitle,
      field_6881: videoUrl, field_7433: musicEffectsUrl,
    });
    const saved = await getOriginalVideoRow(row.id);
    if (saved.field_6881 !== videoUrl || saved.field_7433 !== musicEffectsUrl) {
      throw new Error('Baserow did not return both saved URLs. Retry to check this upload again.');
    }

    return NextResponse.json({
      success: true, rowId: row.id, videoUrl, musicEffectsUrl,
      title: uniqueTitle, mergedFiles: files.length,
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : 'Failed to merge and upload files';
    console.warn('[MERGED_UPLOAD] Merge upload failed gracefully:', message);
    return jsonFailure(message);
  } finally {
    if (lockedUpload) activeUploads.delete(lockedUpload);
    if (mergedLocalPath) {
      try {
        await unlink(mergedLocalPath);
      } catch {
        // Ignore cleanup errors.
      }
    }

    if (tempDir) {
      try {
        await rm(tempDir, { recursive: true, force: true });
      } catch {
        // Ignore cleanup errors.
      }
    }
  }
}

function parseMultipartUpload(
  request: NextRequest,
  tempDir: string,
  contentType: string,
): Promise<ParsedUpload> {
  return new Promise((resolve, reject) => {
    const tempPaths: string[] = [];
    const files: ParsedUpload['files'] = [];
    const attachments = new Map<number, string>();
    let uploadId = randomUUID() as string;
    let titleBase: string | null = null;
    let renderNormally = false;
    let addTransitions = false;
    let includeTransitionSound = true;
    let showTransitionTitles = true;
    let transitionTitlesRaw = '[]';
    let fileIndex = 0;
    let settled = false;
    let totalSize = 0;
    const pendingWrites: Promise<void>[] = [];

    const fail = (error: Error) => {
      if (settled) return;
      settled = true;
      reject(error);
    };

    const busboy = Busboy({
      headers: {
        'content-type': contentType,
      },
      limits: {
        fileSize: MAX_FILE_SIZE,
        files: 200,
        fields: 20,
      },
    });

    busboy.on('field', (name, value) => {
      if (name === 'uploadId') {
        if (!uploadIdPattern.test(value)) { fail(new Error('Invalid merge upload ID.')); return; }
        uploadId = value.toLowerCase();
      } else if (name === 'titleBase') {
        titleBase = value;
      } else if (name === 'renderNormally') {
        renderNormally = value === 'true';
      } else if (name === 'addTransitions') {
        addTransitions = value === 'true';
      } else if (name === 'includeTransitionSound') {
        includeTransitionSound = value === 'true';
      } else if (name === 'showTransitionTitles') {
        showTransitionTitles = value === 'true';
      } else if (name === 'transitionTitles') {
        transitionTitlesRaw = value;
      }
    });

    busboy.on('file', (name, fileStream, info) => {
      const attachment = /^effects-(\d{1,2})$/.exec(name);
      if (settled || (name !== 'files' && !attachment)) {
        fileStream.resume();
        return;
      }
      const attachmentIndex = attachment ? Number(attachment[1]) : null;
      if (attachmentIndex !== null && attachments.has(attachmentIndex)) {
        fileStream.resume();
        fail(new Error(`Clip ${attachmentIndex + 1} has more than one music and effects attachment.`));
        return;
      }
      if (name === 'files' && fileIndex >= 100) {
        fileStream.resume();
        fail(new Error('Select at most 100 videos to merge.'));
        return;
      }

      const filename = info.filename || `video-${fileIndex + 1}.mp4`;
      const contentTypeForFile = info.mimeType || 'application/octet-stream';
      const extension = getExtension(filename);
      const safeName = sanitizePathSegment(filename);
      const currentIndex = attachmentIndex ?? fileIndex++;
      const filePath = path.join(
        tempDir,
        `${attachment ? 'effects-' : ''}${String(currentIndex + 1).padStart(3, '0')}_${safeName}.${extension}`,
      );
      let fileSize = 0;
      let hitFileSizeLimit = false;

      const writeStream = createWriteStream(filePath);
      if (attachmentIndex !== null) attachments.set(attachmentIndex, filePath);
      else tempPaths[currentIndex] = filePath;

      fileStream.on('data', (chunk: Buffer) => {
        fileSize += chunk.length;
        totalSize += chunk.length;
        if (totalSize > MAX_TOTAL_SIZE) {
          fileStream.unpipe(writeStream);
          writeStream.destroy();
          fail(new Error('Total selected video and audio size must be less than 50 GB'));
        }
      });

      fileStream.on('limit', () => {
        hitFileSizeLimit = true;
        fileStream.unpipe(writeStream);
        writeStream.destroy();
        fail(new Error(`${filename} must be less than 10 GB`));
      });

      fileStream.on('error', (error) => {
        writeStream.destroy();
        fail(error instanceof Error ? error : new Error('File stream failed'));
      });

      writeStream.on('error', (error) => {
        fileStream.resume();
        fail(error instanceof Error ? error : new Error('File write failed'));
      });

      const writeDone = new Promise<void>((writeResolve, writeReject) => {
        writeStream.on('finish', () => {
          if (hitFileSizeLimit) {
            writeReject(new Error(`${filename} must be less than 10 GB`));
            return;
          }

          if (attachmentIndex === null) files[currentIndex] = {
            name: filename,
            contentType: contentTypeForFile,
            size: fileSize,
          };
          writeResolve();
        });
        writeStream.on('error', writeReject);
      });

      void writeDone.catch(fail);
      pendingWrites.push(writeDone);
      fileStream.pipe(writeStream);
    });

    busboy.on('filesLimit', () => fail(new Error('Too many files for this merge.')));
    busboy.on('error', (error) => {
      fail(error instanceof Error ? error : new Error('Failed to parse body'));
    });

    busboy.on('finish', async () => {
      if (settled) return;

      try {
        await Promise.all(pendingWrites);
        if (settled) return;
        settled = true;
        let transitionTitles: string[] = [];
        try {
          const parsedTitles = JSON.parse(transitionTitlesRaw);
          if (Array.isArray(parsedTitles)) transitionTitles = parsedTitles.slice(0, 100);
        } catch {
          transitionTitles = [];
        }
        resolve({
          tempPaths,
          attachments,
          uploadId,
          files: files.filter(Boolean),
          titleBase,
          renderNormally,
          addTransitions: renderNormally && addTransitions,
          includeTransitionSound,
          showTransitionTitles,
          transitionTitles,
        });
      } catch (error) {
        fail(error instanceof Error ? error : new Error('Failed to save files'));
      }
    });

    Readable.fromWeb(
      request.body as unknown as Parameters<typeof Readable.fromWeb>[0],
    ).pipe(busboy);
  });
}
