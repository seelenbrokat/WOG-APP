import {
  BadRequestException,
  Injectable,
  NotFoundException,
  ForbiddenException,
} from '@nestjs/common';
import { randomBytes } from 'crypto';
import { DocumentType, NotificationEvent, Prisma, ShipmentStatus, UserRole } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuthUser } from '../auth/auth.types';
import { mandantFilter, customerFilter, assertMandantAccess } from '../common/access';
import { AuditService } from '../audit/audit.service';
import { NotificationsService } from '../notifications/notifications.service';
import { SoloplanService } from '../integrations/soloplan.service';
import { LabelsService } from '../labels/labels.service';
import { normalizeScanCode, parseSsccFromScan } from '../labels/sscc';
import { formatVlbOrderNumber, nextSeqFromExisting, vlbOrderPrefix } from './order-number';

function trackingNumber() {
  const d = new Date();
  const y = d.getFullYear().toString().slice(-2);
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const rand = randomBytes(3).toString('hex').toUpperCase();
  return `WOG${y}${m}${rand}`;
}

type PositionInput = {
  description: string;
  quantity?: number;
  packaging?: string;
  weightKg?: number;
  lengthCm?: number;
  widthCm?: number;
  heightCm?: number;
  sscc?: string;
};

/**
 * quantity > 1 + Gesamtgewicht → einzelne Colli mit gleichem Stückgewicht.
 * Beispiel: 10× EUP, 2000 kg → 10 Positionen à 200 kg.
 */
export function expandPositionsToColli(positions: PositionInput[]): PositionInput[] {
  const out: PositionInput[] = [];
  for (const p of positions || []) {
    const qty = Math.max(1, Math.floor(Number(p.quantity) || 1));
    const totalWeight = p.weightKg != null ? Number(p.weightKg) : undefined;
    const unitWeight =
      totalWeight != null && Number.isFinite(totalWeight)
        ? Math.round((totalWeight / qty) * 1000) / 1000
        : undefined;
    for (let i = 0; i < qty; i++) {
      out.push({
        description: p.description,
        quantity: 1,
        packaging: p.packaging,
        weightKg: unitWeight,
        lengthCm: p.lengthCm,
        widthCm: p.widthCm,
        heightCm: p.heightCm,
        // SSCC nur auf erstes Collo der Gruppe übernehmen
        sscc: i === 0 ? p.sscc : undefined,
      });
    }
  }
  return out;
}

@Injectable()
export class ShipmentsService {
  constructor(
    private prisma: PrismaService,
    private audit: AuditService,
    private notifications: NotificationsService,
    private soloplan: SoloplanService,
    private labels: LabelsService,
  ) {}

  private scope(user: AuthUser) {
    return {
      organizationId: user.organizationId,
      ...mandantFilter(user),
      ...customerFilter(user),
    };
  }

