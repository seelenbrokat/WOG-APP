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
 * Schreibt OrderEzoll-v4 Updates für Soloplan/CarLo (File-Pickup).
 *
 * Default: Sendungsebene – header + consignment[] mit ordernumber + itemNumber
 * (wie Soloplan-Export). Lookup gezielt auf die Sendung, nicht über Order.
 * Fallback SOLOPLAN_EZOLL_ROOT=order → header + order[].consignments[].
 * CC029 bleibt Tour-Root (header + tour[]).
 */
@Injectable()
export class EzollSoloplanService {
  private readonly log = new Logger(EzollSoloplanService.name);
  private readonly outDir: string;
  /** consignment = flach Sendung (default), order = nested Order-Schema. */
  private readonly rootMode: 'order' | 'consignment';

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
    const mode = String(this.config.get('SOLOPLAN_EZOLL_ROOT') || 'consignment')
      .trim()
      .toLowerCase();
    this.rootMode = mode === 'order' ? 'order' : 'consignment';
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

    return this.writeConsignmentUpdate('cc529', sourceFileName, consignment);
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
    return this.writeConsignmentUpdate(prefix, sourceFileName, consignment);
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

    return this.writeConsignmentUpdate('cc599', sourceFileName, consignment);
  }

  /**
   * CC029C (NCTS) → Tour-Ebene (nicht Consignment):
   * - Match: tourNumber
   * - cC029C: true
   * - mRNATAPI: akkumulierte MRNs (`; `)
   * - lRN: akkumulierte LRNs (`; `)
   * - tarifnummerATAPI: max. Positionsanzahl
   */
  writeCc029TourUpdate(
    tourNumber: number,
    sourceFileName: string,
    fields: EzollCc029WriteFields,
  ): string {
    const mrnJoined = joinEzollMrns(fields.mrns);
    const lrnJoined = joinEzollMrns(fields.lrns);
    const tour: Record<string, unknown> = {
      actionAttribute: 'update',
      tourNumber,
      cC029C: true,
    };
    if (mrnJoined) tour.mRNATAPI = mrnJoined;
    if (lrnJoined) tour.lRN = lrnJoined;
    if (fields.totalItems != null && fields.totalItems > 0) {
      tour.tarifnummerATAPI = fields.totalItems;
    }
    return this.writeJsonFile('cc029', sourceFileName, {
      header: this.header(`ezoll-cc029:${sourceFileName}`),
      tour: [tour],
    });
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

  private writeConsignmentUpdate(
    kind: string,
    sourceFileName: string,
    consignment: Record<string, unknown>,
  ): string {
    const header = this.header(`ezoll-${kind}:${sourceFileName}`);

    if (this.rootMode === 'consignment') {
      return this.writeJsonFile(kind, sourceFileName, {
        header,
        consignment: [consignment],
      });
    }

    // Order-Schema (Soloplan Automate): order.number + consignments[]
    const orderNumber = Number(consignment.ordernumber);
    if (!Number.isFinite(orderNumber) || orderNumber <= 0) {
      throw new Error(`${kind}: ordernumber fehlt für OrderEzoll-Order-Root`);
    }

    return this.writeJsonFile(kind, sourceFileName, {
      header,
      order: [
        {
          actionAttribute: 'update',
          number: orderNumber,
          consignments: [consignment],
        },
      ],
    });
  }

  private header(exportItemReference: string) {
    // Soloplan-Samples nutzen lokale Zeit ohne Millisekunden/Z
    const sendDate = new Date().toISOString().replace(/\.\d{3}Z$/, '').replace(/Z$/, '');
    return {
      sendDate,
      exportItemReference: exportItemReference.slice(0, 120),
    };
  }

  private writeJsonFile(
    kind: string,
    sourceFileName: string,
    payload: Record<string, unknown>,
  ): string {
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
