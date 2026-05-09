import { NextRequest, NextResponse } from 'next/server';
import { spawn } from 'child_process';
import path from 'path';
import { access, unlink, writeFile } from 'fs/promises';
import { uploadToMinio } from '@/utils/ffmpeg-direct';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const VIDEOS_TABLE_ID = '713';
const SCENES_TABLE_ID = '714';

const SCENE_VIDEO_LINK_FIELD_KEY = 'field_6889';
const SCENE_TTS_FIELD_KEY = 'field_6891';
const SCENE_DURATION_FIELD_KEY = 'field_6884';
const SCENE_DUBBED_EN_FIELD_KEY = 'field_7108';
const SCENE_SENTENCE_FIELD_KEY = 'field_6890';

const VIDEO_DURATION_FIELD_KEY = 'field_6909';
const VIDEO_FINAL_DUBBED_AUDIO_FIELD_KEY = 'field_7109';

const AUDIO_SAMPLE_RATE = 48000;
const AUDIO_CHANNELS = 2;

const TIME_DECIMALS = 9;
const SPEED_DECIMALS = 12;

const DEFAULT_FFMPEG_TIMEOUT_MS = 10 * 60 * 1000;
const DEFAULT_FFPROBE_TIMEOUT_MS = 2 * 60 * 1000;
const FINAL_MERGED_DURATION_TOLERANCE_SEC = 0.01;
const FINAL_MERGED_MAX_TEMPO_PASSES = 3;

type BaserowRow = Record<string, unknown>;

type BaserowListResponse = {
  results?: BaserowRow[];
  next?: string | null;
};

type FFprobeStream = {
  duration?: string | number;
};

type FFprobeOutput = {
  format?: {
    duration?: string | number;
  };
  streams?: FFprobeStream[];
};

type SceneJob = {
  sceneId: number;
  orderValue: number;
  audioUrl: string | null;
  source: 'tts' | 'silence';
  targetDurationSec: number;
};

type SceneProcessResult = {
  sceneId: number;
  orderValue: number;
  source: 'tts' | 'silence';
  targetDurationSec: number;
  inputDurationSec: number;
  outputDurationSec: number;
  speedApplied: number;
  dubbedEnUrl: string;
  localAdjustedPath: string;
};

function parsePositiveInt(value: unknown): number | null {
  const parsed =
    typeof value === 'number'
      ? value
      : typeof value === 'string'
        ? Number(value)
        : Number.NaN;

  if (!Number.isInteger(parsed) || parsed <= 0) {
    return null;
  }

  return parsed;
}

function parsePositiveNumber(value: unknown): number | null {
  const parsed =
    typeof value === 'number'
      ? value
      : typeof value === 'string'
        ? Number(value)
        : Number.NaN;

  if (!Number.isFinite(parsed) || parsed <= 0) {
    return null;
  }

  return parsed;
}

function parseNumberish(value: unknown): number {
  if (typeof value === 'number') {
    return value;
  }
  if (typeof value === 'string') {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : Number.NaN;
  }
  return Number.NaN;
}

function getSceneOrderValue(scene: BaserowRow): number {
  const fromStart = parseNumberish(scene.field_6896);
  if (Number.isFinite(fromStart)) {
    return fromStart;
  }

  const fromOrder = parseNumberish(scene.order);
  if (Number.isFinite(fromOrder)) {
    return fromOrder;
  }

  const fromId = parseNumberish(scene.id);
  if (Number.isFinite(fromId)) {
    return fromId;
  }

  return 0;
}

function extractUrl(raw: unknown): string {
  if (typeof raw === 'string') {
    return raw.trim();
  }

  if (!raw) {
    return '';
  }

  if (Array.isArray(raw)) {
    for (const item of raw) {
      const next = extractUrl(item);
      if (next) return next;
    }
    return '';
  }

  if (typeof raw === 'object') {
    const obj = raw as Record<string, unknown>;
    const nestedFile =
      obj.file && typeof obj.file === 'object'
        ? (obj.file as Record<string, unknown>)
        : null;

    const candidates = [
      obj.url,
      obj.value,
      obj.name,
      obj.text,
      nestedFile?.url,
    ];

    for (const candidate of candidates) {
      if (typeof candidate === 'string' && candidate.trim()) {
        return candidate.trim();
      }
    }
  }

  return '';
}

function isSceneEmptyForDub(scene: BaserowRow): boolean {
  const sentenceText = String(scene[SCENE_SENTENCE_FIELD_KEY] ?? '').trim();

  return sentenceText === '';
}

