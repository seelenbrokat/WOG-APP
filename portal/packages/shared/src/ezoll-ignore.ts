/** Org-Setting-Key: Dateiname-Muster, die im eZoll-Drop ignoriert werden. */
export const EZOLL_FILENAME_IGNORE_PREFIXES_KEY = 'ezoll.filenameIgnorePrefixes';

/**
 * Standard-Ignore:
 * - `131.` / `671.` → Dateiname beginnt damit (Tour-Referenzen)
 * - `HOLENSTEIN` / `SCHEFKNECHT` → kommt im Dateinamen vor (Groß/Klein egal)
 */
export const DEFAULT_EZOLL_FILENAME_IGNORE_PREFIXES = [
  '131.',
  '671.',
  'HOLENSTEIN',
  'SCHEFKNECHT',
] as const;

/** Normalisiert Admin-Eingabe zu eindeutigen, nicht-leeren Mustern. */
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

/**
 * Entfernt optionales Processor-Prefix `1790…_` vor dem echten Dateinamen.
 * Ohne das greifen Präfixe wie `671.` nicht auf `1790…_671.221….pdf`.
 */
export function stripEzollProcessorFilenamePrefix(fileName: string): string {
  const base =
    String(fileName || '')
      .split(/[/\\]/)
      .pop()
      ?.trim() || '';
  return base.replace(/^\d{12,}_/, '');
}

/**
 * true, wenn der Dateiname zum Ignore-Muster passt.
 * - Muster endet mit `.` → Präfix (startsWith) auf dem bereinigten Basisnamen
 * - sonst → Teilstring (case-insensitive includes)
 */
export function matchesFilenameIgnorePrefix(
  fileName: string,
  prefixes: readonly string[],
): boolean {
  const base = stripEzollProcessorFilenamePrefix(fileName);
  if (!base) return false;
  const baseUpper = base.toUpperCase();
  return prefixes.some((p) => {
    if (!p) return false;
    if (p.endsWith('.')) return base.startsWith(p);
    return baseUpper.includes(p.toUpperCase());
  });
}

/** Tour-Müll wie `671.221…` – immer löschen, nicht archivieren. */
export function isEzollJunkFilename(fileName: string): boolean {
  const base = stripEzollProcessorFilenamePrefix(fileName);
  return base.startsWith('671.') || base.startsWith('131.');
}
