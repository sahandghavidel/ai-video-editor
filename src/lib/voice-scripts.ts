import { spokenSentence, sourceRanges, replacementPlan } from './voice-script-ranges';
import { readFileSync, renameSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';

export type VoiceScript = { id: string; title: string; text: string; voiceID: string; sentences: string[]; createdAt: number; revision?: string; canUndo?: boolean };
const scriptsDir = join(homedir(), 'Library/Application Support/ultimate-video-editr/voice-scripts');

type Snapshot = Pick<VoiceScript, 'title' | 'text' | 'voiceID' | 'sentences'>;
type StoredScript = VoiceScript & { previous?: Snapshot };

function scriptPath(id: string) {
  if (typeof id !== 'string' || !/^[0-9a-f-]{36}$/i.test(id)) throw Error('Invalid script ID.');
  return join(scriptsDir, id + '.json');
}

async function readRevision(id: string, revision?: string): Promise<StoredScript> {
  const script = JSON.parse(await readFile(scriptPath(id), 'utf8'));
  if (script.revision !== revision) throw Error('Script changed. Reload before editing.');
  return script;
}

export async function listVoiceScripts(): Promise<VoiceScript[]> {
  let names: string[];
  try { names = await readdir(scriptsDir); }
  catch (e) { if ((e as NodeJS.ErrnoException).code === 'ENOENT') return []; throw e; }
  const scripts: VoiceScript[] = await Promise.all(names.filter(name => name.endsWith('.json')).map(async name =>
    publicScript(JSON.parse(await readFile(join(scriptsDir, name), 'utf8')))));
  return scripts.sort((a, b) => b.createdAt - a.createdAt);
}

function publicScript(stored: StoredScript): VoiceScript {
  const { previous, ...script } = stored;
  return { ...script, canUndo: Boolean(previous) };
}

export async function undoScript(id: string, revision?: string) {
  const current = await readRevision(id, revision);
  if (!current.previous) throw Error('There is no change to undo.');
  const { title, text, voiceID, sentences } = current.previous;
  return saveVoiceScript(title, text, voiceID, sentences, { id, revision, undo: true });
}

export async function replaceInScript(id: string, revision: string, find: string, replacement: string) {
  const script = await readRevision(id, revision);
  if (typeof find !== 'string' || typeof replacement !== 'string') throw Error('Enter the text to replace.');
  const changes = replacementPlan(script, find, replacement);
  if (!changes.length) throw Error('No matching sentences.');
  let text = script.text;
  const sentences = [...script.sentences];
  for (const change of changes.reverse()) {
    const spoken = spokenSentence(change.after);
    if (!spoken) throw Error('Replacement would empty a sentence. Use Remove sentence instead.');
    text = text.slice(0, change.from) + change.after + text.slice(change.to);
    sentences[change.index] = spoken;
  }
  return saveVoiceScript(script.title, text, script.voiceID, sentences, { id, revision });
}

export async function saveVoiceScript(title: string, text: string, voiceID: string, sentences: string[], edit?: { id: string; revision?: string; undo?: boolean }) {
  if (edit && (typeof edit.id !== 'string' || !/^[0-9a-f-]{36}$/i.test(edit.id))) throw Error('Invalid script ID.');
  const script: StoredScript = { revision: randomUUID(), id: edit?.id || randomUUID(), title: title.trim() || (sentences[0] || 'Untitled script').slice(0, 80), text, voiceID, sentences, createdAt: Date.now() };
  await mkdir(scriptsDir, { recursive: true });
  const target = scriptPath(script.id);
  const tmp = join(scriptsDir, script.revision + '.tmp');
  try {
    if (edit) {
      const previous = await readRevision(edit.id, edit.revision);
      if (!edit.undo) {
        const { title, text, voiceID, sentences } = previous;
        script.previous = { title, text, voiceID, sentences };
      }
      script.createdAt = previous.createdAt;
    }
    await writeFile(tmp, JSON.stringify(script), { flag: 'wx' });
    // Keep the revision check and publication together across requests in the local server.
    if (edit && JSON.parse(readFileSync(target, 'utf8')).revision !== edit.revision) {
      throw Error('This script changed in another window. Copy your edits and reload the latest version.');
    }
    renameSync(tmp, target);
  } finally { await rm(tmp, { force: true }); }
  return publicScript(script);
}

export async function changeScriptRow(id: string, revision: string | undefined, operation: string, index: number, value: string, cursor?: number) {
  const script = await readRevision(id, revision);
  const count = script.sentences.length;
  const firstInsert = operation === 'insert' && !count && index === -1;
  if (!Number.isInteger(index) || (!firstInsert && (index < 0 || index >= count))) throw Error('Invalid sentence position.');
  const sentences = [...script.sentences];
  // Keep paragraph separators in place. Leading stage directions travel with the
  // sentence they introduce, including when that sentence moves or is removed.
  const ranges = sourceRanges(script);
  const segments: string[] = [];
  const gaps: string[] = [];
  let end = 0;
  for (const range of ranges) {
    if (!range) throw Error('Could not locate this sentence in the original script.');
    const gap = script.text.slice(end, range.from);
    const whitespace = gap.match(/^\s*/u)![0];
    gaps.push(whitespace);
    segments.push(gap.slice(whitespace.length) + script.text.slice(range.from, range.to));
    end = range.to;
  }
  let tail = script.text.slice(end);
  if (count && tail.trim()) {
    const trimmed = tail.trimEnd();
    segments[count - 1] += trimmed;
    tail = tail.slice(trimmed.length);
  }
  if (operation === 'insert') {
    const raw = typeof value === 'string' ? value.trim() : '';
    const spoken = spokenSentence(raw);
    if (!spoken) throw Error('Enter a spoken sentence.');
    segments.splice(index + 1, 0, raw);
    sentences.splice(index + 1, 0, spoken);
    gaps.splice(index + 1, 0, firstInsert ? '' : ' ');
  } else if (operation === 'split' || operation === 'edit') {
    const range = ranges[index];
    if (!range || typeof value !== 'string') throw Error('Invalid sentence.');
    const original = script.text.slice(range.from, range.to);
    const prefixLength = range.from - (index ? ranges[index - 1]!.to : 0) - gaps[index].length;
    const prefix = segments[index].slice(0, prefixLength);
    const suffix = segments[index].slice(prefixLength + original.length);
    if (operation === 'edit') {
      if (!spokenSentence(value)) throw Error('Enter a spoken sentence.');
      segments[index] = prefix + value.trim() + suffix;
      sentences[index] = spokenSentence(segments[index]);
    } else {
      if (!Number.isInteger(cursor) || cursor! < 1 || cursor! >= value.length) throw Error('Place the cursor between the two parts.');
      const left = value.slice(0, cursor), right = value.slice(cursor);
      const pieces = [prefix + left.trimEnd(), right.trimStart() + suffix];
      const spoken = pieces.map(spokenSentence);
      if (spoken.some(part => !part) || spokenSentence(value) !== spoken.join(' ')) throw Error('Split between spoken words, outside stage directions.');
      segments.splice(index, 1, ...pieces);
      sentences.splice(index, 1, ...spoken);
      gaps.splice(index + 1, 0, ' ');
    }
  } else if (operation === 'merge') {
    if (index + 1 >= count) throw Error('No following sentence.');
    const merged = segments[index] + gaps[index + 1] + segments[index + 1];
    segments.splice(index, 2, merged);
    sentences.splice(index, 2, spokenSentence(merged));
    gaps.splice(index + 1, 1);
  } else if (operation === 'remove') {
    segments.splice(index, 1);
    sentences.splice(index, 1);
    if (index === 0 && count > 1) gaps.splice(1, 1);
    else gaps.splice(index, 1);
  } else {
    const other = operation === 'up' ? index - 1 : operation === 'down' ? index + 1 : -1;
    if (other < 0 || other >= count) throw Error('Invalid move.');
    [segments[index], segments[other]] = [segments[other], segments[index]];
    [sentences[index], sentences[other]] = [sentences[other], sentences[index]];
  }
  const text = segments.length ? segments.map((part, i) => gaps[i] + part).join('') + tail : '';
  return saveVoiceScript(script.title, text, script.voiceID, sentences, { id, revision });
}
