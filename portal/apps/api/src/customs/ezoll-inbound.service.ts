import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { execFileSync } from 'child_process';
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
} from 'fs';
import { basename, join } from 'path';
import { SoloplanService } from '../integrations/soloplan.service';
import {
  detectEzollDocType,
  extractCc029FieldsFromXml,
  extractCc529FieldsFromPdfText,
  extractCc529FieldsFromXml,
  extractCc599FieldsFromPdfText,
  extractCc599FieldsFromXml,
  extractEz92xFieldsFromXml,
  isCc529Xml,
  isCc599Xml,
  matchesFilenameIgnorePrefix,
  parseSoloplanMatchFromFilename,
  parseSoloplanMatchFromLrn,
  soloplanMatchKey,
  type EzollCc529Fields,
  type EzollCc599Fields,
  type EzollSoloplanMatch,
} from '@wog/shared';
import { OrganizationsService } from '../organizations/organizations.service';
import { PrismaService } from '../prisma/prisma.service';
import { CustomerDocumentsInboundService } from '../documents/customer-documents-inbound.service';
import { EzollSoloplanService } from './ezoll-soloplan.service';
import { EzollTourCacheService } from './ezoll-tour-cache.service';
import { EzollConsignmentCacheService } from './ezoll-consignment-cache.service';
import { EzollFreightPayerService } from './ezoll-freight-payer.service';
import { EzollSmartborderService } from './ezoll-smartborder.service';

/**
 * eZoll-Inbound (PDF + XML):
 * 1) Ignore-Muster → processed/ignored/
 * 2) CCATBT02/12 → SmartBorder pdf-ingest (unabhängig von Soloplan-Writes)
 * 3) CC529C(C) → OrderEzoll (bestätigte Felder), XML primär
 * 4) EZ922/EZ923 XML → eZ922/eZ923
 * 5) CC029C XML → Tour-Cache (7 Tage)
 * 6) CC599C(C) → cC599C:true; Werte nur ohne vorherige Ausfuhr; PDF → Kunden CUSTOMS_EXIT
 * Match nur über Auftrag.Sendungsnummer / Tournummer – nie MRN/CRN.
 */
@Injectable()
export class EzollInboundService {
  private readonly log = new Logger(EzollInboundService.name);
  private readonly inboundRoot: string;

  constructor(
    private prisma: PrismaService,
    private config: ConfigService,
    private organizations: OrganizationsService,
    private ezollSoloplan: EzollSoloplanService,
    private tourCache: EzollTourCacheService,
    private consignmentCache: EzollConsignmentCacheService,
    private freightPayer: EzollFreightPayerService,
    private customerDocs: CustomerDocumentsInboundService,
    private soloplan: SoloplanService,
    private smartborder: EzollSmartborderService,
  ) {
    const sftpInbound =
      this.config.get('SFTP_INBOUND_DIR') || join(process.cwd(), '../../data/sftp/inbound');
    this.inboundRoot = join(sftpInbound, 'Ezoll-Dokumente');
    for (const dir of [
      this.inboundRoot,
      join(this.inboundRoot, 'processed'),
      join(this.inboundRoot, 'processed', 'ignored'),
      join(this.inboundRoot, 'processed', 'cc529'),
      join(this.inboundRoot, 'processed', 'ez92x'),
      join(this.inboundRoot, 'processed', 'cc029'),
      join(this.inboundRoot, 'processed', 'cc599'),
      join(this.inboundRoot, 'processed', 'smartborder'),
      join(this.inboundRoot, 'pending-customer-exit'),
      join(this.inboundRoot, 'failed'),
      join(this.inboundRoot, 'failed', 'unmatched'),
      join(this.inboundRoot, 'failed', 'smartborder'),
    ]) {
      if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    }
  }

