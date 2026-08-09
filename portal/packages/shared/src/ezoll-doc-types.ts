/** eZoll-/ACCS-Dokumenttyp (PDF-Suffix oder XML MsgTyp). */
export type EzollDocType =
  | 'CC529CC' // ABD / Ausfuhrbegleitdokument (PDF CC529CC, XML CC529C)
  | 'CC599CC' // IE599 Ausfuhranzeige
  | 'EZ922'
  | 'EZ923' // XML EZ923 / PDF EZ923I
  | 'CCATBT02BC'
  | 'CCATBT12BC'
  | 'CCATBT52BC'
  | 'CC029CC' // NCTS Transit (PDF CC029CC / XML CC029C)
  | 'UNKNOWN';

/**
 * Erlaubte Soloplan-Zuordnungsschlüssel (keine externalNumber / orderReference).
 * MRN ist kein Match-Feld – nur Schreibziel mRNATAPI.
 */
export type EzollSoloplanMatch =
  | { kind: 'orderConsignment'; orderNumber: number; consignmentIndex: number }
  | { kind: 'order'; orderNumber: number }
  | { kind: 'tour'; tourNumber: number };

/** Aus CC529C(C) extrahierte Felder für OrderEzoll-Update (bestätigt). */
export type EzollCc529Fields = {
  /** BCP MRN → Soloplan mRNATAPI (kein Match). */
  mrn: string | null;
  /** LRN → Soloplan lRN (z. B. 442397.1/C TEAM/POR). */
  lrn: string | null;
  /**
   * Anzahl Tarifpositionen (PDF Total items / XML GoodsItem) → tarifnummerATAPI.
   */
  totalItems: number | null;
  /**
   * EUR.1-Nummer aus Supporting document N954 → Soloplan eUR1_API.
   * Inkl. führendem X (z. B. „X 613179“). Nicht bei N864.
   */
  eur1Number: string | null;
};

/** Aus EZ922/EZ923 extrahierte Felder (bestätigt). */
export type EzollEz92xFields = {
  msgTyp: 'EZ922' | 'EZ923';
  /** CRN (Zollreferenz) → Soloplan mRNATAPI. */
  crn: string | null;
  /** DefPayRef (Abgaben-/Aufschubkonto) → Soloplan aufschubkonto. */
  abgabenkonto: string | null;
  /** Summe DutyCalc EUSt (B00/5EV) → mWSTAT. */
  mwstAt: number | null;
  /** Summe DutyCalc Zoll (A00) → zollabgabenAT. */
  zollabgabenAt: number | null;
  /** TotItem → tarifnummerATAPI (Anzahl Positionen). */
  totalItems: number | null;
};

const DOC_SUFFIXES: EzollDocType[] = [
  'CC529CC',
  'CC599CC',
  'EZ923',
  'EZ922',
  'CCATBT52BC',
  'CCATBT12BC',
  'CCATBT02BC',
  'CC029CC',
];

function fileBaseName(fileName: string): string {
  return (
    String(fileName || '')
      .split(/[/\\]/)
      .pop()
      ?.replace(/\.(pdf|xml)$/i, '')
      .trim() || ''
  );
}

export function detectEzollDocType(fileName: string): EzollDocType {
  const base = fileBaseName(fileName).toUpperCase();
  if (!base) return 'UNKNOWN';

  // XML AES: …_CC529C_9052 / MsgTyp CC529C → wie PDF CC529CC behandeln
  if (/(?:^|_)CC529C(?:_|$)/.test(base) || base.endsWith('CC529C')) {
    return 'CC529CC';
  }
  // NCTS: …_CC029C_efd7 / MsgTyp CC029C
  if (/(?:^|_)CC029C(?:_|$)/.test(base) || base.endsWith('CC029C') || base.endsWith('CC029CC')) {
    return 'CC029CC';
  }
  // PDF oft EZ923I, XML EZ923
  if (/(?:^|_)EZ923I?(?:_|$)/.test(base) || base.endsWith('EZ923I') || base.endsWith('EZ923')) {
    return 'EZ923';
  }
  if (/(?:^|_)EZ922(?:_|$)/.test(base) || base.endsWith('EZ922')) {
    return 'EZ922';
  }

  for (const code of DOC_SUFFIXES) {
    if (base.endsWith(`_${code}`) || base.endsWith(code)) return code;
    if (new RegExp(`(?:^|_)${code}(?:_|$)`).test(base)) return code;
  }
  return 'UNKNOWN';
}

