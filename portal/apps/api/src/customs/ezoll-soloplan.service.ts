import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { chmodSync, existsSync, mkdirSync, writeFileSync } from 'fs';
import { join } from 'path';
import type { EzollSoloplanMatch } from '@wog/shared';

/**
 * Schreibt OrderEzoll-v4 Consignment-Updates für Soloplan/CarLo (File-Pickup).
 * Zuordnung nur über Tour / Auftrag / Auftrag.Sendung / MRN – nie externalNumber.
 */
@Injectable()
export class EzollSoloplanService {
  private readonly log = new Logger(EzollSoloplanService.name);
  private readonly outDir: string;

  constructor(private config: ConfigService) {
    const sftpOut =
      this.config.get('SOLOPLAN_EZOLL_OUT_DIR') ||
      join(
        this.config.get('SFTP_OUTBOUND_DIR') ||
          join(process.cwd(), '../../data/sftp/outbound'),
        'soloplan',
        'ezoll',
      );
    this.outDir = sftpOut;
    if (!existsSync(this.outDir)) mkdirSync(this.outDir, { recursive: true });
  }

  /**
   * CC529CC (ABD) → Sendung CFBOOLEAN2 / cC529C = true
   */
  writeCc529FlagUpdate(match: EzollSoloplanMatch, sourceFileName: string): string {
    const consignment: Record<string, unknown> = {
      actionAttribute: 'update',
      cC529C: true,
    };

    if (match.kind === 'orderConsignment') {
      consignment.ordernumber = match.orderNumber;
      consignment.itemNumber = match.consignmentIndex;
    } else if (match.kind === 'order') {
      consignment.ordernumber = match.orderNumber;
      consignment.itemNumber = 1;
    } else if (match.kind === 'mrn') {
      consignment.mRNATAPI = match.mrn;
    } else if (match.kind === 'tour') {
      // Tour-Ebene: OrderEzoll Consignment-Update braucht Auftrag/Sendung/MRN.
      // Tour allein hier nicht schreibbar → Caller soll unmatched melden.
      throw new Error('CC529-Update braucht Auftrag/Sendung oder MRN, nicht nur Tour');
    }

    const payload = {
      header: {
        sendDate: new Date().toISOString(),
        exportItemReference: `ezoll-cc529:${sourceFileName}`.slice(0, 120),
      },
      consignment: [consignment],
    };

    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const safe = sourceFileName.replace(/[^\w.\-]+/g, '_').slice(0, 80);
    const fileName = `orderezoll-cc529-${stamp}-${safe}.json`;
    const path = join(this.outDir, fileName);
    if (!existsSync(this.outDir)) mkdirSync(this.outDir, { recursive: true });
    writeFileSync(path, JSON.stringify(payload, null, 2));
    try {
      chmodSync(this.outDir, 0o775);
      chmodSync(path, 0o664);
    } catch {
      /* ignore */
    }
    this.log.log(`OrderEzoll CC529 → ${path}`);
    return path;
  }
}
