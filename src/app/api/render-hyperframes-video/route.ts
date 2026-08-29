import { createHash } from 'crypto';
import { execFile } from 'child_process';
import { mkdtemp, mkdir, rm, stat, writeFile } from 'fs/promises';
import os from 'os';
import path from 'path';
import { promisify } from 'util';
import { NextResponse } from 'next/server';
import { getBaserowToken, buildAuthHeader } from '@/lib/baserow-auth';
import { ensureMinioRunning } from '@/lib/minio-runtime';
import { validateHyperFramesHtml } from '@/lib/hyperframes-html-validation';
import { uploadToMinio } from '@/utils/ffmpeg-cfr';

export const runtime = 'nodejs';

type BaserowRow = {
  id: number;
  [key: string]: unknown;
};

const execFileAsync = promisify(execFile);
const SCENES_TABLE_ID = 714;
const HYPERFRAMES_HTML_FIELD_KEY = 'field_7367';
const HYPERFRAMES_VIDEO_FIELD_KEY = 'field_7368';
const HYPERFRAMES_VERSION = '0.7.63';
const RENDER_TIMEOUT_MS = 10 * 60 * 1000;
const GSAP_SCRIPT_TAG =
  '<script src="https://cdn.jsdelivr.net/npm/gsap@3/dist/gsap.min.js"></script>';

function getStringField(source: Record<string, unknown>, key: string): string {
  const value = source[key];
  return typeof value === 'string' ? value.trim() : '';
}

function ensureGsapScript(html: string): string {
  if (/<script[^>]+src=["'][^"']*gsap[^"']*["'][^>]*>/i.test(html)) {
    return html;
  }

  if (/<\/head>/i.test(html)) {
    return html.replace(/<\/head>/i, `${GSAP_SCRIPT_TAG}\n</head>`);
  }

  return `${GSAP_SCRIPT_TAG}\n${html}`;
}

function getHyperFrames4KResolution(html: string):
  | 'landscape-4k'
  | 'portrait-4k'
  | 'square-4k' {
  const width = Number(
    html.match(/data-width=["'](\d+(?:\.\d+)?)["']/i)?.[1],
  );
  const height = Number(
    html.match(/data-height=["'](\d+(?:\.\d+)?)["']/i)?.[1],
  );

  if (
    Number.isFinite(width) &&
    Number.isFinite(height) &&
    width > 0 &&
    height > 0
  ) {
    if (width === height) return 'square-4k';
    return width > height ? 'landscape-4k' : 'portrait-4k';
  }

  return 'landscape-4k';
}

function getRenderErrorMessage(error: unknown): string {
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
    return output
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean)
      .slice(-6)
      .join(' ');
  }

  return typeof renderError.message === 'string'
    ? renderError.message
    : 'HyperFrames render failed';
}

async function getScene(sceneId: number): Promise<BaserowRow> {
  const baserowUrl = process.env.BASEROW_API_URL?.replace(/\/+$/, '');
  if (!baserowUrl) throw new Error('Missing Baserow URL');

  const token = await getBaserowToken();
  const response = await fetch(
    `${baserowUrl}/database/rows/table/${SCENES_TABLE_ID}/${sceneId}/`,
    {
      method: 'GET',
      headers: { ...buildAuthHeader(token) },
      cache: 'no-store',
    },
  );

  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new Error(`Baserow GET failed: ${response.status} ${text}`);
  }

  return (await response.json()) as BaserowRow;
}

async function saveVideoUrl(sceneId: number, videoUrl: string) {
  const baserowUrl = process.env.BASEROW_API_URL?.replace(/\/+$/, '');
  if (!baserowUrl) throw new Error('Missing Baserow URL');

  const token = await getBaserowToken();
  const response = await fetch(
    `${baserowUrl}/database/rows/table/${SCENES_TABLE_ID}/${sceneId}/`,
    {
      method: 'PATCH',
      headers: {
        ...buildAuthHeader(token),
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ [HYPERFRAMES_VIDEO_FIELD_KEY]: videoUrl }),
    },
  );

  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new Error(`Baserow PATCH failed: ${response.status} ${text}`);
  }
}

