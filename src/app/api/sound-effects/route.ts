import { randomUUID } from 'crypto';
import { mkdir, rename, unlink, writeFile } from 'fs/promises';
import path from 'path';
import { NextRequest, NextResponse } from 'next/server';
import { probeVideoDurationSeconds } from '@/lib/ffprobe-video-duration';
import { measureAudioLevels } from '@/lib/audio-levels';
import { SOUND_EFFECT_EXTENSIONS, SOUND_EFFECT_MAX_BYTES, type SoundEffect } from '@/lib/sound-effects';
import { listSoundEffects, soundEffect, soundEffectsRequest } from '@/lib/sound-effects-storage';

export const runtime = 'nodejs';
export const maxDuration = 60;

const soundDirectory = path.resolve(process.cwd(), 'public', 'sound-effects');

function text(form: FormData, key: string, max: number) {
  const value = form.get(key);
  if (typeof value !== 'string' || value.length > max) throw new Error(`Invalid ${key}.`);
  return value;
}

function numeric(form: FormData, key: string) {
  const value = Number(form.get(key));
  if (!Number.isFinite(value)) throw new Error(`Invalid ${key}.`);
  return value;
}

function localFilePath(filePath: string) {
  if (!filePath.startsWith('/sound-effects/')) return null;
  const resolved = path.resolve(process.cwd(), 'public', `.${filePath}`);
  return resolved.startsWith(`${soundDirectory}${path.sep}`) ? resolved : null;
}

function rowBody(input: Omit<SoundEffect, 'id'>) {
  return {
    Name: input.name,
    Description: input.description,
    Status: input.status,
    'File Path': input.filePath,
    'Duration (seconds)': input.durationSeconds.toFixed(3),
    'Measured RMS (dBFS)': input.measuredRmsDbfs?.toFixed(2) ?? null,
    'True Peak (dBFS)': input.truePeakDbfs?.toFixed(2) ?? null,
    'Default Volume (dB)': input.defaultVolumeDb.toFixed(1),
    'Sync Point (seconds)': input.syncPointSeconds.toFixed(3),
    Tags: input.tags,
    'Usage Rules': input.usageRules,
    'Source / Credit': input.sourceCredit,
    License: input.license,
  };
}

export async function GET() {
  try { return NextResponse.json({ sounds: await listSoundEffects() }); }
  catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : 'Unable to load Sound Effects Library.' }, { status: 502 }); }
}

export async function POST(request: NextRequest) { return save(request, false); }
export async function PATCH(request: NextRequest) { return save(request, true); }