  async processInboundDir(organizationId?: string) {
    const orgId = organizationId || (await this.resolveDefaultOrganizationId());
    if (!orgId) {
      return {
        ignored: 0,
        smartborder: 0,
        smartborderFailed: 0,
        cc529: 0,
        ez92x: 0,
        cc029: 0,
        cc599: 0,
        customerExit: 0,
        unmatched: 0,
        pending: 0,
        purged: 0,
        prefixes: [] as string[],
      };
    }

    let purged = 0;
    try {
      purged += await this.tourCache.purgeExpired();
    } catch (e: any) {
      this.log.warn(`TourCache-Purge übersprungen: ${e?.message || e}`);
    }
    try {
      purged += await this.consignmentCache.purgeExpired();
    } catch (e: any) {
      this.log.warn(`ConsignmentCache-Purge übersprungen: ${e?.message || e}`);
    }

    const prefixes = await this.organizations.getEzollFilenameIgnorePrefixes(orgId);
    let ignored = 0;
    for (const filePath of this.listPendingFiles()) {
      const fileName = basename(filePath);
      if (!matchesFilenameIgnorePrefix(fileName, prefixes)) continue;
      this.move(
        filePath,
        join(this.inboundRoot, 'processed', 'ignored', `${Date.now()}_${fileName}`),
      );
      ignored += 1;
      this.log.log(`eZoll ignoriert (${prefixes.join(', ')}): ${fileName}`);
    }

    // SmartBorder unabhängig von Soloplan-Writes (CC529-Schalter)
    const sb = await this.smartborder.processInboundBatch(20);

    const enabled = this.config.get('SOLOPLAN_EZOLL_CC529_ENABLED') !== 'false';
    let cc529 = 0;
    let ez92x = 0;
    let cc029 = 0;
    let cc599 = 0;
    let customerExit = 0;
    let unmatched = 0;
    if (enabled) {
      const a = await this.processCc529Batch(orgId, 40);
      cc529 = a.processed;
      unmatched += a.unmatched;
      const b = this.processEz92xBatch(40);
      ez92x = b.processed;
      unmatched += b.unmatched;
      const c = await this.processCc029Batch(orgId, 40);
      cc029 = c.processed;
      unmatched += c.unmatched;
      const d = await this.processCc599Batch(orgId, 40);
      cc599 = d.processed;
      customerExit = d.customerExit;
      unmatched += d.unmatched;
      customerExit += await this.retryPendingCustomerExit(orgId, 40);
    }

    const pending = this.listPendingFiles().length;
    return {
      ignored,
      smartborder: sb.processed,
      smartborderFailed: sb.failed,
      cc529,
      ez92x,
      cc029,
      cc599,
      customerExit,
      unmatched,
      pending,
      purged,
      prefixes,
    };
  }

  private async processCc529Batch(organizationId: string, limit: number) {
    let processed = 0;
    let unmatched = 0;
    const pending = this.listPendingFiles().filter(
      (p) => detectEzollDocType(basename(p)) === 'CC529CC',
    );

    const xmlFiles = pending.filter((p) => /\.xml$/i.test(p));
    const pdfFiles = pending.filter((p) => /\.pdf$/i.test(p));
    const xmlKeys = new Set<string>();
    for (const p of xmlFiles) {
      const key = soloplanMatchKey(parseSoloplanMatchFromFilename(basename(p)));
      if (key) xmlKeys.add(key);
    }

    const queue = [
      ...xmlFiles,
      ...pdfFiles.filter((p) => {
        const key = soloplanMatchKey(parseSoloplanMatchFromFilename(basename(p)));
        return !key || !xmlKeys.has(key);
      }),
    ].slice(0, limit);

    for (const filePath of queue) {
      const fileName = basename(filePath);
      const isXml = /\.xml$/i.test(fileName);
      try {
        const fields = isXml
          ? this.fieldsFromCc529Xml(filePath, fileName)
          : extractCc529FieldsFromPdfText(this.pdfText(filePath));
        if (!fields) {
          unmatched += 1;
          this.move(
            filePath,
            join(this.inboundRoot, 'failed', 'unmatched', `${Date.now()}_${fileName}`),
          );
          this.log.warn(`CC529 kein gültiges CC529C: ${fileName}`);
          continue;
        }

        const match = this.resolveMatch(fileName, fields);
        if (!match || match.kind === 'tour') {
          unmatched += 1;
          this.move(
            filePath,
            join(this.inboundRoot, 'failed', 'unmatched', `${Date.now()}_${fileName}`),
          );
          this.log.warn(`CC529 ohne Auftrag/Sendung: ${fileName}`);
          continue;
        }
        this.ezollSoloplan.writeCc529FlagUpdate(match, fileName, fields);
        await this.markAusfuhr(organizationId, match, fields, fileName);
        this.move(
          filePath,
          join(this.inboundRoot, 'processed', 'cc529', `${Date.now()}_${fileName}`),
        );
        processed += 1;
        this.log.log(
          `CC529 ${this.matchLabel(match)} [${isXml ? 'XML' : 'PDF'}] mRNATAPI=${fields.mrn || '-'} lRN=${fields.lrn || '-'} Tarifanzahl=${fields.totalItems ?? '-'} EUR1=${fields.eur1Number || '-'} ← ${fileName}`,
        );
      } catch (e: any) {
        unmatched += 1;
        this.log.warn(`CC529 ${fileName}: ${e?.message || e}`);
        this.move(
          filePath,
          join(this.inboundRoot, 'failed', 'unmatched', `${Date.now()}_${fileName}`),
        );
      }
    }
    return { processed, unmatched };
  }

