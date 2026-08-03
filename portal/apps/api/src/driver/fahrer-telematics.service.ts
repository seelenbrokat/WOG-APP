import {
  BadRequestException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  forwardRef,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DocumentType, UserRole } from '@prisma/client';
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, writeFileSync } from 'fs';
import { join } from 'path';
import { PrismaService } from '../prisma/prisma.service';
import { AuthUser } from '../auth/auth.types';
import { TelematicsOutboundService } from '../integrations/telematics-outbound.service';
import { LoadingUnitService } from '../integrations/loading-unit.service';
import { SoloplanService } from '../integrations/soloplan.service';
import { TelematicsService } from '../integrations/telematics.service';
import { DocumentsService } from '../documents/documents.service';
import {
  OutDocument,
  OutSsccStatus,
  OutTourStatus,
  OutTourStopStatus,
  OutTransportOrderStatus,
  VLB_PORTAL_TELEMATICS_CONFIG,
} from '../integrations/telematics-xml.builder';
import {
  parseTelematicsXml,
  ParsedTourStopStatus,
} from '../integrations/telematics-xml.parser';
import {
  isSignatureDocumentName,
  signedByFromSignatureFileName,
} from '../integrations/zustellnachweis-pdf';

/**
 * Nimmt Telematik-Status der VLB-Zustellapp entgegen:
 * - lokal buchen (Events, Lademittel)
 * - StdTelematics-XML in SFTP-Outbound für Soloplan ablegen
 * - bei Unterschrift: sauberen Ablieferbeleg inkl. Lademittel erzeugen
 */
@Injectable()
export class FahrerTelematicsService {
  private readonly logger = new Logger(FahrerTelematicsService.name);
  private readonly appInboundDir: string;

  constructor(
    private prisma: PrismaService,
    private config: ConfigService,
    private outbound: TelematicsOutboundService,
    private loadingUnits: LoadingUnitService,
    @Inject(forwardRef(() => SoloplanService)) private soloplan: SoloplanService,
    @Inject(forwardRef(() => DocumentsService)) private documents: DocumentsService,
    @Inject(forwardRef(() => TelematicsService)) private telematics: TelematicsService,
  ) {
    const inboundRoot =
      this.config.get('SFTP_INBOUND_DIR') || join(process.cwd(), '../../data/sftp/inbound');
    this.appInboundDir = join(inboundRoot, 'vlbportal', 'telematics');
    if (!existsSync(this.appInboundDir)) mkdirSync(this.appInboundDir, { recursive: true });
  }

  status() {
    return {
      telematicsConfig: VLB_PORTAL_TELEMATICS_CONFIG,
      outbound: this.outbound.status(),
      appInboundDir: this.appInboundDir,
    };
  }

  listOutbound() {
    return this.outbound.listPending();
  }

  async submitTourStatus(user: AuthUser, body: OutTourStatus) {
    this.assertDispatcher(user);
    const written = this.outbound.sendTourStatus(this.withDates(body));
    await this.recordEvent(user.organizationId, {
      kind: 'TourStatus',
      tourNumber: body.tourNumber,
      status: body.status,
      statusText: body.statusText,
      vehicleSoloplanId: body.vehicleId,
      driverId: body.driverId,
      latitude: body.location?.latitude,
      longitude: body.location?.longitude,
      eventAt: body.statusDate || new Date(),
      sourceFile: written.fileName,
    });
    return { ok: true, ...written };
  }

