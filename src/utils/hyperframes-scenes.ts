import { getSceneById, type BaserowRow } from '@/lib/baserow-actions';

export type HyperFramesCaptionWord = {
  word: string;
  start: number;
  end: number;
};

export const HYPERFRAMES_PROMPT_FIELD_KEY = 'field_7365';
export const HYPERFRAMES_HTML_FIELD_KEY = 'field_7367';
export const HYPERFRAMES_VIDEO_FIELD_KEY = 'field_7368';

export function extractHyperFramesFieldText(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }
  if (Array.isArray(value)) {
    for (const item of value) {
      const text = extractHyperFramesFieldText(item).trim();
      if (text) return text;
    }
    return '';
  }
  if (typeof value === 'object') {
    const record = value as Record<string, unknown>;
    return extractHyperFramesFieldText(
      record.url ??
        record.file ??
        record.value ??
        record.name ??
        record.text ??
        record.title,
    );
  }
  return '';
}

export function getSceneTextField(
  scene: Record<string, unknown> | null | undefined,
  fieldKey: string,
): string {
  return extractHyperFramesFieldText(scene?.[fieldKey]).trim();
}

export function isHyperFramesVisualRequired(scene: BaserowRow): boolean {
  return getSceneTextField(scene, 'field_7364').toLowerCase() === 'needs visual';
}

