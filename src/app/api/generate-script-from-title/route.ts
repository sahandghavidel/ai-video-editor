import { NextRequest, NextResponse } from 'next/server';
import OpenAI from 'openai';

const openai = new OpenAI({
  apiKey: process.env.OPENROUTER_API_KEY,
  baseURL: 'https://openrouter.ai/api/v1',
  defaultHeaders: {
    'HTTP-Referer': 'https://ultimate-video-editor.com',
    'X-Title': 'Ultimate Video Editor',
  },
});

type Body = {
  title?: unknown;
  expectedDuration?: unknown;
  model?: unknown;
};

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json().catch(() => null)) as Body | null;

    const title = typeof body?.title === 'string' ? body.title.trim() : '';
    const expectedDurationRaw = Number(body?.expectedDuration);
    const expectedDuration = Number.isFinite(expectedDurationRaw)
      ? Math.max(1, Math.round(expectedDurationRaw))
      : 15;
    const model =
      typeof body?.model === 'string' && body.model.trim().length > 0
        ? body.model.trim()
        : 'openai/gpt-4o-mini';

    if (!title) {
      return NextResponse.json({ error: 'Title is required' }, { status: 400 });
    }

    const prompt = `Write a complete video narration script from this title:\n\n"${title}"\n\nRequirements:\n- Target spoken duration: about ${expectedDuration} minutes.\n- Return a clean, production-ready narration script in plain text easy for TTS reader to read.\n- Keep it coherent, engaging, and focused on the title.\n- Do NOT return markdown, bullets, headings, explanations, or any other formatting like dashes, asterisks, or numbers.\n- Return ONLY the script text.`;

    const completion = await openai.chat.completions.create({
      model,
      messages: [
        {
          role: 'system',
          content:
            'You are an expert scriptwriter. Return only the final script text.',
        },
        {
          role: 'user',
          content: prompt,
        },
      ],
      temperature: 0.7,
    });

    const generatedScript =
      completion.choices[0]?.message?.content
        ?.trim()
        .replace(/^```[a-zA-Z0-9_-]*\n?/g, '')
        .replace(/```$/g, '')
        .trim() ?? '';

    if (!generatedScript) {
      return NextResponse.json(
        { error: 'Failed to generate script' },
        { status: 500 },
      );
    }

    return NextResponse.json({
      script: generatedScript,
      success: true,
    });
  } catch (error) {
    console.error('Script-from-title generation error:', error);
    return NextResponse.json(
      { error: 'Failed to generate script from title' },
      { status: 500 },
    );
  }
}
