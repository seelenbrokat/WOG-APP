import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { chmodSync, existsSync, mkdirSync, writeFileSync } from 'fs';
import { join } from 'path';
import {
  joinEzollMrns,
  type EzollCc529Fields,
  type EzollCc599Fields,
  type EzollEz92xFields,
  type EzollSoloplanMatch,
} from '@wog/shared';

export type EzollCc029WriteFields = {
  /** Akkumulierte MRNs (7-Tage-Tour-Cache) → mRNATAPI. */
  mrns: string[];
  /** Akkumulierte LRNs → lRN. */
  lrns: string[];
  totalItems: number | null;
};

/**
 * Schreibt OrderEzoll-v4 Consignment-Updates für Soloplan/CarLo (File-Pickup).
 * Zuordnung nur über Tour / Auftrag / Auftrag.Sendung – nie externalNumber / MRN/CRN.
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
   * - Match: ordernumber + itemNumber
   * - cC529C, mRNATAPI, lRN, tarifnummerATAPI, eUR1_API
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
    this.applyMatch(consignment, match, 'CC529');

    if (fields.mrn) consignment.mRNATAPI = fields.mrn;
    if (fields.lrn) consignment.lRN = fields.lrn;
    if (fields.totalItems != null && fields.totalItems > 0) {
      consignment.tarifnummerATAPI = fields.totalItems;
    }
    if (fields.eur1Number) consignment.eUR1_API = fields.eur1Number;

    return this.writePayload('cc529', sourceFileName, consignment);
  }

  /**
   * EZ922 / EZ923 →
   * - Match: ordernumber + itemNumber (Dateiname)
   * - eZ922 / eZ923 = true
   * - CRN → mRNATAPI
   * - DefPayRef (Abgabenkonto) → aufschubkonto
   * - DutyCalc EUSt → mWSTAT
   * - DutyCalc Zoll → zollabgabenAT
   * - TotItem → tarifnummerATAPI
   */
  writeEz92xUpdate(
    match: EzollSoloplanMatch,
    sourceFileName: string,
    fields: EzollEz92xFields,
  ): string {
    const consignment: Record<string, unknown> = {
      actionAttribute: 'update',
    };
    if (fields.msgTyp === 'EZ922') consignment.eZ922 = true;
    else consignment.eZ923 = true;

    this.applyMatch(consignment, match, fields.msgTyp);

    if (fields.crn) consignment.mRNATAPI = fields.crn;
    if (fields.abgabenkonto) consignment.aufschubkonto = fields.abgabenkonto;
    if (fields.mwstAt != null) consignment.mWSTAT = fields.mwstAt;
    if (fields.zollabgabenAt != null) consignment.zollabgabenAT = fields.zollabgabenAt;
    if (fields.totalItems != null && fields.totalItems > 0) {
      consignment.tarifnummerATAPI = fields.totalItems;
    }

    const prefix = fields.msgTyp === 'EZ922' ? 'ez922' : 'ez923';
    return this.writePayload(prefix, sourceFileName, consignment);
  }

  /**
   * CC599C (Austrittsbestätigung / IE599) →
   * - immer cC599C: true
   * - MRN/LRN/Tarif/EUR.1 nur wenn keine Ausfuhr (CC529) vorlag (includeValues)
   */
  writeCc599FlagUpdate(
    match: EzollSoloplanMatch,
    sourceFileName: string,
    fields: EzollCc599Fields = {
      mrn: null,
      lrn: null,
      totalItems: null,
      eur1Number: null,
    },
    includeValues = false,
  ): string {
    const consignment: Record<string, unknown> = {
      actionAttribute: 'update',
      cC599C: true,
    };
    this.applyMatch(consignment, match, 'CC599');

    if (includeValues) {
      if (fields.mrn) consignment.mRNATAPI = fields.mrn;
      if (fields.lrn) consignment.lRN = fields.lrn;
      if (fields.totalItems != null && fields.totalItems > 0) {
        consignment.tarifnummerATAPI = fields.totalItems;
      }
      if (fields.eur1Number) consignment.eUR1_API = fields.eur1Number;
    }

    return this.writePayload('cc599', sourceFileName, consignment);
  }

  /**
   * CC029C (NCTS) → alle Sendungen einer Tour:
   * - Match: ordernumber + itemNumber (aus Portal-Tour)
   * - cC029C: true
   * - mRNATAPI: akkumulierte MRNs (`; `)
   * - lRN: akkumulierte LRNs (`; `)
   * - tarifnummerATAPI: max. Positionsanzahl
   */
  writeCc029TourUpdates(
    matches: EzollSoloplanMatch[],
    sourceFileName: string,
    fields: EzollCc029WriteFields,
  ): string[] {
    const mrnJoined = joinEzollMrns(fields.mrns);
    const lrnJoined = joinEzollMrns(fields.lrns);
    const paths: string[] = [];

    for (const match of matches) {
      if (match.kind !== 'orderConsignment' && match.kind !== 'order') {
        throw new Error('CC029-Update braucht Auftrag/Sendung, nicht nur Tour');
      }
      const consignment: Record<string, unknown> = {
        actionAttribute: 'update',
        cC029C: true,
      };
      this.applyMatch(consignment, match, 'CC029');
      if (mrnJoined) consignment.mRNATAPI = mrnJoined;
      if (lrnJoined) consignment.lRN = lrnJoined;
      if (fields.totalItems != null && fields.totalItems > 0) {
        consignment.tarifnummerATAPI = fields.totalItems;
      }
      paths.push(this.writePayload('cc029', sourceFileName, consignment));
    }
    return paths;
  }

  private applyMatch(
    consignment: Record<string, unknown>,
    match: EzollSoloplanMatch,
    label: string,
  ) {
    if (match.kind === 'orderConsignment') {
      consignment.ordernumber = match.orderNumber;
      consignment.itemNumber = match.consignmentIndex;
    } else if (match.kind === 'order') {
      consignment.ordernumber = match.orderNumber;
      consignment.itemNumber = 1;
    } else {
      throw new Error(`${label}-Update braucht Auftrag/Sendung, nicht nur Tour`);
    }
  }

  private writePayload(
    kind: string,
    sourceFileName: string,
    consignment: Record<string, unknown>,
  ): string {
    const payload = {
      header: {
        sendDate: new Date().toISOString(),
        exportItemReference: `ezoll-${kind}:${sourceFileName}`.slice(0, 120),
      },
      consignment: [consignment],
    };

    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const safe = sourceFileName.replace(/[^\w.\-]+/g, '_').slice(0, 80);
    const fileName = `orderezoll-${kind}-${stamp}-${safe}.json`;
    const path = join(this.outDir, fileName);
    if (!existsSync(this.outDir)) mkdirSync(this.outDir, { recursive: true });
    writeFileSync(path, JSON.stringify(payload, null, 2));
    try {
      chmodSync(this.outDir, 0o775);
      chmodSync(path, 0o664);
    } catch {
      /* ignore */
    }
    this.log.log(`OrderEzoll ${kind.toUpperCase()} → ${path}`);
    return path;
  }
}
