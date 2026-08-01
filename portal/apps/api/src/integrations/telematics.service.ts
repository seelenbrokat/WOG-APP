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
import { LoadingUnitService } from './loading-unit.service';
import {
  buildZustellTimeline,
  deliveryStatusFromEvents,
  isSignatureDocumentName,
  signedByFromSignatureFileName,
  writeZustellnachweisPdf,
} from './zustellnachweis-pdf';
import { formatSendungsnummer } from './tour-xml.parser';

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
    private loadingUnits: LoadingUnitService,
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
      return {
        processed: 0,
        tourStatus: 0,
        orderStatus: 0,
        stopStatus: 0,
        locations: 0,
        documents: 0,
        ssccStatus: 0,
        receipts: 0,
        driverActivities: 0,
      messages: 0,
        failed: 0,
      };
    }

    const counts = {
      processed: 0,
      tourStatus: 0,
      orderStatus: 0,
      stopStatus: 0,
      locations: 0,
      documents: 0,
      ssccStatus: 0,
      receipts: 0,
      driverActivities: 0,
      messages: 0,
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
      TourStopStatus: 2,
      SsccStatus: 3,
      VehicleLocations: 4,
      Document: 5,
      Receipt: 6,
      DriverActivities: 7,
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
        const alreadyLu =
          kind === 'TourStopStatus'
            ? await this.prisma.loadingUnitPosting.findFirst({
                where: { organizationId: org.id, sourceFile: fileName },
                select: { id: true },
              })
            : null;
        if (already || alreadyDoc || alreadyLu) {
          renameSync(full, join(processedDir, `${Date.now()}_${fileName}`));
          continue;
        }

        const xml = readFileSync(full, 'utf8');
        const result = await this.importXml(org.id, xml, fileName);
        counts.processed += 1;
        remaining -= 1;
        if (result.kind === 'TourStatus') counts.tourStatus += 1;
        else if (result.kind === 'TransportOrderStatus') counts.orderStatus += 1;
        else if (result.kind === 'TourStopStatus') counts.stopStatus += 1;
        else if (result.kind === 'VehicleLocations') counts.locations += 1;
        else if (result.kind === 'Document') counts.documents += 1;
        else if (result.kind === 'SsccStatus') counts.ssccStatus += 1;
        else if (result.kind === 'Receipt') counts.receipts += 1;
        else if (result.kind === 'DriverActivities') counts.driverActivities += 1;
        else if (result.kind === 'Message') counts.messages += 1;
        renameSync(full, join(processedDir, `${Date.now()}_${fileName}`));
      } catch (err: any) {
        counts.failed += 1;
        this.logger.error(`Telematics import failed ${fileName}`, err?.message || err);
      }
    }

    if (counts.processed) {
      this.logger.log(
        `Telematics: ${counts.processed} Dateien (Tour=${counts.tourStatus}, TO=${counts.orderStatus}, Stop=${counts.stopStatus}, SSCC=${counts.ssccStatus}, Loc=${counts.locations}, Doc=${counts.documents}, Receipt=${counts.receipts}, Driver=${counts.driverActivities}, fail=${counts.failed})`,
      );
    }
    return counts;
  }

  /**
   * Einmaliger/manueller Backfill: zuvor als „sonstige“ archivierte
   * SsccStatus/Receipt/DriverActivities aus processed/ nachziehen.
   */
  async reimportUnrecognizedFromProcessed(organizationId?: string, limit = 400) {
    const org =
      (organizationId
        ? await this.prisma.organization.findUnique({ where: { id: organizationId } })
        : null) ||
      (await this.prisma.organization.findFirst({ where: { slug: 'wog' } }));
    if (!org) return { processed: 0, failed: 0, skipped: 0 };

    let processed = 0;
    let failed = 0;
    let skipped = 0;

    for (const dir of this.inboundDirs) {
      const processedDir = join(dir, 'processed');
      if (!existsSync(processedDir)) continue;
      const files = readdirSync(processedDir)
        .filter((f) => {
          const kind = detectTelematicsKind(f);
          return (
            !!kind &&
            (kind === 'SsccStatus' || kind === 'Receipt' || kind === 'DriverActivities')
          );
        })
        .sort()
        .reverse();

      for (const storedName of files) {
        if (processed >= limit) break;
        const originalName = storedName.replace(/^\d{10,}_/, '');
        const already = await this.prisma.telematicsEvent.findFirst({
          where: {
            organizationId: org.id,
            OR: [{ sourceFile: originalName }, { sourceFile: storedName }],
          },
          select: { id: true },
        });
        if (already) {
          skipped += 1;
          continue;
        }

        const full = join(processedDir, storedName);
        try {
          const xml = readFileSync(full, 'utf8');
          await this.importXml(org.id, xml, originalName);
          processed += 1;
        } catch (err: any) {
          failed += 1;
          this.logger.error(
            `Telematics reimport failed ${storedName}`,
            err?.message || err,
          );
        }
      }
    }

    if (processed || failed) {
      this.logger.log(
        `Telematics Reimport: ${processed} nachgezogen, ${failed} fehlgeschlagen, ${skipped} übersprungen`,
      );
    }
    return { processed, failed, skipped };
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

    if (parsed.kind === 'TourStopStatus') {
      await this.loadingUnits.bookTourStopStatus(organizationId, parsed, fileName);
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

    if (parsed.kind === 'SsccStatus') {
      const primary = parsed.ssccs[0];
      const eventAt = primary?.statusTimestamp || new Date();
      const consignments = await this.prisma.tourConsignment.findMany({
        where: {
          soloplanOrderNumber: parsed.transportOrderNumber,
          tour: { organizationId },
        },
        include: { tour: true },
        take: 4,
      });
      consignments.sort(
        (a, b) => (b.tour.updatedAt?.getTime() || 0) - (a.tour.updatedAt?.getTime() || 0),
      );
      const primaryConsignment = consignments[0];
      const statusText = parsed.ssccs
        .slice(0, 8)
        .map((s) =>
          [s.code, s.scanPoint, s.status, s.transportStatus].filter(Boolean).join(':'),
        )
        .join('; ');

      await this.prisma.telematicsEvent.create({
        data: {
          organizationId,
          kind: 'SsccStatus',
          tourId: primaryConsignment?.tourId,
          tourNumber: primaryConsignment?.tour.tourNumber,
          transportOrderNumber: parsed.transportOrderNumber,
          status: primary?.status || primary?.scanPoint || 'SsccStatus',
          statusText: statusText || undefined,
          eventAt,
          sourceFile: fileName,
        },
      });
      return parsed;
    }

    if (parsed.kind === 'Receipt') {
      const vehicle = parsed.vehicleId
        ? await this.resolveVehicle(organizationId, parsed.vehicleId)
        : null;
      const tour =
        parsed.referenceType === 'Tour' && parsed.referenceId
          ? await this.resolveTour(organizationId, parsed.referenceId)
          : null;
      const eventAt = parsed.sendDate || new Date();
      if (tour && parsed.receiptType) {
        // Receipt = Geräte-ACK (Pending/Sent/Arrived), kein TourStatus Started/Finished
        await this.prisma.tour.update({
          where: { id: tour.id },
          data: {
            telematicsStatus: parsed.receiptType,
            lastStatusAt: eventAt,
            ...(vehicle ? { vehicleId: vehicle.id } : {}),
          },
        });
      }
      await this.prisma.telematicsEvent.create({
        data: {
          organizationId,
          kind: 'Receipt',
          vehicleId: vehicle?.id,
          tourId: tour?.id,
          tourNumber: tour?.tourNumber || parsed.referenceId,
          status: parsed.receiptType || 'Receipt',
          statusText: [parsed.referenceType, parsed.referenceId].filter(Boolean).join(' '),
          eventAt,
          sendDate: parsed.sendDate,
          sourceFile: fileName,
        },
      });
      return parsed;
    }

    if (parsed.kind === 'DriverActivities') {
      const vehicle = parsed.vehicleId
        ? await this.resolveVehicle(organizationId, parsed.vehicleId, parsed.driverId)
        : null;
      const primary = parsed.activities[0];
      const statusText = parsed.activities
        .slice(0, 6)
        .map((a) => a.activity || 'Activity')
        .join(', ');
      await this.prisma.telematicsEvent.create({
        data: {
          organizationId,
          kind: 'DriverActivities',
          vehicleId: vehicle?.id,
          status: primary?.activity || 'DriverActivities',
          statusText:
            [parsed.vehicleLicensePlate, statusText].filter(Boolean).join(' · ') || undefined,
          eventAt: primary?.end || primary?.start || new Date(),
          sourceFile: fileName,
        },
      });
      return parsed;
    }

    if (parsed.kind === 'Message') {
      const vehicle = parsed.vehicleId
        ? await this.resolveVehicle(organizationId, parsed.vehicleId, parsed.driverId)
        : null;
      let driverId: string | undefined;
      if (parsed.driverId) {
        const d = await this.prisma.driver.findFirst({
          where: { organizationId, telematicsId: parsed.driverId },
          select: { id: true },
        });
        driverId = d?.id;
      }
      const text = (parsed.text || '').trim();
      if (text) {
        await this.prisma.driverChatMessage.create({
          data: {
            organizationId,
            vehicleId: vehicle?.id,
            driverId,
            driverTelematicsId: parsed.driverId || undefined,
            tourNumber: parsed.tourNumber || undefined,
            direction: 'IN',
            text,
            sourceFile: fileName,
          },
        });
      }
      await this.prisma.telematicsEvent.create({
        data: {
          organizationId,
          kind: 'Message',
          vehicleId: vehicle?.id,
          tourNumber: parsed.tourNumber,
          status: 'Message',
          statusText: text.slice(0, 500) || undefined,
          eventAt: parsed.sendDate || new Date(),
          sendDate: parsed.sendDate,
          sourceFile: fileName,
        },
      });
      return parsed;
    }

    if (parsed.kind !== 'Document') {
      throw new Error(`Unbekannter Telematics-Typ: ${(parsed as { kind: string }).kind}`);
    }

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

  /**
   * Soloplan referenziert Touren mal als TourNumber (z.B. 184200),
   * mal als interne TourId / soloplanTourId (z.B. 166702935 in Receipt.Reference.Id).
   */
  private async resolveTour(organizationId: string, tourRef: string) {
    return this.prisma.tour.findFirst({
      where: {
        organizationId,
        OR: [{ tourNumber: tourRef }, { soloplanTourId: tourRef }],
      },
      orderBy: [{ updatedAt: 'desc' }],
    });
  }

  /** Receipts/Events nachziehen, die nur die Soloplan-TourId statt tourNumber hatten. */
  async relinkOrphanTourRefs(organizationId?: string, limit = 2000) {
    const org =
      (organizationId
        ? await this.prisma.organization.findUnique({ where: { id: organizationId } })
        : null) ||
      (await this.prisma.organization.findFirst({ where: { slug: 'wog' } }));
    if (!org) return { linked: 0, toursUpdated: 0 };

    const orphans = await this.prisma.telematicsEvent.findMany({
      where: {
        organizationId: org.id,
        tourId: null,
        tourNumber: { not: null },
      },
      select: { id: true, tourNumber: true, kind: true, status: true, eventAt: true, vehicleId: true },
      orderBy: { eventAt: 'asc' },
      take: limit,
    });

    let linked = 0;
    const latestByTour = new Map<
      string,
      { status: string; eventAt: Date; vehicleId?: string | null }
    >();

    for (const ev of orphans) {
      if (!ev.tourNumber) continue;
      const tour = await this.resolveTour(org.id, ev.tourNumber);
      if (!tour) continue;
      await this.prisma.telematicsEvent.update({
        where: { id: ev.id },
        data: {
          tourId: tour.id,
          tourNumber: tour.tourNumber,
        },
      });
      linked += 1;
      if (ev.kind === 'Receipt' && ev.status && ev.eventAt) {
        const prev = latestByTour.get(tour.id);
        if (!prev || ev.eventAt > prev.eventAt) {
          latestByTour.set(tour.id, {
            status: ev.status,
            eventAt: ev.eventAt,
            vehicleId: ev.vehicleId,
          });
        }
      }
    }

    let toursUpdated = 0;
    for (const [tourId, info] of latestByTour) {
      await this.prisma.tour.update({
        where: { id: tourId },
        data: {
          telematicsStatus: info.status,
          lastStatusAt: info.eventAt,
          ...(info.vehicleId ? { vehicleId: info.vehicleId } : {}),
        },
      });
      toursUpdated += 1;
    }

    if (linked) {
      this.logger.log(
        `Telematics Relink: ${linked} Events an Touren gebunden, ${toursUpdated} Tour-Status aktualisiert`,
      );
    }
    return { linked, toursUpdated };
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

    const created = await this.createZustellnachweisFromSignature({
      organizationId: user.organizationId,
      signatureDocId: docId,
    });
    const stream = createReadStream(created.storagePath);
    return {
      file: new StreamableFile(stream),
      fileName: created.fileName,
      mimeType: 'application/pdf',
      documentId: created.documentId,
    };
  }

  /**
   * Ablieferbeleg/Zustellnachweis aus Unterschrift (VLB-Zustellapp / Dispo).
   * Speichert als TourDocument – auch ohne Portal-Shipment.
   */
  async createZustellnachweisFromSignature(opts: {
    organizationId: string;
    signatureDocId: string;
    signedByName?: string | null;
    signedAt?: Date | null;
  }) {
    const signatureDoc = await this.prisma.tourDocument.findFirst({
      where: { id: opts.signatureDocId, organizationId: opts.organizationId },
    });
    if (!signatureDoc || !existsSync(signatureDoc.storagePath)) {
      throw new NotFoundException('Unterschriftsdokument nicht gefunden');
    }

    const toNumber = signatureDoc.transportOrderNumber || undefined;
    const tour =
      (signatureDoc.tourId
        ? await this.prisma.tour.findFirst({
            where: { id: signatureDoc.tourId, organizationId: opts.organizationId },
            include: { stops: { orderBy: { sequence: 'asc' } }, consignments: true },
          })
        : null) ||
      (signatureDoc.tourNumber
        ? await this.prisma.tour.findFirst({
            where: {
              organizationId: opts.organizationId,
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
            organizationId: opts.organizationId,
            kind: { in: ['TransportOrderStatus', 'TourStatus', 'Document'] },
            OR: eventOr,
          },
          orderBy: { eventAt: 'asc' },
          take: 80,
        })
      : [];

    const toEvents = events.filter(
      (e) =>
        e.kind === 'TransportOrderStatus' &&
        (!toNumber || !e.transportOrderNumber || e.transportOrderNumber === toNumber),
    );
    const timeline = buildZustellTimeline(toEvents, toNumber);

    const deliveryMeta = deliveryStatusFromEvents([
      consignment?.status,
      ...toEvents.map((e) => e.status),
      'DocumentReceived', // Unterschrift = zugestellt (auch wenn Status-Race)
    ]);
    const deliveryAt =
      opts.signedAt ||
      consignment?.lastStatusAt ||
      toEvents
        .filter((e) =>
          ['UnloadingFinished', 'UnloadingPlaceLeft'].includes(e.status || ''),
        )
        .map((e) => e.eventAt)
        .filter(Boolean)
        .pop() ||
      signatureDoc.createdAt;

    const deliveredEvent = toEvents
      .filter((e) =>
        ['UnloadingFinished', 'UnloadingPlaceLeft', 'DocumentReceived'].includes(e.status || ''),
      )
      .slice()
      .reverse()
      .find((e) => e.latitude != null && e.longitude != null);

    const deliveryLatitude =
      deliveredEvent?.latitude ??
      consignment?.lastLatitude ??
      unloadStop?.latitude ??
      null;
    const deliveryLongitude =
      deliveredEvent?.longitude ??
      consignment?.lastLongitude ??
      unloadStop?.longitude ??
      null;

    const receiverName = consignment?.receiverName || unloadStop?.name || null;
    const receiverAddress = unloadStop
      ? [unloadStop.street, [unloadStop.zip, unloadStop.city].filter(Boolean).join(' '), unloadStop.country]
          .filter(Boolean)
          .join(', ')
      : null;
    const senderName = consignment?.senderName || loadStop?.name || null;
    const senderAddress = loadStop
      ? [loadStop.street, [loadStop.zip, loadStop.city].filter(Boolean).join(' '), loadStop.country]
          .filter(Boolean)
          .join(', ')
      : null;

    // Übernehmer = unterschreibende Person (nicht Empfängerfirma)
    const uebernehmerName =
      opts.signedByName?.trim() ||
      signedByFromSignatureFileName(signatureDoc.fileName) ||
      null;

    // Auftraggeber: Soloplan Customer (z. B. DHL) > FreightPayer > Portal-Kunde > Absender
    const consAny = consignment as {
      customerName?: string | null;
      freightPayerName?: string | null;
    } | null;
    let auftraggeber: string | null =
      consAny?.customerName?.trim() ||
      consAny?.freightPayerName?.trim() ||
      null;
    if (!auftraggeber && toNumber) {
      const portalShipment = await this.prisma.shipment.findFirst({
        where: {
          organizationId: opts.organizationId,
          OR: [
            { soloplanRef: toNumber },
            { trackingNumber: toNumber },
            { reference: toNumber },
            { order: { externalNumber: toNumber } },
          ],
        },
        include: { customer: { select: { name: true } } },
        orderBy: { createdAt: 'desc' },
      });
      auftraggeber = portalShipment?.customer?.name?.trim() || null;
    }
    if (!auftraggeber && senderName?.trim()) {
      auftraggeber = senderName.trim();
    }
    if (!auftraggeber && tour?.mandantId) {
      const mandant = await this.prisma.mandant.findFirst({
        where: { id: tour.mandantId },
        select: { name: true },
      });
      auftraggeber = mandant?.name?.trim() || null;
    }

    const loadingUnitExchange = await this.loadingUnits.resolveExchangeNote({
      organizationId: opts.organizationId,
      tourStopId: unloadStop?.id,
      tourStopExternalId: unloadStop?.soloplanTourStopId,
      tourId: tour?.id,
      tourNumber: tour?.tourNumber || signatureDoc.tourNumber,
      partnerName: consignment?.receiverName || receiverName,
      transportOrderNumber: toNumber,
    });

    const sendungsnummer = formatSendungsnummer({
      orderNumber: (consignment as { orderNumber?: string | null } | null)?.orderNumber,
      consignmentIndex: (consignment as { consignmentIndex?: number | null } | null)
        ?.consignmentIndex,
      externalConsignmentNumber: consignment?.externalConsignmentNumber,
      soloplanOrderNumber: toNumber || consignment?.soloplanOrderNumber,
    });

    // Alle Bilder derselben Sendung/TO → ein gemeinsamer Ablieferbeleg
    const relatedImages = await this.prisma.tourDocument.findMany({
      where: {
        organizationId: opts.organizationId,
        mimeType: { startsWith: 'image/' },
        NOT: [
          { fileName: { startsWith: 'Ablieferbeleg-' } },
          { fileName: { startsWith: 'Zustellnachweis-' } },
        ],
        OR: [
          ...(toNumber ? [{ transportOrderNumber: toNumber }] : []),
          { id: signatureDoc.id },
        ],
      },
      orderBy: { createdAt: 'asc' },
      take: 40,
    });

    const imageDocs = relatedImages.filter((d) => existsSync(d.storagePath));

    const isUsableSignature = (fileName: string) =>
      isSignatureDocumentName(fileName) && !/^Signature_KeinTausch/i.test(fileName);

    const signatureDocs = imageDocs.filter((d) => isUsableSignature(d.fileName));
    const mainSignature =
      signatureDocs.find((d) => d.id === signatureDoc.id) ||
      signatureDocs[signatureDocs.length - 1] ||
      (signatureDoc.mimeType.startsWith('image/') &&
      !/^Signature_KeinTausch/i.test(signatureDoc.fileName)
        ? signatureDoc
        : null) ||
      imageDocs[imageDocs.length - 1] ||
      null;

    const photos = imageDocs
      .filter((d) => !mainSignature || d.id !== mainSignature.id)
      .map((d) => ({
        path: d.storagePath,
        fileName: d.fileName,
        label: isUsableSignature(d.fileName)
          ? 'Weitere Unterschrift'
          : d.fileName.match(/ENTLAD|FOTO|PHOTO|DAMAGE|BESCHAED/i)
            ? 'Entladefoto'
            : 'Foto',
      }));

    const outDir = join(this.uploadDir, 'telematics', 'zustellnachweise');
    if (!existsSync(outDir)) mkdirSync(outDir, { recursive: true });
    const safeTo = (toNumber || signatureDoc.id).replace(/[^a-zA-Z0-9._-]/g, '_');
    // Tour-Ablieferbeleg (ohne Portal-Shipment); Dateiname bewusst Ablieferbeleg
    const fileName = `Ablieferbeleg-${safeTo}.pdf`;
    const storagePath = join(outDir, fileName);

    await writeZustellnachweisPdf(
      {
        title: 'Ablieferbeleg',
        tourNumber: tour?.tourNumber || signatureDoc.tourNumber,
        transportOrderNumber: toNumber || consignment?.soloplanOrderNumber,
        sendungsnummer,
        externalConsignmentNumber: consignment?.externalConsignmentNumber,
        receiverName,
        receiverAddress,
        senderName,
        senderAddress,
        auftraggeber,
        uebernehmerName,
        deliveryStatus: deliveryMeta.delivered ? 'Zugestellt' : deliveryMeta.status,
        deliveryAt: deliveryAt ? new Date(deliveryAt) : null,
        deliveryLatitude,
        deliveryLongitude,
        signaturePath: mainSignature?.storagePath || null,
        signatureFileName: mainSignature?.fileName || null,
        photos,
        loadingUnitExchange:
          loadingUnitExchange.status === 'UNKNOWN' ? null : loadingUnitExchange,
        noLoadingUnitExchangeRequired: true,
        events: timeline,
        companyLine: uebernehmerName
          ? `Übernehmer: ${uebernehmerName}`
          : undefined,
      },
      storagePath,
    );

    const existing = await this.prisma.tourDocument.findFirst({
      where: {
        organizationId: opts.organizationId,
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
            sourceFile: `ablieferbeleg:${signatureDoc.id}`,
          },
        })
      : await this.prisma.tourDocument.create({
          data: {
            organizationId: opts.organizationId,
            tourId: tour?.id || signatureDoc.tourId,
            tourNumber: tour?.tourNumber || signatureDoc.tourNumber,
            transportOrderNumber: toNumber,
            fileName,
            mimeType: 'application/pdf',
            storagePath,
            sizeBytes: statSync(storagePath).size,
            sourceFile: `ablieferbeleg:${signatureDoc.id}`,
          },
        });

    return {
      documentId: pdfDoc.id,
      fileName,
      storagePath,
      mimeType: 'application/pdf' as const,
    };
  }
}
