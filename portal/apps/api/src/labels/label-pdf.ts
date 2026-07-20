import { createWriteStream } from 'fs';
import { createRequire } from 'module';
import PDFDocument from 'pdfkit';
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
  weightKg?: number | null;
  totalColli: number;
};

async function barcodePng(sscc: string): Promise<Buffer> {
  return bwipjs.toBuffer({
    bcid: 'gs1-128',
    text: `(00)${sscc}`,
    scale: 2,
    height: 14,
    includetext: false,
    textxalign: 'center',
  });
}

/** Ein Collo-Etikett (ca. 100×150 mm) als PDF-Seite. */
export async function writeTransportLabelPdf(
  shipment: LabelShipment,
  collo: LabelCollo,
  storagePath: string,
): Promise<void> {
  const barcode = await barcodePng(collo.sscc);
  const hr = ssccAiData(collo.sscc);

  return new Promise((resolve, reject) => {
    // 100mm x 150mm ≈ 283.5 x 425.2 pt
    const doc = new PDFDocument({
      size: [283.46, 425.2],
      margin: 18,
    });
    const stream = createWriteStream(storagePath);
    doc.pipe(stream);

    doc.fontSize(9).fillColor('#333').text('WOG Logistics', { continued: false });
    doc.fontSize(8).fillColor('#666').text(shipment.mandantName || '');
    doc.moveDown(0.3);
    doc
      .moveTo(18, doc.y)
      .lineTo(265, doc.y)
      .strokeColor('#ccc')
      .stroke();
    doc.moveDown(0.4);

    doc.fillColor('#000').fontSize(11).text('Transportetikett', { align: 'left' });
    doc.fontSize(9);
    doc.text(`Sendung: ${shipment.trackingNumber}`);
    if (shipment.orderExternalNumber) doc.text(`Auftrag: ${shipment.orderExternalNumber}`);
    if (shipment.reference) doc.text(`Referenz: ${shipment.reference}`);
    doc.text(`Collo: ${collo.itemNumber} / ${collo.totalColli}`);
    if (collo.weightKg != null) doc.text(`Gewicht: ${collo.weightKg} kg`);
    if (collo.content || shipment.goodsDescription) {
      doc.text(`Inhalt: ${collo.content || shipment.goodsDescription}`);
    }

    doc.moveDown(0.5);
    doc.fontSize(8).fillColor('#444').text('Von');
    doc.fillColor('#000').fontSize(9);
    doc.text(shipment.pickupCompany || '–');
    doc.text(
      [shipment.pickupStreet, `${shipment.pickupZip || ''} ${shipment.pickupCity || ''}`, shipment.pickupCountry]
        .filter((x) => String(x || '').trim())
        .join(', '),
    );

    doc.moveDown(0.3);
    doc.fontSize(8).fillColor('#444').text('Nach');
    doc.fillColor('#000').fontSize(10);
    doc.text(shipment.deliveryCompany || '–');
    doc.text(shipment.deliveryStreet || '');
    doc
      .fontSize(11)
      .text(`${shipment.deliveryZip || ''} ${shipment.deliveryCity || ''}`, { continued: false });
    doc.fontSize(9).text(shipment.deliveryCountry || '');

    doc.moveDown(0.6);
    const barcodeY = Math.min(doc.y, 280);
    const barcodeW = 240;
    const barcodeH = 70;
    doc.image(barcode, 22, barcodeY, { width: barcodeW, height: barcodeH });
    doc.y = barcodeY + barcodeH + 6;
    doc.fontSize(9).fillColor('#000').text(hr, { align: 'center', width: 245 });
    doc.fontSize(8).fillColor('#333').text(`SSCC ${collo.sscc}`, { align: 'center', width: 245 });

    doc.end();
    stream.on('finish', () => resolve());
    stream.on('error', reject);
  });
}
