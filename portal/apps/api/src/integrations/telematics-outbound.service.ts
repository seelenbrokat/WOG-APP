import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  chmodSync,
  existsSync,
  mkdirSync,
  readdirSync,
  renameSync,
  statSync,
  writeFileSync,
} from 'fs';
import { basename, dirname, join } from 'path';
import {
  VLB_PORTAL_TELEMATICS_CONFIG,
  buildDocumentXml,
  buildSsccStatusXml,
  buildTourStatusXml,
  buildTourStopStatusXml,
  buildTransportOrderStatusXml,
  buildVehicleLocationsXml,
  buildMessageXml,
  OutDocument,
  OutSsccStatus,
  OutTourStatus,
  OutTourStopStatus,
  OutTransportOrderStatus,
  OutVehicleLocations,
  OutMessage,
} from './telematics-xml.builder';
import { formatZurichFileStamp } from '../common/zurich-date';

/**
 * Schreibt StdTelematics-Rückmeldungen in den SFTP-Outbound.
 * Telematikkonfiguration: VLBPortal. VehicleId = echte Soloplan-Fahrzeug-ID.
 */
@Injectable()
export class TelematicsOutboundService {
  private readonly logger = new Logger(TelematicsOutboundService.name);
  private readonly outDir: string;

  constructor(private config: ConfigService) {
    const root =
      this.config.get('SFTP_OUTBOUND_DIR') || join(process.cwd(), '../../data/sftp/outbound');
    this.outDir =
      this.config.get('TELEMATTICS_OUT_DIR') || join(root, 'soloplan', 'telematics');
    if (!existsSync(this.outDir)) mkdirSync(this.outDir, { recursive: true });
  }

  get telematicsConfig() {
    return VLB_PORTAL_TELEMATICS_CONFIG;
  }

  status() {
    return {
      outDir: this.outDir,
      telematicsConfig: VLB_PORTAL_TELEMATICS_CONFIG,
      pendingFiles: this.listPending().length,
    };
  }

  listPending() {
    if (!existsSync(this.outDir)) return [];
    return readdirSync(this.outDir)
      .filter((f) => f.endsWith('.xml'))
      .map((fileName) => {
        const full = join(this.outDir, fileName);
        const st = statSync(full);
        return {
          fileName,
          size: st.size,
          modifiedAt: st.mtime.toISOString(),
        };
      })
      .sort((a, b) => b.modifiedAt.localeCompare(a.modifiedAt));
  }

  /** Stellt sicher, dass Soloplan den Outbound-Ordner lesen/löschen kann. */
  ensureOutDir() {
    if (!existsSync(this.outDir)) mkdirSync(this.outDir, { recursive: true });
    try {
      chmodSync(this.outDir, 0o775);
    } catch {
      /* ignore */
    }
    return this.outDir;
  }