  list(user: AuthUser, mandantId?: string) {
    const where = this.scope(user);
    if (mandantId) {
      if (user.role === UserRole.MANDANT_DISPATCHER || user.role === UserRole.PARTNER) {
        assertMandantAccess(user, mandantId);
      }
      Object.assign(where, { mandantId });
    }
    return this.prisma.shipment.findMany({
      where,
      include: {
        mandant: true,
        customer: true,
        order: { include: { freightPayer: true } },
        events: { orderBy: { createdAt: 'desc' }, take: 1 },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async get(user: AuthUser, id: string) {
    const shipment = await this.prisma.shipment.findFirst({
      where: { id, ...this.scope(user) },
      include: {
        mandant: true,
        customer: true,
        order: { include: { freightPayer: { include: { contacts: true } } } },
        positions: true,
        colli: { orderBy: { itemNumber: 'asc' } },
        events: { orderBy: { createdAt: 'asc' } },
        documents: { orderBy: { createdAt: 'desc' } },
      },
    });
    if (!shipment) throw new NotFoundException();
    if (
      (user.role === UserRole.MANDANT_DISPATCHER || user.role === UserRole.PARTNER) &&
      !user.mandantIds.includes(shipment.mandantId)
    ) {
      throw new ForbiddenException();
    }
    return shipment;
  }

  /** Lager-Scan: Collo anhand SSCC finden (Organisation / Mandant-Scope). */
  async findBySscc(user: AuthUser, rawSscc: string) {
    if (user.role === UserRole.CUSTOMER_USER) {
      throw new ForbiddenException('Scanning nur für Lager / Disposition');
    }
    // GS1-18 oder Soloplan-Code (z. B. IKU… / Wareneingang)
    const sscc = normalizeScanCode(rawSscc) || parseSsccFromScan(rawSscc);
    if (!sscc) {
      throw new BadRequestException('Ungültige SSCC (GS1-18 oder Soloplan-Code erwartet)');
    }

    const collo = await this.prisma.shipmentCollo.findFirst({
      where: {
        sscc,
        shipment: {
          organizationId: user.organizationId,
          ...mandantFilter(user),
          ...customerFilter(user),
        },
      },
      include: {
        shipment: {
          include: {
            mandant: { select: { id: true, code: true, name: true } },
            customer: { select: { id: true, name: true, customerNumber: true } },
            order: { select: { id: true, externalNumber: true } },
            colli: { orderBy: { itemNumber: 'asc' }, select: { id: true, itemNumber: true, sscc: true } },
          },
        },
      },
    });
    if (!collo) throw new NotFoundException(`Kein Collo mit SSCC ${sscc} gefunden`);

    const shipment = collo.shipment;
    if (
      (user.role === UserRole.MANDANT_DISPATCHER || user.role === UserRole.PARTNER) &&
      !user.mandantIds.includes(shipment.mandantId)
    ) {
      throw new ForbiddenException();
    }

    const isWareneingang =
      /wareneingang/i.test(shipment.goodsDescription || '') ||
      /wareneingang/i.test(shipment.reference || '') ||
      /^2291\b/i.test(shipment.reference || '') ||
      shipment.reference?.includes('2291');

    return {
      sscc,
      scannedAt: new Date().toISOString(),
      collo: {
        id: collo.id,
        itemNumber: collo.itemNumber,
        sscc: collo.sscc,
        content: collo.content,
        packaging: collo.packaging,
        quantity: collo.quantity,
        weightKg: collo.weightKg,
        lengthCm: collo.lengthCm,
        widthCm: collo.widthCm,
        heightCm: collo.heightCm,
      },
      shipment: {
        id: shipment.id,
        trackingNumber: shipment.trackingNumber,
        reference: shipment.reference,
        status: shipment.status,
        goodsDescription: shipment.goodsDescription,
        packageCount: shipment.packageCount,
        weightKg: shipment.weightKg,
        pickupCompany: shipment.pickupCompany,
        pickupCity: shipment.pickupCity,
        pickupZip: shipment.pickupZip,
        deliveryCompany: shipment.deliveryCompany,
        deliveryCity: shipment.deliveryCity,
        deliveryZip: shipment.deliveryZip,
        mandant: shipment.mandant,
        customer: shipment.customer,
        order: shipment.order,
        colloCount: shipment.colli.length,
        isWareneingang: !!isWareneingang,
      },
    };
  }

  /**
   * Labels für Lager-Scanning:
   * - SCAN-TEST-* (Übung)
   * - Auftrag 2291 / Bezeichnung Wareneingang
   */
  async listScanTestLabels(user: AuthUser) {
    if (user.role === UserRole.CUSTOMER_USER) {
      throw new ForbiddenException('Scanning nur für Lager / Disposition');
    }

    const scope = {
      organizationId: user.organizationId,
      ...mandantFilter(user),
      ...customerFilter(user),
    };

    const shipments = await this.prisma.shipment.findMany({
      where: {
        ...scope,
        OR: [
          { reference: { startsWith: 'SCAN-TEST-' } },
          { reference: { startsWith: 'WE-' } },
          { reference: { contains: '2291', mode: 'insensitive' } },
          { reference: { contains: 'Wareneingang', mode: 'insensitive' } },
          { goodsDescription: { contains: 'Wareneingang', mode: 'insensitive' } },
        ],
      },
      select: {
        id: true,
        reference: true,
        trackingNumber: true,
        status: true,
        goodsDescription: true,
        colli: {
          orderBy: { itemNumber: 'asc' },
          select: { id: true, itemNumber: true, sscc: true },
        },
        documents: {
          where: { type: DocumentType.LABEL },
          orderBy: { createdAt: 'asc' },
          select: { id: true, fileName: true, createdAt: true },
        },
      },
      orderBy: [{ reference: 'asc' }, { createdAt: 'desc' }],
      take: 50,
    });

    return shipments.map((s) => {
      const printDocument =
        s.documents.find((d) => d.fileName.startsWith('Etiketten-')) || s.documents[0] || null;
      const isWareneingang =
        /wareneingang/i.test(s.goodsDescription || '') ||
        /wareneingang/i.test(s.reference || '') ||
        (s.reference || '').includes('2291');
      const isTest = (s.reference || '').startsWith('SCAN-TEST-');
      return {
        id: s.id,
        reference: s.reference,
        trackingNumber: s.trackingNumber,
        status: s.status,
        goodsDescription: s.goodsDescription,
        kind: isWareneingang ? 'wareneingang' : isTest ? 'test' : 'other',
        colli: s.colli,
        documents: s.documents,
        printDocument,
      };
    });
  }

  async create(
    user: AuthUser,
    data: {
      mandantId: string;
      orderId?: string;
      customerId?: string;
      reference?: string;
      transportMode?: string;
      goodsDescription?: string;
      packageCount?: number;
      weightKg?: number;
      volumeM3?: number;
      pickupAddressId?: string;
      deliveryAddressId?: string;
      pickupCompany?: string;
      pickupStreet?: string;
      pickupZip?: string;
      pickupCity?: string;
      pickupCountry?: string;
      pickupDate?: string;
      deliveryCompany?: string;
      deliveryStreet?: string;
      deliveryZip?: string;
      deliveryCity?: string;
      deliveryCountry?: string;
      deliveryDate?: string;
      deliveryAvisPhone?: string;
      notes?: string;
      extras?: Record<string, unknown>;
      submit?: boolean;
      savePickupAddress?: boolean;
      saveDeliveryAddress?: boolean;
      saveAsTemplateName?: string;
      positions?: PositionInput[];
    },
  ) {
    const mandant = await this.prisma.mandant.findFirst({
      where: { id: data.mandantId, organizationId: user.organizationId, active: true },
    });
    if (!mandant) throw new NotFoundException('Mandant nicht gefunden');

    const expandedPositions = data.positions?.length
      ? expandPositionsToColli(data.positions)
      : [];

    let customerId = data.customerId;
    if (user.role === UserRole.CUSTOMER_USER) {
      if (!user.customerId) throw new ForbiddenException('Kein Kundenkonto verknüpft');
      customerId = user.customerId;
    }
    if (!customerId) throw new ForbiddenException('customerId erforderlich');

    let pickupCompany = data.pickupCompany;
    let pickupStreet = data.pickupStreet;
    let pickupZip = data.pickupZip;
    let pickupCity = data.pickupCity;
    let pickupCountry = data.pickupCountry || 'AT';
    let deliveryCompany = data.deliveryCompany;
    let deliveryStreet = data.deliveryStreet;
    let deliveryZip = data.deliveryZip;
    let deliveryCity = data.deliveryCity;
    let deliveryCountry = data.deliveryCountry || 'AT';

    if (data.pickupAddressId) {
      const addr = await this.prisma.address.findFirst({
        where: { id: data.pickupAddressId, customerId },
      });
      if (!addr) throw new NotFoundException('Abholadresse nicht gefunden');
      pickupCompany = addr.company || pickupCompany;
      pickupStreet = addr.street;
      pickupZip = addr.zip;
      pickupCity = addr.city;
      pickupCountry = addr.country;
    }
    if (data.deliveryAddressId) {
      const addr = await this.prisma.address.findFirst({
        where: { id: data.deliveryAddressId, customerId },
      });
      if (!addr) throw new NotFoundException('Zustelladresse nicht gefunden');
      deliveryCompany = addr.company || deliveryCompany;
      deliveryStreet = addr.street;
      deliveryZip = addr.zip;
      deliveryCity = addr.city;
      deliveryCountry = addr.country;
    }

    const status = data.submit ? ShipmentStatus.SUBMITTED : ShipmentStatus.DRAFT;

    // Frachtzahler = eingeloggter Kunde; Fallback für Admin ohne Kundenkonto = Sendungskunde
    const freightPayerCustomerId = user.customerId || customerId;

    // 1:1 Auftrag ↔ Sendung: Anhängen weiterer Sendungen ist nicht erlaubt.
    let transportOrder;
    if (data.orderId) {
      transportOrder = await this.prisma.transportOrder.findFirst({
        where: {
          id: data.orderId,
          organizationId: user.organizationId,
          mandantId: data.mandantId,
        },
        include: { _count: { select: { shipments: true } } },
      });
      if (!transportOrder) throw new NotFoundException('Auftrag nicht gefunden');
      if (
        user.role === UserRole.CUSTOMER_USER &&
        user.customerId &&
        transportOrder.freightPayerCustomerId !== user.customerId
      ) {
        throw new ForbiddenException('Auftrag gehört nicht zu Ihrem Kundenkonto');
      }
      if (
        (user.role === UserRole.MANDANT_DISPATCHER || user.role === UserRole.PARTNER) &&
        !user.mandantIds.includes(transportOrder.mandantId)
      ) {
        throw new ForbiddenException();
      }
      if (transportOrder._count.shipments > 0) {
        throw new BadRequestException(
          'Pro Auftrag ist nur eine Sendung erlaubt. Bitte einen neuen Auftrag anlegen.',
        );
      }
    } else {
      transportOrder = await this.createTransportOrder(user, {
        mandantId: data.mandantId,
        freightPayerCustomerId,
      });
    }

    const shipment = await this.prisma.shipment.create({
      data: {
        organizationId: user.organizationId,
        mandantId: data.mandantId,
        customerId,
        orderId: transportOrder.id,
        trackingNumber: trackingNumber(),
        trackingPin: String(Math.floor(1000 + Math.random() * 9000)),
        // Sendungsreferenz optional; Auftragsnummer nur am TransportOrder (VLB…)
        reference: data.reference,
        status,
        transportMode: data.transportMode,
        goodsDescription: data.goodsDescription,
        packageCount: expandedPositions.length || data.packageCount || 1,
        weightKg:
          data.weightKg ??
          (expandedPositions.length
            ? expandedPositions.reduce((sum, p) => sum + (p.weightKg || 0), 0) || undefined
            : undefined),
        volumeM3: data.volumeM3,
        pickupCompany,
        pickupStreet,
        pickupZip,
        pickupCity,
        pickupCountry,
        pickupDate: data.pickupDate ? new Date(data.pickupDate) : undefined,
        deliveryCompany,
        deliveryStreet,
        deliveryZip,
        deliveryCity,
        deliveryCountry,
        deliveryDate: data.deliveryDate ? new Date(data.deliveryDate) : undefined,
        deliveryAvisPhone: data.deliveryAvisPhone?.trim() || undefined,
        notes: data.notes,
        extras:
          data.extras && Object.keys(data.extras).length
            ? (data.extras as Prisma.InputJsonValue)
            : undefined,
        createdById: user.id,
        positions: expandedPositions.length
          ? {
              create: expandedPositions.map((p) => ({
                description: p.description,
                quantity: 1,
                packaging: p.packaging,
                weightKg: p.weightKg,
                lengthCm: p.lengthCm,
                widthCm: p.widthCm,
                heightCm: p.heightCm,
                sscc: p.sscc,
              })),
            }
          : undefined,
        events: {
          create: {
            status,
            message: status === ShipmentStatus.SUBMITTED ? 'Auftrag übermittelt' : 'Entwurf angelegt',
            createdBy: user.id,
          },
        },
      },
      include: {
        mandant: true,
        customer: true,
        order: { include: { freightPayer: true } },
        positions: true,
        events: true,
      },
    });

    if (data.savePickupAddress && pickupStreet && pickupZip && pickupCity) {
      await this.prisma.address.create({
        data: {
          customerId,
          label: pickupCompany || 'Abholung',
          company: pickupCompany,
          street: pickupStreet,
          zip: pickupZip,
          city: pickupCity,
          country: pickupCountry,
          usage: 'PICKUP',
        },
      });
    }
    if (data.saveDeliveryAddress && deliveryStreet && deliveryZip && deliveryCity) {
      await this.prisma.address.create({
        data: {
          customerId,
          label: deliveryCompany || 'Zustellung',
          company: deliveryCompany,
          street: deliveryStreet,
          zip: deliveryZip,
          city: deliveryCity,
          country: deliveryCountry,
          usage: 'DELIVERY',
        },
      });
    }
    if (data.saveAsTemplateName) {
      await this.prisma.shipmentTemplate.create({
        data: {
          customerId,
          name: data.saveAsTemplateName,
          mandantId: data.mandantId,
          reference: data.reference,
          transportMode: data.transportMode,
          goodsDescription: data.goodsDescription,
          packageCount: data.packageCount ?? 1,
          weightKg: data.weightKg,
          pickupAddressId: data.pickupAddressId,
          deliveryAddressId: data.deliveryAddressId,
          pickupCompany,
          pickupStreet,
          pickupZip,
          pickupCity,
          pickupCountry,
          deliveryCompany,
          deliveryStreet,
          deliveryZip,
          deliveryCity,
          deliveryCountry,
          notes: data.notes,
        },
      });
    }

    await this.audit.log(user.id, 'shipment.create', 'Shipment', shipment.id, {
      trackingNumber: shipment.trackingNumber,
      mandantId: shipment.mandantId,
      orderId: transportOrder.id,
      orderExternalNumber: transportOrder.externalNumber,
    });

    // Colli inkl. Abmessungen/SSCC sofort anlegen (nicht erst bei Etikettenerzeugung)
    await this.labels.ensureColli({
      id: shipment.id,
      organizationId: shipment.organizationId,
      packageCount: shipment.packageCount,
      weightKg: shipment.weightKg,
      goodsDescription: shipment.goodsDescription,
      positions: shipment.positions,
    });

    const needsCustomsInvoice = Boolean(
      data.extras && typeof data.extras === 'object' && (data.extras as any).verzollung === true,
    );

    if (status === ShipmentStatus.SUBMITTED) {
      await this.notifications.notifyShipmentUsers(shipment.id, NotificationEvent.SHIPMENT_CREATED, {
        trackingNumber: shipment.trackingNumber,
        mandant: mandant.name,
      });
      // Bei Verzollung erst nach Rechnung (INVOICE) nach Soloplan exportieren
      if (!needsCustomsInvoice) {
        await this.soloplan.exportShipment(shipment.id);
      }
    }

    const created = await this.get(user, shipment.id);
    return {
      ...created,
      pendingSoloplanExport: needsCustomsInvoice && status === ShipmentStatus.SUBMITTED,
      requiresInvoice: needsCustomsInvoice,
    };
  }

  /** Neuer Portal-Auftrag mit externer Nummer VLB{TT}{MM}{#####}. */
  private async createTransportOrder(
    user: AuthUser,
    data: { mandantId: string; freightPayerCustomerId: string },
  ) {
    const now = new Date();
    const prefix = vlbOrderPrefix(now);
    const existing = await this.prisma.transportOrder.findMany({
      where: {
        organizationId: user.organizationId,
        externalNumber: { startsWith: prefix },
      },
      select: { externalNumber: true },
      orderBy: { externalNumber: 'desc' },
      take: 50,
    });
    const seq = nextSeqFromExisting(
      existing.map((e) => e.externalNumber),
      now,
    );
    const externalNumber = formatVlbOrderNumber(seq, now);

    const order = await this.prisma.transportOrder.create({
      data: {
        organizationId: user.organizationId,
        mandantId: data.mandantId,
        freightPayerCustomerId: data.freightPayerCustomerId,
        externalNumber,
        createdById: user.id,
      },
    });

    await this.audit.log(user.id, 'order.create', 'TransportOrder', order.id, {
      externalNumber: order.externalNumber,
      freightPayerCustomerId: data.freightPayerCustomerId,
    });

    return order;
  }

  async updateStatus(user: AuthUser, id: string, status: ShipmentStatus, message?: string, location?: string) {
    const shipment = await this.get(user, id);
    if (user.role === UserRole.CUSTOMER_USER) throw new ForbiddenException();
    assertMandantAccess(user, shipment.mandantId);

    const updated = await this.prisma.shipment.update({
      where: { id },
      data: {
        status,
        events: {
          create: {
            status,
            message: message || `Status: ${status}`,
            location,
            createdBy: user.id,
          },
        },
      },
      include: { events: { orderBy: { createdAt: 'asc' } }, mandant: true, customer: true },
    });

    await this.notifications.notifyShipmentUsers(id, NotificationEvent.STATUS_CHANGED, {
      trackingNumber: updated.trackingNumber,
      status,
      message,
    });

    if (status === ShipmentStatus.DELIVERED) {
      await this.notifications.notifyShipmentUsers(id, NotificationEvent.POD_AVAILABLE, {
        trackingNumber: updated.trackingNumber,
      });
    }

    await this.audit.log(user.id, 'shipment.status', 'Shipment', id, { status, message });
    return updated;
  }
}
