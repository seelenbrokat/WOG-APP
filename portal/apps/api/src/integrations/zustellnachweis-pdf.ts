import { createWriteStream, existsSync } from 'fs';
import PDFDocument from 'pdfkit';
import {
  WOG_PDF,
  PDF_TIMEZONE,
  drawA4BrandHeader,
  formatPdfDateTime,
  resolveWogLogoPath,
} from '../common/pdf-brand';

export type ZustellnachweisInput = {
  tourNumber?: string | null;
  transportOrderNumber?: string | null;
  externalConsignmentNumber?: string | null;
  position?: string | number | null;
  receiverName?: string | null;
  receiverAddress?: string | null;
  senderName?: string | null;
  senderAddress?: string | null;
  identCodes?: string[];
  deliveryStatus?: string | null;
  deliveryAt?: Date | null;
  signaturePath?: string | null;
  signatureFileName?: string | null;
  events: Array<{
    at: Date | null;
    label: string;
  }>;
  companyLine?: string;
};

const FOOTER_LEFT = 'WOG Logistics AG · Wildenaustraße 22 · 9444 Diepoldsau';

export function isSignatureDocumentName(fileName: string): boolean {
  const n = fileName.toUpperCase();
  return (
    n.includes('UNTERSCHRI') ||
    n.includes('SIGNATURE') ||
    n.includes('UNTERSCHRIFT') ||
    n.includes('POD') ||
    n.includes('EMPFANG')
  );
}

export function mapTelematicsStatusLabel(status?: string | null, statusText?: string | null): string {
  const map: Record<string, string> = {
    LoadingStart: 'Beladung gestartet',
    LoadingFinished: 'Beladung abgeschlossen',
    LoadingPlaceLeft: 'Beladestelle verlassen',
    UnloadingStart: 'Entladung gestartet',
    UnloadingFinished: 'Entladung abgeschlossen – Zugestellt',
    UnloadingPlaceLeft: 'Entladestelle verlassen',
    DocumentReceived: 'Empfangsunterschrift erfasst',
    Started: 'Tour gestartet',
    Finished: 'Tour abgeschlossen',
  };
  if (status && map[status]) {
    if (status === 'DocumentReceived' && statusText) {
      return `${map[status]} · ${statusText}`;
    }
    if (statusText && statusText !== status) {
      return `${map[status]} · ${statusText}`;
    }
    return map[status];
  }
  return statusText || status || 'Ereignis';
}

export function deliveryStatusFromEvents(
  statuses: Array<string | null | undefined>,
): { status: string; delivered: boolean } {
  const set = new Set(statuses.filter(Boolean) as string[]);
  if (
    set.has('UnloadingFinished') ||
    set.has('UnloadingPlaceLeft') ||
    set.has('DocumentReceived')
  ) {
    return { status: 'Zugestellt', delivered: true };
  }
  if (set.has('UnloadingStart')) return { status: 'In Zustellung', delivered: false };
  if (set.has('LoadingPlaceLeft') || set.has('LoadingFinished')) {
    return { status: 'Unterwegs', delivered: false };
  }
  if (set.has('LoadingStart')) return { status: 'In Beladung', delivered: false };
  return { status: 'Offen', delivered: false };
}

