import { getBaserowToken, buildAuthHeader } from '@/lib/baserow-auth';
import {
  ensureVideoExportDir,
  parseVideoExportId,
  sanitizeExportFileName,
  writeBufferToVideoExportDir,
  writeTextToVideoExportDir,
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

function cleanTitleLine(line: string): string {
  return line
    .replace(/^\s*\d+\)\s*/, '')
    .replace(/^\s*[-*•]\s*/, '')
    .trim();
}

function pickTitleFromField(rawTitleField: unknown, videoId: number): string {
  const raw = typeof rawTitleField === 'string' ? rawTitleField : '';
  const candidates = raw.split('\n').map(cleanTitleLine).filter(Boolean);

  return candidates[0] || `video_${videoId}`;
}

function getExtensionFromUrlOrType(url: string, contentType: string): string {
  const lowerType = contentType.toLowerCase();
  if (lowerType.includes('video/mp4')) return '.mp4';
  if (lowerType.includes('video/webm')) return '.webm';
  if (lowerType.includes('video/quicktime')) return '.mov';
  if (lowerType.includes('image/png')) return '.png';
  if (lowerType.includes('image/jpeg')) return '.jpg';
  if (lowerType.includes('image/webp')) return '.webp';

  try {
    const pathname = new URL(url).pathname;
    const dot = pathname.lastIndexOf('.');
    if (dot > -1 && dot < pathname.length - 1) {
      const ext = pathname.slice(dot);
      if (/^\.[a-zA-Z0-9]+$/.test(ext)) return ext.toLowerCase();
    }
  } catch {
    // Keep the generic extension if URL parsing fails.
  }

  return '.bin';
}

async function fetchAsset(url: string): Promise<{
  data: ArrayBuffer;
  contentType: string;
}> {
  const res = await fetch(url, { cache: 'no-store' });

  if (!res.ok) {
    const t = await res.text().catch(() => '');
    throw new Error(`Failed to fetch asset (${res.status}): ${t}`);
  }

  return {
    data: await res.arrayBuffer(),
    contentType: res.headers.get('content-type') || 'application/octet-stream',
  };
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

    const exportDir = await ensureVideoExportDir(videoId);
    const title = sanitizeExportFileName(
      pickTitleFromField(row.field_6870, videoId),
      `video_${videoId}`,
    );
    const sentenceText = buildSentencesText(sceneRows);
    const metadataText = buildMetadataText(row);
    const writtenFiles: string[] = [];
    const skippedAssets: string[] = [];

    const thumbnailUrls = [
      extractUrlFromField(row.field_7100),
      extractUrlFromField(row.field_7101),
      extractUrlFromField(row.field_7102),
    ].filter(Boolean);

    for (let i = 0; i < thumbnailUrls.length; i++) {
      const thumbUrl = thumbnailUrls[i];
      try {
        const asset = await fetchAsset(thumbUrl);
        const ext = getExtensionFromUrlOrType(thumbUrl, asset.contentType);
        const filePath = await writeBufferToVideoExportDir(
          videoId,
          `thumbnail_${i + 1}${ext}`,
          asset.data,
        );
        writtenFiles.push(filePath);
      } catch (error) {
        const reason =
          error instanceof Error ? error.message : 'Unknown thumbnail error';
        skippedAssets.push(`thumbnail_${i + 1}: ${reason}`);
      }
    }

    const finalVideoUrl = extractUrlFromField(row.field_6858);
    if (finalVideoUrl) {
      try {
        const finalAsset = await fetchAsset(finalVideoUrl);
        const finalExt = getExtensionFromUrlOrType(
          finalVideoUrl,
          finalAsset.contentType,
        );
        const filePath = await writeBufferToVideoExportDir(
          videoId,
          `${title}${finalExt}`,
          finalAsset.data,
        );
        writtenFiles.push(filePath);
      } catch (error) {
        const reason =
          error instanceof Error ? error.message : 'Unknown final video error';
        skippedAssets.push(`final_video: ${reason}`);
      }
    }

    if (sentenceText.trim()) {
      writtenFiles.push(
        await writeTextToVideoExportDir(videoId, 'sentences.txt', sentenceText),
      );
    }

    if (metadataText.trim()) {
      writtenFiles.push(
        await writeTextToVideoExportDir(videoId, 'metadata.txt', metadataText),
      );
    }

    if (skippedAssets.length > 0) {
      writtenFiles.push(
        await writeTextToVideoExportDir(
          videoId,
          'skipped-assets.txt',
          `Some assets could not be exported and were skipped:\n\n${skippedAssets.join('\n')}`,
        ),
      );
    }

    if (writtenFiles.length === 0) {
      writtenFiles.push(
        await writeTextToVideoExportDir(
          videoId,
          'note.txt',
          'No exportable assets were available for this video at this time.',
        ),
      );
    }

    return Response.json({
      ok: true,
      exportDir,
      writtenFiles,
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
