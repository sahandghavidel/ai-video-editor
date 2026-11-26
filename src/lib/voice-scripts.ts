import { spokenSentence } from './voice-manager';
import { sourceRanges } from './voice-script-ranges';
import { readFileSync, renameSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';

export type VoiceScript = { id: string; title: string; text: string; voiceID: string; sentences: string[]; createdAt: number; revision?: string };
const scriptsDir = join(homedir(), 'Library/Application Support/ultimate-video-editr/voice-scripts');

export async function listVoiceScripts(): Promise<VoiceScript[]> {
  let names: string[];
  try { names = await readdir(scriptsDir); }
  catch (e) { if ((e as NodeJS.ErrnoException).code === 'ENOENT') return []; throw e; }
  const scripts: VoiceScript[] = await Promise.all(names.filter(name => name.endsWith('.json')).map(async name =>
    JSON.parse(await readFile(join(scriptsDir, name), 'utf8'))));
  return scripts.sort((a, b) => b.createdAt - a.createdAt);
}

export async function saveVoiceScript(title: string, text: string, voiceID: string, sentences: string[], edit?: { id: string; revision?: string }) {
  if (edit && (typeof edit.id !== 'string' || !/^[0-9a-f-]{36}$/i.test(edit.id))) throw Error('Invalid script ID.');
  const script: VoiceScript = { revision: randomUUID(), id: edit?.id || randomUUID(), title: title.trim() || (sentences[0] || 'Untitled script').slice(0, 80), text, voiceID, sentences, createdAt: Date.now() };
  await mkdir(scriptsDir, { recursive: true });
  const target = join(scriptsDir, script.id + '.json');
  const tmp = join(scriptsDir, script.revision + '.tmp');
  try {
    if (edit) {
      const previous: VoiceScript = JSON.parse(await readFile(target, 'utf8'));
      script.createdAt = previous.createdAt;
    }
    await writeFile(tmp, JSON.stringify(script), { flag: 'wx' });
    // Keep the revision check and publication together across requests in the local server.
    if (edit && JSON.parse(readFileSync(target, 'utf8')).revision !== edit.revision) {
      throw Error('This script changed in another window. Copy your edits and reload the latest version.');
    }
    renameSync(tmp, target);
  } finally { await rm(tmp, { force: true }); }
  return script;
}

export async function changeScriptRow(id: string, revision: string | undefined, operation: string, index: number, value: string) {
  if (typeof id !== 'string' || !/^[0-9a-f-]{36}$/i.test(id)) throw Error('Invalid script ID.');
  const script: VoiceScript = JSON.parse(await readFile(join(scriptsDir, id + '.json'), 'utf8'));
  if (script.revision !== revision) throw Error('Script changed. Reload before editing.');
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
