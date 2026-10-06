import { NextRequest, NextResponse } from 'next/server';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { getBaserowDataForOriginalVideo } from '@/lib/baserow-actions';

export const runtime = 'nodejs';

const execFileAsync = promisify(execFile);
const exportDir = path.join(os.homedir(), 'Documents', 'OmniVoice-English-Dataset');
const sentenceKey = (text: string) => text.trim().replace(/\s+/g, ' ');

type Sample = {
  id: string;
  audio_path: string;
  text: string;
  language_id: 'en';
  video_id: number;
  scene_id: number;
  exported_at: string;
};

function audioUrl(value: unknown): string {
  if (typeof value === 'string') return value.trim();
  if (Array.isArray(value)) return audioUrl(value[0]);
  if (value && typeof value === 'object') {
    const field = value as { url?: unknown; file?: { url?: unknown } };
    return audioUrl(field.url ?? field.file?.url);
  }
  return '';
}

async function readManifest(filename: string): Promise<Sample[]> {
  let contents: string;
  try {
    contents = await fs.readFile(filename, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw error;
  }
  return contents.split('\n').filter((line) => line.trim()).map((line) => {
    const sample = JSON.parse(line) as Sample;
    if (!sample.id || typeof sample.text !== 'string' || !sample.audio_path) {
      throw new Error('Invalid dataset manifest. Existing collection was left unchanged.');
    }
    return sample;
  });
}

// A filesystem lock also serializes requests across Next.js workers.
async function acquireLock(filename: string) {
  try {
    const handle = await fs.open(filename, 'wx');
    await handle.writeFile(String(process.pid));
    await handle.close();
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
    return false;
  }
}

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => null);
  const videoId = body?.videoId;
  if (typeof videoId !== 'number' || !Number.isInteger(videoId) || videoId <= 0) {
    return NextResponse.json({ error: 'A positive integer videoId is required.' }, { status: 400 });
  }

  const lockPath = path.join(exportDir, '.export.lock');
  let locked = false;
  try {
    await fs.mkdir(exportDir, { recursive: true });
    locked = await acquireLock(lockPath);
    if (!locked) {
      return NextResponse.json({ error: 'An English dataset export is already running. Try again when it finishes.' }, { status: 409 });
    }
    const manifestPath = path.join(exportDir, 'dataset.jsonl');
    const samples = await readManifest(manifestPath);
    const existing = new Map(samples.map((sample) => [sentenceKey(sample.text), sample]));
    const scenes = await getBaserowDataForOriginalVideo(videoId);
    const counts = { added: 0, duplicates: 0, emptySentences: 0, missingAudio: 0, failed: 0 };
    const failures: { sceneId: number; error: string }[] = [];
    for (const scene of scenes) {
      const text = typeof scene.field_6890 === 'string' ? scene.field_6890 : '';
      const key = sentenceKey(text);
      if (!key) { counts.emptySentences++; continue; }
      const prior = existing.get(key);
      if (prior) {
        try {
          await fs.access(prior.audio_path);
          await fs.access(path.join(exportDir, `${prior.id}.txt`));
          counts.duplicates++;
        } catch {
          counts.failed++;
          failures.push({ sceneId: scene.id, error: `Existing pair ${prior.id} is missing a file; restore it before exporting this sentence.` });
        }
        continue;
      }
      const url = audioUrl(scene.field_6891);
      if (!url) { counts.missingAudio++; continue; }
      const id = `sample_${createHash('sha256').update(key).digest('hex')}`;
      const audioPath = path.join(exportDir, `${id}.wav`);
      const textPath = path.join(exportDir, `${id}.txt`);
      const tempDir = await fs.mkdtemp(path.join(exportDir, '.sample-'));
      try {
        const response = await fetch(url, { cache: 'no-store', signal: AbortSignal.timeout(60_000) });
        if (!response.ok) throw new Error(`Audio download failed (${response.status}).`);
        const sourcePath = path.join(tempDir, 'source');
        await fs.writeFile(sourcePath, Buffer.from(await response.arrayBuffer()));
        const { stdout } = await execFileAsync('ffprobe', ['-v', 'error', '-show_entries', 'format=format_name,duration:stream=codec_type', '-of', 'json', sourcePath], { timeout: 30_000 });
        const probe = JSON.parse(stdout);
        if (!probe.streams?.some((stream: { codec_type: string }) => stream.codec_type === 'audio') || !(Number(probe.format?.duration) > 0)) {
          throw new Error('Downloaded file has no valid audio or duration.');
        }
        let preparedPath = sourcePath;
        if (probe.format.format_name !== 'wav') {
          preparedPath = path.join(tempDir, 'converted.wav');
          await execFileAsync('ffmpeg', ['-v', 'error', '-i', sourcePath, '-vn', '-c:a', 'pcm_s16le', preparedPath], { timeout: 60_000 });
        }
        // Hard links publish complete files without overwriting any existing pair.
        // Matching orphans from an interrupted export can safely be indexed again.
        try { await fs.link(preparedPath, audioPath); } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
          await execFileAsync('ffprobe', ['-v', 'error', audioPath], { timeout: 30_000 });
        }
        try { await fs.writeFile(textPath, text, { flag: 'wx' }); } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
          if (sentenceKey(await fs.readFile(textPath, 'utf8')) !== key) throw new Error('Existing sentence file does not match.');
        }
        const sample: Sample = { id, audio_path: audioPath, text, language_id: 'en', video_id: videoId, scene_id: scene.id, exported_at: new Date().toISOString() };
        const nextSamples = [...samples, sample];
        const stagedManifest = path.join(tempDir, 'dataset.jsonl');
        await fs.writeFile(stagedManifest, nextSamples.map((entry) => JSON.stringify(entry)).join('\n') + '\n');
        await fs.rename(stagedManifest, manifestPath);
        samples.push(sample);
        existing.set(key, sample);
        counts.added++;
      } catch (error) {
        counts.failed++;
        failures.push({ sceneId: scene.id, error: error instanceof Error ? error.message : 'Export failed.' });
      } finally {
        await fs.rm(tempDir, { recursive: true, force: true });
      }
    }
    return NextResponse.json({ videoId, exportDir, totalScenes: scenes.length, ...counts, failures });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Dataset export failed.' }, { status: 500 });
  } finally {
    if (locked) await fs.unlink(lockPath);
  }
}