  private processEz92xBatch(limit: number) {
    let processed = 0;
    let unmatched = 0;
    const files = this.listPendingFiles()
      .filter((p) => {
        const t = detectEzollDocType(basename(p));
        return (t === 'EZ922' || t === 'EZ923') && /\.xml$/i.test(p);
      })
      .slice(0, limit);

    for (const filePath of files) {
      const fileName = basename(filePath);
      try {
        const xml = readFileSync(filePath, 'utf8');
        const fields = extractEz92xFieldsFromXml(xml);
        if (!fields) {
          unmatched += 1;
          this.move(
            filePath,
            join(this.inboundRoot, 'failed', 'unmatched', `${Date.now()}_${fileName}`),
          );
          this.log.warn(`EZ92x kein gültiges MsgTyp: ${fileName}`);
          continue;
        }

        const match = parseSoloplanMatchFromFilename(fileName);
        if (!match || match.kind === 'tour') {
          unmatched += 1;
          this.move(
            filePath,
            join(this.inboundRoot, 'failed', 'unmatched', `${Date.now()}_${fileName}`),
          );
          this.log.warn(`${fields.msgTyp} ohne Auftrag/Sendung: ${fileName}`);
          continue;
        }

        this.ezollSoloplan.writeEz92xUpdate(match, fileName, fields);
        this.move(
          filePath,
          join(this.inboundRoot, 'processed', 'ez92x', `${Date.now()}_${fileName}`),
        );
        processed += 1;
        this.log.log(
          `${fields.msgTyp} ${this.matchLabel(match)} CRN=${fields.crn || '-'} Konto=${fields.abgabenkonto || '-'} MWST=${fields.mwstAt ?? '-'} Zoll=${fields.zollabgabenAt ?? '-'} ← ${fileName}`,
        );
      } catch (e: any) {
        unmatched += 1;
        this.log.warn(`EZ92x ${fileName}: ${e?.message || e}`);
        this.move(
          filePath,
          join(this.inboundRoot, 'failed', 'unmatched', `${Date.now()}_${fileName}`),
        );
      }
    }
    return { processed, unmatched };
  }

