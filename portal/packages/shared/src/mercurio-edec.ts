/**
 * Mercurio CH e-dec / Passar PDFs.
 *
 * Einfuhr (e-dec):
 * - edece-{bs|el}-{mandant}-{auftrag}.{sendung}+{ort}-0-1.pdf
 * - edece_evvvat|evvdut-edeceinfuhr-…
 * - edece_bordereau_…
 *
 * Ausfuhr / Passar:
 * - ausfuhr_wa-a_wa_{gp}_{mandant}_{auftrag}.{sendung}{Ort}_{n}_{m}_{GDRN}.pdf
 * - ausfuhr_wa-a_vv_{gp}_{mandant}_{auftrag}.{sendung}{Ort}_{n}_{m}_{GDRN}.pdf
 * - durchfuhr_wa-d_* (Transit, oft Tour) / transportanmeldung_ta_dts_*
 *
 * Beträge (mWSTCH / zollabgabenCH) nur aus eVV Einfuhr – nie Einfuhrliste / Ausfuhr.
 * Match nur über Auftrag.Sendung aus Dateiname/Ref – nie über CH-/AT-MRN/GDRN.
 */

export type MercurioEdecDocType =
  | 'BEZUGSSCHEIN'
  | 'EINFUHRLISTE'
  | 'EVV_MWST'
  | 'EVV_ZOLL'
  | 'BORDEREAU'
  | 'AUSFUHR_WA'
  | 'AUSFUHR_VV'
  | 'DURCHFUHRT'
  | 'TRANSPORT_DTS'
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
  /** EUR.1 / WVB aus Begleitdokument → eUR1_API */
  eur1Number: string | null;
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
  const base = fileBaseName(fileName)
    .replace(/^\d{10,16}_/, '')
    .toLowerCase();
  if (base.startsWith('ausfuhr_wa-a_vv') || /^ausfuhr_.*_vv_/.test(base)) {
    return 'AUSFUHR_VV';
  }
  if (base.startsWith('ausfuhr_wa-a_wa') || /^ausfuhr_.*_wa_/.test(base)) {
    return 'AUSFUHR_WA';
  }
  if (base.startsWith('durchfuhr_')) return 'DURCHFUHRT';
  if (base.startsWith('transportanmeldung_')) return 'TRANSPORT_DTS';
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
 * ausfuhr_wa-a_vv_1000012896_104_417181.1Diep_0_1_26CH06EX… → 417181.1
 */
