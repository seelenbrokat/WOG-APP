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
} from 'fs';
import { basename, join } from 'path';
import { PrismaService } from '../prisma/prisma.service';
import { TelematicsOutboundService } from './telematics-outbound.service';
import { isStat512Content, parseStat512 } from './fortras/stat512.parser';
import { mapStat512EventToTransportOrderStatus } from './fortras/stat512-to-telematics';

/**
 * Partner-Status inbound (z. B. BT Swiss FORTRAS STAT512).
 *
 * Ordner: {SFTP_INBOUND}/partner-status/{username}/
 * → Soloplan StdTelematics TransportOrderStatus (outbound/soloplan/telematics)
 *
 * User werden per provision-partner-status-sftp.sh angelegt (Credentials unter
 * data/sftp/credentials/{user}.txt). Alle Unterordner unter partner-status/
 * (außer processed/failed) werden gepollt.
 */
@Injectable()
export class PartnerStatusInboundService {
  private readonly log = new Logger(PartnerStatusInboundService.name);
  private readonly inboundRoot: string;

  constructor(
    private prisma: PrismaService,
    private config: ConfigService,
    private telematicsOut: TelematicsOutboundService,
  ) {
    const sftpInbound =
      this.config.get('SFTP_INBOUND_DIR') || join(process.cwd(), '../../data/sftp/inbound');
    this.inboundRoot = join(sftpInbound, 'partner-status');
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
    // Latin-1 häufig bei FORTRAS; UTF-8 Fallback
    let content = raw.toString('latin1');
    if (!isStat512Content(content)) {
      content = raw.toString('utf8');
    }
    if (!isStat512Content(content)) {
      throw new Error('Unbekanntes Format – erwartet FORTRAS STAT512 (@@PHSTAT512)');
    }

    const msg = parseStat512(content, fileName);
    if (!msg.events.length) {
      throw new Error('STAT512 ohne Q10-Statuszeilen');
    }

    let written = 0;
    for (const ev of msg.events) {
      const mapped = mapStat512EventToTransportOrderStatus(ev);
      if (!mapped) continue;

      const resolved = await this.resolveVehicleAndOrder(mapped.transportOrderNumber);
      const vehicleId =
        resolved.vehicleId ||
        this.config.get<string>('PARTNER_STATUS_DEFAULT_VEHICLE_ID') ||
        this.config.get<string>('BT_SWISS_DEFAULT_VEHICLE_ID') ||
        '';

      if (!vehicleId) {
        this.log.warn(
          `Partner-Status ${username}: keine VehicleId für ${mapped.transportOrderNumber} – Event geparkt (nur geloggt)`,
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
        `Partner-Status ${username}: ${orderNumber} ${mapped.originalCode}→${mapped.status} vehicle=${vehicleId}`,
      );
    }

    return { events: written };
  }

  /**
   * Soloplan-Auftragsnummer + Fahrzeug aus TourConsignment / Shipment ableiten.
   */
  private async resolveVehicleAndOrder(ref: string): Promise<{
    vehicleId?: string;
    transportOrderNumber?: string;
  }> {
    const key = String(ref || '').trim();
    if (!key) return {};

    const cons = await this.prisma.tourConsignment.findFirst({
      where: {
        OR: [
          { soloplanOrderNumber: key },
          { orderNumber: key },
          { externalConsignmentNumber: key },
        ],
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
        transportOrderNumber: cons.soloplanOrderNumber || key,
      };
    }

    const shipment = await this.prisma.shipment.findFirst({
      where: {
        OR: [{ trackingNumber: key }, { reference: key }, { soloplanRef: key }],
      },
      select: { trackingNumber: true, reference: true, soloplanRef: true },
      orderBy: { createdAt: 'desc' },
    });
    if (shipment) {
      return {
        transportOrderNumber: shipment.soloplanRef || shipment.trackingNumber || key,
      };
    }

    return { transportOrderNumber: key };
  }

  private move(from: string, to: string) {
    const dir = join(to, '..');
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    try {
      renameSync(from, to);
    } catch {
      // cross-device fallback not needed on same volume
      throw new Error(`Verschieben fehlgeschlagen: ${basename(from)}`);
    }
    try {
      chmodSync(to, 0o664);
    } catch {
      /* ignore */
    }
  }
}
