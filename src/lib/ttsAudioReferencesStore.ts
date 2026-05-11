import { randomUUID } from 'crypto';
import { promises as fs } from 'fs';
import path from 'path';

export type OmniVoiceDeviceMap = 'mps' | 'cpu' | 'auto';
export type OmniVoiceDType = 'float16' | 'float32' | 'bfloat16';

export interface LanguageBaserowFields {
  videoSrtFieldKey: string;
  videoReferenceSrtFieldKey: string;
  videoFinalDubbedAudioFieldKey?: string;
  sceneDurationFieldKey: string;
  sceneReferenceSentenceFieldKey: string;
  sceneTargetSentenceFieldKey: string;
  sceneDubbedAudioFieldKey: string;
  sceneOriginalAudioFieldKey?: string;
}

export interface TtsAudioReferenceEntry {
  id: string;
  name: string;
  filename: string;
  language: string;
  referenceText: string;
  baserowFields: LanguageBaserowFields;
  deviceMap: OmniVoiceDeviceMap;
  dtype: OmniVoiceDType;
  numStep: number;
  speed: number;
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

const FIELD_KEY_REGEX = /^field_\d+$/;

const DEFAULT_LANGUAGE_BASEROW_FIELDS: LanguageBaserowFields = {
  videoSrtFieldKey: 'field_7112',
  videoReferenceSrtFieldKey: 'field_6872',
  sceneDurationFieldKey: 'field_7107',
  sceneReferenceSentenceFieldKey: 'field_6890',
  sceneTargetSentenceFieldKey: 'field_7110',
  sceneDubbedAudioFieldKey: 'field_7111',
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

async function writeStore(entries: TtsAudioReferenceEntry[]): Promise<void> {
  const payload: TtsAudioReferencesStore = { entries };
  await fs.writeFile(STORE_FILE_PATH, JSON.stringify(payload, null, 2), 'utf8');
}

function toNumber(value: unknown, fallback: number): number {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim().length > 0) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
  }

  return fallback;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function asDeviceMap(value: unknown): OmniVoiceDeviceMap {
  return value === 'cpu' || value === 'auto' || value === 'mps' ? value : 'mps';
}

function asDType(value: unknown): OmniVoiceDType {
  return value === 'float16' || value === 'float32' || value === 'bfloat16'
    ? value
    : 'float32';
}

function asFieldKey(value: unknown, fallback: string): string {
  if (typeof value !== 'string') return fallback;

  const trimmed = value.trim();
  return FIELD_KEY_REGEX.test(trimmed) ? trimmed : fallback;
}

function asOptionalFieldKey(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;

  const trimmed = value.trim();
  if (!trimmed) return undefined;

  return FIELD_KEY_REGEX.test(trimmed) ? trimmed : undefined;
}

function sanitizeLanguageBaserowFields(value: unknown): LanguageBaserowFields {
  const fields =
    value && typeof value === 'object'
      ? (value as Record<string, unknown>)
      : {};

  return {
    videoSrtFieldKey: asFieldKey(
      fields.videoSrtFieldKey,
      DEFAULT_LANGUAGE_BASEROW_FIELDS.videoSrtFieldKey,
    ),
    videoReferenceSrtFieldKey: asFieldKey(
      fields.videoReferenceSrtFieldKey,
      DEFAULT_LANGUAGE_BASEROW_FIELDS.videoReferenceSrtFieldKey,
    ),
    videoFinalDubbedAudioFieldKey: asOptionalFieldKey(
      fields.videoFinalDubbedAudioFieldKey,
    ),
    sceneDurationFieldKey: asFieldKey(
      fields.sceneDurationFieldKey,
      DEFAULT_LANGUAGE_BASEROW_FIELDS.sceneDurationFieldKey,
    ),
    sceneReferenceSentenceFieldKey: asFieldKey(
      fields.sceneReferenceSentenceFieldKey,
      DEFAULT_LANGUAGE_BASEROW_FIELDS.sceneReferenceSentenceFieldKey,
    ),
    sceneTargetSentenceFieldKey: asFieldKey(
      fields.sceneTargetSentenceFieldKey,
      DEFAULT_LANGUAGE_BASEROW_FIELDS.sceneTargetSentenceFieldKey,
    ),
    sceneDubbedAudioFieldKey: asFieldKey(
      fields.sceneDubbedAudioFieldKey,
      DEFAULT_LANGUAGE_BASEROW_FIELDS.sceneDubbedAudioFieldKey,
    ),
    sceneOriginalAudioFieldKey: asOptionalFieldKey(
      fields.sceneOriginalAudioFieldKey,
    ),
  };
}

function normalizeDefaultsPerLanguage(
  entries: TtsAudioReferenceEntry[],
): TtsAudioReferenceEntry[] {
  const seenLanguageDefault = new Set<string>();

  return entries.map((entry) => {
    if (!entry.isDefault) return entry;

    const key = entry.language.toLowerCase();
    if (seenLanguageDefault.has(key)) {
      return { ...entry, isDefault: false };
    }

    seenLanguageDefault.add(key);
    return entry;
  });
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

    const baserowFields = sanitizeLanguageBaserowFields(entry.baserowFields);

    const deviceMap = asDeviceMap(entry.deviceMap);
    const dtype = asDType(entry.dtype);
    const numStep = Math.round(clamp(toNumber(entry.numStep, 64), 8, 64));
    const speed = clamp(toNumber(entry.speed, 1), 0.5, 2);

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
      baserowFields,
      deviceMap,
      dtype,
      numStep,
      speed,
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
    const entries = normalizeDefaultsPerLanguage(
      sanitizeTtsAudioReferenceEntries(parsed?.entries),
    );

    return { entries };
  } catch {
    return { entries: [] };
  }
}

export async function saveTtsAudioReferencesStore(
  entriesInput: unknown,
): Promise<TtsAudioReferencesStore> {
  await ensureStoreFile();

  const nowIso = new Date().toISOString();
  const entries = normalizeDefaultsPerLanguage(
    sanitizeTtsAudioReferenceEntries(entriesInput).map((entry) => ({
      ...entry,
      updatedAt: nowIso,
    })),
  );

  await writeStore(entries);
  return { entries };
}
