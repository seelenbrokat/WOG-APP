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

export function drawA4Footer(doc: PdfDoc, pageNumber: number, pageCount?: number): void {
  const left = doc.page.margins.left;
  const right = doc.page.width - doc.page.margins.right;
  const savedX = doc.x;
  const savedY = doc.y;
  const savedBottom = doc.page.margins.bottom;
  // Footer in den unteren Rand schreiben, ohne Auto-Seitenumbruch
  doc.page.margins.bottom = 0;
  const y = doc.page.height - 28;
  doc
    .moveTo(left, y - 8)
    .lineTo(right, y - 8)
    .lineWidth(0.5)
    .strokeColor(WOG_PDF.line)
    .stroke();
  doc
    .fontSize(7)
    .fillColor(WOG_PDF.muted)
    .font('Helvetica')
    .text('WOG – World of Green Logistics  ·  wog.logistikberater.at', left, y, {
      width: (right - left) * 0.65,
      align: 'left',
      lineBreak: false,
    });
  const pageLabel = pageCount ? `Seite ${pageNumber} / ${pageCount}` : `Seite ${pageNumber}`;
  doc.text(pageLabel, left + (right - left) * 0.65, y, {
    width: (right - left) * 0.35,
    align: 'right',
    lineBreak: false,
  });
  doc.page.margins.bottom = savedBottom;
  doc.x = savedX;
  doc.y = savedY;
}
