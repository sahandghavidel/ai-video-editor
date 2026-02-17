import { NextRequest, NextResponse } from 'next/server';
import sharp from 'sharp';
import OpenAI from 'openai';

export const runtime = 'nodejs';
export const maxDuration = 30;

const openai = new OpenAI({
  apiKey: process.env.OPENROUTER_API_KEY,
  baseURL: 'https://openrouter.ai/api/v1',
  defaultHeaders: {
    'HTTP-Referer': 'https://ultimate-video-editor.com',
    'X-Title': 'Ultimate Video Editor',
  },
});

type OcrSubprocessResult = {
  hasText: boolean;
  confidence: number;
  cleaned?: string;
  cleanedLength?: number;
  textSnippet?: string;
};

type OcrWorker = {
  recognize: (
    image: Buffer,
  ) => Promise<{ data?: { text?: string; confidence?: number } }>;
  setParameters: (params: Record<string, unknown>) => Promise<void>;
};

type TesseractLike = {
  createWorker: (
    lang: string,
    oem: number,
    options: Record<string, unknown>,
  ) => Promise<OcrWorker>;
  OEM: { LSTM_ONLY: number };
  PSM: { SINGLE_BLOCK: number };
};

let workerPromise: Promise<OcrWorker> | null = null;

function isOcrEnabled() {
  const raw = String(process.env.ENABLE_TESSERACT_OCR ?? '')
    .trim()
    .toLowerCase();
  return raw === '1' || raw === 'true' || raw === 'yes';
}

function isVisionEnabled(): boolean {
  const key = String(process.env.OPENROUTER_API_KEY ?? '').trim();
  if (!key) return false;
  const raw = String(process.env.ENABLE_VISION_TEXT_DETECT ?? '1')
    .trim()
    .toLowerCase();
  return raw === '1' || raw === 'true' || raw === 'yes' || raw === 'on';
}

function isTruthyQueryParam(req: NextRequest, name: string): boolean {
  const v = req.nextUrl.searchParams.get(name);
  if (!v) return false;
  const s = v.trim().toLowerCase();
  return s === '1' || s === 'true' || s === 'yes' || s === 'on';
}

function shouldLogDebug(req: NextRequest): boolean {
  if (isTruthyQueryParam(req, 'debug')) return true;
  const raw = String(process.env.LOG_TEXT_DETECT ?? '')
    .trim()
    .toLowerCase();
  if (raw === '1' || raw === 'true' || raw === 'yes' || raw === 'on')
    return true;
  return process.env.NODE_ENV !== 'production';
}

function parseFirstJsonObject(text: string): Record<string, unknown> | null {
  const t = String(text ?? '');
  const firstBrace = t.indexOf('{');
  const lastBrace = t.lastIndexOf('}');
  if (firstBrace < 0 || lastBrace < 0 || lastBrace <= firstBrace) return null;
  const candidate = t.slice(firstBrace, lastBrace + 1);
  try {
    const parsed = JSON.parse(candidate) as unknown;
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

function clamp01(n: number): number {
  return Math.max(0, Math.min(1, n));
}

function clampNumber(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, n));
}

function getNumericEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw === null) return fallback;
  const s = String(raw).trim();
  // Important: Number('') === 0, which is almost never what we want for env defaults.
  if (s.length === 0) return fallback;
  const n = Number(s);
  return Number.isFinite(n) ? n : fallback;
}

function normalizeAlnumText(text: string): string {
  // For now, only count ASCII letters/digits as “text”.
  // This intentionally ignores punctuation like '?', '!', etc.
  return String(text ?? '').replace(/[^A-Za-z0-9]/g, '');
}

