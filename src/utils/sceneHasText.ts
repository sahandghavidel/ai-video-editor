export type SceneHasTextParsed = {
  hasText: boolean | null;
  imageUrl: string | null;
};

function parseBoolish(v: unknown): boolean | null {
  if (v === true) return true;
  if (v === false) return false;
  if (v === null || v === undefined) return null;

  if (typeof v === 'number') {
    if (!Number.isFinite(v)) return null;
    if (v === 1) return true;
    if (v === 0) return false;
    return null;
  }

  if (typeof v === 'string') {
    const s = v.trim().toLowerCase();
    if (!s) return null;
    if (s === 'true' || s === '1' || s === 'yes' || s === 'on') return true;
    if (s === 'false' || s === '0' || s === 'no' || s === 'off') return false;
    return null;
  }

  if (Array.isArray(v)) {
    if (v.length === 0) return null;
    const parsed = v.map(parseBoolish);
    if (parsed.some((x) => x === true)) return true;
    if (parsed.every((x) => x === false)) return false;
    return null;
  }

  if (typeof v === 'object') {
    const obj = v as Record<string, unknown>;
    const candidate =
      obj.hasText ??
      obj.value ??
      obj.name ??
      obj.text ??
      obj.title ??
      obj.label;
    return parseBoolish(candidate);
  }

  return null;
}

function parseJsonRecord(text: string): SceneHasTextParsed | null {
  const t = text.trim();
  if (!t.startsWith('{') || !t.endsWith('}')) return null;
  try {
    const obj = JSON.parse(t) as unknown;
    if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return null;
    const rec = obj as Record<string, unknown>;
    const hasText = parseBoolish(rec.hasText);
    const imageUrlRaw = rec.imageUrl ?? rec.url ?? rec.image;
    const imageUrl =
      typeof imageUrlRaw === 'string' && imageUrlRaw.trim()
        ? imageUrlRaw.trim()
        : null;
    if (hasText === null && imageUrl === null) return null;
    return { hasText, imageUrl };
  } catch {
    return null;
  }
}

export function parseSceneHasTextField(raw: unknown): SceneHasTextParsed {
  if (raw === null || raw === undefined)
    return { hasText: null, imageUrl: null };

  if (typeof raw === 'string') {
    const s0 = raw.trim();
    if (!s0) return { hasText: null, imageUrl: null };

    // Allow a JSON object payload.
    const json = parseJsonRecord(s0);
    if (json) return json;

    // Preferred encoding: "true|https://..." or "false|https://...".
    if (s0.includes('|')) {
      const [left, ...rest] = s0.split('|');
      const hasText = parseBoolish(left);
      const imageUrlCandidate = rest.join('|').trim();
      const imageUrl = imageUrlCandidate ? imageUrlCandidate : null;
      if (hasText !== null || imageUrl !== null) return { hasText, imageUrl };
    }

    // Also tolerate "true - https://...".
    const m = s0.match(/^(true|false)\s*[-:]\s*(https?:\/\/\S+)\s*$/i);
    if (m) {
      return {
        hasText: parseBoolish(m[1]),
        imageUrl: m[2] ? m[2].trim() : null,
      };
    }

    // Fallback: old single-select/boolean-ish encoding without URL.
    return { hasText: parseBoolish(s0), imageUrl: null };
  }

  if (Array.isArray(raw)) {
    if (raw.length === 0) return { hasText: null, imageUrl: null };
    // Prefer first parseable entry.
    for (const item of raw) {
      const parsed = parseSceneHasTextField(item);
      if (parsed.hasText !== null || parsed.imageUrl !== null) return parsed;
    }
    return { hasText: null, imageUrl: null };
  }

  if (typeof raw === 'object') {
    const obj = raw as Record<string, unknown>;
    const hasText = parseBoolish(
      obj.hasText ??
        obj.value ??
        obj.name ??
        obj.text ??
        obj.title ??
        obj.label,
    );
    const imageUrlRaw = obj.imageUrl ?? obj.url ?? obj.image;
    const imageUrl =
      typeof imageUrlRaw === 'string' && imageUrlRaw.trim()
        ? imageUrlRaw.trim()
        : null;
    return { hasText, imageUrl };
  }

  return { hasText: parseBoolish(raw), imageUrl: null };
}

export function formatSceneHasTextField(options: {
  hasText: boolean;
  imageUrl: string;
}): string {
  const url = String(options.imageUrl || '').trim();
  const v = options.hasText ? 'true' : 'false';
  return url ? `${v}|${url}` : v;
}

export function isHasTextRecordFreshForImage(options: {
  parsed: SceneHasTextParsed;
  imageUrl: string;
}): boolean {
  const current = String(options.imageUrl || '').trim();
  const storedUrl = options.parsed.imageUrl
    ? options.parsed.imageUrl.trim()
    : '';
  if (!current || !storedUrl) return false;
  return current === storedUrl;
}
