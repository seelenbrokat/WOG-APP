/**
 * PDF Verzollungsauftrag – Design analog Auftragsbestätigung / Ladeliste.
 */
import PDFDocument from 'pdfkit';
import { createWriteStream } from 'fs';
import {
  drawA4BrandHeader,
  drawA4Footer,
  formatPdfDateTime,
  WOG_PDF,
  PDF_TIMEZONE,
} from '../common/pdf-brand';

export type VerzollungsauftragPdfInput = {
  /** Externe Auftragsnummer VLB… */
  externalNumber?: string | null;
  kennzeichen: string;
  zulassungsland?: string | null;
  kennzeichenAnhaenger?: string | null;
  zulassungslandAnhaenger?: string | null;
  grenzuebergang: string;
  grenzzollstelle?: string | null;
  zeit: Date | string;
  importeur: string;
  zazKonto?: string | null;
  warenort?: string | null;
  packageCount?: number | null;
  weightKg?: number | null;
  netWeightKg?: number | null;
  notes?: string | null;
  customerName: string;
  customerNumber?: string | null;
  mandantName?: string | null;
  absenderFirma: string;
  absenderStreet: string;
  absenderZip: string;
  absenderCity: string;
  absenderCountry: string;
  empfaengerFirma: string;
  empfaengerStreet: string;
  empfaengerZip: string;
  empfaengerCity: string;
  empfaengerCountry: string;
  abweichenderFrachtzahler?: boolean;
  frachtzahlerFirma?: string | null;
  frachtzahlerStreet?: string | null;
  frachtzahlerZip?: string | null;
  frachtzahlerCity?: string | null;
  frachtzahlerCountry?: string | null;
  documentNames?: string[];
};

