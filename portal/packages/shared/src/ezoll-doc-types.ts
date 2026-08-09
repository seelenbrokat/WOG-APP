/** eZoll-/ACCS-PDF-Suffix → fachlicher Typ. */
export type EzollDocType =
  | 'CC529CC' // ABD / Ausfuhrbegleitdokument
  | 'CC599CC' // IE599 Ausfuhranzeige
  | 'EZ922'
  | 'EZ923I'
  | 'CCATBT02BC'
  | 'CCATBT12BC'
  | 'CCATBT52BC'
  | 'CC029CC'
  | 'UNKNOWN';

/**
 * Erlaubte Soloplan-Zuordnungsschlüssel (keine externalNumber / orderReference).
 * MRN ist kein Match-Feld – nur Schreibziel mRNATAPI.
 */
export type EzollSoloplanMatch =
  | { kind: 'orderConsignment'; orderNumber: number; consignmentIndex: number }
  | { kind: 'order'; orderNumber: number }
  | { kind: 'tour'; tourNumber: number };

/** Aus CC529CC/ABD extrahierte Felder für OrderEzoll-Update. */
export type EzollCc529Fields = {
  /** BCP MRN → Soloplan mRNATAPI (kein Match). */
  mrn: string | null;
  /** LRN [12 09] → Soloplan lRN (z. B. 442397.1/C TEAM/POR). */
  lrn: string | null;
  /**
   * Total items = Anzahl Tarifpositionen → Soloplan tarifnummerATAPI (Integer).
   */
  totalItems: number | null;
};

const DOC_SUFFIXES: EzollDocType[] = [
  'CC529CC',
  'CC599CC',
  'EZ923I',
  'EZ922',
  'CCATBT52BC',
  'CCATBT12BC',
  'CCATBT02BC',
  'CC029CC',
];

export function detectEzollDocType(fileName: string): EzollDocType {
  const base = String(fileName || '')
    .split(/[/\\]/)
    .pop()
    ?.replace(/\.pdf$/i, '')
    .trim()
    .toUpperCase() || '';
  for (const code of DOC_SUFFIXES) {
    if (base.endsWith(`_${code}`) || base.endsWith(code)) return code;
  }
  return 'UNKNOWN';
}

/**
 * Soloplan-Keys nur aus Dateiname:
 * - 442397.1_… → Auftrag + Sendung (Auftrag.Sendungsnummer)
 * - 185325_… → Auftrag (5–7 Ziffern)
 * Keine Kundenkürzel / externe Texte / MRN.
 */
export function parseSoloplanMatchFromFilename(fileName: string): EzollSoloplanMatch | null {
  const base = String(fileName || '')
    .split(/[/\\]/)
    .pop()
    ?.replace(/\.pdf$/i, '')
    .trim() || '';
  if (!base) return null;

  // Timestamp-Prefix von processed/-Dateien entfernen: 1786307468677_442397.1_…
  const stripped = base.replace(/^\d{10,16}_/, '');

  const cons = stripped.match(/^(\d{5,7})\.(\d{1,3})(?:[^\d]|$)/);
  if (cons) {
    return {
      kind: 'orderConsignment',
      orderNumber: Number(cons[1]),
      consignmentIndex: Number(cons[2]),
    };
  }

  const order = stripped.match(/^(\d{5,7})(?:[^\d]|$)/);
  if (order) {
    return { kind: 'order', orderNumber: Number(order[1]) };
  }

  return null;
}

/** Auftrag.Sendung aus LRN-Prefix, z. B. 442397.1/C TEAM/POR → 442397.1 */
export function parseSoloplanMatchFromLrn(lrn: string): EzollSoloplanMatch | null {
  const m = String(lrn || '').trim().match(/^(\d{5,7})\.(\d{1,3})\b/);
  if (!m) return null;
  return {
    kind: 'orderConsignment',
    orderNumber: Number(m[1]),
    consignmentIndex: Number(m[2]),
  };
}

