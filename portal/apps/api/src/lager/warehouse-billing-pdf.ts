import PDFDocument from 'pdfkit';
import { drawA4BrandHeader, formatPdfDateTime, WOG_PDF } from '../common/pdf-brand';

export type WarehouseBillingPdfMovement = {
  occurredAt: Date;
  type: 'IN' | 'OUT';
  customerName: string;
  customerNumber: string;
  articleName?: string | null;
  serialNumber?: string | null;
  palletLabel: string;
  slotUnits: number;
  locationCode?: string | null;
  unitPrice: number;
  amount: number;
  note?: string | null;
};

export type WarehouseBillingPdfStockRow = {
  customerName: string;
  customerNumber: string;
  articleName?: string | null;
  serialNumber?: string | null;
  palletLabel: string;
  slotUnits: number;
  locationCode?: string | null;
  storedAt: Date;
  status: string;
};

export type WarehouseBillingPdfRate = {
  customerName: string;
  customerNumber: string;
  palletLabel: string;
  inboundFee: number;
  outboundFee: number;
  storageFeePerSlot: number;
};

export type WarehouseBillingPdfCustomerSummary = {
  customerName: string;
  customerNumber: string;
  inboundCount: number;
  inboundAmount: number;
  outboundCount: number;
  outboundAmount: number;
  storageAmount: number;
  total: number;
  storageByType: Array<{
    palletLabel: string;
    peakSlots: number;
    peakDay: string;
    fee: number;
    amount: number;
  }>;
};

export type WarehouseBillingPdfInput = {
  year: number;
  month: number;
  currency: string;
  generatedAt?: Date;
  movements: WarehouseBillingPdfMovement[];
  stockAtMonthEnd: WarehouseBillingPdfStockRow[];
  rates: WarehouseBillingPdfRate[];
  customers: WarehouseBillingPdfCustomerSummary[];
  totals: {
    inbound: number;
    outbound: number;
    storage: number;
    grand: number;
  };
};

function money(n: number, currency = 'EUR') {
  return `${Number(n || 0).toFixed(2)} ${currency === 'EUR' ? '€' : currency}`;
}

