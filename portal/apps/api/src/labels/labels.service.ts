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
import { writeTransportLabelPdf } from './label-pdf';

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
   * Stellt Colli inkl. SSCC sicher (aus packageCount bzw. Positionen)
   * und erzeugt pro Collo ein Transportetikett-PDF (DocumentType.LABEL).
   */
  async generateLabels(user: AuthUser, shipmentId: string) {
    const shipment = await this.getShipment(user, shipmentId);
    const colli = await this.repairInvalidColliSscc(
      shipment.organizationId,
      await this.ensureColli(shipment),
    );
    const docs = [];

    for (const collo of colli) {
      const fileName = `Label-${shipment.trackingNumber}-${collo.itemNumber}-${collo.sscc}.pdf`;
      const storagePath = join(this.uploadDir, fileName);
      await writeTransportLabelPdf(
        {
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
        },
        {
          itemNumber: collo.itemNumber,
          sscc: collo.sscc,
          content: collo.content,
          weightKg: collo.weightKg,
          totalColli: colli.length,
        },
        storagePath,
      );

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

    await this.audit.log(user.id, 'label.generate', 'Shipment', shipment.id, {
      trackingNumber: shipment.trackingNumber,
      colloCount: colli.length,
      documentIds: docs.map((d) => d.id),
    });

    this.logger.log(`Labels generated for ${shipment.trackingNumber}: ${colli.length} colli`);
    return { shipmentId: shipment.id, trackingNumber: shipment.trackingNumber, colli, documents: docs };
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

    const count = Math.max(1, shipment.packageCount || shipment.positions?.length || 1);

    const created = [];
    for (let i = 1; i <= count; i++) {
      const pos = shipment.positions?.[i - 1];
      const sscc = isValidSscc(pos?.sscc)
        ? String(pos!.sscc).replace(/\D/g, '')
        : await this.nextSscc(shipment.organizationId);
      const collo = await this.prisma.shipmentCollo.create({
        data: {
          shipmentId: shipment.id,
          itemNumber: i,
          sscc,
          content: pos?.description || shipment.goodsDescription || undefined,
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
