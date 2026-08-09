import { Injectable, Logger } from '@nestjs/common';
import { ShipmentStatus, UserRole } from '@prisma/client';
import { randomBytes } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';

/**
 * Kunde im Portal = Soloplan-Frachtzahler.
 * Tour-XML: FreightPayer oft leer → dann Customer/Auftraggeber-BP (gleiche Rolle in der Praxis).
 */
@Injectable()
export class EzollFreightPayerService {
  private readonly log = new Logger(EzollFreightPayerService.name);

  constructor(private prisma: PrismaService) {}

  async resolveFreightPayerCustomer(
    organizationId: string,
    orderNumber: number | string,
  ): Promise<{ customerId: string; bpNumber: string; name: string | null } | null> {
    const orderKey = String(orderNumber).trim();
    if (!orderKey) return null;

    const cons = await this.prisma.tourConsignment.findFirst({
      where: { orderNumber: orderKey, tour: { organizationId } },
      select: {
        freightPayerBpNumber: true,
        freightPayerName: true,
        customerBpNumber: true,
        customerName: true,
      },
      orderBy: { id: 'desc' },
    });
    if (!cons) return null;

    const bpNumber = String(cons.freightPayerBpNumber || cons.customerBpNumber || '').trim();
    if (!bpNumber) return null;
    const name = cons.freightPayerName || cons.customerName || null;

    const customer = await this.prisma.customer.findFirst({
      where: {
        organizationId,
        OR: [
          { soloplanBusinessPartnerId: bpNumber },
          { customerNumber: bpNumber },
          { matchcode: bpNumber },
        ],
      },
      select: { id: true, name: true },
    });
    if (!customer) {
      this.log.log(
        `Frachtzahler-BP ${bpNumber} (${name || '–'}) für Order ${orderKey} noch kein Kundenkonto`,
      );
      return null;
    }
    return { customerId: customer.id, bpNumber, name: customer.name };
  }

  /**
   * Minimale Portal-Sendung für Dokumente (Austritt), Kunde = Frachtzahler.
   * Wird angelegt, wenn Tour den Frachtzahler kennt, aber noch kein WE/Shipment da ist.
   */
  async ensureShipmentForOrder(input: {
    organizationId: string;
    orderNumber: number | string;
    customerId: string;
  }): Promise<{ id: string; trackingNumber: string; customerId: string; created: boolean } | null> {
    const orderKey = String(input.orderNumber).trim();
    const existing = await this.prisma.shipment.findFirst({
      where: {
        organizationId: input.organizationId,
        OR: [
          { soloplanRef: { equals: orderKey, mode: 'insensitive' } },
          { reference: { equals: `WE-${orderKey}`, mode: 'insensitive' } },
          { reference: { equals: `EZOLL-${orderKey}`, mode: 'insensitive' } },
          { order: { soloplanRef: { equals: orderKey, mode: 'insensitive' } } },
        ],
      },
      select: { id: true, trackingNumber: true, customerId: true },
      orderBy: { createdAt: 'desc' },
    });
    if (existing?.customerId) {
      return {
        id: existing.id,
        trackingNumber: existing.trackingNumber,
        customerId: existing.customerId,
        created: false,
      };
    }

    const mandant = await this.prisma.mandant.findFirst({
      where: { organizationId: input.organizationId, active: true },
      orderBy: { createdAt: 'asc' },
      select: { id: true },
    });
    if (!mandant) return null;

    const admin = await this.prisma.user.findFirst({
      where: { organizationId: input.organizationId, role: UserRole.ORG_ADMIN },
      select: { id: true },
    });

    const externalNumber = `EZOLL-${orderKey}`;
    let order = await this.prisma.transportOrder.findFirst({
      where: { organizationId: input.organizationId, externalNumber },
      select: { id: true },
    });
    if (!order) {
      order = await this.prisma.transportOrder.create({
        data: {
          organizationId: input.organizationId,
          mandantId: mandant.id,
          freightPayerCustomerId: input.customerId,
          externalNumber,
          soloplanRef: orderKey,
          createdById: admin?.id,
        },
        select: { id: true },
      });
    }

    const d = new Date();
    const track = `WOG${String(d.getFullYear()).slice(-2)}${String(d.getMonth() + 1).padStart(2, '0')}${randomBytes(3).toString('hex').toUpperCase()}`;

    const shipment = await this.prisma.shipment.create({
      data: {
        organizationId: input.organizationId,
        mandantId: mandant.id,
        customerId: input.customerId,
        orderId: order.id,
        trackingNumber: track,
        trackingPin: String(Math.floor(1000 + Math.random() * 9000)),
        reference: `EZOLL-${orderKey}`,
        soloplanRef: orderKey,
        status: ShipmentStatus.SUBMITTED,
        goodsDescription: 'Austrittsbestätigung (eZoll) – Frachtzahler',
        packageCount: 1,
        extras: { ezollDocCarrier: true, soloplanOrderNumber: orderKey },
        createdById: admin?.id,
      },
      select: { id: true, trackingNumber: true, customerId: true },
    });

    this.log.log(
      `Doc-Carrier-Sendung ${shipment.trackingNumber} für Order ${orderKey} (Frachtzahler ${input.customerId})`,
    );
    return {
      id: shipment.id,
      trackingNumber: shipment.trackingNumber,
      customerId: shipment.customerId,
      created: true,
    };
  }
}
