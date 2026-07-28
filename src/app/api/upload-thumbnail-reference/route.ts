import {
  getThumbnailVariantConfig,
  saveThumbnailResult,
} from '@/lib/thumbnail-generation';

export const runtime = 'nodejs';

const KIE_FILE_UPLOAD_URL =
  'https://kieai.redpandaai.co/api/file-stream-upload';
const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;
const ALLOWED_IMAGE_TYPES = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
]);

type KieUploadResponse = {
  success?: boolean;
  code?: number;
  msg?: string;
  data?: {
    fileUrl?: string;
    downloadUrl?: string;
  };
};

function parsePositiveInteger(value: FormDataEntryValue | null): number | null {
  if (typeof value !== 'string') return null;
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

function getExtension(file: File): string {
  if (file.type === 'image/png') return 'png';
  if (file.type === 'image/webp') return 'webp';
  return 'jpg';
}

export async function POST(req: Request) {
  try {
    const apiKey = process.env.KIE_API_KEY;
    if (!apiKey) {
      return Response.json({ error: 'Missing KIE_API_KEY' }, { status: 500 });
    }

    const form = await req.formData();
    const file = form.get('file');
    const videoId = parsePositiveInteger(form.get('videoId'));
    const variant = parsePositiveInteger(form.get('variant'));

    if (!(file instanceof File)) {
      return Response.json({ error: 'Image file is required' }, { status: 400 });
    }

    if (!videoId) {
      return Response.json(
        { error: 'Valid videoId is required' },
        { status: 400 },
      );
    }

    if (!variant) {
      return Response.json(
        { error: 'Valid variant is required' },
        { status: 400 },
      );
    }

    let config;
    try {
      config = getThumbnailVariantConfig(variant);
    } catch (error) {
      return Response.json(
        { error: error instanceof Error ? error.message : 'Invalid variant' },
        { status: 400 },
      );
    }

    if (file.size <= 0) {
      return Response.json({ error: 'Image file is empty' }, { status: 400 });
    }

    if (file.size > MAX_UPLOAD_BYTES) {
      return Response.json(
        { error: 'Image file must be 10 MB or smaller' },
        { status: 400 },
      );
    }

    if (!ALLOWED_IMAGE_TYPES.has(file.type)) {
      return Response.json(
        { error: 'Only PNG, JPEG, and WebP images are supported' },
        { status: 400 },
      );
    }

    const kieForm = new FormData();
    kieForm.append('file', file);
    kieForm.append('uploadPath', 'images/user-uploads');
    kieForm.append(
      'fileName',
      `thumbnail-video-${videoId}-variant-${config.variant}-${Date.now()}.${getExtension(file)}`,
    );

    const uploadResponse = await fetch(KIE_FILE_UPLOAD_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
      },
      body: kieForm,
      cache: 'no-store',
    });

    const payload = (await uploadResponse
      .json()
      .catch(() => null)) as KieUploadResponse | null;

    if (!uploadResponse.ok || payload?.success === false) {
      throw new Error(
        payload?.msg ||
          `Kie file upload failed (${uploadResponse.status})`,
      );
    }

    const imageUrl = payload?.data?.downloadUrl || payload?.data?.fileUrl;
    if (!imageUrl || !imageUrl.startsWith('http')) {
      throw new Error('Kie file upload returned no usable image URL');
    }

    await saveThumbnailResult(videoId, config.fieldKey, imageUrl);

    return Response.json({
      videoId,
      variant: config.variant,
      fieldKey: config.fieldKey,
      imageUrl,
    });
  } catch (error) {
    console.error('Error uploading thumbnail reference:', error);
    return Response.json(
      {
        error:
          error instanceof Error
            ? error.message
            : 'Failed to upload thumbnail reference',
      },
      { status: 500 },
    );
  }
}
