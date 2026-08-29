import { NextResponse } from 'next/server';
import {
  resolveOpenAIClient,
  type AIProviderRequestBody,
} from '@/lib/ai-provider';
import { buildAuthHeader, getBaserowToken } from '@/lib/baserow-auth';
import { validateHyperFramesHtml } from '@/lib/hyperframes-html-validation';
import { probeVideoDurationSeconds } from '@/lib/ffprobe-video-duration';

type BaserowRow = {
  id: number;
  [key: string]: unknown;
};

type GenerateHyperFramesHtmlBody = AIProviderRequestBody & {
  sceneId?: unknown;
  model?: unknown;
  skipIfDestinationExists?: unknown;
};

const SCENES_TABLE_ID = 714;
const FINAL_VIDEO_FIELD_KEY = 'field_6886';
const HYPERFRAMES_PROMPT_FIELD_KEY = 'field_7365';
const HYPERFRAMES_HTML_FIELD_KEY = 'field_7367';
const HYPERFRAMES_HTML_SYSTEM_PROMPT = `You are an expert HyperFrames HTML composition author. Return ONLY one complete editable standalone HyperFrames HTML source. Do not use Markdown code fences, explanations, headings, plans, or commentary.

The output MUST be a complete standards-mode document, never an HTML fragment. It must contain <!DOCTYPE html>, <html>, <head>, <meta charset="UTF-8">, and <body>. Do not wrap the standalone composition root in <template>.

Use this required outer structure and preserve its registration sequence:
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <style>/* composition styles */</style>
</head>
<body>
  <div id="root" data-composition-id="scene" data-start="0" data-duration="DURATION" data-width="3840" data-height="2160">
    <!-- direct-child timed clips -->
  </div>
  <script src="https://cdn.jsdelivr.net/npm/gsap@3/dist/gsap.min.js"></script>
  <script>
    window.__timelines = window.__timelines || {};
    const tl = gsap.timeline({ paused: true });
    window.__timelines["scene"] = tl;
    // timeline tweens
  </script>
</body>
</html>

The root data-composition-id and window.__timelines registry key MUST match exactly. Initialize window.__timelines, create exactly one paused GSAP timeline synchronously, and assign that exact timeline to the registry immediately after creation. Merely creating the timeline is not registration. Never put timeline creation or registration inside a callback, event listener, promise, async function, timeout, or conditional.

The root MUST be a 16:9 landscape 4K composition with data-composition-id, data-start, data-duration, data-width="3840", and data-height="2160". Never return a square or portrait composition. Set the root data-duration to the exact numeric duration supplied in this system message. Do not use any external scene-duration field or invent a shorter duration. Every timed visible unit must be a direct-child class="clip" with a unique stable id, data-start, data-duration, and data-track-index. The GSAP CDN script shown above is the only allowed external script. Drive motion through the paused timeline.

Never create overlapping GSAP tweens that change the same property on the same target. When properties share timing, combine them into one tween. Otherwise sequence them with distinct non-overlapping time ranges or use overwrite: "auto". Do not start a later tween at a boundary that the linter treats as overlapping with the earlier tween. Before returning the HTML, audit every target/property pair for overlapping time ranges.

Keep the standalone HTML under 300 lines with concise reusable CSS and markup. Never use requestAnimationFrame, performance.now, Date.now, CSS transitions, event-driven render loops, external CSS frameworks, other CDN scripts, or render-time fetches. Follow the exact timings from the user prompt and do not use supplied image assets or external image URLs. Do not render or describe a video.`;

function extractUrl(raw: unknown): string {
  if (typeof raw === 'string') return raw.trim();
  if (!raw) return '';
  if (Array.isArray(raw) && raw.length > 0) return extractUrl(raw[0]);
  if (typeof raw === 'object') {
    const value = raw as Record<string, unknown>;
    const url = value.url ?? (value.file as { url?: unknown } | undefined)?.url;
    return typeof url === 'string' ? url.trim() : '';
  }
  return '';
}

function parsePromptDuration(prompt: string): number {
  const patterns = [
    /Required composition duration:\s*([0-9]+(?:\.[0-9]+)?)\s*seconds/i,
    /Required HyperFrames duration in seconds:\s*([0-9]+(?:\.[0-9]+)?)/i,
    /Caption timing coverage in seconds:\s*([0-9]+(?:\.[0-9]+)?)/i,
    /Scene duration in seconds:\s*([0-9]+(?:\.[0-9]+)?)/i,
  ];

  for (const pattern of patterns) {
    const duration = Number(prompt.match(pattern)?.[1]);
    if (Number.isFinite(duration) && duration > 0) return duration;
  }

  return 0;
}

async function getScene(sceneId: number): Promise<BaserowRow> {
  const baserowUrl = process.env.BASEROW_API_URL?.replace(/\/+$/, '');
  if (!baserowUrl) {
    throw new Error('Missing Baserow URL');
  }

  const token = await getBaserowToken();
  const response = await fetch(
    `${baserowUrl}/database/rows/table/${SCENES_TABLE_ID}/${sceneId}/`,
    {
      method: 'GET',
      headers: {
        ...buildAuthHeader(token),
      },
      cache: 'no-store',
    },
  );

  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new Error(`Baserow GET failed: ${response.status} ${text}`);
  }

  return (await response.json()) as BaserowRow;
}