  /**
   * CC029C NCTS: Tournummer aus Dateiname/LRN.
   * Pro Tour 7-Tage-Cache – bei Mehrfach-XMLs MRNs/LRNs ergänzen, nicht überschreiben.
   * Soloplan-Updates an alle Portal-Sendungen der Tour mit akkumulierten Werten.
   */
  private async processCc029Batch(organizationId: string, limit: number) {
    let processed = 0;
    let unmatched = 0;
    const files = this.listPendingFiles()
      .filter((p) => detectEzollDocType(basename(p)) === 'CC029CC' && /\.xml$/i.test(p))
      .slice(0, limit);

    for (const filePath of files) {
      const fileName = basename(filePath);
      try {
        const xml = readFileSync(filePath, 'utf8');
        const fields = extractCc029FieldsFromXml(xml, fileName);
        if (!fields) {
          unmatched += 1;
          this.move(
            filePath,
            join(this.inboundRoot, 'failed', 'unmatched', `${Date.now()}_${fileName}`),
          );
          this.log.warn(`CC029 kein gültiges MsgTyp/Tournummer: ${fileName}`);
          continue;
        }

        const cache = await this.tourCache.mergeTourDocument({
          organizationId,
          tourNumber: fields.tourNumber,
          mrn: fields.mrn,
          lrn: fields.lrn,
          totalItems: fields.totalItems,
          sourceFile: fileName,
        });

        // OrderEzoll auf Tour-Ebene (tourNumber), nicht Consignment
        this.ezollSoloplan.writeCc029TourUpdate(fields.tourNumber, fileName, {
          mrns: cache.mrns,
          lrns: cache.lrns,
          totalItems: cache.totalItems,
        });
        this.move(
          filePath,
          join(this.inboundRoot, 'processed', 'cc029', `${Date.now()}_${fileName}`),
        );
        processed += 1;
        this.log.log(
          `CC029 Tour ${fields.tourNumber} [Tour-Update, ${cache.isNew ? 'neu' : 'ergänzt'}] MRNs=${cache.mrns.join('; ') || '-'} ← ${fileName}`,
        );
      } catch (e: any) {
        unmatched += 1;
        this.log.warn(`CC029 ${fileName}: ${e?.message || e}`);
        this.move(
          filePath,
          join(this.inboundRoot, 'failed', 'unmatched', `${Date.now()}_${fileName}`),
        );
      }
    }
    return { processed, unmatched };
  }

  /**
   * CC599 Austrittsbestätigung:
   * - Soloplan immer cC599C: true (update)
   * - Wertfelder nur wenn keine Ausfuhr (Cache / processed/cc529) vorlag
   * - PDF zusätzlich als Kunden-Dokument CUSTOMS_EXIT (wenn Rechte)
   */
  private async processCc599Batch(organizationId: string, limit: number) {
    let processed = 0;
    let unmatched = 0;
    let customerExit = 0;
    const pending = this.listPendingFiles().filter(
      (p) => detectEzollDocType(basename(p)) === 'CC599CC',
    );
    const xmlFiles = pending.filter((p) => /\.xml$/i.test(p));
    const pdfFiles = pending.filter((p) => /\.pdf$/i.test(p));
    const xmlKeys = new Set<string>();
    for (const p of xmlFiles) {
      const key = soloplanMatchKey(parseSoloplanMatchFromFilename(basename(p)));
      if (key) xmlKeys.add(key);
    }
    const queue = [
      ...xmlFiles,
      ...pdfFiles.filter((p) => {
        const key = soloplanMatchKey(parseSoloplanMatchFromFilename(basename(p)));
        return !key || !xmlKeys.has(key);
      }),
    ].slice(0, limit);

    for (const filePath of queue) {
      const fileName = basename(filePath);
      const isXml = /\.xml$/i.test(fileName);
      try {
        const fields = isXml
          ? this.fieldsFromCc599Xml(filePath, fileName)
          : extractCc599FieldsFromPdfText(this.pdfText(filePath));

        const match = this.resolveMatch(fileName, fields);
        if (!match || match.kind === 'tour') {
          unmatched += 1;
          this.move(
            filePath,
            join(this.inboundRoot, 'failed', 'unmatched', `${Date.now()}_${fileName}`),
          );
          this.log.warn(`CC599 ohne Auftrag/Sendung: ${fileName}`);
          continue;
        }

        const { orderNumber, consignmentIndex } = this.matchOrderKeys(match);
        const state = await this.consignmentCache.getState(
          organizationId,
          orderNumber,
          consignmentIndex,
        );
        const onDisk = this.hasProcessedCc529OnDisk(orderNumber, consignmentIndex);
        const hasAusfuhr = !!state?.hasCc529 || onDisk;
        const includeValues = !hasAusfuhr;

        // Historische CC529 vor Cache-Einführung nachziehen
        if (onDisk && !state?.hasCc529) {
          await this.consignmentCache.markCc529({
            organizationId,
            orderNumber,
            consignmentIndex,
            sourceFile: `processed/cc529:${orderNumber}.${consignmentIndex}`,
          });
        }

        this.ezollSoloplan.writeCc599FlagUpdate(match, fileName, fields, includeValues);
        await this.consignmentCache.markCc599({
          organizationId,
          orderNumber,
          consignmentIndex,
          sourceFile: fileName,
        });

        if (!isXml) {
          const pub = await this.publishExitPdfForFreightPayer({
            organizationId,
            orderNumber,
            consignmentIndex,
            filePath,
            sourceFileName: fileName,
          });
          if (pub === 'ok') customerExit += 1;
        }

        this.move(
          filePath,
          join(this.inboundRoot, 'processed', 'cc599', `${Date.now()}_${fileName}`),
        );
        processed += 1;
        this.log.log(
          `CC599 ${this.matchLabel(match)} [${isXml ? 'XML' : 'PDF'}] cC599C=true Werte=${includeValues ? 'ja (keine Ausfuhr)' : 'nein (Ausfuhr vorhanden)'} ← ${fileName}`,
        );
      } catch (e: any) {
        unmatched += 1;
        this.log.warn(`CC599 ${fileName}: ${e?.message || e}`);
        this.move(
          filePath,
          join(this.inboundRoot, 'failed', 'unmatched', `${Date.now()}_${fileName}`),
        );
      }
    }
    return { processed, unmatched, customerExit };
  }

