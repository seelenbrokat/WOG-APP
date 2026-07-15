import { Injectable, NotFoundException, ForbiddenException } from '@nestjs/common';
import { randomBytes } from 'crypto';
import { NotificationEvent, ShipmentStatus, UserRole } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuthUser } from '../auth/auth.types';
import { mandantFilter, customerFilter, assertMandantAccess } from '../common/access';
import { AuditService } from '../audit/audit.service';
import { NotificationsService } from '../notifications/notifications.service';
import { SoloplanService } from '../integrations/soloplan.service';

function trackingNumber() {
  const d = new Date();
  const y = d.getFullYear().toString().slice(-2);
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const rand = randomBytes(3).toString('hex').toUpperCase();
  return `WOG${y}${m}${rand}`;
}

@Injectable()
export class ShipmentsService {
  constructor(
    private prisma: PrismaService,
    private audit: AuditService,
    private notifications: NotificationsService,
    private soloplan: SoloplanService,
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
        positions: true,
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

  async create(
    user: AuthUser,
    data: {
      mandantId: string;
      customerId?: string;
      reference?: string;
      transportMode?: string;
      goodsDescription?: string;
      packageCount?: number;
      weightKg?: number;
      volumeM3?: number;
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
      notes?: string;
      submit?: boolean;
      positions?: {
        description: string;
        quantity?: number;
        weightKg?: number;
        lengthCm?: number;
        widthCm?: number;
        heightCm?: number;
        sscc?: string;
      }[];
    },
  ) {
    const mandant = await this.prisma.mandant.findFirst({
      where: { id: data.mandantId, organizationId: user.organizationId, active: true },
    });
    if (!mandant) throw new NotFoundException('Mandant nicht gefunden');

    let customerId = data.customerId;
    if (user.role === UserRole.CUSTOMER_USER) {
      if (!user.customerId) throw new ForbiddenException('Kein Kundenkonto verknüpft');
      customerId = user.customerId;
    }
    if (!customerId) throw new ForbiddenException('customerId erforderlich');

    const status = data.submit ? ShipmentStatus.SUBMITTED : ShipmentStatus.DRAFT;
    const shipment = await this.prisma.shipment.create({
      data: {
        organizationId: user.organizationId,
        mandantId: data.mandantId,
        customerId,
        trackingNumber: trackingNumber(),
        trackingPin: String(Math.floor(1000 + Math.random() * 9000)),
        reference: data.reference,
        status,
        transportMode: data.transportMode,
        goodsDescription: data.goodsDescription,
        packageCount: data.packageCount ?? 1,
        weightKg: data.weightKg,
        volumeM3: data.volumeM3,
        pickupCompany: data.pickupCompany,
        pickupStreet: data.pickupStreet,
        pickupZip: data.pickupZip,
        pickupCity: data.pickupCity,
        pickupCountry: data.pickupCountry || 'AT',
        pickupDate: data.pickupDate ? new Date(data.pickupDate) : undefined,
        deliveryCompany: data.deliveryCompany,
        deliveryStreet: data.deliveryStreet,
        deliveryZip: data.deliveryZip,
        deliveryCity: data.deliveryCity,
        deliveryCountry: data.deliveryCountry || 'AT',
        deliveryDate: data.deliveryDate ? new Date(data.deliveryDate) : undefined,
        notes: data.notes,
        createdById: user.id,
        positions: data.positions?.length
          ? {
              create: data.positions.map((p) => ({
                description: p.description,
                quantity: p.quantity ?? 1,
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
      include: { mandant: true, customer: true, positions: true, events: true },
    });

    await this.audit.log(user.id, 'shipment.create', 'Shipment', shipment.id, {
      trackingNumber: shipment.trackingNumber,
      mandantId: shipment.mandantId,
    });

    if (status === ShipmentStatus.SUBMITTED) {
      await this.notifications.notifyShipmentUsers(shipment.id, NotificationEvent.SHIPMENT_CREATED, {
        trackingNumber: shipment.trackingNumber,
        mandant: mandant.name,
      });
      await this.soloplan.enqueueCreateOrder(shipment.id);
    }

    return shipment;
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
