import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { chmodSync, existsSync, mkdirSync, writeFileSync, readdirSync, statSync } from 'fs';
import { basename, join } from 'path';
import {
  VLB_PORTAL_TELEMATICS_CONFIG,
  buildDocumentXml,
  buildSsccStatusXml,
  buildTourStatusXml,
  buildTourStopStatusXml,
  buildTransportOrderStatusXml,
  OutDocument,
  OutSsccStatus,
  OutTourStatus,
  OutTourStopStatus,
  OutTransportOrderStatus,
} from './telematics-xml.builder';

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
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
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
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
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
    const xml = buildDocumentXml(input);
    return this.write('Document', xml, input.vehicleId, input.fileName);
  }

  sendSsccStatus(input: OutSsccStatus) {
    return this.write(
      'SsccStatus',
      buildSsccStatusXml(input),
      'n/a',
      input.transportOrderNumber,
    );
  }
}
