import { createWriteStream, mkdirSync } from 'fs';
import { dirname } from 'path';
import PDFDocument from 'pdfkit';
import { drawA4BrandHeader, drawA4Footer, formatPdfDateTime, WOG_PDF } from '../common/pdf-brand';

/** Verpackungsklassen für Unitec-WE-Übersicht (Lager). */
export type EntladePackClass = 'ISOGROSS' | 'ISOKLEIN' | 'EWP' | 'OTHER';

export type EntladelisteCollo = {
  reference?: string | null;
  soloplanRef?: string | null;
  sscc?: string | null;
  packaging?: string | null;
  content?: string | null;
  weightKg?: number | null;
  deliveryCompany?: string | null;
  deliveryZip?: string | null;
  deliveryCity?: string | null;
};

export type EntladelisteMissing = {
  bk: string;
  li?: string;
  colli?: number;
  weightKg?: number;
};

export type EntladelistePdfInput = {
  proformaNumber: string;
  sessionLabel?: string | null;
  sessionDate: string;
  customerName?: string | null;
  customerNumber?: string | null;
  sourceFileName?: string | null;
  colli: EntladelisteCollo[];
  missing?: EntladelisteMissing[];
};

export type EntladePackSummary = {
  total: number;
  isolation: number;
  isogross: number;
  isoklein: number;
  speicherEwp: number;
  other: number;
};

/** ISOGROSS / ISOKLEIN → Isolation; Einwegpal./EWP → Speicher. */
export function classifyEntladePackaging(
  packaging?: string | null,
  content?: string | null,
): EntladePackClass {
  const raw = `${packaging || ''} ${content || ''}`.trim();
  const compact = raw.toUpperCase().replace(/[.\s_\-/]/g, '');

  if (compact.includes('ISOGROSS') || /ISO\s*GRO(SS|ß)/i.test(raw)) return 'ISOGROSS';
  if (compact.includes('ISOKLEIN') || /ISO\s*KLEIN/i.test(raw)) return 'ISOKLEIN';
  if (
    compact.includes('EINWEG') ||
    compact === 'EWP' ||
    /(^|[^A-Z])EWP([^A-Z]|$)/i.test(raw) ||
    /\bEP\b/i.test(packaging || '')
  ) {
    return 'EWP';
  }
  if (/ISOLIER/i.test(content || '')) {
    if (/KLEIN/i.test(content || '')) return 'ISOKLEIN';
    if (/GRO(SS|ß)|GROSS/i.test(content || '')) return 'ISOGROSS';
  }
  return 'OTHER';
}

export function summarizeEntladePackaging(colli: EntladelisteCollo[]): EntladePackSummary {
  const summary: EntladePackSummary = {
    total: colli.length,
    isolation: 0,
    isogross: 0,
    isoklein: 0,
    speicherEwp: 0,
    other: 0,
  };
  for (const c of colli) {
    const cls = classifyEntladePackaging(c.packaging, c.content);
    if (cls === 'ISOGROSS') {
      summary.isogross += 1;
      summary.isolation += 1;
    } else if (cls === 'ISOKLEIN') {
      summary.isoklein += 1;
      summary.isolation += 1;
    } else if (cls === 'EWP') {
      summary.speicherEwp += 1;
    } else {
      summary.other += 1;
    }
  }
  return summary;
}

function packLabel(cls: EntladePackClass, packaging?: string | null): string {
  switch (cls) {
    case 'ISOGROSS':
      return 'Isogroß';
    case 'ISOKLEIN':
      return 'Isoklein';
    case 'EWP':
      return packaging?.trim() || 'EWP';
    default:
      return packaging?.trim() || '–';
  }
}

function ensureSpace(doc: PDFKit.PDFDocument, need: number) {
  if (doc.y > doc.page.height - need) doc.addPage();
}