export function formatGrenzeDateTime(value: Date | string): string {
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return '–';
  return d.toLocaleString('de-AT', {
    timeZone: PDF_TIMEZONE,
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function writeVerzollungsauftragPdf(
  order: VerzollungsauftragPdfInput,
  storagePath: string,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const grenzeWhen = formatGrenzeDateTime(order.zeit);
    const doc = new PDFDocument({
      margin: 48,
      size: 'A4',
      bufferPages: true,
      info: {
        Title: `Verzollungsauftrag ${order.kennzeichen}`,
        Author: 'WOG Logistics',
        Subject: `${grenzeWhen} · ${order.customerName}`,
      },
    });
    const stream = createWriteStream(storagePath);
    doc.pipe(stream);

    const left = 48;
    const right = 547;
    const contentW = right - left;
    const col2 = left + contentW / 2 + 4;
    const addrW = contentW / 2 - 8;

    const ensureSpace = (need: number) => {
      if (doc.y + need > doc.page.height - 56) {
        doc.addPage();
        drawA4BrandHeader(doc, {
          title: 'Verzollungsauftrag',
          subtitle: `${order.kennzeichen}  ·  Fortsetzung`,
        });
      }
    };

    drawA4BrandHeader(doc, {
      title: 'Verzollungsauftrag',
      subtitle: 'Kundenportal  ·  Smart Border Austria',
    });

    const metaTop = doc.y;
    const metaH = 82;
    doc.rect(left, metaTop, contentW, metaH).fill(WOG_PDF.soft);
    doc.fillColor(WOG_PDF.ink).font('Helvetica-Bold').fontSize(11);
    doc.text(`Kennzeichen ${order.kennzeichen}`, left + 12, metaTop + 10, {
      width: contentW / 2 - 16,
    });
    doc.font('Helvetica').fontSize(9).fillColor(WOG_PDF.muted);
    doc.text(`erstellt ${formatPdfDateTime()}`, left + contentW / 2, metaTop + 12, {
      width: contentW / 2 - 12,
      align: 'right',
    });

    const metaLine = (x: number, y: number, label: string, value: string, labelW = 92) => {
      doc.font('Helvetica-Bold').fillColor(WOG_PDF.muted).text(label, x, y, {
        width: labelW,
        lineBreak: false,
      });
      doc.font('Helvetica').fillColor(WOG_PDF.ink).text(value || '–', x + labelW, y, {
        width: contentW / 2 - labelW - 20,
        lineBreak: false,
      });
    };

    let my = metaTop + 32;
    metaLine(left + 12, my, 'Kunde', order.customerName);
    metaLine(col2, my, 'Kunden-Nr.', order.customerNumber || '–', 70);
    my += 14;
    metaLine(left + 12, my, 'Zeit Grenze', grenzeWhen);
    metaLine(col2, my, 'Mandant', order.mandantName || '–', 70);
    my += 14;
    metaLine(left + 12, my, 'Grenzübergang', order.grenzuebergang);
    doc.x = left;
    doc.y = metaTop + metaH + 12;

    // Smart Border Block
    ensureSpace(90);
    const sbY = doc.y;
    doc.rect(left, sbY, contentW, 20).fill(WOG_PDF.greenDeep);
    doc
      .fillColor(WOG_PDF.white)
      .font('Helvetica-Bold')
      .fontSize(10)
      .text('Smart Border Austria', left + 8, sbY + 5, { width: contentW - 16 });
    doc.y = sbY + 28;
    doc.x = left;
    doc.fillColor(WOG_PDF.ink).font('Helvetica').fontSize(9);

    const row = (label: string, value: string) => {
      doc.font('Helvetica-Bold').fillColor(WOG_PDF.muted).text(label, left, doc.y, {
        width: 130,
        lineBreak: false,
      });
      doc.font('Helvetica').fillColor(WOG_PDF.ink).text(value || '–', left + 130, doc.y, {
        width: contentW - 130,
      });
      doc.moveDown(0.15);
    };

    row('Auftragsnummer', order.externalNumber || '–');
    row(
      'Kennzeichen',
      `${order.kennzeichen}${order.zulassungsland ? ` (${order.zulassungsland})` : ''}`,
    );
    row(
      'Kennzeichen Anhänger',
      order.kennzeichenAnhaenger
        ? `${order.kennzeichenAnhaenger}${
            order.zulassungslandAnhaenger ? ` (${order.zulassungslandAnhaenger})` : ''
          }`
        : '–',
    );
    row('Zeitpunkt an der Grenze', grenzeWhen);
    row('Grenzübergang', order.grenzuebergang);
    row('Importeur', order.importeur);
    row('ZAZ-Konto', order.zazKonto || '–');
    row('Warenort/Verzollungsort', order.warenort || '–');
    row(
      'Collianzahl',
      order.packageCount != null ? String(order.packageCount) : '–',
    );
    row(
      'Bruttogewicht',
      order.weightKg != null ? `${order.weightKg} kg` : '–',
    );
    row(
      'Nettogewicht',
      order.netWeightKg != null ? `${order.netWeightKg} kg` : '–',
    );
    doc.moveDown(0.4);

    // Absender / Empfänger
    ensureSpace(110);
    const headY = doc.y;
    doc.rect(left, headY, contentW, 18).fill(WOG_PDF.green);
    doc
      .fillColor(WOG_PDF.white)
      .font('Helvetica-Bold')
      .fontSize(10)
      .text('Absender  ·  Empfänger', left + 8, headY + 4, { width: contentW - 16 });
    doc.y = headY + 26;

    const addrY = doc.y;
    doc.font('Helvetica-Bold').fillColor(WOG_PDF.greenDeep).text('Absender', left, addrY);
    doc.font('Helvetica').fillColor(WOG_PDF.ink);
    doc.text(order.absenderFirma || '–', left, doc.y, { width: addrW });
    doc.text(order.absenderStreet || '', { width: addrW });
    doc.text(
      `${order.absenderZip || ''} ${order.absenderCity || ''}  ${order.absenderCountry || ''}`.trim(),
      { width: addrW },
    );
    const leftBottom = doc.y;

    doc.y = addrY;
    doc.font('Helvetica-Bold').fillColor(WOG_PDF.greenDeep).text('Empfänger', col2, addrY);
    doc.font('Helvetica').fillColor(WOG_PDF.ink);
    doc.text(order.empfaengerFirma || '–', col2, doc.y, { width: addrW });
    doc.text(order.empfaengerStreet || '', col2, doc.y, { width: addrW });
    doc.text(
      `${order.empfaengerZip || ''} ${order.empfaengerCity || ''}  ${order.empfaengerCountry || ''}`.trim(),
      col2,
      doc.y,
      { width: addrW },
    );
    doc.y = Math.max(leftBottom, doc.y) + 10;
    doc.x = left;

    if (order.abweichenderFrachtzahler && order.frachtzahlerFirma) {
      ensureSpace(50);
      doc.font('Helvetica-Bold').fillColor(WOG_PDF.greenDeep).text('Frachtzahler');
      doc.font('Helvetica').fillColor(WOG_PDF.ink);
      doc.text(
        [
          order.frachtzahlerFirma,
          order.frachtzahlerStreet,
          `${order.frachtzahlerZip || ''} ${order.frachtzahlerCity || ''}`.trim(),
          order.frachtzahlerCountry,
        ]
          .filter(Boolean)
          .join(', '),
        { width: contentW },
      );
      doc.moveDown(0.4);
    }

    if (order.notes) {
      ensureSpace(40);
      doc.font('Helvetica-Bold').fillColor(WOG_PDF.greenDeep).text('Hinweis');
      doc.font('Helvetica').fillColor(WOG_PDF.ink).text(order.notes, { width: contentW });
      doc.moveDown(0.4);
    }

    if (order.documentNames?.length) {
      ensureSpace(30 + order.documentNames.length * 12);
      doc.font('Helvetica-Bold').fillColor(WOG_PDF.greenDeep).text('Rechnung / Begleitdokumente');
      doc.font('Helvetica').fillColor(WOG_PDF.ink);
      for (const name of order.documentNames) {
        doc.text(`• ${name}`, { width: contentW });
      }
      doc.moveDown(0.5);
    }

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
