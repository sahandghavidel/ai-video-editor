import { getBaserowToken, buildAuthHeader } from '@/lib/baserow-auth';
import { loadTtsAudioReferencesStore } from '@/lib/ttsAudioReferencesStore';
import {
  parseVideoExportId,
  resolveNamedVideoExportDir,
  getVideoExportTitle,
  getLanguageExportName,
  exportRemoteMedia,
  writeTextToResolvedVideoExportDir,
} from '@/lib/local-video-export';

export const runtime = 'nodejs';

type BaserowRow = {
  id: number;
  [key: string]: unknown;
};

type BaserowSceneRow = {
  id?: unknown;
  order?: unknown;
  field_6890?: unknown;
  [key: string]: unknown;
};

const ORIGINAL_VIDEOS_TABLE_ID = 713;
const SCENES_TABLE_ID = 714;
const BASEROW_PAGE_SIZE = 200;

function extractUrlFromField(raw: unknown): string {
  if (typeof raw === 'string') return raw.trim();
  if (!raw) return '';

  if (Array.isArray(raw) && raw.length > 0) {
    return extractUrlFromField(raw[0]);
  }

  if (typeof raw === 'object') {
    const obj = raw as Record<string, unknown>;
    const url = obj.url ?? (obj.file as { url?: unknown } | undefined)?.url;
    if (typeof url === 'string') return url.trim();
  }

  return String(raw).trim();
}

function getBaserowUrl() {
  const baserowUrl = process.env.BASEROW_API_URL;
  if (!baserowUrl) {
    throw new Error('Missing Baserow configuration');
  }
  return baserowUrl;
}

async function baserowGetOriginalVideoRow(
  videoId: number,
  baserowUrl: string,
  token: string,
): Promise<BaserowRow> {
  const res = await fetch(
    `${baserowUrl}/database/rows/table/${ORIGINAL_VIDEOS_TABLE_ID}/${videoId}/`,
    {
      method: 'GET',
      headers: {
        ...buildAuthHeader(token),
      },
      cache: 'no-store',
    },
  );

  if (!res.ok) {
    const t = await res.text().catch(() => '');
    throw new Error(`Baserow GET failed: ${res.status} ${t}`);
  }

  return (await res.json()) as BaserowRow;
}

function parsePositiveInt(value: unknown): number | null {
  const parsed =
    typeof value === 'number'
      ? value
      : typeof value === 'string'
        ? parseInt(value, 10)
        : Number.NaN;

  if (!Number.isFinite(parsed) || parsed <= 0) {
    return null;
  }

  return Math.floor(parsed);
}

async function baserowGetSceneRowsForVideo(
  videoId: number,
  baserowUrl: string,
  token: string,
): Promise<BaserowSceneRow[]> {
  const sceneRows: BaserowSceneRow[] = [];
  let page = 1;

  while (true) {
    const res = await fetch(
      `${baserowUrl}/database/rows/table/${SCENES_TABLE_ID}/?filter__field_6889__equal=${videoId}&size=${BASEROW_PAGE_SIZE}&page=${page}`,
      {
        method: 'GET',
        headers: {
          ...buildAuthHeader(token),
        },
        cache: 'no-store',
      },
    );

    if (!res.ok) {
      const t = await res.text().catch(() => '');
      throw new Error(`Baserow scenes GET failed: ${res.status} ${t}`);
    }

    const payload = (await res.json().catch(() => null)) as {
      results?: unknown;
      next?: unknown;
    } | null;

    const pageRows = Array.isArray(payload?.results)
      ? (payload.results as BaserowSceneRow[])
      : [];

    sceneRows.push(...pageRows);

    if (!payload || payload.next === null || payload.next === undefined) {
      break;
    }

    page += 1;
  }

  return sceneRows;
}

function buildSentencesText(sceneRows: BaserowSceneRow[]): string {
  return sceneRows
    .slice()
    .sort((a, b) => {
      const orderA = Number(a.order);
      const orderB = Number(b.order);

      if (Number.isFinite(orderA) && Number.isFinite(orderB)) {
        return orderA - orderB;
      }

      const idA = parsePositiveInt(a.id) ?? Number.MAX_SAFE_INTEGER;
      const idB = parsePositiveInt(b.id) ?? Number.MAX_SAFE_INTEGER;
      return idA - idB;
    })
    .map((scene) => String(scene.field_6890 ?? '').trim())
    .filter((sentence) => sentence.length > 0)
    .join('\n');
}

function extractTextFromField(raw: unknown): string {
  if (typeof raw === 'string') return raw.trim();

  if (typeof raw === 'number' || typeof raw === 'boolean') {
    return String(raw).trim();
  }

  if (Array.isArray(raw)) {
    return raw
      .map((item) => extractTextFromField(item))
      .filter(Boolean)
      .join('\n')
      .trim();
  }

  if (raw && typeof raw === 'object') {
    const obj = raw as Record<string, unknown>;
    const candidate = obj.value ?? obj.name ?? obj.text ?? obj.title;
    return extractTextFromField(candidate);
  }

  return '';
}

