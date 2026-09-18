import { existsSync } from 'fs';
import { join } from 'path';

/** WOG-Markenfarben (Portal) */
export const WOG_PDF = {
  green: '#1a6b3c',
  greenDeep: '#124a29',
  ink: '#15261c',
  muted: '#5e6f65',
  line: '#dce5df',
  soft: '#e9f4ee',
  white: '#ffffff',
} as const;

/** Server läuft oft in UTC – PDF-Zeiten in Mitteleuropa anzeigen. */
export const PDF_TIMEZONE = 'Europe/Vienna';

export function formatPdfDateTime(date: Date = new Date()): string {
  return date.toLocaleString('de-AT', { timeZone: PDF_TIMEZONE });
}

/** Pfad zum WOG-Logo (JPEG) für PDFKit. */
export function resolveWogLogoPath(): string | null {
  const candidates = [
    join(process.cwd(), 'assets', 'wog-logo.jpg'),
    join(process.cwd(), 'apps', 'api', 'assets', 'wog-logo.jpg'),
    join(__dirname, '..', '..', 'assets', 'wog-logo.jpg'),
    join(__dirname, '..', '..', '..', 'apps', 'api', 'assets', 'wog-logo.jpg'),
    join(process.cwd(), '..', 'web', 'public', 'wog-logo.jpg'),
    join(process.cwd(), '..', '..', 'apps', 'web', 'public', 'wog-logo.jpg'),
  ];
  for (const p of candidates) {
    if (existsSync(p)) return p;
  }
  return null;
}

type PdfDoc = PDFKit.PDFDocument;

/** Logo + Titelzeile für A4-Dokumente (Ladeliste). */
export function drawA4BrandHeader(
  doc: PdfDoc,
  opts: { title: string; subtitle?: string },
): void {
  const logoPath = resolveWogLogoPath();
  const left = doc.page.margins.left;
  const right = doc.page.width - doc.page.margins.right;
  const top = doc.page.margins.top;
  const logoH = 42;
  const logoW = logoPath ? 72 : 0;

  if (logoPath) {
    doc.image(logoPath, left, top, { fit: [90, logoH] });
  }

  const textX = left + (logoPath ? logoW + 14 : 0);
  const textW = right - textX;
  doc
    .fillColor(WOG_PDF.greenDeep)
    .fontSize(16)
    .font('Helvetica-Bold')
    .text(opts.title, textX, top + 4, { width: textW, align: 'right' });
  if (opts.subtitle) {
    doc
      .fillColor(WOG_PDF.muted)
      .fontSize(9)
      .font('Helvetica')
      .text(opts.subtitle, textX, top + 26, { width: textW, align: 'right' });
  }

  const ruleY = top + logoH + 10;
  doc
    .moveTo(left, ruleY)
    .lineTo(right, ruleY)
    .lineWidth(2)
    .strokeColor(WOG_PDF.green)
    .stroke();
  doc
    .moveTo(left, ruleY + 3)
    .lineTo(right, ruleY + 3)
    .lineWidth(0.5)
    .strokeColor(WOG_PDF.line)
    .stroke();

  doc.y = ruleY + 14;
  doc.x = left;
  doc.fillColor(WOG_PDF.ink).font('Helvetica').fontSize(10);
}

/** Kompakte Logozeile für Transportetiketten (100×150 mm). */
export function drawLabelBrandHeader(doc: PdfDoc, mandantName?: string | null): void {
  const logoPath = resolveWogLogoPath();
  const left = 18;
  const top = 14;
  const pageW = doc.page.width;
  const right = pageW - 18;

  if (logoPath) {
    doc.image(logoPath, left, top, { fit: [56, 28] });
  } else {
    doc
      .fillColor(WOG_PDF.greenDeep)
      .fontSize(10)
      .font('Helvetica-Bold')
      .text('WOG', left, top + 6);
  }

  doc
    .fillColor(WOG_PDF.greenDeep)
    .fontSize(9)
    .font('Helvetica-Bold')
    .text('WOG Logistics', left + 62, top + 2, { width: right - left - 62, align: 'right' });
  doc
    .fillColor(WOG_PDF.muted)
    .fontSize(7)
    .font('Helvetica')
    .text(mandantName || 'Transportetikett', left + 62, top + 14, {
      width: right - left - 62,
      align: 'right',
    });

  const ruleY = top + 32;
  doc
    .moveTo(left, ruleY)
    .lineTo(right, ruleY)
    .lineWidth(1.5)
    .strokeColor(WOG_PDF.green)
    .stroke();

  doc.y = ruleY + 8;
  doc.x = left;
  doc.fillColor(WOG_PDF.ink).font('Helvetica').fontSize(9);
}

