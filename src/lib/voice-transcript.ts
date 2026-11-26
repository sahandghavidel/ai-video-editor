export type TimedWord = { word: string; start: number; end: number };
export type WordFlag = { kind: 'Missing' | 'Extra'; word: string; start: number };

const tokens = (value: string) => value.toLowerCase().replace(/[’']/gu, '').match(/[\p{L}\p{N}]+/gu) || [];

// Align the two word sequences so one omission does not flag every later word.
export function compareWords(narration: string, words: TimedWord[]): WordFlag[] {
  const expected = tokens(narration);
  const heard = words.flatMap(w => tokens(w.word).map(word => ({ word, start: w.start })));
  const width = heard.length + 1;
  if ((expected.length + 1) * width > 12_000_000) throw Error('This transcript is too long for sentence comparison.');
  const lengths = new Uint32Array((expected.length + 1) * width);
  for (let i = expected.length - 1; i >= 0; i--) {
    for (let j = heard.length - 1; j >= 0; j--) {
      const k = i * width + j;
      lengths[k] = expected[i] === heard[j].word ? 1 + lengths[k + width + 1] : Math.max(lengths[k + 1], lengths[k + width]);
    }
  }
  const flags: WordFlag[] = [];
  let i = 0, j = 0;
  while (i < expected.length || j < heard.length) {
    if (i < expected.length && j < heard.length && expected[i] === heard[j].word) { i++; j++; continue; }
    if (i < expected.length && (j === heard.length || lengths[(i + 1) * width + j] >= lengths[i * width + j + 1])) {
      flags.push({ kind: 'Missing', word: expected[i++], start: Math.max(0, (heard[j]?.start ?? words.at(-1)?.end ?? 0) - 0.5) });
    } else flags.push({ kind: 'Extra', word: heard[j].word, start: Math.max(0, heard[j++].start - 0.2) });
  }
  return flags;
}
