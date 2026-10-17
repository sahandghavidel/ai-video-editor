/** Normalize digit shapes only in outbound Farsi speech; keep punctuation and wording. */
export function normalizePersianTtsDigits(text: string, language: string): string {
  if (language.trim().toLowerCase() !== 'fa') return text;

  return text.replace(/[۰-۹٠-٩]/g, (digit) => {
    const code = digit.charCodeAt(0);
    return String(code >= 0x06f0 ? code - 0x06f0 : code - 0x0660);
  });
}
