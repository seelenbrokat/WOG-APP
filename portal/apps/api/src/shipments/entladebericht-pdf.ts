import { createWriteStream, mkdirSync } from 'fs';
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
  reference?: string | null;
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
    received: number;
    damaged: number;
    missing: number;
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
    case 'PENDING':
      return 'Offen';
    default:
      return s;
  }
}

/** Entladebericht (ETB) als A4-PDF schreiben. */
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

    doc.moveDown(0.4);
    doc.fillColor(WOG_PDF.ink).font('Helvetica').fontSize(10);
    doc.text(`Abgeschlossen: ${formatPdfDateTime(input.closedAt)}`);
    if (input.closedByName) doc.text(`Durch: ${input.closedByName}`);
    if (input.notes) doc.text(`Notiz: ${input.notes}`);

    doc.moveDown(0.6);
    doc.font('Helvetica-Bold').fontSize(11).text('Zusammenfassung');
    doc.font('Helvetica').fontSize(10);
    doc.text(
      `Soll ${input.summary.expected}  ·  OK ${input.summary.received}  ·  Beschädigt ${input.summary.damaged}  ·  Fehlend ${input.summary.missing}  ·  Überzählig ${input.summary.surplus}`,
    );

    doc.moveDown(0.7);
    doc.font('Helvetica-Bold').fontSize(11).text('Soll-Colli');
    doc.moveDown(0.25);
    doc.font('Helvetica').fontSize(8);

    const left = doc.page.margins.left;
    const usable = doc.page.width - doc.page.margins.left - doc.page.margins.right;

    for (const c of input.colli) {
      if (doc.y > doc.page.height - 90) doc.addPage();
      const dest = [c.deliveryZip, c.deliveryCity, c.deliveryCompany].filter(Boolean).join(' ');
      const line1 = `${c.sscc}  |  ${statusDe(c.status)}  |  #${c.itemNumber}${c.packaging ? ` · ${c.packaging}` : ''}${c.weightKg != null ? ` · ${c.weightKg} kg` : ''}`;
      doc.fillColor(WOG_PDF.ink).text(line1, left, doc.y, { width: usable });
      const line2 = [c.reference, dest, c.note].filter(Boolean).join(' · ');
      if (line2) {
        doc.fillColor(WOG_PDF.muted).text(line2, { width: usable });
      }
      doc.moveDown(0.15);
      doc
        .moveTo(left, doc.y)
        .lineTo(left + usable, doc.y)
        .lineWidth(0.4)
        .strokeColor(WOG_PDF.line)
        .stroke();
      doc.moveDown(0.25);
    }

    if (input.surplus.length) {
      doc.moveDown(0.4);
      if (doc.y > doc.page.height - 100) doc.addPage();
      doc.fillColor(WOG_PDF.ink).font('Helvetica-Bold').fontSize(11).text('Überzählige SSCCs');
      doc.moveDown(0.2);
      doc.font('Helvetica').fontSize(8);
      for (const s of input.surplus) {
        if (doc.y > doc.page.height - 80) doc.addPage();
        doc.text(
          `${s.sscc}  |  ${formatPdfDateTime(s.scannedAt)}${s.note ? `  |  ${s.note}` : ''}`,
          { width: usable },
        );
      }
    }

    doc.moveDown(1);
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
