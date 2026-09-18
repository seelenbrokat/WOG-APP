import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  statSync,
  writeFileSync,
} from 'fs';
import { basename, extname, join } from 'path';
import { PrismaService } from '../../prisma/prisma.service';
import { formatZurichFileStamp } from '../../common/zurich-date';
import { TelematicsOutboundService } from '../telematics-outbound.service';
import {
  assertNoVipPrices,
  buildVipFile,
  mapVipCountry,
  mapVipUnit,
  partnerStreet,
} from './vip.builder';
import type { VipAddress, VipGoodsLine, VipShipmentInput } from './vip.types';
import { isVipStatusContent, parseVipStatus } from './vip-status.parser';
import { mapVipStatusToTransportOrderStatus } from './vip-status-to-telematics';

type EbeleVehicleRow = {
  id: string;
  soloplanVehicleId: string;
  matchcode: string | null;
  licensePlate: string | null;
  number: string | null;
};

type EbeleConsignmentRow = {
  id: string;
  soloplanOrderNumber: string;
  orderNumber: string | null;
  consignmentIndex: number | null;
  externalConsignmentNumber: string | null;
  senderName: string | null;
  receiverName: string | null;
  details: unknown;
  loadingUnits: unknown;
  tour: {
    id: string;
    tourNumber: string;
    targetStart: Date | null;
    updatedAt: Date;
    vehicle: EbeleVehicleRow | null;
  };
};

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
    if (typeof v === 'object') {
      const nested = asRec(v);
      if (nested) {
        const inner = strField(nested, 'name', 'name1', 'value', '#text');
        if (inner) return inner;
      }
      continue;
    }
    const s = String(v).trim();
    if (s && s !== '[object Object]') return s;
  }
  return '';
}

function numField(obj: Record<string, unknown> | null, ...keys: string[]): number | undefined {
  for (const k of keys) {
    if (!obj) return undefined;
    const v = obj[k];
    if (v == null || v === '') continue;
    const n = Number(v);
    if (Number.isFinite(n)) return n;
  }
  return undefined;
}

function parseMaybeDate(v: unknown): Date | undefined {
  if (!v) return undefined;
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? undefined : v;
  const d = new Date(String(v));
  return Number.isNaN(d.getTime()) ? undefined : d;
}

/**
 * ebele VIP-Datenaustausch (bidirektional).
 *
 * Outbound: Soloplan-Telematik-Touren für Fahrzeug „erbelre“ → VIP K/L (ohne Preise)
 *   → data/sftp/partners/ebele/outbound/
 *
 * Inbound: Status (gpANLAGE) + POD-Dateien
 *   → data/sftp/partners/ebele/inbound/
 *   → Soloplan StdTelematics TransportOrderStatus / Document
 */
@Injectable()
export class EbeleVipService {
  private readonly log = new Logger(EbeleVipService.name);
  private readonly partnerRoot: string;
  private readonly outboundDir: string;
  private readonly inboundDir: string;
  private readonly stateDir: string;
  private readonly uploadDir: string;
  private readonly anr: string;
  private readonly vehicleMatch: string;
  private readonly enabled: boolean;
  private readonly username: string;

  constructor(
    private prisma: PrismaService,
    private config: ConfigService,
    private telematicsOut: TelematicsOutboundService,
  ) {
    const sftpRoot =
      this.config.get('SFTP_ROOT_DIR') || join(process.cwd(), '../../data/sftp');
    this.username = (
      this.config.get<string>('EBELE_SFTP_USERNAME') || 'ebele'
    )
      .trim()
      .toLowerCase();
    this.partnerRoot = join(sftpRoot, 'partners', this.username);
    this.outboundDir =
      this.config.get('EBELE_OUTBOUND_DIR') || join(this.partnerRoot, 'outbound');
    this.inboundDir =
      this.config.get('EBELE_INBOUND_DIR') || join(this.partnerRoot, 'inbound');
    this.stateDir = join(this.partnerRoot, 'state');
    this.uploadDir =
      this.config.get('UPLOAD_DIR') || join(process.cwd(), '../../data/uploads');
    this.anr = String(this.config.get('EBELE_VIP_ANR') || '890037').trim();
    this.vehicleMatch = String(
      this.config.get('EBELE_VEHICLE_MATCH') || 'erbelre',
    )
      .trim()
      .toLowerCase();
    const flag = String(this.config.get('EBELE_VIP_ENABLED') ?? '1').trim();
    this.enabled = !['0', 'false', 'no', 'off'].includes(flag.toLowerCase());
    this.ensureDirs();
  }

