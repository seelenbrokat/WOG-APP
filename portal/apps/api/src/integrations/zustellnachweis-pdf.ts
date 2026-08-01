import { createWriteStream, existsSync } from 'fs';
import PDFDocument from 'pdfkit';
import {
  WOG_PDF,
  PDF_TIMEZONE,
  drawA4BrandHeader,
  drawLoadingUnitExchangeBox,
  formatPdfDateTime,
  resolveWogLogoPath,
  type PdfLoadingUnitExchangeNote,
} from '../common/pdf-brand';

export type ZustellnachweisInput = {
  tourNumber?: string | null;
  transportOrderNumber?: string | null;
  /** Soloplan Sendungsnummer = OrderNumber.ConsignmentIndex (z. B. 432984.1) */
  sendungsnummer?: string | null;
  externalConsignmentNumber?: string | null;
  position?: string | number | null;
  /** Empfängerfirma (Zustelladresse) */
  receiverName?: string | null;
  receiverAddress?: string | null;
  senderName?: string | null;
  senderAddress?: string | null;
  /** Auftraggeber – oben rechts im Header */
  auftraggeber?: string | null;
  /** Person, die die Ware übernommen hat (Unterschrift) */
  uebernehmerName?: string | null;
  identCodes?: string[];
  deliveryStatus?: string | null;
  deliveryAt?: Date | null;
  /** GPS wo „Zugestellt“ gesetzt wurde */
  deliveryLatitude?: number | null;
  deliveryLongitude?: number | null;
  signaturePath?: string | null;
  signatureFileName?: string | null;
  /**
   * Weitere Fotos zur Zustellung (Entladefotos etc.) – auf denselben Beleg,
   * nicht als separate digitale Nachweise.
   */
  photos?: Array<{
    path: string;
    fileName?: string | null;
    label?: string | null;
  }>;
  loadingUnitExchange?: PdfLoadingUnitExchangeNote | null;
  /** Wenn kein Tausch: Text „Kein Lademitteltausch erforderlich“ */
  noLoadingUnitExchangeRequired?: boolean;
  events: Array<{
    at: Date | null;
    label: string;
  }>;
  companyLine?: string;
  /** PDF-Titel, Standard: Digitaler Zustellnachweis */
  title?: string;
};

/** Signature_Max_Mustermann_184515_929094.png → „Max Mustermann“ */
export function signedByFromSignatureFileName(fileName?: string | null): string | undefined {
  if (!fileName) return undefined;
  const base = fileName.replace(/\.[^.]+$/, '');
  const m = /^Signature_(.+?)_\d{5,}/i.exec(base);
  if (!m) return undefined;
  const name = m[1].replace(/_/g, ' ').trim();
  if (!name || /^KeinTausch/i.test(name)) return undefined;
  return name;
}

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

function cleanStatusText(statusText?: string | null, status?: string | null): string | null {
  if (statusText == null) return null;
  const text = String(statusText).trim();
  if (!text) return null;
  if (text === '[object Object]' || text === 'undefined' || text === 'null') return null;
  if (status && text === status) return null;
  return text;
}

export function mapTelematicsStatusLabel(status?: string | null, statusText?: string | null): string {
  const map: Record<string, string> = {
    LoadingStart: 'Beladung gestartet',
    LoadingFinished: 'Beladung abgeschlossen',
    LoadingPlaceLeft: 'Beladestelle verlassen',
    UnloadingStart: 'Angekommen',
    UnloadingFinished: 'Zugestellt',
    UnloadingPlaceLeft: 'Zugestellt',
    DocumentReceived: 'Empfangsunterschrift erfasst',
    Started: 'Tour gestartet',
    Finished: 'Tour abgeschlossen',
  };
  const detail = cleanStatusText(statusText, status);
  if (status && map[status]) {
    return detail ? `${map[status]} · ${detail}` : map[status];
  }
  return detail || status || 'Ereignis';
}

type TimelineEventLike = {
  kind?: string | null;
  status?: string | null;
  statusText?: string | null;
  transportOrderNumber?: string | null;
  eventAt?: Date | null;
};

/**
 * Kompakter Tracking-Verlauf für den Zustellnachweis:
 * nur „Angekommen“ (UnloadingStart) und „Zugestellt“ (UnloadingFinished/PlaceLeft).
 * TourStatus, Beladung, Dokumente usw. werden ausgeblendet.
 */
