import { createWriteStream, existsSync, mkdirSync } from 'fs';
import { dirname } from 'path';
import PDFDocument from 'pdfkit';
import { drawA4BrandHeader, drawA4Footer, formatPdfDateTime, WOG_PDF } from '../common/pdf-brand';

/** Marker in GoodsReceiptColloCheck.note – Abmessungen während WE angepasst. */
export const ETB_DIMS_CHANGED_MARKER = '[DIMS_CHANGED]';

const COLOR_DAMAGE = '#a12622';
const COLOR_DIMS = '#0b5e3b';

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
  /** Abmessungen/Gewicht während der Kontrolle geändert */
  dimensionsChanged?: boolean;
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

function formatDims(c: EtbColloLine): string | null {
  if (c.lengthCm == null && c.widthCm == null && c.heightCm == null) return null;
  return `${c.lengthCm ?? '–'}×${c.widthCm ?? '–'}×${c.heightCm ?? '–'} cm`;
}

function cleanNote(note?: string | null): string | null {
  if (!note) return null;
  const cleaned = note
    .replace(ETB_DIMS_CHANGED_MARKER, '')
    .replace(/\s{2,}/g, ' ')
    .replace(/^[·\s]+|[·\s]+$/g, '')
    .trim();
  return cleaned || null;
}

function noteHasDimsChanged(note?: string | null): boolean {
  return !!note && note.includes(ETB_DIMS_CHANGED_MARKER);
}

function ensureSpace(doc: PDFKit.PDFDocument, need: number) {
  if (doc.y > doc.page.height - need) doc.addPage();
}

function drawSectionTitle(
  doc: PDFKit.PDFDocument,
  title: string,
  count: number,
  opts?: { color?: string; rule?: string },
) {
  ensureSpace(doc, 80);
  const color = opts?.color || WOG_PDF.greenDeep;
  const rule = opts?.rule || opts?.color || WOG_PDF.green;
  doc.moveDown(0.55);
  doc.fillColor(color).font('Helvetica-Bold').fontSize(12).text(`${title} (${count})`);
  doc
    .moveTo(doc.page.margins.left, doc.y + 2)
    .lineTo(doc.page.width - doc.page.margins.right, doc.y + 2)
    .lineWidth(1)
    .strokeColor(rule)
    .stroke();
  doc.moveDown(0.45);
  doc.font('Helvetica').fontSize(8).fillColor(WOG_PDF.ink);
}

function drawColloBlock(doc: PDFKit.PDFDocument, c: EtbColloLine, usable: number) {
  const damaged = c.status === 'DAMAGED';
  const dimsChanged = !!c.dimensionsChanged || noteHasDimsChanged(c.note);
  ensureSpace(doc, dimsChanged ? 95 : 70);
  const left = doc.page.margins.left;
  const dest = [c.deliveryZip, c.deliveryCity, c.deliveryCompany].filter(Boolean).join(' ');
  const dims = formatDims(c);
  const ink = damaged ? COLOR_DAMAGE : WOG_PDF.ink;
  const muted = damaged ? '#b54a45' : WOG_PDF.muted;

  const line1Parts = [
    c.sscc,
    statusDe(c.status),
    c.reference || c.trackingNumber,
    c.packaging,
    c.weightKg != null && !dimsChanged ? `${c.weightKg} kg` : null,
    dims && !dimsChanged ? dims : null,
  ].filter(Boolean);

  doc
    .fillColor(ink)
    .font(damaged ? 'Helvetica-Bold' : 'Helvetica')
    .fontSize(8)
    .text(line1Parts.join('  |  '), left, doc.y, { width: usable });

  if (dimsChanged && (dims || c.weightKg != null)) {
    const bits = [
      dims ? `Abmessungen geändert: ${dims}` : null,
      c.weightKg != null ? `Gewicht: ${c.weightKg} kg` : null,
    ].filter(Boolean);
    doc
      .fillColor(COLOR_DIMS)
      .font('Helvetica-Bold')
      .fontSize(9)
      .text(bits.join('  ·  '), { width: usable });
  }

  const note = cleanNote(c.note);
  const line2 = [dest, c.content, note].filter(Boolean).join(' · ');
  if (line2) doc.fillColor(muted).font('Helvetica').fontSize(8).text(line2, { width: usable });

  doc.moveDown(0.12);
  doc
    .moveTo(left, doc.y)
    .lineTo(left + usable, doc.y)
    .lineWidth(0.4)
    .strokeColor(damaged ? '#e0b4b2' : WOG_PDF.line)
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
    // Teile mit Farbe für Beschädigt
    const s = input.summary;
    doc.fillColor(WOG_PDF.ink).text(`Soll ${s.expected}  ·  OK ${s.ok}  ·  `, { continued: true });
    doc
      .fillColor(s.damaged > 0 ? COLOR_DAMAGE : WOG_PDF.ink)
      .font(s.damaged > 0 ? 'Helvetica-Bold' : 'Helvetica')
      .text(`Beschädigt ${s.damaged}`, { continued: true });
    doc
      .fillColor(WOG_PDF.ink)
      .font('Helvetica')
      .text(
        `  ·  Fehlend ${s.missing}  ·  Storniert ${s.cancelled}  ·  Überzählig ${s.surplus}`,
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
      drawSectionTitle(doc, 'Beschädigt', damaged.length, {
        color: COLOR_DAMAGE,
        rule: COLOR_DAMAGE,
      });
      for (const c of damaged) drawColloBlock(doc, c, usable);
    }
    if (missing.length) {
      drawSectionTitle(doc, 'Fehlend', missing.length, {
        color: '#8a5a00',
        rule: '#c9a227',
      });
      for (const c of missing) drawColloBlock(doc, c, usable);
    }
    if (cancelled.length) {
      drawSectionTitle(doc, 'Storniert (nicht andrucken)', cancelled.length, {
        color: WOG_PDF.muted,
        rule: WOG_PDF.line,
      });
      for (const c of cancelled) drawColloBlock(doc, c, usable);
    }

    if (input.surplus.length) {
      drawSectionTitle(doc, 'Überzählig', input.surplus.length, {
        color: COLOR_DAMAGE,
        rule: COLOR_DAMAGE,
      });
      for (const sLine of input.surplus) {
        ensureSpace(doc, sLine.photoPath && existsSync(sLine.photoPath) ? 220 : 80);
        doc.fillColor(COLOR_DAMAGE).font('Helvetica-Bold').fontSize(9).text(sLine.sscc);
        doc.font('Helvetica').fontSize(8).fillColor(WOG_PDF.muted);
        doc.text(
          `Gescannt: ${formatPdfDateTime(sLine.scannedAt)}${sLine.note ? ` · ${sLine.note}` : ''}`,
        );
        if (sLine.known) {
          doc.fillColor(WOG_PDF.ink).text(
            [
              'Im System gefunden:',
              sLine.known.trackingNumber,
              sLine.known.reference,
              sLine.known.customerName,
              [sLine.known.deliveryZip, sLine.known.deliveryCity, sLine.known.deliveryCompany]
                .filter(Boolean)
                .join(' '),
            ]
              .filter(Boolean)
              .join(' · '),
            { width: usable },
          );
        } else {
          doc.fillColor(COLOR_DAMAGE).text('SSCC nicht im System – Label-Foto erforderlich', {
            width: usable,
          });
        }
        if (sLine.photoPath && existsSync(sLine.photoPath)) {
          try {
            doc.moveDown(0.2);
            const imgH = 160;
            const y0 = doc.y;
            doc.image(sLine.photoPath, left, y0, {
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
          .strokeColor('#e0b4b2')
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