export function parseMercurioEdecMatchFromFilename(
  fileName: string,
): MercurioEdecMatch | null {
  const base = fileBaseName(fileName).replace(/^\d{10,16}_/, '');
  // Passar Ausfuhr WA/VV: …_104_417181.1Diep_0_1_26CH06EX…
  const ausfuhr = base.match(
    /^ausfuhr_wa-a_(?:vv|wa)_\d+_(\d+)_(\d{5,7})\.(\d{1,3})([A-Za-z0-9]+)_\d+_\d+_[0-9A-Za-z]+$/i,
  );
  if (ausfuhr) {
    return {
      kind: 'orderConsignment',
      orderNumber: Number(ausfuhr[2]),
      consignmentIndex: Number(ausfuhr[3]),
      mandantCode: ausfuhr[1] || null,
      siteCode: ausfuhr[4] || null,
    };
  }
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

/** GDRN aus Passar-Ausfuhr-Dateiname (26CH06EX…). */
export function parseMercurioAusfuhrGdrnFromFilename(
  fileName: string,
): string | null {
  const base = fileBaseName(fileName);
  const m = base.match(/_(26CH[0-9A-Z]{10,})\s*$/i);
  return m ? m[1].toUpperCase() : null;
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

/** CH Zollanmeldungsnummer / GDRN (26CHEI… Einfuhr, 26CH06EX… Passar-Ausfuhr). */
export function extractChDeclarationNumberFromPdfText(text: string): string | null {
  const raw = String(text || '');
  const labeled =
    raw.match(/Zollanmeldungsnummer\s*:\s*(26CH[0-9A-Z]{10,})\b/i)?.[1] ||
    raw.match(/GDRN\s*:\s*(26CH[0-9A-Z]{10,})(?:\.\d+)?\b/i)?.[1] ||
    null;
  if (labeled) return labeled.toUpperCase();

  const hits = [
    ...raw.matchAll(/\b(26CHEI[0-9A-Z]{10,}|26CH[0-9A-Z]{12,})(?:\.\d+)?\b/gi),
  ].map((m) => m[1].toUpperCase());
  return hits[0] || null;
}

export function extractMercurioRefNumberFromPdfText(text: string): string | null {
  const raw = String(text || '');
  const labeled = raw.match(
    /Ref-Nr\.\s*:\s*([0-9]+\/\d{5,7}\.\d{1,3}\/[^\s]+)/i,
  );
  if (labeled) return labeled[1].trim();
  // Passar: Zeile „104/417181.1/Diep/0“ nach Referenz-Block
  const passar = raw.match(/\b(\d+\/\d{5,7}\.\d{1,3}\/[A-Za-z0-9]+\/\d+)\b/);
  return passar ? passar[1].trim() : null;
}

/**
 * EUR.1 / WVB aus Begleitdokumenten → eUR1_API.
 * Beispiele: „WVB EUR.1, T 0691198“, „WVB EUR.1, R0252843“, „S 0981912“.
 * „EUR.1 digital“ ohne klassische Nr. wird ignoriert.
 */
export function extractMercurioEur1FromPdfText(text: string): string | null {
  const raw = String(text || '');
  const m =
    raw.match(/WVB\s+EUR\.?1(?!\s+digital)\s*,\s*([TRS]\s*\d{5,12})\b/i) ||
    raw.match(/\bEUR\.?1(?!\s+digital)\s*,\s*([TRS]\s*\d{5,12})\b/i);
  if (!m?.[1]) return null;
  return m[1].replace(/\s+/g, ' ').trim().toUpperCase();
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
    if (/VERANLAGUNGSVERFÜGUNG\s+AUSFUHR/i.test(raw)) docType = 'AUSFUHR_VV';
    else if (/WARENANMELDUNG\s+AUSFUHR/i.test(raw)) docType = 'AUSFUHR_WA';
    else if (/VERANLAGUNGSVERFÜGUNG\s+MWST/i.test(raw)) docType = 'EVV_MWST';
    else if (/VERANLAGUNGSVERFÜGUNG\s+ZOLL/i.test(raw)) docType = 'EVV_ZOLL';
    else if (/BORDEREAU\s+DER\s+ABGABEN/i.test(raw)) docType = 'BORDEREAU';
    else if (/BEZUGSSCHEIN/i.test(raw)) docType = 'BEZUGSSCHEIN';
    else if (/Einfuhrliste/i.test(raw) || /VORANMELDUNG/i.test(raw)) {
      docType = 'EINFUHRLISTE';
    }
  }

  const reg =
    raw.match(/Anmeld\.\s*Nr\.?\s*:\s*(\d+)/i)?.[1] || null;
  // Einfuhr: Zugangscode: … / Passar Ausfuhr: Zugangscode eVV: …
  const access =
    raw.match(/Zugangscode(?:\s+eVV)?\s*:\s*([A-Za-z0-9+/=_!-]+)/i)?.[1]?.trim() ||
    null;

  let definitiv: boolean | null = null;
  if (/\bDefinitiv\b/i.test(raw) || docType === 'AUSFUHR_VV') definitiv = true;

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

  // Beträge nur aus eVV Einfuhr – Einfuhrliste / Ausfuhr liefern keine mWSTCH
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

  const posRaw =
    raw.match(/Positionen\s+total\s+(\d+)/i)?.[1] ||
    raw.match(/Positionen\s*:\s*(\d+)/i)?.[1];
  let tot = posRaw ? Number(posRaw) : NaN;
  if (!Number.isFinite(tot) || tot <= 0) {
    // Passar VV: Tarifzeilen „9603.4000“ zählen
    const hs = [...raw.matchAll(/^\s*\d+\s+(\d{4}\.\d{4})\b/gm)];
    if (hs.length) tot = hs.length;
  }
  const totalItems = Number.isFinite(tot) && tot > 0 ? tot : null;

  let chDeclarationNumber = extractChDeclarationNumberFromPdfText(raw);
  if (!chDeclarationNumber && fileName) {
    chDeclarationNumber = parseMercurioAusfuhrGdrnFromFilename(fileName);
  }

  return {
    docType,
    chDeclarationNumber,
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
    eur1Number: extractMercurioEur1FromPdfText(raw),
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
    case 'AUSFUHR_WA':
      return 'ausfuhr-wa';
    case 'AUSFUHR_VV':
      return 'ausfuhr-vv';
    case 'DURCHFUHRT':
      return 'durchfuhr';
    case 'TRANSPORT_DTS':
      return 'transport';
    default:
      return 'other';
  }
}