  ensureDirs() {
    for (const dir of [
      this.partnerRoot,
      this.outboundDir,
      this.inboundDir,
      join(this.inboundDir, 'processed'),
      join(this.inboundDir, 'failed'),
      join(this.inboundDir, 'pod'),
      this.stateDir,
      join(this.stateDir, 'exported'),
    ]) {
      if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    }
  }

  status() {
    return {
      enabled: this.enabled,
      username: this.username,
      anr: this.anr,
      vehicleMatch: this.vehicleMatch,
      outboundDir: this.outboundDir,
      inboundDir: this.inboundDir,
      pendingOutbound: existsSync(this.outboundDir)
        ? readdirSync(this.outboundDir).filter((f) => f.endsWith('.txt')).length
        : 0,
      pendingInbound: this.listPendingInbound().length,
    };
  }

  /**
   * Exportiert offene Tour-Sendungen des Fahrzeugs erbelre als VIP-Datei.
   */
  async processOutbound(limit = 40): Promise<{
    exported: number;
    skipped: number;
    files: string[];
  }> {
    if (!this.enabled) return { exported: 0, skipped: 0, files: [] };
    this.ensureDirs();

    const vehicles = await this.findEbeleVehicles();
    if (!vehicles.length) {
      return { exported: 0, skipped: 0, files: [] };
    }

    const vehicleIds = vehicles.map((v: EbeleVehicleRow) => v.id);
    const since = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000);
    const consignments = (await this.prisma.tourConsignment.findMany({
      where: {
        tour: {
          vehicleId: { in: vehicleIds },
          OR: [{ updatedAt: { gte: since } }, { targetStart: { gte: since } }],
          lastAction: { not: 'Delete' },
        },
      },
      include: {
        tour: {
          select: {
            id: true,
            tourNumber: true,
            targetStart: true,
            updatedAt: true,
            vehicle: {
              select: {
                id: true,
                soloplanVehicleId: true,
                matchcode: true,
                licensePlate: true,
                number: true,
              },
            },
          },
        },
      },
      orderBy: { id: 'desc' },
      take: Math.max(limit * 3, 60),
    })) as EbeleConsignmentRow[];

    const pending = consignments
      .filter((c: EbeleConsignmentRow) => !this.isExported(c.id))
      .slice(0, limit);
    if (!pending.length) return { exported: 0, skipped: consignments.length, files: [] };

    const shipments: VipShipmentInput[] = [];
    const exportedIds: string[] = [];
    for (const cons of pending) {
      try {
        const shipment = this.consignmentToVip(cons);
        assertNoVipPrices(
          buildVipFile([shipment], { anr: this.anr, lineEnding: '\r\n' }),
        );
        shipments.push(shipment);
        exportedIds.push(cons.id);
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        this.log.warn(`ebele VIP Skip ${cons.soloplanOrderNumber}: ${msg}`);
      }
    }

    if (!shipments.length) return { exported: 0, skipped: pending.length, files: [] };

    const stamp = formatZurichFileStamp();
    const fileName = `VIP_ebele_${stamp}.txt`;
    const content = buildVipFile(shipments, { anr: this.anr, lineEnding: '\r\n' });
    assertNoVipPrices(content);
    const full = join(this.outboundDir, fileName);
    writeFileSync(full, content, 'utf8');
    try {
      chmodSync(full, 0o664);
    } catch {
      /* ignore */
    }

