import { Injectable, Logger, NotFoundException, StreamableFile } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  createReadStream,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  statSync,
  writeFileSync,
} from 'fs';
import { basename, join } from 'path';
import { UserRole } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuthUser } from '../auth/auth.types';
import {
  detectTelematicsKind,
  mimeFromFileName,
  parseTelematicsXml,
} from './telematics-xml.parser';
import {
  deliveryStatusFromEvents,
  isSignatureDocumentName,
  mapTelematicsStatusLabel,
  writeZustellnachweisPdf,
} from './zustellnachweis-pdf';

const TOUR_STATUS_MAP: Record<string, string> = {
  Started: 'ACTIVE',
  Finished: 'COMPLETED',
};

@Injectable()
export class TelematicsService {
  private readonly logger = new Logger(TelematicsService.name);
  private inboundDirs: string[];
  private uploadDir: string;

  constructor(
    private prisma: PrismaService,
    private config: ConfigService,
  ) {
    const sftpInbound =
      this.config.get('SFTP_INBOUND_DIR') || join(process.cwd(), '../../data/sftp/inbound');
    this.inboundDirs = [
      join(sftpInbound, 'soloplan', 'tours'),
      join(sftpInbound, 'soloplan', 'business-partners'),
      // Intouch Retour/Telematics (Status, GPS, POD)
      join(sftpInbound, 'intouch', 'dokumente'),
    ];
    this.uploadDir =
      this.config.get('UPLOAD_DIR') || join(process.cwd(), '../../data/uploads');
    const telematicsDir = join(this.uploadDir, 'telematics');
    if (!existsSync(telematicsDir)) mkdirSync(telematicsDir, { recursive: true });
  }

  async processInboundDir(organizationId?: string, limit = 120) {
    const org =
      (organizationId
        ? await this.prisma.organization.findUnique({ where: { id: organizationId } })
        : null) ||
      (await this.prisma.organization.findFirst({ where: { slug: 'wog' } }));
    if (!org) {
      return { processed: 0, tourStatus: 0, orderStatus: 0, locations: 0, documents: 0, failed: 0 };
    }

    const counts = {
      processed: 0,
      tourStatus: 0,
      orderStatus: 0,
      locations: 0,
      documents: 0,
      failed: 0,
    };

    const files: Array<{ dir: string; fileName: string; kind: string }> = [];
    for (const dir of this.inboundDirs) {
      if (!existsSync(dir)) continue;
      for (const fileName of readdirSync(dir)) {
        const kind = detectTelematicsKind(fileName);
        if (!kind || !fileName.toLowerCase().endsWith('.xml')) continue;
        files.push({ dir, fileName, kind });
      }
    }

    // Priorität: Status zuerst, dann Positionen, dann große Dokumente
    const rank: Record<string, number> = {
      TourStatus: 0,
      TransportOrderStatus: 1,
      VehicleLocations: 2,
      Document: 3,
    };
    files.sort((a, b) => rank[a.kind] - rank[b.kind] || a.fileName.localeCompare(b.fileName));

    let remaining = limit;
    for (const { dir, fileName, kind } of files) {
      if (remaining <= 0) break;
      // Dokumente sind groß – pro Tick weniger
      if (kind === 'Document' && counts.documents >= 15) continue;

      const processedDir = join(dir, 'processed');
      if (!existsSync(processedDir)) mkdirSync(processedDir, { recursive: true });
      const full = join(dir, fileName);

      try {
        const already = await this.prisma.telematicsEvent.findFirst({
          where: { organizationId: org.id, sourceFile: fileName },
          select: { id: true },
        });
        const alreadyDoc =
          kind === 'Document'
            ? await this.prisma.tourDocument.findFirst({
                where: { organizationId: org.id, sourceFile: fileName },
                select: { id: true },
              })
            : null;
        if (already || alreadyDoc) {
          renameSync(full, join(processedDir, `${Date.now()}_${fileName}`));
          continue;
        }

        const xml = readFileSync(full, 'utf8');
        const result = await this.importXml(org.id, xml, fileName);
        counts.processed += 1;
        remaining -= 1;
        if (result.kind === 'TourStatus') counts.tourStatus += 1;
        else if (result.kind === 'TransportOrderStatus') counts.orderStatus += 1;
        else if (result.kind === 'VehicleLocations') counts.locations += 1;
        else if (result.kind === 'Document') counts.documents += 1;
        renameSync(full, join(processedDir, `${Date.now()}_${fileName}`));
      } catch (err: any) {
        counts.failed += 1;
        this.logger.error(`Telematics import failed ${fileName}`, err?.message || err);
      }
    }

    if (counts.processed) {
      this.logger.log(
        `Telematics: ${counts.processed} Dateien (Tour=${counts.tourStatus}, TO=${counts.orderStatus}, Loc=${counts.locations}, Doc=${counts.documents}, fail=${counts.failed})`,
      );
    }
    return counts;
  }

