import PDFDocument from 'pdfkit';
import { drawA4BrandHeader, formatPdfDateTime, WOG_PDF } from '../common/pdf-brand';

export type LuExportCell = {
  given: number;
  taken: number;
  balance: number;
  owedQuantity: number;
  postings: number;
};

export type LuPartnerBlock = {
  partnerName: string;
  partnerNumber: string | null;
  partnerCity: string | null;
  types: Array<{ matchcode: string; label: string | null } & LuExportCell>;
  totals: LuExportCell;
};

export type LuExportReport = {
  generatedAt: Date;
  partners: LuPartnerBlock[];
  matchcodes: string[];
  grandTotals: LuExportCell;
};

function emptyCell(): LuExportCell {
  return { given: 0, taken: 0, balance: 0, owedQuantity: 0, postings: 0 };
}

function addCell(a: LuExportCell, b: LuExportCell): LuExportCell {
  return {
    given: a.given + b.given,
    taken: a.taken + b.taken,
    balance: a.balance + b.balance,
    owedQuantity: a.owedQuantity + b.owedQuantity,
    postings: a.postings + b.postings,
  };
}

export function buildLuExportReport(
  balances: Array<{
    partnerNumber: string | null;
    partnerName: string;
    partnerCity: string | null;
    packagingMatchcode: string;
    packagingLabel: string | null;
    given: number;
    taken: number;
    balance: number;
    owedQuantity: number;
    postings: number;
  }>,
): LuExportReport {
  const byPartner = new Map<string, LuPartnerBlock>();
  const matchcodeSet = new Set<string>();

  for (const r of balances) {
    const key = `${r.partnerName}\u0000${r.partnerNumber || ''}`;
    let block = byPartner.get(key);
    if (!block) {
      block = {
        partnerName: r.partnerName,
        partnerNumber: r.partnerNumber,
        partnerCity: r.partnerCity,
        types: [],
        totals: emptyCell(),
      };
      byPartner.set(key, block);
    }
    const cell: LuExportCell = {
      given: r.given,
      taken: r.taken,
      balance: r.balance,
      owedQuantity: r.owedQuantity,
      postings: r.postings,
    };
    block.types.push({
      matchcode: r.packagingMatchcode,
      label: r.packagingLabel,
      ...cell,
    });
    block.totals = addCell(block.totals, cell);
    matchcodeSet.add(r.packagingMatchcode);
  }

  const partners = [...byPartner.values()].sort((a, b) =>
    a.partnerName.localeCompare(b.partnerName, 'de'),
  );
  for (const p of partners) {
    p.types.sort((a, b) => a.matchcode.localeCompare(b.matchcode, 'de'));
  }

  const matchcodes = [...matchcodeSet].sort((a, b) => a.localeCompare(b, 'de'));
  const grandTotals = partners.reduce((acc, p) => addCell(acc, p.totals), emptyCell());

  return { generatedAt: new Date(), partners, matchcodes, grandTotals };
}

