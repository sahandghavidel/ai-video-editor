import { NextRequest, NextResponse } from 'next/server';
import { resolveOpenAIClient } from '@/lib/ai-provider';

const MAX_TAG_CHARACTERS = 500;

function enforceTagCharacterLimit(rawTags: string): string {
  const normalized = rawTags
    .replace(/[\r\n]+/g, ', ')
    .replace(/[•·]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  if (!normalized) {
    return '';
  }

  const tags = normalized
    .split(',')
    .map((tag) => tag.trim())
    .filter(Boolean);

  if (tags.length === 0) {
    return normalized.slice(0, MAX_TAG_CHARACTERS).trim();
  }

  const selectedTags: string[] = [];

  for (const tag of tags) {
    const candidate =
      selectedTags.length > 0 ? `${selectedTags.join(', ')}, ${tag}` : tag;

    if (candidate.length > MAX_TAG_CHARACTERS) {
      break;
    }

    selectedTags.push(tag);
  }

  if (selectedTags.length > 0) {
    return selectedTags.join(', ');
  }

  // Fallback when the first individual tag exceeds the limit.
  return tags[0]
    .slice(0, MAX_TAG_CHARACTERS)
    .trim()
    .replace(/[\s,]+$/g, '');
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();

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

    const { transcriptionText, model = 'openai/gpt-4o-mini' } = body;

    if (!transcriptionText) {
      return NextResponse.json(
        { error: 'Transcription text is required' },
        { status: 400 },
      );
    }

    // Create a focused prompt for YouTube tags generation
    const prompt = `Generate relevant YouTube tags for this video transcription. The tags should be:

• Highly relevant to the video content
• Include a mix of broad and specific keywords
• Optimized for YouTube's search algorithm
• Natural and commonly searched terms
• STRICT hard limit: maximum 500 characters total (including commas and spaces)
• Separate each tag with a comma

Transcription: ${transcriptionText}

Return only the tags separated by commas, nothing else.`;

    const completion = await openaiClient.chat.completions.create({
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
        { status: 500 },
      );
    }

    const safeTags = enforceTagCharacterLimit(generatedTags);

    if (!safeTags) {
      return NextResponse.json(
        { error: 'Failed to generate tags' },
        { status: 500 },
      );
    }

    return NextResponse.json({
      tags: safeTags,
      success: true,
    });
  } catch (error: unknown) {
    const providerError = error as {
      status?: number;
      message?: string;
      error?: { message?: string };
    };

    const status = providerError?.status;
    const providerMessage =
      providerError?.error?.message || providerError?.message || '';

    if (status === 401) {
      return NextResponse.json(
        {
          error:
            'Provider authentication failed (401). Check your active provider credentials and try again.',
        },
        { status: 401 },
      );
    }

    if (status === 429) {
      return NextResponse.json(
        {
          error:
            'OpenRouter rate limit reached. Please wait and retry, or switch to another model/provider key.',
        },
        { status: 429 },
      );
    }

    console.error('Tags generation error:', error);
    return NextResponse.json(
      {
        error:
          providerMessage ||
          'Failed to generate tags due to provider/API error',
      },
      { status: status && status >= 400 && status < 600 ? status : 500 },
    );
  }
}
