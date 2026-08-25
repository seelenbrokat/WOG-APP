import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { CustomsRefSource, DocumentType } from '@prisma/client';
import { execFileSync } from 'child_process';
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  renameSync,
  statSync,
  unlinkSync,
} from 'fs';
import { basename, dirname, join } from 'path';
import {
  extractMercurioBordereauFieldsFromPdfText,
  extractMercurioEdecFieldsFromPdfText,
  isMercurioEdecFilename,
  mercurioProcessedSubdir,
  parseMercurioEdecMatchFromFilename,
  parseMercurioEdecMatchFromRef,
  type MercurioEdecDocType,
  type MercurioEdecFields,
} from '@wog/shared';
import { PrismaService } from '../prisma/prisma.service';
import { CustomerDocumentsInboundService } from '../documents/customer-documents-inbound.service';
import { ShipmentCustomsRefService } from './shipment-customs-ref.service';
import { EzollSoloplanService } from './ezoll-soloplan.service';

/**
 * Mercurio CH e-dec Inbound (PDF):
 * - Bezugsschein / Einfuhrliste / eVV MWST / eVV Zoll / Bordereau
 * - Match über Auftrag.Sendung aus Dateiname (Fallback Ref-Nr. im PDF)
 * - Beträge (mWSTCH / zollabgabenCH / Bordereau) nur aus eVV
 * - OrderEzoll-Writes wenn SOLOPLAN_MERCURIO_ENABLED≠false
 */
@Injectable()
export class MercurioInboundService {
  private readonly log = new Logger(MercurioInboundService.name);
  private readonly inboundRoot: string;
  private readonly uploadDir: string;

  constructor(
    private prisma: PrismaService,
    private config: ConfigService,
    private customerDocs: CustomerDocumentsInboundService,
    private customsRefs: ShipmentCustomsRefService,
    private ezollSoloplan: EzollSoloplanService,
  ) {
    const sftpInbound =
      this.config.get('SFTP_INBOUND_DIR') ||
      join(process.cwd(), '../../data/sftp/inbound');
    this.inboundRoot = join(sftpInbound, 'Mercurio-Dokumente');
    this.uploadDir =
      this.config.get('UPLOAD_DIR') || join(process.cwd(), '../../data/uploads');
    for (const dir of [
      this.inboundRoot,
      join(this.inboundRoot, 'processed'),
      join(this.inboundRoot, 'processed', 'bezugsschein'),
      join(this.inboundRoot, 'processed', 'einfuhrliste'),
      join(this.inboundRoot, 'processed', 'evv-mwst'),
      join(this.inboundRoot, 'processed', 'evv-zoll'),
      join(this.inboundRoot, 'processed', 'bordereau'),
      join(this.inboundRoot, 'failed'),
      join(this.inboundRoot, 'failed', 'unmatched'),
      join(this.uploadDir, 'mercurio'),
    ]) {
      if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    }
  }

  async processInboundDir(organizationId?: string, limit = 40) {
    const orgId = organizationId || (await this.resolveDefaultOrganizationId());
    if (!orgId) {
      return {
        processed: 0,
        unmatched: 0,
        linked: 0,
        docs: 0,
        soloplan: 0,
        pending: 0,
      };
    }

    try {
      await this.customsRefs.purgeExpired();
    } catch (e: any) {
      this.log.warn(`CustomsRef-Purge übersprungen: ${e?.message || e}`);
    }

    const writeSoloplan = this.config.get('SOLOPLAN_MERCURIO_ENABLED') !== 'false';
    let processed = 0;
    let unmatched = 0;
    let linked = 0;
    let docs = 0;
    let soloplan = 0;
    const files = this.listPendingFiles().slice(0, limit);

    for (const filePath of files) {
      const fileName = basename(filePath);
      try {
        const result = await this.processOne(orgId, filePath, fileName, writeSoloplan);
        if (result === 'unmatched') {
          unmatched += 1;
          this.move(
            filePath,
            join(this.inboundRoot, 'failed', 'unmatched', `${Date.now()}_${fileName}`),
          );
          continue;
        }
        processed += 1;
        if (result.linked) linked += 1;
        if (result.docAttached) docs += 1;
        if (result.soloplanWritten) soloplan += 1;
        this.move(
          filePath,
          join(
            this.inboundRoot,
            'processed',
            mercurioProcessedSubdir(result.docType),
            `${Date.now()}_${fileName}`,
          ),
        );
      } catch (e: any) {
        unmatched += 1;
        this.log.warn(`Mercurio ${fileName}: ${e?.message || e}`);
        this.move(
          filePath,
          join(this.inboundRoot, 'failed', 'unmatched', `${Date.now()}_${fileName}`),
        );
      }
    }

    return {
      processed,
      unmatched,
      linked,
      docs,
      soloplan,
      pending: this.listPendingFiles().length,
    };
  }

