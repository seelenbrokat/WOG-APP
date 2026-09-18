import { Injectable, Logger } from '@nestjs/common';
import { ShipmentStatus, UserRole } from '@prisma/client';
import { randomBytes } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { EzollSoloplanReadApiService } from './ezoll-soloplan-read-api.service';

/**
 * Kunde im Portal = Soloplan-Frachtzahler.
 * Quellen (ohne Soloplan-REST-API): 1) Wareneingang-/Portal-Sendung 2) TourConsignment.
 */
@Injectable()
export class EzollFreightPayerService {
  private readonly log = new Logger(EzollFreightPayerService.name);

  constructor(
    private prisma: PrismaService,
    /** Behalten für DI/Module – Frachtzahler nutzt die API nicht mehr. */
    private readonly _ezollApi: EzollSoloplanReadApiService,
  ) {}

  async resolveFreightPayerCustomer(
    organizationId: string,
    orderNumber: number | string,
  ): Promise<{ customerId: string; bpNumber: string; name: string | null } | null> {
    const orderKey = String(orderNumber).trim();
    if (!orderKey || orderKey === '0') return null;

    // 1) Wareneingang / Portal-Sendung (Kunde = Frachtzahler)
    const shipment = await this.prisma.shipment.findFirst({
      where: {
        organizationId,
        OR: [
          { soloplanRef: { equals: orderKey, mode: 'insensitive' } },
          { reference: { equals: `WE-${orderKey}`, mode: 'insensitive' } },
          { order: { soloplanRef: { equals: orderKey, mode: 'insensitive' } } },
        ],
      },
      select: {
        customerId: true,
        customer: {
          select: {
            id: true,
            name: true,
            soloplanBusinessPartnerId: true,
            customerNumber: true,
            matchcode: true,
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    });
    if (shipment?.customerId && shipment.customer) {
      const bp =
        shipment.customer.soloplanBusinessPartnerId ||
        shipment.customer.customerNumber ||
        shipment.customer.matchcode ||
        '';
      this.log.debug(
        `Frachtzahler Order ${orderKey} via Wareneingang/Sendung: ${shipment.customer.name || shipment.customerId}`,
      );
      return {
        customerId: shipment.customerId,
        bpNumber: String(bp),
        name: shipment.customer.name,
      };
    }

    // 2) TourConsignment (Soloplan-Tour-File)
    let bpNumber = '';
    let name: string | null = null;

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
    if (cons) {
      bpNumber = String(cons.freightPayerBpNumber || cons.customerBpNumber || '').trim();
      name = cons.freightPayerName || cons.customerName || null;
    }

    // Keine OrderEzoll_NurLesen-API mehr – blockiert Worker bei HTTP 500 und liefert
    // nichts, was der Wareneingang nicht ohnehin liefern soll.

    if (!bpNumber) return null;

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
