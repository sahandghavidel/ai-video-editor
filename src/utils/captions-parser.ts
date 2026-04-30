export interface ParsedWordSegment {
  word: string;
  start: number;
  end: number;
}

export interface ParsedCaptionSegment {
  text: string;
  start: number;
  end: number;
}

const parseNumberish = (value: unknown): number => {
  if (typeof value === 'number') return value;
  if (typeof value === 'string') {
    const n = Number(value);
    return Number.isFinite(n) ? n : Number.NaN;
  }
  return Number.NaN;
};

export function extractTextFromCaptionsPayload(payload: unknown): string {
  if (typeof payload === 'string') {
    return payload.trim();
  }

  if (Array.isArray(payload)) {
    const parts = payload
      .map((item) => {
        if (typeof item === 'string') {
          return item.trim();
        }

        if (typeof item === 'object' && item !== null) {
          const row = item as {
            text?: unknown;
            word?: unknown;
            value?: unknown;
          };

          if (typeof row.text === 'string') return row.text.trim();
          if (typeof row.word === 'string') return row.word.trim();
          if (typeof row.value === 'string') return row.value.trim();
        }

        return '';
      })
      .filter((part) => part.length > 0);

    return parts.join(' ').replace(/\s+/g, ' ').trim();
  }

  if (typeof payload === 'object' && payload !== null) {
    const obj = payload as {
      text?: unknown;
      segments?: unknown;
      words?: unknown;
      data?: unknown;
      Segments?: unknown;
      response?: unknown;
    };

    if (typeof obj.text === 'string' && obj.text.trim().length > 0) {
      return obj.text.trim();
    }

    if (typeof obj.response === 'object' && obj.response !== null) {
      const nestedResponse = obj.response as {
        text?: unknown;
        segments?: unknown;
      };
      if (
        typeof nestedResponse.text === 'string' &&
        nestedResponse.text.trim().length > 0
      ) {
        return nestedResponse.text.trim();
      }
      if (nestedResponse.segments !== undefined) {
        const nestedFromResponse = extractTextFromCaptionsPayload(
          nestedResponse.segments,
        );
        if (nestedFromResponse) return nestedFromResponse;
      }
    }

    const nested = obj.segments ?? obj.words ?? obj.data ?? obj.Segments;
    if (nested !== undefined) {
      return extractTextFromCaptionsPayload(nested);
    }
  }

  return '';
}

function parseSrtTimeToSeconds(raw: string): number {
  const value = raw.trim();
  const match = value.match(/^(\d{1,2}):(\d{2}):(\d{2})[,.](\d{1,3})$/);
  if (!match) return Number.NaN;

  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  const seconds = Number(match[3]);
  const millis = Number(match[4].padEnd(3, '0'));

  if (
    !Number.isFinite(hours) ||
    !Number.isFinite(minutes) ||
    !Number.isFinite(seconds) ||
    !Number.isFinite(millis)
  ) {
    return Number.NaN;
  }

  return hours * 3600 + minutes * 60 + seconds + millis / 1000;
}

export function parseSrtSegments(srtContent: string): ParsedCaptionSegment[] {
  const blocks = srtContent
    .replace(/\r\n/g, '\n')
    .split(/\n{2,}/)
    .map((b) => b.trim())
    .filter(Boolean);

  const segments: ParsedCaptionSegment[] = [];

  for (const block of blocks) {
    const lines = block
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line.length > 0);

    if (lines.length < 2) continue;

    let timeLineIndex = 0;
    if (/^\d+$/.test(lines[0]) && lines.length >= 3) {
      timeLineIndex = 1;
    }

    const timeLine = lines[timeLineIndex];
    if (!timeLine.includes('-->')) continue;

    const [startRaw, endRaw] = timeLine.split('-->').map((part) => part.trim());
    const start = parseSrtTimeToSeconds(startRaw);
    const end = parseSrtTimeToSeconds(endRaw);

    if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) {
      continue;
    }

    const textLines = lines.slice(timeLineIndex + 1);
    const text = textLines.join(' ').replace(/\s+/g, ' ').trim();
    if (!text) continue;

    segments.push({ text, start, end });
  }

  return segments;
}

export function extractTextFromCaptionFileContent(rawContent: string): string {
  const raw = String(rawContent || '').trim();
  if (!raw) return '';

  try {
    const payload = JSON.parse(raw) as unknown;
    const fromJson = extractTextFromCaptionsPayload(payload);
    if (fromJson) return fromJson;
  } catch {
    // Not JSON; try SRT fallback below.
  }

  const srtSegments = parseSrtSegments(raw);
  if (srtSegments.length > 0) {
    return srtSegments
      .map((segment) => segment.text)
      .join(' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  return raw
    .replace(
      /\d{1,2}:\d{2}:\d{2}[,.]\d{1,3}\s*-->\s*\d{1,2}:\d{2}:\d{2}[,.]\d{1,3}/g,
      ' ',
    )
    .replace(/^\d+$/gm, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function parseCaptionFileTimedData(rawContent: string): {
  words: ParsedWordSegment[];
  segments: ParsedCaptionSegment[];
} {
  const raw = String(rawContent || '').trim();
  if (!raw) return { words: [], segments: [] };

  try {
    const payload = JSON.parse(raw) as unknown;

    let candidateItems: unknown[] = [];
    if (Array.isArray(payload)) {
      candidateItems = payload;
    } else if (payload && typeof payload === 'object') {
      const obj = payload as {
        words?: unknown;
        segments?: unknown;
        Segments?: unknown;
        response?: unknown;
      };

      if (Array.isArray(obj.words)) candidateItems = obj.words;
      else if (Array.isArray(obj.segments)) candidateItems = obj.segments;
      else if (Array.isArray(obj.Segments)) candidateItems = obj.Segments;
      else if (obj.response && typeof obj.response === 'object') {
        const r = obj.response as { segments?: unknown };
        if (Array.isArray(r.segments)) candidateItems = r.segments;
      }
    }

    const words: ParsedWordSegment[] = candidateItems
      .map((item) => {
        if (!item || typeof item !== 'object') return null;
        const row = item as {
          word?: unknown;
          start?: unknown;
          end?: unknown;
        };
        const word = typeof row.word === 'string' ? row.word.trim() : '';
        const start = parseNumberish(row.start);
        const end = parseNumberish(row.end);
        if (!word || !Number.isFinite(start) || !Number.isFinite(end)) {
          return null;
        }
        return { word, start, end };
      })
      .filter((x): x is ParsedWordSegment => !!x)
      .sort((a, b) => a.start - b.start);

    const segments: ParsedCaptionSegment[] = candidateItems
      .map((item) => {
        if (!item || typeof item !== 'object') return null;
        const row = item as {
          text?: unknown;
          start?: unknown;
          end?: unknown;
        };
        const text = typeof row.text === 'string' ? row.text.trim() : '';
        const start = parseNumberish(row.start);
        const end = parseNumberish(row.end);
        if (!text || !Number.isFinite(start) || !Number.isFinite(end)) {
          return null;
        }
        return { text, start, end };
      })
      .filter((x): x is ParsedCaptionSegment => !!x)
      .sort((a, b) => a.start - b.start);

    if (words.length > 0 || segments.length > 0) {
      return { words, segments };
    }
  } catch {
    // Non-JSON; fall through to SRT parser.
  }

  return { words: [], segments: parseSrtSegments(raw) };
}