async function detectTextWithVisionLLM(imageBytes: Buffer): Promise<{
  modelHasText: boolean;
  modelConfidence: number;
  reason?: string;
  rawText?: string;
  largestTextHeightPct?: number;
  smallestTextHeightPct?: number;
  elements?: Array<{ text: string; heightPct: number }>;
}> {
  // Downscale/compress to keep token + bandwidth cost low.
  const jpeg = await sharp(imageBytes)
    .rotate()
    .resize({ width: 1024, withoutEnlargement: true })
    .jpeg({ quality: 78 })
    .toBuffer();

  const dataUrl = `data:image/jpeg;base64,${jpeg.toString('base64')}`;

  const model =
    String(process.env.VISION_TEXT_MODEL ?? 'openai/gpt-4o-mini')
      .trim()
      .toLowerCase() || 'openai/gpt-4o-mini';

  const prompt =
    'You are a strict image text detector. Determine whether the image contains ANY visible readable text.\n' +
    'Text includes: subtitles/captions, watermarks, logos with letters, UI text, signs, labels, numbers.\n' +
    'IMPORTANT: Return punctuation exactly as seen, but do NOT treat punctuation-only as meaningful text.\n' +
    "Identify distinct visible text groups (different locations/sizes) and estimate each group's text height as a percentage of image height.\n" +
    'Return ONLY one JSON object with keys:\n' +
    '- hasText: boolean\n' +
    '- confidence: number between 0 and 1\n' +
    '- text: string (the visible text you can read; keep it short, max 140 chars)\n' +
    '- elements: array of up to 6 objects { text: string, heightPct: number }\n' +
    '- largestTextHeightPct: number (0..100, approximate)\n' +
    '- smallestTextHeightPct: number (0..100, approximate)\n' +
    '- reason: short string\n' +
    'No extra words, no markdown.';

  const completion = await openai.chat.completions.create({
    model,
    messages: [
      {
        role: 'user',
        content: [
          { type: 'text', text: prompt },
          { type: 'image_url', image_url: { url: dataUrl } },
        ],
      },
    ],
    temperature: 0,
  });

  const content = completion.choices?.[0]?.message?.content ?? '';
  const obj = parseFirstJsonObject(String(content));
  if (!obj) {
    throw new Error(
      `Vision model returned non-JSON: ${String(content).slice(0, 200)}`,
    );
  }

  const modelHasText = Boolean(obj.hasText);
  const confRaw = obj.confidence;
  const modelConfidence =
    typeof confRaw === 'number' && Number.isFinite(confRaw)
      ? clamp01(confRaw)
      : modelHasText
        ? 0.7
        : 0.3;

  const reason =
    typeof obj.reason === 'string' ? obj.reason.slice(0, 240) : undefined;
  const rawText =
    typeof obj.text === 'string' ? obj.text.slice(0, 180) : undefined;

  const elementsRaw = obj.elements;
  const elements: Array<{ text: string; heightPct: number }> = Array.isArray(
    elementsRaw,
  )
    ? (elementsRaw
        .map((el) => {
          const r = el as Record<string, unknown>;
          const t = typeof r.text === 'string' ? r.text.slice(0, 160) : '';
          const hp =
            typeof r.heightPct === 'number' && Number.isFinite(r.heightPct)
              ? clampNumber(r.heightPct, 0, 100)
              : NaN;
          if (!t || !Number.isFinite(hp)) return null;
          return { text: t, heightPct: hp };
        })
        .filter(Boolean) as Array<{ text: string; heightPct: number }>)
    : [];

  const largestTextHeightPct =
    typeof obj.largestTextHeightPct === 'number' &&
    Number.isFinite(obj.largestTextHeightPct)
      ? clampNumber(obj.largestTextHeightPct, 0, 100)
      : undefined;

  const smallestTextHeightPct =
    typeof obj.smallestTextHeightPct === 'number' &&
    Number.isFinite(obj.smallestTextHeightPct)
      ? clampNumber(obj.smallestTextHeightPct, 0, 100)
      : elements.length > 0
        ? Math.min(...elements.map((e) => e.heightPct))
        : undefined;

  return {
    modelHasText,
    modelConfidence,
    reason,
    rawText,
    largestTextHeightPct,
    smallestTextHeightPct,
    elements: elements.slice(0, 6),
  };
}

function shouldAttemptOcr(
  req: NextRequest,
  heuristic: TextDetectResult,
): boolean {
  // If the client explicitly requests OCR, do it.
  if (
    isTruthyQueryParam(req, 'preferOcr') ||
    isTruthyQueryParam(req, 'accurate')
  ) {
    return true;
  }

  // Otherwise: run OCR only for ambiguous cases to keep things fast.
  // “Ambiguous” = near threshold or conflicting signals.
  const score = heuristic.score;
  const ink = heuristic.inkRatio;
  const transitions = heuristic.rowTransitionsMax;

  // Clearly empty / clearly not-text: skip OCR.
  if (score <= 18 && ink <= 0.01 && transitions <= 18) return false;

  // Clearly strong text by heuristic: skip OCR.
  if (heuristic.hasText && (score >= 60 || heuristic.darkBandHeight >= 18))
    return false;

  // If heuristic says no-text but there is meaningful ink/edges, try OCR.
  if (!heuristic.hasText && (ink >= 0.02 || score >= 25)) return true;

  // If heuristic says text but the score is barely over the line, verify with OCR.
  if (heuristic.hasText && score < 55) return true;

  return false;
}

