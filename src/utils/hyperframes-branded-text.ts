import { createHash } from 'crypto';
import { execFile } from 'child_process';
import { access, mkdir, stat } from 'fs/promises';
import path from 'path';
import { promisify } from 'util';
import {
  BRANDED_TEXT_MAX_DURATION,
  BRANDED_TEXT_MIN_DURATION,
} from '@/lib/branded-text-template';

const execFileAsync = promisify(execFile);
const HYPERFRAMES_VERSION = '0.7.63';
const TEMPLATE_VERSION = 'javascript-king-branded-text-v1';
const renderPromises = new Map<string, Promise<string>>();

export type BrandedTextRenderOptions = {
  text: string;
  duration: number;
  fps: 24 | 30 | 60;
  quality: 'draft' | 'standard';
};

async function isUsableFile(filePath: string) {
  try {
    await access(filePath);
    return (await stat(filePath)).size > 0;
  } catch {
    return false;
  }
}

function renderOnce(cacheKey: string, render: () => Promise<string>) {
  const existing = renderPromises.get(cacheKey);
  if (existing) return existing;

  const promise = render().finally(() => renderPromises.delete(cacheKey));
  renderPromises.set(cacheKey, promise);
  return promise;
}

function getRenderErrorMessage(error: unknown) {
  if (!error || typeof error !== 'object') return 'HyperFrames render failed';

  const renderError = error as {
    message?: unknown;
    stderr?: unknown;
    stdout?: unknown;
  };
  const output = [renderError.stderr, renderError.stdout]
    .filter((value): value is string => typeof value === 'string')
    .join('\n')
    .replace(/\u001b\[[0-9;?]*[ -/]*[@-~]/g, '')
    .trim();

  if (output) {
    const usefulLines = output
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean)
      .slice(-6);
    return usefulLines.join(' ');
  }

  return typeof renderError.message === 'string'
    ? renderError.message
    : 'HyperFrames render failed';
}

export function normalizeBrandedTextDuration(duration: number) {
  return Math.max(
    BRANDED_TEXT_MIN_DURATION,
    Math.min(BRANDED_TEXT_MAX_DURATION, duration),
  );
}

export async function renderBrandedTextOverlay({
  text,
  duration,
  fps,
  quality,
}: BrandedTextRenderOptions) {
  const normalizedText = text.trim().toUpperCase().slice(0, 80);
  if (!normalizedText) throw new Error('Branded text is required');

  const normalizedDuration = normalizeBrandedTextDuration(duration);
  const projectRoot = path.resolve(
    process.cwd(),
    'videos/javascript-king-merge-overlays',
  );
  const cacheRoot = path.resolve(
    '/tmp',
    'ultimate-video-editr-hyperframes',
    TEMPLATE_VERSION,
  );
  await mkdir(cacheRoot, { recursive: true });

  const cacheKey = createHash('sha256')
    .update(
      JSON.stringify({
        template: TEMPLATE_VERSION,
        text: normalizedText,
        duration: normalizedDuration,
        fps,
        quality,
      }),
    )
    .digest('hex')
    .slice(0, 24);
  const outputPath = path.join(cacheRoot, `${cacheKey}.webm`);

  if (await isUsableFile(outputPath)) return outputPath;

  return renderOnce(cacheKey, async () => {
    if (await isUsableFile(outputPath)) return outputPath;

    try {
      await execFileAsync(
        'npx',
        [
          '--yes',
          `hyperframes@${HYPERFRAMES_VERSION}`,
          'render',
          '.',
          '-c',
          'compositions/branded-text.html',
          '-o',
          outputPath,
          '--format',
          'webm',
          '--fps',
          String(fps),
          '--quality',
          quality,
          '--workers',
          '2',
          '--strict',
          '--strict-variables',
          '--variables',
          JSON.stringify({
            title: normalizedText,
            duration: normalizedDuration,
          }),
          '--skill',
          'motion-graphics',
        ],
        {
          cwd: projectRoot,
          timeout: 10 * 60 * 1000,
          maxBuffer: 20 * 1024 * 1024,
        },
      );
    } catch (error) {
      throw new Error(getRenderErrorMessage(error));
    }

    if (!(await isUsableFile(outputPath))) {
      throw new Error('HyperFrames did not create the branded text overlay');
    }
    return outputPath;
  });
}
