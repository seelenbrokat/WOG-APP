import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
} from '@nestjs/common';
import { TelematicsOutboundService } from '../integrations/telematics-outbound.service';
import { PrismaService } from '../prisma/prisma.service';
import { DriverAuthUser } from './fahrer.types';
import { FahrerSmartborderService } from './fahrer-smartborder.service';
import {
  DocumentDto,
  SsccStatusDto,
  TourStatusDto,
  TourStopStatusDto,
  TransportOrderStatusDto,
  VehicleLocationDto,
} from './dto/telematics.dto';

/** Endstatus einer Sendung – nur noch Admin/Dispo darf ändern */
const DRIVER_LOCKED_TO_STATUSES = new Set([
  'UnloadingFinished',
  'UnloadingPlaceLeft',
]);

/** Touren, die für den Fahrer aus der Liste verschwinden */
const HIDDEN_TOUR_TELEMATICS = new Set(['Finished', 'Zollfahrt']);

@Injectable()
export class FahrerTelematicsService {
  private readonly log = new Logger(FahrerTelematicsService.name);

  constructor(
    private outbound: TelematicsOutboundService,
    private prisma: PrismaService,
    private smartborder: FahrerSmartborderService,
  ) {}

  private loc(dto?: { latitude: number; longitude: number; information?: string }) {
    if (!dto) return undefined;
    return {
      latitude: dto.latitude,
      longitude: dto.longitude,
      information: dto.information,
      at: new Date(),
    };
  }

  private async assertConsignmentEditable(
    driver: DriverAuthUser,
    transportOrderNumber: string,
  ) {
    const existing = await this.prisma.tourConsignment.findFirst({
      where: {
        soloplanOrderNumber: transportOrderNumber,
        tour: { organizationId: driver.organizationId },
      },
      select: { status: true, statusText: true },
      orderBy: { lastStatusAt: 'desc' },
    });
    if (existing?.status && DRIVER_LOCKED_TO_STATUSES.has(existing.status)) {
      throw new ForbiddenException(
        `Sendung ${transportOrderNumber} ist bereits „${existing.statusText || existing.status}“. Statusänderung nur noch durch Admin/Dispo.`,
      );
    }
  }

  private async assertCanStartTour(driver: DriverAuthUser, tourNumber: string) {
    const open = await this.prisma.tour.findFirst({
      where: {
        organizationId: driver.organizationId,
        tourNumber: { not: tourNumber },
        OR: [
          { vehicleId: driver.vehicleId },
          { driverTelematicsId: driver.driverTelematicsId },
        ],
        AND: [
          {
            OR: [{ status: 'ACTIVE' }, { telematicsStatus: 'Started' }],
          },
        ],
      },
      select: { tourNumber: true },
    });
    if (open) {
      throw new ForbiddenException(
        `Tour ${open.tourNumber} ist noch offen. Bitte zuerst beenden oder als Zollfahrt markieren.`,
      );
    }
  }

  async sendTourStatus(driver: DriverAuthUser, dto: TourStatusDto) {
    const isZollfahrt = dto.status === 'Zollfahrt';
    const outboundStatus = isZollfahrt ? 'Finished' : dto.status;
    const statusText = isZollfahrt
      ? dto.statusText || 'Zollfahrt'
      : dto.statusText;

    if (dto.status === 'Started') {
      await this.assertCanStartTour(driver, dto.tourNumber);
    }

    if (
      !['Started', 'Finished', 'Zollfahrt', 'TourBreak', 'TourBreakEnd'].includes(
        dto.status,
      )
    ) {
      throw new BadRequestException(`Ungültiger Tour-Status: ${dto.status}`);
    }

    const result = this.outbound.sendTourStatus({
      vehicleId: driver.vehicleSoloplanId,
      driverId: driver.driverTelematicsId,
      tourNumber: dto.tourNumber,
      status: outboundStatus,
      statusText,
      location: this.loc(dto.location),
    });

    const telematicsStatus = isZollfahrt ? 'Zollfahrt' : dto.status;
    const completed = HIDDEN_TOUR_TELEMATICS.has(telematicsStatus);

    await this.prisma.tour.updateMany({
      where: {
        organizationId: driver.organizationId,
        tourNumber: dto.tourNumber,
      },
      data: {
        telematicsStatus,
        lastStatusAt: new Date(),
        ...(completed ? { status: 'COMPLETED' } : {}),
        ...(dto.status === 'Started' ? { status: 'ACTIVE' } : {}),
        ...(dto.location
          ? {
              lastLatitude: dto.location.latitude,
              lastLongitude: dto.location.longitude,
            }
          : {}),
      },
    });

    return result;
  }

