import { execFile } from 'node:child_process';
import { createReadStream } from 'node:fs';
import { mkdtemp, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { promisify } from 'node:util';
import { existingSentence, voiceAudio } from './voice-manager';
import { readRevision } from './voice-scripts';

const exec = promisify(execFile);
export async function exportApprovedWav(id: string, revision: string) {
  const script = await readRevision(id, revision);
  if (!script.sentences.length) throw Error('Add a sentence before exporting.');
  const recordings = new Map<string, { folder: string; take: string } | null>();
  const missing: number[] = [];
  for (const [index, line] of script.sentences.entries()) {
    if (!recordings.has(line)) {
      const group = await existingSentence(line, script.voiceID);
      const take = group?.takes.find(t => t.status === 'Current approval');
      recordings.set(line, group && take ? { folder: group.folder, take: take.id } : null);
    }
    if (!recordings.get(line)) missing.push(index + 1);
  }
  if (missing.length) throw Error('Approve sentences ' + missing.join(', ') + ' before exporting.');
  const dir = await mkdtemp(join(tmpdir(), 'approved-voiceover-'));
  try {
    const sources = new Map<string, string>();
    const manifest: string[] = [];
    async function add(key: string, args: () => Promise<string[]>) {
      let filename = sources.get(key);
      if (!filename) {
        filename = sources.size + '.wav';
        await exec('ffmpeg', ['-nostdin', '-loglevel', 'error', '-y', ...await args(), '-ac', '1', '-ar', '24000', '-c:a', 'pcm_s16le', filename], { cwd: dir });
        sources.set(key, filename);
      }
      manifest.push('file ' + filename);
    }
    for (const [index, line] of script.sentences.entries()) {
      const recording = recordings.get(line)!;
      await add(recording.take, async () => {
        await writeFile(join(dir, 'input.wav'), await voiceAudio(recording.folder, recording.take));
        return ['-i', 'input.wav'];
      });
      const pause = script.directions?.[index]?.pause || 0;
      if (pause && index < script.sentences.length - 1) {
        await add('pause-' + pause, async () => ['-f', 'lavfi', '-i', 'anullsrc=r=24000:cl=mono', '-t', String(pause)]);
      }
    }
    await writeFile(join(dir, 'parts.txt'), manifest.join('\n'));
    await exec('ffmpeg', ['-nostdin', '-loglevel', 'error', '-f', 'concat', '-i', 'parts.txt', '-c', 'copy', 'voiceover.wav'], { cwd: dir });
    const path = join(dir, 'voiceover.wav');
    const size = (await stat(path)).size;
    const stream = createReadStream(path);
    stream.once('close', () => { void rm(dir, { recursive: true, force: true }).catch(console.error); });
    return new Response(Readable.toWeb(stream) as ReadableStream<Uint8Array>, { headers: {
      'Content-Type': 'audio/wav', 'Content-Length': String(size), 'Cache-Control': 'no-store',
      'Content-Disposition': "attachment; filename*=UTF-8''" + encodeURIComponent(script.title.replace(/[/\\]/g, '-') + '.wav'),
    } });
  } catch (error) { await rm(dir, { recursive: true, force: true }); throw error; }
}
