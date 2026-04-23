export interface CaptionWordTimestamp {
  word: string;
  start: number;
  end: number;
}

const normalizeToken = (value: unknown): string =>
  String(value ?? '')
    .replace(/\s+/g, ' ')
    .trim();

const isFiniteNumber = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value);

const isIntegerToken = (token: string): boolean => /^\d+$/.test(token);
const isFractionToken = (token: string): boolean => /^\.\d+$/.test(token);
const isDotToken = (token: string): boolean => token === '.';
const isNumericToken = (token: string): boolean =>
  /^(?:\d+(?:\.\d+)?|\.\d+)$/.test(token);
const isWordLikeToken = (token: string): boolean => /^[a-z0-9]+$/i.test(token);
const isStandaloneDashToken = (token: string): boolean => /^[-–—]$/.test(token);
const getPercentSuffix = (token: string): string | null => {
  const match = token.match(/^%([.,!?;:]?)$/);
  if (!match) return null;
  return `%${match[1] || ''}`;
};

export const sanitizeCaptionWordTimestamps = (
  words: CaptionWordTimestamp[],
): CaptionWordTimestamp[] => {
  const normalized = (Array.isArray(words) ? words : [])
    .map((entry) => ({
      word: normalizeToken(entry.word),
      start: entry.start,
      end: entry.end,
    }))
    .filter(
      (entry) =>
        entry.word.length > 0 &&
        isFiniteNumber(entry.start) &&
        isFiniteNumber(entry.end),
    );

  const merged: CaptionWordTimestamp[] = [];

  for (let i = 0; i < normalized.length; i++) {
    const current = normalized[i];
    const next = normalized[i + 1];
    const afterNext = normalized[i + 2];

    // Merge split decimals like: "0" + ".3" => "0.3"
    if (next && isIntegerToken(current.word) && isFractionToken(next.word)) {
      merged.push({
        word: `${current.word}${next.word}`,
        start: current.start,
        end: next.end,
      });
      i += 1;
      continue;
    }

    // Merge split decimals like: "0" + "." + "3" => "0.3"
    if (
      next &&
      afterNext &&
      isIntegerToken(current.word) &&
      isDotToken(next.word) &&
      isIntegerToken(afterNext.word)
    ) {
      merged.push({
        word: `${current.word}.${afterNext.word}`,
        start: current.start,
        end: afterNext.end,
      });
      i += 2;
      continue;
    }

    // Merge split decimals like: "0." + "3" => "0.3"
    if (next && /^\d+\.$/.test(current.word) && isIntegerToken(next.word)) {
      merged.push({
        word: `${current.word}${next.word}`,
        start: current.start,
        end: next.end,
      });
      i += 1;
      continue;
    }

    // Merge hyphenated words like: "front" + "-" + "end" => "front-end"
    if (
      next &&
      afterNext &&
      isWordLikeToken(current.word) &&
      isStandaloneDashToken(next.word) &&
      isWordLikeToken(afterNext.word)
    ) {
      merged.push({
        word: `${current.word}-${afterNext.word}`,
        start: current.start,
        end: afterNext.end,
      });
      i += 2;
      continue;
    }

    // Merge hyphen tail like: "front-" + "end" => "front-end"
    if (
      next &&
      /^[a-z0-9]+[-–—]$/i.test(current.word) &&
      isWordLikeToken(next.word)
    ) {
      merged.push({
        word: `${current.word}${next.word}`,
        start: current.start,
        end: next.end,
      });
      i += 1;
      continue;
    }

    // Merge hyphen prefix like: "front" + "-end" => "front-end"
    if (
      next &&
      isWordLikeToken(current.word) &&
      /^[-–—][a-z0-9]+$/i.test(next.word)
    ) {
      merged.push({
        word: `${current.word}${next.word}`,
        start: current.start,
        end: next.end,
      });
      i += 1;
      continue;
    }

    merged.push(current);
  }

  // Second pass: merge split percentage tokens after numeric merges are done.
  // Examples:
  // - "30" + "%" => "30%"
  // - "0" + "." + "3" + "%" => "0.3%" (decimal merges in pass 1, percent in pass 2)
  // - "30" + "percent" => "30%"
  const mergedPercent: CaptionWordTimestamp[] = [];

  for (let i = 0; i < merged.length; i++) {
    const current = merged[i];
    const next = merged[i + 1];

    if (next && isNumericToken(current.word)) {
      const percentSuffix = getPercentSuffix(next.word);
      if (percentSuffix) {
        mergedPercent.push({
          word: `${current.word}${percentSuffix}`,
          start: current.start,
          end: next.end,
        });
        i += 1;
        continue;
      }

      if (/^percent$/i.test(next.word)) {
        mergedPercent.push({
          word: `${current.word}%`,
          start: current.start,
          end: next.end,
        });
        i += 1;
        continue;
      }
    }

    mergedPercent.push(current);
  }

  return mergedPercent;
};
