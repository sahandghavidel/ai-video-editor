import { NextRequest, NextResponse } from 'next/server';
import { spawn } from 'child_process';
import { promises as fs } from 'fs';
import path from 'path';
import os from 'os';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/* ------------------------------------------------------------------ */
/*  yt-dlp binary resolution                                          */
/* ------------------------------------------------------------------ */

// Resolve a fresh yt-dlp binary at module load. Precedence:
//   1. YTDLP_BIN env override (full path to a binary or venv script)
//   2. <project>/.venv/bin/yt-dlp (the venv shipped with this app)
//   3. yt-dlp on PATH (system / Homebrew fallback)
//
// We log which one was chosen so it is obvious in dev logs.
function resolveYtDlpBinary(): { command: string; label: string } {
  const override = process.env.YTDLP_BIN?.trim();
  if (override) {
    return { command: override, label: `env YTDLP_BIN=${override}` };
  }

  // projectRoot is <repo>/src/app/api/download-youtube-subtitles -> 4 levels up.
  const projectRoot = path.resolve(process.cwd());
  const candidates = [
    path.join(projectRoot, '.venv', 'bin', 'yt-dlp'),
    path.join(projectRoot, 'venv', 'bin', 'yt-dlp'),
  ];

  for (const candidate of candidates) {
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      require('fs').accessSync(candidate);
      return { command: candidate, label: `venv ${candidate}` };
    } catch {
      // keep searching
    }
  }

  return { command: 'yt-dlp', label: 'PATH (yt-dlp)' };
}

const YT_DLP_RESOLVED = resolveYtDlpBinary();
console.log(`🛠️ [YT-SUB] Using yt-dlp binary: ${YT_DLP_RESOLVED.label}`);

/* ------------------------------------------------------------------ */
/*  Constants                                                         */
/* ------------------------------------------------------------------ */

const USER_AGENTS = [
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.1 Safari/605.1.15',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:120.0) Gecko/20100101 Firefox/120.0',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:120.0) Gecko/20100101 Firefox/120.0',
];

const RATE_LIMIT_REGEX = /\b429\b|too many requests/i;
const AUTO_CAPTIONS_SECTION_REGEX = /available automatic captions/i;
const SUBTITLES_SECTION_REGEX = /available subtitles/i;
const SUBTITLE_TABLE_HEADER_REGEX = /language\s+name\s+formats/i;
const SEPARATOR_LINE_REGEX = /^[-\s]+$/;
const SUBTITLE_ROW_REGEX = /^(\S+)\s+(.+?)\s{2,}(.+)$/;

/* ------------------------------------------------------------------ */
/*  yt-dlp helpers                                                     */
/* ------------------------------------------------------------------ */

function getRandomUserAgent(): string {
  return (
    USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)] ??
    USER_AGENTS[0]!
  );
}

function getYtDlpCookieArgs(): string[] {
  const cookiesFromBrowser = process.env.YTDLP_COOKIES_FROM_BROWSER;
  const cookiesFile = process.env.YTDLP_COOKIES_FILE;

  if (cookiesFromBrowser) return ['--cookies-from-browser', cookiesFromBrowser];
  if (cookiesFile) return ['--cookies', cookiesFile];
  return [];
}

function getYtDlpRemoteComponentArgs(): string[] {
  const remoteComponents = process.env.YTDLP_REMOTE_COMPONENTS?.trim();
  if (remoteComponents === 'off' || remoteComponents === 'none') return [];
  return ['--remote-components', remoteComponents || 'ejs:github'];
}

function getYoutubeExtractorArgs(): string {
  const parts: string[] = ['player_js_version=actual'];
  const configuredClient = process.env.YTDLP_YOUTUBE_PLAYER_CLIENT?.trim();
  const hasCookies = getYtDlpCookieArgs().length > 0;
  const effectiveClient =
    configuredClient || (hasCookies ? 'tv_downgraded' : 'android');
  if (effectiveClient) parts.push(`player_client=${effectiveClient}`);
  return `youtube:${parts.join(',')}`;
}

