import { createWriteStream, existsSync, mkdirSync } from 'fs';
import { dirname } from 'path';
import PDFDocument from 'pdfkit';
import { drawA4BrandHeader, drawA4Footer, formatPdfDateTime, WOG_PDF } from '../common/pdf-brand';

export type EtbColloLine = {
  sscc: string;
  status: string;
  itemNumber: number;
  packaging?: string | null;
  content?: string | null;
  weightKg?: number | null;
  lengthCm?: number | null;
  widthCm?: number | null;
  heightCm?: number | null;
  reference?: string | null;
  trackingNumber?: string | null;
  deliveryCompany?: string | null;
  deliveryZip?: string | null;
  deliveryCity?: string | null;
  scannedAt?: Date | null;
  note?: string | null;
};

export type EtbSurplusLine = {
  sscc: string;
  scannedAt: Date;
  note?: string | null;
  /** Im System gefunden */
  known?: {
    trackingNumber?: string | null;
    reference?: string | null;
    customerName?: string | null;
    deliveryCompany?: string | null;
    deliveryZip?: string | null;
    deliveryCity?: string | null;
  } | null;
  /** Label-Foto bei unbekanntem SSCC */
  photoPath?: string | null;
};

export type EtbPdfInput = {
  externalRef: string;
  sessionDate: string;
  customerName?: string | null;
  customerNumber?: string | null;
  closedAt: Date;
  closedByName?: string | null;
  notes?: string | null;
  summary: {
    expected: number;
    ok: number;
    damaged: number;
    missing: number;
    cancelled: number;
    surplus: number;
  };
  colli: EtbColloLine[];
  surplus: EtbSurplusLine[];
};

function statusDe(s: string): string {
  switch (s) {
    case 'RECEIVED':
      return 'OK';
    case 'DAMAGED':
      return 'Beschädigt';
    case 'MISSING':
      return 'Fehlend';
    case 'CANCELLED':
      return 'Storniert';
    case 'PENDING':
      return 'Offen';
    default:
      return s;
  }
}

function ensureSpace(doc: PDFKit.PDFDocument, need: number) {
  if (doc.y > doc.page.height - need) doc.addPage();
}

function drawSectionTitle(doc: PDFKit.PDFDocument, title: string, count: number) {
  ensureSpace(doc, 80);
  doc.moveDown(0.55);
  doc.fillColor(WOG_PDF.greenDeep).font('Helvetica-Bold').fontSize(12).text(`${title} (${count})`);
  doc
    .moveTo(doc.page.margins.left, doc.y + 2)
    .lineTo(doc.page.width - doc.page.margins.right, doc.y + 2)
    .lineWidth(1)
    .strokeColor(WOG_PDF.green)
    .stroke();
  doc.moveDown(0.45);
  doc.font('Helvetica').fontSize(8).fillColor(WOG_PDF.ink);
}

function drawColloBlock(doc: PDFKit.PDFDocument, c: EtbColloLine, usable: number) {
  ensureSpace(doc, 70);
  const left = doc.page.margins.left;
  const dest = [c.deliveryZip, c.deliveryCity, c.deliveryCompany].filter(Boolean).join(' ');
  const dims =
    c.lengthCm != null || c.widthCm != null || c.heightCm != null
      ? `${c.lengthCm ?? '–'}×${c.widthCm ?? '–'}×${c.heightCm ?? '–'} cm`
      : null;
  const line1 = [
    c.sscc,
    statusDe(c.status),
    c.reference || c.trackingNumber,
    c.packaging,
    c.weightKg != null ? `${c.weightKg} kg` : null,
    dims,
  ]
    .filter(Boolean)
    .join('  |  ');
  doc.fillColor(WOG_PDF.ink).font('Helvetica').fontSize(8).text(line1, left, doc.y, { width: usable });
  const line2 = [dest, c.content, c.note].filter(Boolean).join(' · ');
  if (line2) doc.fillColor(WOG_PDF.muted).text(line2, { width: usable });
  doc.moveDown(0.12);
  doc
    .moveTo(left, doc.y)
    .lineTo(left + usable, doc.y)
    .lineWidth(0.4)
    .strokeColor(WOG_PDF.line)
    .stroke();
  doc.moveDown(0.22);
}

