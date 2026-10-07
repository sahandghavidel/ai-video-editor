import { NextRequest, NextResponse } from 'next/server';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { loadTtsAudioReferencesStore, type TtsAudioReferenceEntry } from '@/lib/ttsAudioReferencesStore';
import { getBaserowDataForOriginalVideo } from '@/lib/baserow-actions';

export const runtime = 'nodejs';

const execFileAsync = promisify(execFile);
const collectionRoot = path.join(os.homedir(), 'Documents', 'OmniVoice-Language-Datasets');
const sentenceKey = (text: string) => text.trim().replace(/\s+/g, ' ');

type Sample = {
  id: string;
  audio_path: string;
  text: string;
  language_id: string;
  preset_id: string;
  sentence_field: string;
  audio_field: string;
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


function languageOptions(entries: TtsAudioReferenceEntry[]) {
  const groups = new Map<string, TtsAudioReferenceEntry[]>();
  for (const entry of entries) {
    const language = entry.language.toLowerCase();
    if (!entry.enabled || language === 'en' || language === 'und' || !/^[a-z]{2,3}(?:-[a-z0-9]{2,8})*$/.test(language)) continue;
    groups.set(language, [...(groups.get(language) || []), entry]);
  }
  const names = new Intl.DisplayNames(['en'], { type: 'language' });
  return [...groups].map(([language, presets]) => {
    const preset = presets.find((entry) => entry.isDefault) || presets[0];
    const mapping = (entry: TtsAudioReferenceEntry) => JSON.stringify([
      entry.baserowFields.sceneTargetSentenceFieldKey,
      entry.baserowFields.sceneDubbedAudioFieldKey,
      entry.baserowFields.sceneOriginalAudioFieldKey || '',
    ]);
    const conflict = presets.some((entry) => mapping(entry) !== mapping(preset));
    return { language, label: names.of(language) || language, preset, conflict };
  }).sort((a, b) => a.label.localeCompare(b.label));
}

export async function GET() {
  try {
    const store = await loadTtsAudioReferencesStore();
    return NextResponse.json({ languages: languageOptions(store.entries).map(({ language, label, conflict }) => ({ language, label, conflict })) });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Could not load export languages.' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => null);
  const videoId = body?.videoId;
  if (typeof videoId !== 'number' || !Number.isInteger(videoId) || videoId <= 0) {
    return NextResponse.json({ error: 'A positive integer videoId is required.' }, { status: 400 });
  }

  const language = typeof body?.language === 'string' ? body.language.trim().toLowerCase() : '';
  let option: ReturnType<typeof languageOptions>[number] | undefined;
  try {
    option = languageOptions((await loadTtsAudioReferencesStore()).entries).find((entry) => entry.language === language);
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Could not load language presets.' }, { status: 500 });
  }
  if (!option) return NextResponse.json({ error: 'Select a configured non-English language.' }, { status: 400 });
  if (option.conflict) return NextResponse.json({ error: `Presets for ${option.label} disagree about sentence/audio fields. Resolve their mappings before exporting.` }, { status: 400 });
  const preset = option.preset;
  const fields = preset.baserowFields;
  const exportDir = path.join(collectionRoot, language);
  const lockPath = path.join(exportDir, '.export.lock');
  let locked = false;
  try {
    await fs.mkdir(exportDir, { recursive: true });
    locked = await acquireLock(lockPath);
    if (!locked) {
      return NextResponse.json({ error: 'A dataset export for this language is already running. Try again when it finishes.' }, { status: 409 });
    }
    const manifestPath = path.join(exportDir, 'dataset.jsonl');
    const samples = await readManifest(manifestPath);
    const existing = new Map(samples.map((sample) => [sentenceKey(sample.text), sample]));
    const scenes = await getBaserowDataForOriginalVideo(videoId);
    const counts = { added: 0, duplicates: 0, emptySentences: 0, missingAudio: 0, failed: 0, originalAudioAdded: 0, dubbedAudioAdded: 0 };
    const failures: { sceneId: number; error: string }[] = [];
    for (const scene of scenes) {
      const value = scene[fields.sceneTargetSentenceFieldKey];
      const text = typeof value === 'string' ? value : '';
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
      const originalUrl = fields.sceneOriginalAudioFieldKey ? audioUrl(scene[fields.sceneOriginalAudioFieldKey]) : '';
      const audioField = originalUrl ? fields.sceneOriginalAudioFieldKey! : fields.sceneDubbedAudioFieldKey;
      const url = originalUrl || audioUrl(scene[fields.sceneDubbedAudioFieldKey]);
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
        const sample: Sample = { id, audio_path: audioPath, text, language_id: language, preset_id: preset.id, sentence_field: fields.sceneTargetSentenceFieldKey, audio_field: audioField, video_id: videoId, scene_id: scene.id, exported_at: new Date().toISOString() };
        const nextSamples = [...samples, sample];
        const stagedManifest = path.join(tempDir, 'dataset.jsonl');
        await fs.writeFile(stagedManifest, nextSamples.map((entry) => JSON.stringify(entry)).join('\n') + '\n');
        await fs.rename(stagedManifest, manifestPath);
        samples.push(sample);
        existing.set(key, sample);
        counts.added++;
        if (originalUrl) counts.originalAudioAdded++; else counts.dubbedAudioAdded++;
      } catch (error) {
        counts.failed++;
        failures.push({ sceneId: scene.id, error: error instanceof Error ? error.message : 'Export failed.' });
      } finally {
        await fs.rm(tempDir, { recursive: true, force: true });
      }
    }
    return NextResponse.json({ videoId, language, presetId: preset.id, sentenceField: fields.sceneTargetSentenceFieldKey, originalAudioField: fields.sceneOriginalAudioFieldKey, dubbedAudioField: fields.sceneDubbedAudioFieldKey, exportDir, totalScenes: scenes.length, ...counts, failures });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Dataset export failed.' }, { status: 500 });
  } finally {
    if (locked) await fs.unlink(lockPath).catch(() => {});
  }
}
