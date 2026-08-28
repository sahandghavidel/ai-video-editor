import { NextResponse } from 'next/server';
import {
  resolveOpenAIClient,
  type AIProviderRequestBody,
} from '@/lib/ai-provider';
import { buildAuthHeader, getBaserowToken } from '@/lib/baserow-auth';
import { validateHyperFramesHtml } from '@/lib/hyperframes-html-validation';

type BaserowRow = {
  id: number;
  [key: string]: unknown;
};

type GenerateHyperFramesHtmlBody = AIProviderRequestBody & {
  sceneId?: unknown;
  model?: unknown;
};

const SCENES_TABLE_ID = 714;
const HYPERFRAMES_PROMPT_FIELD_KEY = 'field_7365';
const HYPERFRAMES_HTML_FIELD_KEY = 'field_7367';
const HYPERFRAMES_HTML_SYSTEM_PROMPT =
  'You are an expert HyperFrames HTML composition author. Return ONLY one complete editable standalone HyperFrames HTML source. Do not use Markdown code fences, explanations, headings, plans, or commentary. The root MUST be a 16:9 landscape 4K composition with data-composition-id, data-start, data-duration, data-width="3840", and data-height="2160". Never return a square or portrait composition. Set the root data-duration to exactly the caption-derived scene duration specified in the user prompt; do not use any external scene-duration field or invent a shorter duration. Every timed visible unit must be a direct-child class="clip" with a unique stable id, data-start, data-duration, and data-track-index. Register exactly one synchronously-created gsap.timeline({ paused: true }) at window.__timelines["<root composition id>"]. Include <script src="https://cdn.jsdelivr.net/npm/gsap@3/dist/gsap.min.js"></script> before the animation script; this is the only allowed external script. Drive motion through that paused timeline. Never create overlapping GSAP tweens that change the same property on the same target; combine them into one tween or sequence them. Keep the standalone HTML under 300 lines with concise reusable CSS and markup. Never use requestAnimationFrame, performance.now, Date.now, CSS transitions, event-driven render loops, external CSS frameworks, other CDN scripts, or render-time fetches. Follow the exact timings from the user prompt and do not use supplied image assets or external image URLs. Do not render or describe a video.';

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

    const promptForModel = hyperFramesPrompt;

    const model =
      typeof body?.model === 'string' && body.model.trim()
        ? body.model.trim()
        : 'deepseek/deepseek-v3.2-exp';

    const completion = await openaiClient.chat.completions.create({
      model,
      messages: [
        {
          role: 'system',
          content: HYPERFRAMES_HTML_SYSTEM_PROMPT,
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
    });
    if (validationIssues.length > 0) {
      const repairCompletion = await openaiClient.chat.completions.create({
        model,
        messages: [
          {
            role: 'system',
            content: HYPERFRAMES_HTML_SYSTEM_PROMPT,
          },
          { role: 'user', content: promptForModel },
          { role: 'assistant', content: html },
          {
            role: 'user',
            content: `Repair the previous HTML so it satisfies every HyperFrames requirement. Validation findings: ${validationIssues.join('; ')}. Return the complete corrected HTML only.`,
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
