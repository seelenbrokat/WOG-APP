import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { CustomerDocCategory, NotificationEvent } from '@prisma/client';
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  renameSync,
  statSync,
} from 'fs';
import { basename, extname, join } from 'path';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import {
  documentTypeForCategory,
  parseCustomerDocCategory,
} from './customer-doc-categories';

/**
 * Inbound für Kunden-Dokumente-Modul.
 *
 * Ordner: {SFTP_INBOUND}/customer-documents/
 * Dateiname: {Sendungsreferenz}__{KATEGORIE}__{Originalname}.pdf
 *   z. B. 948074__CUSTOMS_EXIT__Austritt.pdf
 *        WOG2607A2E6B0__INVOICE__Rechnung.pdf
 * Alternativ Unterordner: customer-documents/INVOICE/*.pdf (Ref aus Dateiname vor erstem _)
 */
@Injectable()
export class CustomerDocumentsInboundService {
  private readonly log = new Logger(CustomerDocumentsInboundService.name);
  private readonly inboundRoot: string;
  private readonly uploadDir: string;

  constructor(
    private prisma: PrismaService,
    private config: ConfigService,
    private notifications: NotificationsService,
  ) {
    const sftpInbound =
      this.config.get('SFTP_INBOUND_DIR') || join(process.cwd(), '../../data/sftp/inbound');
    this.inboundRoot = join(sftpInbound, 'customer-documents');
    this.uploadDir = this.config.get('UPLOAD_DIR') || join(process.cwd(), '../../data/uploads');
    for (const dir of [
      this.inboundRoot,
      join(this.inboundRoot, 'processed'),
      join(this.inboundRoot, 'failed'),
      this.uploadDir,
    ]) {
      if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    }
  }

  /**
   * eZoll-CC599-PDF als Kunden-Austrittsbestätigung ablegen.
   * Kunde = Soloplan-Frachtzahler (Sendung.customerId).
   */
  async tryPublishCustomsExitPdf(input: {
    organizationId: string;
    orderNumber: number | string;
    consignmentIndex?: number;
    filePath: string;
    sourceFileName: string;
  }): Promise<'ok' | 'skipped' | 'no_rights' | 'no_shipment' | 'no_customer'> {
    const orderKey = String(input.orderNumber).trim();
    if (!orderKey || !existsSync(input.filePath)) return 'skipped';

    const shipment = await this.findShipmentForSoloplanOrder(
      input.organizationId,
      orderKey,
      input.consignmentIndex,
    );
    if (!shipment?.customerId) return 'no_shipment';

    const customer = await this.prisma.customer.findUnique({
      where: { id: shipment.customerId },
      select: {
        id: true,
        documentsModuleEnabled: true,
        documentCategoryAccess: { where: { active: true }, select: { category: true } },
      },
    });
    if (!customer) return 'no_customer';
    if (!customer.documentsModuleEnabled) return 'no_rights';
    const allowed = new Set(customer.documentCategoryAccess.map((a) => a.category));
    if (!allowed.has(CustomerDocCategory.CUSTOMS_EXIT)) return 'no_rights';

    const existing = await this.prisma.document.findFirst({
      where: {
        shipmentId: shipment.id,
        categoryCode: CustomerDocCategory.CUSTOMS_EXIT,
        sourceFileName: input.sourceFileName,
      },
    });
    if (existing) return 'skipped';

    const safeName = `${Date.now()}-ezoll-exit-${input.sourceFileName.replace(/[^a-zA-Z0-9._-]/g, '_')}`;
    const storagePath = join(this.uploadDir, 'customer-documents', safeName);
    mkdirSync(join(this.uploadDir, 'customer-documents'), { recursive: true });
    copyFileSync(input.filePath, storagePath);
    const sizeBytes = statSync(storagePath).size;

    const doc = await this.prisma.document.create({
      data: {
        organizationId: shipment.organizationId,
        shipmentId: shipment.id,
        customerId: shipment.customerId,
        type: documentTypeForCategory(CustomerDocCategory.CUSTOMS_EXIT),
        categoryCode: CustomerDocCategory.CUSTOMS_EXIT,
        source: 'EZOLL',
        sourceFileName: input.sourceFileName,
        importedAt: new Date(),
        fileName: `Austrittsbestätigung ${orderKey}.pdf`,
        mimeType: 'application/pdf',
        storagePath,
        sizeBytes,
      },
    });

    await this.notifications.notifyShipmentUsers(shipment.id, NotificationEvent.DOCUMENT_RECEIVED, {
      fileName: doc.fileName,
      category: CustomerDocCategory.CUSTOMS_EXIT,
    }, {
      attachments: [
        {
          filename: doc.fileName,
          path: storagePath,
          contentType: 'application/pdf',
        },
      ],
    });

    this.log.log(
      `eZoll Austritt → Kunden-Dokument Sendung ${shipment.trackingNumber} (Frachtzahler ${shipment.customerId}, ${doc.id})`,
    );
    return 'ok';
  }