async function detectTextWithOcrSubprocess(
  imageBytes: Buffer,
): Promise<OcrSubprocessResult> {
  const [path, os, fsPromises, childProc] = await Promise.all([
    import('path'),
    import('os'),
    import('fs/promises'),
    import('child_process'),
  ]);

  // Preprocess for OCR speed/accuracy: downscale + grayscale.
  const processed = await sharp(imageBytes)
    .rotate()
    .resize({ width: 1100, withoutEnlargement: true })
    .grayscale()
    .normalize()
    .sharpen()
    .png()
    .toBuffer();

  const tmpDir = await fsPromises.mkdtemp(
    path.join(os.tmpdir(), 'detect-text-ocr-'),
  );
  const imagePath = path.join(tmpDir, 'image.png');

  try {
    await fsPromises.writeFile(imagePath, processed);

    const scriptPath = path.join(process.cwd(), 'scripts', 'ocr-runner.cjs');
    const nodeExe = process.execPath;

    const args = [scriptPath, '--image', imagePath];
    const proc = childProc.spawn(nodeExe, args, {
      cwd: process.cwd(),
      env: {
        ...process.env,
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    const stdoutChunks: Buffer[] = [];
    const stderrChunks: Buffer[] = [];

    proc.stdout?.on('data', (c: Buffer) => stdoutChunks.push(c));
    proc.stderr?.on('data', (c: Buffer) => stderrChunks.push(c));

    const timeoutMs = 15_000;
    const result = await new Promise<OcrSubprocessResult>((resolve, reject) => {
      const to = setTimeout(() => {
        try {
          proc.kill('SIGKILL');
        } catch {
          // ignore
        }
        reject(new Error('OCR subprocess timed out'));
      }, timeoutMs);

      proc.on('error', (err: Error) => {
        clearTimeout(to);
        reject(err);
      });

      proc.on('close', (code: number | null) => {
        clearTimeout(to);
        const stdout = Buffer.concat(stdoutChunks).toString('utf8').trim();
        const stderr = Buffer.concat(stderrChunks).toString('utf8').trim();

        if (code !== 0) {
          reject(
            new Error(
              `OCR subprocess failed (code ${code ?? 'null'}): ${stderr || stdout || 'unknown error'}`,
            ),
          );
          return;
        }

        try {
          const parsed = JSON.parse(stdout) as {
            hasText?: unknown;
            confidence?: unknown;
            cleaned?: unknown;
            cleanedLength?: unknown;
            textSnippet?: unknown;
          };
          resolve({
            hasText: Boolean(parsed.hasText),
            confidence:
              typeof parsed.confidence === 'number' &&
              Number.isFinite(parsed.confidence)
                ? parsed.confidence
                : 0,
            cleaned:
              typeof parsed.cleaned === 'string' ? parsed.cleaned : undefined,
            cleanedLength:
              typeof parsed.cleanedLength === 'number' &&
              Number.isFinite(parsed.cleanedLength)
                ? parsed.cleanedLength
                : undefined,
            textSnippet:
              typeof parsed.textSnippet === 'string'
                ? parsed.textSnippet
                : undefined,
          });
        } catch {
          reject(
            new Error(
              `Failed to parse OCR stdout as JSON: ${stdout.slice(0, 300)}`,
            ),
          );
        }
      });
    });

    return result;
  } finally {
    // Best-effort cleanup.
    try {
      await fsPromises.rm(tmpDir, { recursive: true, force: true });
    } catch {
      // ignore
    }
  }
}

async function getOcrWorker(): Promise<OcrWorker> {
  if (workerPromise) return workerPromise;

  const [{ createRequire }, path, os, fs, tesseractMod] = await Promise.all([
    import('module'),
    import('path'),
    import('os'),
    import('fs'),
    import('tesseract.js'),
  ]);

  const Tesseract =
    (tesseractMod as unknown as { default?: TesseractLike }).default ??
    (tesseractMod as unknown as TesseractLike);

  // Important: Next.js bundles server code, which can break tesseract.js defaults
  // that rely on __dirname-relative worker scripts. We pin absolute paths.
  // NOTE: `require.resolve()` can be rewritten by the Next.js RSC bundler to paths like
  // "(rsc)/./node_modules/..." which are NOT valid for Node's Worker.
  // So we build absolute on-disk paths from the project root.
  const require = createRequire(import.meta.url);
  const projectRoot = process.cwd();

  const workerPathCandidate = path.join(
    projectRoot,
    'node_modules',
    'tesseract.js',
    'src',
    'worker-script',
    'node',
    'index.js',
  );
  const corePathCandidate = path.join(
    projectRoot,
    'node_modules',
    'tesseract.js-core',
    'tesseract-core.wasm.js',
  );

  const workerPath = fs.existsSync(workerPathCandidate)
    ? workerPathCandidate
    : require.resolve('tesseract.js/src/worker-script/node/index.js');
  const corePath = fs.existsSync(corePathCandidate)
    ? corePathCandidate
    : require.resolve('tesseract.js-core/tesseract-core.wasm.js');

  // Cache downloads (traineddata) so the first run is slow only once.
  const cachePath = path.join(process.cwd(), '.next', 'cache', 'tesseract');
  try {
    fs.mkdirSync(cachePath, { recursive: true });
  } catch {
    // ignore
  }

  workerPromise = (async () => {
    const worker = await Tesseract.createWorker(
      'eng',
      Tesseract.OEM.LSTM_ONLY,
      {
        workerPath,
        corePath,
        // This CDN hosts the *gzipped* traineddata. (Non-gz 404s.)
        langPath: 'https://tessdata.projectnaptha.com/4.0.0',
        gzip: true,
        cachePath,
        workerBlobURL: false,
        dataPath: os.tmpdir(),
        logger: () => {
          // Silence very chatty progress logs in dev.
        },
      },
    );

    // Focus on simple latin letters/digits for faster + cleaner detection.
    await worker.setParameters({
      tessedit_char_whitelist:
        'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789',
      preserve_interword_spaces: '1',
      tessedit_pageseg_mode: Tesseract.PSM.SINGLE_BLOCK,
    });

    return worker;
  })().catch((err) => {
    // Allow retries after a failure.
    workerPromise = null;
    throw err;
  });

  return workerPromise;
}

type TextDetectResult = {
  hasText: boolean;
  score: number;
  edgeDensity: number;
  inkRatio: number;
  avgRunLength: number;
  shortRunRatio: number;
  longRunRatio: number;
  maxRowDarkFraction: number;
  darkBandHeight: number;
  darkBandTransitionsMean: number;
  rowRunsMax: number;
  rowRunsMean: number;
  rowTransitionsMax: number;
  rowTransitionsMean: number;
  width: number;
  height: number;
};

function decideHasTextFromOcr(result: { text: string; confidence?: number }): {
  hasText: boolean;
  cleaned: string;
  confidence: number;
} {
  const text = String(result.text ?? '');
  const cleaned = text.replace(/[^A-Za-z0-9]/g, '');
  const confidence =
    typeof result.confidence === 'number' && Number.isFinite(result.confidence)
      ? result.confidence
      : 0;

  // Heuristic: require a few alphanumeric chars and some minimal confidence.
  // Intentionally conservative to reduce false positives.
  const hasText = cleaned.length >= 3 && confidence >= 35;
  return { hasText, cleaned, confidence };
}

async function detectTextWithOcr(imageBytes: Buffer): Promise<{
  hasText: boolean;
  confidence: number;
  cleaned: string;
  textSnippet: string;
}> {
  // Prefer running OCR in a subprocess for stability (won't crash the dev server).
  const sub = await detectTextWithOcrSubprocess(imageBytes);
  return {
    hasText: sub.hasText,
    confidence: sub.confidence,
    cleaned: typeof sub.cleaned === 'string' ? sub.cleaned : '',
    textSnippet: typeof sub.textSnippet === 'string' ? sub.textSnippet : '',
  };
}

function clamp(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, n));
}

function meanAndStd(values: number[]): { mean: number; std: number } {
  if (values.length === 0) return { mean: 0, std: 0 };
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  const variance =
    values.reduce((acc, v) => acc + (v - mean) * (v - mean), 0) / values.length;
  return { mean, std: Math.sqrt(variance) };
}

async function detectTextHeuristic(
  imageBytes: Buffer,
): Promise<TextDetectResult> {
  const { data, info } = await sharp(imageBytes)
    .rotate()
    .resize({ width: 640, withoutEnlargement: true })
    .grayscale()
    .normalize()
    .raw()
    .toBuffer({ resolveWithObject: true });

  const width = info.width;
  const height = info.height;
  const channels = info.channels;

  if (!(width > 1 && height > 1) || channels < 1) {
    return {
      hasText: false,
      score: 0,
      edgeDensity: 0,
      inkRatio: 0,
      avgRunLength: 0,
      shortRunRatio: 0,
      longRunRatio: 0,
      maxRowDarkFraction: 0,
      darkBandHeight: 0,
      darkBandTransitionsMean: 0,
      rowRunsMax: 0,
      rowRunsMean: 0,
      rowTransitionsMax: 0,
      rowTransitionsMean: 0,
      width,
      height,
    };
  }

  // Build intensity array (0..255) from raw grayscale.
  const pxCount = width * height;
  const intensity = new Uint8Array(pxCount);
  for (let i = 0; i < pxCount; i++) {
    intensity[i] = data[i * channels] ?? 0;
  }

  // Global stats
  let sum = 0;
  for (let i = 0; i < pxCount; i++) sum += intensity[i];
  const mean = sum / pxCount;
  let varSum = 0;
  for (let i = 0; i < pxCount; i++) {
    const d = intensity[i] - mean;
    varSum += d * d;
  }
  const std = Math.sqrt(varSum / pxCount);

  // Simple binarization threshold.
  const threshold = clamp(mean - std * 0.15, 0, 255);

  // "Ink" runs (contiguous dark segments) in binarized image.
  // Text tends to create many short runs rather than a few long blobs.
  const rowRuns: number[] = new Array(height).fill(0);
  const rowDarkFraction: number[] = new Array(height).fill(0);
  let darkPixels = 0;
  let darkRuns = 0;
  let shortRuns = 0;
  let longRuns = 0;
  for (let y = 0; y < height; y++) {
    let inRun = false;
    let runLen = 0;
    let darkInRow = 0;
    for (let x = 0; x < width; x++) {
      const isDark = intensity[y * width + x] < threshold;
      if (isDark) {
        darkPixels++;
        darkInRow++;
        if (!inRun) {
          inRun = true;
          darkRuns++;
          rowRuns[y]++;
          runLen = 1;
        } else {
          runLen++;
        }
      } else {
        if (inRun) {
          if (runLen <= 3) shortRuns++;
          if (runLen >= 18) longRuns++;
        }
        inRun = false;
        runLen = 0;
      }
    }

    if (inRun) {
      if (runLen <= 3) shortRuns++;
      if (runLen >= 18) longRuns++;
    }

    rowDarkFraction[y] = darkInRow / width;
  }

  const inkRatio = darkPixels / pxCount;
  const avgRunLength = darkRuns > 0 ? darkPixels / darkRuns : 0;
  const shortRunRatio = darkRuns > 0 ? shortRuns / darkRuns : 0;
  const longRunRatio = darkRuns > 0 ? longRuns / darkRuns : 0;
  const { mean: rowRunsMean } = meanAndStd(rowRuns);
  const rowRunsMax = rowRuns.reduce((m, v) => (v > m ? v : m), 0);

  const maxRowDarkFraction = rowDarkFraction.reduce(
    (m, v) => (v > m ? v : m),
    0,
  );

  // Row transitions in binarized image.
  const rowTransitions: number[] = new Array(height).fill(0);
  for (let y = 0; y < height; y++) {
    let transitions = 0;
    let prev = intensity[y * width] < threshold;
    for (let x = 1; x < width; x++) {
      const cur = intensity[y * width + x] < threshold;
      if (cur !== prev) transitions++;
      prev = cur;
    }
    rowTransitions[y] = transitions;
  }

  const { mean: rowTransitionsMean } = meanAndStd(rowTransitions);
  const rowTransitionsMax = rowTransitions.reduce((m, v) => (v > m ? v : m), 0);

  // Detect a "subtitle bar" / dense horizontal dark band.
  // We look for a long consecutive run of rows with high dark fraction.
  const bandThreshold = 0.72;
  let bestBand = 0;
  let bestBandStart = 0;
  let currentBand = 0;
  let currentStart = 0;
  for (let y = 0; y < height; y++) {
    if (rowDarkFraction[y] >= bandThreshold) {
      if (currentBand === 0) currentStart = y;
      currentBand++;
      if (currentBand > bestBand) {
        bestBand = currentBand;
        bestBandStart = currentStart;
      }
    } else {
      currentBand = 0;
    }
  }

  let darkBandTransitionsMean = 0;
  if (bestBand > 0) {
    let tSum = 0;
    for (let y = bestBandStart; y < bestBandStart + bestBand; y++) {
      tSum += rowTransitions[y] ?? 0;
    }
    darkBandTransitionsMean = tSum / bestBand;
  }

  // Edge density via a very cheap gradient approximation.
  let edgeCount = 0;
  const edgeThreshold = clamp(40 + std * 0.25, 25, 85);
  for (let y = 1; y < height - 1; y++) {
    const row = y * width;
    const rowUp = (y - 1) * width;
    const rowDn = (y + 1) * width;
    for (let x = 1; x < width - 1; x++) {
      const idx = row + x;
      const gx = Math.abs(intensity[idx + 1] - intensity[idx - 1]);
      const gy = Math.abs(intensity[rowDn + x] - intensity[rowUp + x]);
      if (gx + gy > edgeThreshold) edgeCount++;
    }
  }

  const edgeDensity = edgeCount / pxCount;

  // Score heuristic: prioritize run/transitions (more text-specific) and
  // use edge density only as a weak signal.
  const edgeComponent = clamp(edgeDensity * 900, 0, 100);
  const transitionComponent = clamp((rowTransitionsMax / width) * 160, 0, 100);
  const runComponent = clamp((rowRunsMax / width) * 2400, 0, 100);
  const score =
    0.15 * edgeComponent + 0.45 * transitionComponent + 0.4 * runComponent;

  // Decision
  // Path A: subtitle-bar style overlays (dark band + text-like transitions inside band)
  const hasSubtitleBarText =
    bestBand >= Math.max(10, Math.floor(height * 0.04)) &&
    maxRowDarkFraction >= 0.9 &&
    inkRatio >= 0.45 &&
    shortRunRatio >= 0.35 &&
    // For caption bars, transitions inside the band can be low depending on thresholding,
    // so we rely more on the overall max transitions + the presence of a strong band.
    rowTransitionsMax >= Math.max(36, Math.floor(width * 0.055));

  // Path B: normal overlay text without a big bar.
  // Tighten with run-length ratios to reduce false positives on detailed images.
  const hasGeneralText =
    score >= 42 &&
    inkRatio >= 0.003 &&
    // Keep this low to avoid false positives on non-text images with lots of edges.
    inkRatio <= 0.16 &&
    avgRunLength >= 1.2 &&
    avgRunLength <= 14 &&
    shortRunRatio >= 0.22 &&
    longRunRatio <= 0.28 &&
    rowRunsMax >= Math.max(10, Math.floor(width * 0.016)) &&
    rowTransitionsMax >= Math.max(26, Math.floor(width * 0.06));

  const hasText = hasSubtitleBarText || hasGeneralText;

  return {
    hasText,
    score: Math.round(score * 10) / 10,
    edgeDensity: Math.round(edgeDensity * 10000) / 10000,
    inkRatio: Math.round(inkRatio * 10000) / 10000,
    avgRunLength: Math.round(avgRunLength * 10) / 10,
    shortRunRatio: Math.round(shortRunRatio * 10000) / 10000,
    longRunRatio: Math.round(longRunRatio * 10000) / 10000,
    maxRowDarkFraction: Math.round(maxRowDarkFraction * 10000) / 10000,
    darkBandHeight: bestBand,
    darkBandTransitionsMean: Math.round(darkBandTransitionsMean * 10) / 10,
    rowRunsMax,
    rowRunsMean: Math.round(rowRunsMean * 10) / 10,
    rowTransitionsMax,
    rowTransitionsMean: Math.round(rowTransitionsMean * 10) / 10,
    width,
    height,
  };
}

export async function POST(req: NextRequest) {
  try {
    const contentType = String(req.headers.get('content-type') ?? '')
      .trim()
      .toLowerCase();

    // Safety: avoid huge payloads.
    const maxBytes = 10 * 1024 * 1024; // 10MB

    let bytes: Buffer | null = null;

    if (contentType.includes('multipart/form-data')) {
      const form = await req.formData();
      const file = form.get('image');

      if (!file || !(file instanceof File)) {
        return NextResponse.json(
          { error: 'Missing image file (multipart field: image)' },
          { status: 400 },
        );
      }

      if (file.size > maxBytes) {
        return NextResponse.json(
          { error: `Image too large (max ${maxBytes} bytes)` },
          { status: 413 },
        );
      }

      bytes = Buffer.from(await file.arrayBuffer());
    } else if (contentType.includes('application/json')) {
      const body = (await req.json().catch(() => null)) as {
        imageUrl?: unknown;
      } | null;

      const imageUrl =
        typeof body?.imageUrl === 'string' ? body.imageUrl.trim() : '';

      if (!imageUrl) {
        return NextResponse.json(
          { error: 'imageUrl is required (JSON body)' },
          { status: 400 },
        );
      }

      if (
        !(imageUrl.startsWith('http://') || imageUrl.startsWith('https://'))
      ) {
        return NextResponse.json(
          { error: 'imageUrl must be an http(s) URL' },
          { status: 400 },
        );
      }

      const res = await fetch(imageUrl);
      if (!res.ok) {
        const t = await res.text().catch(() => '');
        return NextResponse.json(
          { error: `Failed to fetch image (${res.status}) ${t}` },
          { status: 400 },
        );
      }

      const ab = await res.arrayBuffer();
      if (ab.byteLength > maxBytes) {
        return NextResponse.json(
          { error: `Image too large (max ${maxBytes} bytes)` },
          { status: 413 },
        );
      }

      bytes = Buffer.from(ab);
    } else {
      return NextResponse.json(
        {
          error:
            'Unsupported Content-Type. Use multipart/form-data with field "image" or JSON { imageUrl }.',
        },
        { status: 415 },
      );
    }

    if (!bytes) {
      return NextResponse.json(
        { error: 'Missing image bytes' },
        { status: 400 },
      );
    }

    const wantsAccurate =
      isTruthyQueryParam(req, 'accurate') ||
      isTruthyQueryParam(req, 'preferOcr') ||
      isTruthyQueryParam(req, 'preferVision');

    // Highest-accuracy path: vision model (stable under Node 22).
    // IMPORTANT: In accurate mode we do NOT use the heuristic detector for decisions.
    if (wantsAccurate && isVisionEnabled()) {
      try {
        const vision = await detectTextWithVisionLLM(bytes);

        // Server-side policy:
        // - ignore punctuation-only (require some alphanumeric characters)
        // - optionally ignore very large fonts (e.g., big “?” overlays)
        // Clamp to avoid surprising behavior (e.g. empty env var -> 0 would ignore everything).
        const minAlnum = Math.max(
          1,
          Math.floor(getNumericEnv('TEXT_DETECT_MIN_ALNUM', 2)),
        );
        // We now use maxFontPct as the cutoff for what counts as "small" text.
        // Back-compat: if TEXT_DETECT_MAX_FONT_PCT was already set, it will still work.
        const maxFontPct = clampNumber(
          getNumericEnv(
            'TEXT_DETECT_SMALL_MAX_FONT_PCT',
            getNumericEnv('TEXT_DETECT_MAX_FONT_PCT', 12),
          ),
          1,
          100,
        );
        // Prefer per-element sizing if the model returned it.
        const elements = Array.isArray(vision.elements) ? vision.elements : [];

        const meaningfulElements = elements
          .map((e) => {
            const cleanedEl = normalizeAlnumText(e.text);
            return {
              ...e,
              cleaned: cleanedEl,
              cleanedLength: cleanedEl.length,
            };
          })
          .filter((e) => e.cleanedLength >= minAlnum);

        const smallestMeaningfulTextHeightPct =
          meaningfulElements.length > 0
            ? Math.min(...meaningfulElements.map((e) => e.heightPct))
            : undefined;

        // Fallback: if the model didn't return elements, use the short combined text.
        const cleaned = normalizeAlnumText(vision.rawText ?? '');
        const cleanedLength = cleaned.length;

        const hasMeaningfulText =
          meaningfulElements.length > 0 || cleanedLength >= minAlnum;

        // Small-text policy (requested):
        // hasText=true ONLY if there exists meaningful text AND the smallest relevant text size
        // is <= maxFontPct.
        // This is used to *skip* images where small text would get mangled in video generation.
        const smallestRelevantTextHeightPct =
          typeof smallestMeaningfulTextHeightPct === 'number'
            ? smallestMeaningfulTextHeightPct
            : cleanedLength >= minAlnum
              ? (vision.smallestTextHeightPct ?? undefined)
              : undefined;

        const hasSmallText =
          typeof smallestRelevantTextHeightPct === 'number'
            ? smallestRelevantTextHeightPct <= maxFontPct
            : false;

        const rejectedBecauseTextTooLarge = hasMeaningfulText && !hasSmallText;

        const isPunctuationOnly =
          meaningfulElements.length === 0 && cleanedLength === 0;

        const hasText = !isPunctuationOnly && hasMeaningfulText && hasSmallText;

        if (shouldLogDebug(req)) {
          console.log('[detect-text-in-image] vision result', {
            wantsAccurate,
            method: 'vision',
            modelHasText: vision.modelHasText,
            modelConfidence: Math.round(vision.modelConfidence * 100),
            rawText: vision.rawText ?? '',
            cleaned,
            cleanedLength,
            largestTextHeightPct: vision.largestTextHeightPct ?? null,
            smallestTextHeightPct: vision.smallestTextHeightPct ?? null,
            smallestMeaningfulTextHeightPct:
              smallestMeaningfulTextHeightPct ?? null,
            thresholds: {
              minAlnum,
              maxFontPct,
            },
            smallestRelevantTextHeightPct:
              smallestRelevantTextHeightPct ?? null,
            hasSmallText,
            ignoredBecauseLargeFont: rejectedBecauseTextTooLarge,
            finalHasText: hasText,
            reason: vision.reason ?? '',
            elementsPreview: meaningfulElements.slice(0, 6).map((e) => ({
              text: e.text,
              // Alias for readability: "fontPct" means text height as % of image height.
              fontPct: e.heightPct,
              heightPct: e.heightPct,
              cleanedLength: e.cleanedLength,
              maxFontPct,
              passesFontSize: e.heightPct <= maxFontPct,
            })),
          });
        }

        const debug = isTruthyQueryParam(req, 'debug');
        return NextResponse.json({
          hasText,
          method: 'vision',
          confidence: Math.round(vision.modelConfidence * 100),
          reason: vision.reason,
          thresholds: {
            minAlnum,
            maxFontPct,
          },
          cleanedLength,
          largestTextHeightPct: vision.largestTextHeightPct ?? null,
          smallestTextHeightPct: vision.smallestTextHeightPct ?? null,
          smallestMeaningfulTextHeightPct:
            smallestMeaningfulTextHeightPct ?? null,
          smallestRelevantTextHeightPct: smallestRelevantTextHeightPct ?? null,
          hasSmallText,
          ignoredBecauseLargeFont: rejectedBecauseTextTooLarge,
          // Keep this short to avoid leaking long strings into logs/UI.
          textSnippet: cleaned.slice(0, 140),
          // Expose element sizes so the client can debug font size behavior.
          elements:
            meaningfulElements.length > 0
              ? meaningfulElements.slice(0, 6).map((e) => ({
                  text: e.text.slice(0, 160),
                  fontPct: e.heightPct,
                  heightPct: e.heightPct,
                  cleanedLength: e.cleanedLength,
                  passesFontSize: e.heightPct <= maxFontPct,
                }))
              : undefined,
          ...(debug ? { note: 'debug=1 enabled' } : null),
        });
      } catch (visionError) {
        console.warn(
          '[detect-text-in-image] Vision failed; falling back:',
          visionError,
        );
        // In accurate mode we do NOT fall back to the heuristic detector.
      }
    }

    // Accurate mode requested, but vision is unavailable/disabled.
    // We can optionally fall back to OCR if explicitly enabled.
    if (wantsAccurate && !isVisionEnabled()) {
      if (isOcrEnabled()) {
        try {
          const ocr = await detectTextWithOcr(bytes);
          const debug = isTruthyQueryParam(req, 'debug');
          return NextResponse.json({
            hasText: ocr.hasText,
            method: 'ocr',
            confidence: ocr.confidence,
            cleanedLength: ocr.cleaned.length,
            textSnippet: ocr.textSnippet,
            ...(debug ? { note: 'debug=1 enabled' } : null),
          });
        } catch (ocrError) {
          console.warn(
            '[detect-text-in-image] OCR failed in accurate mode:',
            ocrError,
          );
          return NextResponse.json(
            {
              error:
                ocrError instanceof Error ? ocrError.message : String(ocrError),
            },
            { status: 502 },
          );
        }
      }

      return NextResponse.json(
        {
          error:
            'Accurate text detection requested but vision is disabled. Set OPENROUTER_API_KEY and ENABLE_VISION_TEXT_DETECT=1 (or enable OCR).',
        },
        { status: 503 },
      );
    }

    // Non-accurate path: fast heuristic (optionally followed by OCR for ambiguous cases).
    const heuristic = await detectTextHeuristic(bytes);

    // Hybrid: use OCR for ambiguous cases (or when explicitly requested), but
    // keep heuristic as a fast default + always provide a fallback.
    if (isOcrEnabled() && shouldAttemptOcr(req, heuristic)) {
      try {
        const ocr = await detectTextWithOcr(bytes);
        const debug = isTruthyQueryParam(req, 'debug');
        return NextResponse.json({
          hasText: ocr.hasText,
          method: 'ocr',
          confidence: ocr.confidence,
          cleanedLength: ocr.cleaned.length,
          textSnippet: ocr.textSnippet,
          ...(debug
            ? {
                heuristic,
              }
            : null),
        });
      } catch (ocrError) {
        console.warn(
          '[detect-text-in-image] OCR failed; falling back:',
          ocrError,
        );
        return NextResponse.json({
          method: 'heuristic',
          ...heuristic,
          ocrError:
            ocrError instanceof Error ? ocrError.message : String(ocrError),
        });
      }
    }

    return NextResponse.json({
      method: 'heuristic',
      ...heuristic,
    });
  } catch (error) {
    console.error('[detect-text-in-image] error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 },
    );
  }
}
