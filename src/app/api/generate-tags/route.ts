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

    // Create a focused prompt for YouTube tags generation
    const prompt = `Generate relevant YouTube tags for this video transcription. The tags should be:

• Highly relevant to the video content
• Include a mix of broad and specific keywords
• Optimized for YouTube's search algorithm
• Natural and commonly searched terms
• Maximum 500 characters total
• Separate each tag with a comma

Transcription: ${transcriptionText}

Return only the tags separated by commas, nothing else.`;

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

    const generatedTags = completion.choices[0]?.message?.content?.trim();

    if (!generatedTags) {
      return NextResponse.json(
        { error: 'Failed to generate tags' },
        { status: 500 }
      );
    }

    return NextResponse.json({
      tags: generatedTags,
      success: true,
    });
  } catch (error) {
    console.error('Tags generation error:', error);
    return NextResponse.json(
      { error: 'Failed to generate tags' },
      { status: 500 }
    );
  }
}