function csvEscape(v: string | number | null | undefined) {
  const s = v == null ? '' : String(v);
  if (/[;"\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

function csvRow(cols: Array<string | number | null | undefined>) {
  return cols.map(csvEscape).join(';');
}

/** Excel-tauglich: UTF-8 BOM + Semikolon */
export function luReportToOverviewCsv(report: LuExportReport): string {
  const lines: string[] = [];
  lines.push(
    csvRow([
      'WOG Lademittelverwaltung – Übersicht Partner-Totale',
      formatPdfDateTime(report.generatedAt),
    ]),
  );
  lines.push('');
  lines.push(
    csvRow([
      'Partner',
      'Nr.',
      'Ort',
      'Lademittel',
      'Bezeichnung',
      'Übergabe (Given)',
      'Übernahme (Taken)',
      'Saldo',
      'Offen',
      'Buchungen',
    ]),
  );
  for (const p of report.partners) {
    for (const t of p.types) {
      lines.push(
        csvRow([
          p.partnerName,
          p.partnerNumber,
          p.partnerCity,
          t.matchcode,
          t.label,
          t.given,
          t.taken,
          t.balance,
          t.owedQuantity,
          t.postings,
        ]),
      );
    }
    lines.push(
      csvRow([
        p.partnerName,
        p.partnerNumber,
        p.partnerCity,
        'TOTAL',
        '',
        p.totals.given,
        p.totals.taken,
        p.totals.balance,
        p.totals.owedQuantity,
        p.totals.postings,
      ]),
    );
  }
  lines.push('');
  lines.push(
    csvRow([
      'SUMME',
      '',
      '',
      '',
      '',
      report.grandTotals.given,
      report.grandTotals.taken,
      report.grandTotals.balance,
      report.grandTotals.owedQuantity,
      report.grandTotals.postings,
    ]),
  );
  return `\uFEFF${lines.join('\r\n')}\r\n`;
}

/** Matrix: Partner × Lademittel (Offen / Saldo) */
export function luReportToMatrixCsv(report: LuExportReport): string {
  const lines: string[] = [];
  lines.push(
    csvRow([
      'WOG Lademittelverwaltung – Übersicht Matrix (Offen je Typ)',
      formatPdfDateTime(report.generatedAt),
    ]),
  );
  lines.push('');
  const header = ['Partner', 'Nr.', 'Ort', ...report.matchcodes.map((m) => `${m} Offen`), 'Summe Offen'];
  lines.push(csvRow(header));
  for (const p of report.partners) {
    const byMc = new Map(p.types.map((t) => [t.matchcode, t]));
    lines.push(
      csvRow([
        p.partnerName,
        p.partnerNumber,
        p.partnerCity,
        ...report.matchcodes.map((m) => byMc.get(m)?.owedQuantity ?? 0),
        p.totals.owedQuantity,
      ]),
    );
  }
  lines.push(
    csvRow([
      'SUMME',
      '',
      '',
      ...report.matchcodes.map((m) =>
        report.partners.reduce(
          (s, p) => s + (p.types.find((t) => t.matchcode === m)?.owedQuantity ?? 0),
          0,
        ),
      ),
      report.grandTotals.owedQuantity,
    ]),
  );
  return `\uFEFF${lines.join('\r\n')}\r\n`;
}

export function luReportToPartnerCsv(report: LuExportReport, partnerName: string): string {
  const block = report.partners.find(
    (p) => p.partnerName.toLowerCase() === partnerName.trim().toLowerCase(),
  );
  const lines: string[] = [];
  lines.push(
    csvRow([
      `WOG Lademittelverwaltung – Partner ${partnerName}`,
      formatPdfDateTime(report.generatedAt),
    ]),
  );
  if (block) {
    lines.push(csvRow(['Nr.', block.partnerNumber]));
    lines.push(csvRow(['Ort', block.partnerCity]));
  }
  lines.push('');
  lines.push(
    csvRow([
      'Lademittel',
      'Bezeichnung',
      'Übergabe (Given)',
      'Übernahme (Taken)',
      'Saldo',
      'Offen',
      'Buchungen',
    ]),
  );
  if (!block) {
    lines.push(csvRow(['Keine Daten für diesen Partner']));
    return `\uFEFF${lines.join('\r\n')}\r\n`;
  }
  for (const t of block.types) {
    lines.push(
      csvRow([
        t.matchcode,
        t.label,
        t.given,
        t.taken,
        t.balance,
        t.owedQuantity,
        t.postings,
      ]),
    );
  }
  lines.push(
    csvRow([
      'TOTAL',
      '',
      block.totals.given,
      block.totals.taken,
      block.totals.balance,
      block.totals.owedQuantity,
      block.totals.postings,
    ]),
  );
  return `\uFEFF${lines.join('\r\n')}\r\n`;
}

function writeTableHeader(doc: PDFKit.PDFDocument, cols: Array<{ label: string; x: number; w: number }>, y: number) {
  doc.rect(doc.page.margins.left, y, doc.page.width - doc.page.margins.left - doc.page.margins.right, 18).fill(WOG_PDF.soft);
  doc.fillColor(WOG_PDF.greenDeep).fontSize(8).font('Helvetica-Bold');
  for (const c of cols) {
    doc.text(c.label, c.x, y + 5, { width: c.w, align: 'left' });
  }
  return y + 20;
}

export async function writeLuOverviewPdf(report: LuExportReport): Promise<Buffer> {
  const doc = new PDFDocument({
    size: 'A4',
    layout: 'landscape',
    margins: { top: 40, bottom: 40, left: 36, right: 36 },
  });
  const chunks: Buffer[] = [];
  doc.on('data', (c) => chunks.push(c));

  drawA4BrandHeader(doc, {
    title: 'Lademittelverwaltung',
    subtitle: `Übersicht Partner-Totale · ${formatPdfDateTime(report.generatedAt)}`,
  });

  let y = doc.y + 4;
  const left = doc.page.margins.left;
  const cols = [
    { label: 'Partner', x: left, w: 150 },
    { label: 'Nr.', x: left + 150, w: 55 },
    { label: 'Typ', x: left + 205, w: 50 },
    { label: 'Übergabe', x: left + 255, w: 55 },
    { label: 'Übernahme', x: left + 310, w: 60 },
    { label: 'Saldo', x: left + 370, w: 45 },
    { label: 'Offen', x: left + 415, w: 45 },
    { label: 'Buchungen', x: left + 460, w: 55 },
  ];

  const ensureSpace = (need: number) => {
    if (y + need > doc.page.height - doc.page.margins.bottom) {
      doc.addPage();
      drawA4BrandHeader(doc, {
        title: 'Lademittelverwaltung',
        subtitle: 'Übersicht Partner-Totale (Fortsetzung)',
      });
      y = doc.y + 4;
      y = writeTableHeader(doc, cols, y);
    }
  };

  y = writeTableHeader(doc, cols, y);

  for (const p of report.partners) {
    for (const t of p.types) {
      ensureSpace(16);
      doc.fillColor(WOG_PDF.ink).fontSize(8).font('Helvetica');
      doc.text(p.partnerName, cols[0].x, y, { width: cols[0].w });
      doc.text(p.partnerNumber || '—', cols[1].x, y, { width: cols[1].w });
      doc.text(t.matchcode, cols[2].x, y, { width: cols[2].w });
      doc.text(String(t.given), cols[3].x, y, { width: cols[3].w });
      doc.text(String(t.taken), cols[4].x, y, { width: cols[4].w });
      doc.text(String(t.balance), cols[5].x, y, { width: cols[5].w });
      doc.font('Helvetica-Bold').text(String(t.owedQuantity), cols[6].x, y, { width: cols[6].w });
      doc.font('Helvetica').text(String(t.postings), cols[7].x, y, { width: cols[7].w });
      y += 14;
    }
    ensureSpace(18);
    doc.fillColor(WOG_PDF.greenDeep).fontSize(8).font('Helvetica-Bold');
    doc.text(`${p.partnerName} · Total`, cols[0].x, y, { width: cols[0].w + cols[1].w + cols[2].w });
    doc.text(String(p.totals.given), cols[3].x, y, { width: cols[3].w });
    doc.text(String(p.totals.taken), cols[4].x, y, { width: cols[4].w });
    doc.text(String(p.totals.balance), cols[5].x, y, { width: cols[5].w });
    doc.text(String(p.totals.owedQuantity), cols[6].x, y, { width: cols[6].w });
    doc.text(String(p.totals.postings), cols[7].x, y, { width: cols[7].w });
    y += 18;
  }

  ensureSpace(24);
  doc.fillColor(WOG_PDF.ink).fontSize(9).font('Helvetica-Bold');
  doc.text(
    `Summe alle Partner: Übergabe ${report.grandTotals.given} · Übernahme ${report.grandTotals.taken} · Saldo ${report.grandTotals.balance} · Offen ${report.grandTotals.owedQuantity}`,
    left,
    y,
    { width: doc.page.width - left - doc.page.margins.right },
  );

  doc.end();
  await new Promise<void>((resolve, reject) => {
    doc.on('end', () => resolve());
    doc.on('error', reject);
  });
  return Buffer.concat(chunks);
}

export async function writeLuPartnerPdf(
  report: LuExportReport,
  partnerName: string,
): Promise<Buffer> {
  const block = report.partners.find(
    (p) => p.partnerName.toLowerCase() === partnerName.trim().toLowerCase(),
  );
  const doc = new PDFDocument({
    size: 'A4',
    margins: { top: 48, bottom: 48, left: 42, right: 42 },
  });
  const chunks: Buffer[] = [];
  doc.on('data', (c) => chunks.push(c));

  drawA4BrandHeader(doc, {
    title: 'Lademittel – Partner',
    subtitle: `${partnerName} · ${formatPdfDateTime(report.generatedAt)}`,
  });

  let y = doc.y + 6;
  const left = doc.page.margins.left;

  if (!block) {
    doc.fillColor(WOG_PDF.muted).fontSize(10).text('Keine Daten für diesen Partner.', left, y);
  } else {
    doc
      .fillColor(WOG_PDF.muted)
      .fontSize(9)
      .font('Helvetica')
      .text(`Nr.: ${block.partnerNumber || '—'} · Ort: ${block.partnerCity || '—'}`, left, y);
    y += 20;

    const cols = [
      { label: 'Typ', x: left, w: 70 },
      { label: 'Bezeichnung', x: left + 70, w: 140 },
      { label: 'Übergabe', x: left + 210, w: 60 },
      { label: 'Übernahme', x: left + 270, w: 70 },
      { label: 'Saldo', x: left + 340, w: 50 },
      { label: 'Offen', x: left + 390, w: 50 },
      { label: 'Buchungen', x: left + 440, w: 60 },
    ];
    y = writeTableHeader(doc, cols, y);

    for (const t of block.types) {
      doc.fillColor(WOG_PDF.ink).fontSize(9).font('Helvetica');
      doc.text(t.matchcode, cols[0].x, y, { width: cols[0].w });
      doc.text(t.label || '—', cols[1].x, y, { width: cols[1].w });
      doc.text(String(t.given), cols[2].x, y, { width: cols[2].w });
      doc.text(String(t.taken), cols[3].x, y, { width: cols[3].w });
      doc.text(String(t.balance), cols[4].x, y, { width: cols[4].w });
      doc.font('Helvetica-Bold').text(String(t.owedQuantity), cols[5].x, y, { width: cols[5].w });
      doc.font('Helvetica').text(String(t.postings), cols[6].x, y, { width: cols[6].w });
      y += 16;
    }

    y += 8;
    doc
      .fillColor(WOG_PDF.greenDeep)
      .fontSize(10)
      .font('Helvetica-Bold')
      .text(
        `Total: Übergabe ${block.totals.given} · Übernahme ${block.totals.taken} · Saldo ${block.totals.balance} · Offen ${block.totals.owedQuantity}`,
        left,
        y,
      );
  }

  doc.end();
  await new Promise<void>((resolve, reject) => {
    doc.on('end', () => resolve());
    doc.on('error', reject);
  });
  return Buffer.concat(chunks);
}
