/**
 * Parser für Unitec-/Ausfuhr-Proforma-Rechnungen (Text oder PDF-Rohtext).
 * Erwartetes Muster je Sendungsblock:
 *   BK2601352 LI2601957 / 100 kg / Colli 1
 */

export type ProformaShipmentLine = {
  bk: string;
  li?: string;
  weightKg?: number;
  colli?: number;
};

export type ParsedProformaInvoice = {
  proformaNumber?: string;
  customerName?: string;
  invoiceDate?: string;
  totalWeightKg?: number;
  totalColli?: number;
  lines: ProformaShipmentLine[];
  sourceTextPreview?: string;
};

/** BK/LI-Zeilen aus Rechnungs-Text extrahieren. */
export function parseProformaInvoiceText(text: string): ParsedProformaInvoice {
  const normalized = text.replace(/\r/g, '\n').replace(/\u00a0/g, ' ');

  const proformaNumber =
    normalized.match(/\bPRO\s*([0-9]{4,})\b/i)?.[0]?.replace(/\s+/g, '') ||
    normalized.match(/\bProforma\s+Rechnung\s+(PRO[0-9]+)/i)?.[1] ||
    undefined;

  const customerName =
    normalized.match(/Unitec\s+Energietechnik\s+GmbH/i)?.[0] ||
    normalized.match(/Kunde[n]?:\s*([^\n]+)/i)?.[1]?.trim() ||
    undefined;

  const invoiceDate =
    normalized.match(/\b(\d{2}\.\d{2}\.\d{4})\b/)?.[1] || undefined;

  const lines: ProformaShipmentLine[] = [];
  const lineRe =
    /\b(BK\d{6,})\s+(LI\d{6,})?\s*\/\s*([\d.,]+)\s*kg\s*\/\s*Colli\s*(\d+)/gi;
  let m: RegExpExecArray | null;
  while ((m = lineRe.exec(normalized))) {
    const bk = m[1].toUpperCase();
    if (lines.some((l) => l.bk === bk)) continue;
    lines.push({
      bk,
      li: m[2]?.toUpperCase(),
      weightKg: Number(String(m[3]).replace(/\./g, '').replace(',', '.')) || undefined,
      colli: Number(m[4]) || undefined,
    });
  }

  // Fallback: nur BK + LI ohne kg/Colli
  if (!lines.length) {
    const loose = normalized.matchAll(/\b(BK\d{6,})\s+(LI\d{6,})/gi);
    for (const hit of loose) {
      const bk = hit[1].toUpperCase();
      if (lines.some((l) => l.bk === bk)) continue;
      lines.push({ bk, li: hit[2].toUpperCase() });
    }
  }

  const totalWeightKg =
    Number(
      normalized
        .match(/Gewicht:\s*([\d.\s]+)\s*kg/i)?.[1]
        ?.replace(/\s/g, '')
        .replace(/\./g, '')
        .replace(',', '.'),
    ) ||
    lines.reduce((s, l) => s + (l.weightKg || 0), 0) ||
    undefined;

  const totalColli =
    Number(normalized.match(/Anzahl\s+Pakete:\s*(\d+)/i)?.[1]) ||
    lines.reduce((s, l) => s + (l.colli || 0), 0) ||
    undefined;

  return {
    proformaNumber: proformaNumber?.toUpperCase(),
    customerName,
    invoiceDate,
    totalWeightKg: totalWeightKg || undefined,
    totalColli: totalColli || undefined,
    lines,
    sourceTextPreview: normalized.slice(0, 400),
  };
}

/**
 * Grobe Texttextraktion aus PDF-Bytes (ohne Extra-Dependency).
 * Reicht für Unitec-Proformas, in denen BK/LI als Literalstrings stehen.
 */
export function extractTextFromPdfBuffer(buf: Buffer): string {
  const latin = buf.toString('latin1');
  const chunks: string[] = [];

  // PDF-String-Literale (...)
  const re = /\((?:\\.|[^\\)]){2,}\)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(latin))) {
    let s = m[0].slice(1, -1);
    s = s
      .replace(/\\n/g, '\n')
      .replace(/\\r/g, '\n')
      .replace(/\\t/g, ' ')
      .replace(/\\\(/g, '(')
      .replace(/\\\)/g, ')')
      .replace(/\\\\/g, '\\');
    if (/[A-Za-z0-9]/.test(s)) chunks.push(s);
  }

  // Zusätzlich Rohsuche nach BK/LI-Mustern im Byte-Stream
  const ascii = buf.toString('utf8', 0, buf.length);
  const bkHits = ascii.match(/BK\d{6,}[\s\S]{0,40}LI\d{6,}[\s\S]{0,40}Colli\s*\d+/gi) || [];
  chunks.push(...bkHits);

  return `${chunks.join('\n')}\n${ascii}`;
}
