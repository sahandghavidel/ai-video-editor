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

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json().catch(() => null)) as {
      transcriptionText?: unknown;
      model?: unknown;
    } | null;

    const transcriptionText =
      typeof body?.transcriptionText === 'string'
        ? body.transcriptionText.trim()
        : '';

    const model =
      typeof body?.model === 'string' && body.model.trim().length > 0
        ? body.model.trim()
        : 'openai/gpt-4o-mini';

    if (!transcriptionText) {
      return NextResponse.json(
        { error: 'Transcription text is required' },
        { status: 400 },
      );
    }

    // Create a concise, trustworthy prompt for YouTube description generation.
    const prompt = `Write a concise, trustworthy YouTube description based on this transcript.

Requirements:

- 120 to 220 words total
- Maximum 2 short paragraphs
- Clear, natural, and informative tone
- Summarize what the viewer will learn and why it matters
- Include key topics naturally for SEO (no keyword stuffing)
- Add one soft call-to-action sentence at the end
- Add exactly 2 relevant hashtags on the last line
- Do NOT include timestamps, emojis, hype language, urgency, promises, or clickbait
- Do NOT use phrases like "must-watch", "secret", "guaranteed", "act now", or similar

Transcript: ${transcriptionText}

Return only the final description text.`;

    const completion = await openai.chat.completions.create({
      model: model,
      messages: [
        {
          role: 'system',
          content:
            'You write clear, honest YouTube descriptions. Avoid clickbait and hype. Return only the final description text.',
        },
        {
          role: 'user',
          content: prompt,
        },
      ],
      temperature: 0.35,
    });

    const generatedDescription =
      completion.choices[0]?.message?.content?.trim();

    if (!generatedDescription) {
      return NextResponse.json(
        { error: 'Failed to generate description' },
        { status: 500 },
      );
    }

    return NextResponse.json({
      description: generatedDescription,
      success: true,
    });
  } catch (error) {
    console.error('Description generation error:', error);
    return NextResponse.json(
      { error: 'Failed to generate description' },
      { status: 500 },
    );
  }
}