  private async processOne(
    organizationId: string,
    filePath: string,
    fileName: string,
    writeSoloplan: boolean,
  ): Promise<
    | 'unmatched'
    | {
        linked: boolean;
        docAttached: boolean;
        soloplanWritten: boolean;
        docType: MercurioEdecDocType;
      }
  > {
    if (!isMercurioEdecFilename(fileName)) {
      this.log.warn(`Mercurio unbekanntes Dateimuster: ${fileName}`);
      return 'unmatched';
    }

    const text = this.pdfText(filePath);
    const fields = extractMercurioEdecFieldsFromPdfText(text, fileName);

    if (fields.docType === 'BORDEREAU') {
      return this.processBordereau(organizationId, filePath, fileName, text, writeSoloplan);
    }

    let match = parseMercurioEdecMatchFromFilename(fileName);
    if (!match && fields.refNumber) {
      match = parseMercurioEdecMatchFromRef(fields.refNumber);
    }
    if (!match) {
      this.log.warn(`Mercurio ohne Auftrag/Sendung: ${fileName}`);
      return 'unmatched';
    }

    return this.processMatchedDoc({
      organizationId,
      filePath,
      fileName,
      writeSoloplan,
      match,
      fields,
    });
  }

  private async processBordereau(
    organizationId: string,
    filePath: string,
    fileName: string,
    text: string,
    writeSoloplan: boolean,
  ): Promise<{
    linked: boolean;
    docAttached: boolean;
    soloplanWritten: boolean;
    docType: MercurioEdecDocType;
  }> {
    const bordereau = extractMercurioBordereauFieldsFromPdfText(text, fileName);
    if (!bordereau.lines.length) {
      this.log.warn(`Mercurio Bordereau ohne Zeilen: ${fileName}`);
      // trotzdem als verarbeitet ablegen (Buchungsbeleg), ohne Soloplan
      return {
        linked: false,
        docAttached: false,
        soloplanWritten: false,
        docType: 'BORDEREAU',
      };
    }

    let linked = false;
    let docs = 0;
    let soloplanWritten = false;

    for (const line of bordereau.lines) {
      const fields: MercurioEdecFields = {
        docType: 'BORDEREAU',
        chDeclarationNumber: line.chDeclarationNumber,
        refNumber: `${line.match.mandantCode || '104'}/${line.match.orderNumber}.${line.match.consignmentIndex}/${line.match.siteCode || 'X'}/0/1`,
        atExportMrn: null,
        registrationNumber: null,
        accessCode: null,
        definitiv: true,
        kontoZoll: null,
        kontoMwst: null,
        zazKonto: null,
        // Beträge kommen aus eVV – Bordereau setzt nur Bordereaunummer
        mwstCh: null,
        zollabgabenCh: null,
        bearbeitungsgebuehrCh: null,
        totalItems: null,
        bordereauNumber: bordereau.bordereauNumber,
        veranlagungMwst: line.kind === 'VVM' ? true : null,
        veranlagungZoll: line.kind === 'VVZ' ? true : null,
      };

      await this.customsRefs.upsertFromOrder({
        organizationId,
        orderNumber: String(line.match.orderNumber),
        consignmentIndex: line.match.consignmentIndex,
        source: CustomsRefSource.MERCURIO_CH,
        mrn: line.chDeclarationNumber,
        lrn: fields.refNumber,
        sourceFileName: fileName,
      });

      if (writeSoloplan && bordereau.bordereauNumber) {
        try {
          this.ezollSoloplan.writeMercurioEdecUpdate(
            {
              kind: 'orderConsignment',
              orderNumber: line.match.orderNumber,
              consignmentIndex: line.match.consignmentIndex,
            },
            fileName,
            fields,
          );
          soloplanWritten = true;
        } catch (e: any) {
          this.log.warn(
            `Mercurio Bordereau Soloplan ${line.match.orderNumber}.${line.match.consignmentIndex}: ${e?.message || e}`,
          );
        }
      }

      const shipment = await this.customerDocs.findShipmentForSoloplanOrder(
        organizationId,
        String(line.match.orderNumber),
        line.match.consignmentIndex,
      );
      if (shipment) {
        linked = true;
        const attached = await this.attachPdfToShipment({
          organizationId,
          shipmentId: shipment.id,
          customerId: shipment.customerId,
          trackingNumber: shipment.trackingNumber,
          filePath,
          fileName,
          docType: 'BORDEREAU',
          chNumber: bordereau.bordereauNumber,
        });
        if (attached) docs += 1;
      }
    }

    this.log.log(
      `Mercurio BORDEREAU ${bordereau.bordereauNumber || '-'} Zeilen=${bordereau.lines.length}` +
        (soloplanWritten ? ' → Soloplan' : '') +
        ` ← ${fileName}`,
    );

    return {
      linked,
      docAttached: docs > 0,
      soloplanWritten,
      docType: 'BORDEREAU',
    };
  }

