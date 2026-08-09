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

/** Erlaubte Soloplan-Zuordnungsschlüssel (keine externalNumber / orderReference). */
export type EzollSoloplanMatch =
  | { kind: 'orderConsignment'; orderNumber: number; consignmentIndex: number }
  | { kind: 'order'; orderNumber: number }
  | { kind: 'tour'; tourNumber: number }
  | { kind: 'mrn'; mrn: string };

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
 * - 442397.1_… → Auftrag + Sendung
 * - 185325_… / 185325 NAME_… → Tour oder Auftrag (5–7 Ziffern), hier als order
 * Keine Kundenkürzel / externe Texte.
 */
export function parseSoloplanMatchFromFilename(fileName: string): EzollSoloplanMatch | null {
  const base = String(fileName || '')
    .split(/[/\\]/)
    .pop()
    ?.replace(/\.pdf$/i, '')
    .trim() || '';
  if (!base) return null;

  const cons = base.match(/^(\d{5,7})\.(\d{1,3})(?:[^\d]|$)/);
  if (cons) {
    return {
      kind: 'orderConsignment',
      orderNumber: Number(cons[1]),
      consignmentIndex: Number(cons[2]),
    };
  }

  const order = base.match(/^(\d{5,7})(?:[^\d]|$)/);
  if (order) {
    return { kind: 'order', orderNumber: Number(order[1]) };
  }

  return null;
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
