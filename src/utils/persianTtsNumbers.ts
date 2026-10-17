import { ToWords } from 'to-words';
import { normalizePersianTtsDigits } from '@/utils/persianTtsDigits';

const persianWords = new ToWords({ localeCode: 'fa-IR' });

function integerWords(digits: string): string {
  return persianWords.convert(Number(digits)).replace(/^یک هزار(?= و|$)/, 'هزار');
}

/** Prepare ordinary Farsi quantities for speech, without guessing structured identifiers. */
export function normalizePersianTtsNumbers(text: string, language: string): string {
  if (language.trim().toLowerCase() !== 'fa') return text;
  const normalized = normalizePersianTtsDigits(text, language);

  // Match structured tokens first so their individual components cannot become quantities.
  const tokens = /https?:\/\/\S+|www\.\S+|[\w.+-]+@[\w.-]+\.[a-z]+|\d+(?:[/:\-]\d+)+|(?:\+\d[\d ()-]{6,}\d|0\d[\d ()-]{5,}\d)|\d+(?:\.\d+){2,}|(?<number>[+−-]?(?:\d{1,3}(?:[,٬]\d{3})+|\d+)(?:[.٫]\d+)?(?:[ \t]*[%٪])?)/giu;

  return normalized.replace(tokens, (token, number: string | undefined, offset: number) => {
    if (number === undefined) return token;
    const before = normalized.slice(0, offset);
    const after = normalized.slice(offset + token.length);
    // Keep identifiers, malformed grouping, dates/times and explicit version contexts intact.
    if (/[\p{L}\p{N}_]$/u.test(before) || /^[\p{L}\p{N}_]/u.test(after)
      || /\d[.,٬٫/:+-]$/.test(before) || /^[.,٬٫/:+-]\d/.test(after)
      || /(?:نسخه|ورژن|version|ver|v)\s*$/iu.test(before)) return token;

    const percent = /[%٪]$/.test(token);
    const unsigned = token.replace(/[%٪ \t,٬]/g, '').replace(/^[+−-]/, '');
    const [whole, fraction] = unsigned.split(/[.٫]/);
    // Long and zero-prefixed integers are commonly phone numbers or codes.
    if (whole.length > 12 || (whole.length > 1 && whole.startsWith('0'))) return token;
    const sign = /^[−-]/.test(token) ? 'منفی ' : token.startsWith('+') ? 'مثبت ' : '';
    let spoken = sign + integerWords(whole);
    if (fraction !== undefined) {
      const fractionalWords = fraction.length > 12 || /^0|0$/.test(fraction)
        ? [...fraction].map(integerWords).join(' ')
        : integerWords(fraction);
      spoken += ` ممیز ${fractionalWords}`;
    }
    return spoken + (percent ? ' درصد' : '');
  });
}
