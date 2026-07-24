/**
 * Parser für SCHMIDT'S „Ladeliste Neu“ (PDF/Text).
 *
 * Typischer Block:
 *   LAK12146172 (Zustellung)     Collonummer …
 *   Kunde: SCHMIDT'S …           00369999990003964283 1 Stangenware … 4,43 kg
 *   Empfänger: Weber Arthur AG
 *   … Gesamt: 1 Colli …
 */

export type SchmidtsLadelisteCollo = {
  sscc: string;
  packaging?: string;
  weightKg?: number;
};

export type SchmidtsLadelisteLine = {
  lak: string;
  recipientName?: string;
  recipientZip?: string;
  recipientCity?: string;
  recipientRef?: string;
  freightPayerRef?: string;
  colliCount?: number;
  totalWeightKg?: number;
  colli: SchmidtsLadelisteCollo[];
};

export type ParsedSchmidtsLadeliste = {
  listDate?: string; // YYYY-MM-DD
  listDateRaw?: string;
  transportNumber?: string;
  customerName?: string;
  totalColli?: number;
  totalWeightKg?: number;
  lines: SchmidtsLadelisteLine[];
  sourceTextPreview?: string;
};

function deDateToIso(d: string, m: string, y: string): string {
  return `${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`;
}

function parseDeWeight(raw: string): number | undefined {
  const n = Number(String(raw).replace(/\./g, '').replace(',', '.'));
  return Number.isFinite(n) ? n : undefined;
}

/** SSCC-ähnliche Ziffernfolgen (18–20) aus einer Zeile. */
function extractSsccs(block: string): string[] {
  const hits = block.match(/\b00\d{18}\b|\b0?\d{17,18}\b/g) || [];
  const out: string[] = [];
  for (const h of hits) {
    const digits = h.replace(/\D/g, '');
    // Collonummern bei Schmidts beginnen typisch mit 0036… / 36…
    if (digits.length < 17 || digits.length > 20) continue;
    if (!/^0*36|^0*0912|^0*912/.test(digits) && digits.length !== 18 && digits.length !== 20) {
      continue;
    }
    if (!out.includes(digits)) out.push(digits);
  }
  return out;
}

function extractRecipient(block: string): {
  name?: string;
  zip?: string;
  city?: string;
} {
  const empf = block.match(
    /Empfänger:\s*([^\n]+?)(?:\n|Absender-Ref|Empfänger-Ref|Frachtzahler|Zustellservice|Collonummer|LAK\d+)/i,
  );
  let name = empf?.[1]?.trim();
  // Mehrzeilig: nächste Zeilen bis PLZ
  const empfBlock = block.match(
    /Empfänger:\s*([\s\S]*?)(?:Absender-Ref\.|Empfänger-Ref\.|Frachtzahler-Ref\.|Zustellservice:|LAK\d+)/i,
  )?.[1];
  if (empfBlock) {
    const lines = empfBlock
      .split('\n')
      .map((l) => l.replace(/\s{2,}.*/, '').trim()) // rechte Tabellenspalte abschneiden
      .filter(Boolean);
    if (lines[0]) name = lines[0];
    const loc = empfBlock.match(/\b([A-Z]{2})-(\d{4})\s+([^\n,]+)/);
    if (loc) {
      return {
        name,
        zip: loc[2],
        city: loc[3].replace(/\s{2,}.*/, '').trim(),
      };
    }
    const ch = empfBlock.match(/\bCH-(\d{4})\s+([^\n,]+)/);
    if (ch) {
      return { name, zip: ch[1], city: ch[2].replace(/\s{2,}.*/, '').trim() };
    }
  }
  return { name };
}

