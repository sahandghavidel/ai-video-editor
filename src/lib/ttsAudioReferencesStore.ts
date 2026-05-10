import { randomUUID } from 'crypto';
import { promises as fs } from 'fs';
import path from 'path';

export interface TtsAudioReferenceEntry {
  id: string;
  name: string;
  filename: string;
  language: string;
  referenceText: string;
  description: string;
  tags: string[];
  isDefault: boolean;
  enabled: boolean;
  updatedAt: string;
}

export interface TtsAudioReferencesStore {
  entries: TtsAudioReferenceEntry[];
}

const STORE_FILE_PATH = path.join(
  process.cwd(),
  'src',
  'data',
  'tts-audio-references.json',
);

const EMPTY_STORE: TtsAudioReferencesStore = {
  entries: [],
};

function createEntryId(): string {
  try {
    return randomUUID();
  } catch {
    return `audio-ref-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
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

export function sanitizeTtsAudioReferenceEntries(
  input: unknown,
): TtsAudioReferenceEntry[] {
  if (!Array.isArray(input)) return [];

  const byId = new Map<string, TtsAudioReferenceEntry>();

  for (const rawEntry of input) {
    if (!rawEntry || typeof rawEntry !== 'object') continue;

    const entry = rawEntry as Record<string, unknown>;

    const filename =
      typeof entry.filename === 'string' ? entry.filename.trim() : '';
    if (!filename) continue;

    const id =
      typeof entry.id === 'string' && entry.id.trim().length > 0
        ? entry.id.trim()
        : createEntryId();

    const languageRaw =
      typeof entry.language === 'string' ? entry.language.trim() : '';
    const language = languageRaw ? languageRaw.toLowerCase() : 'und';

    const nameRaw = typeof entry.name === 'string' ? entry.name.trim() : '';
    const name = nameRaw || filename;

    const referenceText =
      typeof entry.referenceText === 'string' ? entry.referenceText : '';

    const description =
      typeof entry.description === 'string' ? entry.description : '';

    const tags = Array.isArray(entry.tags)
      ? Array.from(
          new Set(
            entry.tags
              .filter((tag): tag is string => typeof tag === 'string')
              .map((tag) => tag.trim())
              .filter(Boolean),
          ),
        )
      : [];

    const isDefault = Boolean(entry.isDefault);
    const enabled = typeof entry.enabled === 'boolean' ? entry.enabled : true;

    const updatedAt =
      typeof entry.updatedAt === 'string' && entry.updatedAt.trim().length > 0
        ? entry.updatedAt
        : new Date().toISOString();

    byId.set(id, {
      id,
      name,
      filename,
      language,
      referenceText,
      description,
      tags,
      isDefault,
      enabled,
      updatedAt,
    });
  }

  return Array.from(byId.values());
}

export async function loadTtsAudioReferencesStore(): Promise<TtsAudioReferencesStore> {
  await ensureStoreFile();

  try {
    const content = await fs.readFile(STORE_FILE_PATH, 'utf8');
    const parsed = JSON.parse(content) as { entries?: unknown };
    const entries = sanitizeTtsAudioReferenceEntries(parsed?.entries);

    return { entries };
  } catch {
    return { entries: [] };
  }
}
