import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  chmodSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  statSync,
  writeFileSync,
} from 'fs';
import { basename, join } from 'path';
import { PrismaService } from '../prisma/prisma.service';
import { TelematicsOutboundService } from './telematics-outbound.service';
import { isStat512Content, parseStat512 } from './fortras/stat512.parser';
import { mapStat512EventToTransportOrderStatus } from './fortras/stat512-to-telematics';
import {
  isBtSwissStatusXml,
  parseBtSwissStatusXml,
  primaryBtSwissReference,
  type BtSwissStatusEvent,
} from './fortras/bt-swiss-status.parser';
import { mapBtSwissEventToTransportOrderStatus } from './fortras/bt-swiss-status-to-telematics';
import { detectImageExt, toPdfEmbeddableImage } from './fortras/image-to-png';
import { writeZustellnachweisPdf } from './zustellnachweis-pdf';

function asRec(v: unknown): Record<string, unknown> | null {
  return v && typeof v === 'object' && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : null;
}

function strField(obj: Record<string, unknown> | null, ...keys: string[]): string {
  if (!obj) return '';
  for (const k of keys) {
    const v = obj[k];
    if (v == null) continue;
    if (typeof v === 'object') continue; // nested Soloplan-Objekte überspringen
    const s = String(v).trim();
    if (s && s !== '[object Object]') return s;
  }
  return '';
}

function formatAddress(obj: Record<string, unknown> | null): string {
  if (!obj) return '';
  const street =
    strField(obj, 'street', 'Street', 'strasse', 'address') ||
    strField(asRec(obj.street), 'name', 'name1', 'value') ||
    '';
  const house = strField(obj, 'houseNumber', 'houseNo', 'hausnummer');
  const zip = strField(obj, 'zip', 'Zip', 'zipCode', 'plz');
  const city = strField(obj, 'city', 'City', 'city1', 'ort');
  const streetLine = [street, house].filter(Boolean).join(' ').trim();
  return [streetLine, [zip, city].filter(Boolean).join(' ')].filter(Boolean).join(', ');
}

/** Adressen aus TourConsignment.details (Soloplan-JSON). */
function addressesFromConsignmentDetails(details: unknown): {
  receiverName?: string;
  receiverAddress?: string;
  senderName?: string;
  senderAddress?: string;
} {
  const root = asRec(details);
  if (!root) return {};
  const sender = asRec(root.sender) || asRec(root.loadingAddress);
  const receiver = asRec(root.receiver) || asRec(root.unloadingAddress);
  return {
    senderName: strField(sender, 'name', 'name1', 'company') || undefined,
    senderAddress: formatAddress(sender) || undefined,
    receiverName: strField(receiver, 'name', 'name1', 'company') || undefined,
    receiverAddress: formatAddress(receiver) || undefined,
  };
}

/**
 * Partner-Status inbound (BT Swiss u. a.).
 *
 * Ordner: {SFTP_INBOUND}/partner-status/{username}/
 * Formate:
 *   - FORTRAS STAT512
 *   - BT Swiss Cargo-Status-XML (<status><shipment …>)
 * → Soloplan StdTelematics TransportOrderStatus
 * → bei Unterschrift/Foto: Ablieferbeleg-PDF (Document)
 */
@Injectable()
export class PartnerStatusInboundService {
  private readonly log = new Logger(PartnerStatusInboundService.name);
  private readonly inboundRoot: string;
  private readonly uploadDir: string;

  constructor(
    private prisma: PrismaService,
    private config: ConfigService,
    private telematicsOut: TelematicsOutboundService,
  ) {
    const sftpInbound =
      this.config.get('SFTP_INBOUND_DIR') || join(process.cwd(), '../../data/sftp/inbound');
    this.inboundRoot = join(sftpInbound, 'partner-status');
    this.uploadDir =
      this.config.get('UPLOAD_DIR') || join(process.cwd(), '../../data/uploads');
    if (!existsSync(this.inboundRoot)) mkdirSync(this.inboundRoot, { recursive: true });
  }

  ensureDropDirs(username: string) {
    const user = String(username || '')
      .trim()
      .toLowerCase();
    if (!user) return;
    for (const dir of [
      join(this.inboundRoot, user),
      join(this.inboundRoot, user, 'processed'),
      join(this.inboundRoot, user, 'failed'),
    ]) {
      if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    }
  }

