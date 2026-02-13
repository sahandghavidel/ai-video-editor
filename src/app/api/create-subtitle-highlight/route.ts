import { NextRequest, NextResponse } from 'next/server';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { spawn } from 'child_process';
import { uploadToMinio } from '@/utils/ffmpeg-cfr';
import {
  ensureVideoCached,
  getCachedVideoPathIfFresh,
} from '@/utils/video-cache';
import { updateSceneRow } from '@/lib/baserow-actions';

export const runtime = 'nodejs';

type TranscriptionWord = {
  word: string;
  start: number;
  end: number;
};

function clamp(min: number, v: number, max: number) {
  return Math.max(min, Math.min(max, v));
}

function isHttpUrl(value: string) {
  return /^https?:\/\//i.test(value);
}

function formatAssTime(seconds: number): string {
  const safe = Math.max(0, Number.isFinite(seconds) ? seconds : 0);
  const h = Math.floor(safe / 3600);
  const m = Math.floor((safe % 3600) / 60);
  const s = Math.floor(safe % 60);
  const cs = Math.floor((safe - Math.floor(safe)) * 100); // centiseconds
  return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}.${String(cs).padStart(2, '0')}`;
}

function escapeAssText(text: string): string {
  return String(text)
    .replaceAll('\\', '\\\\')
    .replaceAll('{', '\\{')
    .replaceAll('}', '\\}')
    .replaceAll('\n', ' ')
    .replaceAll('\r', ' ');
}

function hexToAssBgr(hex: string): string {
  const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex.trim());
  if (!m) return 'FFFFFF';
  const r = m[1].toUpperCase();
  const g = m[2].toUpperCase();
  const b = m[3].toUpperCase();
  return `${b}${g}${r}`;
}

function assColor(hex: string, alphaHex: string = '00') {
  // ASS is &HAABBGGRR&
  const bgr = hexToAssBgr(hex);
  const a = /^[0-9a-f]{2}$/i.test(alphaHex) ? alphaHex.toUpperCase() : '00';
  return `&H${a}${bgr}&`;
}

function runSpawnCaptureStdout(command: string, args: string[]) {
  return new Promise<{ stdout: string; stderr: string }>((resolve, reject) => {
    const child = spawn(command, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';

    child.stdout?.on('data', (d) => {
      stdout += d.toString();
    });
    child.stderr?.on('data', (d) => {
      stderr += d.toString();
    });

    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) {
        resolve({ stdout, stderr });
      } else {
        reject(
          new Error(
            `${command} failed with code ${code}${stderr ? `: ${stderr}` : ''}`,
          ),
        );
      }
    });
  });
}

async function probeVideoDimensions(inputPathOrUrl: string): Promise<{
  width: number;
  height: number;
  durationSeconds?: number;
}> {
  const { stdout } = await runSpawnCaptureStdout('ffprobe', [
    '-v',
    'error',
    '-show_entries',
    'stream=width,height,duration:format=duration',
    '-of',
    'json',
    inputPathOrUrl,
  ]);

  const data = JSON.parse(stdout) as {
    streams?: Array<{
      codec_type?: string;
      width?: number;
      height?: number;
      duration?: string;
    }>;
    format?: { duration?: string };
  };
  const s = Array.isArray(data.streams)
    ? (data.streams.find(
        (st) =>
          st &&
          (st.codec_type === 'video' ||
            (typeof st.width === 'number' && typeof st.height === 'number')),
      ) ?? data.streams[0])
    : undefined;
  const width = typeof s?.width === 'number' && s.width > 0 ? s.width : 1920;
  const height =
    typeof s?.height === 'number' && s.height > 0 ? s.height : 1080;
  const parsedDurationStream = s?.duration ? Number(s.duration) : Number.NaN;
  const parsedDurationFormat = data?.format?.duration
    ? Number(data.format.duration)
    : Number.NaN;
  const parsedDuration = Number.isFinite(parsedDurationStream)
    ? parsedDurationStream
    : parsedDurationFormat;
  const durationSeconds = Number.isFinite(parsedDuration)
    ? Math.max(0, parsedDuration)
    : undefined;

  return {
    width,
    height,
    durationSeconds,
  };
}

function buildSubtitleHighlightAss(opts: {
  words: TranscriptionWord[];
  videoWidth: number;
  videoHeight: number;
  sceneEndSeconds?: number;
  positionXPercent: number;
  positionYPercent: number;
  sizeHeightPercent: number;
  fontFamily: string;
  uppercase: boolean;
  baseColorHex: string;
  highlightColorHex: string;
}): string {
  const {
    words,
    videoWidth,
    videoHeight,
    sceneEndSeconds,
    positionXPercent,
    positionYPercent,
    sizeHeightPercent,
    fontFamily,
    uppercase,
    baseColorHex,
    highlightColorHex,
  } = opts;

  const safeWords = words
    .filter(
      (w) =>
        w &&
        typeof w.word === 'string' &&
        w.word.trim() &&
        typeof w.start === 'number' &&
        typeof w.end === 'number' &&
        Number.isFinite(w.start) &&
        Number.isFinite(w.end) &&
        w.end >= w.start,
    )
    .map((w) => ({
      word: uppercase ? w.word.trim().toUpperCase() : w.word.trim(),
      start: Math.max(0, w.start),
      end: Math.max(0, w.end),
    }));

  const x = Math.round((clamp(0, positionXPercent, 100) / 100) * videoWidth);
  const y = Math.round((clamp(0, positionYPercent, 100) / 100) * videoHeight);

  const fontSize = clamp(
    24,
    Math.round(videoHeight * 0.12 * (clamp(5, sizeHeightPercent, 100) / 100)),
    220,
  );

  const primary = assColor(baseColorHex, '00');
  const highlight = assColor(highlightColorHex, '00');
  const outlineColor = assColor('#000000', '00');

  const marginL = Math.round(videoWidth * 0.06);
  const marginR = Math.round(videoWidth * 0.06);
  const marginV = Math.round(videoHeight * 0.06);

  const lines: string[] = [];
  lines.push('[Script Info]');
  lines.push('ScriptType: v4.00+');
  lines.push(`PlayResX: ${videoWidth}`);
  lines.push(`PlayResY: ${videoHeight}`);
  lines.push('WrapStyle: 2');
  lines.push('ScaledBorderAndShadow: yes');
  lines.push('');
  lines.push('[V4+ Styles]');
  lines.push(
    'Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding',
  );
  // Alignment=5 is middle-center; we use \pos(x,y) per line, so this is a fallback.
  lines.push(
    `Style: Default,${escapeAssText(fontFamily || 'Helvetica')},${fontSize},${primary},${primary},${outlineColor},&H00000000&,1,0,0,0,100,100,0,0,1,3,0,5,${marginL},${marginR},${marginV},1`,
  );
  lines.push('');
  lines.push('[Events]');
  lines.push(
    'Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text',
  );

  for (let i = 0; i < safeWords.length; i++) {
    const w = safeWords[i];
    const next = safeWords[i + 1];

    const start = w.start;
    // Keep text continuous: each segment lasts until the next word starts.
    const isLast = i === safeWords.length - 1;
    const end = isLast
      ? typeof sceneEndSeconds === 'number' && Number.isFinite(sceneEndSeconds)
        ? // Add a tiny pad because ffprobe duration + ASS centisecond formatting can
          // truncate slightly and leave a few ms "empty" at the very end.
          Math.max(sceneEndSeconds + 0.35, w.end, w.start)
        : Math.max(w.end, w.start)
      : next
        ? Math.max(w.end, next.start)
        : Math.max(w.end, w.start);
    const safeEnd = end > start ? end : start + 0.08;

    const tokens = safeWords.map((t, idx) => {
      const escaped = escapeAssText(t.word);
      if (idx !== i) return escaped;
      return `{\\c${highlight}}${escaped}{\\c${primary}}`;
    });

    const text = `{\\an5\\pos(${x},${y})}${tokens.join(' ')}`;
    lines.push(
      `Dialogue: 0,${formatAssTime(start)},${formatAssTime(
        safeEnd,
      )},Default,,0,0,0,,${text}`,
    );
  }

  return `${lines.join('\n')}\n`;
}

function pickFontsDir() {
  const candidates = [
    path.join(process.cwd(), 'public', 'fonts'),
    path.join(process.cwd(), 'assets', 'fonts'),
  ];
  for (const dir of candidates) {
    try {
      if (fs.existsSync(dir) && fs.statSync(dir).isDirectory()) return dir;
    } catch {
      // ignore
    }
  }
  return null;
}

export async function POST(request: NextRequest) {
  let tempDir: string | null = null;

  try {
    const body = (await request.json().catch(() => null)) as {
      sceneId?: number;
      videoUrl?: string;
      transcriptionWords?: TranscriptionWord[];
      position?: { x?: number; y?: number };
      size?: { height?: number };
      fontFamily?: string;
      uppercase?: boolean;
      baseColorHex?: string;
      highlightColorHex?: string;
      preview?: boolean;
    } | null;

    const sceneId = typeof body?.sceneId === 'number' ? body.sceneId : null;
    const videoUrl = typeof body?.videoUrl === 'string' ? body.videoUrl : '';
    const transcriptionWords = Array.isArray(body?.transcriptionWords)
      ? body?.transcriptionWords
      : [];

    if (!sceneId || !videoUrl.trim()) {
      return NextResponse.json(
        { error: 'sceneId and videoUrl are required' },
        { status: 400 },
      );
    }

    if (!transcriptionWords.length) {
      return NextResponse.json(
        { error: 'No transcription words available for this scene' },
        { status: 400 },
      );
    }

    const preview = body?.preview === true;

    const positionXPercent =
      typeof body?.position?.x === 'number' ? body.position.x : 50;
    const positionYPercent =
      typeof body?.position?.y === 'number' ? body.position.y : 70;
    const sizeHeightPercent =
      typeof body?.size?.height === 'number' ? body.size.height : 100;

    const fontFamily =
      typeof body?.fontFamily === 'string' && body.fontFamily.trim()
        ? body.fontFamily.trim()
        : 'Helvetica';

    const uppercase = body?.uppercase !== false;

    const baseColorHex =
      typeof body?.baseColorHex === 'string' ? body.baseColorHex : '#6B7280'; // gray-500
    const highlightColorHex =
      typeof body?.highlightColorHex === 'string'
        ? body.highlightColorHex
        : '#FACC15'; // yellow-400

    tempDir = await fs.promises.mkdtemp(
      path.join(os.tmpdir(), 'ultimate-video-editr-subtitle-highlight-'),
    );

    const requestStart = Date.now();

    let inputPath = videoUrl.trim();
    if (isHttpUrl(inputPath)) {
      const maxAgeMs = 10 * 60 * 1000;
      const cached = await getCachedVideoPathIfFresh(inputPath, { maxAgeMs });
      inputPath = cached
        ? cached
        : await ensureVideoCached(inputPath, { maxAgeMs });
    }

    const {
      width: videoWidth,
      height: videoHeight,
      durationSeconds,
    } = await probeVideoDimensions(inputPath);

    const assPath = path.join(tempDir, 'highlight.ass');
    const assText = buildSubtitleHighlightAss({
      words: transcriptionWords,
      videoWidth,
      videoHeight,
      sceneEndSeconds: durationSeconds,
      positionXPercent,
      positionYPercent,
      sizeHeightPercent,
      fontFamily,
      uppercase,
      baseColorHex,
      highlightColorHex,
    });
    await fs.promises.writeFile(assPath, assText, 'utf8');

    const outputPath = path.join(tempDir, 'output.mp4');

    const fontsDir = pickFontsDir();
    const subtitleFilter = fontsDir
      ? `ass=${assPath}:fontsdir=${fontsDir}`
      : `ass=${assPath}`;

    const ffmpegArgs = [
      '-y',
      '-i',
      inputPath,
      '-vf',
      subtitleFilter,
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
      '192k',
      outputPath,
    ];

    console.log('[subtitle-highlight] ffmpeg', ffmpegArgs.join(' '));

    await runSpawnCaptureStdout('ffmpeg', ffmpegArgs);

    if (preview) {
      const buf = await fs.promises.readFile(outputPath);
      return new NextResponse(new Uint8Array(buf), {
        status: 200,
        headers: {
          'Content-Type': 'video/mp4',
          'Cache-Control': 'no-store',
        },
      });
    }

    const fileName = `scene-${sceneId}-subtitle-highlight-${Date.now()}.mp4`;
    const uploadUrl = await uploadToMinio(outputPath, fileName, 'video/mp4');

    await updateSceneRow(sceneId, { field_6886: uploadUrl });

    console.log(
      `[subtitle-highlight] done in ${Date.now() - requestStart}ms => ${uploadUrl}`,
    );

    return NextResponse.json({ success: true, videoUrl: uploadUrl });
  } catch (error) {
    console.error('Error creating subtitle highlight effect:', error);
    const message =
      error instanceof Error
        ? error.message
        : typeof error === 'string'
          ? error
          : null;
    return NextResponse.json(
      { error: message || 'Failed to create subtitle highlight effect' },
      { status: 500 },
    );
  } finally {
    if (tempDir) {
      await fs.promises
        .rm(tempDir, { recursive: true, force: true })
        .catch(() => undefined);
    }
  }
}
