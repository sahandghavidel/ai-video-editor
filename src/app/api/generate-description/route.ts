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
    const { transcriptionText, model = 'openai/gpt-4o-mini' } =
      await request.json();

    if (!transcriptionText) {
      return NextResponse.json(
        { error: 'Transcription text is required' },
        { status: 400 }
      );
    }

    // Create a focused prompt for YouTube description generation
    const prompt = `Write a YouTube description for this video. Use this EXACT format (minimum 3 paragraphs and each paragraph should be at least 5 sentences long and add only 3 hashtags at the end).

The description should be:

• Compelling and informative
• Under 5000 characters (YouTube's limit)
• Include relevant keywords for SEO
• Encourage engagement (likes, comments, subscriptions)
• Natural and conversational
• NEVER include timestamps in the description

Transcription: ${transcriptionText}

Return only the description with the specified format, nothing else.`;

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

    const generatedDescription =
      completion.choices[0]?.message?.content?.trim();

    if (!generatedDescription) {
      return NextResponse.json(
        { error: 'Failed to generate description' },
        { status: 500 }
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
      { status: 500 }
    );
  }
}