  async processInboundDir(limit = 40) {
    let processed = 0;
    let failed = 0;
    let skipped = 0;
    let events = 0;
    const files: string[] = [];

    if (!existsSync(this.inboundRoot)) {
      return { processed, failed, skipped, events, files };
    }

    const users = readdirSync(this.inboundRoot, { withFileTypes: true })
      .filter((d) => d.isDirectory() && !['processed', 'failed'].includes(d.name))
      .map((d) => d.name);

    for (const user of users) {
      this.ensureDropDirs(user);
      const drop = join(this.inboundRoot, user);
      const pending = readdirSync(drop)
        .filter((f) => {
          if (f.startsWith('.')) return false;
          if (['processed', 'failed'].includes(f)) return false;
          const full = join(drop, f);
          try {
            return statSync(full).isFile();
          } catch {
            return false;
          }
        })
        .sort()
        .slice(0, Math.max(0, limit - processed - failed));

      for (const name of pending) {
        const full = join(drop, name);
        try {
          const result = await this.processFile(user, full, name);
          processed += 1;
          events += result.events;
          files.push(`${user}/${name}`);
          this.move(full, join(drop, 'processed', `${Date.now()}_${name}`));
        } catch (err: unknown) {
          failed += 1;
          const msg = err instanceof Error ? err.message : String(err);
          this.log.warn(`Partner-Status ${user}/${name}: ${msg}`);
          try {
            this.move(full, join(drop, 'failed', `${Date.now()}_${name}`));
          } catch {
            skipped += 1;
          }
        }
      }
    }

    return { processed, failed, skipped, events, files };
  }

  private async processFile(username: string, filePath: string, fileName: string) {
    const raw = readFileSync(filePath);
    let utf8 = raw.toString('utf8');
    let latin1 = raw.toString('latin1');

    if (isBtSwissStatusXml(utf8) || isBtSwissStatusXml(latin1)) {
      const content = isBtSwissStatusXml(utf8) ? utf8 : latin1;
      return this.processBtSwissXml(username, content, fileName);
    }

    let content = latin1;
    if (!isStat512Content(content)) content = utf8;
    if (!isStat512Content(content)) {
      throw new Error(
        'Unbekanntes Format – erwartet FORTRAS STAT512 (@@PHSTAT512) oder BT-Swiss-Status-XML',
      );
    }

    const msg = parseStat512(content, fileName);
    if (!msg.events.length) {
      throw new Error('STAT512 ohne Q10-Statuszeilen');
    }

    let written = 0;
    for (const ev of msg.events) {
      const mapped = mapStat512EventToTransportOrderStatus(ev);
      if (!mapped) continue;

      const resolved = await this.resolveVehicleAndOrder([mapped.transportOrderNumber]);
      const vehicleId = await this.resolveVehicleId(resolved.vehicleId);
      if (!vehicleId) {
        this.log.warn(
          `Partner-Status ${username}: keine VehicleId für ${mapped.transportOrderNumber} – Event geparkt`,
        );
        continue;
      }

      const orderNumber = resolved.transportOrderNumber || mapped.transportOrderNumber;
      this.telematicsOut.sendTransportOrderStatus({
        vehicleId,
        transportOrderNumber: orderNumber,
        status: mapped.status,
        statusText: mapped.statusText || undefined,
        statusDate: mapped.statusDate,
      });
      written += 1;
      this.log.log(
        `Partner-Status ${username}: ${orderNumber} ${mapped.originalCode}→${mapped.status} vehicle=${vehicleId}`,
      );
    }

    return { events: written };
  }

  private async processBtSwissXml(username: string, content: string, fileName: string) {
    const msg = parseBtSwissStatusXml(content, fileName);
    let written = 0;

    for (const ev of msg.events) {
      const mapped = mapBtSwissEventToTransportOrderStatus(ev);
      if (!mapped) continue;

      const candidates = this.btSwissMatchKeys(ev);
      const resolved = await this.resolveVehicleAndOrder(candidates);
      const vehicleId = await this.resolveVehicleId(resolved.vehicleId);
      if (!vehicleId) {
        this.log.warn(
          `Partner-Status ${username}: keine VehicleId für ${mapped.transportOrderNumber} – Event geparkt`,
        );
        continue;
      }

      const orderNumber = resolved.transportOrderNumber || mapped.transportOrderNumber;
      this.telematicsOut.sendTransportOrderStatus({
        vehicleId,
        transportOrderNumber: orderNumber,
        status: mapped.status,
        // Beschreibung optional – Status auch ohne StatusText
        statusText: mapped.statusText || undefined,
        statusDate: mapped.statusDate,
        location: mapped.location,
      });
      written += 1;
      this.log.log(
        `Partner-Status ${username}: ${orderNumber} ${mapped.originalCode}→${mapped.status}` +
          `${mapped.hasProof ? ' +POD' : ''} vehicle=${vehicleId}`,
      );

      if (mapped.hasProof) {
        try {
          await this.emitBtSwissAblieferbeleg({
            username,
            vehicleId,
            orderNumber,
            tourNumber: resolved.tourNumber,
            ev,
            receiverName: resolved.receiverName,
            receiverAddress: resolved.receiverAddress,
            senderName: resolved.senderName,
            senderAddress: resolved.senderAddress,
          });
        } catch (err: unknown) {
          const m = err instanceof Error ? err.message : String(err);
          this.log.warn(
            `Partner-Status ${username}: Ablieferbeleg für ${orderNumber} fehlgeschlagen: ${m}`,
          );
        }
      }
    }

    return { events: written };
  }