export function buildZustellTimeline(
  events: TimelineEventLike[],
  transportOrderNumber?: string | null,
): Array<{ at: Date | null; label: string }> {
  const relevant = events.filter((e) => {
    if (e.kind && e.kind !== 'TransportOrderStatus') return false;
    if (
      transportOrderNumber &&
      e.transportOrderNumber &&
      e.transportOrderNumber !== transportOrderNumber
    ) {
      return false;
    }
    return e.status === 'UnloadingStart' || e.status === 'UnloadingFinished' || e.status === 'UnloadingPlaceLeft';
  });

  const byTime = (a: TimelineEventLike, b: TimelineEventLike) =>
    (a.eventAt?.getTime() || 0) - (b.eventAt?.getTime() || 0);

  const arrived = relevant.filter((e) => e.status === 'UnloadingStart').sort(byTime)[0];
  const delivered =
    relevant.filter((e) => e.status === 'UnloadingFinished').sort(byTime).pop() ||
    relevant.filter((e) => e.status === 'UnloadingPlaceLeft').sort(byTime).pop();

  const out: Array<{ at: Date | null; label: string }> = [];
  if (arrived) {
    out.push({ at: arrived.eventAt || null, label: mapTelematicsStatusLabel(arrived.status, arrived.statusText) });
  }
  if (delivered) {
    // doppelte gleiche Zeile vermeiden, falls nur PlaceLeft ohne Start
    const label = mapTelematicsStatusLabel(delivered.status, delivered.statusText);
    if (!arrived || delivered.eventAt?.getTime() !== arrived.eventAt?.getTime() || label !== out[0]?.label) {
      out.push({ at: delivered.eventAt || null, label });
    }
  }
  return out;
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

/**
 * Zustellstatus für Ablieferbeleg inkl. Freitext (z. B. „Beschädigt zugestellt“).
 * Ohne Detail → „Zugestellt“ / Basislabel; mit Detail → „Zugestellt · …“.
 */
export function resolveZustellStatusLabel(opts: {
  delivered: boolean;
  baseStatus: string;
  consignmentStatus?: string | null;
  consignmentStatusText?: string | null;
  events?: Array<{ status?: string | null; statusText?: string | null }>;
}): string {
  if (!opts.delivered) return opts.baseStatus;

  const fromEvents =
    [...(opts.events || [])]
      .reverse()
      .find(
        (e) =>
          !!cleanStatusText(e.statusText, e.status) &&
          ['UnloadingFinished', 'UnloadingPlaceLeft', 'DocumentReceived'].includes(
            e.status || '',
          ),
      )?.statusText || null;

  const statusText = opts.consignmentStatusText || fromEvents || null;
  const statusCode =
    opts.consignmentStatus &&
    ['UnloadingFinished', 'UnloadingPlaceLeft'].includes(opts.consignmentStatus)
      ? opts.consignmentStatus
      : 'UnloadingFinished';

  return mapTelematicsStatusLabel(statusCode, statusText);
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
        Title: input.title || 'Ablieferbeleg',
        Author: 'WOG Logistics AG',
        Subject: input.transportOrderNumber || input.tourNumber || '',
      },
    });
    const stream = createWriteStream(storagePath);
    doc.pipe(stream);

    const sendungsnummer =
      input.sendungsnummer ||
      input.externalConsignmentNumber ||
      input.transportOrderNumber ||
      '—';
    const uebernehmer =
      input.uebernehmerName?.trim() ||
      signedByFromSignatureFileName(input.signatureFileName) ||
      null;
    const auftraggeber =
      input.auftraggeber?.trim() ||
      input.senderName?.trim() ||
      null;

    drawA4BrandHeader(doc, {
      title: input.title || 'Ablieferbeleg',
      subtitle: auftraggeber
        ? `Auftraggeber: ${auftraggeber}`
        : undefined,
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
    kvRow(doc, 'Sendungsnummer', sendungsnummer);
    kvRow(doc, 'Tour', input.tourNumber || '—');
    kvRow(doc, 'Transportauftrag', input.transportOrderNumber || '—');
    if (input.position != null && input.position !== '') {
      kvRow(doc, 'Position', String(input.position));
    }
    if (
      input.externalConsignmentNumber &&
      input.externalConsignmentNumber !== sendungsnummer
    ) {
      kvRow(doc, 'Externe Sendungsnummer', input.externalConsignmentNumber);
    }
    doc.moveDown(0.6);

    sectionTitle(doc, 'Empfänger');
    kvRow(doc, 'Name', input.receiverName || '—');
    kvRow(doc, 'Adresse', input.receiverAddress || '—');
    if (uebernehmer) {
      kvRow(doc, 'Übernehmer', uebernehmer);
    }
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
    const hasCoords =
      input.deliveryLatitude != null &&
      input.deliveryLongitude != null &&
      Number.isFinite(input.deliveryLatitude) &&
      Number.isFinite(input.deliveryLongitude);
    const boxH = hasCoords ? 78 : 52;
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
    if (hasCoords) {
      const coordText = `${Number(input.deliveryLatitude).toFixed(6)} / ${Number(input.deliveryLongitude).toFixed(6)}`;
      doc
        .fillColor(WOG_PDF.muted)
        .font('Helvetica')
        .fontSize(8)
        .text('Koordinaten (Zustellstatus)', left + 14, boxY + 48, { width: contentW - 28 });
      doc
        .fillColor(WOG_PDF.ink)
        .font('Helvetica-Bold')
        .fontSize(11)
        .text(coordText, left + 14, boxY + 60, { width: contentW - 28 });
    }
    doc.y = boxY + boxH + 16;

    sectionTitle(doc, 'Lademittel');
    if (input.loadingUnitExchange && input.loadingUnitExchange.status !== 'UNKNOWN') {
      drawLoadingUnitExchangeBox(doc, input.loadingUnitExchange);
    } else {
      // Standard-Hinweis auf POD, wenn kein Tausch gemeldet / erforderlich
      const noteY = doc.y;
      doc
        .roundedRect(left, noteY, contentW, 40, 6)
        .lineWidth(1)
        .strokeColor(WOG_PDF.line)
        .fillColor(WOG_PDF.soft)
        .fillAndStroke();
      doc
        .fillColor(WOG_PDF.green)
        .font('Helvetica-Bold')
        .fontSize(11)
        .text(
          input.noLoadingUnitExchangeRequired !== false
            ? 'Kein Lademitteltausch erforderlich'
            : 'Kein Lademitteltausch gemeldet',
          left + 12,
          noteY + 13,
          { width: contentW - 24 },
        );
      doc.y = noteY + 52;
    }

    if (input.signaturePath && existsSync(input.signaturePath)) {
      sectionTitle(doc, 'Empfangsunterschrift');
      if (uebernehmer) {
        kvRow(doc, 'Übernehmer', uebernehmer);
        doc.moveDown(0.3);
      }
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

    const photos = (input.photos || []).filter((p) => p?.path && existsSync(p.path));
    if (photos.length) {
      if (doc.y > doc.page.height - 200) {
        doc.addPage();
        const logo = resolveWogLogoPath();
        if (logo) doc.image(logo, left, doc.page.margins.top, { fit: [60, 28] });
        doc.y = doc.page.margins.top + 36;
      }
      sectionTitle(doc, photos.length === 1 ? 'Foto zur Zustellung' : 'Fotos zur Zustellung');
      const gap = 10;
      const colW = (contentW - gap) / 2;
      const photoH = 150;
      let col = 0;
      let rowTop = doc.y;

      for (let i = 0; i < photos.length; i++) {
        const photo = photos[i];
        if (col === 0 && rowTop > doc.page.height - photoH - 70) {
          doc.addPage();
          const logo = resolveWogLogoPath();
          if (logo) doc.image(logo, left, doc.page.margins.top, { fit: [60, 28] });
          doc.y = doc.page.margins.top + 36;
          sectionTitle(doc, 'Fotos zur Zustellung (Fortsetzung)');
          rowTop = doc.y;
        }

        const x = left + col * (colW + gap);
        const boxY = rowTop;
        doc
          .roundedRect(x, boxY, colW, photoH, 6)
          .lineWidth(1)
          .strokeColor('#c5d0c9')
          .fillColor('#f7faf8')
          .fillAndStroke();
        try {
          doc.image(photo.path, x + 8, boxY + 8, {
            fit: [colW - 16, photoH - 28],
            align: 'center',
            valign: 'center',
          });
        } catch {
          doc
            .fillColor(WOG_PDF.muted)
            .font('Helvetica')
            .fontSize(8)
            .text('Foto nicht einbettbar', x + 10, boxY + photoH / 2 - 6, {
              width: colW - 20,
              align: 'center',
            });
        }
        const caption = (photo.label || photo.fileName || `Foto ${i + 1}`).slice(0, 48);
        doc
          .fillColor(WOG_PDF.muted)
          .font('Helvetica')
          .fontSize(7)
          .text(caption, x + 8, boxY + photoH - 16, {
            width: colW - 16,
            align: 'right',
            lineBreak: false,
          });

        col += 1;
        if (col >= 2) {
          col = 0;
          rowTop = boxY + photoH + 12;
          doc.y = rowTop;
        }
      }
      if (col !== 0) {
        doc.y = rowTop + photoH + 12;
      } else {
        doc.y = Math.max(doc.y, rowTop);
      }
      doc.moveDown(0.4);
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
