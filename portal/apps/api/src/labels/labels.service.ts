import {
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { existsSync, mkdirSync, statSync } from 'fs';
import { join } from 'path';
import { DocumentType, UserRole } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuthUser } from '../auth/auth.types';
import { AuditService } from '../audit/audit.service';
import { buildSscc, isValidSscc } from './sscc';
import { writeTransportLabelPdf, writeTransportLabelsPrintPdf } from './label-pdf';

@Injectable()
export class LabelsService {
  private readonly logger = new Logger(LabelsService.name);
  private uploadDir: string;

  constructor(
    private prisma: PrismaService,
    private config: ConfigService,
    private audit: AuditService,
  ) {
    this.uploadDir = this.config.get('UPLOAD_DIR') || join(process.cwd(), '../../data/uploads');
    if (!existsSync(this.uploadDir)) mkdirSync(this.uploadDir, { recursive: true });
  }

  async listColli(user: AuthUser, shipmentId: string) {
    await this.getShipment(user, shipmentId);
    return this.prisma.shipmentCollo.findMany({
      where: { shipmentId },
      orderBy: { itemNumber: 'asc' },
    });
  }

  /**
   * Stellt Colli inkl. SSCC sicher und erzeugt Etiketten-PDFs:
   * - je Collo ein Einzel-PDF
   * - ein kombiniertes Druck-PDF (alle Etiketten, eine Seite pro Collo)
   */
  async generateLabels(user: AuthUser, shipmentId: string) {
    const shipment = await this.getShipment(user, shipmentId);
    if (shipment.status === 'CANCELLED') {
      throw new ForbiddenException('Stornierte Sendung – Etiketten werden nicht erzeugt/angedruckt');
    }
    const allColli = await this.repairInvalidColliSscc(
      shipment.organizationId,
      await this.ensureColli(shipment),
    );
    // Stornierte Colli (WE-Storno) nicht andrucken
    const colli = allColli.filter((c: { warehouseStatus?: string }) => c.warehouseStatus !== 'CANCELLED');
    if (!colli.length) {
      throw new ForbiddenException('Keine druckbaren Colli – alle Packstücke sind storniert');
    }
    const docs = [];

    const labelShipment = {
      trackingNumber: shipment.trackingNumber,
      reference: shipment.reference,
      orderExternalNumber: shipment.order?.externalNumber,
      goodsDescription: shipment.goodsDescription,
      pickupCompany: shipment.pickupCompany,
      pickupStreet: shipment.pickupStreet,
      pickupZip: shipment.pickupZip,
      pickupCity: shipment.pickupCity,
      pickupCountry: shipment.pickupCountry,
      deliveryCompany: shipment.deliveryCompany,
      deliveryStreet: shipment.deliveryStreet,
      deliveryZip: shipment.deliveryZip,
      deliveryCity: shipment.deliveryCity,
      deliveryCountry: shipment.deliveryCountry,
      customerName: shipment.customer?.name,
      mandantName: shipment.mandant?.name,
    };

    const labelColli = colli.map((collo) => ({
      itemNumber: collo.itemNumber,
      sscc: collo.sscc,
      content: collo.content,
      packaging: collo.packaging,
      weightKg: collo.weightKg,
      lengthCm: collo.lengthCm,
      widthCm: collo.widthCm,
      heightCm: collo.heightCm,
      totalColli: colli.length,
    }));

    for (const collo of labelColli) {
      const fileName = `Label-${shipment.trackingNumber}-${collo.itemNumber}-${collo.sscc}.pdf`;
      const storagePath = join(this.uploadDir, fileName);
      await writeTransportLabelPdf(labelShipment, collo, storagePath);

      const doc = await this.prisma.document.create({
        data: {
          organizationId: shipment.organizationId,
          shipmentId: shipment.id,
          customerId: shipment.customerId,
          type: DocumentType.LABEL,
          fileName,
          mimeType: 'application/pdf',
          storagePath,
          sizeBytes: statSync(storagePath).size,
          uploadedById: user.id,
        },
      });
      docs.push(doc);
    }

    // Kombiniertes Druck-PDF für den Etikettendruck (alle Colli)
    const printFileName = `Etiketten-${shipment.trackingNumber}.pdf`;
    const printPath = join(this.uploadDir, printFileName);
    await writeTransportLabelsPrintPdf(labelShipment, labelColli, printPath);
    const printDocument = await this.prisma.document.create({
      data: {
        organizationId: shipment.organizationId,
        shipmentId: shipment.id,
        customerId: shipment.customerId,
        type: DocumentType.LABEL,
        fileName: printFileName,
        mimeType: 'application/pdf',
        storagePath: printPath,
        sizeBytes: statSync(printPath).size,
        uploadedById: user.id,
      },
    });
    docs.push(printDocument);

    await this.audit.log(user.id, 'label.generate', 'Shipment', shipment.id, {
      trackingNumber: shipment.trackingNumber,
      colloCount: colli.length,
      documentIds: docs.map((d) => d.id),
      printDocumentId: printDocument.id,
    });

    this.logger.log(`Labels generated for ${shipment.trackingNumber}: ${colli.length} colli`);
    return {
      shipmentId: shipment.id,
      trackingNumber: shipment.trackingNumber,
      colli,
      documents: docs,
      printDocument,
    };
  }

