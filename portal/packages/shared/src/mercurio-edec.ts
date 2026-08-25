/**
 * Mercurio CH e-dec PDFs (Bezugsschein / Einfuhrliste / eVV / Bordereau).
 *
 * Dateinamen:
 * - edece-{bs|el}-{mandant}-{auftrag}.{sendung}+{ort}-0-1.pdf
 * - edece_evvvat-edeceinfuhr-{mandant}-{auftrag}.{sendung}+{ort}-0-1.pdf
 * - edece_evvdut-edeceinfuhr-{mandant}-{auftrag}.{sendung}+{ort}-0-1.pdf
 * - edece_bordereau_{mandant}_{konto}_{uid}_{bordereau}_{n}_{yyyyMMdd}.pdf
 *
 * Beträge (mWSTCH / zollabgabenCH / Bordereau) kommen aus eVV – nie aus Einfuhrliste.
 * Match nur über Auftrag.Sendung aus Dateiname/Ref-Nr – nie über CH-/AT-MRN.
 */

export type MercurioEdecDocType =
  | 'BEZUGSSCHEIN'
  | 'EINFUHRLISTE'
  | 'EVV_MWST'
  | 'EVV_ZOLL'
  | 'BORDEREAU'
  | 'UNKNOWN';

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
  /** CH Zollanmeldungsnummer (26CHEI…) → mRNAPI / zollanmeldungsnummer */
  chDeclarationNumber: string | null;
  /** Ref-Nr. z. B. 104/443153.1/CON/0/1 → refNr */
  refNumber: string | null;
  /** AT-Ausfuhr-MRN aus Vorpapiere (nur Info, kein Match) */
  atExportMrn: string | null;
  /** Anmeld. Nr. */
  registrationNumber: string | null;
  /** Zugangscode → zugangscode */
  accessCode: string | null;
  /** Definitiv-Flag aus PDF */
  definitiv: boolean | null;
  /** Konto Zoll → kontoZoll */
  kontoZoll: string | null;
  /** Konto MWST → kontoMWST */
  kontoMwst: string | null;
  /** ZAZ Konto falls vorhanden */
  zazKonto: string | null;
  /**
   * MWST-Abgabe CHF → mWSTCH.
   * Nur aus eVV MWST (Gesamtbetrag MWST), nie MWST-Wert aus Einfuhrliste.
   */
  mwstCh: number | null;
  /** Zollabgaben CHF → zollabgabenCH (nur eVV Zoll) */
  zollabgabenCh: number | null;
  /** Bearbeitungsgebühr → bearbeitungsgebührCH (falls auf eVV) */
  bearbeitungsgebuehrCh: number | null;
  /** Anzahl Positionen → tarifnummernCHAPI */
  totalItems: number | null;
  /**
   * Bordereaunummer (PDF/Dateiname als Ziffernstring).
   * Soloplan-Feld `bordereaunummer` ist Integer – Umwandlung beim Write.
   */
  bordereauNumber: string | null;
  /** eVV MWST vorhanden → veranlagungsverfügungMWST */
  veranlagungMwst: boolean | null;
  /** eVV Zoll vorhanden → veranlagungsverfügungZoll */
  veranlagungZoll: boolean | null;
};

/** Eine Zeile aus dem Abgaben-Bordereau (VVZ/VVM je Sendung). */
export type MercurioBordereauLine = {
  kind: 'VVZ' | 'VVM' | 'OTHER';
  match: MercurioEdecMatch;
  chDeclarationNumber: string | null;
  amountChf: number | null;
};