  private async processMatchedDoc(input: {
    organizationId: string;
    filePath: string;
    fileName: string;
    writeSoloplan: boolean;
    match: {
      orderNumber: number;
      consignmentIndex: number;
    };
    fields: MercurioEdecFields;
  }) {
    const { organizationId, filePath, fileName, writeSoloplan, match, fields } = input;
    const orderNumber = String(match.orderNumber);
    const consignmentIndex = match.consignmentIndex;
    const mrn = fields.chDeclarationNumber;
    const lrn = fields.refNumber || `${orderNumber}.${consignmentIndex}`;

    await this.customsRefs.upsertFromOrder({
      organizationId,
      orderNumber,
      consignmentIndex,
      source: CustomsRefSource.MERCURIO_CH,
      mrn,
      lrn,
      sourceFileName: fileName,
    });

    let soloplanWritten = false;
    if (writeSoloplan) {
      try {
        this.ezollSoloplan.writeMercurioEdecUpdate(
          {
            kind: 'orderConsignment',
            orderNumber: match.orderNumber,
            consignmentIndex,
          },
          fileName,
          fields,
        );
        soloplanWritten = true;
      } catch (e: any) {
        this.log.warn(`Mercurio Soloplan-Write ${fileName}: ${e?.message || e}`);
      }
    }

    const shipment = await this.customerDocs.findShipmentForSoloplanOrder(
      organizationId,
      orderNumber,
      consignmentIndex,
    );
    let docAttached = false;
    if (shipment) {
      docAttached = await this.attachPdfToShipment({
        organizationId,
        shipmentId: shipment.id,
        customerId: shipment.customerId,
        trackingNumber: shipment.trackingNumber,
        filePath,
        fileName,
        docType: fields.docType,
        chNumber: mrn || fields.bordereauNumber,
      });
    } else {
      this.log.log(
        `Mercurio ${orderNumber}.${consignmentIndex}: keine Portal-Sendung (CustomsRef gespeichert)`,
      );
    }

    const amountHint =
      fields.mwstCh != null
        ? ` MWST=${fields.mwstCh}`
        : fields.zollabgabenCh != null
          ? ` Zoll=${fields.zollabgabenCh}`
          : '';

    this.log.log(
      `Mercurio ${fields.docType} ${orderNumber}.${consignmentIndex}` +
        ` CH=${mrn || '-'} Ref=${lrn}` +
        (fields.bordereauNumber ? ` Bordereau=${fields.bordereauNumber}` : '') +
        amountHint +
        (fields.accessCode ? ` Zugang=${fields.accessCode}` : '') +
        (fields.atExportMrn ? ` AT=${fields.atExportMrn}` : '') +
        (soloplanWritten ? ' → Soloplan' : '') +
        (shipment ? ` → ${shipment.trackingNumber}` : ' (ohne Sendung)') +
        ` ← ${fileName}`,
    );

    return {
      linked: Boolean(shipment),
      docAttached,
      soloplanWritten,
      docType: fields.docType === 'UNKNOWN' ? 'EINFUHRLISTE' : fields.docType,
    };
  }