  async submitTourStopStatus(user: AuthUser, body: OutTourStopStatus) {
    this.assertDispatcher(user);
    const payload = this.withDates(body);
    const written = this.outbound.sendTourStopStatus(payload);

    // Lademittel ins Portal buchen
    if (payload.loadingUnitExchanges?.length) {
      const parsed: ParsedTourStopStatus = {
        kind: 'TourStopStatus',
        tourStopId: payload.tourStopId,
        tourNumber: payload.tourNumber,
        vehicleId: payload.vehicleId,
        driverId: payload.driverId || undefined,
        sendDate: payload.sendDate,
        statusDate: payload.statusDate,
        status: payload.status,
        statusText: payload.statusText,
        exchanges: payload.loadingUnitExchanges.map((e) => ({
          matchcode: e.matchcode,
          given: Number(e.given) || 0,
          taken: Number(e.taken) || 0,
        })),
      };
      const booked = await this.loadingUnits.bookTourStopStatus(
        user.organizationId,
        parsed,
        `vlbportal:${written.fileName}`,
      );
      this.logger.log(
        `VLBPortal Lademittel gebucht für Stop ${payload.tourStopId}: ${JSON.stringify(booked)}`,
      );
    }

    await this.recordEvent(user.organizationId, {
      kind: 'TourStopStatus',
      tourNumber: payload.tourNumber,
      status: payload.status,
      statusText: payload.statusText,
      vehicleSoloplanId: payload.vehicleId,
      driverId: payload.driverId,
      latitude: payload.location?.latitude,
      longitude: payload.location?.longitude,
      eventAt: payload.statusDate || new Date(),
      sourceFile: written.fileName,
    });

    return {
      ok: true,
      ...written,
      loadingUnits: payload.loadingUnitExchanges?.length || 0,
    };
  }

  async submitTransportOrderStatus(user: AuthUser, body: OutTransportOrderStatus) {
    this.assertDispatcher(user);
    const written = this.outbound.sendTransportOrderStatus(this.withDates(body));
    await this.recordEvent(user.organizationId, {
      kind: 'TransportOrderStatus',
      tourNumber: undefined,
      transportOrderNumber: body.transportOrderNumber,
      status: body.status,
      statusText: body.statusText,
      vehicleSoloplanId: body.vehicleId,
      driverId: body.driverId,
      latitude: body.location?.latitude,
      longitude: body.location?.longitude,
      eventAt: body.statusDate || new Date(),
      sourceFile: written.fileName,
    });
    return { ok: true, ...written };
  }