function formatSeconds(value: number): string {
  return value.toFixed(TIME_DECIMALS);
}

function buildAtempoChain(speed: number): string {
  if (!Number.isFinite(speed) || speed <= 0) {
    throw new Error(`Invalid tempo speed: ${speed}`);
  }

  const filters: string[] = [];
  let remaining = speed;

  while (remaining > 2.0) {
    filters.push('atempo=2.0');
    remaining /= 2.0;
  }

  while (remaining < 0.5) {
    filters.push('atempo=0.5');
    remaining /= 0.5;
  }

  if (Math.abs(remaining - 1.0) > 1e-9) {
    filters.push(`atempo=${remaining.toFixed(SPEED_DECIMALS)}`);
  }

  return filters.length > 0 ? filters.join(',') : 'anull';
}

function makeTempPath(prefix: string, extension: string): string {
  const safeExt = extension.replace(/^\./, '');
  return path.resolve(
    '/tmp',
    `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 10)}.${safeExt}`,
  );
}

async function safeUnlink(filePath?: string | null): Promise<void> {
  if (!filePath) return;
  try {
    await unlink(filePath);
  } catch {
    // Best-effort cleanup.
  }
}

async function runCommand(
  command: string,
  args: string[],
  timeoutMs: number,
): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ['ignore', 'pipe', 'pipe'] });

    let stdout = '';
    let stderr = '';
    let settled = false;

    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      child.kill('SIGKILL');
      reject(new Error(`${command} timed out after ${timeoutMs}ms`));
    }, timeoutMs);

    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString();
    });

    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
    });

    child.on('error', (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(error);
    });

    child.on('close', (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);

      if (code === 0) {
        resolve({ stdout, stderr });
        return;
      }

      const stderrTail = stderr.trim().slice(-2000);
      reject(
        new Error(
          `${command} failed with code ${code}${stderrTail ? `: ${stderrTail}` : ''}`,
        ),
      );
    });
  });
}

async function probeMediaDurationSeconds(input: string): Promise<number> {
  const { stdout } = await runCommand(
    'ffprobe',
    [
      '-v',
      'quiet',
      '-print_format',
      'json',
      '-show_format',
      '-show_streams',
      input,
    ],
    DEFAULT_FFPROBE_TIMEOUT_MS,
  );

  const parsed = (JSON.parse(stdout) ?? {}) as FFprobeOutput;
  const candidates: number[] = [];

  const formatDuration = parseNumberish(parsed.format?.duration);
  if (Number.isFinite(formatDuration) && formatDuration > 0) {
    candidates.push(formatDuration);
  }

  for (const stream of parsed.streams ?? []) {
    const streamDuration = parseNumberish(stream.duration);
    if (Number.isFinite(streamDuration) && streamDuration > 0) {
      candidates.push(streamDuration);
    }
  }

  const duration = candidates.length > 0 ? Math.max(...candidates) : Number.NaN;
  if (!Number.isFinite(duration) || duration <= 0) {
    throw new Error('Unable to determine media duration via ffprobe');
  }

  return duration;
}

let cachedToken: string | null = null;
let cachedTokenExpiry = 0;

async function getJWTToken(forceRefresh = false): Promise<string> {
  const baserowUrl = process.env.BASEROW_API_URL;
  const email = process.env.BASEROW_EMAIL;
  const password = process.env.BASEROW_PASSWORD;

  if (!baserowUrl || !email || !password) {
    throw new Error('Missing Baserow configuration');
  }

  if (
    !forceRefresh &&
    cachedToken &&
    Date.now() < cachedTokenExpiry - 300_000
  ) {
    return cachedToken;
  }

  const response = await fetch(`${baserowUrl}/user/token-auth/`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
    cache: 'no-store',
  });

  if (!response.ok) {
    const errorText = await response.text().catch(() => '');
    throw new Error(`Authentication failed: ${response.status} ${errorText}`);
  }

  const payload = (await response.json().catch(() => null)) as {
    token?: unknown;
  } | null;
  const token = typeof payload?.token === 'string' ? payload.token.trim() : '';

  if (!token) {
    throw new Error('Authentication succeeded but token is missing');
  }

  cachedToken = token;
  cachedTokenExpiry = Date.now() + 50 * 60 * 1000;
  return token;
}