function buildYtDlpBaseArgs(
  sleepInterval: string,
  maxSleepInterval: string,
): string[] {
  return [
    ...getYtDlpCookieArgs(),
    '--user-agent',
    getRandomUserAgent(),
    '--extractor-args',
    getYoutubeExtractorArgs(),
    ...getYtDlpRemoteComponentArgs(),
    '--sleep-interval',
    sleepInterval,
    '--max-sleep-interval',
    maxSleepInterval,
    // Suppress the "your yt-dlp version is older than 90 days" warning,
    // which produces stderr noise that gets surfaced in retry logs.
    '--no-update',
    // Suppress the "no impersonate target is available" warning. Impersonation
    // is opt-in via env (e.g. YTDLP_REMOTE_COMPONENTS=ejs:github); the warning
    // is not actionable from this app.
    '--no-warnings',
  ];
}

async function retryWithBackoff<T>(
  fn: () => Promise<T>,
  maxRetries = 2,
  baseDelay = 10000,
  cooldownOn429 = false,
): Promise<T> {
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      if (attempt > 0) {
        console.log(
          `🔄 [YT-SUB] Retry attempt ${attempt + 1}/${maxRetries + 1}`,
        );
      }
      return await fn();
    } catch (error) {
      if (attempt === maxRetries) throw error;

      const message = error instanceof Error ? error.message : String(error);
      const is429 = RATE_LIMIT_REGEX.test(message);
      const delayMs =
        is429 && cooldownOn429
          ? 60000 + Math.floor(Math.random() * 120001)
          : baseDelay + Math.floor(Math.random() * 3001);

      console.log(
        `⚠️ [YT-SUB] Attempt ${attempt + 1}/${maxRetries + 1} failed${is429 ? ' (429 rate-limit)' : ''}. Retrying in ${Math.round(delayMs / 1000)}s...`,
      );
      console.log(`⚠️ [YT-SUB] Reason: ${message.slice(0, 500)}`);

      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }

  throw new Error('Max retries exceeded');
}

function runYtDlp(
  args: string[],
  options?: {
    maxRetries?: number;
    baseDelay?: number;
    cooldownOn429?: boolean;
  },
): Promise<string> {
  return retryWithBackoff(
    () =>
      new Promise<string>((resolve, reject) => {
        const proc = spawn(YT_DLP_RESOLVED.command, args);
        let stdout = '';
        let stderr = '';

        proc.stdout.on('data', (data: Buffer) => {
          stdout += data.toString();
        });
        proc.stderr.on('data', (data: Buffer) => {
          stderr += data.toString();
        });
        proc.on('close', (code) => {
          if (code === 0) {
            resolve(stdout);
          } else {
            reject(
              new Error(stderr || stdout || `yt-dlp exited with code ${code}`),
            );
          }
        });
        proc.on('error', (err) => {
          reject(err);
        });
      }),
    options?.maxRetries ?? 2,
    options?.baseDelay ?? 10000,
    options?.cooldownOn429 ?? false,
  );
}

/* ------------------------------------------------------------------ */
/*  Subtitle list parser                                               */
/* ------------------------------------------------------------------ */

interface SubtitleEntry {
  lang: string;
  name: string;
  formats: string[];
  auto: boolean;
}

function parseSubtitleList(output: string): SubtitleEntry[] {
  const subtitles: SubtitleEntry[] = [];
  const lines = output.split('\n');

  let inSubsSection = false;
  let isAutoSection = false;

  for (const line of lines) {
    if (AUTO_CAPTIONS_SECTION_REGEX.test(line)) {
      isAutoSection = true;
      continue;
    }
    if (SUBTITLES_SECTION_REGEX.test(line)) {
      isAutoSection = false;
      continue;
    }
    if (SUBTITLE_TABLE_HEADER_REGEX.test(line)) {
      inSubsSection = true;
      continue;
    }
    if (!inSubsSection) continue;
    if (inSubsSection && line.trim() === '') {
      inSubsSection = false;
      continue;
    }
    if (SEPARATOR_LINE_REGEX.test(line)) continue;

    const match = SUBTITLE_ROW_REGEX.exec(line);
    if (match) {
      const langCode = match[1];
      const name = match[2];
      const formatsStr = match[3];
      if (!langCode || !name || !formatsStr) continue;

      const formats = [
        ...new Set(
          formatsStr
            .split(/,\s*/)
            .map((f) => f.trim())
            .filter(Boolean),
        ),
      ];

      subtitles.push({
        lang: langCode,
        name: name.trim(),
        formats,
        auto: isAutoSection,
      });
    }
  }

  return subtitles;
}

