import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { existsSync, mkdirSync, writeFileSync, readdirSync, statSync } from 'fs';
import { join } from 'path';
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

  private write(kind: string, xml: string, vehicleId: string, ref?: string) {
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const safeRef = (ref || 'na').replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 40);
    const fileName = `StdTelematics_${kind}_${safeRef}_${stamp}.xml`;
    const full = join(this.outDir, fileName);
    writeFileSync(full, xml, 'utf8');
    this.logger.log(
      `Telematics outbound (${VLB_PORTAL_TELEMATICS_CONFIG}): ${fileName} vehicle=${vehicleId}`,
    );
    return {
      fileName,
      path: full,
      vehicleId,
      telematicsConfig: VLB_PORTAL_TELEMATICS_CONFIG,
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