  /**
   * Kunden-PDF: Kunde = Frachtzahler.
   * 1) vorhandene Sendung
   * 2) sonst Frachtzahler aus Tour → Doc-Carrier-Sendung
   * 3) sonst Soloplan WE-Request + PDF in pending-customer-exit parken
   */
  private async publishExitPdfForFreightPayer(input: {
    organizationId: string;
    orderNumber: number;
    consignmentIndex: number;
    filePath: string;
    sourceFileName: string;
  }): Promise<'ok' | 'pending' | 'no_rights' | 'skipped'> {
    const label = `${input.orderNumber}.${input.consignmentIndex}`;

    let shipment = await this.customerDocs.findShipmentForSoloplanOrder(
      input.organizationId,
      String(input.orderNumber),
      input.consignmentIndex,
    );

    if (!shipment?.customerId) {
      const fp = await this.freightPayer.resolveFreightPayerCustomer(
        input.organizationId,
        input.orderNumber,
      );
      if (fp) {
        const ensured = await this.freightPayer.ensureShipmentForOrder({
          organizationId: input.organizationId,
          orderNumber: input.orderNumber,
          customerId: fp.customerId,
        });
        if (ensured) {
          shipment = {
            id: ensured.id,
            trackingNumber: ensured.trackingNumber,
            organizationId: input.organizationId,
            customerId: ensured.customerId,
          };
          this.log.log(
            `CC599 ${label}: Frachtzahler-BP ${fp.bpNumber} → Sendung ${ensured.trackingNumber}${ensured.created ? ' (neu)' : ''}`,
          );
        }
      }
    }

    if (!shipment?.customerId) {
      // Soloplan soll WE (mit Frachtzahler) nachliefern
      try {
        this.soloplan.requestWareneingangByOrderNumber({
          orderNumber: input.orderNumber,
          consignmentIndex: input.consignmentIndex,
          reason: `CC599 Austrittsbestätigung ${input.sourceFileName} – keine Portal-Sendung/Frachtzahler`,
        });
      } catch (e: any) {
        this.log.warn(`CC599 ${label}: WE-Request fehlgeschlagen: ${e?.message || e}`);
      }
      this.parkPendingCustomerExit(input.orderNumber, input.consignmentIndex, input.filePath, input.sourceFileName);
      this.log.log(
        `CC599 ${label}: Kunden-PDF geparkt + WE bei Soloplan angefordert (Frachtzahler unbekannt)`,
      );
      return 'pending';
    }

    const pub = await this.customerDocs.tryPublishCustomsExitPdf({
      organizationId: input.organizationId,
      orderNumber: input.orderNumber,
      consignmentIndex: input.consignmentIndex,
      filePath: input.filePath,
      sourceFileName: input.sourceFileName,
    });
    if (pub === 'ok') return 'ok';
    if (pub === 'no_rights') {
      this.log.log(`CC599 ${label}: Kunden-PDF übersprungen (keine CUSTOMS_EXIT-Rechte für Frachtzahler)`);
      return 'no_rights';
    }
    if (pub === 'skipped') return 'skipped';

    // Sendung war da, Publish trotzdem fehlgeschlagen → parken + WE nachfordern
    try {
      this.soloplan.requestWareneingangByOrderNumber({
        orderNumber: input.orderNumber,
        consignmentIndex: input.consignmentIndex,
        reason: `CC599 ${input.sourceFileName} – Publish fehlgeschlagen (${pub})`,
      });
    } catch {
      /* ignore */
    }
    this.parkPendingCustomerExit(input.orderNumber, input.consignmentIndex, input.filePath, input.sourceFileName);
    return 'pending';
  }

