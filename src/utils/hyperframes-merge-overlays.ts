import { createHash } from 'crypto';
import { execFile } from 'child_process';
import { access, mkdir } from 'fs/promises';
import path from 'path';
import { promisify } from 'util';

const execFileAsync = promisify(execFile);
const HYPERFRAMES_VERSION = '0.7.60';
const DESIGN_VERSION = 'javascript-king-tech-v1';
const TITLE_DURATION_SECONDS = 3.2;
const renderPromises = new Map<string, Promise<string>>();

export type HyperFramesMergeOverlays = {
  transitionPath: string;
  titlePaths: string[];
  titleDuration: number;
};

async function fileExists(filePath: string) {
  try {
    await access(filePath);
    return true;
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

async function renderTitleOverlay(
  projectRoot: string,
  outputPath: string,
  title: string,
) {
  if (await fileExists(outputPath)) return outputPath;

  await execFileAsync(
    'npx',
    [
      '--yes',
      `hyperframes@${HYPERFRAMES_VERSION}`,
      'render',
      '.',
      '-c',
      'compositions/lower-third.html',
      '-o',
      outputPath,
      '--format',
      'webm',
      '--fps',
      '30',
      '--quality',
      'standard',
      '--workers',
      '2',
      '--strict',
      '--strict-variables',
      '--variables',
      JSON.stringify({ title }),
      '--skill',
      'motion-graphics',
    ],
    {
      cwd: projectRoot,
      timeout: 10 * 60 * 1000,
      maxBuffer: 20 * 1024 * 1024,
    },
  );

  await access(outputPath);
  return outputPath;
}

/**
 * Resolve the native-4K transparent HyperFrames assets used by the merge pipeline.
 * The transition is pre-rendered; editable lower thirds are rendered once per title
 * and cached outside the repository for subsequent merges.
 */
export async function prepareHyperFramesMergeOverlays(
  titles: string[],
): Promise<HyperFramesMergeOverlays> {
  const projectRoot = path.resolve(
    process.cwd(),
    'videos/javascript-king-merge-overlays',
  );
  const transitionPath = path.join(projectRoot, 'renders', 'transition.webm');
  await access(transitionPath);

  const cacheRoot = path.resolve(
    '/tmp',
    'ultimate-video-editr-hyperframes',
    DESIGN_VERSION,
  );
  await mkdir(cacheRoot, { recursive: true });

  const titlePaths: string[] = [];
  for (const rawTitle of titles) {
    const title = rawTitle.trim().toUpperCase() || 'UNTITLED';
    const titleHash = createHash('sha256')
      .update(`${DESIGN_VERSION}:${title}`)
      .digest('hex')
      .slice(0, 20);
    const outputPath = path.join(cacheRoot, `lower-third-${titleHash}.webm`);
    titlePaths.push(
      await renderOnce(outputPath, () =>
        renderTitleOverlay(projectRoot, outputPath, title),
      ),
    );
  }

  return {
    transitionPath,
    titlePaths,
    titleDuration: TITLE_DURATION_SECONDS,
  };
}