  private btSwissMatchKeys(ev: BtSwissStatusEvent): string[] {
    const keys: string[] = [];
    const push = (v?: string | null) => {
      const s = String(v || '').trim();
      if (s && !keys.includes(s)) keys.push(s);
    };
    push(ev.shipmentReference);
    push(ev.shipmentId);
    if (ev.shipmentId?.includes('/')) {
      const [tourPart, orderPart] = ev.shipmentId.split('/');
      push(orderPart);
      push(tourPart);
      // 452359.1 → 452359
      if (orderPart?.includes('.')) push(orderPart.split('.')[0]);
    }
    push(ev.shipmentIdBuyer);
    push(ev.shipmentIdConsignor);
    push(primaryBtSwissReference(ev));
    return keys;
  }

  private async resolveVehicleId(fromDb?: string): Promise<string> {
    if (fromDb?.trim()) return fromDb.trim();
    const fromEnv =
      this.config.get<string>('PARTNER_STATUS_DEFAULT_VEHICLE_ID') ||
      this.config.get<string>('BT_SWISS_DEFAULT_VEHICLE_ID') ||
      '';
    if (fromEnv.trim()) return fromEnv.trim();
    // Letzter Fallback: irgendein aktives Soloplan-Fahrzeug, damit Status nicht verworfen wird
    const any = await this.prisma.vehicle.findFirst({
      where: { active: true, soloplanVehicleId: { not: '' } },
      select: { soloplanVehicleId: true },
      orderBy: { updatedAt: 'desc' },
    });
    return any?.soloplanVehicleId || '';
  }

  /**
   * Ablieferbeleg-PDF aus Unterschrift und/oder Foto, dann Telematics Document.
   */
  private async emitBtSwissAblieferbeleg(opts: {
    username: string;
    vehicleId: string;
    orderNumber: string;
    tourNumber?: string;
    ev: BtSwissStatusEvent;
    receiverName?: string;
    receiverAddress?: string;
    senderName?: string;
    senderAddress?: string;
  }) {
    const mediaDir = join(this.uploadDir, 'telematics', 'partner-status', opts.username);
    if (!existsSync(mediaDir)) mkdirSync(mediaDir, { recursive: true });
    const safe = opts.orderNumber.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 60);
    const stamp = Date.now();

    let signaturePath: string | null = null;
    let signatureFileName: string | null = null;
    const photos: Array<{ path: string; fileName?: string; label?: string }> = [];

    if (opts.ev.signatureBase64) {
      const raw = Buffer.from(opts.ev.signatureBase64, 'base64');
      const embed = toPdfEmbeddableImage(raw);
      signatureFileName = `Signature_${safe}_${stamp}.${embed.ext}`;
      signaturePath = join(mediaDir, signatureFileName);
      writeFileSync(signaturePath, embed.buffer);
      // Rohdatei zusätzlich ablegen (TIFF bleibt für Audit)
      const rawExt = detectImageExt(raw);
      if (rawExt === 'tif') {
        writeFileSync(join(mediaDir, `Signature_${safe}_${stamp}.tif`), raw);
      }
    }

    if (opts.ev.pictureBase64) {
      const raw = Buffer.from(opts.ev.pictureBase64, 'base64');
      const embed = toPdfEmbeddableImage(raw);
      const fileName = `Photo_${safe}_${stamp}.${embed.ext}`;
      const path = join(mediaDir, fileName);
      writeFileSync(path, embed.buffer);
      photos.push({ path, fileName, label: 'Zustellfoto' });
    }

    if (!signaturePath && !photos.length) return;

    const outDir = join(this.uploadDir, 'telematics', 'zustellnachweise');
    if (!existsSync(outDir)) mkdirSync(outDir, { recursive: true });
    const pdfName = `Ablieferbeleg-${safe}.pdf`;
    const pdfPath = join(outDir, pdfName);

