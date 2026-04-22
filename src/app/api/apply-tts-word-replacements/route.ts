import { NextResponse } from 'next/server';
import {
  loadTtsWordReplacementsStore,
  TtsWordReplacementEntry,
} from '@/lib/ttsWordReplacementsStore';

export const runtime = 'nodejs';

const SCENES_TABLE_ID = '714';
const PAGE_SIZE = 200;
const WORD_CHAR_CLASS = 'A-Za-z0-9_';

type BaserowSceneRow = Record<string, unknown> & {
  id?: unknown;
  field_6890?: unknown;
};

type PreparedReplacement = TtsWordReplacementEntry & {
  pattern: RegExp;
};

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function prepareReplacements(
  entries: TtsWordReplacementEntry[],
): PreparedReplacement[] {
  return entries.map((entry) => ({
    ...entry,
    pattern: new RegExp(
      `(^|[^${WORD_CHAR_CLASS}])(${escapeRegExp(entry.word)})(?=$|[^${WORD_CHAR_CLASS}])`,
      'g',
    ),
  }));
}

function applyReplacementsToSentence(
  sentence: string,
  replacements: PreparedReplacement[],
): { text: string; substitutions: number } {
  let updated = sentence;
  let substitutions = 0;

  for (const replacement of replacements) {
    updated = updated.replace(replacement.pattern, (_match, prefix: string) => {
      substitutions += 1;
      return `${prefix}${replacement.replacement}`;
    });
  }

  return {
    text: updated,
    substitutions,
  };
}

async function getJWTToken(): Promise<string> {
  const baserowUrl = process.env.BASEROW_API_URL;
  const email = process.env.BASEROW_EMAIL;
  const password = process.env.BASEROW_PASSWORD;

  if (!baserowUrl || !email || !password) {
    throw new Error('Missing Baserow configuration');
  }

  const response = await fetch(`${baserowUrl}/user/token-auth/`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });

  if (!response.ok) {
    const errorText = await response.text().catch(() => '');
    throw new Error(`Authentication failed: ${response.status} ${errorText}`);
  }

  const data = (await response.json().catch(() => null)) as {
    token?: unknown;
  } | null;

  if (!data || typeof data.token !== 'string' || !data.token.trim()) {
    throw new Error('Authentication response does not contain a valid token');
  }

  return data.token;
}

async function fetchAllScenes(
  baserowUrl: string,
  token: string,
): Promise<BaserowSceneRow[]> {
  const allScenes: BaserowSceneRow[] = [];
  let page = 1;

  while (true) {
    const response = await fetch(
      `${baserowUrl}/database/rows/table/${SCENES_TABLE_ID}/?size=${PAGE_SIZE}&page=${page}`,
      {
        method: 'GET',
        headers: {
          Authorization: `JWT ${token}`,
        },
        cache: 'no-store',
      },
    );

    if (!response.ok) {
      const errorText = await response.text().catch(() => '');
      throw new Error(
        `Failed to fetch scenes page ${page}: ${response.status} ${errorText}`,
      );
    }

    const payload = (await response.json().catch(() => null)) as {
      results?: unknown;
      next?: unknown;
    } | null;

    const pageRows = Array.isArray(payload?.results)
      ? (payload.results as BaserowSceneRow[])
      : [];

    allScenes.push(...pageRows);

    if (!payload || payload.next === null || payload.next === undefined) {
      break;
    }

    page += 1;
  }

  return allScenes;
}

async function patchSceneSentence(
  baserowUrl: string,
  token: string,
  sceneId: number,
  sentence: string,
): Promise<void> {
  const response = await fetch(
    `${baserowUrl}/database/rows/table/${SCENES_TABLE_ID}/${sceneId}/`,
    {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `JWT ${token}`,
      },
      body: JSON.stringify({ field_6890: sentence }),
    },
  );

  if (!response.ok) {
    const errorText = await response.text().catch(() => '');
    throw new Error(
      `Failed to update scene ${sceneId}: ${response.status} ${errorText}`,
    );
  }
}

export async function POST() {
  try {
    const baserowUrl = process.env.BASEROW_API_URL;
    if (!baserowUrl) {
      return NextResponse.json(
        { error: 'Missing Baserow URL' },
        { status: 500 },
      );
    }

    const { entries } = await loadTtsWordReplacementsStore();
    if (!entries.length) {
      return NextResponse.json({
        scannedScenes: 0,
        changedScenes: 0,
        updatedScenes: 0,
        failedUpdates: [],
        substitutionsApplied: 0,
        replacementsCount: 0,
        message: 'No replacement entries saved yet.',
      });
    }

    const replacements = prepareReplacements(entries);
    const token = await getJWTToken();
    const scenes = await fetchAllScenes(baserowUrl, token);

    const plannedUpdates: Array<{
      sceneId: number;
      sentence: string;
      substitutions: number;
    }> = [];

    for (const scene of scenes) {
      const sceneId = Number(scene.id);
      if (!Number.isFinite(sceneId) || sceneId <= 0) continue;

      const currentSentence =
        typeof scene.field_6890 === 'string'
          ? scene.field_6890
          : scene.field_6890 == null
            ? ''
            : String(scene.field_6890);

      if (!currentSentence) continue;

      const result = applyReplacementsToSentence(currentSentence, replacements);
      if (result.text !== currentSentence) {
        plannedUpdates.push({
          sceneId,
          sentence: result.text,
          substitutions: result.substitutions,
        });
      }
    }

    if (!plannedUpdates.length) {
      return NextResponse.json({
        scannedScenes: scenes.length,
        changedScenes: 0,
        updatedScenes: 0,
        failedUpdates: [],
        substitutionsApplied: 0,
        replacementsCount: replacements.length,
        message: 'No scene sentence required replacement.',
      });
    }

    const failedUpdates: Array<{ sceneId: number; error: string }> = [];
    let updatedScenes = 0;
    let substitutionsApplied = 0;

    for (const update of plannedUpdates) {
      try {
        await patchSceneSentence(
          baserowUrl,
          token,
          update.sceneId,
          update.sentence,
        );
        updatedScenes += 1;
        substitutionsApplied += update.substitutions;
      } catch (error) {
        failedUpdates.push({
          sceneId: update.sceneId,
          error: error instanceof Error ? error.message : String(error),
        });
      }

      await new Promise((resolve) => setTimeout(resolve, 50));
    }

    return NextResponse.json({
      scannedScenes: scenes.length,
      changedScenes: plannedUpdates.length,
      updatedScenes,
      failedUpdates,
      substitutionsApplied,
      replacementsCount: replacements.length,
      updatedSceneIdsPreview: plannedUpdates.slice(0, 50).map((u) => u.sceneId),
      message:
        failedUpdates.length > 0
          ? 'Replacement run completed with some failures.'
          : 'Replacement run completed successfully.',
    });
  } catch (error) {
    console.error('Failed to apply TTS word replacements:', error);
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : 'Failed to apply replacements',
      },
      { status: 500 },
    );
  }
}