  async importXml(organizationId: string, xml: string, fileName?: string) {
    const parsed = parseTelematicsXml(xml, fileName);
    if (!parsed) throw new Error('Ungültiges Telematics-XML');

    if (parsed.kind === 'TourStatus') {
      const vehicle = parsed.vehicleId
        ? await this.resolveVehicle(organizationId, parsed.vehicleId, parsed.driverId)
        : null;
      const tour = await this.resolveTour(organizationId, parsed.tourNumber);
      const eventAt = parsed.statusDate || parsed.sendDate || new Date();
      const mapped = TOUR_STATUS_MAP[parsed.status];

      if (tour) {
        await this.prisma.tour.update({
          where: { id: tour.id },
          data: {
            telematicsStatus: parsed.status,
            lastStatusAt: eventAt,
            lastLatitude: parsed.location?.latitude,
            lastLongitude: parsed.location?.longitude,
            ...(mapped ? { status: mapped } : {}),
            ...(vehicle ? { vehicleId: vehicle.id } : {}),
          },
        });
      }

      if (vehicle && parsed.location) {
        await this.updateVehicleLocation(
          vehicle.id,
          parsed.location.latitude,
          parsed.location.longitude,
          parsed.location.locationAt || eventAt,
          parsed.driverId,
        );
      }

      await this.prisma.telematicsEvent.create({
        data: {
          organizationId,
          kind: 'TourStatus',
          vehicleId: vehicle?.id,
          tourId: tour?.id,
          tourNumber: parsed.tourNumber,
          status: parsed.status,
          statusText: parsed.statusText,
          latitude: parsed.location?.latitude,
          longitude: parsed.location?.longitude,
          eventAt,
          sendDate: parsed.sendDate,
          sourceFile: fileName,
        },
      });
      return parsed;
    }

    if (parsed.kind === 'TransportOrderStatus') {
      const vehicle = parsed.vehicleId
        ? await this.resolveVehicle(organizationId, parsed.vehicleId, parsed.driverId)
        : null;
      const consignments = await this.prisma.tourConsignment.findMany({
        where: {
          soloplanOrderNumber: parsed.transportOrderNumber,
          tour: { organizationId },
        },
        include: { tour: true },
        take: 8,
      });
      consignments.sort(
        (a, b) => (b.tour.updatedAt?.getTime() || 0) - (a.tour.updatedAt?.getTime() || 0),
      );
      const primary = consignments[0];
      const eventAt = parsed.statusDate || parsed.sendDate || new Date();

      for (const c of consignments) {
        await this.prisma.tourConsignment.update({
          where: { id: c.id },
          data: {
            status: parsed.status,
            statusText: parsed.statusText,
            lastStatusAt: eventAt,
            lastLatitude: parsed.location?.latitude,
            lastLongitude: parsed.location?.longitude,
          },
        });
      }

      if (vehicle && parsed.location) {
        await this.updateVehicleLocation(
          vehicle.id,
          parsed.location.latitude,
          parsed.location.longitude,
          parsed.location.locationAt || eventAt,
          parsed.driverId,
        );
      }

      await this.prisma.telematicsEvent.create({
        data: {
          organizationId,
          kind: 'TransportOrderStatus',
          vehicleId: vehicle?.id,
          tourId: primary?.tourId,
          tourNumber: primary?.tour.tourNumber,
          transportOrderNumber: parsed.transportOrderNumber,
          status: parsed.status,
          statusText: parsed.statusText,
          latitude: parsed.location?.latitude,
          longitude: parsed.location?.longitude,
          eventAt,
          sendDate: parsed.sendDate,
          sourceFile: fileName,
        },
      });
      return parsed;
    }

    if (parsed.kind === 'VehicleLocations') {
      const vehicle = await this.resolveVehicle(
        organizationId,
        parsed.vehicleId,
        parsed.driverId,
      );
      const latest = [...parsed.locations].sort((a, b) => {
        const ta = a.locationAt?.getTime() || 0;
        const tb = b.locationAt?.getTime() || 0;
        return tb - ta;
      })[0];

      if (latest) {
        await this.updateVehicleLocation(
          vehicle.id,
          latest.latitude,
          latest.longitude,
          latest.locationAt || new Date(),
          parsed.driverId,
        );
      }

      // Ein Event pro Datei (letzte Position)
      await this.prisma.telematicsEvent.create({
        data: {
          organizationId,
          kind: 'VehicleLocations',
          vehicleId: vehicle.id,
          latitude: latest?.latitude,
          longitude: latest?.longitude,
          eventAt: latest?.locationAt || new Date(),
          sourceFile: fileName,
        },
      });
      return parsed;
    }

    // Document
    const buffer = Buffer.from(parsed.contentBase64.replace(/\s/g, ''), 'base64');
    const safe = `${Date.now()}_${parsed.fileName.replace(/[^a-zA-Z0-9._-]/g, '_')}`;
    const storagePath = join(this.uploadDir, 'telematics', safe);
    writeFileSync(storagePath, buffer);
    const tour = parsed.tourNumber
      ? await this.resolveTour(organizationId, parsed.tourNumber)
      : null;

    await this.prisma.tourDocument.create({
      data: {
        organizationId,
        tourId: tour?.id,
        tourNumber: parsed.tourNumber,
        transportOrderNumber: parsed.transportOrderNumber,
        vehicleSoloplanId: parsed.vehicleId,
        fileName: parsed.fileName,
        mimeType: mimeFromFileName(parsed.fileName),
        storagePath,
        sizeBytes: buffer.length,
        sourceFile: fileName,
      },
    });

    await this.prisma.telematicsEvent.create({
      data: {
        organizationId,
        kind: 'Document',
        tourId: tour?.id,
        tourNumber: parsed.tourNumber,
        transportOrderNumber: parsed.transportOrderNumber,
        status: 'DocumentReceived',
        statusText: parsed.fileName,
        eventAt: new Date(),
        sourceFile: fileName,
      },
    });
    return parsed;
  }

