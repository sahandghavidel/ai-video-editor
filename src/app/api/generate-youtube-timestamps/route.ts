import { NextRequest, NextResponse } from 'next/server';
import OpenAI from 'openai';

interface WordSegment {
  word: string;
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

function extractWordSegments(input: unknown): WordSegment[] {
  let rawSegments: unknown[] = [];

  if (Array.isArray(input)) {
    rawSegments = input;
  } else if (input && typeof input === 'object') {
    const obj = input as {
      Segments?: unknown;
      segments?: unknown;
      words?: unknown;
    };
    if (Array.isArray(obj.Segments)) {
      rawSegments = obj.Segments;
    } else if (Array.isArray(obj.segments)) {
      rawSegments = obj.segments;
    } else if (Array.isArray(obj.words)) {
      rawSegments = obj.words;
    }
  }

  return rawSegments
    .map((item) => {
      if (!item || typeof item !== 'object') return null;
      const maybe = item as { word?: unknown; start?: unknown; end?: unknown };
      const word = typeof maybe.word === 'string' ? maybe.word.trim() : '';
      const start =
        typeof maybe.start === 'number'
          ? maybe.start
          : Number.parseFloat(String(maybe.start ?? ''));
      const end =
        typeof maybe.end === 'number'
          ? maybe.end
          : Number.parseFloat(String(maybe.end ?? ''));

      if (!word || !Number.isFinite(start) || !Number.isFinite(end)) {
        return null;
      }

      return {
        word,
        start,
        end,
      };
    })
    .filter((segment): segment is WordSegment => !!segment)
    .sort((a, b) => a.start - b.start);
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

    const captionsJson = (await captionsResponse.json()) as unknown;
    const words = extractWordSegments(captionsJson);

    if (words.length === 0) {
      return NextResponse.json(
        { error: 'Captions data has no word timestamps' },
        { status: 400 },
      );
    }

    const timedTranscript = buildTimedTranscript(words).slice(0, 140);

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
