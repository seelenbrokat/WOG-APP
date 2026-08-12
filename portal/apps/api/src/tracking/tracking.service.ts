import { Injectable, NotFoundException, UnauthorizedException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { TourEtaService } from '../integrations/tour-eta.service';

@Injectable()
export class TrackingService {
  constructor(
    private prisma: PrismaService,
    private tourEta: TourEtaService,
  ) {}

  async track(trackingNumber: string, pin?: string) {
    const shipment = await this.prisma.shipment.findUnique({
      where: { trackingNumber },
      include: {
        mandant: { select: { name: true, code: true } },
        order: { select: { externalNumber: true, soloplanRef: true } },
        events: { orderBy: { createdAt: 'asc' } },
        documents: {
          where: { type: { in: ['POD', 'ABLIEFERBELEG'] } },
          select: { id: true, type: true, fileName: true, createdAt: true },
        },
      },
    });
    if (!shipment) throw new NotFoundException('Sendung nicht gefunden');

    // PIN ist Pflicht, sobald eine hinterlegt ist – ohne PIN keine Status-/Adressdaten.
    if (shipment.trackingPin) {
      const provided = String(pin || '').trim();
      if (!provided) {
        throw new UnauthorizedException('PIN erforderlich');
      }
      if (provided !== shipment.trackingPin) {
        throw new UnauthorizedException('PIN ungültig');
      }
    }

    const eta = await this.tourEta.findEtaForShipment({
      organizationId: shipment.organizationId,
      soloplanRef: shipment.soloplanRef || shipment.order?.soloplanRef,
      trackingNumber: shipment.trackingNumber,
      reference: shipment.reference,
      orderExternalNumber: shipment.order?.externalNumber,
    });

    return {
      trackingNumber: shipment.trackingNumber,
      status: shipment.status,
      reference: shipment.reference,
      mandant: shipment.mandant,
      pickupCity: shipment.pickupCity,
      deliveryCity: shipment.deliveryCity,
      deliveryCompany: shipment.deliveryCompany,
      packageCount: shipment.packageCount,
      eta,
      events: shipment.events.map((e) => ({
        status: e.status,
        message: e.message,
        location: e.location,
        createdAt: e.createdAt,
      })),
      documents: shipment.documents,
      pinRequired: false,
    };
  }
}
