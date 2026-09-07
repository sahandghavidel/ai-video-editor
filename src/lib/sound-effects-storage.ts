import { getAuthHeader } from '@/lib/baserow-auth';
import type { SoundEffect } from '@/lib/sound-effects';

const table = 738;

export async function soundEffectsRequest(path: string, init: RequestInit = {}) {
  const base = process.env.BASEROW_API_URL;
  if (!base) throw new Error('Baserow is not configured.');
  const run = async (refresh = false) => fetch(`${base}/database/rows/table/${table}/${path}`, {
    ...init,
    cache: 'no-store',
    headers: { 'Content-Type': 'application/json', ...await getAuthHeader(refresh) },
  });
  let response = await run();
  if (response.status === 401) response = await run(true);
  if (!response.ok) throw new Error(`Sound Effects Library storage request failed (${response.status}).`);
  return response;
}

function number(value: unknown, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export function soundEffect(row: Record<string, unknown>): SoundEffect {
  const status = row.Status as { value?: string } | string | null;
  const statusValue = typeof status === 'string' ? status : status?.value;
  return {
    id: Number(row.id),
    name: String(row.Name || ''),
    description: String(row.Description || ''),
    filePath: String(row['File Path'] || ''),
    durationSeconds: number(row['Duration (seconds)']),
    defaultVolumeDb: number(row['Default Volume (dB)'], -18),
    syncPointSeconds: number(row['Sync Point (seconds)']),
    tags: String(row.Tags || ''),
    usageRules: String(row['Usage Rules'] || ''),
    sourceCredit: String(row['Source / Credit'] || ''),
    license: String(row.License || ''),
    status: statusValue === 'Approved' ? 'Approved' : 'Draft',
  };
}

export async function listSoundEffects(): Promise<SoundEffect[]> {
  const sounds: SoundEffect[] = [];
  for (let page = 1; ; page++) {
    const data = await (await soundEffectsRequest(`?user_field_names=true&size=200&page=${page}`)).json();
    sounds.push(...data.results.map(soundEffect));
    if (!data.next) break;
  }
  return sounds.filter(sound => sound.name || sound.filePath);
}