export async function POST(request: Request) {
  let temporaryProjectRoot: string | null = null;

  try {
    const body = (await request.json().catch(() => null)) as {
      sceneId?: unknown;
      skipIfDestinationExists?: unknown;
    } | null;
    const sceneId = Number(body?.sceneId);

    if (!Number.isFinite(sceneId) || sceneId <= 0) {
      return NextResponse.json(
        { error: 'Scene ID is required' },
        { status: 400 },
      );
    }

    const scene = await getScene(sceneId);
    if (
      body?.skipIfDestinationExists === true &&
      getStringField(scene, HYPERFRAMES_VIDEO_FIELD_KEY)
    ) {
      return NextResponse.json({
        skipped: true,
        videoFieldKey: HYPERFRAMES_VIDEO_FIELD_KEY,
      });
    }
    const sourceHtml = getStringField(scene, HYPERFRAMES_HTML_FIELD_KEY);
    if (!sourceHtml) {
      return NextResponse.json(
        {
          error:
            'HyperFrames HTML is empty. Generate or edit the HTML before rendering.',
        },
        { status: 400 },
      );
    }

    // Keep the saved draft unchanged while making older drafts renderable when
    // they already use GSAP but forgot to load the library.
    const renderHtml = ensureGsapScript(sourceHtml);
    const validationIssues = validateHyperFramesHtml(renderHtml);
    if (validationIssues.length > 0) {
      return NextResponse.json(
        {
          error: `HyperFrames HTML is not renderable: ${validationIssues.join('; ')}. Generate the HTML again using the HF HTML button.`,
          validationIssues,
        },
        { status: 422 },
      );
    }

    await ensureMinioRunning();

    temporaryProjectRoot = await mkdtemp(
      path.join(os.tmpdir(), 'ultimate-video-editr-hyperframes-scene-'),
    );
    const compositionDirectory = path.join(temporaryProjectRoot, 'compositions');
    await mkdir(compositionDirectory, { recursive: true });
    await writeFile(path.join(compositionDirectory, 'scene.html'), renderHtml, 'utf8');
    await writeFile(path.join(temporaryProjectRoot, 'index.html'), renderHtml, 'utf8');
    await writeFile(
      path.join(temporaryProjectRoot, 'hyperframes.json'),
      JSON.stringify({
        $schema: 'https://hyperframes.heygen.com/schema/hyperframes.json',
        paths: { blocks: 'compositions', components: 'compositions/components', assets: 'assets' },
      }),
      'utf8',
    );

    const outputPath = path.join(temporaryProjectRoot, 'scene.mp4');
    const outputResolution = getHyperFrames4KResolution(renderHtml);
    await execFileAsync(
      'npx',
      [
        '--yes',
        `hyperframes@${HYPERFRAMES_VERSION}`,
        'render',
        '.',
        '-c',
        'compositions/scene.html',
        '-o',
        outputPath,
        '--format',
        'mp4',
        '--quality',
        'standard',
        '--resolution',
        outputResolution,
        '--workers',
        '2',
        '--strict',
      ],
      {
        cwd: temporaryProjectRoot,
        timeout: RENDER_TIMEOUT_MS,
        maxBuffer: 20 * 1024 * 1024,
      },
    );

    const outputStats = await stat(outputPath).catch(() => null);
    if (!outputStats || outputStats.size <= 0) {
      throw new Error('HyperFrames did not create a video file');
    }

    const htmlHash = createHash('sha1').update(renderHtml).digest('hex').slice(0, 12);
    const filename = `hyperframes_scene_${sceneId}_${htmlHash}_${Date.now()}.mp4`;
    const videoUrl = await uploadToMinio(outputPath, filename, 'video/mp4');
    await saveVideoUrl(sceneId, videoUrl);

    return NextResponse.json({
      videoUrl,
      videoFieldKey: HYPERFRAMES_VIDEO_FIELD_KEY,
      filename,
    });
  } catch (error) {
    console.error('Error rendering/uploading HyperFrames video:', error);
    return NextResponse.json(
      {
        error: getRenderErrorMessage(error),
      },
      { status: 500 },
    );
  } finally {
    if (temporaryProjectRoot) {
      await rm(temporaryProjectRoot, { recursive: true, force: true }).catch(
        () => undefined,
      );
    }
  }
}