async function save(request: NextRequest, updating: boolean) {
  let form: FormData;
  try { form = await request.formData(); }
  catch { return NextResponse.json({ error: 'Invalid form data.' }, { status: 400 }); }

  let id = 0;
  let existing: SoundEffect | undefined;
  let input: Omit<SoundEffect, 'id'>;
  let upload: File | null;
  try {
    id = Number(form.get('id') || 0);
    if (updating && (!Number.isSafeInteger(id) || id <= 0)) throw new Error('Invalid sound ID.');
    if (updating) {
      existing = (await listSoundEffects()).find(sound => sound.id === id);
      if (!existing) throw new Error('Sound effect was not found.');
    }
    upload = form.get('file') instanceof File ? form.get('file') as File : null;
    if (!updating && !upload) throw new Error('Choose an audio file.');
    if (upload && (upload.size <= 0 || upload.size > SOUND_EFFECT_MAX_BYTES)) throw new Error('Audio must be between 1 byte and 25 MB.');
    const extension = upload ? path.extname(upload.name).toLowerCase() : '';
    if (upload && !SOUND_EFFECT_EXTENSIONS.has(extension)) throw new Error('Unsupported audio format. Use WAV, MP3, M4A, AAC, FLAC, OGG, OPUS, AIFF, or AIF.');
    const name = text(form, 'name', 200).trim();
    if (!name) throw new Error('Name is required.');
    const defaultVolumeDb = numeric(form, 'defaultVolumeDb');
    if (defaultVolumeDb < -60 || defaultVolumeDb > 6) throw new Error('Default volume must be between -60 and 6 dB.');
    const syncPointSeconds = numeric(form, 'syncPointSeconds');
    if (syncPointSeconds < 0) throw new Error('Sync point cannot be negative.');
    const requestedStatus = text(form, 'status', 20);
    if (!['Draft', 'Approved'].includes(requestedStatus)) throw new Error('Invalid status.');
    input = {
      name,
      description: text(form, 'description', 10000),
      filePath: existing?.filePath || '',
      durationSeconds: existing?.durationSeconds || 0,
      measuredRmsDbfs: existing?.measuredRmsDbfs ?? null,
      truePeakDbfs: existing?.truePeakDbfs ?? null,
      defaultVolumeDb,
      syncPointSeconds,
      tags: text(form, 'tags', 2000),
      usageRules: text(form, 'usageRules', 10000),
      sourceCredit: text(form, 'sourceCredit', 10000),
      license: text(form, 'license', 10000),
      status: upload ? 'Draft' : requestedStatus as 'Draft' | 'Approved',
    };
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Invalid sound effect.' }, { status: 400 });
  }

  let savedPath: string | null = null;
  try {
    if (upload) {
      await mkdir(soundDirectory, { recursive: true });
      const extension = path.extname(upload.name).toLowerCase();
      const stem = input.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60) || 'sound';
      const fileName = `${stem}-${randomUUID().slice(0, 8)}${extension}`;
      const temporaryPath = path.join(soundDirectory, `.${fileName}.upload`);
      savedPath = path.join(soundDirectory, fileName);
      await writeFile(temporaryPath, Buffer.from(await upload.arrayBuffer()), { flag: 'wx' });
      try {
        input.durationSeconds = await probeVideoDurationSeconds(temporaryPath);
        const levels = await measureAudioLevels(temporaryPath);
        input.measuredRmsDbfs = levels.measuredRmsDbfs;
        input.truePeakDbfs = levels.truePeakDbfs;
        if (input.syncPointSeconds > input.durationSeconds) throw new Error('Sync point cannot be later than the audio duration.');
        await rename(temporaryPath, savedPath);
      } catch (error) {
        await unlink(temporaryPath).catch(() => undefined);
        throw error;
      }
      input.filePath = `/sound-effects/${fileName}`;
    } else {
      if (input.syncPointSeconds > input.durationSeconds) throw new Error('Sync point cannot be later than the audio duration.');
      if (input.measuredRmsDbfs === null || input.truePeakDbfs === null) {
        const existingPath = localFilePath(input.filePath);
        if (!existingPath) throw new Error('Stored audio path is invalid.');
        const levels = await measureAudioLevels(existingPath);
        input.measuredRmsDbfs = levels.measuredRmsDbfs;
        input.truePeakDbfs = levels.truePeakDbfs;
      }
    }

    const response = await soundEffectsRequest(`${updating ? `${id}/` : ''}?user_field_names=true`, {
      method: updating ? 'PATCH' : 'POST', body: JSON.stringify(rowBody(input)),
    });
    const saved = soundEffect(await response.json());
    if (savedPath && existing?.filePath && existing.filePath !== saved.filePath) {
      const oldPath = localFilePath(existing.filePath);
      if (oldPath) await unlink(oldPath).catch(() => undefined);
    }
    return NextResponse.json({ sound: saved });
  } catch (error) {
    if (savedPath) await unlink(savedPath).catch(() => undefined);
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Unable to save sound effect.' }, { status: 502 });
  }
}

export async function DELETE(request: NextRequest) {
  const id = Number(request.nextUrl.searchParams.get('id'));
  if (!Number.isSafeInteger(id) || id <= 0) return NextResponse.json({ error: 'Invalid sound ID.' }, { status: 400 });
  try {
    const existing = (await listSoundEffects()).find(sound => sound.id === id);
    if (!existing) return NextResponse.json({ error: 'Sound effect was not found.' }, { status: 404 });
    await soundEffectsRequest(`${id}/`, { method: 'DELETE' });
    const filePath = localFilePath(existing.filePath);
    if (filePath) await unlink(filePath).catch(() => undefined);
    return NextResponse.json({ success: true });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Unable to delete sound effect.' }, { status: 502 });
  }
}
