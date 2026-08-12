/**
 * Mercurio CH e-dec PDFs (Bezugsschein / Einfuhrliste).
 *
 * Dateiname: edece-{bs|el}-{mandant}-{auftrag}.{sendung}+{ort}-0-1.pdf
 * Beispiel:  edece-bs-104-443153.1+CON-0-1.pdf
 *            edece-el-104-442990.1+Diep-0-1.pdf
 *
 * Match nur über Auftrag.Sendung aus Dateiname/Ref-Nr – nie über CH-/AT-MRN.
 */

export type MercurioEdecDocType = 'BEZUGSSCHEIN' | 'EINFUHRLISTE' | 'UNKNOWN';

export type MercurioEdecMatch = {
  kind: 'orderConsignment';
  orderNumber: number;
  consignmentIndex: number;
  /** Mandanten-/Org-Prefix aus Dateiname (z. B. 104) */
  mandantCode: string | null;
  /** Standort-Kürzel aus Dateiname (CON, Diep, …) */
  siteCode: string | null;
};

export type MercurioEdecFields = {
  docType: MercurioEdecDocType;
  /** CH Zollanmeldungsnummer (26CHEI…) → CustomsRef.mrn */
  chDeclarationNumber: string | null;
  /** Ref-Nr. z. B. 104/443153.1/CON/0/1 → CustomsRef.lrn */
  refNumber: string | null;
  /** AT-Ausfuhr-MRN aus Vorpapiere (nur Info, kein Match) */
  atExportMrn: string | null;
  /** Anmeld. Nr. */
  registrationNumber: string | null;
  /** Zugangscode (EL) */
  accessCode: string | null;
};

function fileBaseName(fileName: string): string {
  return (
    String(fileName || '')
      .split(/[/\\]/)
      .pop()
      ?.replace(/\.(pdf|xml)$/i, '')
      .trim() || ''
  );
}

export function detectMercurioEdecDocType(fileName: string): MercurioEdecDocType {
  const base = fileBaseName(fileName).toLowerCase();
  if (base.startsWith('edece-bs-') || /(?:^|-)bs-\d+-\d+\./.test(base)) {
    return 'BEZUGSSCHEIN';
  }
  if (base.startsWith('edece-el-') || /(?:^|-)el-\d+-\d+\./.test(base)) {
    return 'EINFUHRLISTE';
  }
  return 'UNKNOWN';
}

/**
 * Soloplan-Match aus Mercurio-Dateiname.
 * edece-bs-104-443153.1+CON-0-1 → 443153.1
 */
export function parseMercurioEdecMatchFromFilename(
  fileName: string,
): MercurioEdecMatch | null {
  const base = fileBaseName(fileName).replace(/^\d{10,16}_/, '');
  // …+CON-0-1 / …+Diep-0-1 → Standort vor festem -0-1-Suffix
  const m = base.match(
    /^edece-(bs|el)-(\d+)-(\d{5,7})\.(\d{1,3})\+([A-Za-z0-9]+?)(?:-\d+(?:-\d+)*)?$/i,
  );
  if (!m) return null;
  return {
    kind: 'orderConsignment',
    orderNumber: Number(m[3]),
    consignmentIndex: Number(m[4]),
    mandantCode: m[2] || null,
    siteCode: m[5] || null,
  };
}

/** Ref-Nr. 104/443153.1/CON/0/1 → Auftrag.Sendung */
export function parseMercurioEdecMatchFromRef(
  ref: string,
): MercurioEdecMatch | null {
  const m = String(ref || '')
    .trim()
    .match(/^(\d+)\/(\d{5,7})\.(\d{1,3})\b/);
  if (!m) return null;
  const site = String(ref)
    .split('/')[2]
    ?.trim() || null;
  return {
    kind: 'orderConsignment',
    orderNumber: Number(m[2]),
    consignmentIndex: Number(m[3]),
    mandantCode: m[1] || null,
    siteCode: site,
  };
}

/** CH Zollanmeldungsnummer 26CHEI… (ohne .Positions-Suffix). */
export function extractChDeclarationNumberFromPdfText(text: string): string | null {
  const raw = String(text || '');
  const labeled = raw.match(
    /Zollanmeldungsnummer\s*:\s*(26CHEI[0-9A-Z]{10,})\b/i,
  );
  if (labeled) return labeled[1].toUpperCase();

  const hits = [
    ...raw.matchAll(/\b(26CHEI[0-9A-Z]{10,})(?:\.\d+)?\b/gi),
  ].map((m) => m[1].toUpperCase());
  return hits[0] || null;
}

export function extractMercurioRefNumberFromPdfText(text: string): string | null {
  const m = String(text || '').match(
    /Ref-Nr\.\s*:\s*([0-9]+\/\d{5,7}\.\d{1,3}\/[^\s]+)/i,
  );
  return m ? m[1].trim() : null;
}

export function extractAtExportMrnFromMercurioPdfText(text: string): string | null {
  const raw = String(text || '');
  const labeled = raw.match(
    /Ausfuhrdeklaration\s*,\s*(26AT[0-9A-Z]{14})\b/i,
  );
  if (labeled) return labeled[1].toUpperCase();
  const compact = raw.match(/\b(26AT[0-9A-Z]{14})\b/i);
  return compact ? compact[1].toUpperCase() : null;
}

export function extractMercurioEdecFieldsFromPdfText(
  text: string,
  fileName?: string,
): MercurioEdecFields {
  const raw = String(text || '');
  let docType = fileName ? detectMercurioEdecDocType(fileName) : 'UNKNOWN';
  if (docType === 'UNKNOWN') {
    if (/BEZUGSSCHEIN/i.test(raw)) docType = 'BEZUGSSCHEIN';
    else if (/Einfuhrliste/i.test(raw) || /VORANMELDUNG/i.test(raw)) {
      docType = 'EINFUHRLISTE';
    }
  }

  const reg = raw.match(/Anmeld\.\s*Nr\.\s*:\s*(\d+)/i)?.[1] || null;
  const access = raw.match(/Zugangscode\s*:\s*([A-Za-z0-9]+)/i)?.[1] || null;

  return {
    docType,
    chDeclarationNumber: extractChDeclarationNumberFromPdfText(raw),
    refNumber: extractMercurioRefNumberFromPdfText(raw),
    atExportMrn: extractAtExportMrnFromMercurioPdfText(raw),
    registrationNumber: reg,
    accessCode: access,
  };
}

export function isMercurioEdecFilename(fileName: string): boolean {
  return detectMercurioEdecDocType(fileName) !== 'UNKNOWN';
}