export const PDF_DESIGNED_BY = 'designed by www.logistikberater.at (VLB e.U.)';

export function drawA4Footer(doc: PdfDoc, pageNumber: number, pageCount?: number): void {
  const left = doc.page.margins.left;
  const right = doc.page.width - doc.page.margins.right;
  const contentW = right - left;
  const savedX = doc.x;
  const savedY = doc.y;
  const savedBottom = doc.page.margins.bottom;
  // Footer in den unteren Rand schreiben, ohne Auto-Seitenumbruch
  doc.page.margins.bottom = 0;

  const creditY = doc.page.height - 16;
  const metaY = creditY - 12;
  const ruleY = metaY - 8;

  doc
    .moveTo(left, ruleY)
    .lineTo(right, ruleY)
    .lineWidth(0.5)
    .strokeColor(WOG_PDF.line)
    .stroke();
  doc
    .fontSize(7)
    .fillColor(WOG_PDF.muted)
    .font('Helvetica')
    .text('WOG – World of Green Logistics  ·  wog.logistikberater.at', left, metaY, {
      width: contentW * 0.65,
      align: 'left',
      lineBreak: false,
    });
  const pageLabel = pageCount ? `Seite ${pageNumber} / ${pageCount}` : `Seite ${pageNumber}`;
  doc.text(pageLabel, left + contentW * 0.65, metaY, {
    width: contentW * 0.35,
    align: 'right',
    lineBreak: false,
  });
  // Ganz unten in der Fußzeile
  doc
    .fontSize(6.5)
    .fillColor(WOG_PDF.muted)
    .font('Helvetica')
    .text(PDF_DESIGNED_BY, left, creditY, {
      width: contentW,
      align: 'center',
      lineBreak: false,
    });

  doc.page.margins.bottom = savedBottom;
  doc.x = savedX;
  doc.y = savedY;
}

/** Kleiner Designed-by-Hinweis unten (z. B. Etiketten). */
export function drawDesignedByCredit(doc: PdfDoc, opts?: { left?: number; width?: number }): void {
  const left = opts?.left ?? doc.page.margins.left;
  const width = opts?.width ?? doc.page.width - left - (doc.page.margins.right || 18);
  const savedX = doc.x;
  const savedY = doc.y;
  const savedBottom = doc.page.margins.bottom;
  doc.page.margins.bottom = 0;
  doc
    .fontSize(5.5)
    .fillColor(WOG_PDF.muted)
    .font('Helvetica')
    .text(PDF_DESIGNED_BY, left, doc.page.height - 12, {
      width,
      align: 'center',
      lineBreak: false,
    });
  doc.page.margins.bottom = savedBottom;
  doc.x = savedX;
  doc.y = savedY;
}

export type PdfLoadingUnitExchangeNote = {
  status: 'EXCHANGED' | 'NOT_EXCHANGED' | 'MIXED' | 'UNKNOWN';
  headline: string;
  detail: string;
  lines: Array<{
    matchcode: string;
    label?: string | null;
    given: number;
    taken: number;
    owedQuantity?: number;
  }>;
};

/**
 * Lademitteltausch auf Ablieferbeleg / Zustellnachweis – tabellarisch:
 * Lademittel | Gegeben | Erhalten (+ Statuszeile).
 */
