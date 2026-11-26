import { compareWords, type TimedWord } from './voice-transcript';
import { spokenSentence } from './voice-script-ranges';
export { spokenSentence } from './voice-script-ranges';
import { createHash, randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { link, mkdir, rm, writeFile, lstat, mkdtemp, readFile, readdir, realpath, rename, rmdir } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';

const library = join(homedir(), 'Library/Application Support/local.clipboardreadermac/ClonedClipboardAudio');
const uuid = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i;
const folderName = /^[\p{L}\p{N}\p{M}-]+--[a-f0-9]{64}$/u;
const sha = (data: Buffer | string) => createHash('sha256').update(data).digest('hex');
export type VoiceTake = { hasTranscript?: boolean; id: string; status: 'Current approval' | 'Previously approved' | 'Unapproved'; duration: number; date: number; size: number };
export type VoiceGroup = { folder: string; narration: string; voice: string; voiceID: string; takes: VoiceTake[]; issue: boolean };

async function directory(path: string) {
  if (await realpath(path) !== path || !(await lstat(path)).isDirectory()) throw Error('Unexpected library directory.');
  return path;
}

async function json(path: string) {
  if (!(await lstat(path)).isFile()) throw Error('Invalid metadata file.');
  return JSON.parse(await readFile(path, 'utf8'));
}

async function versionsPath(folder: string, root = library) {
  if (!folderName.test(folder)) throw Error('Invalid narration folder.');
  return directory(join(root, folder, 'versions'));
}

export async function voiceAudio(folder: string, id: string, root = library) {
  if (!uuid.test(id)) throw Error('Invalid take.');
  const dir = await directory(join(await versionsPath(folder, root), id));
  const path = join(dir, 'audio.wav');
  if (!(await lstat(path)).isFile()) throw Error('Audio unavailable.');
  return readFile(path);
}

async function scan(folder: string, root = library): Promise<VoiceGroup | null> {
  const group: VoiceGroup = { folder, narration: folder.split('--')[0], voice: '', voiceID: '', takes: [], issue: false };
  try {
    const versions = await versionsPath(folder, root);
    const state = await json(join(versions, '../group.json'));
    const key = sha(Buffer.byteLength(state.voiceID) + ':' + state.voiceID + state.narration);
    if (typeof state.narration !== 'string' || !folder.endsWith('--' + key)) throw Error();
    group.narration = state.narration;
    group.voiceID = state.voiceID;
    const current = state.approvedVersionID?.toLowerCase();
    let otherPreset = false;
    for (const entry of await readdir(versions, { withFileTypes: true })) {
      if (entry.name.startsWith('.')) continue;
      try {
        const id = entry.name;
        if (!entry.isDirectory() || !uuid.test(id)) throw Error();
        const dir = join(versions, id);
        const meta = await json(join(dir, 'metadata.json'));
        if (meta.id.toLowerCase() !== id.toLowerCase() || meta.voice.id !== state.voiceID ||
            meta.spokenText !== state.narration || !(meta.duration > 0) || !Number.isFinite(meta.createdAt)) throw Error();
        if (meta.voice.language !== 'en' || meta.voice.provider !== 'omnivoice-lora') {
          otherPreset = true;
          continue;
        }
        group.voice = meta.voice.name;
        const files = await readdir(dir);
        let size = 0;
        for (const name of files) {
          const stat = await lstat(join(dir, name));
          if (!stat.isFile() || !['metadata.json', 'audio.wav', 'transcription.json', 'approved.json'].includes(name)) throw Error();
          size += stat.size;
        }
        if (!files.includes('audio.wav')) throw Error();
        const marked = files.includes('approved.json');
        const active = current === id.toLowerCase();
        if (active || marked) {
          const audio = await voiceAudio(folder, id, root);
          if (audio.length <= 44 || audio.toString('ascii', 0, 4) !== 'RIFF' ||
              audio.toString('ascii', 8, 12) !== 'WAVE' || audio.readUInt32LE(4) + 8 > audio.length) throw Error();
          if (marked) {
            const marker = await json(join(dir, 'approved.json'));
            if (marker.takeID.toLowerCase() !== id.toLowerCase() || marker.audioSHA256 !== sha(audio)) throw Error();
          }
        }
        group.takes.push({ id, hasTranscript: files.includes('transcription.json'), status: active ? 'Current approval' : marked ? 'Previously approved' : 'Unapproved',
          duration: meta.duration, date: (meta.createdAt + 978307200) * 1000, size });
      } catch { group.issue = true; }
    }
    if (otherPreset && !group.voice && !group.issue) return null;
    if (otherPreset || (current && !group.takes.some(t => t.status === 'Current approval'))) group.issue = true;
  } catch { group.issue = true; }
  group.takes.sort((a, b) => b.date - a.date);
  return group;
}

export async function listVoices() {
  const dirs = await readdir(await directory(library), { withFileTypes: true });
  const names = dirs.filter(d => d.isDirectory() && !d.name.startsWith('.')).map(d => d.name);
  const groups: VoiceGroup[] = [];
  for (let i = 0; i < names.length; i += 12) {
    for (const group of await Promise.all(names.slice(i, i + 12).map(folder => scan(folder)))) if (group) groups.push(group);
  }
  return groups;
}

async function matchesUnapprovedPreview(root: string, folder: string, ids: Set<string>) {
  const group = await scan(folder, root);
  if (!group || group.issue || group.takes.length !== ids.size ||
      !group.takes.every(t => t.status === 'Unapproved' && ids.has(t.id))) return false;
  const dir = join(root, folder);
  const entries = await readdir(dir);
  if (entries.some(name => !['group.json', 'versions', '.DS_Store'].includes(name))) return false;
  // A hidden staging directory may contain an in-progress generation or cleanup.
  return (await readdir(join(dir, 'versions'))).every(name => ids.has(name) || name === '.DS_Store');
}

export async function trashUnapprovedFolder(folder: string, previewIDs: string[]) {
  const ids = new Set(previewIDs);
  if (!folderName.test(folder) || !ids.size || !previewIDs.every(id => uuid.test(id))) throw Error('Invalid folder preview.');
  if (!await matchesUnapprovedPreview(library, folder, ids)) return false;

  // Claim the folder, then check again. Concurrent Pilot and Voice Manager writes use
  // the original path and cannot add an approval to the claimed folder after this check.
  const stage = await mkdtemp(join(library, '.folder-cleanup-'));
  const claimed = join(stage, folder);
  const original = join(library, folder);
  try {
    try { await rename(original, claimed); }
    catch (e) { if ((e as NodeJS.ErrnoException).code === 'ENOENT') return false; throw e; }
    let trashed = false;
    try {
      if (!await matchesUnapprovedPreview(stage, folder, ids)) return false;
      await promisify(execFile)('/usr/bin/trash', [claimed]);
      trashed = true;
      return true;
    } finally {
      if (!trashed) {
        try { await rename(claimed, original); }
        catch { throw Error('Folder preserved at ' + claimed + '. Could not restore its original location.'); }
      }
    }
  } finally {
    if (!(await readdir(stage)).length) await rmdir(stage);
  }
}

export async function trashTakes(folder: string, ids: string[]) {
  const versions = await versionsPath(folder);
  let moved = 0;
  for (const id of new Set(ids)) {
    if (!uuid.test(id)) throw Error('Invalid take.');
    const group = await scan(folder);
    if (!group || group.issue || !group.takes.some(t => t.status === 'Current approval') ||
        !group.takes.some(t => t.id === id && t.status === 'Unapproved')) continue;
    // Claim this version before the final approval check. Pilot writes its approval marker
    // inside the version directory before switching the group pointer.
    const stage = await mkdtemp(join(versions, '.trash-'));
    const source = join(versions, id);
    const claimed = join(stage, id);
    try {
      await rename(source, claimed);
      try {
        const state = await json(join(versions, '../group.json'));
        if ((await readdir(claimed)).includes('approved.json') ||
            state.approvedVersionID?.toLowerCase() !== group.takes.find(t => t.status === 'Current approval')?.id.toLowerCase()) {
          await rename(claimed, source);
          continue;
        }
        await promisify(execFile)('/usr/bin/trash', [claimed]);
        moved++;
      } catch (error) {
        await rename(claimed, source);
        throw error;
      }
    } finally { await rmdir(stage); }
  }
  return moved;
}

async function publishJson(path: string, value: unknown, createOnly = false) {
  const tmp = path + '.' + randomUUID() + '.tmp';
  await writeFile(tmp, JSON.stringify(value), { flag: 'wx' });
  try {
    if (createOnly) {
      try { await link(tmp, path); }
      catch (e) { if ((e as NodeJS.ErrnoException).code !== 'EEXIST') throw e; }
    } else await rename(tmp, path);
  } finally { await rm(tmp, { force: true }); }
}

async function wavDuration(path: string) {
  const { stdout } = await promisify(execFile)('ffprobe', [
    '-v', 'error', '-select_streams', 'a:0', '-show_entries', 'stream=duration:format=format_name',
    '-of', 'json', path,
  ]);
  const info = JSON.parse(stdout);
  const duration = Number(info.streams?.[0]?.duration);
  if (info.format?.format_name !== 'wav' || !Number.isFinite(duration) || duration <= 0) throw Error('The take has no playable WAV audio.');
  return duration;
}

export async function approveVoice(folder: string, id: string) {
  const group = await scan(folder);
  if (!group || group.issue || !group.takes.some(t => t.id === id)) throw Error('Refresh and check this folder before approving.');
  const versions = await versionsPath(folder);
  const previous = group.takes.find(t => t.status === 'Current approval');
  // Legacy approvals can exist only in group.json. Pin them before selecting a replacement.
  for (const takeID of new Set([previous?.id, id])) {
    if (!takeID) continue;
    const audio = await voiceAudio(folder, takeID);
    await wavDuration(join(versions, takeID, 'audio.wav'));
    const marker = { takeID: takeID.toUpperCase(), audioSHA256: sha(audio) };
    const file = join(versions, takeID, 'approved.json');
    await publishJson(file, marker, true);
    const saved = await json(file);
    if (saved.takeID.toUpperCase() !== marker.takeID || saved.audioSHA256 !== marker.audioSHA256) throw Error('Approval fingerprint mismatch.');
  }
  const file = join(versions, '../group.json');
  const state = await json(file);
  await publishJson(file, { ...state, approvedVersionID: id.toUpperCase() });
  return scan(folder);
}

type VoicePreset = { id: string; name: string; language: string; enabled: boolean; provider: string };

function sentenceFolder(narration: string, voiceID: string) {
  const words = narration.toLowerCase().match(/[\p{L}\p{M}\p{N}]+/gu)?.join('-') || 'narration';
  const slug = Array.from(new Intl.Segmenter().segment(words), part => part.segment).slice(0, 40).join('');
  return slug + '--' + sha(Buffer.byteLength(voiceID) + ':' + voiceID + narration);
}

export async function existingSentence(text: string, voiceID: string) {
  const folder = sentenceFolder(spokenSentence(text), voiceID);
  try { await lstat(join(library, folder)); }
  catch (e) { if ((e as NodeJS.ErrnoException).code === 'ENOENT') return null; throw e; }
  const group = await scan(folder);
  if (!group || group.issue) throw Error('This narration folder needs review.');
  return group.takes.length ? group : null;
}

export async function saveVoiceTake(input: string, voice: VoicePreset, id: string, audio: Buffer, response: unknown) {
  const narration = spokenSentence(input);
  if (!narration || !uuid.test(id) || !voice.enabled || voice.language !== 'en' || voice.provider !== 'omnivoice-lora') throw Error('Invalid take or voice preset.');
  const folder = sentenceFolder(narration, voice.id);
  await mkdir(library, { recursive: true });
  const root = await directory(library);
  const dir = join(root, folder);
  await mkdir(dir, { recursive: true });
  await directory(dir);
  await mkdir(join(dir, 'versions'), { recursive: true });
  const versions = await versionsPath(folder);
  const stage = await mkdtemp(join(versions, '.generate-'));
  try {
    await writeFile(join(stage, 'audio.wav'), audio);
    const duration = await wavDuration(join(stage, 'audio.wav'));
    await writeFile(join(stage, 'metadata.json'), JSON.stringify({
      id, createdAt: Date.now() / 1000 - 978307200, clipboardText: input, spokenText: narration,
      voice, duration, generationResponse: JSON.stringify(response),
    }));
    const file = join(dir, 'group.json');
    await publishJson(file, { narration, voiceID: voice.id }, true);
    const state = await json(file);
    if (state.narration !== narration || state.voiceID !== voice.id) throw Error('Narration folder metadata has changed.');
    await rename(stage, join(versions, id));
  } finally { await rm(stage, { recursive: true, force: true }); }
  return scan(folder);
}

export async function transcriptFlags(folder: string, id: string) {
  const audio = await voiceAudio(folder, id);
  const dir = join(await versionsPath(folder), id);
  const transcript = await json(join(dir, 'transcription.json'));
  const meta = await json(join(dir, 'metadata.json'));
  if (transcript.audioSHA256 !== sha(audio) || !Array.isArray(transcript.words) ||
      !transcript.words.every((w: TimedWord) => w && typeof w.word === 'string' && Number.isFinite(w.start) && Number.isFinite(w.end))) {
    throw Error('Saved transcript does not match this recording.');
  }
  return compareWords(meta.spokenText, transcript.words);
}
