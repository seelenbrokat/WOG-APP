import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { formatSendungsnummer } from '../integrations/tour-xml.parser';
import { DriverAuthUser } from './fahrer.types';

/** Für Fahrer unsichtbar (abgeschlossen / Zollfahrt) */
const HIDDEN_TELEMATICS = ['Finished', 'Zollfahrt'];

type JsonRec = Record<string, unknown>;

function asRec(v: unknown): JsonRec | null {
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as JsonRec) : null;
}

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
        consignments: {
          take: 8,
          orderBy: { soloplanOrderNumber: 'asc' },
          select: {
            id: true,
            soloplanOrderNumber: true,
            orderNumber: true,
            consignmentIndex: true,
            externalConsignmentNumber: true,
            receiverName: true,
            senderName: true,
            status: true,
            details: true,
          },
        },
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
      tours.find((t) => t.telematicsStatus === 'Started' || t.status === 'ACTIVE') || null;

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
          street: s.street,
          zip: s.zip,
          country: s.country,
          stopType: s.stopType,
          targetStart: s.targetStart,
          targetEnd: s.targetEnd,
          transportOrderNumber: s.transportOrderNumber,
        })),
        previewConsignments: t.consignments.map((c) => {
          const details = asRec(c.details);
          const receiver = asRec(details?.receiver);
          const receiverAddress = asRec(receiver?.address);
          return {
            id: c.id,
            soloplanOrderNumber: c.soloplanOrderNumber,
            sendungsnummer: formatSendungsnummer(c),
            receiverName: c.receiverName,
            senderName: c.senderName,
            status: c.status,
            receiverCity: (receiverAddress?.city as string) || null,
          };
        }),
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
        documents: {
          orderBy: { createdAt: 'desc' },
          take: 100,
          select: {
            id: true,
            fileName: true,
            mimeType: true,
            transportOrderNumber: true,
            sizeBytes: true,
            createdAt: true,
          },
        },
      },
    });
    if (!tour) throw new NotFoundException('Tour nicht gefunden');

    const consignmentsByTo = new Map(
      tour.consignments.map((c) => [c.soloplanOrderNumber, c] as const),
    );

    return {
      id: tour.id,
      tourNumber: tour.tourNumber,
      soloplanTourId: tour.soloplanTourId,
      caption: tour.caption,
      infoText: tour.infoText,
      status: tour.status,
      telematicsStatus: tour.telematicsStatus,
      lastStatusAt: tour.lastStatusAt,
      lastLatitude: tour.lastLatitude,
      lastLongitude: tour.lastLongitude,
      targetStart: tour.targetStart,
      targetEnd: tour.targetEnd,
      targetLoadKm: tour.targetLoadKm,
      stopCount: tour.stopCount,
      orderCount: tour.orderCount,
      driver: {
        name: tour.driverName,
        firstName: tour.driverFirstName,
        lastName: tour.driverLastName,
        telematicsId: tour.driverTelematicsId,
      },
      dispatcher: {
        name: tour.dispatcherName,
        email: tour.dispatcherEmail,
        phone: tour.dispatcherPhone,
      },
      vehicle: tour.vehicle
        ? {
            id: tour.vehicle.id,
            soloplanVehicleId: tour.vehicle.soloplanVehicleId,
            licensePlate: tour.vehicle.licensePlate,
            number: tour.vehicle.number,
            matchcode: tour.vehicle.matchcode,
          }
        : null,
      stops: tour.stops.map((s) => {
        const details = asRec(s.details) || {};
        const consignment = s.transportOrderNumber
          ? consignmentsByTo.get(s.transportOrderNumber)
          : undefined;
        return {
          id: s.id,
          soloplanTourStopId: s.soloplanTourStopId,
          sequence: s.sequence,
          stopType: s.stopType,
          transportOrderNumber: s.transportOrderNumber,
          name: s.name,
          name2: (details.name2 as string) || null,
          address: {
            street: s.street,
            zip: s.zip,
            city: s.city,
            city2: (details.city2 as string) || null,
            country: s.country,
          },
          street: s.street,
          zip: s.zip,
          city: s.city,
          country: s.country,
          geo: {
            latitude: s.latitude,
            longitude: s.longitude,
          },
          latitude: s.latitude,
          longitude: s.longitude,
          window: {
            targetStart: s.targetStart,
            targetEnd: s.targetEnd,
          },
          targetStart: s.targetStart,
          targetEnd: s.targetEnd,
          activityDescription: s.activityDescription,
          activityDescription2: (details.activityDescription2 as string) || null,
          phone: s.phone,
          remarksLines: Array.isArray(details.remarksLines)
            ? (details.remarksLines as string[])
            : [],
          details,
          sendungsnummer: consignment ? formatSendungsnummer(consignment) : null,
        };
      }),
      consignments: tour.consignments.map((c) => {
        const details = asRec(c.details) || {};
        const sender = asRec(details.sender);
        const receiver = asRec(details.receiver);
        const customer = asRec(details.customer);
        const freightPayer = asRec(details.freightPayer);
        const freight = asRec(details.freight);
        const planned = asRec(details.planned);
        const remarks = asRec(details.remarks);
        const items = Array.isArray(details.items) ? details.items : [];
        const ssccs = items.flatMap((item) => {
          const rec = asRec(item);
          const list = rec?.ssccs;
          return Array.isArray(list) ? (list as string[]) : [];
        });

        return {
          id: c.id,
          soloplanOrderNumber: c.soloplanOrderNumber,
          orderNumber: c.orderNumber,
          consignmentIndex: c.consignmentIndex,
          externalConsignmentNumber: c.externalConsignmentNumber,
          externalOrderNumber: (details.externalOrderNumber as string) || null,
          sendungsnummer: formatSendungsnummer(c),
          senderName: c.senderName,
          senderBpNumber: c.senderBpNumber,
          receiverName: c.receiverName,
          customerName: c.customerName,
          customerBpNumber: c.customerBpNumber,
          freightPayerName: c.freightPayerName,
          freightPayerBpNumber: c.freightPayerBpNumber,
          status: c.status,
          statusText: c.statusText,
          lastStatusAt: c.lastStatusAt,
          lastLatitude: c.lastLatitude,
          lastLongitude: c.lastLongitude,
          loadingUnits: c.loadingUnits,
          sender,
          receiver,
          customer,
          freightPayer,
          differentLoadingPoint: asRec(details.differentLoadingPoint),
          differentUnloadingPoint: asRec(details.differentUnloadingPoint),
          freight,
          planned,
          remarks,
          references: Array.isArray(details.references) ? details.references : [],
          items,
          ssccs,
          checkFields: Array.isArray(details.checkFields) ? details.checkFields : [],
          /** Rohdaten aus Soloplan-Import – alle verfügbaren Felder */
          details,
        };
      }),
      documents: tour.documents,
    };
  }
}