function normalizeHyperFramesHtml(raw: string): string {
  const trimmed = raw.trim();
  const fenced = trimmed.match(/^```(?:html)?\s*\n?([\s\S]*?)\n?```$/i);
  return (fenced ? fenced[1] : trimmed).trim();
}

export async function POST(request: Request) {
  try {
    const body = (await request.json().catch(() => null)) as
      | GenerateHyperFramesHtmlBody
      | null;

    const {
      client: openaiClient,
      provider,
      missingApiKey,
    } = resolveOpenAIClient(request, body);

    if (!openaiClient || missingApiKey) {
      return NextResponse.json(
        {
          error:
            provider === 'online'
              ? 'Missing OpenRouter API key. Set OPENROUTER_API_KEY in .env.local and restart the dev server.'
              : 'Failed to initialize local AI provider client.',
        },
        { status: 500 },
      );
    }

    const sceneId = Number(body?.sceneId);
    if (!Number.isFinite(sceneId) || sceneId <= 0) {
      return NextResponse.json(
        { error: 'Scene ID is required' },
        { status: 400 },
      );
    }

    const scene = await getScene(sceneId);
    if (
      body?.skipIfDestinationExists === true &&
      String(scene[HYPERFRAMES_HTML_FIELD_KEY] ?? '').trim()
    ) {
      return NextResponse.json({
        skipped: true,
        htmlFieldKey: HYPERFRAMES_HTML_FIELD_KEY,
      });
    }
    const hyperFramesPrompt = String(
      scene[HYPERFRAMES_PROMPT_FIELD_KEY] ?? '',
    ).trim();

    if (!hyperFramesPrompt) {
      return NextResponse.json(
        {
          error:
            'HyperFrames Prompt is empty. Generate or refine the prompt before generating HTML.',
        },
        { status: 400 },
      );
    }

    const finalVideoUrl = extractUrl(scene[FINAL_VIDEO_FIELD_KEY]);
    if (!finalVideoUrl) {
      return NextResponse.json(
        {
          error:
            'Final video URL is empty. HyperFrames duration must be measured with FFprobe before generating HTML.',
        },
        { status: 400 },
      );
    }

    const finalVideoDuration = Number(
      (await probeVideoDurationSeconds(finalVideoUrl)).toFixed(6),
    );
    const requiredDuration = Math.max(
      finalVideoDuration,
      parsePromptDuration(hyperFramesPrompt),
    );
    const promptForModel = hyperFramesPrompt;
    const systemPromptForModel = `${HYPERFRAMES_HTML_SYSTEM_PROMPT} For this scene, set the root data-duration="${requiredDuration.toFixed(3)}" exactly and hold the final visual state until ${requiredDuration.toFixed(3)} seconds.`;

    const model =
      typeof body?.model === 'string' && body.model.trim()
        ? body.model.trim()
        : 'deepseek/deepseek-v3.2-exp';

    const completion = await openaiClient.chat.completions.create({
      model,
      messages: [
        {
          role: 'system',
          content: systemPromptForModel,
        },
        { role: 'user', content: promptForModel },
      ],
      temperature: 0.2,
    });

    const rawHtml = completion.choices?.[0]?.message?.content;
    let html =
      typeof rawHtml === 'string' ? normalizeHyperFramesHtml(rawHtml) : '';

    if (!html) {
      return NextResponse.json(
        { error: 'HyperFrames HTML generation returned empty HTML' },
        { status: 500 },
      );
    }

    let validationIssues = validateHyperFramesHtml(html, {
      maxLines: 300,
      require4KCanvas: true,
      expectedDuration: requiredDuration,
    });
    if (validationIssues.length > 0) {
      const repairCompletion = await openaiClient.chat.completions.create({
        model,
        messages: [
          {
            role: 'system',
            content: systemPromptForModel,
          },
          { role: 'user', content: promptForModel },
          { role: 'assistant', content: html },
          {
            role: 'user',
            content: `Repair the previous HTML so it satisfies every HyperFrames requirement. Validation findings: ${validationIssues.join('; ')}. Return the complete corrected HTML only. It must remain a complete document beginning with <!DOCTYPE html> and containing <html>, <head>, <meta charset="UTF-8">, and <body>. Do not use <template>. Make the root data-composition-id exactly match the window.__timelines registry key. Preserve this synchronous sequence: window.__timelines = window.__timelines || {}; const tl = gsap.timeline({ paused: true }); window.__timelines["<root composition id>"] = tl;.`,
          },
        ],
        temperature: 0.1,
      });
      const repairedRawHtml = repairCompletion.choices?.[0]?.message?.content;
      const repairedHtml =
        typeof repairedRawHtml === 'string'
          ? normalizeHyperFramesHtml(repairedRawHtml)
          : '';
      if (repairedHtml) {
        html = repairedHtml;
        validationIssues = validateHyperFramesHtml(html, {
          maxLines: 300,
          require4KCanvas: true,
          expectedDuration: requiredDuration,
        });
      }
    }

    if (validationIssues.length > 0) {
      return NextResponse.json(
        {
          error: `The LLM returned non-renderable HyperFrames HTML: ${validationIssues.join('; ')}. Generate it again using the HyperFrames rules.`,
          validationIssues,
        },
        { status: 502 },
      );
    }

    return NextResponse.json({
      html,
      htmlFieldKey: HYPERFRAMES_HTML_FIELD_KEY,
    });
  } catch (error) {
    console.error('Error generating HyperFrames HTML:', error);
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : 'Failed to generate HyperFrames HTML',
      },
      { status: 500 },
    );
  }
}
