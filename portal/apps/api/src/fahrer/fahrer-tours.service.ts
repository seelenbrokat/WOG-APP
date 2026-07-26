import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { DriverAuthUser } from './fahrer.types';

/** Für Fahrer unsichtbar (abgeschlossen / Zollfahrt) */
const HIDDEN_TELEMATICS = ['Finished', 'Zollfahrt'];

@Injectable()
export class FahrerToursService {
  constructor(private prisma: PrismaService) {}

  async listTours(driver: DriverAuthUser) {
    const tours = await this.prisma.tour.findMany({
      where: {
        organizationId: driver.organizationId,
        status: { notIn: ['CANCELLED', 'COMPLETED'] },
        AND: [
          {
            OR: [
              { telematicsStatus: null },
              { telematicsStatus: { notIn: HIDDEN_TELEMATICS } },
            ],
          },
          {
            OR: [
              { vehicleId: driver.vehicleId },
              { driverTelematicsId: driver.driverTelematicsId },
            ],
          },
        ],
      },
      include: {
        stops: { orderBy: { sequence: 'asc' }, take: 3 },
        consignments: { take: 5 },
        vehicle: {
          select: {
            id: true,
            soloplanVehicleId: true,
            licensePlate: true,
          },
        },
      },
      orderBy: [{ targetStart: 'desc' }, { updatedAt: 'desc' }],
      take: 40,
    });

    const openTour =
      tours.find((t) => t.telematicsStatus === 'Started' || t.status === 'ACTIVE') ||
      null;

    return {
      openTourNumber: openTour?.tourNumber ?? null,
      tours: tours.map((t) => ({
        id: t.id,
        tourNumber: t.tourNumber,
        caption: t.caption,
        status: t.status,
        telematicsStatus: t.telematicsStatus,
        targetStart: t.targetStart,
        targetEnd: t.targetEnd,
        stopCount: t.stopCount,
        orderCount: t.orderCount,
        driverName: t.driverName,
        infoText: t.infoText,
        vehicle: t.vehicle,
        previewStops: t.stops.map((s) => ({
          id: s.id,
          sequence: s.sequence,
          name: s.name,
          city: s.city,
          stopType: s.stopType,
        })),
      })),
    };
  }

  async getTour(driver: DriverAuthUser, tourNumber: string) {
    const tour = await this.prisma.tour.findFirst({
      where: {
        organizationId: driver.organizationId,
        OR: [{ tourNumber }, { id: tourNumber }],
        AND: [
          {
            OR: [
              { vehicleId: driver.vehicleId },
              { driverTelematicsId: driver.driverTelematicsId },
            ],
          },
        ],
      },
      include: {
        vehicle: true,
        stops: { orderBy: { sequence: 'asc' } },
        consignments: { orderBy: { soloplanOrderNumber: 'asc' } },
      },
    });
    if (!tour) throw new NotFoundException('Tour nicht gefunden');
    return tour;
  }
}
