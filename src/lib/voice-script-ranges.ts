import type { VoiceScript } from './voice-scripts';

// Map spoken sentences back to the original text so local edits preserve paragraph
// breaks, stage directions, and repeated sentences elsewhere in the script.
export function sourceRanges(script?: VoiceScript) {
  if (!script) return [];
  let masked = '';
  let start = 0, depth = 0;
  for (let i = 0; i < script.text.length; i++) {
    if (script.text[i] === '[') {
      if (!depth) start = i;
      depth++;
    }
    else if (script.text[i] === ']' && depth && --depth === 0) masked += ' '.repeat(i - start + 1);
    else if (!depth) masked += script.text[i];
  }
  if (depth) masked += script.text.slice(start);
  const words = Array.from(masked.matchAll(/[^\p{White_Space}]+/gu));
  const normalized = words.map(w => w[0]).join(' ');
  const offsets: number[] = [];
  for (const word of words) {
    for (let i = 0; i < word[0].length; i++) offsets.push(word.index! + i);
    offsets.push(word.index! + word[0].length);
  }
  let cursor = 0;
  return script.sentences.map(line => {
    const from = normalized.indexOf(line, cursor);
    if (from < 0) return null;
    cursor = from + line.length;
    return { from: offsets[from], to: offsets[cursor - 1] + 1 };
  });
}