    for (const id of exportedIds) {
      this.markExported(id, fileName);
    }

    this.log.log(
      `ebele VIP outbound: ${fileName} (${shipments.length} Sendungen, Fahrzeug=${this.vehicleMatch})`,
    );
    return { exported: shipments.length, skipped: 0, files: [fileName] };
  }

  /**
   * Verarbeitet Status- und POD-Dateien aus dem ebele-Inbound.
   */
  async processInbound(limit = 40): Promise<{
    processed: number;
    failed: number;
    events: number;
    pods: number;
    files: string[];
  }> {
    if (!this.enabled) {
      return { processed: 0, failed: 0, events: 0, pods: 0, files: [] };
    }
    this.ensureDirs();

    let processed = 0;
    let failed = 0;
    let events = 0;
    let pods = 0;
    const files: string[] = [];

    for (const full of this.listPendingInbound().slice(0, limit)) {
      const name = basename(full);
      try {
        const result = await this.processInboundFile(full, name);
        processed += 1;
        events += result.events;
        pods += result.pods;
        files.push(name);
        this.move(full, join(this.inboundDir, 'processed', `${Date.now()}_${name}`));
      } catch (err: unknown) {
        failed += 1;
        const msg = err instanceof Error ? err.message : String(err);
        this.log.warn(`ebele inbound ${name}: ${msg}`);
        try {
          this.move(full, join(this.inboundDir, 'failed', `${Date.now()}_${name}`));
        } catch {
          /* ignore */
        }
      }
    }

    return { processed, failed, events, pods, files };
  }

  private async processInboundFile(filePath: string, fileName: string) {
    const ext = extname(fileName).toLowerCase();
    const isBinaryPod = ['.pdf', '.png', '.jpg', '.jpeg', '.tif', '.tiff', '.gif'].includes(
      ext,
    );

    if (isBinaryPod) {
      await this.processPodFile(filePath, fileName);
      return { events: 0, pods: 1 };
    }

    const raw = readFileSync(filePath);
    const utf8 = raw.toString('utf8');
    const latin1 = raw.toString('latin1');
    const content = isVipStatusContent(utf8)
      ? utf8
      : isVipStatusContent(latin1)
        ? latin1
        : utf8;

    if (!isVipStatusContent(content)) {
      // Unbekanntes Textfile – wenn Dateiname nach POD aussieht, parken
      throw new Error('Unbekanntes Format – erwartet VIP-Status (ANR;B001-G…;Datum;Zeit;…)');
    }

    const msg = parseVipStatus(content, fileName);
    if (!msg.events.length) throw new Error('VIP-Status ohne Ereignisse');

    let written = 0;
    for (const ev of msg.events) {
      const mapped = mapVipStatusToTransportOrderStatus(ev);
      if (!mapped) continue;

      const resolved = await this.resolveVehicleAndOrder(mapped.matchKeys);
      const vehicleId = await this.resolveVehicleId(resolved.vehicleId);
      if (!vehicleId) {
        this.log.warn(
          `ebele Status: keine VehicleId für ${mapped.transportOrderNumber} – geparkt`,
        );
        continue;
      }

      const orderNumber = resolved.transportOrderNumber || mapped.transportOrderNumber;
      this.telematicsOut.sendTransportOrderStatus({
        vehicleId,
        transportOrderNumber: orderNumber,
        status: mapped.status,
        statusText: mapped.statusText,
        statusDate: mapped.statusDate,
      });
      written += 1;
      this.log.log(
        `ebele Status: ${orderNumber} ${mapped.originalCode}→${mapped.status} vehicle=${vehicleId}`,
      );
    }

    return { events: written, pods: 0 };
  }

  private async processPodFile(filePath: string, fileName: string) {
    const stem = basename(fileName, extname(fileName));
    const keys = stem
      .split(/[_\s]+/)
      .map((s) => s.trim())
      .filter((s) => s.length >= 4);
    keys.unshift(stem);

    const resolved = await this.resolveVehicleAndOrder(keys);
    const vehicleId = await this.resolveVehicleId(resolved.vehicleId);
    if (!vehicleId) {
      throw new Error(`POD ohne VehicleId (Datei ${fileName})`);
    }
    const orderNumber = resolved.transportOrderNumber || keys[0];
    const destDir = join(this.uploadDir, 'telematics', 'partner-status', this.username);
    if (!existsSync(destDir)) mkdirSync(destDir, { recursive: true });
    const destName = `POD_${orderNumber.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 60)}_${Date.now()}${extname(fileName)}`;
    const dest = join(destDir, destName);
    copyFileSync(filePath, dest);

    const buf = readFileSync(dest);
    this.telematicsOut.sendDocument({
      vehicleId,
      tourNumber: resolved.tourNumber,
      transportOrderNumber: orderNumber,
      fileName: destName,
      contentBase64: buf.toString('base64'),
    });
    this.log.log(`ebele POD: ${destName} → Soloplan TO=${orderNumber}`);
  }

  private consignmentToVip(cons: EbeleConsignmentRow): VipShipmentInput {
    const details = asRec(cons.details);
    const senderRaw = asRec(details?.sender) || asRec(details?.differentLoadingPoint);
    const receiverRaw =
      asRec(details?.receiver) || asRec(details?.differentUnloadingPoint);
    const freight = asRec(details?.freight);
    const planned = asRec(details?.planned);
    const remarks = asRec(details?.remarks);

    const sender = this.partnerFromDetails(senderRaw, cons.senderName);
    const receiver = this.partnerFromDetails(receiverRaw, cons.receiverName);

    const auftnr =
      cons.soloplanOrderNumber ||
      (cons.orderNumber
        ? `${cons.orderNumber}.${cons.consignmentIndex ?? 1}`
        : cons.externalConsignmentNumber || cons.id);

    const lsr =
      cons.externalConsignmentNumber ||
      (cons.orderNumber
        ? `${cons.orderNumber}.${cons.consignmentIndex ?? 1}`
        : auftnr);

    const goods = this.goodsFromDetails(details, freight, cons.loadingUnits);

    return {
      orderNumber: auftnr,
      deliveryNote: lsr,
      orderDate: cons.tour.targetStart || new Date(),
      loadingFrom: parseMaybeDate(planned?.loadingFrom) || cons.tour.targetStart || undefined,
      loadingUntil: parseMaybeDate(planned?.loadingUntil),
      unloadingFrom: parseMaybeDate(planned?.unloadingFrom),
      unloadingUntil: parseMaybeDate(planned?.unloadingUntil),
      loadingRemark1: strField(remarks, 'senderInformation1') || undefined,
      loadingRemark2: strField(remarks, 'senderInformation2') || undefined,
      unloadingRemark1: strField(remarks, 'receiverInformation') || undefined,
      sender,
      receiver,
      palletCount: this.palletCountFromLoadingUnits(cons.loadingUnits),
      loadingMeter: numField(freight, 'loadingMeter'),
      storagePlaces: numField(freight, 'storagePlaces'),
      goods,
    };
  }

  private partnerFromDetails(
    raw: Record<string, unknown> | null,
    fallbackName?: string | null,
  ): VipAddress {
    const addr = asRec(raw?.address) || raw;
    const contact = asRec(raw?.contact) || asRec(raw?.contactPerson);
    const country =
      strField(asRec(addr?.country) || asRec(raw?.country), 'IsoAlpha2', 'Matchcode', 'isoAlpha2') ||
      strField(addr, 'country', 'Country') ||
      strField(raw, 'country');
    const street = partnerStreet(
      strField(addr, 'street', 'Street', 'strasse') || strField(raw, 'street'),
      strField(addr, 'houseNumber', 'HouseNumber', 'houseNo') ||
        strField(raw, 'houseNumber'),
    );
    const name =
      strField(raw, 'name', 'name1', 'Name1', 'company') ||
      fallbackName ||
      '';
    const name2 = strField(raw, 'name2', 'Name2');
    return {
      name: name || undefined,
      name2: name2 || undefined,
      street: street || undefined,
      country: mapVipCountry(country) || country || undefined,
      zip: strField(addr, 'zip', 'ZipCode', 'zipCode', 'plz') || undefined,
      city: strField(addr, 'city', 'City1', 'city1', 'ort') || undefined,
      phone:
        strField(contact, 'telephoneNumber', 'TelephoneNumber', 'phone', 'mobilePhoneNumber') ||
        undefined,
      contactName:
        [strField(contact, 'firstName', 'FirstName'), strField(contact, 'lastName', 'LastName')]
          .filter(Boolean)
          .join(' ')
          .trim() ||
        strField(contact, 'lastName', 'LastName', 'name') ||
        undefined,
    };
  }

  private goodsFromDetails(
    details: Record<string, unknown> | null,
    freight: Record<string, unknown> | null,
    loadingUnits: unknown,
  ): VipGoodsLine[] {
    const itemsRaw = details?.items;
    const items = Array.isArray(itemsRaw)
      ? itemsRaw
      : itemsRaw
        ? [itemsRaw]
        : [];

    const lines: VipGoodsLine[] = [];
    let pos = 1;
    for (const item of items) {
      const rec = asRec(item);
      if (!rec) continue;
      const itemFreight = asRec(rec.freight) || freight;
      const ssccs = Array.isArray(rec.ssccs)
        ? rec.ssccs.map((s) => String(s)).filter(Boolean)
        : [];
      lines.push({
        position: pos,
        articleNumber: strField(itemFreight, 'articleNumber') || undefined,
        quantity:
          numField(itemFreight, 'quantity') ??
          numField(rec, 'quantity') ??
          1,
        unit: mapVipUnit(
          strField(itemFreight, 'unit', 'packaging') || strField(rec, 'unit'),
        ),
        lengthCm: numField(itemFreight, 'length'),
        widthCm: numField(itemFreight, 'width'),
        heightCm: numField(itemFreight, 'height'),
        content:
          strField(itemFreight, 'content', 'content2') ||
          strField(rec, 'content') ||
          undefined,
        weightKg:
          numField(itemFreight, 'effectiveWeightKg', 'chargeableWeightKg', 'carrierWeightKg') ??
          undefined,
        volumeM3: numField(itemFreight, 'cubicMeter'),
        packaging: strField(itemFreight, 'packaging') || undefined,
        barcodeNve: ssccs[0] || strField(itemFreight, 'eanCode') || undefined,
        dangerousGoods: Boolean(rec.dangerousGoods),
      });
      pos += 1;
    }

    if (!lines.length) {
      const qty =
        numField(freight, 'quantity') ??
        this.palletCountFromLoadingUnits(loadingUnits) ??
        1;
      const unitFromLu = this.unitFromLoadingUnits(loadingUnits);
      lines.push({
        position: 1,
        quantity: qty,
        unit: mapVipUnit(unitFromLu || strField(freight, 'unit', 'packaging')),
        content: strField(freight, 'content', 'content2') || 'Sendung',
        weightKg:
          numField(freight, 'effectiveWeightKg', 'chargeableWeightKg', 'carrierWeightKg') ??
          undefined,
        volumeM3: numField(freight, 'cubicMeter'),
        lengthCm: numField(freight, 'length'),
        widthCm: numField(freight, 'width'),
        heightCm: numField(freight, 'height'),
      });
    }
    return lines;
  }

  private palletCountFromLoadingUnits(loadingUnits: unknown): number | undefined {
    if (!Array.isArray(loadingUnits)) return undefined;
    let sum = 0;
    for (const u of loadingUnits) {
      const rec = asRec(u);
      if (!rec) continue;
      const mc = strField(rec, 'matchcode', 'Matchcode').toLowerCase();
      if (/ep|pal|eur|plt/.test(mc)) {
        sum += numField(rec, 'quantity') ?? 0;
      }
    }
    return sum || undefined;
  }

  private unitFromLoadingUnits(loadingUnits: unknown): string | undefined {
    if (!Array.isArray(loadingUnits) || !loadingUnits.length) return undefined;
    const rec = asRec(loadingUnits[0]);
    return strField(rec, 'matchcode', 'Matchcode') || undefined;
  }

  private async findEbeleVehicles(): Promise<EbeleVehicleRow[]> {
    const org =
      (await this.prisma.organization.findFirst({ where: { slug: 'wog' } })) ||
      (await this.prisma.organization.findFirst());
    if (!org) return [];

    const match = this.vehicleMatch;
    const vehicles = (await this.prisma.vehicle.findMany({
      where: {
        organizationId: org.id,
        active: true,
        OR: [
          { matchcode: { contains: match, mode: 'insensitive' } },
          { soloplanVehicleId: { contains: match, mode: 'insensitive' } },
          { licensePlate: { contains: match, mode: 'insensitive' } },
          { number: { contains: match, mode: 'insensitive' } },
        ],
      },
      select: {
        id: true,
        soloplanVehicleId: true,
        matchcode: true,
        licensePlate: true,
        number: true,
      },
    })) as EbeleVehicleRow[];
    return vehicles;
  }

  private async resolveVehicleId(fromDb?: string): Promise<string> {
    if (fromDb?.trim()) return fromDb.trim();
    const fromEnv =
      this.config.get<string>('EBELE_DEFAULT_VEHICLE_ID') ||
      this.config.get<string>('PARTNER_STATUS_DEFAULT_VEHICLE_ID') ||
      '';
    if (fromEnv.trim()) return fromEnv.trim();
    const vehicles = await this.findEbeleVehicles();
    return vehicles[0]?.soloplanVehicleId || '';
  }

  private async resolveVehicleAndOrder(refs: string[]): Promise<{
    vehicleId?: string;
    transportOrderNumber?: string;
    tourNumber?: string;
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
      return {
        vehicleId: cons.tour.vehicle?.soloplanVehicleId || undefined,
        transportOrderNumber: cons.soloplanOrderNumber || keys[0],
        tourNumber: cons.tour.tourNumber || undefined,
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
      select: { soloplanRef: true, trackingNumber: true },
      orderBy: { createdAt: 'desc' },
    });
    if (shipment) {
      return {
        transportOrderNumber: shipment.soloplanRef || shipment.trackingNumber || keys[0],
      };
    }

    return { transportOrderNumber: keys[0] };
  }

  private isExported(consignmentId: string): boolean {
    return existsSync(join(this.stateDir, 'exported', `${consignmentId}.txt`));
  }

  private markExported(consignmentId: string, fileName: string) {
    const dir = join(this.stateDir, 'exported');
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    writeFileSync(
      join(dir, `${consignmentId}.txt`),
      `${new Date().toISOString()}\t${fileName}\n`,
      'utf8',
    );
  }

  private listPendingInbound(): string[] {
    if (!existsSync(this.inboundDir)) return [];
    return readdirSync(this.inboundDir)
      .filter((f) => {
        if (f.startsWith('.')) return false;
        if (['processed', 'failed', 'pod'].includes(f)) return false;
        const full = join(this.inboundDir, f);
        try {
          return statSync(full).isFile();
        } catch {
          return false;
        }
      })
      .sort()
      .map((f) => join(this.inboundDir, f));
  }

  private move(from: string, to: string) {
    const dir = join(to, '..');
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    renameSync(from, to);
    try {
      chmodSync(to, 0o664);
    } catch {
      /* ignore */
    }
  }
}