  private async updateVehicleLocation(
    vehicleId: string,
    latitude: number,
    longitude: number,
    at: Date,
    driverId?: string,
  ) {
    const current = await this.prisma.vehicle.findUnique({ where: { id: vehicleId } });
    if (current?.lastLocationAt && current.lastLocationAt > at) return;
    await this.prisma.vehicle.update({
      where: { id: vehicleId },
      data: {
        lastLatitude: latitude,
        lastLongitude: longitude,
        lastLocationAt: at,
        lastDriverId: driverId || undefined,
        active: true,
      },
    });
  }

  private async resolveVehicle(organizationId: string, soloplanId: string, driverId?: string) {
    const existing = await this.prisma.vehicle.findFirst({
      where: {
        organizationId,
        OR: [{ soloplanVehicleId: soloplanId }, { number: soloplanId }],
      },
    });
    if (existing) {
      if (driverId && !existing.lastDriverId) {
        await this.prisma.vehicle.update({
          where: { id: existing.id },
          data: { lastDriverId: driverId },
        });
      }
      return existing;
    }
    return this.prisma.vehicle.create({
      data: {
        organizationId,
        soloplanVehicleId: soloplanId,
        number: soloplanId,
        lastDriverId: driverId,
      },
    });
  }

  private async resolveTour(organizationId: string, tourNumber: string) {
    return this.prisma.tour.findFirst({
      where: { organizationId, tourNumber },
      orderBy: [{ updatedAt: 'desc' }],
    });
  }

