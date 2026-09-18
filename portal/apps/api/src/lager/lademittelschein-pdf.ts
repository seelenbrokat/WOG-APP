import PDFDocument from 'pdfkit';
import { createWriteStream, existsSync } from 'fs';
import { drawA4BrandHeader, WOG_PDF } from '../common/pdf-brand';

export type LademittelscheinPdfInput = {
  number: string;
  companyEntity: string;
  occurredAt: Date;
  partnerName?: string | null;
  partnerNumber?: string | null;
  vehiclePlate?: string | null;
  driverName?: string | null;
  reference?: string | null;
  locationText?: string | null;
  tourNumber?: string | null;
  eupOut: number;
  rahmenOut: number;
  deckelOut: number;
  gitterboxOut: number;
  otherOut?: string | null;
  eupIn: number;
  rahmenIn: number;
  deckelIn: number;
  gitterboxIn: number;
  otherIn?: string | null;
  noExchangeNoStock: boolean;
  noExchangeDriverRefuse: boolean;
  wogSignedByName?: string | null;
  wogSignaturePath?: string | null;
  partnerSignedByName?: string | null;
  partnerSignaturePath?: string | null;
};

function qty(n: number) {
  return n > 0 ? String(n) : '—';
}

function check(doc: PDFKit.PDFDocument, x: number, y: number, on: boolean) {
  doc.rect(x, y, 10, 10).strokeColor(WOG_PDF.ink).stroke();
  if (on) {
    doc
      .moveTo(x + 2, y + 5)
      .lineTo(x + 4, y + 8)
      .lineTo(x + 8, y + 2)
      .strokeColor(WOG_PDF.greenDeep)
      .lineWidth(1.5)
      .stroke()
      .lineWidth(1);
  }
}