async function baserowGetJson<T>(
  baserowUrl: string,
  token: string,
  pathName: string,
): Promise<T> {
  const response = await fetch(`${baserowUrl}${pathName}`, {
    method: 'GET',
    headers: {
      Authorization: `JWT ${token}`,
    },
    cache: 'no-store',
  });

  if (!response.ok) {
    const errorText = await response.text().catch(() => '');
    throw new Error(`Baserow GET failed (${response.status}) ${errorText}`);
  }

  return (await response.json()) as T;
}

async function baserowPatchRow(
  baserowUrl: string,
  token: string,
  tableId: string,
  rowId: number,
  patch: Record<string, unknown>,
): Promise<void> {
  const response = await fetch(
    `${baserowUrl}/database/rows/table/${tableId}/${rowId}/`,
    {
      method: 'PATCH',
      headers: {
        Authorization: `JWT ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(patch),
      cache: 'no-store',
    },
  );

  if (!response.ok) {
    const errorText = await response.text().catch(() => '');
    throw new Error(
      `Baserow PATCH failed for table ${tableId} row ${rowId} (${response.status}) ${errorText}`,
    );
  }
}

async function fetchAllScenesForVideo(
  baserowUrl: string,
  token: string,
  videoId: number,
): Promise<BaserowRow[]> {
  const all: BaserowRow[] = [];
  const pageSize = 200;
  let page = 1;

  while (true) {
    const params = new URLSearchParams();
    params.set(`filter__${SCENE_VIDEO_LINK_FIELD_KEY}__equal`, String(videoId));
    params.set('size', String(pageSize));
    params.set('page', String(page));

    const pathName = `/database/rows/table/${SCENES_TABLE_ID}/?${params.toString()}`;

    const json = await baserowGetJson<BaserowListResponse>(
      baserowUrl,
      token,
      pathName,
    );

    const results = Array.isArray(json.results) ? json.results : [];
    all.push(...results);

    if (!json.next || results.length === 0) {
      break;
    }

    page += 1;
  }

  return all;
}

async function fitSceneAudioToDurationLocal(options: {
  sceneId: number;
  videoId: number;
  inputAudioUrl: string;
  targetDurationSec: number;
}): Promise<{
  localPath: string;
  inputDurationSec: number;
  outputDurationSec: number;
  speedApplied: number;
}> {
  const { sceneId, videoId, inputAudioUrl, targetDurationSec } = options;

  const inputDurationSec = await probeMediaDurationSeconds(inputAudioUrl);

  // User requirement:
  // - if shorter => pad with silence
  // - if longer => speed up
  const speedApplied =
    inputDurationSec > targetDurationSec
      ? inputDurationSec / targetDurationSec
      : 1;

  const filterParts: string[] = [
    `aformat=sample_fmts=fltp:sample_rates=${AUDIO_SAMPLE_RATE}:channel_layouts=stereo`,
  ];

  if (speedApplied > 1 + 1e-9) {
    filterParts.push(buildAtempoChain(speedApplied));
  }

  // Keep precision strict: pad if short, trim exact target endpoint.
  filterParts.push(
    'apad',
    `atrim=0:${formatSeconds(targetDurationSec)}`,
    'asetpts=N/SR/TB',
  );

  const outputPath = makeTempPath(
    `video_${videoId}_scene_${sceneId}_dubbed_en_local`,
    'm4a',
  );

  await runCommand(
    'ffmpeg',
    [
      '-y',
      '-i',
      inputAudioUrl,
      '-vn',
      '-map_metadata',
      '-1',
      '-map_chapters',
      '-1',
      '-filter_complex',
      `[0:a]${filterParts.join(',')}[aout]`,
      '-map',
      '[aout]',
      '-c:a',
      'aac',
      '-b:a',
      '192k',
      '-ar',
      String(AUDIO_SAMPLE_RATE),
      '-ac',
      String(AUDIO_CHANNELS),
      '-movflags',
      '+faststart',
      outputPath,
    ],
    DEFAULT_FFMPEG_TIMEOUT_MS,
  );

  await access(outputPath);
  const outputDurationSec = await probeMediaDurationSeconds(outputPath);

  return {
    localPath: outputPath,
    inputDurationSec,
    outputDurationSec,
    speedApplied,
  };
}

async function createSilenceAudioToDurationLocal(options: {
  sceneId: number;
  videoId: number;
  targetDurationSec: number;
}): Promise<{
  localPath: string;
  inputDurationSec: number;
  outputDurationSec: number;
  speedApplied: number;
}> {
  const { sceneId, videoId, targetDurationSec } = options;

  const outputPath = makeTempPath(
    `video_${videoId}_scene_${sceneId}_dubbed_en_silence_local`,
    'm4a',
  );

  await runCommand(
    'ffmpeg',
    [
      '-y',
      '-f',
      'lavfi',
      '-i',
      `anullsrc=sample_rate=${AUDIO_SAMPLE_RATE}:channel_layout=stereo`,
      '-filter_complex',
      `[0:a]atrim=0:${formatSeconds(targetDurationSec)},asetpts=N/SR/TB[aout]`,
      '-map',
      '[aout]',
      '-c:a',
      'aac',
      '-b:a',
      '192k',
      '-ar',
      String(AUDIO_SAMPLE_RATE),
      '-ac',
      String(AUDIO_CHANNELS),
      '-movflags',
      '+faststart',
      outputPath,
    ],
    DEFAULT_FFMPEG_TIMEOUT_MS,
  );

  await access(outputPath);
  const outputDurationSec = await probeMediaDurationSeconds(outputPath);

  return {
    localPath: outputPath,
    inputDurationSec: targetDurationSec,
    outputDurationSec,
    speedApplied: 1,
  };
}

async function concatenateAudiosLocal(
  inputPaths: string[],
  videoId: number,
): Promise<string> {
  if (inputPaths.length === 0) {
    throw new Error('No scene dubbed audios to merge');
  }

  if (inputPaths.length === 1) {
    return inputPaths[0];
  }

  const concatListPath = makeTempPath(
    `video_${videoId}_dubbed_en_concat`,
    'txt',
  );
  const outputPath = makeTempPath(
    `video_${videoId}_dubbed_en_merged_local`,
    'm4a',
  );

  const concatContent = inputPaths
    .map((filePath) => `file '${filePath.replace(/'/g, "'\\''")}'`)
    .join('\n');

  try {
    await writeFile(concatListPath, concatContent, 'utf8');

    await runCommand(
      'ffmpeg',
      [
        '-y',
        '-f',
        'concat',
        '-safe',
        '0',
        '-i',
        concatListPath,
        '-vn',
        '-c:a',
        'aac',
        '-b:a',
        '192k',
        '-ar',
        String(AUDIO_SAMPLE_RATE),
        '-ac',
        String(AUDIO_CHANNELS),
        '-movflags',
        '+faststart',
        outputPath,
      ],
      DEFAULT_FFMPEG_TIMEOUT_MS,
    );

    await access(outputPath);
    return outputPath;
  } finally {
    await safeUnlink(concatListPath);
  }
}

async function fitMergedAudioToVideoDurationLocal(options: {
  inputPath: string;
  videoId: number;
  targetDurationSec: number;
}): Promise<{
  localPath: string;
  inputDurationSec: number;
  outputDurationSec: number;
  speedApplied: number;
}> {
  const { inputPath, videoId, targetDurationSec } = options;

  const inputDurationSec = await probeMediaDurationSeconds(inputPath);
  let currentPath = inputPath;
  let currentDurationSec = inputDurationSec;
  let cumulativeSpeedApplied = 1;
  const generatedPassPaths: string[] = [];

  try {
    for (
      let passIndex = 1;
      passIndex <= FINAL_MERGED_MAX_TEMPO_PASSES;
      passIndex += 1
    ) {
      const deltaSec = currentDurationSec - targetDurationSec;
      if (Math.abs(deltaSec) <= FINAL_MERGED_DURATION_TOLERANCE_SEC) {
        break;
      }

      const passSpeedApplied = currentDurationSec / targetDurationSec;
      if (!Number.isFinite(passSpeedApplied) || passSpeedApplied <= 0) {
        throw new Error(
          `Invalid merged tempo speed on pass ${passIndex}: ${passSpeedApplied}`,
        );
      }

      const filterParts: string[] = [
        `aformat=sample_fmts=fltp:sample_rates=${AUDIO_SAMPLE_RATE}:channel_layouts=stereo`,
      ];

      if (Math.abs(passSpeedApplied - 1) > 1e-12) {
        filterParts.push(buildAtempoChain(passSpeedApplied));
      }

      // Important user requirement:
      // - merge all fitted scene audios first
      // - then match full track duration by tempo only (speed up / slow down)
      // - do NOT trim or pad final merged audio to avoid chopping tail content
      filterParts.push('asetpts=N/SR/TB');

      const passOutputPath = makeTempPath(
        `video_${videoId}_final_dubbed_en_local_pass_${passIndex}`,
        'm4a',
      );

      await runCommand(
        'ffmpeg',
        [
          '-y',
          '-i',
          currentPath,
          '-vn',
          '-map_metadata',
          '-1',
          '-map_chapters',
          '-1',
          '-filter_complex',
          `[0:a]${filterParts.join(',')}[aout]`,
          '-map',
          '[aout]',
          '-c:a',
          'aac',
          '-b:a',
          '192k',
          '-ar',
          String(AUDIO_SAMPLE_RATE),
          '-ac',
          String(AUDIO_CHANNELS),
          '-movflags',
          '+faststart',
          passOutputPath,
        ],
        DEFAULT_FFMPEG_TIMEOUT_MS,
      );

      await access(passOutputPath);
      const passOutputDurationSec =
        await probeMediaDurationSeconds(passOutputPath);

      generatedPassPaths.push(passOutputPath);
      cumulativeSpeedApplied *= passSpeedApplied;

      if (currentPath !== inputPath) {
        await safeUnlink(currentPath);
      }

      currentPath = passOutputPath;
      currentDurationSec = passOutputDurationSec;
    }
  } catch (error) {
    for (const generatedPath of generatedPassPaths) {
      if (generatedPath !== currentPath) {
        await safeUnlink(generatedPath);
      }
    }
    throw error;
  }

  return {
    localPath: currentPath,
    inputDurationSec,
    outputDurationSec: currentDurationSec,
    speedApplied: cumulativeSpeedApplied,
  };
}

export async function POST(request: NextRequest) {
  const tempFiles: string[] = [];

  try {
    const body = (await request.json().catch(() => null)) as {
      videoId?: unknown;
    } | null;

    const videoId = parsePositiveInt(body?.videoId);
    if (!videoId) {
      return NextResponse.json(
        { error: 'videoId must be a positive integer' },
        { status: 400 },
      );
    }

    const baserowUrl = process.env.BASEROW_API_URL;
    if (!baserowUrl) {
      return NextResponse.json(
        { error: 'Missing BASEROW_API_URL' },
        { status: 500 },
      );
    }

    const token = await getJWTToken();

    const videoRow = await baserowGetJson<BaserowRow>(
      baserowUrl,
      token,
      `/database/rows/table/${VIDEOS_TABLE_ID}/${videoId}/`,
    );

    const targetVideoDurationSec = parsePositiveNumber(
      videoRow[VIDEO_DURATION_FIELD_KEY],
    );

    if (!targetVideoDurationSec) {
      return NextResponse.json(
        {
          error: `Selected video is missing a valid Uploaded Video Duration (${VIDEO_DURATION_FIELD_KEY})`,
        },
        { status: 400 },
      );
    }

    const scenesRaw = await fetchAllScenesForVideo(baserowUrl, token, videoId);
    if (scenesRaw.length === 0) {
      return NextResponse.json(
        { error: `No scenes found for video ${videoId}` },
        { status: 404 },
      );
    }

    const sortedScenes = [...scenesRaw].sort(
      (a, b) => getSceneOrderValue(a) - getSceneOrderValue(b),
    );

    const validationErrors: string[] = [];
    const sceneJobs: SceneJob[] = [];

    for (const scene of sortedScenes) {
      const sceneId = parsePositiveInt(scene.id);
      const orderValue = getSceneOrderValue(scene);

      if (!sceneId) {
        validationErrors.push('Encountered a scene with invalid ID');
        continue;
      }

      const targetDurationSec = parsePositiveNumber(
        scene[SCENE_DURATION_FIELD_KEY],
      );
      if (!targetDurationSec) {
        validationErrors.push(
          `Scene ${sceneId} is missing valid Duration (${SCENE_DURATION_FIELD_KEY})`,
        );
        continue;
      }

      const audioUrl = extractUrl(scene[SCENE_TTS_FIELD_KEY]);
      const isEmptyScene = isSceneEmptyForDub(scene);

      if (!audioUrl) {
        if (isEmptyScene) {
          sceneJobs.push({
            sceneId,
            orderValue,
            audioUrl: null,
            source: 'silence',
            targetDurationSec,
          });
          continue;
        }

        validationErrors.push(
          `Scene ${sceneId} is non-empty but missing EN TTS audio (${SCENE_TTS_FIELD_KEY})`,
        );
        continue;
      }

      sceneJobs.push({
        sceneId,
        orderValue,
        audioUrl,
        source: 'tts',
        targetDurationSec,
      });
    }

    if (validationErrors.length > 0) {
      return NextResponse.json(
        {
          error:
            'Cannot start dubbing batch because some non-empty scenes are missing required fields',
          details: validationErrors,
        },
        { status: 400 },
      );
    }

    const sceneResults: SceneProcessResult[] = [];

    for (const job of sceneJobs) {
      const fitted =
        job.source === 'silence'
          ? await createSilenceAudioToDurationLocal({
              sceneId: job.sceneId,
              videoId,
              targetDurationSec: job.targetDurationSec,
            })
          : await fitSceneAudioToDurationLocal({
              sceneId: job.sceneId,
              videoId,
              inputAudioUrl: job.audioUrl || '',
              targetDurationSec: job.targetDurationSec,
            });

      tempFiles.push(fitted.localPath);

      const sceneFilename =
        job.source === 'silence'
          ? `video_${videoId}_scene_${job.sceneId}_dubbed_en_silence_${Date.now()}.m4a`
          : `video_${videoId}_scene_${job.sceneId}_dubbed_en_${Date.now()}.m4a`;
      const dubbedEnUrl = await uploadToMinio(
        fitted.localPath,
        sceneFilename,
        'audio/mp4',
      );

      await baserowPatchRow(baserowUrl, token, SCENES_TABLE_ID, job.sceneId, {
        [SCENE_DUBBED_EN_FIELD_KEY]: dubbedEnUrl,
      });

      sceneResults.push({
        sceneId: job.sceneId,
        orderValue: job.orderValue,
        source: job.source,
        targetDurationSec: job.targetDurationSec,
        inputDurationSec: fitted.inputDurationSec,
        outputDurationSec: fitted.outputDurationSec,
        speedApplied: fitted.speedApplied,
        dubbedEnUrl,
        localAdjustedPath: fitted.localPath,
      });
    }

    const mergedLocalPath = await concatenateAudiosLocal(
      sceneResults
        .sort((a, b) => a.orderValue - b.orderValue)
        .map((result) => result.localAdjustedPath),
      videoId,
    );

    if (!tempFiles.includes(mergedLocalPath)) {
      tempFiles.push(mergedLocalPath);
    }

    const mergedDurationBeforeFitSec =
      await probeMediaDurationSeconds(mergedLocalPath);

    const fittedMerged = await fitMergedAudioToVideoDurationLocal({
      inputPath: mergedLocalPath,
      videoId,
      targetDurationSec: targetVideoDurationSec,
    });

    tempFiles.push(fittedMerged.localPath);

    const finalFilename = `video_${videoId}_final_dubbed_audio_${Date.now()}.m4a`;
    const finalDubbedAudioUrl = await uploadToMinio(
      fittedMerged.localPath,
      finalFilename,
      'audio/mp4',
    );

    await baserowPatchRow(baserowUrl, token, VIDEOS_TABLE_ID, videoId, {
      [VIDEO_FINAL_DUBBED_AUDIO_FIELD_KEY]: finalDubbedAudioUrl,
    });

    return NextResponse.json({
      ok: true,
      videoId,
      processedSceneCount: sceneResults.length,
      silenceSceneCount: sceneResults.filter((s) => s.source === 'silence')
        .length,
      ttsSceneCount: sceneResults.filter((s) => s.source === 'tts').length,
      sceneDubbedField: SCENE_DUBBED_EN_FIELD_KEY,
      finalDubbedField: VIDEO_FINAL_DUBBED_AUDIO_FIELD_KEY,
      videoTargetDurationSec: targetVideoDurationSec,
      mergedDurationBeforeFitSec,
      mergedDurationAfterFitSec: fittedMerged.outputDurationSec,
      finalDubbedAudioUrl,
      scenes: sceneResults
        .sort((a, b) => a.orderValue - b.orderValue)
        .map((sceneResult) => ({
          sceneId: sceneResult.sceneId,
          orderValue: sceneResult.orderValue,
          source: sceneResult.source,
          targetDurationSec: sceneResult.targetDurationSec,
          inputDurationSec: sceneResult.inputDurationSec,
          outputDurationSec: sceneResult.outputDurationSec,
          speedApplied: sceneResult.speedApplied,
          dubbedEnUrl: sceneResult.dubbedEnUrl,
        })),
    });
  } catch (error) {
    console.error('[create-dubbed-en] error:', error);
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 },
    );
  } finally {
    for (const filePath of tempFiles) {
      await safeUnlink(filePath);
    }
  }
}