function buildMetadataText(row: BaserowRow): string {
  const titles = extractTextFromField(row.field_6870)
    .split('\n')
    .map((line) =>
      line
        .replace(/^\s*\d+[\).:-]?\s*/, '')
        .replace(/^\s*[-*•]\s*/, '')
        .trim(),
    )
    .filter(Boolean)
    .join('\n');

  const description = extractTextFromField(row.field_6869);
  const timestamps = extractTextFromField(row.field_6873);
  const keywords = extractTextFromField(row.field_6871);
  const timestampsSection = timestamps ? `Timestamps:\n${timestamps}` : '';

  return [titles, description, timestampsSection, keywords]
    .map((section) => section.trim())
    .filter(Boolean)
    .join('\n\n');
}

function withEnglishPrefix(fileName: string): string {
  return fileName.startsWith('English - ') ? fileName : `English - ${fileName}`;
}

export async function POST(req: Request) {
  try {
    const body = (await req.json().catch(() => null)) as {
      videoId?: unknown;
    } | null;

    let videoId: number;
    try {
      videoId = parseVideoExportId(body?.videoId);
    } catch (error) {
      return Response.json(
        {
          error: error instanceof Error ? error.message : 'videoId is required',
        },
        { status: 400 },
      );
    }
    const baserowUrl = getBaserowUrl();
    const token = await getBaserowToken();

    const [row, sceneRows] = await Promise.all([
      baserowGetOriginalVideoRow(videoId, baserowUrl, token),
      baserowGetSceneRowsForVideo(videoId, baserowUrl, token),
    ]);
    const { entries: audioReferenceEntries } =
      await loadTtsAudioReferencesStore();

    const title = getVideoExportTitle(row.field_6870, videoId);
    const exportDir = await resolveNamedVideoExportDir(videoId, title);
    const sentenceText = buildSentencesText(sceneRows);
    const metadataText = buildMetadataText(row);
    const writtenFiles: string[] = [];
    const skippedAssets: string[] = [];

    const existingFiles: string[] = [];
    async function exportMedia(name: string, url: string, inferExtension = false) {
      try {
        const result = await exportRemoteMedia(exportDir, name, url, inferExtension);
        (result.status === 'present' ? existingFiles : writtenFiles).push(result.path);
      } catch (error) {
        skippedAssets.push(`${name}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }

    const thumbnail = extractUrlFromField(row.field_7100);
    if (thumbnail) await exportMedia(withEnglishPrefix('thumbnail'), thumbnail, true);

    const video = extractUrlFromField(row.field_6858);
    if (video) await exportMedia(withEnglishPrefix(title), video, true);

    const englishSrt = extractUrlFromField(row.field_6872);
    if (englishSrt) await exportMedia('English - United Kingdom.srt', englishSrt);

    const seenTranslatedSrtFields = new Set<string>();
    const seenTranslatedSrtLanguages = new Set<string>();
    for (const entry of audioReferenceEntries) {
      if (!entry.enabled) continue;

      const languageCode = String(entry.language || '').trim().toLowerCase();
      const fieldKey = entry.baserowFields.videoSrtFieldKey;

      // English uses the dedicated final-captions field exported above.
      if (
        !languageCode ||
        languageCode === 'en' ||
        !fieldKey ||
        seenTranslatedSrtFields.has(fieldKey) ||
        seenTranslatedSrtLanguages.has(languageCode)
      ) {
        continue;
      }

      seenTranslatedSrtFields.add(fieldKey);
      seenTranslatedSrtLanguages.add(languageCode);

      const languageName = getLanguageExportName(languageCode);
      const translatedSrtUrl = extractUrlFromField(row[fieldKey]);

      await exportMedia(`${languageName}.srt`, translatedSrtUrl);
    }

    const seenDubbedAudioFields = new Set<string>();
    for (const entry of audioReferenceEntries) {
      if (!entry.enabled) continue;

      const languageCode = String(entry.language || '').trim().toLowerCase();
      const fieldKey = entry.baserowFields.videoFinalDubbedAudioFieldKey;
      if (!languageCode || !fieldKey || seenDubbedAudioFields.has(fieldKey)) {
        continue;
      }

      seenDubbedAudioFields.add(fieldKey);
      const dubbedAudioUrl = extractUrlFromField(row[fieldKey]);
      if (!dubbedAudioUrl) continue;

      const languageName = getLanguageExportName(languageCode);
      await exportMedia(`${languageName} - audio`, dubbedAudioUrl, true);
    }

    if (sentenceText.trim()) {
      writtenFiles.push(
        await writeTextToResolvedVideoExportDir(
          exportDir,
          withEnglishPrefix('sentences.txt'),
          sentenceText,
        ),
      );
    }

    if (metadataText.trim()) {
      writtenFiles.push(
        await writeTextToResolvedVideoExportDir(
          exportDir,
          withEnglishPrefix('metadata.txt'),
          metadataText,
        ),
      );
    }

    if (skippedAssets.length > 0) {
      writtenFiles.push(
        await writeTextToResolvedVideoExportDir(
          exportDir,
          'skipped-assets.txt',
          `Some assets could not be exported and were skipped:\n\n${skippedAssets.join('\n')}`,
        ),
      );
    }

    if (writtenFiles.length === 0 && existingFiles.length === 0) {
      writtenFiles.push(
        await writeTextToResolvedVideoExportDir(
          exportDir,
          'note.txt',
          'No exportable assets were available for this video at this time.',
        ),
      );
    }

    return Response.json({
      ok: true,
      exportDir,
      writtenFiles,
      existingFiles,
      skippedAssets,
    });
  } catch (error) {
    console.error('Error exporting video assets folder:', error);
    return Response.json(
      {
        error: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 },
    );
  }
}
