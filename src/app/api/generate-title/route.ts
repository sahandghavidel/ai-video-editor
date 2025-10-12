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

    // Create a focused prompt for YouTube title generation
    const prompt = `Generate an engaging YouTube video title for this transcription. The title should be:

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

    const generatedTitle = completion.choices[0]?.message?.content?.trim();

    if (!generatedTitle) {
      return NextResponse.json(
        { error: 'Failed to generate title' },
        { status: 500 }
      );
    }

    return NextResponse.json({
      title: generatedTitle,
      success: true,
    });
  } catch (error) {
    console.error('Title generation error:', error);
    return NextResponse.json(
      { error: 'Failed to generate title' },
      { status: 500 }
    );
  }
}
