import { randomUUID } from 'crypto';
import { promises as fs } from 'fs';
import path from 'path';

export interface TtsWordReplacementEntry {
  id: string;
  word: string;
  replacement: string;
  updatedAt: string;
}

export interface TtsWordReplacementsStore {
  entries: TtsWordReplacementEntry[];
}

const STORE_FILE_PATH = path.join(
  process.cwd(),
  'src',
  'data',
  'tts-word-replacements.json',
);

const EMPTY_STORE: TtsWordReplacementsStore = {
  entries: [],
};

function createEntryId(): string {
  try {
    return randomUUID();
  } catch {
    return `entry-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  }
}

async function ensureStoreFile(): Promise<void> {
  await fs.mkdir(path.dirname(STORE_FILE_PATH), { recursive: true });

  try {
    await fs.access(STORE_FILE_PATH);
  } catch {
    await fs.writeFile(
      STORE_FILE_PATH,
      JSON.stringify(EMPTY_STORE, null, 2),
      'utf8',
    );
  }
}

async function writeStore(entries: TtsWordReplacementEntry[]): Promise<void> {
  const payload: TtsWordReplacementsStore = { entries };
  await fs.writeFile(STORE_FILE_PATH, JSON.stringify(payload, null, 2), 'utf8');
}

export function sanitizeTtsWordReplacementEntries(
  input: unknown,
): TtsWordReplacementEntry[] {
  if (!Array.isArray(input)) return [];

  const byWord = new Map<string, TtsWordReplacementEntry>();

  for (const rawEntry of input) {
    if (!rawEntry || typeof rawEntry !== 'object') continue;

    const entry = rawEntry as Record<string, unknown>;
    const word = typeof entry.word === 'string' ? entry.word : '';
    const replacement =
      typeof entry.replacement === 'string' ? entry.replacement : '';

    // Preserve leading/trailing spaces exactly as entered, but reject
    // entries that contain only whitespace.
    if (word.trim().length === 0 || replacement.trim().length === 0) continue;

    const id =
      typeof entry.id === 'string' && entry.id.trim().length > 0
        ? entry.id.trim()
        : createEntryId();

    const updatedAt =
      typeof entry.updatedAt === 'string' && entry.updatedAt.trim().length > 0
        ? entry.updatedAt
        : new Date().toISOString();

    // Exact-case word key (case-sensitive dictionary behavior).
    byWord.set(word, {
      id,
      word,
      replacement,
      updatedAt,
    });
  }

  return Array.from(byWord.values());
}

export async function loadTtsWordReplacementsStore(): Promise<TtsWordReplacementsStore> {
  await ensureStoreFile();

  try {
    const content = await fs.readFile(STORE_FILE_PATH, 'utf8');
    const parsed = JSON.parse(content) as { entries?: unknown };
    const entries = sanitizeTtsWordReplacementEntries(parsed?.entries);

    return { entries };
  } catch {
    await writeStore([]);
    return { entries: [] };
  }
}

export async function saveTtsWordReplacementsStore(
  entriesInput: unknown,
): Promise<TtsWordReplacementsStore> {
  await ensureStoreFile();

  const entries = sanitizeTtsWordReplacementEntries(entriesInput).map(
    (entry) => ({
      ...entry,
      updatedAt: new Date().toISOString(),
    }),
  );

  await writeStore(entries);
  return { entries };
}