function fmtDt(date?: Date | null): string {
  if (!date) return '—';
  return date.toLocaleString('de-AT', {
    timeZone: PDF_TIMEZONE,
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function fmtDtFull(date?: Date | null): string {
  if (!date) return '—';
  return date.toLocaleString('de-AT', {
    timeZone: PDF_TIMEZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).replace(',', '');
}

function sectionTitle(doc: PDFKit.PDFDocument, title: string, y?: number) {
  const left = doc.page.margins.left;
  const right = doc.page.width - doc.page.margins.right;
  if (y != null) doc.y = y;
  doc
    .fillColor(WOG_PDF.green)
    .font('Helvetica-Bold')
    .fontSize(11)
    .text(title.toUpperCase(), left, doc.y, { width: right - left });
  doc.moveDown(0.35);
  doc
    .moveTo(left, doc.y)
    .lineTo(right, doc.y)
    .lineWidth(0.7)
    .strokeColor(WOG_PDF.line)
    .stroke();
  doc.y += 8;
}

function kvRow(
  doc: PDFKit.PDFDocument,
  label: string,
  value: string,
  opts?: { labelW?: number },
) {
  const left = doc.page.margins.left;
  const right = doc.page.width - doc.page.margins.right;
  const labelW = opts?.labelW ?? 150;
  const y = doc.y;
  doc
    .fillColor(WOG_PDF.muted)
    .font('Helvetica')
    .fontSize(9)
    .text(label, left, y, { width: labelW, lineBreak: false });
  doc
    .fillColor(WOG_PDF.ink)
    .font('Helvetica-Bold')
    .fontSize(10)
    .text(value || '—', left + labelW, y, { width: right - left - labelW });
  doc.y = Math.max(doc.y, y + 16);
}

export function writeZustellnachweisPdf(
  input: ZustellnachweisInput,
  storagePath: string,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({
      margin: 48,
      size: 'A4',
      bufferPages: true,
      info: {
        Title: 'Digitaler Zustellnachweis',
        Author: 'WOG Logistics AG',
        Subject: input.transportOrderNumber || input.tourNumber || '',
      },
    });
    const stream = createWriteStream(storagePath);
    doc.pipe(stream);

    drawA4BrandHeader(doc, {
      title: 'Digitaler Zustellnachweis',
      subtitle: 'WOG Logistics AG · World of Green Logistics',
    });

    const left = doc.page.margins.left;
    const right = doc.page.width - doc.page.margins.right;
    const contentW = right - left;

    doc
      .fillColor(WOG_PDF.muted)
      .font('Helvetica')
      .fontSize(8)
      .text(`Erstellt am ${formatPdfDateTime(new Date())}`, left, doc.y, {
        width: contentW,
        align: 'right',
      });
    doc.moveDown(0.8);

    sectionTitle(doc, 'Referenzen');
    kvRow(doc, 'Tour', input.tourNumber || '—');
    kvRow(doc, 'Transportauftrag', input.transportOrderNumber || '—');
    if (input.position != null && input.position !== '') {
      kvRow(doc, 'Position', String(input.position));
    }
    kvRow(doc, 'Sendungsnummer', input.transportOrderNumber || '—');
    kvRow(doc, 'Externe Sendungsnummer', input.externalConsignmentNumber || '—');
    doc.moveDown(0.6);

    sectionTitle(doc, 'Sendung');
    kvRow(doc, 'Empfänger', input.receiverName || '—');
    kvRow(doc, 'Adresse', input.receiverAddress || '—');
    if (input.senderName) {
      kvRow(doc, 'Absender', input.senderName);
    }
    if (input.senderAddress) {
      kvRow(doc, 'Absenderadresse', input.senderAddress);
    }
    if (input.identCodes?.length) {
      kvRow(doc, 'Identcode', input.identCodes.join(', '));
    }
    doc.moveDown(0.6);

    sectionTitle(doc, 'Zustellung');
    const boxY = doc.y;
    const boxH = 52;
    doc
      .roundedRect(left, boxY, contentW, boxH, 6)
      .lineWidth(1)
      .strokeColor('#c5d0c9')
      .stroke();
    const colW = contentW / 2;
    doc
      .fillColor(WOG_PDF.muted)
      .font('Helvetica')
      .fontSize(8)
      .text('Zustellstatus', left + 14, boxY + 10, { width: colW - 20 });
    doc
      .fillColor(WOG_PDF.green)
      .font('Helvetica-Bold')
      .fontSize(14)
      .text(input.deliveryStatus || '—', left + 14, boxY + 24, { width: colW - 20 });
    doc
      .fillColor(WOG_PDF.muted)
      .font('Helvetica')
      .fontSize(8)
      .text('Zustelldatum', left + colW + 8, boxY + 10, { width: colW - 20 });
    doc
      .fillColor(WOG_PDF.ink)
      .font('Helvetica-Bold')
      .fontSize(14)
      .text(fmtDt(input.deliveryAt), left + colW + 8, boxY + 24, { width: colW - 20 });
    doc.y = boxY + boxH + 16;

    if (input.signaturePath && existsSync(input.signaturePath)) {
      sectionTitle(doc, 'Empfangsunterschrift');
      const sigBoxY = doc.y;
      const sigBoxH = 110;
      doc
        .roundedRect(left, sigBoxY, contentW, sigBoxH, 6)
        .lineWidth(1)
        .strokeColor('#c5d0c9')
        .fillColor('#f7faf8')
        .fillAndStroke();
      try {
        doc.image(input.signaturePath, left + 12, sigBoxY + 10, {
          fit: [contentW - 24, sigBoxH - 28],
          align: 'center',
          valign: 'center',
        });
      } catch {
        doc
          .fillColor(WOG_PDF.muted)
          .font('Helvetica')
          .fontSize(9)
          .text('Unterschrift konnte nicht eingebettet werden.', left + 14, sigBoxY + 40);
      }
      if (input.signatureFileName) {
        doc
          .fillColor(WOG_PDF.muted)
          .font('Helvetica')
          .fontSize(7)
          .text(input.signatureFileName, left + 12, sigBoxY + sigBoxH - 16, {
            width: contentW - 24,
            align: 'right',
          });
      }
      doc.y = sigBoxY + sigBoxH + 16;
    }

    sectionTitle(doc, 'Tracking-Verlauf');
    const headerY = doc.y;
    doc.rect(left, headerY, contentW, 20).fill(WOG_PDF.soft);
    doc
      .fillColor(WOG_PDF.greenDeep)
      .font('Helvetica-Bold')
      .fontSize(9)
      .text('Zeitpunkt', left + 8, headerY + 5, { width: 130 })
      .text('Ereignis', left + 140, headerY + 5, { width: contentW - 148 });
    doc.y = headerY + 24;

    const events = [...input.events].sort((a, b) => {
      const ta = a.at?.getTime() || 0;
      const tb = b.at?.getTime() || 0;
      return ta - tb;
    });

    if (!events.length) {
      doc
        .fillColor(WOG_PDF.muted)
        .font('Helvetica')
        .fontSize(9)
        .text('Keine Tracking-Ereignisse vorhanden.', left + 8, doc.y);
      doc.moveDown();
    } else {
      for (const ev of events) {
        if (doc.y > doc.page.height - 90) {
          doc.addPage();
          // Logo-Hinweis kompakt auf Folgeseiten
          const logo = resolveWogLogoPath();
          if (logo) doc.image(logo, left, doc.page.margins.top, { fit: [60, 28] });
          doc.y = doc.page.margins.top + 36;
          sectionTitle(doc, 'Tracking-Verlauf (Fortsetzung)');
        }
        const rowY = doc.y;
        doc
          .fillColor(WOG_PDF.ink)
          .font('Helvetica')
          .fontSize(9)
          .text(fmtDtFull(ev.at), left + 8, rowY, { width: 128 });
        const eventH = doc.heightOfString(ev.label, { width: contentW - 148 });
        doc.text(ev.label, left + 140, rowY, { width: contentW - 148 });
        const bottom = Math.max(rowY + eventH, rowY + 12) + 6;
        doc
          .moveTo(left, bottom)
          .lineTo(right, bottom)
          .lineWidth(0.4)
          .strokeColor(WOG_PDF.line)
          .stroke();
        doc.y = bottom + 4;
      }
    }

    const range = doc.bufferedPageRange();
    for (let i = 0; i < range.count; i++) {
      doc.switchToPage(range.start + i);
      const savedBottom = doc.page.margins.bottom;
      doc.page.margins.bottom = 0;
      const ruleY = doc.page.height - 36;
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
        .text(input.companyLine || FOOTER_LEFT, left, ruleY + 8, {
          width: contentW * 0.65,
          lineBreak: false,
        })
        .text('Digitaler Zustellnachweis', left + contentW * 0.65, ruleY + 8, {
          width: contentW * 0.35,
          align: 'right',
          lineBreak: false,
        });
      doc.page.margins.bottom = savedBottom;
    }

    doc.end();
    stream.on('finish', () => resolve());
    stream.on('error', reject);
  });
}