  async fleetMap(user: AuthUser, opts?: { mandantId?: string }) {
    if (user.role === UserRole.CUSTOMER_USER) throw new NotFoundException();
    const vehicles = await this.prisma.vehicle.findMany({
      where: {
        organizationId: user.organizationId,
        active: true,
        lastLatitude: { not: null },
        lastLongitude: { not: null },
        ...(opts?.mandantId ? { mandantId: opts.mandantId } : {}),
      },
      include: {
        mandant: { select: { id: true, code: true, name: true } },
        tours: {
          where: {
            status: { in: ['PLANNED', 'ACTIVE'] },
            ...(opts?.mandantId ? { mandantId: opts.mandantId } : {}),
          },
          orderBy: [{ lastStatusAt: 'desc' }, { targetStart: 'desc' }],
          take: 1,
          select: {
            id: true,
            tourNumber: true,
            status: true,
            telematicsStatus: true,
            driverName: true,
            targetStart: true,
          },
        },
      },
      orderBy: { lastLocationAt: 'desc' },
      take: 200,
    });

    return vehicles.map((v) => ({
      id: v.id,
      number: v.number,
      licensePlate: v.licensePlate,
      matchcode: v.matchcode,
      mandant: v.mandant,
      latitude: v.lastLatitude,
      longitude: v.lastLongitude,
      locationAt: v.lastLocationAt,
      driverId: v.lastDriverId,
      tour: v.tours[0] || null,
    }));
  }

  async listEvents(
    user: AuthUser,
    opts?: { tourId?: string; vehicleId?: string; take?: number },
  ) {
    if (user.role === UserRole.CUSTOMER_USER) throw new NotFoundException();
    return this.prisma.telematicsEvent.findMany({
      where: {
        organizationId: user.organizationId,
        ...(opts?.tourId ? { tourId: opts.tourId } : {}),
        ...(opts?.vehicleId ? { vehicleId: opts.vehicleId } : {}),
      },
      orderBy: { eventAt: 'desc' },
      take: opts?.take || 100,
    });
  }

  async getTourExtras(user: AuthUser, tourId: string) {
    if (user.role === UserRole.CUSTOMER_USER) throw new NotFoundException();
    const tour = await this.prisma.tour.findFirst({
      where: { id: tourId, organizationId: user.organizationId },
      select: { id: true },
    });
    if (!tour) throw new NotFoundException();
    const [events, documents] = await Promise.all([
      this.prisma.telematicsEvent.findMany({
        where: { tourId, organizationId: user.organizationId },
        orderBy: { eventAt: 'desc' },
        take: 80,
      }),
      this.prisma.tourDocument.findMany({
        where: { tourId, organizationId: user.organizationId },
        orderBy: { createdAt: 'desc' },
        select: {
          id: true,
          fileName: true,
          mimeType: true,
          sizeBytes: true,
          transportOrderNumber: true,
          createdAt: true,
        },
      }),
    ]);
    return { events, documents };
  }

