import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { existsSync, mkdirSync, writeFileSync, readdirSync, statSync } from 'fs';
import { join } from 'path';
import {
  VLB_PORTAL_VEHICLE_ID,
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
 * Schreibt StdTelematics-Rückmeldungen in den SFTP-Outbound
 * (Soloplan holt Dateien dort ab). VehicleId standardmäßig „VLBPortal“.
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

  get vehicleId() {
    return VLB_PORTAL_VEHICLE_ID;
  }

  status() {
    return {
      outDir: this.outDir,
      vehicleId: VLB_PORTAL_VEHICLE_ID,
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

  private write(kind: string, xml: string, ref?: string) {
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const safeRef = (ref || 'na').replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 40);
    const fileName = `StdTelematics_${kind}_${safeRef}_${stamp}.xml`;
    const full = join(this.outDir, fileName);
    writeFileSync(full, xml, 'utf8');
    this.logger.log(`Telematics outbound: ${fileName}`);
    return { fileName, path: full, vehicleId: VLB_PORTAL_VEHICLE_ID };
  }

  sendTourStatus(input: OutTourStatus) {
    return this.write(
      'TourStatus',
      buildTourStatusXml({ ...input, vehicleId: input.vehicleId || VLB_PORTAL_VEHICLE_ID }),
      input.tourNumber,
    );
  }

  sendTourStopStatus(input: OutTourStopStatus) {
    return this.write(
      'TourStopStatus',
      buildTourStopStatusXml({ ...input, vehicleId: input.vehicleId || VLB_PORTAL_VEHICLE_ID }),
      `${input.tourNumber}_${input.tourStopId}`,
    );
  }

  sendTransportOrderStatus(input: OutTransportOrderStatus) {
    return this.write(
      'TransportOrderStatus',
      buildTransportOrderStatusXml({
        ...input,
        vehicleId: input.vehicleId || VLB_PORTAL_VEHICLE_ID,
      }),
      input.transportOrderNumber,
    );
  }

  sendDocument(input: OutDocument) {
    return this.write(
      'Document',
      buildDocumentXml({ ...input, vehicleId: input.vehicleId || VLB_PORTAL_VEHICLE_ID }),
      input.fileName,
    );
  }

  sendSsccStatus(input: OutSsccStatus) {
    return this.write('SsccStatus', buildSsccStatusXml(input), input.transportOrderNumber);
  }
}
