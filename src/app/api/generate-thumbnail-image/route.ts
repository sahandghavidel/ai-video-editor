// Single GPT Image 2 thumbnail generation for Original Videos table.
// Stores the provider-returned hosted URL directly into one thumbnail field.

import {
  generateThumbnailVariant,
  getThumbnailVariantConfig,
} from '@/lib/thumbnail-generation';

export async function POST(req: Request) {
  try {
    const body = (await req.json().catch(() => null)) as {
      videoId?: unknown;
      variant?: unknown;
      forceRegenerate?: unknown;
    } | null;

    const videoId =
      typeof body?.videoId === 'number' ? body.videoId : Number(body?.videoId);
    const variant =
      typeof body?.variant === 'number' ? body.variant : Number(body?.variant);
    const forceRegenerate =
      body?.forceRegenerate === true ||
      body?.forceRegenerate === 'true' ||
      body?.forceRegenerate === 1 ||
      body?.forceRegenerate === '1';

    if (!Number.isFinite(videoId) || videoId <= 0) {
      return Response.json({ error: 'videoId is required' }, { status: 400 });
    }

    try {
      getThumbnailVariantConfig(variant);
    } catch (error) {
      return Response.json(
        {
          error: error instanceof Error ? error.message : 'Invalid variant',
        },
        { status: 400 },
      );
    }

    const result = await generateThumbnailVariant({
      videoId,
      variant,
      forceRegenerate,
    });

    return Response.json(result);
  } catch (error) {
    console.error('Error generating thumbnail image:', error);
    return Response.json(
      {
        error: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 },
    );
  }
}
