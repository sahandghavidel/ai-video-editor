import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';

export interface PipelineLanguagePreset {
  name: string;
  languages: string[];
}

const storePath = path.join(process.cwd(), 'src', 'data', 'pipeline-language-presets.json');

export function parseLanguagePreset(value: unknown): PipelineLanguagePreset | null {
  if (!value || typeof value !== 'object') return null;
  const { name, languages } = value as Record<string, unknown>;
  if (typeof name !== 'string' || !name.trim() || !Array.isArray(languages)) return null;
  if (!languages.every((code) => typeof code === 'string' && /^[a-z]{2,3}(?:-[a-z0-9]+)*$/i.test(code.trim()))) return null;
  const ordered = [...new Set(languages.map((code: string) => code.trim().toLowerCase()))];
  return ordered.length ? { name: name.trim(), languages: ordered } : null;
}

export async function readLanguagePresets(): Promise<PipelineLanguagePreset[]> {
  let raw: string;
  try {
    raw = await readFile(storePath, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw error;
  }
  const data: unknown = JSON.parse(raw);
  if (!Array.isArray(data)) throw new Error('Invalid language preset file');
  return data.map((value: unknown) => {
    const preset = parseLanguagePreset(value);
    if (!preset) throw new Error('Invalid preset in language preset file');
    return preset;
  });
}

type PresetAction = 'create' | 'update' | 'import';

let pendingWrite = Promise.resolve();

export function writeLanguagePresets(action: PresetAction, incoming: PipelineLanguagePreset[]) {
  const operation = pendingWrite.then(async () => {
    const presets = await readLanguagePresets();
    const conflicts: string[] = [];
    let changed = false;
    for (const next of incoming) {
      const index = presets.findIndex((preset) => preset.name.toLowerCase() === next.name.toLowerCase());
      const existing = presets[index];
      if (action === 'import' && existing) {
        if (existing.languages.join(',') !== next.languages.join(',')) conflicts.push(next.name);
        continue;
      }
      if (action === 'create' && existing) return { presets, conflicts: [next.name] };
      if (action === 'update' && !existing) return { presets, conflicts: [next.name] };
      if (existing) presets[index] = next;
      else presets.push(next);
      changed = true;
    }
    if (changed) {
      await mkdir(path.dirname(storePath), { recursive: true });
      const tempPath = `${storePath}.${randomUUID()}.tmp`;
      try {
        await writeFile(tempPath, JSON.stringify(presets, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
        await rename(tempPath, storePath);
      } finally {
        await rm(tempPath, { force: true });
      }
    }
    return { presets, conflicts };
  });
  pendingWrite = operation.then(() => undefined, () => undefined);
  return operation;
}
