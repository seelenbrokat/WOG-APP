import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { chmodSync, chownSync, existsSync, mkdirSync, statSync, writeFileSync } from 'fs';
import { join } from 'path';
import {
  joinEzollMrns,
  type EzollCc529Fields,
  type EzollCc599Fields,
  type EzollEz92xFields,
  type EzollSoloplanMatch,
  type MercurioEdecFields,
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
 * Ausgabeordner für Automate:
 * - Auftrag/Sendung: …/ezoll/consignment/  (JSON-Root abhängig von SOLOPLAN_EZOLL_ROOT)
 * - Tour (18…/CC029): …/ezoll/tour/      → header + tour[]
 *
 * Default JSON-Root = order (nested): order.number → consignments.itemNumber
 * nur innerhalb des Auftrags. Pickup-Pfad bleibt consignment/ (Automate unverändert).
 */
@Injectable()
export class EzollSoloplanService {
  private readonly log = new Logger(EzollSoloplanService.name);
  private readonly consignmentOutDir: string;
  private readonly tourOutDir: string;
  /**
   * order = nested Order-Schema (Default): Automate Order zuerst, dann itemNumber.
   * consignment = flach (Legacy): ordernumber={number}+itemNumber.
   */
  private readonly rootMode: 'order' | 'consignment';

  constructor(private config: ConfigService) {
    const sftpOutbound =
      this.config.get('SFTP_OUTBOUND_DIR') ||
      join(process.cwd(), '../../data/sftp/outbound');
    const base =
      this.config.get('SOLOPLAN_EZOLL_OUT_DIR') ||
      join(sftpOutbound, 'soloplan', 'ezoll');

    this.consignmentOutDir =
      this.config.get('SOLOPLAN_EZOLL_CONSIGNMENT_OUT_DIR') ||
      join(base, 'consignment');
    this.tourOutDir =
      this.config.get('SOLOPLAN_EZOLL_TOUR_OUT_DIR') || join(base, 'tour');

    // Default: nested Order-Root (Order zuerst, dann Sendung innerhalb Auftrag).
    const mode = String(this.config.get('SOLOPLAN_EZOLL_ROOT') || 'order')
      .trim()
      .toLowerCase();
    this.rootMode = mode === 'consignment' ? 'consignment' : 'order';
    this.log.log(`OrderEzoll root mode: ${this.rootMode}`);

    this.ensureDir(this.consignmentOutDir);
    this.ensureDir(this.tourOutDir);
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
   * - DocCerts N954 (EUR.1) → eUR1_API (wie Ausfuhr)
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
    if (fields.eur1Number) consignment.eUR1_API = fields.eur1Number;

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
   * Mercurio CH e-dec (Bezugsschein / Einfuhrliste) →
   * - Match: ordernumber + itemNumber
   * - Flags: bezugsschein / einfuhliste / definitiv
   * - mRNAPI, zollanmeldungsnummer, zugangscode, refNr
   * - kontoZoll / kontoMWST / zAZKonto
   * - zollabgabenCH / mWSTCH / bearbeitungsgebührCH / tarifnummernCHAPI
   */
  writeMercurioEdecUpdate(
    match: EzollSoloplanMatch,
    sourceFileName: string,
    fields: MercurioEdecFields,
  ): string {
    const consignment: Record<string, unknown> = {
      actionAttribute: 'update',
    };
    this.applyMatch(consignment, match, 'MERCURIO');

    if (fields.docType === 'BEZUGSSCHEIN') consignment.bezugsschein = true;
    if (fields.docType === 'EINFUHRLISTE') consignment.einfuhrliste = true;
    // PDF zeigt oft „Einfuhrliste Definitiv“ auch auf dem Bezugsschein
    if (fields.definitiv) {
      consignment.definitiv = true;
      if (fields.docType === 'BEZUGSSCHEIN') consignment.einfuhrliste = true;
    }

    if (fields.chDeclarationNumber) {
      consignment.mRNAPI = fields.chDeclarationNumber;
      consignment.zollanmeldungsnummer = fields.chDeclarationNumber;
    }
    if (fields.accessCode) consignment.zugangscode = fields.accessCode;
    if (fields.refNumber) consignment.refNr = fields.refNumber;
    if (fields.kontoZoll) consignment.kontoZoll = fields.kontoZoll;
    if (fields.kontoMwst) consignment.kontoMWST = fields.kontoMwst;
    if (fields.zazKonto) consignment.zAZKonto = fields.zazKonto;
    if (fields.mwstCh != null) consignment.mWSTCH = fields.mwstCh;
    if (fields.zollabgabenCh != null) consignment.zollabgabenCH = fields.zollabgabenCh;
    if (fields.bearbeitungsgebuehrCh != null) {
      consignment.bearbeitungsgebührCH = fields.bearbeitungsgebuehrCh;
    }
    if (fields.totalItems != null && fields.totalItems > 0) {
      consignment.tarifnummernCHAPI = fields.totalItems;
    }

    const prefix =
      fields.docType === 'BEZUGSSCHEIN'
        ? 'mercurio-bs'
        : fields.docType === 'EINFUHRLISTE'
          ? 'mercurio-el'
          : 'mercurio';
    return this.writeConsignmentUpdate(prefix, sourceFileName, consignment);
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
    return this.writeJsonFile(
      this.tourOutDir,
      'cc029',
      sourceFileName,
      {
        header: this.header(`ezoll-cc029:${sourceFileName}`),
        tour: [tour],
      },
    );
  }

  private applyMatch(
    consignment: Record<string, unknown>,
    match: EzollSoloplanMatch,
    label: string,
  ) {
    if (match.kind === 'orderConsignment') {
      // Für flat root: Interface-Lookup; für order-Root wird ordernumber später entfernt.
      consignment.ordernumber = { number: match.orderNumber };
      consignment.itemNumber = match.consignmentIndex;
    } else if (match.kind === 'order') {
      consignment.ordernumber = { number: match.orderNumber };
      consignment.itemNumber = 1;
    } else {
      throw new Error(`${label}-Update braucht Auftrag/Sendung, nicht nur Tour`);
    }
  }

  /** ordernumber als Lookup-Objekt `{ number }` oder Legacy-Integer. */
  private resolveOrderNumber(ordernumber: unknown): number | null {
    if (ordernumber != null && typeof ordernumber === 'object') {
      const n = Number((ordernumber as { number?: unknown }).number);
      return Number.isFinite(n) && n > 0 ? n : null;
    }
    const n = Number(ordernumber);
    return Number.isFinite(n) && n > 0 ? n : null;
  }

  private writeConsignmentUpdate(
    kind: string,
    sourceFileName: string,
    consignment: Record<string, unknown>,
  ): string {
    const header = this.header(`ezoll-${kind}:${sourceFileName}`);
    const orderNumber = this.resolveOrderNumber(consignment.ordernumber);

    if (this.rootMode === 'consignment') {
      // Legacy flat: Lookup über ordernumber.number + itemNumber (Automate Full-Scan Risiko)
      if (orderNumber == null || consignment.itemNumber == null) {
        throw new Error(`${kind}: flat consignment braucht ordernumber.number+itemNumber`);
      }
      // Sicherstellen: immer Interface-Lookup-Form, nie bare Integer
      consignment.ordernumber = { number: orderNumber };
      return this.writeJsonFile(this.consignmentOutDir, kind, sourceFileName, {
        header,
        consignment: [consignment],
      });
    }

    // Nested Order-Root: Automate bindet Order per number, dann Sendung per itemNumber
    if (orderNumber == null) {
      throw new Error(`${kind}: ordernumber fehlt für OrderEzoll-Order-Root`);
    }

    const { ordernumber: _drop, ...consignmentUnderOrder } = consignment;
    // Gleicher Pickup-Ordner wie bisher (consignment/) – nur JSON-Root ist nested order.
    return this.writeJsonFile(this.consignmentOutDir, kind, sourceFileName, {
      header,
      order: [
        {
          actionAttribute: 'update',
          number: orderNumber,
          consignments: [consignmentUnderOrder],
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
    outDir: string,
    kind: string,
    sourceFileName: string,
    payload: Record<string, unknown>,
  ): string {
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const safe = sourceFileName.replace(/[^\w.\-]+/g, '_').slice(0, 80);
    const fileName = `orderezoll-${kind}-${stamp}-${safe}.json`;
    const path = join(outDir, fileName);
    this.ensureDir(outDir);
    writeFileSync(path, JSON.stringify(payload, null, 2));
    this.applySoloplanPickupPerms(outDir, path);
    this.log.log(`OrderEzoll ${kind.toUpperCase()} → ${path}`);
    return path;
  }

  private ensureDir(dir: string) {
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  }

  /**
   * Soloplan-SFTP-User braucht Gruppenrechte (soloplan), sonst bleibt die Datei
   * nach dem Lesen ggf. stecken bzw. Automate kann nicht löschen/verschieben.
   */
  private applySoloplanPickupPerms(outDir: string, filePath: string) {
    try {
      chmodSync(outDir, 0o2775);
      chmodSync(filePath, 0o664);
      const gid = this.pickupGid(outDir);
      if (gid != null) {
        chownSync(outDir, -1, gid);
        chownSync(filePath, -1, gid);
      }
    } catch {
      /* ignore – Host ohne soloplan-Gruppe / Container ohne Caps */
    }
  }

  private pickupGid(outDir: string): number | null {
    try {
      // Parent (…/ezoll) ist typisch root:soloplan mit setgid
      const parent = join(outDir, '..');
      const st = existsSync(parent) ? statSync(parent) : statSync(outDir);
      return typeof st.gid === 'number' && st.gid > 0 ? st.gid : null;
    } catch {
      return null;
    }
  }
}