/* ------------------------------------------------------------------ */
/*  POST handler                                                       */
/* ------------------------------------------------------------------ */

export async function POST(request: NextRequest) {
  let body: { url?: string; lang?: string; format?: string; action?: string };

  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const { url, lang, format, action } = body;

  if (!url || typeof url !== 'string') {
    return NextResponse.json({ error: 'url is required' }, { status: 400 });
  }

  /* ── LIST available subtitles ─────────────────────────────────── */

  if (action === 'list') {
    console.log(`📋 [YT-SUB] Listing subtitles for: ${url}`);
    const startMs = Date.now();

    try {
      const output = await runYtDlp(
        [
          ...buildYtDlpBaseArgs('1', '3'),
          '--list-subs',
          '--skip-download',
          url,
        ],
        { maxRetries: 2, baseDelay: 12000, cooldownOn429: true },
      );

      const subtitles = parseSubtitleList(output);
      console.log(
        `📋 [YT-SUB] ✅ Found ${subtitles.length} subtitle entries in ${Date.now() - startMs}ms`,
      );

      return NextResponse.json({ subtitles });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.log(
        `📋 [YT-SUB] ❌ Failed after ${Date.now() - startMs}ms: ${message}`,
      );
      return NextResponse.json(
        { error: `Failed to list subtitles: ${message}` },
        { status: 500 },
      );
    }
  }

  /* ── DOWNLOAD a specific subtitle ─────────────────────────────── */

  if (!lang || typeof lang !== 'string') {
    return NextResponse.json(
      { error: 'lang is required for download (or use action="list")' },
      { status: 400 },
    );
  }

  const subFormat = format || 'srt';
  console.log(
    `📥 [YT-SUB] Downloading subtitle: lang=${lang}, format=${subFormat}, url=${url}`,
  );
  const dlStart = Date.now();

  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'subtitles-'));
  console.log(`📁 [YT-SUB] Temp dir: ${tmpDir}`);

  try {
    await runYtDlp(
      [
        ...buildYtDlpBaseArgs('2', '5'),
        '--write-subs',
        '--write-auto-subs',
        '--sub-langs',
        lang,
        '--sub-format',
        subFormat,
        '--skip-download',
        '--no-write-playlist-metafiles',
        '-o',
        path.join(tmpDir, 'subtitle.%(ext)s'),
        url,
      ],
      { maxRetries: 1, baseDelay: 15000, cooldownOn429: true },
    );

    console.log(`✅ [YT-SUB] yt-dlp finished in ${Date.now() - dlStart}ms`);

    const files = await fs.readdir(tmpDir);
    console.log(
      `📂 [YT-SUB] Files in temp dir: ${files.join(', ') || '(empty)'}`,
    );
    const subFile = files.find((f) => f.startsWith('subtitle.'));

    if (!subFile) {
      console.log(`❌ [YT-SUB] No subtitle file found for lang "${lang}"`);
      return NextResponse.json(
        { error: `No subtitle file found for language "${lang}"` },
        { status: 404 },
      );
    }

    const filePath = path.join(tmpDir, subFile);
    const content = await fs.readFile(filePath);
    const ext = path.extname(subFile).slice(1);

    console.log(
      `📄 [YT-SUB] Serving ${subFile} (${content.length} bytes) after ${Date.now() - dlStart}ms total`,
    );

    const contentType =
      ext === 'vtt'
        ? 'text/vtt'
        : ext === 'srt'
          ? 'text/plain'
          : ext === 'ttml'
            ? 'application/ttml+xml'
            : 'text/plain';

    const filename = `subtitles_${lang}.${ext}`;

    return new NextResponse(content, {
      headers: {
        'Content-Type': contentType,
        'Content-Disposition': `attachment; filename="${filename}"`,
        'X-Subtitle-Lang': lang,
        'X-Subtitle-Format': ext,
        'X-Subtitle-Size': String(content.length),
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.log(
      `❌ [YT-SUB] Download failed after ${Date.now() - dlStart}ms: ${message}`,
    );
    return NextResponse.json(
      { error: `Failed to download subtitle: ${message}` },
      { status: 500 },
    );
  } finally {
    try {
      await fs.rm(tmpDir, { recursive: true, force: true });
    } catch {
      // Best-effort cleanup.
    }
  }
}
