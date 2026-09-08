import { execFile } from 'child_process';
import { copyFile, mkdir, readFile, writeFile } from 'fs/promises';
import net from 'net';
import os from 'os';
import path from 'path';
import { promisify } from 'util';

import { buildAuthHeader, getBaserowToken } from '@/lib/baserow-auth';
import {
  normalizeHyperFramesTimingAttributes,
  validateHyperFramesHtml,
} from '@/lib/hyperframes-html-validation';
import { listSoundEffects } from '@/lib/sound-effects-storage';
import { validateSoundEffectCues } from '@/utils/hyperframes-sound-effects';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type BaserowRow = { id: number; [key: string]: unknown };
type EditorSession = { projectDirectory: string; port: number };

const execFileAsync = promisify(execFile);
const SCENES_TABLE_ID = 714;
const HYPERFRAMES_HTML_FIELD_KEY = 'field_7367';
// Studio's managed background-preview JSON contract is available in 0.8.x.
// Saved compositions remain plain HyperFrames HTML and are validated again by
// the existing pinned render route before rendering.
const HYPERFRAMES_VERSION = '0.8.30';
const sessions = new Map<number, EditorSession>();

function getProjectDirectory(sceneId: number) {
  return path.join(
    os.tmpdir(),
    'ultimate-video-editr-hyperframes-editor',
    `scene-${sceneId}`,
  );
}

async function getScene(sceneId: number): Promise<BaserowRow> {
  const baserowUrl = process.env.BASEROW_API_URL?.replace(/\/+$/, '');
  if (!baserowUrl) throw new Error('Missing Baserow URL');
  const token = await getBaserowToken();
  const response = await fetch(
    `${baserowUrl}/database/rows/table/${SCENES_TABLE_ID}/${sceneId}/`,
    {
      headers: buildAuthHeader(token),
      cache: 'no-store',
    },
  );
  if (!response.ok) {
    const detail = await response.text().catch(() => '');
    throw new Error(`Baserow GET failed: ${response.status} ${detail}`);
  }
  return (await response.json()) as BaserowRow;
}

async function saveSceneHtml(sceneId: number, html: string) {
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
      body: JSON.stringify({ [HYPERFRAMES_HTML_FIELD_KEY]: html }),
    },
  );
  if (!response.ok) {
    const detail = await response.text().catch(() => '');
    throw new Error(`Baserow PATCH failed: ${response.status} ${detail}`);
  }
}

async function getFreePort(): Promise<number> {
  return await new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      const port = typeof address === 'object' && address ? address.port : 0;
      server.close((error) => (error ? reject(error) : resolve(port)));
    });
  });
}

function parsePreviewResult(stdout: string) {
  const start = stdout.indexOf('{');
  if (start < 0) throw new Error('HyperFrames Studio returned no startup result');
  return JSON.parse(stdout.slice(start)) as {
    ok?: unknown;
    result?: { studioUrl?: unknown; port?: unknown };
  };
}