  private write(kind: string, xml: string, vehicleId: string, ref?: string) {
    this.ensureOutDir();
    const stamp = formatZurichFileStamp();
    const safeRef = (ref || 'na').replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 40);
    const fileName = `StdTelematics_${kind}_${safeRef}_${stamp}.xml`;
    const full = join(this.outDir, fileName);
    writeFileSync(full, xml, 'utf8');
    try {
      chmodSync(full, 0o664);
    } catch {
      /* ignore */
    }
    this.logger.log(
      `Telematics outbound (${VLB_PORTAL_TELEMATICS_CONFIG}): ${fileName} vehicle=${vehicleId}`,
    );
    return {
      fileName,
      path: full,
      vehicleId,
      telematicsConfig: VLB_PORTAL_TELEMATICS_CONFIG,
      outDir: this.outDir,
    };
  }

  /**
   * Roh-XML der VLB-Zustellapp 1:1 in den Soloplan-FTP-Outbound legen
   * (z. B. aus inbound/vlbportal/telematics).
   */
  writeRawXml(kind: string, xml: string, preferredName?: string) {
    this.ensureOutDir();
    const stamp = formatZurichFileStamp();
    const base = (preferredName || `StdTelematics_${kind}_${stamp}.xml`)
      .replace(/[/\\]/g, '_')
      .replace(/[^\w.\-]+/g, '_');
    const fileName = base.toLowerCase().endsWith('.xml') ? base : `${base}.xml`;
    let target = join(this.outDir, fileName);
    if (existsSync(target)) {
      target = join(this.outDir, `${stamp}_${fileName}`);
    }
    writeFileSync(target, xml, 'utf8');
    try {
      chmodSync(target, 0o664);
    } catch {
      /* ignore */
    }
    this.logger.log(
      `Telematics outbound raw (${VLB_PORTAL_TELEMATICS_CONFIG}): ${basename(target)}`,
    );
    return {
      fileName: basename(target),
      path: target,
      telematicsConfig: VLB_PORTAL_TELEMATICS_CONFIG,
      outDir: this.outDir,
    };
  }

  sendTourStatus(input: OutTourStatus) {
    const xml = buildTourStatusXml(input);
    return this.write('TourStatus', xml, input.vehicleId, input.tourNumber);
  }

  sendTourStopStatus(input: OutTourStopStatus) {
    const xml = buildTourStopStatusXml(input);
    return this.write(
      'TourStopStatus',
      xml,
      input.vehicleId,
      `${input.tourNumber}_${input.tourStopId}`,
    );
  }

  sendTransportOrderStatus(input: OutTransportOrderStatus) {
    const xml = buildTransportOrderStatusXml(input);
    return this.write('TransportOrderStatus', xml, input.vehicleId, input.transportOrderNumber);
  }

  sendDocument(input: OutDocument) {
    // Ein Ablieferbeleg je Sendung/TO: ältere, noch nicht abgeholte Belege ersetzen
    if (/^Ablieferbeleg-/i.test(input.fileName || '')) {
      this.retirePendingAblieferbeleg(input.transportOrderNumber, input.fileName);
    }
    const xml = buildDocumentXml(input);
    return this.write('Document', xml, input.vehicleId, input.fileName);
  }

  /**
   * Noch im Pickup liegende Ablieferbeleg-XMLs derselben Sendung/TO entfernen,
   * damit Soloplan nicht einen Beleg je Collo/Foto importiert.
   */
  retirePendingAblieferbeleg(transportOrderNumber?: string | null, fileName?: string | null) {
    if (!existsSync(this.outDir)) return 0;
    const toSafe = String(transportOrderNumber || '')
      .replace(/[^a-zA-Z0-9_-]/g, '_')
      .slice(0, 40);
    const nameSafe = String(fileName || '')
      .replace(/[^a-zA-Z0-9_-]/g, '_')
      .slice(0, 40);
    if (!toSafe && !nameSafe) return 0;
    const archiveDir = join(dirname(this.outDir), 'archive');
    if (!existsSync(archiveDir)) mkdirSync(archiveDir, { recursive: true });
    let retired = 0;
    for (const f of readdirSync(this.outDir)) {
      if (!f.endsWith('.xml') || !f.includes('_Document_')) continue;
      if (!/Ablieferbeleg/i.test(f)) continue;
      const matchesTo = Boolean(toSafe && f.includes(toSafe));
      const matchesName = Boolean(nameSafe && f.includes(nameSafe));
      if (!matchesTo && !matchesName) continue;
      try {
        renameSync(join(this.outDir, f), join(archiveDir, `${Date.now()}_superseded_${f}`));
        retired += 1;
      } catch {
        /* ignore */
      }
    }
    if (retired) {
      this.logger.log(
        `Telematics: ${retired} ältere Ablieferbeleg-XML(s) für TO=${toSafe || '—'} aus Pickup entfernt`,
      );
    }
    return retired;
  }

  sendSsccStatus(input: OutSsccStatus) {
    return this.write(
      'SsccStatus',
      buildSsccStatusXml(input),
      'n/a',
      input.transportOrderNumber,
    );
  }
  sendVehicleLocations(input: OutVehicleLocations) {
    const xml = buildVehicleLocationsXml(input);
    return this.write('VehicleLocations', xml, input.vehicleId, input.tourNumber);
  }

  /**
   * Fahrer-Chat / ETA-Freitext.
   * Soloplan CarLo Automate (StdTelematics-XSD) deklariert kein Root-Element „Message“
   * → Upload erzeugt Fehler_Telematikeingang („element is not declared“).
   * Standard: nur lokal im Portal speichern (kein FTP). Opt-in: TELEMATICS_UPLOAD_CHAT=true.
   */
  sendMessage(input: OutMessage) {
    const upload =
      String(this.config.get('TELEMATICS_UPLOAD_CHAT') || '')
        .trim()
        .toLowerCase() === 'true';
    if (!upload) {
      this.logger.log(
        `Telematics Message nicht an Soloplan (XSD ohne Message) – lokal belassen` +
          ` vehicle=${input.vehicleId}` +
          (input.tourNumber ? ` tour=${input.tourNumber}` : ''),
      );
      return {
        fileName: null as string | null,
        path: null as string | null,
        skipped: true as const,
        reason: 'xsd_message_not_declared',
        vehicleId: input.vehicleId,
        telematicsConfig: VLB_PORTAL_TELEMATICS_CONFIG,
        outDir: this.outDir,
      };
    }
    const xml = buildMessageXml(input);
    return this.write('Message', xml, input.vehicleId, input.tourNumber || 'chat');
  }

}
