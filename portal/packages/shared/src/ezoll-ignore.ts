/** Org-Setting-Key: Dateiname-Präfixe, die im eZoll-Drop ignoriert werden. */
export const EZOLL_FILENAME_IGNORE_PREFIXES_KEY = 'ezoll.filenameIgnorePrefixes';

/**
 * Standard: Tour-/Smart-Border-Dateien ohne Soloplan-Bezug
 * (z. B. Transit-Eingangsschein CCATBT12BC unter 131.* / 671.*).
 */
export const DEFAULT_EZOLL_FILENAME_IGNORE_PREFIXES = ['131.', '671.'] as const;

/** Normalisiert Admin-Eingabe zu eindeutigen, nicht-leeren Präfixen. */
export function normalizeFilenameIgnorePrefixes(
  input: unknown,
  fallback: readonly string[] = DEFAULT_EZOLL_FILENAME_IGNORE_PREFIXES,
): string[] {
  let raw: string[] = [];
  if (Array.isArray(input)) {
    raw = input.map((x) => String(x ?? ''));
  } else if (typeof input === 'string') {
    raw = input.split(/[\n,;]+/);
  }
  const out: string[] = [];
  const seen = new Set<string>();
  for (const part of raw) {
    const p = part.trim();
    if (!p || seen.has(p)) continue;
    seen.add(p);
    out.push(p);
  }
  return out.length ? out : [...fallback];
}

/** true, wenn der Dateiname (ohne Pfad) mit einem Ignore-Präfix beginnt. */
export function matchesFilenameIgnorePrefix(
  fileName: string,
  prefixes: readonly string[],
): boolean {
  const base = String(fileName || '')
    .split(/[/\\]/)
    .pop()
    ?.trim() || '';
  if (!base) return false;
  return prefixes.some((p) => p && base.startsWith(p));
}