/** Erkennt Schmidts-Ladeliste am Inhalt. */
export function looksLikeSchmidtsLadeliste(text: string): boolean {
  return (
    /\bLAK\d{6,}\b/i.test(text) &&
    (/SCHMIDT'?S/i.test(text) || /Ladeliste\s*:/i.test(text) || /Ladeliste Neu/i.test(text))
  );
}

export function parseSchmidtsLadelisteText(text: string): ParsedSchmidtsLadeliste {
  const normalized = text.replace(/\r/g, '\n').replace(/\u00a0/g, ' ');

  const listDateRaw = normalized.match(/Ladeliste:\s*(\d{2})\.(\d{2})\.(\d{4})/i);
  const listDate = listDateRaw
    ? deDateToIso(listDateRaw[1], listDateRaw[2], listDateRaw[3])
    : undefined;

  const transportNumber =
    normalized.match(/Transport-Nr\.\s*:\s*([0-9/]+)/i)?.[1]?.trim() || undefined;

  const customerName =
    normalized.match(/SCHMIDT'?S\s+Handels[^\n,]*/i)?.[0]?.trim() ||
    "SCHMIDT'S Handelsgesellschaft mbH";

  // Fußzeile oft „Gesamt: 22 Colli … 985,37 kg“ (nicht die Zeilen-Gesamt: 1 Colli)
  const footHits = [...normalized.matchAll(/Gesamt:\s*(\d+)\s*Colli\s+([\d.,]+)\s*kg/gi)];
  const foot = footHits.length
    ? [...footHits].sort((a, b) => Number(b[1]) - Number(a[1]))[0]
    : null;
  const totalColli = foot ? Number(foot[1]) : undefined;
  const totalWeightKg = foot ? parseDeWeight(foot[2]) : undefined;

  const lakStarts = [...normalized.matchAll(/\b(LAK\d{6,})\s*\(/gi)];
  const lines: SchmidtsLadelisteLine[] = [];

  for (let i = 0; i < lakStarts.length; i++) {
    const lak = lakStarts[i][1].toUpperCase();
    if (lines.some((l) => l.lak === lak)) continue;
    const start = lakStarts[i].index ?? 0;
    const end = i + 1 < lakStarts.length ? (lakStarts[i + 1].index ?? normalized.length) : normalized.length;
    const block = normalized.slice(start, end);

    const ssccs = extractSsccs(block);
    const recipient = extractRecipient(block);
    const gesamtColli = Number(block.match(/Gesamt:\s*(\d+)\s*Colli/i)?.[1]) || ssccs.length || undefined;
    const gesamtKg =
      parseDeWeight(block.match(/Gesamt:\s*\d+\s*Colli\s+([\d.,]+)\s*kg/i)?.[1] || '') ||
      parseDeWeight(block.match(/([\d.,]+)\s*kg\s*(?:SDS|MAN|Gesamt)/i)?.[1] || '');

    const recipientRef = block.match(/Empfänger-Ref\.\s*:\s*([^\n,]+)/i)?.[1]?.trim();
    const freightPayerRef = block
      .match(/Frachtzahler-Ref\.\s*:\s*([^\n]+)/i)?.[1]
      ?.split(',')[0]
      ?.trim();

    // Gewichte je Zeile mit SSCC (grob)
    const colli: SchmidtsLadelisteCollo[] = ssccs.map((sscc) => {
      const near = block.match(
        new RegExp(
          `${sscc}\\s+\\d+\\s+([^\\n]+?)\\s+(?:xx|[\\d.x\\s]+)\\s+([\\d.,]+)\\s*kg`,
          'i',
        ),
      );
      return {
        sscc,
        packaging: near?.[1]?.trim()?.replace(/\s+/g, ' '),
        weightKg: near?.[2] ? parseDeWeight(near[2]) : undefined,
      };
    });

    lines.push({
      lak,
      recipientName: recipient.name,
      recipientZip: recipient.zip,
      recipientCity: recipient.city,
      recipientRef: recipientRef || undefined,
      freightPayerRef: freightPayerRef || undefined,
      colliCount: gesamtColli,
      totalWeightKg: gesamtKg,
      colli,
    });
  }

  return {
    listDate,
    listDateRaw: listDateRaw ? `${listDateRaw[1]}.${listDateRaw[2]}.${listDateRaw[3]}` : undefined,
    transportNumber,
    customerName,
    totalColli: totalColli || lines.reduce((s, l) => s + (l.colliCount || l.colli.length || 0), 0),
    totalWeightKg:
      totalWeightKg ||
      lines.reduce((s, l) => s + (l.totalWeightKg || 0), 0) ||
      undefined,
    lines,
    sourceTextPreview: normalized.slice(0, 400),
  };
}
