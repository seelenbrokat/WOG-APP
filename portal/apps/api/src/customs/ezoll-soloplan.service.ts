import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { chmodSync, existsSync, mkdirSync, writeFileSync } from 'fs';
import { join } from 'path';
import type { EzollCc529Fields, EzollSoloplanMatch } from '@wog/shared';

/**
 * Schreibt OrderEzoll-v4 Consignment-Updates für Soloplan/CarLo (File-Pickup).
 * Zuordnung nur über Tour / Auftrag / Auftrag.Sendung – nie externalNumber / MRN.
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
   * CC529CC (ABD) →
   * - Match: ordernumber + itemNumber (Auftrag.Sendungsnummer, z. B. 442397.1)
   * - cC529C = true
   * - mRNATAPI = BCP MRN (Schreibfeld, kein Match)
   * - lRN = LRN [12 09]
   * - tarifnummerATAPI = Total items (Anzahl Tarifpositionen)
   * - eUR1_API = EUR.1-Nummer wenn Supporting document N954 vorhanden
   */
  writeCc529FlagUpdate(
    match: EzollSoloplanMatch,
    sourceFileName: string,
    fields: EzollCc529Fields = {
      mrn: null,
      lrn: null,
      totalItems: null,
      eur1Number: null,
    },
  ): string {
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
    } else if (match.kind === 'tour') {
      throw new Error('CC529-Update braucht Auftrag/Sendung, nicht nur Tour');
    }

    if (fields.mrn) consignment.mRNATAPI = fields.mrn;
    if (fields.lrn) consignment.lRN = fields.lrn;
    if (fields.totalItems != null && fields.totalItems > 0) {
      consignment.tarifnummerATAPI = fields.totalItems;
    }
    if (fields.eur1Number) consignment.eUR1_API = fields.eur1Number;

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