/** MRN aus PDF-Text (AT-typisch 18 Zeichen 26AT…), Leerzeichen entfernt. */
export function extractMrnFromPdfText(text: string): string | null {
  const raw = String(text || '');
  // Mit Leerzeichen im PDF: 26AT 920000 C6 HPBWA3
  const spaced = raw.match(/\b26AT(?:\s*[0-9A-Z]){14}\b/i);
  if (spaced) {
    const compact = spaced[0].replace(/\s+/g, '').toUpperCase();
    if (/^26AT[0-9A-Z]{14}$/.test(compact)) return compact;
  }
  const compactHit = raw.match(/\b26AT[0-9A-Z]{14}\b/i);
  return compactHit ? compactHit[0].toUpperCase() : null;
}

/**
 * LRN [12 09], typisch „442397.1/C TEAM/POR“.
 * Vollständigen LRN-String zurückgeben (nicht nur Sendungsnummer).
 */
export function extractLrnFromPdfText(text: string): string | null {
  const raw = String(text || '');
  const nearLabel = raw.match(
    /LRN\s*\[?\s*12\s*09\s*\]?[\s\S]{0,120}?(\d{5,7}\.\d{1,3}\/[^\n\r]{1,80})/i,
  );
  if (nearLabel) {
    return nearLabel[1].replace(/\s+/g, ' ').trim();
  }
  const loose = raw.match(/\b(\d{5,7}\.\d{1,3}\/[A-Z0-9][^\n\r]{0,60})/);
  return loose ? loose[1].replace(/\s+/g, ' ').trim() : null;
}

/**
 * „Total items“ auf dem ABD = Anzahl Waren-/Tarifpositionen.
 * → Soloplan-Feld tarifnummerATAPI (Integer / CFINTEGER39).
 */
export function extractTotalItemsFromPdfText(text: string): number | null {
  const raw = String(text || '');

  // Layout: Total items … Total packages … \n 1  3  1.065,…
  const layout = raw.match(
    /Total\s+items\s+Total\s+packages[\s\S]{0,200}?\n[^\d\n]*(\d{1,3})\s+(\d{1,5})\b/i,
  );
  if (layout) {
    const n = Number(layout[1]);
    if (Number.isFinite(n) && n > 0 && n < 10_000) return n;
  }

  // Raw/zeilenweise: Total items \n Total packages \n 1 \n 3
  const lines = raw.split(/\r?\n/).map((l) => l.trim());
  for (let i = 0; i < lines.length; i++) {
    if (!/^Total\s+items$/i.test(lines[i])) continue;
    // nächste reine Zahl nach optionalem „Total packages“
    for (let j = i + 1; j < Math.min(i + 8, lines.length); j++) {
      if (/^Total\s+packages$/i.test(lines[j])) continue;
      if (/^\d{1,3}$/.test(lines[j])) {
        const n = Number(lines[j]);
        if (n > 0) return n;
      }
      if (lines[j] && !/^(Total|Forms|SCI|BCP|DECLARATION)/i.test(lines[j])) break;
    }
  }

  // Kompakt (pypdf): „EX A\n 1  3  1.065,370000 0\n442397.1/…“
  const compact = raw.match(
    /\bEX\b[\s\S]{0,40}?\b(\d{1,3})\s+(\d{1,5})\s+[\d.]+[.,]\d+/i,
  );
  if (compact) {
    const n = Number(compact[1]);
    if (Number.isFinite(n) && n > 0 && n < 10_000) return n;
  }

  return null;
}

/** Alle CC529-Felder aus ABD-PDF-Text. */
export function extractCc529FieldsFromPdfText(text: string): EzollCc529Fields {
  return {
    mrn: extractMrnFromPdfText(text),
    lrn: extractLrnFromPdfText(text),
    totalItems: extractTotalItemsFromPdfText(text),
  };
}
