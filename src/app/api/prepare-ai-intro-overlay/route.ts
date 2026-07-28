import { prepareAiIntroSourcePreview } from '@/lib/ai-intro-overlay';
import type { AiIntroSourceSegment } from '@/components/ai-intro-overlay/types';

export const runtime = 'nodejs';

export async function POST(request: Request) {
  try {
    const body = (await request.json().catch(() => null)) as {
      sceneId?: unknown;
      segments?: unknown;
    } | null;
    const sceneId = Number(body?.sceneId);
    const segments = Array.isArray(body?.segments)
      ? (body.segments as AiIntroSourceSegment[])
      : [];
    const output = await prepareAiIntroSourcePreview({ sceneId, segments });
    return new Response(new Uint8Array(output), {
      status: 200,
      headers: {
        'Content-Type': 'video/mp4',
        'Cache-Control': 'no-store',
      },
    });
  } catch (error) {
    console.error('prepare-ai-intro-overlay error:', error);
    return Response.json(
      {
        error:
          error instanceof Error
            ? error.message
            : 'Failed to prepare the selected source sections.',
      },
      { status: 500 },
    );
  }
}
