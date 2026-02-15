#!/usr/bin/env node

/**
 * OCR runner (isolated process)
 *
 * Why: tesseract.js can occasionally crash/hang when invoked inside a Next.js
 * dev server process (Worker threads + bundling quirks). Running OCR in a
 * subprocess keeps the dev server stable while improving accuracy.
 *
 * Usage:
 *   node scripts/ocr-runner.cjs --image /path/to/image.png
 *
 * Output:
 *   Writes a single JSON object to stdout.
 */

const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

function parseArgs(argv) {
  const out = {};
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) continue;
    const key = a.slice(2);
    const next = argv[i + 1];
    if (next && !next.startsWith('--')) {
      out[key] = next;
      i++;
    } else {
      out[key] = true;
    }
  }
  return out;
}

function decideHasText({ text, confidence }) {
  const raw = String(text ?? '');
  const cleaned = raw.replace(/[^A-Za-z0-9]/g, '');
  const conf = Number.isFinite(confidence) ? confidence : 0;

  // Detection-focused thresholds:
  // - accept a couple of characters if confidence is decent
  // - accept more characters even with lower confidence
  const hasText =
    (cleaned.length >= 2 && conf >= 45) || (cleaned.length >= 4 && conf >= 25);

  return {
    hasText,
    cleaned,
    cleanedLength: cleaned.length,
    confidence: conf,
    textSnippet: raw.trim().slice(0, 140),
  };
}

async function main() {
  const args = parseArgs(process.argv);
  const imagePath = args.image;

  if (!imagePath || typeof imagePath !== 'string') {
    console.error('Missing --image');
    process.exit(2);
  }

  if (!fs.existsSync(imagePath)) {
    console.error(`Image file not found: ${imagePath}`);
    process.exit(2);
  }

  // Lazy require to avoid startup cost when OCR is unused.
  const Tesseract = require('tesseract.js');

  const workerPath =
    require.resolve('tesseract.js/src/worker-script/node/index.js');
  // IMPORTANT: corePath should be a *directory* containing the various core builds
  // (simd, lstm, etc). Pointing to a single file can crash or degrade accuracy.
  const corePath = path.dirname(
    require.resolve('tesseract.js-core/package.json'),
  );

  const cachePath = path.join(process.cwd(), '.next', 'cache', 'tesseract');
  try {
    fs.mkdirSync(cachePath, { recursive: true });
  } catch {
    // ignore
  }

  const dataPath = os.tmpdir();

  const worker = await Tesseract.createWorker('eng', Tesseract.OEM.LSTM_ONLY, {
    workerPath,
    corePath,
    // Use the best model for accuracy; it is slower but more reliable.
    langPath:
      process.env.TESSDATA_LANG_PATH ||
      'https://tessdata.projectnaptha.com/4.0.0_best',
    gzip: true,
    cachePath,
    workerBlobURL: false,
    dataPath,
    logger: () => {},
    // Prevent worker rejection messages from becoming uncaught exceptions.
    // We'll handle promise failures ourselves.
    errorHandler: () => {},
  });

  try {
    // A reasonable default for captions/overlays.
    // (We don't set a strict whitelist; we only *post-filter* to alphanumerics.)
    await worker.setParameters({
      preserve_interword_spaces: '1',
      tessedit_pageseg_mode: Tesseract.PSM.SINGLE_BLOCK,
    });

    const image = fs.readFileSync(imagePath);
    const { data } = await worker.recognize(image);

    const result = decideHasText({
      text: data && typeof data.text === 'string' ? data.text : '',
      confidence:
        data && typeof data.confidence === 'number' ? data.confidence : 0,
    });

    process.stdout.write(
      JSON.stringify({
        method: 'ocr',
        ...result,
      }),
    );
  } finally {
    try {
      await worker.terminate();
    } catch {
      // ignore
    }
  }
}

main().catch((err) => {
  console.error(err && err.stack ? err.stack : String(err));
  process.exit(1);
});
