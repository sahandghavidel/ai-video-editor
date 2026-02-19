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
    const {
      transcriptionText,
      model = 'openai/gpt-4o-mini',
      count = 1,
    } = await request.json();

    const requestedCount = Math.min(
      5,
      Math.max(1, Number.isFinite(Number(count)) ? Number(count) : 1),
    );

    if (!transcriptionText) {
      return NextResponse.json(
        { error: 'Transcription text is required' },
        { status: 400 },
      );
    }

    // Create a focused prompt for YouTube title generation
    const prompt =
      requestedCount > 1
        ? `Generate exactly ${requestedCount} HIGH-QUALITY, DISTINCT YouTube video titles for this transcription.

Each title should be:

• Catchy and attention-grabbing
• Under 100 characters
• Relevant to the main topic
• Include keywords for SEO
• Natural and conversational
• Click-worthy without being misleading

Transcription: ${transcriptionText}

Return only the ${requestedCount} titles, one per line, with no extra text.`
        : `Generate an engaging YouTube video title for this transcription. The title should be:

• Catchy and attention-grabbing
• Under 100 characters
• Relevant to the main topic
• Include keywords for SEO
• Natural and conversational

Transcription: ${transcriptionText}

Return only the title, nothing else.`;

    const completion = await openai.chat.completions.create({
      model: model,
      messages: [
        {
          role: 'user',
          content: prompt,
        },
      ],
      temperature: 0.7,
    });

    const rawResponse = completion.choices[0]?.message?.content?.trim();

    if (!rawResponse) {
      return NextResponse.json(
        { error: 'Failed to generate title' },
        { status: 500 },
      );
    }

    const normalizedCandidates = rawResponse
      .split('\n')
      .map((line) => line.trim())
      .map((line) =>
        line
          .replace(/^[-*•\s]+/, '')
          .replace(/^\d+[\).:\-\s]+/, '')
          .trim(),
      )
      .filter(Boolean);

    const uniqueCandidates = [...new Set(normalizedCandidates)].slice(
      0,
      requestedCount,
    );

    const fallbackTitle = rawResponse
      .replace(/^[-*•\s]+/, '')
      .replace(/^\d+[\).:\-\s]+/, '')
      .trim();

    const finalTitles =
      uniqueCandidates.length > 0 ? uniqueCandidates : [fallbackTitle];
    const generatedTitle = finalTitles[0];

    if (!generatedTitle) {
      return NextResponse.json(
        { error: 'Failed to generate title' },
        { status: 500 },
      );
    }

    return NextResponse.json({
      title: generatedTitle,
      titles: finalTitles,
      success: true,
    });
  } catch (error) {
    console.error('Title generation error:', error);
    return NextResponse.json(
      { error: 'Failed to generate title' },
      { status: 500 },
    );
  }
}