export function drawLoadingUnitExchangeBox(
  doc: PdfDoc,
  note: PdfLoadingUnitExchangeNote | null | undefined,
): void {
  if (!note || note.status === 'UNKNOWN') return;

  const left = doc.page.margins.left;
  const right = doc.page.width - doc.page.margins.right;
  const contentW = right - left;
  const emphasize = note.status === 'NOT_EXCHANGED' || note.status === 'MIXED';
  const ok = note.status === 'EXCHANGED';
  const pad = 10;
  const rowH = 18;
  const headH = 28;
  const tableRows = Math.max(1, note.lines.length);
  const footerH = note.detail ? 18 : 10;
  const boxH = headH + 16 + rowH * (tableRows + 1) + footerH;
  const y0 = doc.y;

  const colLademittel = contentW * 0.5;
  const colGegeben = contentW * 0.25;
  const colErhalten = contentW * 0.25;

  doc
    .roundedRect(left, y0, contentW, boxH, 4)
    .lineWidth(emphasize ? 1.6 : 1)
    .strokeColor(emphasize ? '#9a4d0f' : ok ? WOG_PDF.green : WOG_PDF.line)
    .fillColor(emphasize ? '#fff7ed' : WOG_PDF.soft)
    .fillAndStroke();

  doc
    .fillColor(emphasize ? '#9a4d0f' : ok ? WOG_PDF.green : WOG_PDF.ink)
    .font('Helvetica-Bold')
    .fontSize(12)
    .text(note.headline || 'Lademitteltausch', left + pad, y0 + 8, {
      width: contentW - pad * 2,
    });

  const tableTop = y0 + headH;
  // Header row
  doc
    .rect(left + 1, tableTop, contentW - 2, rowH)
    .fillColor(emphasize ? '#ffedd5' : '#e8f0ea')
    .fill();
  doc
    .fillColor(WOG_PDF.muted)
    .font('Helvetica-Bold')
    .fontSize(8)
    .text('Lademittel', left + pad, tableTop + 5, { width: colLademittel - pad })
    .text('Gegeben', left + colLademittel, tableTop + 5, {
      width: colGegeben - 6,
      align: 'right',
    })
    .text('Erhalten', left + colLademittel + colGegeben, tableTop + 5, {
      width: colErhalten - pad,
      align: 'right',
    });

  let rowY = tableTop + rowH;
  const lines =
    note.lines.length > 0
      ? note.lines
      : [{ matchcode: '—', label: null, given: 0, taken: 0 }];
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    if (i % 2 === 1) {
      doc
        .rect(left + 1, rowY, contentW - 2, rowH)
        .fillColor('#ffffff')
        .fill();
    }
    const label = [l.matchcode, l.label].filter(Boolean).join(' · ');
    doc
      .fillColor(WOG_PDF.ink)
      .font('Helvetica')
      .fontSize(10)
      .text(label, left + pad, rowY + 4, { width: colLademittel - pad })
      .font('Helvetica-Bold')
      .text(String(l.given ?? 0), left + colLademittel, rowY + 4, {
        width: colGegeben - 6,
        align: 'right',
      })
      .text(String(l.taken ?? 0), left + colLademittel + colGegeben, rowY + 4, {
        width: colErhalten - pad,
        align: 'right',
      });
    rowY += rowH;
  }

  // vertical column guides
  doc
    .strokeColor(WOG_PDF.line)
    .lineWidth(0.5)
    .moveTo(left + colLademittel, tableTop)
    .lineTo(left + colLademittel, tableTop + rowH * (lines.length + 1))
    .moveTo(left + colLademittel + colGegeben, tableTop)
    .lineTo(left + colLademittel + colGegeben, tableTop + rowH * (lines.length + 1))
    .stroke();

  if (note.detail) {
    doc
      .fillColor(emphasize ? '#9a4d0f' : WOG_PDF.muted)
      .font('Helvetica')
      .fontSize(8)
      .text(note.detail, left + pad, rowY + 4, { width: contentW - pad * 2 });
  }

  doc.y = y0 + boxH + 12;
  doc.x = left;
}