/**
 * Soloplan-Keys nur aus Dateiname:
 * - 442397.1_… / 442339.1-… → Auftrag + Sendung
 * - 185325_… → Auftrag (5–7 Ziffern)
 * Keine Kundenkürzel / externe Texte / MRN.
 */
export function parseSoloplanMatchFromFilename(fileName: string): EzollSoloplanMatch | null {
  const base = fileBaseName(fileName);
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

/** Match-Key für Dedup XML/PDF, z. B. „442339.1“. */
export function soloplanMatchKey(match: EzollSoloplanMatch | null): string | null {
  if (!match) return null;
  if (match.kind === 'orderConsignment') {
    return `${match.orderNumber}.${match.consignmentIndex}`;
  }
  if (match.kind === 'order') return String(match.orderNumber);
  return `tour:${match.tourNumber}`;
}

/** MRN aus PDF-Text (AT-typisch 18 Zeichen 26AT…), Leerzeichen entfernt. */
export function extractMrnFromPdfText(text: string): string | null {
  const raw = String(text || '');
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

  const layout = raw.match(
    /Total\s+items\s+Total\s+packages[\s\S]{0,200}?\n[^\d\n]*(\d{1,3})\s+(\d{1,5})\b/i,
  );
  if (layout) {
    const n = Number(layout[1]);
    if (Number.isFinite(n) && n > 0 && n < 10_000) return n;
  }

  const lines = raw.split(/\r?\n/).map((l) => l.trim());
  for (let i = 0; i < lines.length; i++) {
    if (!/^Total\s+items$/i.test(lines[i])) continue;
    for (let j = i + 1; j < Math.min(i + 8, lines.length); j++) {
      if (/^Total\s+packages$/i.test(lines[j])) continue;
      if (/^\d{1,3}$/.test(lines[j])) {
        const n = Number(lines[j]);
        if (n > 0) return n;
      }
      if (lines[j] && !/^(Total|Forms|SCI|BCP|DECLARATION)/i.test(lines[j])) break;
    }
  }

  const compact = raw.match(
    /\bEX\b[\s\S]{0,40}?\b(\d{1,3})\s+(\d{1,5})\s+[\d.]+[.,]\d+/i,
  );
  if (compact) {
    const n = Number(compact[1]);
    if (Number.isFinite(n) && n > 0 && n < 10_000) return n;
  }

  return null;
}

/**
 * EUR.1-Nummer aus Supporting document [12 03], Code N954.
 * Beispiele: „2 N954 X 2316731“ → „X 2316731“.
 */
export function extractEur1NumberFromPdfText(text: string): string | null {
  const raw = String(text || '');
  const withLetter = raw.match(/\bN954\b\s+([A-Z]\s+\d{5,12})\b/i);
  if (withLetter) return withLetter[1].replace(/\s+/g, ' ').trim().toUpperCase();
  const digitsOnly = raw.match(/\bN954\b\s+(\d{5,12})\b/i);
  return digitsOnly ? digitsOnly[1] : null;
}

/** Alle CC529-Felder aus ABD-PDF-Text. */
export function extractCc529FieldsFromPdfText(text: string): EzollCc529Fields {
  return {
    mrn: extractMrnFromPdfText(text),
    lrn: extractLrnFromPdfText(text),
    totalItems: extractTotalItemsFromPdfText(text),
    eur1Number: extractEur1NumberFromPdfText(text),
  };
}

function xmlTagText(xml: string, tag: string): string | null {
  const m = String(xml || '').match(new RegExp(`<${tag}>([^<]*)</${tag}>`, 'i'));
  const v = m?.[1]?.trim();
  return v || null;
}

/**
 * Bestätigte CC529C-Felder aus eZoll/AES-XML (MsgTyp CC529C).
 * Weitere Felder bewusst noch nicht – Mapping folgt separat.
 */
export function extractCc529FieldsFromXml(xml: string): EzollCc529Fields {
  const raw = String(xml || '');
  const mrn = xmlTagText(raw, 'MRN');
  const lrn = xmlTagText(raw, 'LRN');

  const itemNums = [
    ...raw.matchAll(/<declarationGoodsItemNumber>(\d+)<\/declarationGoodsItemNumber>/gi),
  ].map((m) => m[1]);
  const uniqueItems = new Set(itemNums);
  const totalItems = uniqueItems.size > 0 ? uniqueItems.size : null;

  let eur1Number: string | null = null;
  for (const block of raw.matchAll(/<SupportingDocument>([\s\S]*?)<\/SupportingDocument>/gi)) {
    const type = block[1].match(/<type>\s*([^<]+?)\s*<\/type>/i)?.[1]?.trim().toUpperCase();
    if (type !== 'N954') continue;
    const ref = block[1].match(/<referenceNumber>\s*([^<]*?)\s*<\/referenceNumber>/i)?.[1]?.trim();
    if (ref) {
      eur1Number = ref.replace(/\s+/g, ' ').toUpperCase();
      break;
    }
  }

  return { mrn, lrn, totalItems, eur1Number };
}

/** true, wenn XML ein CC529C-AES-Message ist. */
export function isCc529Xml(xml: string): boolean {
  const raw = String(xml || '');
  return (
    /<MsgTyp>\s*CC529C\s*<\/MsgTyp>/i.test(raw) ||
    /<messageType>\s*CC529C\s*<\/messageType>/i.test(raw) ||
    /<(?:\w+:)?CC529C[\s>]/i.test(raw)
  );
}

function xmlMsgTyp(xml: string): string | null {
  return xmlTagText(xml, 'MsgTyp')?.toUpperCase() || null;
}

function parseXmlNumber(raw: string | null | undefined): number | null {
  if (raw == null || raw === '') return null;
  const n = Number(String(raw).replace(',', '.').trim());
  return Number.isFinite(n) ? n : null;
}

function roundMoney(n: number): number {
  return Math.round(n * 100) / 100;
}

/**
 * EZ922/EZ923:
 * - CRN → mRNATAPI
 * - DefPayRef (Abgabenkonto) → aufschubkonto
 * - DutyCalc Ty B00/5EV (EUSt) Summe → mWSTAT
 * - DutyCalc Ty A00 (Zoll) Summe → zollabgabenAT
 */
export function extractEz92xFieldsFromXml(xml: string): EzollEz92xFields | null {
  const raw = String(xml || '');
  const typ = xmlMsgTyp(raw);
  if (typ !== 'EZ922' && typ !== 'EZ923') return null;

  const crn = xmlTagText(raw, 'CRN');
  const abgabenkonto = xmlTagText(raw, 'DefPayRef');
  const totRaw = xmlTagText(raw, 'TotItem');
  const tot = totRaw ? Number(totRaw) : NaN;
  const totalItems = Number.isFinite(tot) && tot > 0 ? tot : null;

  let mwst = 0;
  let zoll = 0;
  let sawMwst = false;
  let sawZoll = false;
  for (const block of raw.matchAll(/<DutyCalc>([\s\S]*?)<\/DutyCalc>/gi)) {
    const ty = block[1].match(/<Ty>\s*([^<]+?)\s*<\/Ty>/i)?.[1]?.trim().toUpperCase();
    const amnt = parseXmlNumber(block[1].match(/<Amnt>\s*([^<]*?)\s*<\/Amnt>/i)?.[1]);
    if (amnt == null || !ty) continue;
    if (ty === 'A00') {
      zoll += amnt;
      sawZoll = true;
    } else if (ty === 'B00' || ty === '5EV') {
      mwst += amnt;
      sawMwst = true;
    }
  }

  return {
    msgTyp: typ,
    crn,
    abgabenkonto,
    mwstAt: sawMwst ? roundMoney(mwst) : null,
    zollabgabenAt: sawZoll ? roundMoney(zoll) : null,
    totalItems,
  };
}

export function isEz92xXml(xml: string): boolean {
  const typ = xmlMsgTyp(xml);
  return typ === 'EZ922' || typ === 'EZ923';
}

/** Aus CC029C (NCTS) extrahierte Felder. */
export type EzollCc029Fields = {
  /** Soloplan-Tournummer aus Dateiname / LRN-Prefix. */
  tourNumber: number;
  mrn: string | null;
  /** Vollständige LRN, z. B. „185250 AST-GRIE“. */
  lrn: string | null;
  totalItems: number | null;
};

/** Tournummer aus Dateiname: 185250_AST-GRIE_… / 185250 AST-… */
export function parseTourNumberFromFilename(fileName: string): number | null {
  const base = fileBaseName(fileName).replace(/^\d{10,16}_/, '');
  const m = base.match(/^(\d{5,7})(?:[^\d]|$)/);
  if (!m) return null;
  // Mit Sendungsindex (442397.1) ist es kein reiner Tour-Key
  if (/^\d{5,7}\.\d{1,3}/.test(base)) return null;
  return Number(m[1]);
}

/** Tournummer aus LRN „185250 AST-GRIE“. */
export function parseTourNumberFromLrn(lrn: string): number | null {
  const m = String(lrn || '').trim().match(/^(\d{5,7})(?:\s|$)/);
  return m ? Number(m[1]) : null;
}

export function isCc029Xml(xml: string): boolean {
  const raw = String(xml || '');
  return (
    /<MsgTyp>\s*CC029C\s*<\/MsgTyp>/i.test(raw) ||
    /<messageType>\s*CC029C\s*<\/messageType>/i.test(raw) ||
    /<(?:\w+:)?CC029C[\s>]/i.test(raw)
  );
}

/**
 * CC029C NCTS-XML: Tour-Ebene (LRN beginnt mit Tournummer).
 * Mehrere CC029C pro Tour möglich → Werte später im 7-Tage-Cache mergen.
 */
export function extractCc029FieldsFromXml(
  xml: string,
  fileName?: string,
): EzollCc029Fields | null {
  const raw = String(xml || '');
  if (!isCc029Xml(raw) && detectEzollDocType(fileName || '') !== 'CC029CC') {
    return null;
  }
  const mrn = xmlTagText(raw, 'MRN');
  const lrn = xmlTagText(raw, 'LRN');
  const tourNumber =
    parseTourNumberFromFilename(fileName || '') ||
    (lrn ? parseTourNumberFromLrn(lrn) : null);
  if (!tourNumber) return null;

  const itemNums = [
    ...raw.matchAll(/<declarationGoodsItemNumber>(\d+)<\/declarationGoodsItemNumber>/gi),
    ...raw.matchAll(/<goodsItemNumber>(\d+)<\/goodsItemNumber>/gi),
  ].map((m) => m[1]);
  const uniqueItems = new Set(itemNums);
  const totalItems = uniqueItems.size > 0 ? uniqueItems.size : null;

  return { tourNumber, mrn, lrn, totalItems };
}

/** MRNs für Soloplan mRNATAPI zusammenführen. */
export function joinEzollMrns(mrns: string[]): string | null {
  const uniq = [...new Set(mrns.map((m) => m.trim()).filter(Boolean))];
  return uniq.length ? uniq.join('; ') : null;
}
