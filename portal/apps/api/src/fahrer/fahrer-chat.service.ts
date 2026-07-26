import { BadRequestException, Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { TelematicsOutboundService } from '../integrations/telematics-outbound.service';
import { TourEtaService } from '../integrations/tour-eta.service';
import { DriverAuthUser } from './fahrer.types';
import { SendChatDto } from './dto/chat.dto';

/**
 * Chat-Relay: App ↔ Soloplan.
 * Outbound schreibt StdTelematics Message-XML; Inbound kommt über TelematicsService.
 * Mapping austauschbar (SoloplanChatMapper).
 */
@Injectable()
export class FahrerChatService {
  constructor(
    private prisma: PrismaService,
    private outbound: TelematicsOutboundService,
    private tourEta: TourEtaService,
  ) {}

  async list(driver: DriverAuthUser, since?: string) {
    const sinceDate = since ? new Date(since) : new Date(Date.now() - 7 * 24 * 3600 * 1000);
    return this.prisma.driverChatMessage.findMany({
      where: {
        organizationId: driver.organizationId,
        createdAt: { gt: sinceDate },
        OR: [
          { vehicleId: driver.vehicleId },
          { driverTelematicsId: driver.driverTelematicsId },
        ],
      },
      orderBy: { createdAt: 'asc' },
      take: 200,
    });
  }

  async send(driver: DriverAuthUser, dto: SendChatDto) {
    const text = dto.text.trim();
    if (!text) throw new BadRequestException('Nachricht leer');

    const out = this.outbound.sendMessage({
      vehicleId: driver.vehicleSoloplanId,
      driverId: driver.driverTelematicsId,
      tourNumber: dto.tourNumber,
      text,
    });

    const stored = await this.prisma.driverChatMessage.create({
      data: {
        organizationId: driver.organizationId,
        vehicleId: driver.vehicleId,
        driverId: driver.driverId,
        driverTelematicsId: driver.driverTelematicsId,
        tourNumber: dto.tourNumber,
        direction: 'OUT',
        text,
        soloplanRef: out.fileName,
      },
    });

    // ETA-Chat auch strukturiert für Dispo/Endkunde speichern
    await this.tourEta.ingestFreeText({
      organizationId: driver.organizationId,
      text,
      tourNumber: dto.tourNumber,
      source: 'chat',
    });

    return { message: stored, outbound: out };
  }

  /** Wird vom Telematics-Inbound aufgerufen */
  async ingestInbound(opts: {
    organizationId: string;
    vehicleSoloplanId?: string | null;
    driverTelematicsId?: string | null;
    tourNumber?: string | null;
    text: string;
    sourceFile?: string;
  }) {
    const text = opts.text.trim();
    if (!text) return null;

    let vehicleId: string | undefined;
    if (opts.vehicleSoloplanId) {
      const v = await this.prisma.vehicle.findFirst({
        where: {
          organizationId: opts.organizationId,
          soloplanVehicleId: opts.vehicleSoloplanId,
        },
        select: { id: true },
      });
      vehicleId = v?.id;
    }

    let driverId: string | undefined;
    if (opts.driverTelematicsId) {
      const d = await this.prisma.driver.findFirst({
        where: {
          organizationId: opts.organizationId,
          telematicsId: opts.driverTelematicsId,
        },
        select: { id: true },
      });
      driverId = d?.id;
    }

    return this.prisma.driverChatMessage.create({
      data: {
        organizationId: opts.organizationId,
        vehicleId,
        driverId,
        driverTelematicsId: opts.driverTelematicsId || undefined,
        tourNumber: opts.tourNumber || undefined,
        direction: 'IN',
        text,
        sourceFile: opts.sourceFile,
      },
    });
  }
}
