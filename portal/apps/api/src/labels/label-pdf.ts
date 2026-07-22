import { createWriteStream } from 'fs';
import { createRequire } from 'module';
import PDFDocument from 'pdfkit';
import { drawDesignedByCredit, drawLabelBrandHeader, WOG_PDF } from '../common/pdf-brand';
import { ssccAiData } from './sscc';

// bwip-js package exports (`bwip-js/node`) need moduleResolution node16+;
// Nest stays on classic node resolution, so load the CJS entry via createRequire.
const nodeRequire = createRequire(__filename);
const bwipjs = nodeRequire('bwip-js') as {
  toBuffer: (opts: {
    bcid: string;
    text: string;
    scale?: number;
    height?: number;
    includetext?: boolean;
    textxalign?: 'offleft' | 'left' | 'center' | 'right' | 'offright' | 'justify';
  }) => Promise<Buffer>;
};

const LABEL_SIZE: [number, number] = [283.46, 425.2]; // 100×150 mm

export type LabelShipment = {
  trackingNumber: string;
  reference?: string | null;
  orderExternalNumber?: string | null;
  goodsDescription?: string | null;
  pickupCompany?: string | null;
  pickupStreet?: string | null;
  pickupZip?: string | null;
  pickupCity?: string | null;
  pickupCountry?: string | null;
  deliveryCompany?: string | null;
  deliveryStreet?: string | null;
  deliveryZip?: string | null;
  deliveryCity?: string | null;
  deliveryCountry?: string | null;
  customerName?: string | null;
  mandantName?: string | null;
};

export type LabelCollo = {
  itemNumber: number;
  sscc: string;
  content?: string | null;
  packaging?: string | null;
  weightKg?: number | null;
  lengthCm?: number | null;
  widthCm?: number | null;
  heightCm?: number | null;
  totalColli: number;
};

async function barcodePng(sscc: string): Promise<Buffer> {
  const digits = String(sscc).replace(/\D/g, '');
  if (digits.length === 18) {
    return bwipjs.toBuffer({
      bcid: 'gs1-128',
      text: `(00)${digits}`,
      scale: 2,
      height: 14,
      includetext: false,
      textxalign: 'center',
    });
  }
  // Soloplan / Wareneingang: alphanumerisch oder abweichende Länge
  return bwipjs.toBuffer({
    bcid: 'code128',
    text: String(sscc),
    scale: 2,
    height: 14,
    includetext: false,
    textxalign: 'center',
  });
}