  private parkPendingCustomerExit(
    orderNumber: number,
    consignmentIndex: number,
    filePath: string,
    sourceFileName: string,
  ) {
    const dir = join(this.inboundRoot, 'pending-customer-exit');
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    const safe = sourceFileName.replace(/[^\w.\-]+/g, '_').slice(0, 80);
    const dest = join(
      dir,
      `${orderNumber}.${consignmentIndex}__CUSTOMS_EXIT__${Date.now()}_${safe}`,
    );
    try {
      copyFileSync(filePath, dest);
    } catch (e: any) {
      this.log.warn(`pending-customer-exit kopieren fehlgeschlagen: ${e?.message || e}`);
    }
  }

  /** Nach WE-Import / Doc-Carrier: geparkte Austritts-PDFs erneut zuordnen. */
  private async retryPendingCustomerExit(organizationId: string, limit: number): Promise<number> {
    const dir = join(this.inboundRoot, 'pending-customer-exit');
    if (!existsSync(dir)) return 0;
    let ok = 0;
    const files = readdirSync(dir)
      .filter((f) => /\.pdf$/i.test(f))
      .sort()
      .slice(0, limit);
    for (const name of files) {
      const m = name.match(/^(\d{5,7})\.(\d{1,3})__CUSTOMS_EXIT__/);
      if (!m) continue;
      const orderNumber = Number(m[1]);
      const consignmentIndex = Number(m[2]);
      const filePath = join(dir, name);
      try {
        // Erst Frachtzahler aus Tour versuchen (falls WE noch fehlt)
        let shipment = await this.customerDocs.findShipmentForSoloplanOrder(
          organizationId,
          String(orderNumber),
          consignmentIndex,
        );
        if (!shipment?.customerId) {
          const fp = await this.freightPayer.resolveFreightPayerCustomer(
            organizationId,
            orderNumber,
          );
          if (fp) {
            await this.freightPayer.ensureShipmentForOrder({
              organizationId,
              orderNumber,
              customerId: fp.customerId,
            });
          }
        }
        shipment = await this.customerDocs.findShipmentForSoloplanOrder(
          organizationId,
          String(orderNumber),
          consignmentIndex,
        );
        if (!shipment?.customerId) continue;

        const pub = await this.customerDocs.tryPublishCustomsExitPdf({
          organizationId,
          orderNumber,
          consignmentIndex,
          filePath,
          sourceFileName: name,
        });
        if (pub === 'ok' || pub === 'skipped' || pub === 'no_rights') {
          this.move(filePath, join(this.inboundRoot, 'processed', 'cc599', `${Date.now()}_pending_${name}`));
          if (pub === 'ok') ok += 1;
          this.log.log(`CC599 Pending ${orderNumber}.${consignmentIndex}: ${pub}`);
        }
      } catch (e: any) {
        this.log.warn(`CC599 Pending ${name}: ${e?.message || e}`);
      }
    }
    return ok;
  }

  private async markAusfuhr(
    organizationId: string,
    match: EzollSoloplanMatch,
    fields: EzollCc529Fields,
    sourceFile: string,
  ) {
    const { orderNumber, consignmentIndex } = this.matchOrderKeys(match);
    await this.consignmentCache.markCc529({
      organizationId,
      orderNumber,
      consignmentIndex,
      mrn: fields.mrn,
      lrn: fields.lrn,
      totalItems: fields.totalItems,
      eur1Number: fields.eur1Number,
      sourceFile,
    });
  }

