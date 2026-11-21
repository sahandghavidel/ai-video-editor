import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import {
  defaultPipelineConfig,
  normalizePipelineConfig,
  type PipelineTemplate,
} from './pipelineConfig';

const storePath = path.join(process.cwd(), 'src', 'data', 'pipeline-templates.json');

export function parsePipelineTemplate(value: unknown): PipelineTemplate | null {
  if (!value || typeof value !== 'object') return null;

  const template = value as Record<string, unknown>;
  const name = typeof template.name === 'string' ? template.name.trim() : '';
  if (!name) return null;

  const source = template.config && typeof template.config === 'object'
    ? template.config as Record<string, unknown>
    : {};
  const config = Object.fromEntries(
    Object.entries(defaultPipelineConfig).map(([key, fallback]) => {
      const value = source[key];
      const valid = typeof value === 'boolean' && typeof fallback === 'boolean'
        || typeof value === 'number' && typeof fallback === 'number' && Number.isFinite(value);
      return [key, valid ? value : fallback];
    }),
  );
  const createdAt = typeof template.createdAt === 'string' && template.createdAt.trim()
    ? template.createdAt
    : new Date().toISOString();

  return {
    id: typeof template.id === 'string' ? template.id.trim() : '',
    name,
    config: normalizePipelineConfig(config, []),
    createdAt,
    updatedAt: typeof template.updatedAt === 'string' && template.updatedAt.trim()
      ? template.updatedAt
      : createdAt,
  };
}

function snapshot(templates: PipelineTemplate[]) {
  const revision = createHash('sha256').update(JSON.stringify(templates)).digest('hex');
  return { templates, revision };
}

export async function readPipelineTemplates() {
  let raw: string;
  try {
    raw = await readFile(storePath, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return snapshot([]);
    throw error;
  }

  const values: unknown = JSON.parse(raw);
  if (!Array.isArray(values)) throw new Error('Invalid pipeline template file');
  const templates = values.map(parsePipelineTemplate);
  if (!templates.every(template => template?.id)) {
    throw new Error('Invalid template in pipeline template file');
  }
  return snapshot(templates as PipelineTemplate[]);
}

let pendingWrite = Promise.resolve();

function mutatePipelineTemplates(
  update: (current: Awaited<ReturnType<typeof readPipelineTemplates>>) => PipelineTemplate[] | null,
) {
  const operation = pendingWrite.then(async () => {
    const current = await readPipelineTemplates();
    const next = update(current);
    if (next === null) return { ...current, conflict: true };

    const result = snapshot(next);
    if (result.revision !== current.revision) {
      await mkdir(path.dirname(storePath), { recursive: true });
      const tempPath = `${storePath}.${randomUUID()}.tmp`;
      try {
        await writeFile(tempPath, JSON.stringify(next, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
        await rename(tempPath, storePath);
      } finally {
        await rm(tempPath, { force: true });
      }
    }
    return { ...result, conflict: false };
  });
  pendingWrite = operation.then(() => undefined, () => undefined);
  return operation;
}

export function replacePipelineTemplates(revision: string, templates: PipelineTemplate[]) {
  return mutatePipelineTemplates(current => current.revision === revision ? templates : null);
}

export function importPipelineTemplates(incoming: PipelineTemplate[]) {
  return mutatePipelineTemplates(({ templates }) => {
    const next = [...templates];
    const byName = new Map(next.map(template => [template.name.toLowerCase(), template]));
    const ids = new Set(next.map(template => template.id));

    for (const template of incoming) {
      const config = JSON.stringify(template.config);
      let name = template.name;
      let existing = byName.get(name.toLowerCase());
      let suffix = 1;
      while (existing && JSON.stringify(existing.config) !== config) {
        name = suffix === 1 ? `${template.name} (imported)` : `${template.name} (imported ${suffix})`;
        existing = byName.get(name.toLowerCase());
        suffix += 1;
      }
      if (existing) continue;

      const id = template.id && !ids.has(template.id) ? template.id : randomUUID();
      const imported = { ...template, id, name };
      next.push(imported);
      ids.add(id);
      byName.set(name.toLowerCase(), imported);
    }

    return next;
  });
}