  async submitDocument(
    user: AuthUser,
    body: OutDocument & { signedByName?: string; signedAt?: string },
  ) {
    this.assertDispatcher(user);
    if (!body.contentBase64?.trim()) {
      throw new BadRequestException('contentBase64 fehlt');
    }
    const isRealSignature =
      isSignatureDocumentName(body.fileName) && !/^Signature_KeinTausch/i.test(body.fileName);
    const written = this.outbound.sendDocument(body);
    if (isRealSignature) {
      this.logger.log(
        `Unterschrift einzeln an Soloplan: ${body.fileName} TO=${body.transportOrderNumber || '—'} → ${written.fileName}`,
      );
    }

    // Lokal als TourDocument ablegen
    const buffer = Buffer.from(body.contentBase64.replace(/\s/g, ''), 'base64');
    const uploadRoot = this.config.get('UPLOAD_DIR') || join(process.cwd(), '../../data/uploads');
    const dir = join(uploadRoot, 'telematics', 'vlbportal');
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    const safe = `${Date.now()}_${body.fileName.replace(/[^a-zA-Z0-9._-]/g, '_')}`;
    const storagePath = join(dir, safe);
    writeFileSync(storagePath, buffer);

    const tour = body.tourNumber
      ? await this.prisma.tour.findFirst({
          where: { organizationId: user.organizationId, tourNumber: body.tourNumber },
          orderBy: { updatedAt: 'desc' },
        })
      : null;

    const tourDoc = await this.prisma.tourDocument.create({
      data: {
        organizationId: user.organizationId,
        tourId: tour?.id,
        tourNumber: body.tourNumber,
        transportOrderNumber: body.transportOrderNumber,
        vehicleSoloplanId: body.vehicleId,
        fileName: body.fileName,
        mimeType: this.mimeFromName(body.fileName),
        storagePath,
        sizeBytes: buffer.length,
        sourceFile: `vlbportal:${written.fileName}`,
      },
    });

    await this.recordEvent(user.organizationId, {
      kind: 'Document',
      tourNumber: body.tourNumber,
      transportOrderNumber: body.transportOrderNumber,
      status: 'DocumentReceived',
      statusText: body.fileName,
      vehicleSoloplanId: body.vehicleId,
      eventAt: new Date(),
      sourceFile: written.fileName,
    });

    let ablieferbeleg: Awaited<ReturnType<DocumentsService['generateDeliveryReceiptFromSignature']>> | null =
      null;
    let zustellnachweis: Awaited<
      ReturnType<TelematicsService['createZustellnachweisFromSignature']>
    > | null = null;
    const isSignature =
      isRealSignature || this.mimeFromName(body.fileName).startsWith('image/');

    if (isSignature && !/^Signature_KeinTausch/i.test(body.fileName)) {
      const signedAt = body.signedAt ? new Date(body.signedAt) : new Date();
      const signedByName =
        body.signedByName || signedByFromSignatureFileName(body.fileName);
      try {
        ablieferbeleg = await this.documents.generateDeliveryReceiptFromSignature({
          organizationId: user.organizationId,
          uploadedById: user.id,
          transportOrderNumber: body.transportOrderNumber,
          tourNumber: body.tourNumber,
          tourStopId: body.tourStopId,
          signaturePath: storagePath,
          signatureFileName: body.fileName,
          signedByName,
          signedAt,
        });
      } catch (err: any) {
        this.logger.debug(`Portal-Ablieferbeleg nicht möglich: ${err?.message || err}`);
      }
      try {
        zustellnachweis = await this.telematics.createZustellnachweisFromSignature({
          organizationId: user.organizationId,
          signatureDocId: tourDoc.id,
          signedByName,
          signedAt,
        });
        // Ein Ablieferbeleg je Sendung/TO – Telematics-PDF nur bei Unterschrift, nicht je Collo-Foto
        if (isRealSignature) {
          const pdfFileName = ablieferbeleg?.fileName || zustellnachweis?.fileName;
          const pdfPath = ablieferbeleg?.fileName
            ? join(this.uploadDir(), ablieferbeleg.fileName)
            : zustellnachweis?.storagePath;
          if (pdfFileName && pdfPath && existsSync(pdfPath)) {
            this.outbound.sendDocument({
              vehicleId: body.vehicleId,
              tourNumber: body.tourNumber,
              transportOrderNumber: body.transportOrderNumber,
              tourStopId: body.tourStopId,
              fileName: pdfFileName,
              contentBase64: readFileSync(pdfPath).toString('base64'),
            });
          }
        }
      } catch (err: any) {
        this.logger.warn(
          `Ablieferbeleg nach Unterschrift fehlgeschlagen: ${err?.message || err}`,
        );
      }
    }

    return {
      ok: true,
      ...written,
      tourDocumentId: tourDoc.id,
      ablieferbeleg,
      signatureSentIndividually: isRealSignature,
      zustellnachweis,
    };
  }

  private uploadDir() {
    return this.config.get('UPLOAD_DIR') || join(process.cwd(), '../../data/uploads');
  }

  async submitSsccStatus(user: AuthUser, body: OutSsccStatus) {
    this.assertDispatcher(user);
    const written = this.outbound.sendSsccStatus(body);
    await this.recordEvent(user.organizationId, {
      kind: 'SsccStatus',
      tourNumber: body.tourNumber,
      transportOrderNumber: body.transportOrderNumber,
      status: 'SsccStatus',
      statusText: body.ssccs?.map((s) => s.code).slice(0, 8).join(','),
      eventAt: new Date(),
      sourceFile: written.fileName,
    });
    return { ok: true, ...written };
  }