  async listLabels(user: AuthUser, shipmentId: string) {
    await this.getShipment(user, shipmentId);
    return this.prisma.document.findMany({
      where: {
        shipmentId,
        organizationId: user.organizationId,
        type: DocumentType.LABEL,
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  /** Colli anlegen, falls noch keine existieren. */
  async ensureColli(shipment: {
    id: string;
    organizationId: string;
    packageCount: number;
    weightKg?: number | null;
    goodsDescription?: string | null;
    positions?: Array<{
      description: string;
      quantity: number;
      packaging?: string | null;
      weightKg?: number | null;
      lengthCm?: number | null;
      widthCm?: number | null;
      heightCm?: number | null;
      sscc?: string | null;
    }>;
  }) {
    const existing = await this.prisma.shipmentCollo.findMany({
      where: { shipmentId: shipment.id },
      orderBy: { itemNumber: 'asc' },
    });
    if (existing.length) return existing;

    // Positionen mit quantity>1 aufteilen (Gesamtgewicht → Stückgewicht)
    const flat: Array<{
      description: string;
      packaging?: string | null;
      weightKg?: number | null;
      lengthCm?: number | null;
      widthCm?: number | null;
      heightCm?: number | null;
      sscc?: string | null;
    }> = [];
    for (const pos of shipment.positions || []) {
      const qty = Math.max(1, Math.floor(Number(pos.quantity) || 1));
      const total = pos.weightKg != null ? Number(pos.weightKg) : undefined;
      const unit =
        total != null && Number.isFinite(total)
          ? Math.round((total / qty) * 1000) / 1000
          : undefined;
      for (let i = 0; i < qty; i++) {
        flat.push({
          description: pos.description,
          packaging: pos.packaging,
          weightKg: unit,
          lengthCm: pos.lengthCm,
          widthCm: pos.widthCm,
          heightCm: pos.heightCm,
          sscc: i === 0 ? pos.sscc : undefined,
        });
      }
    }

    const count = Math.max(1, flat.length || shipment.packageCount || 1);

    const created = [];
    for (let i = 1; i <= count; i++) {
      const pos = flat[i - 1];
      const sscc = isValidSscc(pos?.sscc)
        ? String(pos!.sscc).replace(/\D/g, '')
        : await this.nextSscc(shipment.organizationId);
      const collo = await this.prisma.shipmentCollo.create({
        data: {
          shipmentId: shipment.id,
          itemNumber: i,
          sscc,
          content: pos?.description || shipment.goodsDescription || undefined,
          packaging: pos?.packaging || undefined,
          quantity: 1,
          weightKg: pos?.weightKg ?? (shipment.weightKg != null ? shipment.weightKg / count : undefined),
          lengthCm: pos?.lengthCm ?? undefined,
          widthCm: pos?.widthCm ?? undefined,
          heightCm: pos?.heightCm ?? undefined,
        },
      });
      created.push(collo);

      if (pos && (!pos.sscc || !isValidSscc(pos.sscc))) {
        const items = await this.prisma.shipmentItem.findMany({
          where: { shipmentId: shipment.id },
          orderBy: { id: 'asc' },
        });
        const item = items[i - 1];
        if (item) {
          await this.prisma.shipmentItem.update({
            where: { id: item.id },
            data: { sscc },
          });
        }
      }
    }
    return created;
  }

  /** Ersetzt Colli-SSCCs ohne gültige GS1-Prüfziffer (z. B. Alt-Import). */
  private async repairInvalidColliSscc(
    organizationId: string,
    colli: Array<{
      id: string;
      shipmentId: string;
      itemNumber: number;
      sscc: string;
      content: string | null;
      packaging?: string | null;
      quantity: number;
      weightKg: number | null;
      lengthCm: number | null;
      widthCm: number | null;
      heightCm: number | null;
      createdAt: Date;
      updatedAt: Date;
    }>,
  ) {
    const out = [];
    for (const collo of colli) {
      if (isValidSscc(collo.sscc)) {
        out.push(collo);
        continue;
      }
      const sscc = await this.nextSscc(organizationId);
      const updated = await this.prisma.shipmentCollo.update({
        where: { id: collo.id },
        data: { sscc },
      });
      const items = await this.prisma.shipmentItem.findMany({
        where: { shipmentId: collo.shipmentId },
        orderBy: { id: 'asc' },
      });
      const item = items[collo.itemNumber - 1];
      if (item) {
        await this.prisma.shipmentItem.update({
          where: { id: item.id },
          data: { sscc },
        });
      }
      this.logger.warn(
        `Ungültige SSCC ${collo.sscc} → ${sscc} (Collo ${collo.itemNumber})`,
      );
      out.push(updated);
    }
    return out;
  }

  private async nextSscc(organizationId: string): Promise<string> {
    const prefix = this.config.get('SSCC_GS1_COMPANY_PREFIX') || '9120101';
    const extension = this.config.get('SSCC_EXTENSION_DIGIT') || '0';

    const serial = await this.prisma.$transaction(async (tx) => {
      const existing = await tx.ssccSequence.findUnique({ where: { organizationId } });
      if (!existing) {
        await tx.ssccSequence.create({ data: { organizationId, nextSerial: 2 } });
        return 1;
      }
      const current = existing.nextSerial;
      await tx.ssccSequence.update({
        where: { organizationId },
        data: { nextSerial: current + 1 },
      });
      return current;
    });

    return buildSscc({ extensionDigit: extension, companyPrefix: prefix, serial });
  }

  private async getShipment(user: AuthUser, shipmentId: string) {
    const shipment = await this.prisma.shipment.findFirst({
      where: {
        id: shipmentId,
        organizationId: user.organizationId,
        ...(user.role === UserRole.CUSTOMER_USER && user.customerId
          ? { customerId: user.customerId }
          : {}),
      },
      include: {
        mandant: true,
        customer: true,
        positions: true,
        order: true,
        colli: { orderBy: { itemNumber: 'asc' } },
      },
    });
    if (!shipment) throw new NotFoundException('Sendung nicht gefunden');
    if (
      (user.role === UserRole.MANDANT_DISPATCHER || user.role === UserRole.PARTNER) &&
      !user.mandantIds.includes(shipment.mandantId)
    ) {
      throw new ForbiddenException();
    }
    return shipment;
  }
}