/** Entladeliste vor Wareneingang – Übersicht inkl. Isolation/Speicher. */
export function writeEntladelistePdf(input: EntladelistePdfInput, storagePath: string): Promise<EntladePackSummary> {
  mkdirSync(dirname(storagePath), { recursive: true });
  const summary = summarizeEntladePackaging(input.colli);

  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ margin: 48, size: 'A4', bufferPages: true });
    const stream = createWriteStream(storagePath);
    doc.pipe(stream);

    const subtitle = [
      input.customerName || 'Kunde',
      input.customerNumber ? `(${input.customerNumber})` : null,
      input.proformaNumber,
      input.sessionDate,
    ]
      .filter(Boolean)
      .join(' · ');

    drawA4BrandHeader(doc, {
      title: 'Entladeliste Wareneingang',
      subtitle,
    });

    const left = doc.page.margins.left;
    const usable = doc.page.width - doc.page.margins.left - doc.page.margins.right;

    doc.moveDown(0.3);
    doc.fillColor(WOG_PDF.ink).font('Helvetica').fontSize(10);
    if (input.sessionLabel) doc.text(`Session: ${input.sessionLabel}`);
    doc.text(`Erstellt: ${formatPdfDateTime(new Date())}`);
    if (input.sourceFileName) doc.text(`Quelle: ${input.sourceFileName}`);
    doc.text(`Colli gesamt: ${summary.total}${input.missing?.length ? ` · BK ohne WE: ${input.missing.length}` : ''}`);

    // Tabellenkopf
    doc.moveDown(0.55);
    doc.fillColor(WOG_PDF.greenDeep).font('Helvetica-Bold').fontSize(9);
    const cols = {
      bk: left,
      solo: left + 78,
      dest: left + 130,
      pkg: left + 320,
      kg: left + 400,
      content: left + 445,
    };
    const y0 = doc.y;
    doc.text('BK / Ref.', cols.bk, y0, { width: 74 });
    doc.text('Soloplan', cols.solo, y0, { width: 48 });
    doc.text('Empfänger', cols.dest, y0, { width: 185 });
    doc.text('Verp.', cols.pkg, y0, { width: 75 });
    doc.text('kg', cols.kg, y0, { width: 40 });
    doc.text('Inhalt', cols.content, y0, { width: usable - (cols.content - left) });
    doc
      .moveTo(left, doc.y + 2)
      .lineTo(left + usable, doc.y + 2)
      .lineWidth(1)
      .strokeColor(WOG_PDF.green)
      .stroke();
    doc.moveDown(0.35);

    const rows = [...input.colli].sort((a, b) =>
      String(a.reference || '').localeCompare(String(b.reference || ''), 'de'),
    );

    for (const c of rows) {
      ensureSpace(doc, 36);
      const cls = classifyEntladePackaging(c.packaging, c.content);
      const dest = [c.deliveryZip, c.deliveryCompany || c.deliveryCity].filter(Boolean).join(' ');
      const y = doc.y;
      const ink =
        cls === 'ISOGROSS' || cls === 'ISOKLEIN'
          ? '#0b4f8a'
          : cls === 'EWP'
            ? WOG_PDF.greenDeep
            : WOG_PDF.ink;

      doc.fillColor(ink).font('Helvetica').fontSize(8);
      doc.text(c.reference || '–', cols.bk, y, { width: 74 });
      doc.text(c.soloplanRef || '–', cols.solo, y, { width: 48 });
      doc.text(dest || '–', cols.dest, y, { width: 185 });
      doc.text(packLabel(cls, c.packaging), cols.pkg, y, { width: 75 });
      doc.text(c.weightKg != null ? String(c.weightKg) : '–', cols.kg, y, { width: 40 });
      doc.text(c.content || '–', cols.content, y, { width: usable - (cols.content - left) });

      const nextY = Math.max(doc.y, y + 11);
      doc.y = nextY;
      doc
        .moveTo(left, doc.y)
        .lineTo(left + usable, doc.y)
        .lineWidth(0.35)
        .strokeColor(WOG_PDF.line)
        .stroke();
      doc.moveDown(0.18);
    }

    if (input.missing?.length) {
      ensureSpace(doc, 60);
      doc.moveDown(0.4);
      doc.fillColor('#a12622').font('Helvetica-Bold').fontSize(10).text('BK ohne Soloplan-WE');
      doc.font('Helvetica').fontSize(8);
      for (const m of input.missing) {
        ensureSpace(doc, 18);
        doc.text(
          [
            m.bk,
            m.li,
            m.colli != null ? `Colli ${m.colli}` : null,
            m.weightKg != null ? `${m.weightKg} kg` : null,
          ]
            .filter(Boolean)
            .join(' · '),
        );
      }
    }

    // Abschluss: Isolation / Speicher
    ensureSpace(doc, 120);
    doc.moveDown(0.7);
    const boxTop = doc.y;
    doc
      .roundedRect(left, boxTop, usable, 88, 4)
      .fillAndStroke(WOG_PDF.soft, WOG_PDF.green);

    doc.fillColor(WOG_PDF.greenDeep).font('Helvetica-Bold').fontSize(11);
    doc.text('Übersicht für den Lagereingang', left + 12, boxTop + 10, { width: usable - 24 });
    doc.font('Helvetica').fontSize(10).fillColor(WOG_PDF.ink);
    const lines = [
      `Isolationen gesamt: ${summary.isolation}   (Isogroß ${summary.isogross} · Isoklein ${summary.isoklein})`,
      `Speicher (EWP / Einwegpalette): ${summary.speicherEwp}`,
      `Sonstige Colli: ${summary.other}`,
      `Colli gesamt: ${summary.total}`,
    ];
    let ly = boxTop + 30;
    for (const line of lines) {
      doc.text(line, left + 12, ly, { width: usable - 24 });
      ly += 13;
    }

    const range = doc.bufferedPageRange();
    for (let i = 0; i < range.count; i++) {
      doc.switchToPage(range.start + i);
      drawA4Footer(doc, i + 1, range.count);
    }

    stream.on('finish', () => resolve(summary));
    stream.on('error', reject);
    doc.on('error', reject);
    doc.end();
  });
}