export type MercurioBordereauFields = {
  bordereauNumber: string | null;
  lines: MercurioBordereauLine[];
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
  if (base.startsWith('edece_evvvat') || base.includes('evvvat')) return 'EVV_MWST';
  if (base.startsWith('edece_evvdut') || base.includes('evvdut')) return 'EVV_ZOLL';
  if (base.startsWith('edece_bordereau') || base.includes('bordereau')) {
    return 'BORDEREAU';
  }
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
 * edece_evvvat-edeceinfuhr-104-444230.1+CON-0-1 → 444230.1
 */
export function parseMercurioEdecMatchFromFilename(
  fileName: string,
): MercurioEdecMatch | null {
  const base = fileBaseName(fileName).replace(/^\d{10,16}_/, '');
  // eVV: edece_evvvat-edeceinfuhr-104-444230.1+CON-0-1
  const evv = base.match(
    /^edece_evv(?:vat|dut)-edeceinfuhr-(\d+)-(\d{5,7})\.(\d{1,3})\+([A-Za-z0-9]+?)(?:-\d+(?:-\d+)*)?$/i,
  );
  if (evv) {
    return {
      kind: 'orderConsignment',
      orderNumber: Number(evv[2]),
      consignmentIndex: Number(evv[3]),
      mandantCode: evv[1] || null,
      siteCode: evv[4] || null,
    };
  }
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

/** Bordereau-Nr. aus Dateiname: …_1557466_72_20260824 */
export function parseMercurioBordereauNumberFromFilename(
  fileName: string,
): string | null {
  const base = fileBaseName(fileName);
  const m = base.match(
    /^edece_bordereau_\d+_[^_]+_[^_]+_(\d+)_\d+_\d{8}$/i,
  );
  return m?.[1] || null;
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

/**
 * „6898-0 WOG…“ / „14037-9“ / eVV „68980-WOG…“ → Ziffern inkl. optionalem Bindestrich.
 * (Soloplan kontoMWST schreibt ohne Bindestrich – siehe Write.)
 */
export function extractChKontoNumber(raw: string | null | undefined): string | null {
  const m = String(raw || '')
    .trim()
    .match(/^(\d+(?:-\d+)*)\b/);
  return m ? m[1] : null;
}

/** kontoMWST ohne Bindestrich: 6898-0 → 68980, 68980 bleibt 68980. */
export function normalizeChKontoMwstForSoloplan(
  konto: string | null | undefined,
): string | null {
  const s = String(konto || '').trim();
  if (!s) return null;
  const compact = s.replace(/-/g, '');
  return /^\d+$/.test(compact) ? compact : s;
}

/** @deprecated Alias – MWST ohne Bindestrich. */
export function normalizeChKontoForSoloplan(
  konto: string | null | undefined,
): string | null {
  return normalizeChKontoMwstForSoloplan(konto);
}

/** CH-Beträge: 53'424 / 1.234,56 / 3200.37 / 184.50 */
export function parseChAmount(raw: string | null | undefined): number | null {
  if (raw == null) return null;
  let s = String(raw).trim();
  if (!s) return null;
  s = s.replace(/'/g, '').replace(/\s/g, '');
  if (s.includes(',') && s.includes('.')) {
    s = s.replace(/\./g, '').replace(',', '.');
  } else if (s.includes(',')) {
    s = s.replace(',', '.');
  }
  const n = Number(s);
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : null;
}

function firstLabeledAmount(text: string, labels: RegExp[]): number | null {
  for (const re of labels) {
    const m = text.match(re);
    if (m?.[1]) {
      const n = parseChAmount(m[1]);
      if (n != null) return n;
    }
  }
  return null;
}

export function extractMercurioEdecFieldsFromPdfText(
  text: string,
  fileName?: string,
): MercurioEdecFields {
  const raw = String(text || '');
  let docType = fileName ? detectMercurioEdecDocType(fileName) : 'UNKNOWN';
  if (docType === 'UNKNOWN') {
    if (/VERANLAGUNGSVERFÜGUNG\s+MWST/i.test(raw)) docType = 'EVV_MWST';
    else if (/VERANLAGUNGSVERFÜGUNG\s+ZOLL/i.test(raw)) docType = 'EVV_ZOLL';
    else if (/BORDEREAU\s+DER\s+ABGABEN/i.test(raw)) docType = 'BORDEREAU';
    else if (/BEZUGSSCHEIN/i.test(raw)) docType = 'BEZUGSSCHEIN';
    else if (/Einfuhrliste/i.test(raw) || /VORANMELDUNG/i.test(raw)) {
      docType = 'EINFUHRLISTE';
    }
  }

  const reg =
    raw.match(/Anmeld\.\s*Nr\.?\s*:\s*(\d+)/i)?.[1] || null;
  // z. B. jzLBdDDNjvFSjRS0 / xtqzX5+o45JDrMFN / ebN9HRo!e8QJVkOg
  const access =
    raw.match(/Zugangscode\s*:\s*([A-Za-z0-9+/=_!-]+)/i)?.[1]?.trim() || null;

  let definitiv: boolean | null = null;
  if (/\bDefinitiv\b/i.test(raw)) definitiv = true;

  const kontoZoll = extractChKontoNumber(
    raw.match(/Konto\s+Zoll\s*:\s*([^\n]+)/i)?.[1],
  );
  const kontoMwst = extractChKontoNumber(
    raw.match(/Konto\s+MWST\s*:\s*([^\n]+)/i)?.[1],
  );
  const zazKonto = extractChKontoNumber(
    raw.match(/ZAZ[-\s]?Konto\s*:\s*([^\n]+)/i)?.[1],
  );

  const bordereauNumber =
    raw.match(/Bordereaunummer\s*:\s*(\d+)/i)?.[1] ||
    (fileName ? parseMercurioBordereauNumberFromFilename(fileName) : null);

  // Beträge nur aus eVV – Einfuhrliste liefert bewusst keine mWSTCH/zollabgabenCH
  let mwstCh: number | null = null;
  let zollabgabenCh: number | null = null;
  let bearbeitungsgebuehrCh: number | null = null;
  let veranlagungMwst: boolean | null = null;
  let veranlagungZoll: boolean | null = null;

  if (docType === 'EVV_MWST') {
    veranlagungMwst = true;
    mwstCh = firstLabeledAmount(raw, [
      /Gesamtbetrag\s+MWST\s*\[CHF\]\s*:\s*([0-9.'\s]+)/i,
      /Gesamtbetrag\s+MWST\s*:\s*([0-9.'\s]+)/i,
    ]);
    // Fallback: letzte Spalte „MWST [CHF]“ in der Positionszeile Bemessungsgrundlage
    if (mwstCh == null) {
      mwstCh = firstLabeledAmount(raw, [
        /Bemessungsgrundlage\s+MWST\s*:[^\n]*?([0-9.'\s]+)\s*$/im,
      ]);
    }
  } else if (docType === 'EVV_ZOLL') {
    veranlagungZoll = true;
    zollabgabenCh = firstLabeledAmount(raw, [
      /Zollabgaben\s+([0-9.'\s]+)/i,
      /Gesamtbetrag\s*:\s*([0-9.'\s]+)/i,
    ]);
  }

  const posRaw = raw.match(/Positionen\s*:\s*(\d+)/i)?.[1];
  const tot = posRaw ? Number(posRaw) : NaN;
  const totalItems = Number.isFinite(tot) && tot > 0 ? tot : null;

  return {
    docType,
    chDeclarationNumber: extractChDeclarationNumberFromPdfText(raw),
    refNumber: extractMercurioRefNumberFromPdfText(raw),
    atExportMrn: extractAtExportMrnFromMercurioPdfText(raw),
    registrationNumber: reg,
    accessCode: access,
    definitiv,
    kontoZoll,
    kontoMwst,
    zazKonto,
    mwstCh,
    zollabgabenCh,
    bearbeitungsgebuehrCh,
    totalItems,
    bordereauNumber,
    veranlagungMwst,
    veranlagungZoll,
  };
}

/**
 * Bordereau: Zeilen VVZ/VVM mit Ref + CH-Nr + Betrag.
 * Beispiel: VVM 104/445921.1/Diep/0/1 26CHEI004440158958.1 160.20
 */
export function extractMercurioBordereauFieldsFromPdfText(
  text: string,
  fileName?: string,
): MercurioBordereauFields {
  const raw = String(text || '');
  const bordereauNumber =
    (fileName ? parseMercurioBordereauNumberFromFilename(fileName) : null) ||
    raw.match(/^\s*(\d{6,})\s*$/m)?.[1] ||
    null;

  const lines: MercurioBordereauLine[] = [];
  for (const m of raw.matchAll(
    /\b(VVZ|VVM)\s+(\d+\/\d{5,7}\.\d{1,3}\/[^\s]+)\s+(26CHEI[0-9A-Z.]+)\s+([0-9.']+)/gi,
  )) {
    const match = parseMercurioEdecMatchFromRef(m[2]);
    if (!match) continue;
    lines.push({
      kind: m[1].toUpperCase() as 'VVZ' | 'VVM',
      match,
      chDeclarationNumber: String(m[3]).replace(/\.\d+$/, '').toUpperCase(),
      amountChf: parseChAmount(m[4]),
    });
  }

  return { bordereauNumber, lines };
}

export function isMercurioEdecFilename(fileName: string): boolean {
  return detectMercurioEdecDocType(fileName) !== 'UNKNOWN';
}

export function mercurioProcessedSubdir(docType: MercurioEdecDocType): string {
  switch (docType) {
    case 'BEZUGSSCHEIN':
      return 'bezugsschein';
    case 'EINFUHRLISTE':
      return 'einfuhrliste';
    case 'EVV_MWST':
      return 'evv-mwst';
    case 'EVV_ZOLL':
      return 'evv-zoll';
    case 'BORDEREAU':
      return 'bordereau';
    default:
      return 'other';
  }
}