  /**
   * Worker: Dateien aus inbound/vlbportal/telematics verarbeiten
   * → lokal buchen + 1:1 nach outbound/soloplan/telematics für Soloplan-Download.
   */
  async processAppInboundDir(organizationId?: string) {
    if (!existsSync(this.appInboundDir)) return { processed: 0, failed: 0, files: [] as string[] };
    const orgId =
      organizationId ||
      (
        await this.prisma.organization.findFirst({
          orderBy: { createdAt: 'asc' },
          select: { id: true },
        })
      )?.id;
    if (!orgId) return { processed: 0, failed: 0, files: [] as string[] };

    const processedDir = join(this.appInboundDir, 'processed');
    const failedDir = join(this.appInboundDir, 'failed');
    if (!existsSync(processedDir)) mkdirSync(processedDir, { recursive: true });
    if (!existsSync(failedDir)) mkdirSync(failedDir, { recursive: true });

    const files = readdirSync(this.appInboundDir).filter((f) => f.toLowerCase().endsWith('.xml'));
    let processed = 0;
    let failed = 0;
    const done: string[] = [];

    for (const fileName of files) {
      const full = join(this.appInboundDir, fileName);
      const lower = fileName.toLowerCase();
      // Tour-XMLs / Fahrzeugkonfiguration → TourService bzw. ignorieren (kein App-Status)
      if (lower.includes('tour_') || lower.includes('vehicleconfiguration')) {
        continue;
      }
      try {
        const xml = readFileSync(full, 'utf8');
        const parsed = parseTelematicsXml(xml);
        if (!parsed) throw new Error('XML nicht erkannt');

        // Soloplan-XSD kennt kein Root „Message“ → nicht nach Soloplan spiegeln
        // (sonst Fehler_Telematikeingang: element is not declared).
        const skipSoloplan =
          parsed.kind === 'Message' &&
          String(this.config.get('TELEMATICS_UPLOAD_CHAT') || '')
            .trim()
            .toLowerCase() !== 'true';
        const out = skipSoloplan
          ? { fileName: null as string | null, skipped: true as const }
          : this.outbound.writeRawXml(parsed.kind, xml, fileName);

        if (parsed.kind === 'TourStopStatus') {
          await this.loadingUnits.bookTourStopStatus(orgId, parsed, `vlbportal:${fileName}`);
        }

        if (parsed.kind === 'Document') {
          const buffer = Buffer.from(parsed.contentBase64.replace(/\s/g, ''), 'base64');
          const uploadRoot =
            this.config.get('UPLOAD_DIR') || join(process.cwd(), '../../data/uploads');
          const dir = join(uploadRoot, 'telematics', 'vlbportal');
          if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
          const safe = `${Date.now()}_${parsed.fileName.replace(/[^a-zA-Z0-9._-]/g, '_')}`;
          const storagePath = join(dir, safe);
          writeFileSync(storagePath, buffer);
          const tourDoc = await this.prisma.tourDocument.create({
            data: {
              organizationId: orgId,
              tourNumber: parsed.tourNumber,
              transportOrderNumber: parsed.transportOrderNumber,
              vehicleSoloplanId: parsed.vehicleId,
              fileName: parsed.fileName,
              mimeType: this.mimeFromName(parsed.fileName),
              storagePath,
              sizeBytes: buffer.length,
              sourceFile: `vlbportal:${fileName}`,
            },
          });
          const isRealSignature =
            isSignatureDocumentName(parsed.fileName) &&
            !/^Signature_KeinTausch/i.test(parsed.fileName);
          const isImage = this.mimeFromName(parsed.fileName).startsWith('image/');
          if ((isRealSignature || isImage) && !/^Signature_KeinTausch/i.test(parsed.fileName)) {
            try {
              // PDF lokal aktualisieren (Fotos + Unterschrift → ein Beleg je Sendung)
              try {
                await this.documents.generateDeliveryReceiptFromSignature({
                  organizationId: orgId,
                  transportOrderNumber: parsed.transportOrderNumber,
                  tourNumber: parsed.tourNumber,
                  tourStopId: parsed.tourStopId,
                  signaturePath: storagePath,
                  signatureFileName: parsed.fileName,
                  signedAt: new Date(),
                });
              } catch {
                /* Tour ohne Portal-Shipment */
              }
              const zn = await this.telematics.createZustellnachweisFromSignature({
                organizationId: orgId,
                signatureDocId: tourDoc.id,
                signedAt: new Date(),
              });
              // Telematics: nur bei Unterschrift senden – nicht je Collo-Foto
              if (
                isRealSignature &&
                zn?.fileName &&
                parsed.vehicleId &&
                existsSync(zn.storagePath)
              ) {
                this.outbound.sendDocument({
                  vehicleId: parsed.vehicleId,
                  tourNumber: parsed.tourNumber,
                  transportOrderNumber: parsed.transportOrderNumber,
                  tourStopId: parsed.tourStopId,
                  fileName: zn.fileName,
                  contentBase64: readFileSync(zn.storagePath).toString('base64'),
                });
              }
            } catch (err: any) {
              this.logger.warn(`Ablieferbeleg (inbound) fehlgeschlagen: ${err?.message || err}`);
            }
          }
        }

        await this.recordEvent(orgId, {
          kind: parsed.kind,
          tourNumber: 'tourNumber' in parsed ? (parsed as any).tourNumber : undefined,
          transportOrderNumber:
            'transportOrderNumber' in parsed ? (parsed as any).transportOrderNumber : undefined,
          status: 'status' in parsed ? (parsed as any).status : parsed.kind,
          sourceFile: out.fileName || `vlbportal:${fileName}`,
          eventAt: new Date(),
        });

        renameSync(full, join(processedDir, `${Date.now()}_${fileName}`));
        processed += 1;
        done.push(fileName);
      } catch (err: any) {
        failed += 1;
        this.logger.warn(`VLBPortal inbound ${fileName}: ${err?.message || err}`);
        try {
          renameSync(full, join(failedDir, `${Date.now()}_${fileName}`));
        } catch {
          /* ignore */
        }
      }
    }

    return { processed, failed, files: done };
  }

