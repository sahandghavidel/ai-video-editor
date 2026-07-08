// Batch GPT Image 2 thumbnail generation for Original Videos table.
// Starts all requested thumbnail variant tasks first, then saves each result as
// soon as that task finishes.

import {
  createThumbnailTaskForVariant,
  fetchGptImageResult,
  fetchOriginalVideoForThumbnail,
  getThumbnailVariantConfig,
  saveThumbnailResult,
  THUMBNAIL_MAX_WAIT_MS,
  THUMBNAIL_POLL_INTERVAL_MS,
  type ThumbnailTaskResult,
  type ThumbnailVariantConfig,
} from '@/lib/thumbnail-generation';

type PendingThumbnailTask = {
  variant: ThumbnailVariantConfig['variant'];
  fieldKey: string;
  taskId: string;
};

function parseBooleanFlag(raw: unknown): boolean {
  return raw === true || raw === 'true' || raw === 1 || raw === '1';
}

function parseRequestedVariants(raw: unknown): number[] {
  const values = Array.isArray(raw) ? raw : [raw];
  const unique = new Set<number>();

  for (const value of values) {
    const variant = typeof value === 'number' ? value : Number(value);
    if (Number.isFinite(variant)) {
      unique.add(variant);
    }
  }

  return Array.from(unique);
}

const delay = (ms: number) =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

export async function POST(req: Request) {
  try {
    const body = (await req.json().catch(() => null)) as {
      videoId?: unknown;
      variants?: unknown;
      forceRegenerate?: unknown;
    } | null;

    const videoId =
      typeof body?.videoId === 'number' ? body.videoId : Number(body?.videoId);
    const forceRegenerate = parseBooleanFlag(body?.forceRegenerate);

    if (!Number.isFinite(videoId) || videoId <= 0) {
      return Response.json({ error: 'videoId is required' }, { status: 400 });
    }

    const requestedVariants = parseRequestedVariants(body?.variants);
    if (requestedVariants.length === 0) {
      return Response.json(
        { error: 'variants is required' },
        { status: 400 },
      );
    }

    let configs: ThumbnailVariantConfig[];
    try {
      configs = requestedVariants.map(getThumbnailVariantConfig);
    } catch (error) {
      return Response.json(
        {
          error: error instanceof Error ? error.message : 'Invalid variants',
        },
        { status: 400 },
      );
    }

    const video = await fetchOriginalVideoForThumbnail(videoId);

    const started = await Promise.all(
      configs.map(async (cfg): Promise<ThumbnailTaskResult> => {
        try {
          return await createThumbnailTaskForVariant(
            video,
            cfg,
            forceRegenerate,
          );
        } catch (error) {
          return {
            variant: cfg.variant,
            fieldKey: cfg.fieldKey,
            error: error instanceof Error ? error.message : 'Unknown error',
          };
        }
      }),
    );

    const results: ThumbnailTaskResult[] = started.filter(
      (result) => result.skipped || result.error,
    );
    const pending: PendingThumbnailTask[] = started
      .filter((result): result is ThumbnailTaskResult & { taskId: string } =>
        Boolean(result.taskId && !result.skipped && !result.error),
      )
      .map((result) => ({
        variant: result.variant,
        fieldKey: result.fieldKey,
        taskId: result.taskId,
      }));

    const startedAt = Date.now();

    while (pending.length > 0 && Date.now() - startedAt < THUMBNAIL_MAX_WAIT_MS) {
      const pollResults = await Promise.all(
        pending.map(async (task) => {
          try {
            const pollResult = await fetchGptImageResult(task.taskId);
            return { task, pollResult };
          } catch (error) {
            return {
              task,
              error: error instanceof Error ? error.message : 'Unknown error',
            };
          }
        }),
      );

      for (const poll of pollResults) {
        const pendingIndex = pending.findIndex(
          (task) => task.taskId === poll.task.taskId,
        );
        if (pendingIndex === -1) continue;

        if ('error' in poll) {
          pending.splice(pendingIndex, 1);
          results.push({
            variant: poll.task.variant,
            fieldKey: poll.task.fieldKey,
            taskId: poll.task.taskId,
            error: poll.error,
          });
          continue;
        }

        if (poll.pollResult.state === 'fail') {
          pending.splice(pendingIndex, 1);
          results.push({
            variant: poll.task.variant,
            fieldKey: poll.task.fieldKey,
            taskId: poll.task.taskId,
            error: poll.pollResult.failMsg || 'Unknown GPT Image 2 failure',
          });
          continue;
        }

        if (poll.pollResult.imageUrl) {
          try {
            await saveThumbnailResult(
              videoId,
              poll.task.fieldKey,
              poll.pollResult.imageUrl,
            );
            results.push({
              variant: poll.task.variant,
              fieldKey: poll.task.fieldKey,
              taskId: poll.task.taskId,
              imageUrl: poll.pollResult.imageUrl,
            });
          } catch (error) {
            results.push({
              variant: poll.task.variant,
              fieldKey: poll.task.fieldKey,
              taskId: poll.task.taskId,
              error: error instanceof Error ? error.message : 'Unknown error',
            });
          }
          pending.splice(pendingIndex, 1);
        }
      }

      if (pending.length > 0) {
        await delay(THUMBNAIL_POLL_INTERVAL_MS);
      }
    }

    for (const task of pending) {
      results.push({
        variant: task.variant,
        fieldKey: task.fieldKey,
        taskId: task.taskId,
        error: `GPT Image 2 task timed out without a result (taskId=${task.taskId})`,
      });
    }

    results.sort((a, b) => a.variant - b.variant);

    return Response.json({
      videoId,
      results,
    });
  } catch (error) {
    console.error('Error generating thumbnail images:', error);
    return Response.json(
      {
        error: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 },
    );
  }
}