    await writeZustellnachweisPdf(
      {
        title: 'Ablieferbeleg',
        tourNumber: opts.tourNumber || null,
        transportOrderNumber: opts.orderNumber,
        sendungsnummer: opts.orderNumber,
        externalConsignmentNumber: opts.ev.shipmentReference || null,
        receiverName: opts.receiverName || null,
        receiverAddress: opts.receiverAddress || null,
        senderName: opts.senderName || null,
        senderAddress: opts.senderAddress || null,
        uebernehmerName: opts.ev.deliveredTo || null,
        deliveryStatus: 'Zugestellt',
        deliveryAt: opts.ev.eventAt,
        deliveryLatitude: opts.ev.latitude ?? null,
        deliveryLongitude: opts.ev.longitude ?? null,
        signaturePath,
        signatureFileName,
        photos,
        noLoadingUnitExchangeRequired: true,
        events: [
          {
            at: opts.ev.eventAt,
            label: `BT Swiss ${opts.ev.eventCode}`,
          },
        ],
        companyLine: opts.ev.deliveredTo
          ? `Übernehmer: ${opts.ev.deliveredTo}`
          : 'BT Swiss Zustellnachweis',
      },
      pdfPath,
    );

    const pdfBase64 = readFileSync(pdfPath).toString('base64');
    this.telematicsOut.sendDocument({
      vehicleId: opts.vehicleId,
      tourNumber: opts.tourNumber,
      transportOrderNumber: opts.orderNumber,
      fileName: pdfName,
      contentBase64: pdfBase64,
    });
    this.log.log(
      `Partner-Status ${opts.username}: Ablieferbeleg ${pdfName} → Soloplan TO=${opts.orderNumber}`,
    );
  }

  /**
   * Soloplan-Auftragsnummer + Fahrzeug aus TourConsignment / Shipment ableiten.
   */
  private async resolveVehicleAndOrder(refs: string[]): Promise<{
    vehicleId?: string;
    transportOrderNumber?: string;
    tourNumber?: string;
    receiverName?: string;
    receiverAddress?: string;
    senderName?: string;
    senderAddress?: string;
  }> {
    const keys = [...new Set(refs.map((r) => String(r || '').trim()).filter(Boolean))];
    if (!keys.length) return {};

    const cons = await this.prisma.tourConsignment.findFirst({
      where: {
        OR: keys.flatMap((key) => [
          { soloplanOrderNumber: key },
          { orderNumber: key },
          { externalConsignmentNumber: key },
        ]),
      },
      include: {
        tour: {
          select: {
            tourNumber: true,
            vehicle: { select: { soloplanVehicleId: true } },
          },
        },
      },
      orderBy: { id: 'desc' },
    });
    if (cons) {
      const addr = addressesFromConsignmentDetails(cons.details);
      return {
        vehicleId: cons.tour.vehicle?.soloplanVehicleId || undefined,
        transportOrderNumber: cons.soloplanOrderNumber || keys[0],
        tourNumber: cons.tour.tourNumber || undefined,
        receiverName: cons.receiverName || addr.receiverName,
        receiverAddress: addr.receiverAddress,
        senderName: cons.senderName || addr.senderName,
        senderAddress: addr.senderAddress,
      };
    }

    const shipment = await this.prisma.shipment.findFirst({
      where: {
        OR: keys.flatMap((key) => [
          { trackingNumber: key },
          { reference: key },
          { soloplanRef: key },
        ]),
      },
      select: {
        trackingNumber: true,
        reference: true,
        soloplanRef: true,
        deliveryCompany: true,
        deliveryStreet: true,
        deliveryZip: true,
        deliveryCity: true,
        pickupCompany: true,
        pickupStreet: true,
        pickupZip: true,
        pickupCity: true,
      },
      orderBy: { createdAt: 'desc' },
    });
    if (shipment) {
      return {
        transportOrderNumber: shipment.soloplanRef || shipment.trackingNumber || keys[0],
        receiverName: shipment.deliveryCompany || undefined,
        receiverAddress: [
          shipment.deliveryStreet,
          shipment.deliveryZip,
          shipment.deliveryCity,
        ]
          .filter(Boolean)
          .join(', '),
        senderName: shipment.pickupCompany || undefined,
        senderAddress: [shipment.pickupStreet, shipment.pickupZip, shipment.pickupCity]
          .filter(Boolean)
          .join(', '),
      };
    }

    return { transportOrderNumber: keys[0] };
  }

  private move(from: string, to: string) {
    const dir = join(to, '..');
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    try {
      renameSync(from, to);
    } catch {
      throw new Error(`Verschieben fehlgeschlagen: ${basename(from)}`);
    }
    try {
      chmodSync(to, 0o664);
    } catch {
      /* ignore */
    }
  }
}