  async findShipmentForSoloplanOrder(
    organizationId: string,
    orderNumber: string,
    consignmentIndex?: number,
  ) {
    const dotted =
      consignmentIndex != null && consignmentIndex > 0
        ? `${orderNumber}.${consignmentIndex}`
        : null;
    return this.prisma.shipment.findFirst({
      where: {
        organizationId,
        OR: [
          { soloplanRef: { equals: orderNumber, mode: 'insensitive' } },
          { reference: { equals: `WE-${orderNumber}`, mode: 'insensitive' } },
          { reference: { equals: `EZOLL-${orderNumber}`, mode: 'insensitive' } },
          ...(dotted
            ? [{ soloplanRef: { equals: dotted, mode: 'insensitive' as const } }]
            : []),
          { order: { soloplanRef: { equals: orderNumber, mode: 'insensitive' } } },
          { order: { externalNumber: { equals: orderNumber, mode: 'insensitive' } } },
        ],
      },
      select: {
        id: true,
        trackingNumber: true,
        organizationId: true,
        customerId: true,
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async processInboundDir(limit = 40): Promise<{ processed: number; failed: number; skipped: number }> {
    let processed = 0;
    let failed = 0;
    let skipped = 0;

    const files = this.listPendingFiles().slice(0, limit);
    for (const item of files) {
      const fileName = basename(item.path);
      try {
        const result = await this.ingestFile(item.path, item.folderCategory);
        if (result === 'skipped') {
          skipped += 1;
        } else {
          processed += 1;
          this.move(item.path, join(this.inboundRoot, 'processed', `${Date.now()}_${fileName}`));
        }
      } catch (e: any) {
        failed += 1;
        this.log.warn(`Kunden-Dokument ${fileName}: ${e?.message || e}`);
        this.move(item.path, join(this.inboundRoot, 'failed', `${Date.now()}_${fileName}`));
      }
    }
    return { processed, failed, skipped };
  }

  private listPendingFiles(): Array<{ path: string; folderCategory: string | null }> {
    if (!existsSync(this.inboundRoot)) return [];
    const out: Array<{ path: string; folderCategory: string | null }> = [];
    for (const entry of readdirSync(this.inboundRoot, { withFileTypes: true })) {
      if (entry.name === 'processed' || entry.name === 'failed') continue;
      if (entry.isFile()) {
        out.push({ path: join(this.inboundRoot, entry.name), folderCategory: null });
        continue;
      }
      if (!entry.isDirectory()) continue;
      const categoryHint = parseCustomerDocCategory(entry.name);
      const sub = join(this.inboundRoot, entry.name);
      for (const f of readdirSync(sub, { withFileTypes: true })) {
        if (!f.isFile()) continue;
        out.push({
          path: join(sub, f.name),
          folderCategory: categoryHint,
        });
      }
    }
    return out.sort((a, b) => a.path.localeCompare(b.path));
  }

  private async ingestFile(
    filePath: string,
    folderCategory: CustomerDocCategory | string | null,
  ): Promise<'ok' | 'skipped'> {
    const realName = basename(filePath);
    if (realName.startsWith('.')) return 'skipped';

    const parsed = this.parseFileName(
      realName,
      folderCategory ? String(folderCategory) : null,
    );
    if (!parsed) {
      throw new Error(
        'Dateiname ungültig – erwartet {Referenz}__{KATEGORIE}__{Name}.pdf oder Unterordner/Kategorie',
      );
    }

    const shipment = await this.findShipment(parsed.ref);
    if (!shipment) {
      throw new Error(`Keine Sendung für Referenz „${parsed.ref}“ gefunden`);
    }
    if (!shipment.customerId) {
      throw new Error(`Sendung ${shipment.trackingNumber} ohne Kundenkonto`);
    }

    const customer = await this.prisma.customer.findUnique({
      where: { id: shipment.customerId },
      select: {
        id: true,
        documentsModuleEnabled: true,
        documentCategoryAccess: { where: { active: true }, select: { category: true } },
      },
    });
    if (!customer?.documentsModuleEnabled) {
      throw new Error(`Dokumente-Modul für Kunde nicht freigeschaltet`);
    }
    const allowed = new Set(customer.documentCategoryAccess.map((a) => a.category));
    if (!allowed.has(parsed.category)) {
      throw new Error(`Kategorie ${parsed.category} für diesen Kunden nicht freigeschaltet`);
    }

    // Duplikat: gleiche Quelldatei bereits importiert
    const existing = await this.prisma.document.findFirst({
      where: {
        shipmentId: shipment.id,
        categoryCode: parsed.category,
        sourceFileName: realName,
      },
    });
    if (existing) return 'skipped';

    const safeName = `${Date.now()}-custdoc-${realName.replace(/[^a-zA-Z0-9._-]/g, '_')}`;
    const storagePath = join(this.uploadDir, 'customer-documents', safeName);
    mkdirSync(join(this.uploadDir, 'customer-documents'), { recursive: true });
    copyFileSync(filePath, storagePath);
    const sizeBytes = statSync(storagePath).size;
    const mimeType = mimeFromExt(extname(realName));

    const doc = await this.prisma.document.create({
      data: {
        organizationId: shipment.organizationId,
        shipmentId: shipment.id,
        customerId: shipment.customerId,
        type: documentTypeForCategory(parsed.category),
        categoryCode: parsed.category,
        source: 'SFTP',
        sourceFileName: realName,
        importedAt: new Date(),
        fileName: parsed.displayName || realName,
        mimeType,
        storagePath,
        sizeBytes,
      },
    });

    await this.notifications.notifyShipmentUsers(shipment.id, NotificationEvent.DOCUMENT_RECEIVED, {
      fileName: doc.fileName,
      category: parsed.category,
    });

    this.log.log(
      `Kunden-Dokument ${parsed.category} → Sendung ${shipment.trackingNumber} (${doc.id})`,
    );
    return 'ok';
  }

  private parseFileName(
    fileName: string,
    folderCategory: string | null,
  ): { ref: string; category: CustomerDocCategory; displayName: string } | null {
    // {ref}__{CATEGORY}__{rest}
    const dbl = fileName.match(/^(.+?)__([A-Za-zÄÖÜäöü0-9_-]+)__(.+)$/);
    if (dbl) {
      const category = parseCustomerDocCategory(dbl[2]);
      if (!category) return null;
      return { ref: dbl[1].trim(), category, displayName: dbl[3] };
    }
    // {ref}_{CATEGORY}_{rest} (einfacher Unterstrich)
    const single = fileName.match(/^(.+?)_([A-Za-zÄÖÜäöü0-9-]+)_(.+)$/);
    if (single) {
      const category = parseCustomerDocCategory(single[2]);
      if (category) {
        return { ref: single[1].trim(), category, displayName: single[3] };
      }
    }
    // Unterordner liefert Kategorie; Ref = Teil vor erstem _
    if (folderCategory) {
      const category = parseCustomerDocCategory(folderCategory);
      if (!category) return null;
      const base = fileName.replace(/\.[^.]+$/, '');
      const ref = base.split(/[_\s-]/)[0]?.trim();
      if (!ref) return null;
      return { ref, category, displayName: fileName };
    }
    return null;
  }

  private async findShipment(ref: string) {
    const key = ref.trim();
    if (!key) return null;
    return this.prisma.shipment.findFirst({
      where: {
        OR: [
          { trackingNumber: { equals: key, mode: 'insensitive' } },
          { soloplanRef: { equals: key, mode: 'insensitive' } },
          { reference: { equals: key, mode: 'insensitive' } },
          { order: { externalNumber: { equals: key, mode: 'insensitive' } } },
          { order: { soloplanRef: { equals: key, mode: 'insensitive' } } },
        ],
      },
      select: {
        id: true,
        trackingNumber: true,
        organizationId: true,
        customerId: true,
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  private move(from: string, to: string) {
    try {
      mkdirSync(join(to, '..'), { recursive: true });
      renameSync(from, to);
    } catch (e: any) {
      this.log.warn(`Move failed ${from} → ${to}: ${e?.message || e}`);
    }
  }
}

function mimeFromExt(ext: string): string {
  switch (ext.toLowerCase()) {
    case '.pdf':
      return 'application/pdf';
    case '.png':
      return 'image/png';
    case '.jpg':
    case '.jpeg':
      return 'image/jpeg';
    case '.tif':
    case '.tiff':
      return 'image/tiff';
    default:
      return 'application/octet-stream';
  }
}
