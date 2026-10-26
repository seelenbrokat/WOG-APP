import PDFDocument from 'pdfkit';
import { PDF_TIMEZONE, WOG_PDF, resolveWogLogoPath } from '../common/pdf-brand';

/** A6 / A4 in PDF-Punkten (1 mm ≈ 2.8346 pt) */
const SIZES = {
  a6: { width: 297.64, height: 419.53, name: 'A6' }, // 105 × 148 mm
  a4: { width: 595.28, height: 841.89, name: 'A4' }, // 210 × 297 mm
} as const;

export type ArticleLabelFormat = keyof typeof SIZES;

export type ArticleLabelData = {
  name: string;
  articleNumber?: string | null;
  customerName: string;
  customerNumber?: string | null;
  date?: Date;
};

function formatDate(d: Date): string {
  return d.toLocaleDateString('de-AT', {
    timeZone: PDF_TIMEZONE,
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  });
}

function fitText(
  doc: PDFKit.PDFDocument,
  text: string,
  opts: { x: number; y: number; width: number; height: number; maxSize: number; minSize: number },
): number {
  let size = opts.maxSize;
  while (size >= opts.minSize) {
    doc.font('Helvetica-Bold').fontSize(size);
    const h = doc.heightOfString(text, { width: opts.width, align: 'center' });
    if (h <= opts.height) {
      doc.text(text, opts.x, opts.y, {
        width: opts.width,
        height: opts.height,
        align: 'center',
        ellipsis: true,
      });
      return size;
    }
    size -= 2;
  }
  doc.font('Helvetica-Bold').fontSize(opts.minSize);
  doc.text(text, opts.x, opts.y, {
    width: opts.width,
    height: opts.height,
    align: 'center',
    ellipsis: true,
  });
  return opts.minSize;
}

export function buildArticleLabelPdf(
  data: ArticleLabelData,
  format: ArticleLabelFormat = 'a6',
): Promise<Buffer> {
  const size = SIZES[format] || SIZES.a6;
  const margin = format === 'a6' ? 16 : 36;
  const date = data.date || new Date();
  const articleNo = (data.articleNumber || '').trim() || '–';
  const name = (data.name || '').trim() || '–';
  const customer = [data.customerName, data.customerNumber ? `(${data.customerNumber})` : '']
    .filter(Boolean)
    .join(' ');

  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({
      size: [size.width, size.height],
      margin: 0,
      info: {
        Title: `Lageretikett ${articleNo}`,
        Author: 'WOG Lager',
      },
    });
    const chunks: Buffer[] = [];
    doc.on('data', (c) => chunks.push(c as Buffer));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    const innerW = size.width - margin * 2;
    const left = margin;
    let y = margin;

    // Kopf
    const logo = resolveWogLogoPath();
    if (logo && format === 'a4') {
      doc.image(logo, left, y, { fit: [70, 36] });
      doc
        .fillColor(WOG_PDF.greenDeep)
        .font('Helvetica-Bold')
        .fontSize(14)
        .text('Lageretikett', left + 80, y + 8, { width: innerW - 80, align: 'right' });
      y += 48;
    } else {
      doc
        .fillColor(WOG_PDF.greenDeep)
        .font('Helvetica-Bold')
        .fontSize(format === 'a6' ? 9 : 12)
        .text('WOG · Lageretikett', left, y, { width: innerW, align: 'center' });
      y += format === 'a6' ? 18 : 28;
    }

    doc
      .moveTo(left, y)
      .lineTo(left + innerW, y)
      .lineWidth(1.5)
      .strokeColor(WOG_PDF.green)
      .stroke();
    y += format === 'a6' ? 14 : 22;

    // Artikelnummer – sehr groß
    doc
      .fillColor(WOG_PDF.muted)
      .font('Helvetica')
      .fontSize(format === 'a6' ? 8 : 11)
      .text('ARTIKEL-NR.', left, y, { width: innerW, align: 'center' });
    y += format === 'a6' ? 12 : 16;

    const noMax = format === 'a6' ? 48 : 78;
    const noBoxH = format === 'a6' ? 70 : 120;
    fitText(doc, articleNo, {
      x: left,
      y,
      width: innerW,
      height: noBoxH,
      maxSize: noMax,
      minSize: format === 'a6' ? 18 : 28,
    });
    y += noBoxH + (format === 'a6' ? 8 : 16);

    // Bezeichnung – sehr groß
    doc
      .fillColor(WOG_PDF.muted)
      .font('Helvetica')
      .fontSize(format === 'a6' ? 8 : 11)
      .text('BEZEICHNUNG', left, y, { width: innerW, align: 'center' });
    y += format === 'a6' ? 12 : 16;

    const nameMax = format === 'a6' ? 32 : 52;
    const nameBoxH = format === 'a6' ? 110 : 220;
    doc.fillColor(WOG_PDF.ink);
    fitText(doc, name, {
      x: left,
      y,
      width: innerW,
      height: nameBoxH,
      maxSize: nameMax,
      minSize: format === 'a6' ? 14 : 22,
    });

    // Fuß: Kunde + Datum
    const footerH = format === 'a6' ? 52 : 70;
    const footerY = size.height - margin - footerH;
    doc
      .moveTo(left, footerY)
      .lineTo(left + innerW, footerY)
      .lineWidth(1)
      .strokeColor(WOG_PDF.line)
      .stroke();

    doc
      .fillColor(WOG_PDF.muted)
      .font('Helvetica')
      .fontSize(format === 'a6' ? 7 : 9)
      .text('KUNDE', left, footerY + 6, { width: innerW, align: 'center' });
    doc
      .fillColor(WOG_PDF.ink)
      .font('Helvetica-Bold')
      .fontSize(format === 'a6' ? 11 : 16)
      .text(customer || '–', left, footerY + 18, {
        width: innerW,
        align: 'center',
        ellipsis: true,
      });
    doc
      .fillColor(WOG_PDF.muted)
      .font('Helvetica')
      .fontSize(format === 'a6' ? 9 : 12)
      .text(formatDate(date), left, footerY + footerH - (format === 'a6' ? 14 : 18), {
        width: innerW,
        align: 'center',
      });

    doc.end();
  });
}

export function articleLabelFileName(
  data: ArticleLabelData,
  format: ArticleLabelFormat,
): string {
  const no = (data.articleNumber || data.name || 'artikel')
    .replace(/[^a-zA-Z0-9._-]+/g, '_')
    .slice(0, 40);
  return `Lageretikett-${no}-${format.toUpperCase()}.pdf`;
}