function dt(d: Date) {
  return d.toLocaleString('de-AT', {
    timeZone: 'Europe/Vienna',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function day(d: Date) {
  return d.toLocaleDateString('de-AT', {
    timeZone: 'Europe/Vienna',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  });
}

function ensureSpace(doc: PDFKit.PDFDocument, need: number) {
  const bottom = doc.page.height - doc.page.margins.bottom;
  if (doc.y + need > bottom) doc.addPage();
}

function sectionTitle(doc: PDFKit.PDFDocument, title: string) {
  ensureSpace(doc, 28);
  doc
    .moveDown(0.4)
    .fillColor(WOG_PDF.greenDeep)
    .font('Helvetica-Bold')
    .fontSize(11)
    .text(title);
  doc
    .moveTo(doc.page.margins.left, doc.y + 2)
    .lineTo(doc.page.width - doc.page.margins.right, doc.y + 2)
    .strokeColor(WOG_PDF.line)
    .lineWidth(1)
    .stroke();
  doc.moveDown(0.45);
  doc.fillColor(WOG_PDF.ink).font('Helvetica').fontSize(8);
}

/**
 * Lager-Monatsabrechnung als PDF (Bewegungen, Bestand, Preise, Summen).
 * Reines Rendering – keine DB-Zugriffe.
 */
export async function buildWarehouseBillingPdf(
  input: WarehouseBillingPdfInput,
): Promise<Buffer> {
  const doc = new PDFDocument({
    size: 'A4',
    margins: { top: 48, bottom: 48, left: 36, right: 36 },
    bufferPages: true,
  });
  const chunks: Buffer[] = [];
  doc.on('data', (c) => chunks.push(c));

  const period = `${String(input.month).padStart(2, '0')}/${input.year}`;
  drawA4BrandHeader(doc, {
    title: 'Lager-Abrechnung',
    subtitle: `Monat ${period}`,
  });

  doc
    .fillColor(WOG_PDF.muted)
    .fontSize(8)
    .font('Helvetica')
    .text(`Erstellt: ${formatPdfDateTime(input.generatedAt || new Date())}`, {
      align: 'right',
    });

  doc
    .fillColor(WOG_PDF.ink)
    .font('Helvetica')
    .fontSize(9)
    .text(
      `Einlagerung ${money(input.totals.inbound)} · Auslagerung ${money(input.totals.outbound)} · ` +
        `Lagerung (Höchststand) ${money(input.totals.storage)} · Gesamt ${money(input.totals.grand)}`,
    )
    .moveDown(0.5);

  // —— Kundenzusammenfassung ——
  sectionTitle(doc, 'Zusammenfassung je Kunde');
  for (const c of input.customers) {
    ensureSpace(doc, 52);
    doc
      .font('Helvetica-Bold')
      .fontSize(9)
      .fillColor(WOG_PDF.ink)
      .text(`${c.customerName} (${c.customerNumber})`);
    doc
      .font('Helvetica')
      .fontSize(8)
      .fillColor(WOG_PDF.muted)
      .text(
        `Ein: ${c.inboundCount} / ${money(c.inboundAmount)} · Aus: ${c.outboundCount} / ${money(c.outboundAmount)} · ` +
          `Lager: ${money(c.storageAmount)} · Gesamt: ${money(c.total)}`,
      );
    const peaks = c.storageByType.filter((p) => p.peakSlots > 0 || p.amount > 0);
    if (peaks.length) {
      doc.text(
        peaks
          .map(
            (p) =>
              `${p.palletLabel}: Höchst ${p.peakSlots} Slots am ${p.peakDay} × ${money(p.fee)} = ${money(p.amount)}`,
          )
          .join(' · '),
      );
    }
    doc.moveDown(0.35);
  }
  if (!input.customers.length) {
    doc.font('Helvetica').fontSize(8).fillColor(WOG_PDF.muted).text('Keine Daten in diesem Monat.');
  }

  // —— Preise ——
  sectionTitle(doc, 'Preise (aktiv)');
  if (!input.rates.length) {
    doc.font('Helvetica').fontSize(8).fillColor(WOG_PDF.muted).text('Keine aktiven Preissätze.');
  } else {
    const col = { cust: 130, typ: 90, in: 70, out: 70, stor: 90 };
    ensureSpace(doc, 20);
    doc.font('Helvetica-Bold').fontSize(7).fillColor(WOG_PDF.muted);
    let x = doc.page.margins.left;
    const y0 = doc.y;
    doc.text('Kunde', x, y0, { width: col.cust });
    x += col.cust;
    doc.text('Format', x, y0, { width: col.typ });
    x += col.typ;
    doc.text('Ein €', x, y0, { width: col.in, align: 'right' });
    x += col.in;
    doc.text('Aus €', x, y0, { width: col.out, align: 'right' });
    x += col.out;
    doc.text('Lager €/Slot', x, y0, { width: col.stor, align: 'right' });
    doc.moveDown(0.35);
    doc.font('Helvetica').fontSize(7).fillColor(WOG_PDF.ink);
    for (const r of input.rates) {
      ensureSpace(doc, 12);
      const y = doc.y;
      let cx = doc.page.margins.left;
      doc.text(`${r.customerName} (${r.customerNumber})`, cx, y, {
        width: col.cust,
        ellipsis: true,
      });
      cx += col.cust;
      doc.text(r.palletLabel, cx, y, { width: col.typ, ellipsis: true });
      cx += col.typ;
      doc.text(r.inboundFee.toFixed(2), cx, y, { width: col.in, align: 'right' });
      cx += col.in;
      doc.text(r.outboundFee.toFixed(2), cx, y, { width: col.out, align: 'right' });
      cx += col.out;
      doc.text(r.storageFeePerSlot.toFixed(2), cx, y, { width: col.stor, align: 'right' });
      doc.y = y + 11;
    }
  }

  // —— Bewegungen ——
  sectionTitle(doc, 'Lagerbewegungen (Ein- / Auslagerung)');
  if (!input.movements.length) {
    doc.font('Helvetica').fontSize(8).fillColor(WOG_PDF.muted).text('Keine Bewegungen in diesem Monat.');
  } else {
    const cols = {
      date: 72,
      typ: 28,
      art: 110,
      fmt: 58,
      slot: 32,
      loc: 58,
      price: 42,
      amt: 48,
    };
    ensureSpace(doc, 16);
    let hx = doc.page.margins.left;
    const hy = doc.y;
    doc.font('Helvetica-Bold').fontSize(6.5).fillColor(WOG_PDF.muted);
    const headers: Array<[string, number, 'left' | 'right']> = [
      ['Datum', cols.date, 'left'],
      ['Art', cols.typ, 'left'],
      ['Artikel / Seriennr.', cols.art, 'left'],
      ['Format', cols.fmt, 'left'],
      ['Slots', cols.slot, 'right'],
      ['Platz', cols.loc, 'left'],
      ['€/Einh.', cols.price, 'right'],
      ['Betrag', cols.amt, 'right'],
    ];
    for (const [label, w, align] of headers) {
      doc.text(label, hx, hy, { width: w, align });
      hx += w;
    }
    doc.y = hy + 10;
    doc.font('Helvetica').fontSize(6.5).fillColor(WOG_PDF.ink);

    for (const m of input.movements) {
      ensureSpace(doc, 14);
      const y = doc.y;
      let cx = doc.page.margins.left;
      const art =
        [m.articleName, m.serialNumber].filter(Boolean).join(' / ') ||
        `${m.customerName}`;
      const cells: Array<[string, number, 'left' | 'right']> = [
        [dt(m.occurredAt), cols.date, 'left'],
        [m.type === 'IN' ? 'EIN' : 'AUS', cols.typ, 'left'],
        [art, cols.art, 'left'],
        [m.palletLabel, cols.fmt, 'left'],
        [String(m.slotUnits), cols.slot, 'right'],
        [m.locationCode || '—', cols.loc, 'left'],
        [m.unitPrice.toFixed(2), cols.price, 'right'],
        [m.amount.toFixed(2), cols.amt, 'right'],
      ];
      for (const [text, w, align] of cells) {
        doc.text(text, cx, y, { width: w, align, ellipsis: true, lineBreak: false });
        cx += w;
      }
      doc.y = y + 11;
    }
  }

  // —— Bestand Monatsende ——
  sectionTitle(doc, 'Bestand am Monatsende (noch eingelagert)');
  if (!input.stockAtMonthEnd.length) {
    doc
      .font('Helvetica')
      .fontSize(8)
      .fillColor(WOG_PDF.muted)
      .text('Kein offener Bestand zum Monatsende.');
  } else {
    const cols = {
      cust: 100,
      art: 120,
      fmt: 70,
      slot: 36,
      loc: 70,
      since: 70,
    };
    ensureSpace(doc, 16);
    let hx = doc.page.margins.left;
    const hy = doc.y;
    doc.font('Helvetica-Bold').fontSize(6.5).fillColor(WOG_PDF.muted);
    const headers: Array<[string, number]> = [
      ['Kunde', cols.cust],
      ['Artikel / Seriennr.', cols.art],
      ['Format', cols.fmt],
      ['Slots', cols.slot],
      ['Platz', cols.loc],
      ['Eingelagert', cols.since],
    ];
    for (const [label, w] of headers) {
      doc.text(label, hx, hy, { width: w, align: label === 'Slots' ? 'right' : 'left' });
      hx += w;
    }
    doc.y = hy + 10;
    doc.font('Helvetica').fontSize(6.5).fillColor(WOG_PDF.ink);
    for (const s of input.stockAtMonthEnd) {
      ensureSpace(doc, 14);
      const y = doc.y;
      let cx = doc.page.margins.left;
      const art = [s.articleName, s.serialNumber].filter(Boolean).join(' / ') || '—';
      const row: Array<[string, number, 'left' | 'right']> = [
        [`${s.customerName} (${s.customerNumber})`, cols.cust, 'left'],
        [art, cols.art, 'left'],
        [s.palletLabel, cols.fmt, 'left'],
        [String(s.slotUnits), cols.slot, 'right'],
        [s.locationCode || '—', cols.loc, 'left'],
        [day(s.storedAt), cols.since, 'left'],
      ];
      for (const [text, w, align] of row) {
        doc.text(text, cx, y, { width: w, align, ellipsis: true, lineBreak: false });
        cx += w;
      }
      doc.y = y + 11;
    }
    const slotSum = input.stockAtMonthEnd.reduce((a, s) => a + s.slotUnits, 0);
    doc
      .moveDown(0.3)
      .font('Helvetica-Bold')
      .fontSize(8)
      .fillColor(WOG_PDF.ink)
      .text(
        `Positionen: ${input.stockAtMonthEnd.length} · Stellplätze gesamt: ${slotSum}`,
      );
  }

  doc
    .moveDown(1)
    .font('Helvetica')
    .fontSize(7)
    .fillColor(WOG_PDF.muted)
    .text(
      'Dieses PDF dient als Beleggrundlage für die Lagerabrechnung (Bewegungen, Höchststand, Preise).',
    );

  doc.end();
  await new Promise<void>((resolve, reject) => {
    doc.on('end', () => resolve());
    doc.on('error', reject);
  });
  return Buffer.concat(chunks);
}