  async sendTourStopStatus(driver: DriverAuthUser, dto: TourStopStatusDto) {
    return this.outbound.sendTourStopStatus({
      vehicleId: driver.vehicleSoloplanId,
      driverId: driver.driverTelematicsId,
      tourNumber: dto.tourNumber,
      tourStopId: dto.tourStopId,
      status: dto.status,
      statusText: dto.statusText,
      location: this.loc(dto.location),
      loadingUnitExchanges: dto.loadingUnitExchanges,
    });
  }

  async sendTransportOrderStatus(driver: DriverAuthUser, dto: TransportOrderStatusDto) {
    await this.assertConsignmentEditable(driver, dto.transportOrderNumber);

    const result = this.outbound.sendTransportOrderStatus({
      vehicleId: driver.vehicleSoloplanId,
      driverId: driver.driverTelematicsId,
      transportOrderNumber: dto.transportOrderNumber,
      status: dto.status,
      statusText: dto.statusText,
      location: this.loc(dto.location),
    });

    await this.prisma.tourConsignment.updateMany({
      where: {
        soloplanOrderNumber: dto.transportOrderNumber,
        tour: { organizationId: driver.organizationId },
      },
      data: {
        status: dto.status,
        statusText: dto.statusText || null,
        lastStatusAt: new Date(),
        ...(dto.location
          ? {
              lastLatitude: dto.location.latitude,
              lastLongitude: dto.location.longitude,
            }
          : {}),
      },
    });

    return result;
  }

  async sendDocument(driver: DriverAuthUser, dto: DocumentDto) {
    return this.outbound.sendDocument({
      vehicleId: driver.vehicleSoloplanId,
      tourNumber: dto.tourNumber,
      transportOrderNumber: dto.transportOrderNumber,
      tourStopId: dto.tourStopId,
      fileName: dto.fileName,
      contentBase64: dto.contentBase64,
      fileSignature: dto.fileSignature,
    });
  }

  async sendSsccStatus(driver: DriverAuthUser, dto: SsccStatusDto) {
    return this.outbound.sendSsccStatus({
      transportOrderNumber: dto.transportOrderNumber,
      tourNumber: dto.tourNumber,
      ssccs: dto.ssccs.map((s) => ({
        code: s.code,
        status: s.status,
        comment: s.comment,
        scanPoint: s.scanPoint,
        statusTimestamp: new Date(),
      })),
    });
  }

  async sendLocation(driver: DriverAuthUser, dto: VehicleLocationDto) {
    const result = this.outbound.sendVehicleLocations({
      vehicleId: driver.vehicleSoloplanId,
      driverId: driver.driverTelematicsId,
      tourNumber: dto.tourNumber,
      locations: [
        {
          latitude: dto.location.latitude,
          longitude: dto.location.longitude,
          information: dto.location.information,
          at: new Date(),
        },
      ],
    });

    await this.prisma.vehicle.update({
      where: { id: driver.vehicleId },
      data: {
        lastLatitude: dto.location.latitude,
        lastLongitude: dto.location.longitude,
        lastLocationAt: new Date(),
      },
    });

    // Bei offener Verzollung GPS auch an SmartBorder (Warenort-Geofence)
    try {
      const sb = await this.smartborder.forwardLocation(driver, {
        latitude: dto.location.latitude,
        longitude: dto.location.longitude,
      });
      if (sb.forwarded > 0) {
        this.log.debug(
          `SmartBorder location forwarded ×${sb.forwarded} for ${driver.licensePlate}`,
        );
      }
    } catch (e: any) {
      this.log.warn(`SmartBorder location forward failed: ${e?.message || e}`);
    }

    return result;
  }
}