  async downloadDocument(user: AuthUser, id: string) {
    if (user.role === UserRole.CUSTOMER_USER) throw new NotFoundException();
    const doc = await this.prisma.tourDocument.findFirst({
      where: { id, organizationId: user.organizationId },
    });
    if (!doc || !existsSync(doc.storagePath)) throw new NotFoundException('Dokument nicht gefunden');
    const stream = createReadStream(doc.storagePath);
    return {
      file: new StreamableFile(stream),
      fileName: basename(doc.fileName),
      mimeType: doc.mimeType,
    };
  }

  /**
   * Erzeugt einen digitalen Zustellnachweis (PDF) aus einem Soloplan-Unterschriftsdokument
   * inkl. Empfänger, Zustellstatus und Tracking-Verlauf der zugehörigen Tour/TO.
   */
  async generateZustellnachweis(user: AuthUser, docId: string) {
    if (user.role === UserRole.CUSTOMER_USER) throw new NotFoundException();

    const signatureDoc = await this.prisma.tourDocument.findFirst({
      where: { id: docId, organizationId: user.organizationId },
    });
    if (!signatureDoc || !existsSync(signatureDoc.storagePath)) {
      throw new NotFoundException('Unterschriftsdokument nicht gefunden');
    }

    const toNumber = signatureDoc.transportOrderNumber || undefined;
    const tour =
      (signatureDoc.tourId
        ? await this.prisma.tour.findFirst({
            where: { id: signatureDoc.tourId, organizationId: user.organizationId },
            include: { stops: { orderBy: { sequence: 'asc' } }, consignments: true },
          })
        : null) ||
      (signatureDoc.tourNumber
        ? await this.prisma.tour.findFirst({
            where: {
              organizationId: user.organizationId,
              tourNumber: signatureDoc.tourNumber,
            },
            include: { stops: { orderBy: { sequence: 'asc' } }, consignments: true },
          })
        : null);

    const consignment =
      (toNumber && tour?.consignments.find((c) => c.soloplanOrderNumber === toNumber)) ||
      tour?.consignments[0] ||
      null;

    const stopKind = (s: { stopType?: string | null }) => {
      const t = (s.stopType || '').toLowerCase();
      if (
        t.includes('receiver') ||
        t.includes('unload') ||
        t.includes('entlad') ||
        t.includes('zustell') ||
        t.includes('delivery')
      ) {
        return 'receiver';
      }
      if (
        t.includes('sender') ||
        t.includes('load') ||
        t.includes('belad') ||
        t.includes('pickup') ||
        t.includes('abhol')
      ) {
        return 'sender';
      }
      return 'other';
    };

    const unloadStop =
      (toNumber &&
        tour?.stops.find((s) => s.transportOrderNumber === toNumber && stopKind(s) === 'receiver')) ||
      tour?.stops.find((s) => stopKind(s) === 'receiver') ||
      (toNumber && tour?.stops.find((s) => s.transportOrderNumber === toNumber)) ||
      tour?.stops[tour.stops.length - 1] ||
      null;

    const loadStop =
      (toNumber &&
        tour?.stops.find((s) => s.transportOrderNumber === toNumber && stopKind(s) === 'sender')) ||
      tour?.stops.find((s) => stopKind(s) === 'sender') ||
      null;

    const eventOr = [
      ...(toNumber ? [{ transportOrderNumber: toNumber }] : []),
      ...(tour ? [{ tourId: tour.id }] : []),
    ];
    const events = eventOr.length
      ? await this.prisma.telematicsEvent.findMany({
          where: {
            organizationId: user.organizationId,
            kind: { in: ['TransportOrderStatus', 'TourStatus', 'Document'] },
            OR: eventOr,
          },
          orderBy: { eventAt: 'asc' },
          take: 80,
        })
      : [];

    // TO-spezifische Events bevorzugen; TourStatus immer behalten
    const timeline = toNumber
      ? events.filter(
          (e) =>
            e.kind === 'TourStatus' ||
            e.transportOrderNumber === toNumber ||
            (e.kind === 'Document' &&
              (!e.transportOrderNumber || e.transportOrderNumber === toNumber)),
        )
      : events;

    const deliveryMeta = deliveryStatusFromEvents([
      consignment?.status,
      ...timeline.map((e) => e.status),
    ]);
    const deliveryAt =
      consignment?.lastStatusAt ||
      timeline
        .filter((e) =>
          ['UnloadingFinished', 'UnloadingPlaceLeft', 'DocumentReceived'].includes(e.status || ''),
        )
        .map((e) => e.eventAt)
        .filter(Boolean)
        .pop() ||
      signatureDoc.createdAt;

    const receiverName = consignment?.receiverName || unloadStop?.name || null;
    const receiverAddress = unloadStop
      ? [unloadStop.street, [unloadStop.zip, unloadStop.city].filter(Boolean).join(' '), unloadStop.country]
          .filter(Boolean)
          .join(', ')
      : consignment?.statusText || null;
    const senderName = consignment?.senderName || loadStop?.name || null;
    const senderAddress = loadStop
      ? [loadStop.street, [loadStop.zip, loadStop.city].filter(Boolean).join(' '), loadStop.country]
          .filter(Boolean)
          .join(', ')
      : null;

    const outDir = join(this.uploadDir, 'telematics', 'zustellnachweise');
    if (!existsSync(outDir)) mkdirSync(outDir, { recursive: true });
    const safeTo = (toNumber || signatureDoc.id).replace(/[^a-zA-Z0-9._-]/g, '_');
    const fileName = `Zustellnachweis-${safeTo}.pdf`;
    const storagePath = join(outDir, fileName);

    await writeZustellnachweisPdf(
      {
        tourNumber: tour?.tourNumber || signatureDoc.tourNumber,
        transportOrderNumber: toNumber || consignment?.soloplanOrderNumber,
        externalConsignmentNumber: consignment?.externalConsignmentNumber,
        receiverName,
        receiverAddress,
        senderName,
        senderAddress,
        deliveryStatus: deliveryMeta.status,
        deliveryAt: deliveryAt ? new Date(deliveryAt) : null,
        signaturePath: isSignatureDocumentName(signatureDoc.fileName)
          ? signatureDoc.storagePath
          : signatureDoc.mimeType.startsWith('image/')
            ? signatureDoc.storagePath
            : null,
        signatureFileName: signatureDoc.fileName,
        events: timeline.map((e) => ({
          at: e.eventAt,
          label: mapTelematicsStatusLabel(e.status, e.statusText),
        })),
      },
      storagePath,
    );

    // Als TourDocument speichern (oder aktualisieren), damit es in der Tour sichtbar ist
    const existing = await this.prisma.tourDocument.findFirst({
      where: {
        organizationId: user.organizationId,
        tourId: tour?.id || signatureDoc.tourId || undefined,
        fileName,
        mimeType: 'application/pdf',
      },
    });
    const pdfDoc = existing
      ? await this.prisma.tourDocument.update({
          where: { id: existing.id },
          data: {
            storagePath,
            sizeBytes: statSync(storagePath).size,
            transportOrderNumber: toNumber,
            tourNumber: tour?.tourNumber || signatureDoc.tourNumber,
            sourceFile: `zustellnachweis:${signatureDoc.id}`,
          },
        })
      : await this.prisma.tourDocument.create({
          data: {
            organizationId: user.organizationId,
            tourId: tour?.id || signatureDoc.tourId,
            tourNumber: tour?.tourNumber || signatureDoc.tourNumber,
            transportOrderNumber: toNumber,
            fileName,
            mimeType: 'application/pdf',
            storagePath,
            sizeBytes: statSync(storagePath).size,
            sourceFile: `zustellnachweis:${signatureDoc.id}`,
          },
        });

    const stream = createReadStream(storagePath);
    return {
      file: new StreamableFile(stream),
      fileName,
      mimeType: 'application/pdf',
      documentId: pdfDoc.id,
    };
  }
}