export function getHyperFramesSceneVideoId(scene: BaserowRow): number | null {
  const value = scene.field_6889;
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') {
    const parsed = Number.parseInt(value, 10);
    return Number.isFinite(parsed) ? parsed : null;
  }
  if (Array.isArray(value) && value.length > 0) {
    const first = value[0];
    const raw =
      typeof first === 'object' && first !== null
        ? ((first as Record<string, unknown>).id ??
          (first as Record<string, unknown>).value)
        : first;
    const parsed = Number.parseInt(String(raw), 10);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

export function compareHyperFramesScenesByRealOrder(
  left: BaserowRow,
  right: BaserowRow,
): number {
  const getRank = (scene: BaserowRow): number => {
    const customOrder = Number(scene.field_7104);
    if (Number.isFinite(customOrder)) return customOrder;
    const baserowOrder = Number(scene.order);
    return Number.isFinite(baserowOrder)
      ? baserowOrder
      : Number.POSITIVE_INFINITY;
  };

  const orderDelta = getRank(left) - getRank(right);
  if (orderDelta !== 0) return orderDelta;

  const leftStart = Number(left.field_6896);
  const rightStart = Number(right.field_6896);
  if (
    Number.isFinite(leftStart) &&
    Number.isFinite(rightStart) &&
    leftStart !== rightStart
  ) {
    return leftStart - rightStart;
  }

  return left.id - right.id;
}

export function getPreviousHyperFramesSceneSentences(
  scenes: BaserowRow[],
  sceneId: number,
): string[] {
  const orderedScenes = [...scenes].sort(compareHyperFramesScenesByRealOrder);
  const activeIndex = orderedScenes.findIndex((scene) => scene.id === sceneId);
  if (activeIndex <= 0) return [];

  return orderedScenes
    .slice(Math.max(0, activeIndex - 10), activeIndex)
    .map(
      (scene) =>
        getSceneTextField(scene, 'field_6890') ||
        getSceneTextField(scene, 'field_6901'),
    )
    .filter(Boolean);
}

export function parseHyperFramesCaptionWords(
  value: unknown,
): HyperFramesCaptionWord[] {
  const entries = Array.isArray(value)
    ? value
    : typeof value === 'object' && value !== null
      ? ((value as Record<string, unknown>).words ??
        (value as Record<string, unknown>).segments)
      : [];

  if (!Array.isArray(entries)) return [];

  return entries.flatMap((entry) => {
    if (typeof entry !== 'object' || entry === null) return [];
    const record = entry as Record<string, unknown>;
    const word =
      typeof record.word === 'string'
        ? record.word.trim()
        : typeof record.text === 'string'
          ? record.text.trim()
          : '';
    const start = Number(record.start);
    const end = Number(record.end);
    return word && Number.isFinite(start) && Number.isFinite(end)
      ? [{ word, start, end }]
      : [];
  });
}

export function buildHyperFramesPrompt(input: {
  sentence: string;
  previousSceneSentences?: string[];
  sceneDuration: number;
  captionWords: HyperFramesCaptionWord[];
}): string {
  const captionData = input.captionWords.map(({ word, start, end }) => ({
    word,
    start,
    end,
  }));
  const requiredDuration = input.sceneDuration.toFixed(3);
  const previousScenes = input.previousSceneSentences?.length
    ? input.previousSceneSentences.map((scene) => `- ${scene}`).join('\n')
    : 'None';

  return `Create a single HyperFrames HTML animation for this narrated scene.

Previous scenes (oldest to most recent):
${previousScenes}

Current scene:
${input.sentence}

Use the previous scenes only to understand narrative continuity. Animate only the current scene. Do not copy their wording or create additional scenes.

Required composition duration: ${requiredDuration} seconds.
Set the root data-duration="${requiredDuration}" exactly and hold the final visual state until ${requiredDuration} seconds.

Exact caption word timings:
${JSON.stringify(captionData, null, 2)}

Requirements:
- Return only one complete standalone editable HyperFrames HTML composition.
- Use a 16:9 landscape 4K root element with data-composition-id, data-start="0", data-duration="${requiredDuration}", data-width="3840", and data-height="2160". Never use a square or portrait canvas.
- Put every timed visible unit in a direct-child element with class="clip", data-start, data-duration, and data-track-index attributes.
- Register exactly one synchronously-created paused GSAP timeline as window.__timelines["<root composition id>"].
- Include <script src="https://cdn.jsdelivr.net/npm/gsap@3/dist/gsap.min.js"></script> before the animation script.
- Drive all motion through that paused timeline so arbitrary seeking renders the same frame every time.
- Never overlap GSAP tweens that change the same property on the same target; combine those properties into one tween or sequence the tweens instead.
- Never use CSS transform on an element animated by GSAP. Use GSAP x, y, scale, rotation, xPercent, and yPercent properties instead.
- Preserve CSS centering in GSAP with xPercent and yPercent; do not use CSS translate() for an element whose transform is animated.
- Never use tl.set() at timeline position 0 for an initial hidden state. Define that state in CSS or use immediate gsap.set() before creating the paused timeline.
- Do not add unnecessary text or decorative elements.
- Build the visuals with HTML, CSS, inline SVG, and the allowed GSAP script only.
- Treat the caption timings as timing metadata, not visible subtitles. Do not render the caption words, the full sentence, or word-by-word text on screen.
- Use as little visible text as possible; communicate the sentence through visual objects, symbols, layout changes, and interaction.
- Do not use requestAnimationFrame, performance.now, Date.now, CSS transitions, event-driven render loops, or external CSS frameworks/other CDN scripts.
- Keep the composition deterministic and seek-safe in HyperFrames.
- Keep the visual focused on the meaning of the sentence and do not add unrelated elements.

Visual identity:
- Use a warm, polished editorial-explainer illustration style.
- Background: warm porcelain #EEEAE1 with a subtle radial highlight.
- Primary outlines and dark details: deep teal #293B3B.
- Main accent color: mustard yellow #EDC557.
- Supporting and positive elements: sage green #9FC1AD.
- Warnings, rejection, or damaged states: muted red #B95D47.
- Use rounded geometric shapes, smooth thick outlines, soft shadows, and restrained depth.
- Create clean flat-vector illustrations with a subtle hand-drawn character.
- Adapt all objects, symbols, and visual metaphors to the current topic. Do not reuse objects from previous topics unless they are relevant.
- Use one dominant subject with a few supporting elements.
- Maintain clear visual hierarchy, generous spacing, and balanced proportions.
- Keep visible text to a minimum. Communicate primarily through recognizable objects, symbols, movement, and cause-and-effect interactions.
- Keep the palette, line weights, corner rounding, shadow style, and motion language consistent across every scene.
- Use gentle entrances, smooth object movement, subtle scaling, and purposeful state changes.
- Avoid photorealism, neon colors, blue-purple gradients, glassmorphism, generic dashboards, presentation slides, card grids, clutter, and unrelated decoration.

Creative direction:
- Infer one clear, language-neutral visual metaphor for the sentence before coding. Do not output the plan.
- Organize the animation into three semantic beats: establish the idea, demonstrate the change, and show the resolved result.
- Use caption timings only as anchors for meaningful visual events. Do not animate every spoken word separately.
- Avoid subtitles, large English text, webpage layouts, dashboards, card grids, and presentation-style slides.
- Communicate through recognizable objects, symbols, cause-and-effect interactions, and spatial movement.
- Create depth using a subtle background, one dominant subject, and restrained foreground accents.
- Use 2-4 consistent motion patterns throughout the scene.
- Keep purposeful motion visible throughout, but avoid flashing images, abrupt full-screen appearances, oversized objects, and unnecessary decoration.
- Make every visual action explain the narration rather than merely decorate it.
- Finish with a clear resolved composition and hold that state until the required duration.`;
}

export async function generateAndSaveHyperFramesPrompt(input: {
  sceneId: number;
  previousSceneSentences?: string[];
  captionWords?: HyperFramesCaptionWord[];
  overwrite?: boolean;
}): Promise<{ prompt: string; skippedExisting: boolean }> {
  const latestScene = await getSceneById(input.sceneId);
  if (!latestScene) {
    throw new Error('Scene could not be found');
  }

  const existingPrompt = getSceneTextField(
    latestScene,
    HYPERFRAMES_PROMPT_FIELD_KEY,
  );
  if (existingPrompt && input.overwrite !== true) {
    return { prompt: existingPrompt, skippedExisting: true };
  }

  let captionWords = input.captionWords ?? [];
  if (captionWords.length === 0) {
    const captionsUrl = getSceneTextField(latestScene, 'field_6910');
    if (!captionsUrl) {
      throw new Error('Final caption timings are empty');
    }

    const captionsResponse = await fetch(captionsUrl, { cache: 'no-store' });
    if (!captionsResponse.ok) {
      throw new Error(
        `Caption timing fetch failed (${captionsResponse.status})`,
      );
    }
    captionWords = parseHyperFramesCaptionWords(
      await captionsResponse.json(),
    );
  }

  if (captionWords.length === 0) {
    throw new Error('No caption word timings found');
  }

  const durationResponse = await fetch('/api/calculate-final-video-durations', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ sceneIds: [input.sceneId] }),
    cache: 'no-store',
  });
  const durationData = (await durationResponse.json().catch(() => null)) as {
    durationsByScene?: Record<string, unknown>;
    error?: unknown;
  } | null;
  if (!durationResponse.ok) {
    throw new Error(
      typeof durationData?.error === 'string'
        ? durationData.error
        : `Final video duration failed (${durationResponse.status})`,
    );
  }

  const finalVideoDuration = Number(
    durationData?.durationsByScene?.[String(input.sceneId)],
  );
  if (!Number.isFinite(finalVideoDuration) || finalVideoDuration <= 0) {
    throw new Error('Final video duration could not be measured');
  }

  const captionDuration = Math.max(
    0,
    ...captionWords.map((word) => word.end),
  );
  const prompt = buildHyperFramesPrompt({
    sentence:
      getSceneTextField(latestScene, 'field_6890') ||
      getSceneTextField(latestScene, 'field_6901') ||
      '(scene sentence not available)',
    previousSceneSentences: input.previousSceneSentences,
    sceneDuration: Math.max(captionDuration, finalVideoDuration),
    captionWords,
  });

  const patchResponse = await fetch(`/api/baserow/scenes/${input.sceneId}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ [HYPERFRAMES_PROMPT_FIELD_KEY]: prompt }),
  });
  if (!patchResponse.ok) {
    const text = await patchResponse.text().catch(() => '');
    throw new Error(
      `Failed to save HyperFrames prompt (${patchResponse.status}) ${text}`.trim(),
    );
  }

  return { prompt, skippedExisting: false };
}
