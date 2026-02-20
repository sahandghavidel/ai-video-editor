import JSZip from 'jszip';

type BaserowRow = {
  id: number;
  [key: string]: unknown;
};

const ORIGINAL_VIDEOS_TABLE_ID = 713;

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

function getJWTTokenParams() {
  const baserowUrl = process.env.BASEROW_API_URL;
  const email = process.env.BASEROW_EMAIL;
  const password = process.env.BASEROW_PASSWORD;

  if (!baserowUrl || !email || !password) {
    throw new Error('Missing Baserow configuration');
  }

  return { baserowUrl, email, password };
}

async function getJWTToken(): Promise<string> {
  const { baserowUrl, email, password } = getJWTTokenParams();

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
    token?: string;
  } | null;

  if (!data?.token) {
    throw new Error('Authentication failed: missing token');
  }

  return data.token;
}

async function baserowGetOriginalVideoRow(
  videoId: number,
): Promise<BaserowRow> {
  const { baserowUrl } = getJWTTokenParams();
  const token = await getJWTToken();

  const res = await fetch(
    `${baserowUrl}/database/rows/table/${ORIGINAL_VIDEOS_TABLE_ID}/${videoId}/`,
    {
      method: 'GET',
      headers: {
        Authorization: `JWT ${token}`,
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

function sanitizeFileBaseName(name: string): string {
  const cleaned = name
    .replace(/[<>:"/\\|?*\x00-\x1F]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/\.+$/g, '');

  return cleaned || 'video_assets';
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
    // ignore URL parsing errors
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

    const videoId =
      typeof body?.videoId === 'number' ? body.videoId : Number(body?.videoId);

    if (!Number.isFinite(videoId) || videoId <= 0) {
      return Response.json({ error: 'videoId is required' }, { status: 400 });
    }

    const row = await baserowGetOriginalVideoRow(videoId);

    const title = sanitizeFileBaseName(
      pickTitleFromField(row.field_6870, videoId),
    );

    const thumbnailUrls = [
      extractUrlFromField(row.field_7100),
      extractUrlFromField(row.field_7101),
      extractUrlFromField(row.field_7102),
    ].filter(Boolean);

    const finalVideoUrl = extractUrlFromField(row.field_6858);

    if (!finalVideoUrl && thumbnailUrls.length === 0) {
      return Response.json(
        {
          error:
            'No assets found. Need at least one thumbnail or a final video URL.',
        },
        { status: 400 },
      );
    }

    const zip = new JSZip();

    for (let i = 0; i < thumbnailUrls.length; i++) {
      const thumbUrl = thumbnailUrls[i];
      const asset = await fetchAsset(thumbUrl);
      const ext = getExtensionFromUrlOrType(thumbUrl, asset.contentType);
      zip.file(`thumbnail_${i + 1}${ext}`, asset.data);
    }

    if (finalVideoUrl) {
      const finalAsset = await fetchAsset(finalVideoUrl);
      const finalExt = getExtensionFromUrlOrType(
        finalVideoUrl,
        finalAsset.contentType,
      );
      // User requirement: final video filename must be one of the video titles.
      zip.file(`${title}${finalExt}`, finalAsset.data);
    }

    const zipBuffer = await zip.generateAsync({
      type: 'uint8array',
      compression: 'DEFLATE',
      compressionOptions: { level: 6 },
    });
    const zipBytes = Uint8Array.from(zipBuffer);
    const zipBlob = new Blob([zipBytes], { type: 'application/zip' });

    // User requirement: zip filename must be one of the video titles.
    const zipName = `${title}.zip`;

    return new Response(zipBlob, {
      status: 200,
      headers: {
        'Content-Type': 'application/zip',
        'Content-Disposition': `attachment; filename="${zipName}"`,
        'Cache-Control': 'no-store',
      },
    });
  } catch (error) {
    console.error('Error creating video assets zip:', error);
    return Response.json(
      {
        error: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 },
    );
  }
}