/** Entladebericht (ETB) als A4-PDF – gegliedert nach Status. */
export function writeEntladeberichtPdf(input: EtbPdfInput, storagePath: string): Promise<void> {
  mkdirSync(dirname(storagePath), { recursive: true });
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ margin: 48, size: 'A4', bufferPages: true });
    const stream = createWriteStream(storagePath);
    doc.pipe(stream);

    const subtitle = [
      input.customerName || 'Kunde',
      input.customerNumber ? `(${input.customerNumber})` : null,
      input.externalRef,
      input.sessionDate,
    ]
      .filter(Boolean)
      .join(' · ');

    drawA4BrandHeader(doc, {
      title: 'Entladebericht (ETB)',
      subtitle,
    });

    doc.moveDown(0.35);
    doc.fillColor(WOG_PDF.ink).font('Helvetica').fontSize(10);
    doc.text(`Abgeschlossen: ${formatPdfDateTime(input.closedAt)}`);
    if (input.closedByName) doc.text(`Durch: ${input.closedByName}`);
    if (input.notes) doc.text(`Notiz: ${input.notes}`);

    doc.moveDown(0.45);
    doc.font('Helvetica-Bold').fontSize(11).fillColor(WOG_PDF.ink).text('Zusammenfassung');
    doc.font('Helvetica').fontSize(10);
    doc.text(
      `Soll ${input.summary.expected}  ·  OK ${input.summary.ok}  ·  Beschädigt ${input.summary.damaged}  ·  Fehlend ${input.summary.missing}  ·  Storniert ${input.summary.cancelled}  ·  Überzählig ${input.summary.surplus}`,
    );

    const left = doc.page.margins.left;
    const usable = doc.page.width - doc.page.margins.left - doc.page.margins.right;

    const ok = input.colli.filter((c) => c.status === 'RECEIVED');
    const damaged = input.colli.filter((c) => c.status === 'DAMAGED');
    const missing = input.colli.filter((c) => c.status === 'MISSING' || c.status === 'PENDING');
    const cancelled = input.colli.filter((c) => c.status === 'CANCELLED');

    if (ok.length) {
      drawSectionTitle(doc, 'OK / Empfangen', ok.length);
      for (const c of ok) drawColloBlock(doc, c, usable);
    }
    if (damaged.length) {
      drawSectionTitle(doc, 'Beschädigt', damaged.length);
      for (const c of damaged) drawColloBlock(doc, c, usable);
    }
    if (missing.length) {
      drawSectionTitle(doc, 'Fehlend', missing.length);
      for (const c of missing) drawColloBlock(doc, c, usable);
    }
    if (cancelled.length) {
      drawSectionTitle(doc, 'Storniert (nicht andrucken)', cancelled.length);
      for (const c of cancelled) drawColloBlock(doc, c, usable);
    }

    if (input.surplus.length) {
      drawSectionTitle(doc, 'Überzählig', input.surplus.length);
      for (const s of input.surplus) {
        ensureSpace(doc, s.photoPath && existsSync(s.photoPath) ? 220 : 80);
        doc.fillColor(WOG_PDF.ink).font('Helvetica-Bold').fontSize(9).text(s.sscc);
        doc.font('Helvetica').fontSize(8).fillColor(WOG_PDF.muted);
        doc.text(`Gescannt: ${formatPdfDateTime(s.scannedAt)}${s.note ? ` · ${s.note}` : ''}`);
        if (s.known) {
          doc.fillColor(WOG_PDF.ink).text(
            [
              'Im System gefunden:',
              s.known.trackingNumber,
              s.known.reference,
              s.known.customerName,
              [s.known.deliveryZip, s.known.deliveryCity, s.known.deliveryCompany]
                .filter(Boolean)
                .join(' '),
            ]
              .filter(Boolean)
              .join(' · '),
            { width: usable },
          );
        } else {
          doc.fillColor('#a12622').text('SSCC nicht im System – Label-Foto erforderlich', {
            width: usable,
          });
        }
        if (s.photoPath && existsSync(s.photoPath)) {
          try {
            doc.moveDown(0.2);
            const imgH = 160;
            const y0 = doc.y;
            doc.image(s.photoPath, left, y0, {
              fit: [usable, imgH],
            });
            doc.y = y0 + imgH + 10;
          } catch {
            doc.fillColor(WOG_PDF.muted).text('(Foto konnte nicht eingebettet werden)');
          }
        }
        doc.moveDown(0.2);
        doc
          .moveTo(left, doc.y)
          .lineTo(left + usable, doc.y)
          .lineWidth(0.4)
          .strokeColor(WOG_PDF.line)
          .stroke();
        doc.moveDown(0.35);
      }
    }

    doc.moveDown(0.8);
    doc.fontSize(9).fillColor(WOG_PDF.muted).text('Aufbewahrung: 30 Tage im WOG Portal.');

    const range = doc.bufferedPageRange();
    for (let i = 0; i < range.count; i++) {
      doc.switchToPage(range.start + i);
      drawA4Footer(doc, i + 1, range.count);
    }

    doc.end();
    stream.on('finish', () => resolve());
    stream.on('error', reject);
  });
}