  private assertDispatcher(user: AuthUser) {
    if (
      user.role !== UserRole.ORG_ADMIN &&
      user.role !== UserRole.MANDANT_DISPATCHER &&
      user.role !== UserRole.PARTNER
    ) {
      throw new NotFoundException();
    }
  }

  private withDates<T extends { statusDate?: Date | string; sendDate?: Date | string }>(body: T): T {
    const copy = { ...body };
    if (copy.statusDate && typeof copy.statusDate === 'string') {
      copy.statusDate = new Date(copy.statusDate) as any;
    }
    if (copy.sendDate && typeof copy.sendDate === 'string') {
      copy.sendDate = new Date(copy.sendDate) as any;
    }
    return copy;
  }

  private mimeFromName(fileName: string) {
    const n = fileName.toLowerCase();
    if (n.endsWith('.pdf')) return 'application/pdf';
    if (n.endsWith('.png')) return 'image/png';
    if (n.endsWith('.jpg') || n.endsWith('.jpeg')) return 'image/jpeg';
    return 'application/octet-stream';
  }

  private async recordEvent(
    organizationId: string,
    data: {
      kind: string;
      tourNumber?: string | null;
      transportOrderNumber?: string | null;
      status?: string | null;
      statusText?: string | null;
      vehicleSoloplanId?: string | null;
      driverId?: string | null;
      latitude?: number;
      longitude?: number;
      eventAt?: Date;
      sourceFile?: string;
    },
  ) {
    let vehicleId: string | undefined;
    if (data.vehicleSoloplanId) {
      const v = await this.prisma.vehicle.findFirst({
        where: { organizationId, soloplanVehicleId: data.vehicleSoloplanId },
        select: { id: true },
      });
      vehicleId = v?.id;
    }
    let tourId: string | undefined;
    if (data.tourNumber) {
      const t = await this.prisma.tour.findFirst({
        where: { organizationId, tourNumber: data.tourNumber },
        orderBy: { updatedAt: 'desc' },
        select: { id: true },
      });
      tourId = t?.id;
    }
    await this.prisma.telematicsEvent.create({
      data: {
        organizationId,
        kind: data.kind,
        vehicleId,
        tourId,
        tourNumber: data.tourNumber || undefined,
        transportOrderNumber: data.transportOrderNumber || undefined,
        status: data.status || undefined,
        statusText: data.statusText || undefined,
        latitude: data.latitude,
        longitude: data.longitude,
        eventAt: data.eventAt || new Date(),
        sourceFile: data.sourceFile,
      },
    });
  }
}
