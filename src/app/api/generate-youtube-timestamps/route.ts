import { NextRequest, NextResponse } from 'next/server';
import OpenAI from 'openai';
import { parseCaptionFileTimedData } from '@/utils/captions-parser';

interface WordSegment {
  word: string;
  start: number;
  end: number;
}

interface CaptionSegment {
  text: string;
  start: number;
  end: number;
}

interface TimedChunk {
  start: number;
  end: number;
  text: string;
}

const openai = new OpenAI({
  apiKey: process.env.OPENROUTER_API_KEY,
  baseURL: 'https://openrouter.ai/api/v1',
  defaultHeaders: {
    'HTTP-Referer': 'https://ultimate-video-editor.com',
    'X-Title': 'Ultimate Video Editor',
  },
});

function formatTimestamp(seconds: number): string {
  const safe = Math.max(0, Math.floor(seconds));
  const hours = Math.floor(safe / 3600);
  const minutes = Math.floor((safe % 3600) / 60);
  const secs = safe % 60;

  if (hours > 0) {
    return `${hours}:${minutes.toString().padStart(2, '0')}:${secs
      .toString()
      .padStart(2, '0')}`;
  }
  return `${minutes}:${secs.toString().padStart(2, '0')}`;
}

function buildTimedTranscript(words: WordSegment[]): TimedChunk[] {
  if (words.length === 0) return [];

  const chunks: TimedChunk[] = [];
  let buffer: string[] = [];
  let chunkStart = words[0].start;
  let chunkEnd = words[0].end;
  let previousEnd = words[0].end;

  const flush = () => {
    const text = buffer.join(' ').replace(/\s+/g, ' ').trim();
    if (text) {
      chunks.push({
        start: chunkStart,
        end: chunkEnd,
        text,
      });
    }
    buffer = [];
  };

  for (const word of words) {
    if (buffer.length === 0) {
      chunkStart = word.start;
    }

    const hasGap = word.start - previousEnd > 1.2;
    const boundary = /[.!?]$/.test(word.word);
    const tooLong = buffer.length >= 22;

    if (hasGap && buffer.length > 0) {
      flush();
      chunkStart = word.start;
    }

    buffer.push(word.word);
    chunkEnd = word.end;
    previousEnd = word.end;

    if ((boundary && buffer.length >= 8) || tooLong) {
      flush();
    }
  }

  if (buffer.length > 0) {
    flush();
  }

  return chunks;
}

export async function POST(request: NextRequest) {
  try {
    const { captionsUrl, model = 'openai/gpt-4o-mini' } = await request.json();

    if (!captionsUrl || typeof captionsUrl !== 'string') {
      return NextResponse.json(
        { error: 'Captions URL is required' },
        { status: 400 },
      );
    }

    const captionsResponse = await fetch(captionsUrl);
    if (!captionsResponse.ok) {
      return NextResponse.json(
        {
          error: `Failed to fetch captions URL (${captionsResponse.status})`,
        },
        { status: 400 },
      );
    }

    const captionsRaw = await captionsResponse.text();
    const parsed = parseCaptionFileTimedData(captionsRaw);
    const words = parsed.words as WordSegment[];
    const segments = parsed.segments as CaptionSegment[];

    if (words.length === 0 && segments.length === 0) {
      return NextResponse.json(
        { error: 'Captions data has no valid timestamps' },
        { status: 400 },
      );
    }

    const timedTranscript =
      words.length > 0
        ? buildTimedTranscript(words)
        : segments.map((segment) => ({
            start: segment.start,
            end: segment.end,
            text: segment.text,
          }));

    const transcriptForPrompt = timedTranscript
      .map((entry) => `[${formatTimestamp(entry.start)}] ${entry.text}`)
      .join('\n');

    const prompt = `Create YouTube chapter timestamps from this timed transcript.

Rules:
- Return ONLY chapter lines in this exact format: M:SS - Chapter Title
- First line must be exactly: 0:00 - Intro
- Minimum 6 chapters
- Timestamps must be strictly increasing and realistic for the content flow
- Chapter titles should be short (2 to 6 words), specific, and clickable
- Do not include markdown, numbering, bullets, or extra commentary

Timed transcript:
${transcriptForPrompt}`;

    const completion = await openai.chat.completions.create({
      model,
      messages: [
        {
          role: 'user',
          content: prompt,
        },
      ],
      temperature: 0.4,
    });

    const timestamps = completion.choices[0]?.message?.content ?? '';

    return NextResponse.json({
      success: true,
      timestamps,
    });
  } catch (error) {
    console.error('YouTube timestamp generation error:', error);
    return NextResponse.json(
      { error: 'Failed to generate YouTube timestamps' },
      { status: 500 },
    );
  }
}