async function drawLabelPage(
  doc: PDFKit.PDFDocument,
  shipment: LabelShipment,
  collo: LabelCollo,
): Promise<void> {
  const barcode = await barcodePng(collo.sscc);
  const digits = String(collo.sscc).replace(/\D/g, '');
  const hr = digits.length === 18 ? ssccAiData(digits) : String(collo.sscc);
  const left = 18;
  const right = 265;
  const width = right - left;

  drawLabelBrandHeader(doc, shipment.mandantName);

  // Sendungs-Meta
  doc
    .fillColor(WOG_PDF.greenDeep)
    .font('Helvetica-Bold')
    .fontSize(10)
    .text(shipment.trackingNumber, left, doc.y, { width });
  doc.font('Helvetica').fontSize(8).fillColor(WOG_PDF.ink);
  if (shipment.orderExternalNumber) doc.text(`Auftrag ${shipment.orderExternalNumber}`, { width });
  if (shipment.reference) doc.text(`Ref. ${shipment.reference}`, { width });

  const metaY = doc.y + 4;
  doc.rect(left, metaY, width, 36).fill(WOG_PDF.soft);
  doc.fillColor(WOG_PDF.ink).font('Helvetica-Bold').fontSize(9);
  doc.text(`Collo ${collo.itemNumber} / ${collo.totalColli}`, left + 6, metaY + 5, {
    width: width / 2 - 8,
  });
  doc.font('Helvetica').fontSize(8);
  const pkgLine = [
    collo.packaging || null,
    collo.weightKg != null ? `${collo.weightKg} kg` : null,
  ]
    .filter(Boolean)
    .join('  ·  ');
  doc.text(pkgLine || '–', left + width / 2, metaY + 5, { width: width / 2 - 8, align: 'right' });
  if (collo.lengthCm != null || collo.widthCm != null || collo.heightCm != null) {
    doc.text(
      `${collo.lengthCm ?? '–'} × ${collo.widthCm ?? '–'} × ${collo.heightCm ?? '–'} cm`,
      left + 6,
      metaY + 20,
      { width: width - 12 },
    );
  } else if (collo.content || shipment.goodsDescription) {
    doc.text(String(collo.content || shipment.goodsDescription).slice(0, 48), left + 6, metaY + 20, {
      width: width - 12,
    });
  }
  doc.y = metaY + 42;

  if (collo.content || shipment.goodsDescription) {
    doc
      .fillColor(WOG_PDF.muted)
      .fontSize(7)
      .text('Inhalt', left, doc.y);
    doc
      .fillColor(WOG_PDF.ink)
      .fontSize(8)
      .text(String(collo.content || shipment.goodsDescription).slice(0, 80), { width });
  }

  doc.moveDown(0.35);
  doc.fillColor(WOG_PDF.muted).fontSize(7).font('Helvetica-Bold').text('VON', left);
  doc.fillColor(WOG_PDF.ink).font('Helvetica').fontSize(8);
  doc.text(shipment.pickupCompany || '–', { width });
  doc.text(
    [shipment.pickupStreet, `${shipment.pickupZip || ''} ${shipment.pickupCity || ''}`, shipment.pickupCountry]
      .filter((x) => String(x || '').trim())
      .join(', '),
    { width },
  );

  doc.moveDown(0.25);
  const delY = doc.y;
  doc.rect(left, delY, width, 58).strokeColor(WOG_PDF.green).lineWidth(1).stroke();
  doc
    .fillColor(WOG_PDF.greenDeep)
    .font('Helvetica-Bold')
    .fontSize(7)
    .text('NACH', left + 6, delY + 4);
  doc.fillColor(WOG_PDF.ink).font('Helvetica-Bold').fontSize(10);
  doc.text(shipment.deliveryCompany || '–', left + 6, delY + 14, { width: width - 12 });
  doc.font('Helvetica').fontSize(8);
  doc.text(shipment.deliveryStreet || '', left + 6, doc.y, { width: width - 12 });
  doc
    .font('Helvetica-Bold')
    .fontSize(11)
    .text(`${shipment.deliveryZip || ''} ${shipment.deliveryCity || ''}`, left + 6, doc.y, {
      width: width - 12,
    });
  doc.font('Helvetica').fontSize(8).text(shipment.deliveryCountry || '', left + 6, doc.y, {
    width: width - 12,
  });
  doc.y = delY + 64;

  const barcodeH = 64;
  const barcodeY = Math.min(Math.max(doc.y, 300), 330);
  const barcodeW = width;
  doc.image(barcode, left, barcodeY, { width: barcodeW, height: barcodeH });
  doc.y = barcodeY + barcodeH + 4;
  doc
    .fontSize(8)
    .fillColor(WOG_PDF.ink)
    .font('Helvetica')
    .text(hr, left, doc.y, { align: 'center', width });
  doc
    .fontSize(7)
    .fillColor(WOG_PDF.muted)
    .text(`SSCC ${collo.sscc}`, left, doc.y + 1, { align: 'center', width });

  drawDesignedByCredit(doc, { left, width });
}

/** Ein Collo-Etikett (ca. 100×150 mm) als PDF-Seite. */
export async function writeTransportLabelPdf(
  shipment: LabelShipment,
  collo: LabelCollo,
  storagePath: string,
): Promise<void> {
  return new Promise(async (resolve, reject) => {
    try {
      const doc = new PDFDocument({
        size: LABEL_SIZE,
        margin: 18,
        info: { Title: `Etikett ${shipment.trackingNumber}`, Author: 'WOG Logistics' },
      });
      const stream = createWriteStream(storagePath);
      doc.pipe(stream);
      await drawLabelPage(doc, shipment, collo);
      doc.end();
      stream.on('finish', () => resolve());
      stream.on('error', reject);
    } catch (err) {
      reject(err);
    }
  });
}

/** Alle Colli einer Sendung als mehrseitiges Druck-PDF (eine Seite pro Etikett). */
export async function writeTransportLabelsPrintPdf(
  shipment: LabelShipment,
  colli: LabelCollo[],
  storagePath: string,
): Promise<void> {
  if (!colli.length) throw new Error('Keine Colli für Etikettendruck');
  return new Promise(async (resolve, reject) => {
    try {
      const doc = new PDFDocument({
        size: LABEL_SIZE,
        margin: 18,
        info: { Title: `Etiketten ${shipment.trackingNumber}`, Author: 'WOG Logistics' },
      });
      const stream = createWriteStream(storagePath);
      doc.pipe(stream);
      for (let i = 0; i < colli.length; i++) {
        if (i > 0) doc.addPage({ size: LABEL_SIZE, margin: 18 });
        await drawLabelPage(doc, shipment, colli[i]);
      }
      doc.end();
      stream.on('finish', () => resolve());
      stream.on('error', reject);
    } catch (err) {
      reject(err);
    }
  });
}
