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
type PresetResult = { presets: PipelineLanguagePreset[]; conflicts: string[]; error?: string };

let pendingWrite = Promise.resolve();

function mutateLanguagePresets(
  apply: (presets: PipelineLanguagePreset[]) => { changed: boolean; conflicts?: string[]; error?: string },
): Promise<PresetResult> {
  const operation = pendingWrite.then(async () => {
    const presets = await readLanguagePresets();
    const { changed, conflicts = [], error } = apply(presets);
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
    return { presets, conflicts, error };
  });
  pendingWrite = operation.then(() => undefined, () => undefined);
  return operation;
}

function findPreset(presets: PipelineLanguagePreset[], name: string) {
  return presets.findIndex((preset) => preset.name.toLowerCase() === name.toLowerCase());
}

function matchesSnapshot(current: PipelineLanguagePreset, expected: PipelineLanguagePreset) {
  return current.name === expected.name && current.languages.join(',') === expected.languages.join(',');
}

export function writeLanguagePresets(
  action: PresetAction,
  incoming: PipelineLanguagePreset[],
  expected?: PipelineLanguagePreset,
) {
  return mutateLanguagePresets((presets) => {
    const conflicts: string[] = [];
    let changed = false;

    for (const next of incoming) {
      const index = findPreset(presets, next.name);
      const existing = presets[index];
      if (action === 'import' && existing) {
        if (existing.languages.join(',') !== next.languages.join(',')) conflicts.push(next.name);
        continue;
      }
      if (action === 'create' && existing) {
        return { changed: false, error: 'That preset name is already in use.' };
      }
      if (action === 'update' && (!existing || (expected && !matchesSnapshot(existing, expected)))) {
        return { changed: false, error: 'This preset changed in another browser. Review the refreshed list and try again.' };
      }
      if (existing) presets[index] = next;
      else presets.push(next);
      changed = true;
    }
    return { changed, conflicts };
  });
}

export function manageLanguagePreset(
  action: 'duplicate' | 'rename' | 'delete',
  source: PipelineLanguagePreset,
  name: string,
) {
  return mutateLanguagePresets((presets) => {
    const index = findPreset(presets, source.name);
    const current = presets[index];
    if (!current || !matchesSnapshot(current, source)) {
      return { changed: false, error: 'This preset changed in another browser. Review the refreshed list and try again.' };
    }

    if (action === 'delete') {
      presets.splice(index, 1);
      return { changed: true };
    }

    const targetIndex = findPreset(presets, name);
    if (targetIndex >= 0 && (action === 'duplicate' || targetIndex !== index)) {
      return { changed: false, error: 'That preset name is already in use.' };
    }

    const next = { name, languages: current.languages };
    if (action === 'duplicate') presets.push(next);
    else presets[index] = next;
    return { changed: true };
  });
}
