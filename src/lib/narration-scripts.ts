import { buildAuthHeader, getBaserowToken } from '@/lib/baserow-auth';

const SCRIPTS_TABLE_ID = '740';
const SCENES_TABLE_ID = '739';

export type NarrationScript = {
  id: number;
  title: string;
  outline: string;
  active: boolean;
  rank: number | null;
  status: string | null;
  date: string | null;
  lastEdited: string | null;
  sceneCount: number;
};

export type NarrationScriptScene = {
  id: number;
  sceneNumber: number;
  part: string | null;
  scriptIds: number[];
  narration: string;
  onScreen: string;
  annotation: string;
  code: string;
  language: string;
  targetFile: string;
  codeInstruction: string;
  lastEdited: string | null;
};

export type BaserowRow = Record<string, unknown> & { id?: unknown };

function numberValue(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function stringValue(value: unknown): string {
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return '';
}

function optionalString(value: unknown): string | null {
  const result = stringValue(value).trim();
  return result ? result : null;
}

function selectValue(value: unknown): string | null {
  if (typeof value === 'string') return optionalString(value);
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return optionalString((value as Record<string, unknown>).value);
  }
  return null;
}

function linkedIds(value: unknown): number[] {
  const values = Array.isArray(value) ? value : value ? [value] : [];
  return values.flatMap((entry) => {
    if (typeof entry === 'number' && Number.isSafeInteger(entry)) return [entry];
    if (typeof entry === 'string') {
      const parsed = Number(entry);
      return Number.isSafeInteger(parsed) ? [parsed] : [];
    }
    if (entry && typeof entry === 'object') {
      const candidate = (entry as Record<string, unknown>).id;
      const parsed = numberValue(candidate);
      return parsed !== null && Number.isSafeInteger(parsed) ? [parsed] : [];
    }
    return [];
  });
}

async function fetchRows(tableId: string): Promise<BaserowRow[]> {
  const baseUrl = process.env.BASEROW_API_URL?.trim().replace(/\/$/, '');
  if (!baseUrl) throw new Error('Missing BASEROW_API_URL configuration.');

  const token = await getBaserowToken();
  const rows: BaserowRow[] = [];
  let page = 1;

  while (true) {
    const query = new URLSearchParams({
      user_field_names: 'true',
      size: '200',
      page: String(page),
    });
    const response = await fetch(
      `${baseUrl}/database/rows/table/${tableId}/?${query.toString()}`,
      { headers: { ...buildAuthHeader(token), 'Content-Type': 'application/json' }, cache: 'no-store' },
    );
    if (!response.ok) {
      const detail = await response.text().catch(() => '');
      throw new Error(`Baserow request failed (${response.status}): ${detail}`);
    }
    const payload = (await response.json()) as { results?: unknown; next?: unknown };
    if (!Array.isArray(payload.results)) throw new Error('Baserow returned an invalid rows response.');
    rows.push(...(payload.results as BaserowRow[]));
    if (!payload.next) break;
    page += 1;
  }
  return rows;
}

function mapScripts(rows: BaserowRow[], sceneRows: NarrationScriptScene[]): NarrationScript[] {
  return rows
    .map((row) => {
      const id = numberValue(row.id);
      const title = stringValue(row['Script Title']).trim();
      if (id === null || !title) return null;
      return {
        id,
        title,
        outline: stringValue(row.Outline),
        active: row.Active === true,
        rank: numberValue(row.Rank),
        status: selectValue(row.Status),
        date: optionalString(row.Date),
        lastEdited: optionalString(row['Last Edited']),
        sceneCount: sceneRows.filter((scene) => scene.scriptIds.includes(id)).length,
      } satisfies NarrationScript;
    })
    .filter((script): script is NarrationScript => script !== null)
    .sort((left, right) => {
      const leftRank = left.rank ?? Number.MAX_SAFE_INTEGER;
      const rightRank = right.rank ?? Number.MAX_SAFE_INTEGER;
      return leftRank - rightRank || left.title.localeCompare(right.title);
    });
}

export function mapNarrationScriptSceneRow(row: BaserowRow): NarrationScriptScene | null {
  const id = numberValue(row.id);
  const sceneNumber = numberValue(row['Scene Number']);
  if (id === null || sceneNumber === null) return null;
  return {
    id,
    sceneNumber,
    part: selectValue(row.Part),
    scriptIds: linkedIds(row.Script),
    narration: stringValue(row.Narration),
    onScreen: stringValue(row['On Screen']),
    annotation: stringValue(row.Annotation),
    code: stringValue(row.Code),
    language: selectValue(row.Language) ?? stringValue(row.Language),
    targetFile: stringValue(row['Target File']),
    codeInstruction: stringValue(row['Code Instruction']),
    lastEdited: optionalString(row['Last Edited']),
  } satisfies NarrationScriptScene;
}

function mapScenes(rows: BaserowRow[]): NarrationScriptScene[] {
  return rows
    .map(mapNarrationScriptSceneRow)
    .filter((scene): scene is NarrationScriptScene => scene !== null)
    .sort((left, right) => left.sceneNumber - right.sceneNumber || left.id - right.id);
}

export async function getNarrationScriptsData() {
  const [scriptRows, sceneRows] = await Promise.all([
    fetchRows(SCRIPTS_TABLE_ID),
    fetchRows(SCENES_TABLE_ID),
  ]);
  const scenes = mapScenes(sceneRows);
  return { scripts: mapScripts(scriptRows, scenes), scenes };
}