async function stageProject(sceneId: number, html: string) {
  const projectDirectory = getProjectDirectory(sceneId);
  const soundDirectory = path.join(projectDirectory, 'assets', 'sound-effects');
  await mkdir(soundDirectory, { recursive: true });

  const referencedSounds = [
    ...html.matchAll(
      /<audio\b[^>]*\bsrc=["'](\/sound-effects\/[a-zA-Z0-9._-]+)["'][^>]*>/gi,
    ),
  ].map((match) => match[1]);
  for (const filePath of new Set(referencedSounds)) {
    await copyFile(
      path.join(process.cwd(), 'public', filePath),
      path.join(soundDirectory, path.basename(filePath)),
    );
  }

  const editorHtml = normalizeHyperFramesTimingAttributes(html).replace(
    /(["'])\/sound-effects\//g,
    '$1assets/sound-effects/',
  );
  await writeFile(path.join(projectDirectory, 'index.html'), editorHtml, 'utf8');
  return projectDirectory;
}

async function startEditor(sceneId: number) {
  const scene = await getScene(sceneId);
  const html = String(scene[HYPERFRAMES_HTML_FIELD_KEY] ?? '').trim();
  if (!html) {
    throw new Error('HyperFrames HTML is empty. Generate HF HTML first.');
  }

  const projectDirectory = await stageProject(sceneId, html);
  const requestedPort = await getFreePort();
  const { stdout } = await execFileAsync(
    'npx',
    [
      '--yes',
      `hyperframes@${HYPERFRAMES_VERSION}`,
      'preview',
      projectDirectory,
      '--port',
      String(requestedPort),
      '--background',
      '--no-open',
      '--json',
    ],
    { cwd: projectDirectory, timeout: 60_000, maxBuffer: 5 * 1024 * 1024 },
  );
  const result = parsePreviewResult(stdout);
  const studioUrl =
    typeof result.result?.studioUrl === 'string'
      ? result.result.studioUrl
      : '';
  const port = Number(result.result?.port);
  if (result.ok !== true || !studioUrl || !Number.isFinite(port)) {
    throw new Error('HyperFrames Studio did not start correctly');
  }

  sessions.set(sceneId, { projectDirectory, port });
  return { studioUrl, port };
}

async function saveEditor(sceneId: number) {
  const projectDirectory =
    sessions.get(sceneId)?.projectDirectory ?? getProjectDirectory(sceneId);
  const editorHtml = await readFile(
    path.join(projectDirectory, 'index.html'),
    'utf8',
  );
  const html = normalizeHyperFramesTimingAttributes(
    editorHtml.replace(
      /(["'])assets\/sound-effects\//g,
      '$1/sound-effects/',
    ),
  );
  const soundEffects = await listSoundEffects();
  const duration = Number(
    html.match(/data-composition-id=["'][^"']+["'][^>]*data-duration=["']([0-9.]+)["']/i)?.[1] ??
      html.match(/data-duration=["']([0-9.]+)["']/i)?.[1],
  );
  const validationIssues = [
    ...validateHyperFramesHtml(html, { require4KCanvas: true }),
    ...validateSoundEffectCues(
      html,
      soundEffects,
      Number.isFinite(duration) && duration > 0 ? duration : 0,
    ),
  ];
  if (validationIssues.length) {
    throw new Error(`The visual edit is not renderable: ${validationIssues.join('; ')}`);
  }

  await saveSceneHtml(sceneId, html);
  return html;
}

async function stopEditor(sceneId: number) {
  const session = sessions.get(sceneId);
  if (!session) return;
  sessions.delete(sceneId);
  await execFileAsync(
    'npx',
    [
      '--yes',
      `hyperframes@${HYPERFRAMES_VERSION}`,
      'preview',
      session.projectDirectory,
      '--port',
      String(session.port),
      '--stop',
      '--json',
    ],
    { cwd: session.projectDirectory, timeout: 30_000, maxBuffer: 1024 * 1024 },
  ).catch(() => undefined);
}

export async function POST(request: Request) {
  try {
    const body = (await request.json().catch(() => null)) as {
      action?: unknown;
      sceneId?: unknown;
    } | null;
    const sceneId = Number(body?.sceneId);
    if (!Number.isFinite(sceneId) || sceneId <= 0) {
      return Response.json({ error: 'Scene ID is required' }, { status: 400 });
    }

    if (body?.action === 'open') {
      return Response.json(await startEditor(sceneId));
    }
    if (body?.action === 'save') {
      const html = await saveEditor(sceneId);
      return Response.json({ saved: true, html });
    }
    if (body?.action === 'stop') {
      await stopEditor(sceneId);
      return Response.json({ stopped: true });
    }
    return Response.json({ error: 'Invalid editor action' }, { status: 400 });
  } catch (error) {
    console.error('HyperFrames editor failed:', error);
    return Response.json(
      { error: error instanceof Error ? error.message : 'HyperFrames editor failed' },
      { status: 500 },
    );
  }
}
