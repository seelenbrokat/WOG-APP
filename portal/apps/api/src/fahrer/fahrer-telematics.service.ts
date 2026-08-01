import {
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
  Logger,
  forwardRef,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import { TelematicsOutboundService } from '../integrations/telematics-outbound.service';
import { LoadingUnitService } from '../integrations/loading-unit.service';
import { TelematicsService } from '../integrations/telematics.service';
import { DocumentsService } from '../documents/documents.service';
import { ParsedTourStopStatus } from '../integrations/telematics-xml.parser';
import {
  isSignatureDocumentName,
  signedByFromSignatureFileName,
} from '../integrations/zustellnachweis-pdf';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import { DriverAuthUser } from './fahrer.types';
import { FahrerSmartborderService } from './fahrer-smartborder.service';
import { TourEtaService } from '../integrations/tour-eta.service';
import {
  DocumentDto,
  SsccStatusDto,
  TourStatusDto,
  TourStopStatusDto,
  TransportOrderStatusDto,
  VehicleLocationDto,
  TourEtaDto,
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
    private loadingUnits: LoadingUnitService,
    private config: ConfigService,
    private tourEta: TourEtaService,
    @Inject(forwardRef(() => DocumentsService)) private documents: DocumentsService,
    @Inject(forwardRef(() => TelematicsService)) private telematics: TelematicsService,
    private notifications: NotificationsService,
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

  private uploadDir() {
    return this.config.get('UPLOAD_DIR') || join(process.cwd(), '../../data/uploads');
  }

  private mimeFromName(fileName: string) {
    const n = fileName.toLowerCase();
    if (n.endsWith('.pdf')) return 'application/pdf';
    if (n.endsWith('.png')) return 'image/png';
    if (n.endsWith('.jpg') || n.endsWith('.jpeg')) return 'image/jpeg';
    return 'application/octet-stream';
  }

  /** Signature_Name_184395_941380.png → Name; KeinTausch-Dateien überspringen */
  private signedByFromFileName(fileName: string): string | undefined {
    return signedByFromSignatureFileName(fileName);
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

  /**
   * Bei „Kein Lademitteltausch“ ohne Exchange-Zeilen: Null-Tausch aus Sendungs-Lademitteln.
   */
  private async resolveExchangesForStop(
    organizationId: string,
    dto: TourStopStatusDto,
  ): Promise<Array<{ matchcode: string; given: number; taken: number }>> {
    const fromDto = (dto.loadingUnitExchanges || [])
      .filter((e) => e?.matchcode?.trim())
      .map((e) => ({
        matchcode: e.matchcode.trim(),
        given: Number(e.given) || 0,
        taken: Number(e.taken) || 0,
      }));
    if (fromDto.length) return fromDto;

    const noExchange = /kein\s*lademitteltausch/i.test(dto.statusText || '');
    if (!noExchange) return [];

    const stop = await this.prisma.tourStop.findFirst({
      where: {
        soloplanTourStopId: dto.tourStopId,
        tour: { organizationId, tourNumber: dto.tourNumber },
      },
      select: { transportOrderNumber: true, tourId: true },
    });
    const cons = stop?.transportOrderNumber
      ? await this.prisma.tourConsignment.findFirst({
          where: {
            tourId: stop.tourId,
            soloplanOrderNumber: stop.transportOrderNumber,
          },
          select: { loadingUnits: true },
        })
      : null;
    const units = Array.isArray(cons?.loadingUnits) ? (cons!.loadingUnits as any[]) : [];
    return units
      .map((u) => String(u?.matchcode || u?.Matchcode || '').trim())
      .filter(Boolean)
      .map((matchcode) => ({ matchcode, given: 0, taken: 0 }));
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

    const now = new Date();
    const result = this.outbound.sendTourStatus({
      vehicleId: driver.vehicleSoloplanId,
      driverId: driver.driverTelematicsId,
      tourNumber: dto.tourNumber,
      status: outboundStatus,
      statusText,
      statusDate: now,
      sendDate: now,
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
        lastStatusAt: now,
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

    if (dto.location) {
      await this.prisma.vehicle.update({
        where: { id: driver.vehicleId },
        data: {
          lastLatitude: dto.location.latitude,
          lastLongitude: dto.location.longitude,
          lastLocationAt: now,
          lastDriverId: driver.driverTelematicsId || undefined,
          lastLocationSource: 'vlbportal',
          active: true,
        },
      });
    }

    return result;
  }

  async sendTourStopStatus(driver: DriverAuthUser, dto: TourStopStatusDto) {
    const now = new Date();
    const exchanges = await this.resolveExchangesForStop(driver.organizationId, dto);

    const result = this.outbound.sendTourStopStatus({
      vehicleId: driver.vehicleSoloplanId,
      driverId: driver.driverTelematicsId,
      tourNumber: dto.tourNumber,
      tourStopId: dto.tourStopId,
      status: dto.status,
      statusText: dto.statusText,
      statusDate: now,
      sendDate: now,
      location: this.loc(dto.location),
      loadingUnitExchanges: exchanges,
    });

    if (exchanges.length) {
      try {
        const parsed: ParsedTourStopStatus = {
          kind: 'TourStopStatus',
          tourStopId: dto.tourStopId,
          tourNumber: dto.tourNumber,
          vehicleId: driver.vehicleSoloplanId,
          driverId: driver.driverTelematicsId || undefined,
          sendDate: now,
          statusDate: now,
          status: dto.status,
          statusText: dto.statusText,
          exchanges,
          location: dto.location
            ? {
                latitude: dto.location.latitude,
                longitude: dto.location.longitude,
              }
            : undefined,
        };
        const booked = await this.loadingUnits.bookTourStopStatus(
          driver.organizationId,
          parsed,
          `vlbportal:${result.fileName}`,
        );
        this.log.log(
          `Lademittel gebucht Stop ${dto.tourStopId}: ${JSON.stringify(booked)}`,
        );
      } catch (err: any) {
        this.log.warn(`Lademittel-Buchung fehlgeschlagen: ${err?.message || err}`);
      }
    }

    return { ...result, loadingUnits: exchanges.length };
  }

  async sendTransportOrderStatus(driver: DriverAuthUser, dto: TransportOrderStatusDto) {
    await this.assertConsignmentEditable(driver, dto.transportOrderNumber);
    const now = new Date();

    const result = this.outbound.sendTransportOrderStatus({
      vehicleId: driver.vehicleSoloplanId,
      driverId: driver.driverTelematicsId,
      transportOrderNumber: dto.transportOrderNumber,
      status: dto.status,
      statusText: dto.statusText,
      statusDate: now,
      sendDate: now,
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
        lastStatusAt: now,
        ...(dto.location
          ? {
              lastLatitude: dto.location.latitude,
              lastLongitude: dto.location.longitude,
            }
          : {}),
      },
    });

    // Abholhindernis / Zustellhindernis → Info-Mail
    if (dto.status === 'LoadingPlaceLeft' || dto.status === 'UnloadingPlaceLeft') {
      void this.notifyObstacleEmail(driver, dto, now).catch((err) =>
        this.log.warn(
          `Hindernis-Mail fehlgeschlagen TO=${dto.transportOrderNumber}: ${
            err instanceof Error ? err.message : String(err)
          }`,
        ),
      );
    }

    return result;
  }

  private async notifyObstacleEmail(
    driver: DriverAuthUser,
    dto: TransportOrderStatusDto,
    at: Date,
  ) {
    const cons = await this.prisma.tourConsignment.findFirst({
      where: {
        soloplanOrderNumber: dto.transportOrderNumber,
        tour: { organizationId: driver.organizationId },
      },
      include: { tour: { select: { tourNumber: true } } },
    });

    const orderNr =
      cons?.orderNumber && cons.consignmentIndex != null
        ? `${cons.orderNumber}.${cons.consignmentIndex}`
        : cons?.orderNumber || dto.transportOrderNumber;
    const absender = (cons?.senderName || '—').trim() || '—';
    const empfaenger = (cons?.receiverName || '—').trim() || '—';
    const grund = (dto.statusText || 'ohne Angabe').trim() || 'ohne Angabe';
    const art =
      dto.status === 'LoadingPlaceLeft' ? 'Abholhindernis' : 'Zustellhindernis';

    const subject = `${orderNr} | ${absender} | ${empfaenger} | ${grund}`;
    const body = [
      art,
      '',
      `Auftragsnummer: ${orderNr}`,
      `Transportauftrag: ${dto.transportOrderNumber}`,
      `Absender: ${absender}`,
      `Empfänger: ${empfaenger}`,
      `Grund: ${grund}`,
      '',
      `Tour: ${cons?.tour?.tourNumber || '—'}`,
      `Fahrzeug: ${driver.vehicleSoloplanId}`,
      `Fahrer: ${driver.driverTelematicsId}`,
      `Zeit: ${at.toISOString()}`,
      dto.location
        ? `Position: ${dto.location.latitude}, ${dto.location.longitude}`
        : null,
    ]
      .filter((line) => line != null)
      .join('\n');

    await this.notifications.sendRaw('info@worldofgreen.ch', subject, body);
    this.log.log(`Hindernis-Mail gesendet: ${subject}`);
  }

  async sendDocument(driver: DriverAuthUser, dto: DocumentDto) {
    if (!dto.contentBase64?.trim()) {
      throw new BadRequestException('contentBase64 fehlt');
    }

    const isRealSignature =
      isSignatureDocumentName(dto.fileName) && !/^Signature_KeinTausch/i.test(dto.fileName);
    const isImage = this.mimeFromName(dto.fileName).startsWith('image/');

    // Rohdatei immer einzeln an Soloplan (Unterschrift UND Fotos)
    const written = this.outbound.sendDocument({
      vehicleId: driver.vehicleSoloplanId,
      tourNumber: dto.tourNumber,
      transportOrderNumber: dto.transportOrderNumber,
      tourStopId: dto.tourStopId,
      fileName: dto.fileName,
      contentBase64: dto.contentBase64,
      fileSignature: dto.fileSignature,
    });
    if (isRealSignature) {
      this.log.log(
        `Unterschrift einzeln an Soloplan: ${dto.fileName} TO=${dto.transportOrderNumber || '—'} → ${written.fileName}`,
      );
    }

    const buffer = Buffer.from(dto.contentBase64.replace(/\s/g, ''), 'base64');
    const dir = join(this.uploadDir(), 'telematics', 'vlbportal');
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    const safe = `${Date.now()}_${dto.fileName.replace(/[^a-zA-Z0-9._-]/g, '_')}`;
    const storagePath = join(dir, safe);
    writeFileSync(storagePath, buffer);

    const tour = dto.tourNumber
      ? await this.prisma.tour.findFirst({
          where: { organizationId: driver.organizationId, tourNumber: dto.tourNumber },
          orderBy: { updatedAt: 'desc' },
        })
      : null;

    const tourDoc = await this.prisma.tourDocument.create({
      data: {
        organizationId: driver.organizationId,
        tourId: tour?.id,
        tourNumber: dto.tourNumber,
        transportOrderNumber: dto.transportOrderNumber,
        vehicleSoloplanId: driver.vehicleSoloplanId,
        fileName: dto.fileName,
        mimeType: this.mimeFromName(dto.fileName),
        storagePath,
        sizeBytes: buffer.length,
        sourceFile: `vlbportal:${written.fileName}`,
      },
    });

    let ablieferbeleg: Awaited<
      ReturnType<DocumentsService['generateDeliveryReceiptFromSignature']>
    > | null = null;
    let zustellnachweis: Awaited<
      ReturnType<TelematicsService['createZustellnachweisFromSignature']>
    > | null = null;

    // Bilder → gemeinsamen Ablieferbeleg aktualisieren (Unterschrift + Fotogalerie)
    const signedByName = dto.signedByName || this.signedByFromFileName(dto.fileName);
    const signedAt = dto.signedAt ? new Date(dto.signedAt) : new Date();

    if ((isRealSignature || isImage) && !/^Signature_KeinTausch/i.test(dto.fileName)) {
      try {
        ablieferbeleg = await this.documents.generateDeliveryReceiptFromSignature({
          organizationId: driver.organizationId,
          transportOrderNumber: dto.transportOrderNumber,
          tourNumber: dto.tourNumber,
          tourStopId: dto.tourStopId,
          signaturePath: storagePath,
          signatureFileName: dto.fileName,
          signedByName,
          signedAt,
        });
      } catch (err: any) {
        // Tour-Sendungen ohne Portal-Shipment → Zustellnachweis (TourDocument)
        this.log.debug(
          `Portal-Ablieferbeleg nicht möglich (${err?.message || err}) – Zustellnachweis`,
        );
      }

      try {
        zustellnachweis = await this.telematics.createZustellnachweisFromSignature({
          organizationId: driver.organizationId,
          signatureDocId: tourDoc.id,
          signedByName,
          signedAt,
        });
      } catch (err: any) {
        this.log.warn(`Zustellnachweis/Ablieferbeleg fehlgeschlagen: ${err?.message || err}`);
      }

      const pdfFileName = ablieferbeleg?.fileName || zustellnachweis?.fileName;
      const pdfPath = ablieferbeleg?.fileName
        ? join(this.uploadDir(), ablieferbeleg.fileName)
        : zustellnachweis?.storagePath;
      if (pdfFileName && pdfPath && existsSync(pdfPath)) {
        try {
          this.outbound.sendDocument({
            vehicleId: driver.vehicleSoloplanId,
            tourNumber: dto.tourNumber,
            transportOrderNumber: dto.transportOrderNumber,
            tourStopId: dto.tourStopId,
            fileName: pdfFileName,
            contentBase64: readFileSync(pdfPath).toString('base64'),
          });
        } catch (err: any) {
          this.log.warn(`Ablieferbeleg-Outbound fehlgeschlagen: ${err?.message || err}`);
        }
      }
    }

    return {
      ...written,
      tourDocumentId: tourDoc.id,
      ablieferbeleg,
      signatureSentIndividually: isRealSignature,
      zustellnachweis: zustellnachweis
        ? {
            documentId: zustellnachweis.documentId,
            fileName: zustellnachweis.fileName,
          }
        : null,
    };
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
        lastDriverId: driver.driverTelematicsId || undefined,
        lastLocationSource: 'vlbportal',
        active: true,
      },
    });

    if (dto.location.information) {
      await this.tourEta.ingestFreeText({
        organizationId: driver.organizationId,
        text: dto.location.information,
        tourNumber: dto.tourNumber,
        source: 'location',
        vehicleSoloplanId: driver.vehicleSoloplanId,
        driverTelematicsId: driver.driverTelematicsId,
      });
    }

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

  async sendEta(driver: DriverAuthUser, dto: TourEtaDto) {
    return this.tourEta.upsertFromApp({
      organizationId: driver.organizationId,
      tourNumber: dto.tourNumber,
      text: dto.text,
      etaAt: dto.etaAt,
      source: 'app',
      vehicleSoloplanId: driver.vehicleSoloplanId,
      driverTelematicsId: driver.driverTelematicsId,
    });
  }
}