  private matchOrderKeys(match: EzollSoloplanMatch): {
    orderNumber: number;
    consignmentIndex: number;
  } {
    if (match.kind === 'orderConsignment') {
      return { orderNumber: match.orderNumber, consignmentIndex: match.consignmentIndex };
    }
    if (match.kind === 'order') {
      return { orderNumber: match.orderNumber, consignmentIndex: 1 };
    }
    throw new Error('Tour-Match nicht für Ausfuhr/Austritt');
  }

  /** Fallback für CC529 vor Einführung des Caches. */
  private hasProcessedCc529OnDisk(orderNumber: number, consignmentIndex: number): boolean {
    const dir = join(this.inboundRoot, 'processed', 'cc529');
    if (!existsSync(dir)) return false;
    const needles = [
      `${orderNumber}.${consignmentIndex}`,
      `${orderNumber}_${consignmentIndex}`,
    ];
    try {
      return readdirSync(dir).some((name) => needles.some((n) => name.includes(n)));
    } catch {
      return false;
    }
  }

  private fieldsFromCc599Xml(filePath: string, fileName: string): EzollCc599Fields {
    const xml = readFileSync(filePath, 'utf8');
    if (!isCc599Xml(xml) && detectEzollDocType(fileName) !== 'CC599CC') {
      return { mrn: null, lrn: null, totalItems: null, eur1Number: null };
    }
    return extractCc599FieldsFromXml(xml);
  }

  private fieldsFromCc529Xml(filePath: string, fileName: string): EzollCc529Fields | null {
    const xml = readFileSync(filePath, 'utf8');
    if (!isCc529Xml(xml) && detectEzollDocType(fileName) !== 'CC529CC') {
      return null;
    }
    if (!isCc529Xml(xml)) {
      this.log.warn(`XML ohne CC529C-MsgTyp, Dateiname sagt CC529: ${fileName}`);
    }
    return extractCc529FieldsFromXml(xml);
  }

  private resolveMatch(
    fileName: string,
    fields: EzollCc529Fields,
  ): EzollSoloplanMatch | null {
    const fromName = parseSoloplanMatchFromFilename(fileName);
    if (fromName && (fromName.kind === 'orderConsignment' || fromName.kind === 'order')) {
      return fromName;
    }
    if (fields.lrn) {
      const fromLrn = parseSoloplanMatchFromLrn(fields.lrn);
      if (fromLrn) return fromLrn;
    }
    return fromName;
  }

  private pdfText(filePath: string): string {
    try {
      return execFileSync('pdftotext', ['-layout', filePath, '-'], {
        encoding: 'utf8',
        maxBuffer: 2 * 1024 * 1024,
        timeout: 15_000,
      });
    } catch {
      try {
        return execFileSync('pdftotext', [filePath, '-'], {
          encoding: 'utf8',
          maxBuffer: 2 * 1024 * 1024,
          timeout: 15_000,
        });
      } catch {
        return '';
      }
    }
  }

  private matchLabel(match: EzollSoloplanMatch): string {
    if (match.kind === 'orderConsignment') {
      return `${match.orderNumber}.${match.consignmentIndex}`;
    }
    if (match.kind === 'order') return String(match.orderNumber);
    return `Tour ${match.tourNumber}`;
  }

  private async resolveDefaultOrganizationId(): Promise<string | undefined> {
    const org = await this.prisma.organization.findFirst({
      where: { active: true },
      orderBy: { createdAt: 'asc' },
      select: { id: true },
    });
    return org?.id;
  }

  private listPendingFiles(): string[] {
    if (!existsSync(this.inboundRoot)) return [];
    const skip = new Set(['processed', 'failed', 'pending-customer-exit', '.cache']);
    const out: string[] = [];
    for (const entry of readdirSync(this.inboundRoot, { withFileTypes: true })) {
      if (!entry.isFile()) continue;
      if (skip.has(entry.name)) continue;
      if (entry.name === 'README.txt') continue;
      if (!/\.(pdf|xml)$/i.test(entry.name)) continue;
      out.push(join(this.inboundRoot, entry.name));
    }
    return out.sort((a, b) => a.localeCompare(b));
  }

  private move(from: string, to: string) {
    try {
      renameSync(from, to);
    } catch {
      mkdirSync(join(to, '..'), { recursive: true });
      renameSync(from, to);
    }
  }
}
