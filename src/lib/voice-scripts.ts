import { randomUUID } from 'node:crypto';
import { mkdir, readdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';

export type VoiceScript = { id: string; title: string; text: string; voiceID: string; sentences: string[]; createdAt: number };
const scriptsDir = join(homedir(), 'Library/Application Support/ultimate-video-editr/voice-scripts');

export async function listVoiceScripts(): Promise<VoiceScript[]> {
  let names: string[];
  try { names = await readdir(scriptsDir); }
  catch (e) { if ((e as NodeJS.ErrnoException).code === 'ENOENT') return []; throw e; }
  const scripts: VoiceScript[] = await Promise.all(names.filter(name => name.endsWith('.json')).map(async name =>
    JSON.parse(await readFile(join(scriptsDir, name), 'utf8'))));
  return scripts.sort((a, b) => b.createdAt - a.createdAt);
}

export async function saveVoiceScript(title: string, text: string, voiceID: string, sentences: string[]) {
  const script: VoiceScript = { id: randomUUID(), title: title.trim() || sentences[0].slice(0, 80), text, voiceID, sentences, createdAt: Date.now() };
  await mkdir(scriptsDir, { recursive: true });
  const tmp = join(scriptsDir, script.id + '.tmp');
  try {
    await writeFile(tmp, JSON.stringify(script), { flag: 'wx' });
    await rename(tmp, join(scriptsDir, script.id + '.json'));
  } finally { await rm(tmp, { force: true }); }
  return script;
}