  private async attachPdfToShipment(input: {
    organizationId: string;
    shipmentId: string;
    customerId: string | null;
    trackingNumber: string;
    filePath: string;
    fileName: string;
    docType: MercurioEdecDocType;
    chNumber: string | null;
  }): Promise<boolean> {
    const existing = await this.prisma.document.findFirst({
      where: {
        shipmentId: input.shipmentId,
        source: 'MERCURIO',
        sourceFileName: input.fileName,
      },
      select: { id: true },
    });
    if (existing) return false;

    const label =
      input.docType === 'BEZUGSSCHEIN'
        ? 'CH Bezugsschein'
        : input.docType === 'EINFUHRLISTE'
          ? 'CH Einfuhrliste'
          : input.docType === 'EVV_MWST'
            ? 'CH eVV MWST'
            : input.docType === 'EVV_ZOLL'
              ? 'CH eVV Zoll'
              : input.docType === 'BORDEREAU'
                ? 'CH Bordereau'
                : 'CH e-dec';
    const safeName = `${Date.now()}-mercurio-${input.fileName.replace(/[^a-zA-Z0-9._-]/g, '_')}`;
    const storagePath = join(this.uploadDir, 'mercurio', safeName);
    copyFileSync(input.filePath, storagePath);
    const sizeBytes = statSync(storagePath).size;

    await this.prisma.document.create({
      data: {
        organizationId: input.organizationId,
        shipmentId: input.shipmentId,
        customerId: input.customerId,
        type: DocumentType.CUSTOMS_PAPER,
        categoryCode: null,
        source: 'MERCURIO',
        sourceFileName: input.fileName,
        importedAt: new Date(),
        fileName: input.chNumber
          ? `${label} ${input.chNumber}.pdf`
          : `${label}.pdf`,
        mimeType: 'application/pdf',
        storagePath,
        sizeBytes,
      },
    });
    this.log.log(
      `Mercurio PDF → Sendung ${input.trackingNumber} (${input.docType})`,
    );
    return true;
  }

  private listPendingFiles(): string[] {
    if (!existsSync(this.inboundRoot)) return [];
    return readdirSync(this.inboundRoot, { withFileTypes: true })
      .filter((e) => e.isFile() && /\.pdf$/i.test(e.name))
      .filter((e) => isMercurioEdecFilename(e.name))
      .map((e) => join(this.inboundRoot, e.name))
      .sort();
  }

  private pdfText(filePath: string): string {
    try {
      return execFileSync('pdftotext', ['-layout', filePath, '-'], {
        encoding: 'utf8',
        maxBuffer: 8 * 1024 * 1024,
      });
    } catch {
      try {
        return execFileSync('pdftotext', [filePath, '-'], {
          encoding: 'utf8',
          maxBuffer: 8 * 1024 * 1024,
        });
      } catch (e: any) {
        this.log.warn(`pdftotext ${basename(filePath)}: ${e?.message || e}`);
        return '';
      }
    }
  }

  private move(from: string, to: string) {
    mkdirSync(dirname(to), { recursive: true });
    try {
      renameSync(from, to);
    } catch {
      copyFileSync(from, to);
      try {
        unlinkSync(from);
      } catch {
        /* ignore */
      }
    }
  }

  private async resolveDefaultOrganizationId() {
    const org = await this.prisma.organization.findFirst({
      where: { slug: 'wog' },
      select: { id: true },
    });
    return org?.id || null;
  }
}