export async function writeLademittelscheinPdf(
  data: LademittelscheinPdfInput,
  outPath: string,
): Promise<void> {
  const doc = new PDFDocument({
    size: 'A4',
    margins: { top: 48, bottom: 48, left: 42, right: 42 },
  });
  const stream = createWriteStream(outPath);
  doc.pipe(stream);

  drawA4BrandHeader(doc, {
    title: 'Lademittel-Schein',
    subtitle: data.number,
  });

  let y = 110;
  const left = doc.page.margins.left;
  const right = doc.page.width - doc.page.margins.right;

  // Mandant-Checkboxen
  check(doc, left, y, data.companyEntity === 'GMBH');
  doc
    .fillColor(WOG_PDF.ink)
    .fontSize(9)
    .font('Helvetica')
    .text('WOG Logistics GmbH, A-6845 Hohenems', left + 16, y);
  y += 16;
  check(doc, left, y, data.companyEntity !== 'GMBH');
  doc.text('WOG Logistics AG, CH-9444 Diepoldsau', left + 16, y);
  y += 22;

  const dateStr = data.occurredAt.toLocaleDateString('de-AT', {
    timeZone: 'Europe/Vienna',
  });
  const meta: Array<[string, string]> = [
    ['Ort/Datum', data.locationText ? `${data.locationText}, ${dateStr}` : dateStr],
    ['Firma', data.partnerName || '—'],
    ['Lfd. Nr.', data.number],
    ['LKW Nr.', data.vehiclePlate || '—'],
    ['Referenz', data.reference || data.tourNumber || '—'],
    ['Fahrer', data.driverName || '—'],
  ];
  for (const [label, value] of meta) {
    doc
      .fillColor(WOG_PDF.muted)
      .fontSize(8)
      .font('Helvetica')
      .text(label, left, y, { width: 70 });
    doc
      .fillColor(WOG_PDF.ink)
      .fontSize(10)
      .font('Helvetica-Bold')
      .text(value, left + 72, y - 1, { width: right - left - 72 });
    y += 16;
  }

  y += 8;
  doc
    .fillColor(WOG_PDF.muted)
    .fontSize(8)
    .font('Helvetica')
    .text('Es wurde nicht getauscht, weil:', left, y);
  y += 14;
  check(doc, left, y, data.noExchangeNoStock);
  doc
    .fillColor(WOG_PDF.ink)
    .fontSize(9)
    .font('Helvetica')
    .text('Keine Lademittel zum Tausch vorhanden waren', left + 16, y);
  y += 16;
  check(doc, left, y, data.noExchangeDriverRefuse);
  doc.text('Fahrer wollte nicht tauschen', left + 16, y);
  y += 24;

  // Tabelle
  const colW = (right - left) / 3;
  const rowH = 22;
  const rows: Array<[string, number, number]> = [
    ['Euro-Paletten', data.eupOut, data.eupIn],
    ['Rahmen', data.rahmenOut, data.rahmenIn],
    ['Deckel', data.deckelOut, data.deckelIn],
    ['Gitterboxen', data.gitterboxOut, data.gitterboxIn],
  ];

  doc.rect(left, y, right - left, rowH).fill(WOG_PDF.soft);
  doc
    .fillColor(WOG_PDF.greenDeep)
    .fontSize(8)
    .font('Helvetica-Bold')
    .text('Lademittel', left + 6, y + 7, { width: colW - 8 })
    .text('WOG übergibt Ihnen', left + colW + 6, y + 7, { width: colW - 8 })
    .text('WOG übernimmt von Ihnen', left + colW * 2 + 6, y + 7, { width: colW - 8 });
  y += rowH;

  for (const [label, out, inn] of rows) {
    doc.rect(left, y, right - left, rowH).strokeColor(WOG_PDF.line).stroke();
    doc
      .fillColor(WOG_PDF.ink)
      .fontSize(10)
      .font('Helvetica')
      .text(label, left + 6, y + 6, { width: colW - 8 })
      .font('Helvetica-Bold')
      .text(qty(out), left + colW + 6, y + 6, { width: colW - 8 })
      .text(qty(inn), left + colW * 2 + 6, y + 6, { width: colW - 8 });
    y += rowH;
  }

  if (data.otherOut || data.otherIn) {
    doc.rect(left, y, right - left, rowH + 8).strokeColor(WOG_PDF.line).stroke();
    doc
      .fillColor(WOG_PDF.ink)
      .fontSize(9)
      .font('Helvetica')
      .text('Sonstige', left + 6, y + 6, { width: colW - 8 })
      .text(data.otherOut || '—', left + colW + 6, y + 6, { width: colW - 8 })
      .text(data.otherIn || '—', left + colW * 2 + 6, y + 6, { width: colW - 8 });
    y += rowH + 14;
  } else {
    y += 12;
  }

  // Preise
  doc
    .fillColor(WOG_PDF.muted)
    .fontSize(8)
    .font('Helvetica-Bold')
    .text('Lademittelpreis (bei Verlust)', left, y);
  y += 12;
  doc
    .fillColor(WOG_PDF.ink)
    .fontSize(8)
    .font('Helvetica')
    .text('EUP EUR 12,00  ·  Rahmen EUR 37,00  ·  Deckel EUR 5,00  ·  Gitterbox EUR 130,00', left, y, {
      width: right - left,
    });
  y += 14;
  doc
    .fillColor(WOG_PDF.muted)
    .fontSize(7)
    .text(
      'Sollte eine frachtfreie Rückführung nicht innerhalb von 14 Tagen erfolgt sein, werden Lademittel mit den obigen Preisen verrechnet.',
      left,
      y,
      { width: right - left },
    );
  y += 28;

  doc
    .fillColor(WOG_PDF.greenDeep)
    .fontSize(10)
    .font('Helvetica-Bold')
    .text('In Ordnung übernommen', left, y);
  y += 18;

  const sigW = (right - left - 20) / 2;
  const drawSig = (x: number, title: string, name?: string | null, path?: string | null) => {
    doc
      .fillColor(WOG_PDF.muted)
      .fontSize(8)
      .font('Helvetica')
      .text(title, x, y);
    const boxY = y + 12;
    doc.rect(x, boxY, sigW, 70).strokeColor(WOG_PDF.line).stroke();
    if (path && existsSync(path)) {
      try {
        doc.image(path, x + 8, boxY + 6, { fit: [sigW - 16, 50] });
      } catch {
        /* ignore */
      }
    }
    doc
      .fillColor(WOG_PDF.ink)
      .fontSize(9)
      .font('Helvetica')
      .text(name || 'Unterschrift', x, boxY + 76, { width: sigW });
  };

  drawSig(left, 'WOG Lager', data.wogSignedByName, data.wogSignaturePath);
  drawSig(left + sigW + 20, 'Partner / Fahrer', data.partnerSignedByName, data.partnerSignaturePath);

  doc
    .fillColor(WOG_PDF.muted)
    .fontSize(7)
    .font('Helvetica')
    .text(`WOG Lademittel-Schein · ${data.number}`, left, doc.page.height - 36, {
      width: right - left,
      align: 'center',
    });
  doc.end();

  await new Promise<void>((resolve, reject) => {
    stream.on('finish', () => resolve());
    stream.on('error', reject);
  });
}
