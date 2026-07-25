import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  chmodSync,
  createReadStream,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  statSync,
  writeFileSync,
} from 'fs';
import { dirname, join } from 'path';
import { DocumentType, NotificationEvent, PartnerJobStatus, ShipmentStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import {
  buildSoloplanFilePayload,
  buildSoloplanUpdatePayload,
  PortalShipmentForSoloplan,
  SoloplanFileFormat,
  soloplanDocumentCategory,
  soloplanOrderBaseName,
  soloplanOutboundFileName,
} from './soloplan-order.mapper';

export interface TransportIntegration {
  createOrder(shipmentId: string): Promise<void>;
  syncStatuses(): Promise<void>;
  pullPods(): Promise<void>;
}

@Injectable()
export class SoloplanService implements TransportIntegration {
  private readonly logger = new Logger(SoloplanService.name);
  private pendingCreates = new Set<string>();
  /** SFTP-Outbound-Root (z. B. /app/data/sftp/outbound) */
  private sftpOutboundRoot: string;
  /** Soloplan Order-Pickup: sftp/outbound/soloplan/orders */
  private ordersOutDir: string;
  /** Spiegel unter integrations/soloplan/orders/out */
  private integrationOrdersOutDir: string;

  constructor(
    private config: ConfigService,
    private prisma: PrismaService,
  ) {
    this.sftpOutboundRoot =
      this.config.get('SFTP_OUTBOUND_DIR') || join(process.cwd(), '../../data/sftp/outbound');
    this.ordersOutDir =
      this.config.get('SOLOPLAN_ORDERS_OUT_DIR') ||
      join(this.sftpOutboundRoot, 'soloplan', 'orders');
    const integrationBase =
      this.config.get('INTEGRATION_DIR') || join(process.cwd(), '../../data/integrations');
    this.integrationOrdersOutDir = join(integrationBase, 'soloplan', 'orders', 'out');
    for (const dir of [this.sftpOutboundRoot, this.ordersOutDir, this.integrationOrdersOutDir]) {
      if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    }
  }

  status() {
    const files = this.listOutboundFiles();
    return {
      enabled: this.config.get('SOLOPLAN_ENABLED') === 'true',
      mode: this.config.get('SOLOPLAN_MODE') || 'stub',
      fileFormat: this.getFileFormat(),
      baseUrlConfigured: Boolean(this.config.get('SOLOPLAN_BASE_URL')),
      ordersOutDir: this.ordersOutDir,
      integrationOrdersOutDir: this.integrationOrdersOutDir,
      pendingOutboundFiles: files.length,
      businessPartnerImportDir: 'data/integrations/soloplan/business-partners/in',
      apiVersion: 'SoloplanOrderImportPORTAL-v6',
    };
  }

  listOutboundFiles() {
    if (!existsSync(this.ordersOutDir)) return [];
    return readdirSync(this.ordersOutDir)
      .filter((f) => f.endsWith('.json'))
      .map((fileName) => {
        const full = join(this.ordersOutDir, fileName);
        const st = statSync(full);
        if (!st.isFile()) return null;
        return {
          fileName,
          size: st.size,
          modifiedAt: st.mtime.toISOString(),
          path: `soloplan/orders/${fileName}`,
        };
      })
      .filter((x): x is NonNullable<typeof x> => Boolean(x))
      .sort((a, b) => b.modifiedAt.localeCompare(a.modifiedAt));
  }

  /**
   * Verschiebt abgeholt Dateien aus dem Soloplan-Pickup-Ordner nach archive/processed.
   * Erkennung: atime > mtime (Datei wurde nach dem Schreiben gelesen / per SFTP geöffnet).
   * Danach: ausstehende Dokumente als Update nachschieben.
   */
  archiveDownloadedOrders() {
    if (!existsSync(this.ordersOutDir)) return { archived: 0 as const, files: [] as string[] };
    const delaySec = Number(this.config.get('SOLOPLAN_ARCHIVE_DELAY_SEC') || 20);
    const delayMs = Math.max(5, delaySec) * 1000;
    const now = Date.now();

    const archiveDir = join(this.sftpOutboundRoot, 'soloplan', 'archive');
    const mirrorProcessedDir = join(dirname(this.integrationOrdersOutDir), 'processed');
    for (const dir of [archiveDir, mirrorProcessedDir]) {
      if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    }

    const archived: string[] = [];
    for (const fileName of readdirSync(this.ordersOutDir)) {
      if (!fileName.endsWith('.json')) continue;
      const primary = join(this.ordersOutDir, fileName);
      let st;
      try {
        st = statSync(primary);
      } catch {
        continue;
      }
      if (!st.isFile()) continue;

      // Nach SFTP-Download ist atime neuer als mtime (Schreiben beim Export).
      const wasReadAfterWrite = st.atimeMs > st.mtimeMs + 500;
      const settled = now - st.atimeMs >= delayMs;
      if (!wasReadAfterWrite || !settled) continue;

      const target = join(archiveDir, fileName);
      try {
        renameSync(primary, target);
      } catch (err) {
        this.logger.warn(`Archivieren fehlgeschlagen ${fileName}: ${err}`);
        continue;
      }

      const mirror = join(this.integrationOrdersOutDir, fileName);
      if (existsSync(mirror)) {
        try {
          renameSync(mirror, join(mirrorProcessedDir, fileName));
        } catch (err) {
          this.logger.warn(`Spiegel-Archiv fehlgeschlagen ${fileName}: ${err}`);
        }
      }

      archived.push(fileName);
      this.logger.log(`Soloplan Order nach Download archiviert: ${fileName}`);
    }

    return { archived: archived.length, files: archived };
  }

  /**
   * Nach Soloplan-Abholung der Create-Datei: Dokumente nachreichen (Update).
   * Wird vom Worker nach archiveDownloadedOrders aufgerufen.
   */
  async flushDocumentsAfterPickup(archivedFiles: string[]) {
    const flushed: string[] = [];
    for (const fileName of archivedFiles) {
      // order-VLB230700057.json oder order-VLB…-update-….json
      const m = fileName.match(/^order-(VLB[\w.-]+?)(?:-update-|\.json)/i);
      if (!m) continue;
      const externalNumber = m[1].replace(/-update.*$/i, '');
      const order = await this.prisma.transportOrder.findFirst({
        where: { externalNumber },
        include: { shipments: { select: { id: true } } },
      });
      if (!order?.shipments?.length) continue;
      for (const s of order.shipments) {
        try {
          const res = await this.exportDocumentsIfReady(s.id);
          if (res.mode === 'update' || res.mode === 'rewrite-create') {
            flushed.push(externalNumber);
          }
        } catch (err: any) {
          this.logger.warn(
            `Soloplan Dokument-Flush ${externalNumber}: ${err?.message || err}`,
          );
        }
      }
    }
    return { flushed: [...new Set(flushed)] };
  }

  openOutboundFile(fileName: string) {
    const safe = fileName.replace(/[/\\]/g, '');
    if (!safe.endsWith('.json')) throw new BadRequestException('Nur .json Dateien');
    const full = join(this.ordersOutDir, safe);
    if (!existsSync(full)) throw new NotFoundException(`Datei ${safe} nicht gefunden`);
    return { fileName: safe, stream: createReadStream(full), fullPath: full };
  }

  async enqueueCreateOrder(shipmentId: string) {
    this.pendingCreates.add(shipmentId);
  }

  /** Echte Soloplan-ID (nicht FILE:/STUB). */
  isSoloplanImported(ref?: string | null): boolean {
    if (!ref) return false;
    if (ref.startsWith('FILE:') || ref.startsWith('SP-STUB-')) return false;
    return true;
  }

  private orderBaseName(externalNumber?: string | null): string {
    return String(externalNumber || '').replace(/[^\w.\-]+/g, '_');
  }

  /** Create-JSON liegt noch im SFTP-Pickup (Soloplan hat noch nicht abgeholt). */
  private pendingCreatePath(externalNumber?: string | null): string | null {
    const base = this.orderBaseName(externalNumber);
    if (!base) return null;
    const primary = join(this.ordersOutDir, `order-${base}.json`);
    return existsSync(primary) ? primary : null;
  }

  /**
   * Create wurde von Soloplan abgeholt (= archiviert ohne -superseded-).
   * -superseded- Dateien zählen nicht: die hat das Portal selbst weggeräumt,
   * bevor Soloplan den Auftrag importieren konnte.
   */
  private wasCreatePickedUp(externalNumber?: string | null): boolean {
    const base = this.orderBaseName(externalNumber);
    if (!base) return false;
    const dirs = [
      join(this.sftpOutboundRoot, 'soloplan', 'archive'),
      join(dirname(this.integrationOrdersOutDir), 'processed'),
    ];
    const createName = `order-${base}.json`;
    for (const dir of dirs) {
      if (!existsSync(dir)) continue;
      if (existsSync(join(dir, createName))) return true;
    }
    return false;
  }

  /**
   * Update nur wenn Soloplan den Auftrag schon hat:
   * - echte Soloplan-ID, oder
   * - Create-Datei wurde abgeholt (nicht mehr im Pickup).
   * Solange order-VLB….json noch im Pickup liegt → Create neu schreiben (mit Dokumenten).
   */
  private isSoloplanOrderUpdate(order: {
    soloplanRef?: string | null;
    externalNumber?: string | null;
  }) {
    if (this.pendingCreatePath(order.externalNumber)) return false;
    if (this.isSoloplanImported(order.soloplanRef)) return true;
    if (order.soloplanRef?.startsWith('FILE:') && this.wasCreatePickedUp(order.externalNumber)) {
      return true;
    }
    // Kein Ref / nur Stub / Create noch nie geschrieben → Create
    if (!order.soloplanRef || order.soloplanRef.startsWith('SP-STUB-')) return false;
    if (order.soloplanRef.startsWith('FILE:')) {
      // FILE: aber weder pending noch archiviert (z. B. manuell gelöscht) → Update riskant;
      // lieber Create erneut schreiben.
      return false;
    }
    return true;
  }

  /**
   * Noch nicht abgeholte Dateien desselben Auftrags aus dem Pickup-Ordner
   * nach archive verschieben, damit Updates nicht die Erstdatei überschreiben.
   */
  private retirePendingOutboundForOrder(
    shipment: {
      order?: { externalNumber?: string | null } | null;
      reference?: string | null;
      trackingNumber?: string;
      id: string;
    },
    format: SoloplanFileFormat,
  ) {
    this.retireOutboundMatching(shipment, format, { includeCreate: true });
  }

  /** Nur hängengebliebene -update- Dateien entfernen (Create bleibt für Rewrite). */
  private retireStaleUpdatesOnly(
    shipment: {
      order?: { externalNumber?: string | null } | null;
      reference?: string | null;
      trackingNumber?: string;
      id: string;
    },
    format: SoloplanFileFormat,
  ) {
    this.retireOutboundMatching(shipment, format, { includeCreate: false });
  }

  private retireOutboundMatching(
    shipment: {
      order?: { externalNumber?: string | null } | null;
      reference?: string | null;
      trackingNumber?: string;
      id: string;
    },
    format: SoloplanFileFormat,
    opts: { includeCreate: boolean },
  ) {
    const base = soloplanOrderBaseName(shipment as any, format);
    const prefix = format === 'order' ? `order-${base}` : base;
    const archiveDir = join(this.sftpOutboundRoot, 'soloplan', 'archive');
    if (!existsSync(archiveDir)) mkdirSync(archiveDir, { recursive: true });
    if (!existsSync(this.ordersOutDir)) return;

    for (const fileName of readdirSync(this.ordersOutDir)) {
      if (!fileName.endsWith('.json')) continue;
      const isCreate = fileName === `${prefix}.json`;
      const isUpdate = fileName.startsWith(`${prefix}-update-`);
      if (isUpdate) {
        /* always retire stale updates when rewriting */
      } else if (isCreate && opts.includeCreate) {
        /* retire create only for true Soloplan updates */
      } else {
        continue;
      }
      const primary = join(this.ordersOutDir, fileName);
      const stamp = Date.now();
      const targetName = fileName.replace(/\.json$/i, `-superseded-${stamp}.json`);
      try {
        renameSync(primary, join(archiveDir, targetName));
        this.logger.log(`Soloplan pending outbound retired: ${fileName} → archive/${targetName}`);
      } catch (err) {
        this.logger.warn(`Soloplan retire failed ${fileName}: ${err}`);
      }
      const mirror = join(this.integrationOrdersOutDir, fileName);
      if (existsSync(mirror)) {
        try {
          const mirrorProcessed = join(dirname(this.integrationOrdersOutDir), 'processed');
          if (!existsSync(mirrorProcessed)) mkdirSync(mirrorProcessed, { recursive: true });
          renameSync(mirror, join(mirrorProcessed, targetName));
        } catch {
          /* ignore */
        }
      }
    }
  }

  /** Dokumenttypen, die an Soloplan (documentData) gehen dürfen. */
  private static readonly SOLOPLAN_DOC_TYPES: DocumentType[] = [
    DocumentType.ABLIEFERBELEG,
    DocumentType.POD,
    DocumentType.INVOICE,
    DocumentType.CMR,
    DocumentType.CUSTOMER_UPLOAD,
  ];

  /** Portal-Dokumente als Soloplan documentData vorbereiten. */
  private async loadSoloplanDocuments(shipmentId: string) {
    const docs = await this.prisma.document.findMany({
      where: {
        shipmentId,
        type: { in: SoloplanService.SOLOPLAN_DOC_TYPES },
      },
      orderBy: { createdAt: 'desc' },
      take: 15,
    });
    const out: Array<{ fileName: string; category: string; contentBase64: string }> = [];
    for (const doc of docs) {
      if (!doc.storagePath || !existsSync(doc.storagePath)) continue;
      try {
        const buf = readFileSync(doc.storagePath);
        out.push({
          fileName: doc.fileName,
          category: soloplanDocumentCategory(doc.type),
          contentBase64: buf.toString('base64'),
        });
      } catch (err: any) {
        this.logger.warn(`Soloplan document skip ${doc.fileName}: ${err?.message || err}`);
      }
    }
    return out;
  }

  /**
   * Dokumente an Soloplan:
   * - Create noch im Pickup → Create mit Docs neu schreiben (kein Update)
   * - Auftrag abgeholt/importiert → Update mit documentData
   * - Create nur supersediert (nie abgeholt) → Create erneut mit Docs legen
   * - sonst warten (kein vorzeitiges Update ohne existierenden Auftrag)
   */
  async exportDocumentsIfReady(shipmentId: string) {
    const shipment = await this.prisma.shipment.findUnique({
      where: { id: shipmentId },
      include: { order: { select: { id: true, externalNumber: true, soloplanRef: true } } },
    });
    if (!shipment?.order) {
      return { ok: false, mode: 'skip' as const, reason: 'no-order' };
    }

    const ext = shipment.order.externalNumber;
    const docs = await this.loadSoloplanDocuments(shipmentId);
    if (!docs.length) {
      return { ok: true, mode: 'skip' as const, reason: 'no-documents' };
    }

    const pendingCreate = this.pendingCreatePath(ext);
    if (pendingCreate) {
      this.logger.log(
        `Soloplan: Dokumente in Create ${ext} einfügen (Pickup noch nicht abgeholt)`,
      );
      await this.createOrder(shipmentId);
      return { ok: true, mode: 'rewrite-create' as const, externalNumber: ext, documents: docs.length };
    }

    const ref = shipment.soloplanRef || shipment.order.soloplanRef;
    if (this.isSoloplanImported(ref) || this.wasCreatePickedUp(ext)) {
      this.logger.log(`Soloplan: Dokument-Update für ${ext} (${docs.length} Datei(en))`);
      await this.createOrder(shipmentId);
      return { ok: true, mode: 'update' as const, externalNumber: ext, documents: docs.length };
    }

    // FILE:/Stub aber Create nie von Soloplan abgeholt (z. B. verfrühtes Update) → Create wiederherstellen
    if (!ref || ref.startsWith('FILE:') || ref.startsWith('SP-STUB-')) {
      this.logger.log(
        `Soloplan: Create für ${ext} mit ${docs.length} Dokument(en) erneut schreiben (noch nicht importiert)`,
      );
      await this.createOrder(shipmentId);
      return { ok: true, mode: 'rewrite-create' as const, externalNumber: ext, documents: docs.length };
    }

    this.logger.log(
      `Soloplan: Dokumente für ${ext} warten – Auftrag noch nicht von Soloplan abgeholt/importiert`,
    );
    return { ok: true, mode: 'wait' as const, externalNumber: ext, documents: docs.length };
  }

  /** Exportiert eine Sendung sofort als Soloplan File-API JSON (auch wenn Worker noch nicht gelaufen ist). */
  async exportShipment(shipmentId: string) {
    await this.createOrder(shipmentId);
    const shipment = await this.prisma.shipment.findUnique({ where: { id: shipmentId } });
    if (!shipment) throw new NotFoundException('Sendung nicht gefunden');
    return {
      ok: true,
      shipmentId,
      trackingNumber: shipment.trackingNumber,
      soloplanRef: shipment.soloplanRef,
      outbound: this.listOutboundFiles().filter((f) =>
        f.fileName.includes(shipment.trackingNumber) ||
        (shipment.reference ? f.fileName.includes(shipment.reference) : false),
      ),
    };
  }

  async createOrder(shipmentId: string) {
    const shipmentInclude = {
      positions: true,
      colli: { orderBy: { itemNumber: 'asc' as const } },
      mandant: true,
      customer: { include: { contacts: true } },
      order: { include: { freightPayer: { include: { contacts: true } } } },
    };

    const shipment = await this.prisma.shipment.findUnique({
      where: { id: shipmentId },
      include: shipmentInclude,
    });
    if (!shipment) return;

    // Ohne Portal-Auftrag keinen Soloplan-Export (Auftrag + mind. 1 Sendung erforderlich)
    if (!shipment.order) {
      this.logger.warn(`Soloplan export übersprungen – Sendung ${shipment.trackingNumber} hat keinen Auftrag`);
      return;
    }

    const extras =
      shipment.extras && typeof shipment.extras === 'object' && !Array.isArray(shipment.extras)
        ? (shipment.extras as Record<string, unknown>)
        : null;
    if (extras?.verzollung === true) {
      const invoice = await this.prisma.document.findFirst({
        where: { shipmentId, type: DocumentType.INVOICE },
        select: { id: true },
      });
      if (!invoice) {
        throw new BadRequestException(
          'Bei Verzollung muss eine Rechnung (Dokumenttyp INVOICE) hochgeladen werden, bevor der Soloplan-Export erfolgen kann.',
        );
      }
    }

    // Alle Sendungen des Auftrags (1:n) für kumulierten Order-Export
    const orderShipments = await this.prisma.shipment.findMany({
      where: { orderId: shipment.order.id },
      include: shipmentInclude,
      orderBy: { createdAt: 'asc' },
    });

    // Ablieferbeleg / POD als Soloplan documentData (Base64) anhängen
    const orderShipmentsWithDocs = await Promise.all(
      orderShipments.map(async (s) => ({
        ...s,
        documents: await this.loadSoloplanDocuments(s.id),
      })),
    );
    const shipmentWithDocs = {
      ...shipment,
      documents: await this.loadSoloplanDocuments(shipment.id),
    };

    const mode = this.config.get('SOLOPLAN_MODE') || 'stub';
    const enabled = this.config.get('SOLOPLAN_ENABLED') === 'true';
    const format = this.getFileFormat();
    // Bereits exportiert → Update nur mit externen Nummern, keine Sendungsinfos erneut
    const isUpdate = this.isSoloplanOrderUpdate(shipment.order);
    const payload = buildSoloplanFilePayload(shipmentWithDocs, {
      format,
      defaultSender: isUpdate ? null : this.getDefaultSender(),
      trackingBaseUrl: isUpdate ? undefined : this.config.get('APP_URL') || undefined,
      objectOwnerId: Number(this.config.get('SOLOPLAN_OBJECT_OWNER_ID') || 0) || undefined,
      orderShipments: orderShipmentsWithDocs,
      update: isUpdate,
    });

    if (!enabled || mode === 'stub') {
      const ref = `SP-STUB-${shipment.order.externalNumber}`;
      await this.prisma.shipment.updateMany({
        where: { orderId: shipment.order.id },
        data: { soloplanRef: ref },
      });
      await this.prisma.transportOrder.update({
        where: { id: shipment.order.id },
        data: { soloplanRef: ref },
      });
      this.logger.log(`Soloplan stub createOrder ${ref}`);
      return;
    }

    if (mode === 'file') {
      // Noch liegende Update-Dateien wegräumen; Create nur bei echtem Update retiren
      if (isUpdate) {
        this.retirePendingOutboundForOrder(shipment, format);
      } else {
        // Create (neu oder Docs nachgeladen): alte -update- Dateien aus Pickup entfernen
        this.retireStaleUpdatesOnly(shipment, format);
      }
      const fileName = soloplanOutboundFileName(shipment, format, {
        update: isUpdate,
        at: new Date(),
      });
      const json = JSON.stringify(payload, null, 2);
      const primary = join(this.ordersOutDir, fileName);
      const mirror = join(this.integrationOrdersOutDir, fileName);
      if (!existsSync(this.ordersOutDir)) mkdirSync(this.ordersOutDir, { recursive: true });
      // Soloplan muss Dateien nach Import löschen können → Ordner schreibbar halten
      try {
        chmodSync(this.ordersOutDir, 0o775);
      } catch {
        /* ignore */
      }
      writeFileSync(primary, json);
      writeFileSync(mirror, json);
      try {
        chmodSync(primary, 0o664);
        chmodSync(mirror, 0o664);
      } catch {
        /* ignore */
      }
      // Echte Soloplan-IDs nicht mit FILE: überschreiben
      const currentRef = shipment.order.soloplanRef || shipment.soloplanRef;
      if (!this.isSoloplanImported(currentRef)) {
        const fileRef = `FILE:soloplan/orders/${fileName}`;
        await this.prisma.shipment.updateMany({
          where: { orderId: shipment.order.id },
          data: { soloplanRef: fileRef },
        });
        await this.prisma.transportOrder.update({
          where: { id: shipment.order.id },
          data: { soloplanRef: fileRef },
        });
      }
      const docCount = (shipmentWithDocs.documents || []).length;
      this.logger.log(
        `Soloplan PORTAL-v6 order export ${primary} (${orderShipments.length} consignments${isUpdate ? ', update' : ', create'}${docCount ? `, ${docCount} docs` : ''})`,
      );
      return;
    }

    // REST mode – SoloplanOrderImportPORTAL v6
    const base = String(this.config.get('SOLOPLAN_BASE_URL') || '').replace(/\/$/, '');
    const key = this.config.get('SOLOPLAN_API_KEY');
    if (!base) {
      this.logger.warn('SOLOPLAN_BASE_URL fehlt');
      return;
    }
    const endpoint =
      format === 'order'
        ? `${base}/api/SoloplanOrderImportPORTAL/v6/Order`
        : `${base}/api/SoloplanOrderImportPORTAL/v6/Consignment`;

    // REST erwartet oft das Objekt ohne Wrapper – File-API nutzt header+array.
    // Laut OpenAPI Create: Body = Consignment/Order Entity; File-Drop nutzt Wrapper.
    // Wir senden den File-Wrapper (wie Spec-Samples), Fallback: erstes Array-Element.
    const body = payload;
    const res = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(key ? { Authorization: `Bearer ${key}` } : {}),
      },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      this.logger.error(`Soloplan REST error ${res.status}: ${text.slice(0, 300)}`);
      return;
    }
    const json = (await res.json().catch(() => ({}))) as { id?: string | number };
    const ref = String(json.id || `REST-${shipment.order.externalNumber}`);
    await this.prisma.shipment.updateMany({
      where: { orderId: shipment.order.id },
      data: { soloplanRef: ref },
    });
    await this.prisma.transportOrder.update({
      where: { id: shipment.order.id },
      data: { soloplanRef: ref },
    });
  }

  async syncStatuses() {
    const inbound =
      this.config.get('SFTP_INBOUND_DIR') || join(process.cwd(), '../../data/sftp/inbound');
    const dirs = [inbound, join(inbound, 'soloplan')];
    for (const dir of dirs) {
      if (!existsSync(dir)) continue;
      const files = readdirSync(dir).filter(
        (f) => f.startsWith('soloplan-status-') && f.endsWith('.json'),
      );
      for (const file of files) {
        try {
          const raw = JSON.parse(readFileSync(join(dir, file), 'utf8')) as {
            trackingNumber: string;
            status: ShipmentStatus;
            message?: string;
          };
          const shipment = await this.prisma.shipment.findUnique({
            where: { trackingNumber: raw.trackingNumber },
          });
          if (shipment && raw.status) {
            await this.prisma.shipment.update({
              where: { id: shipment.id },
              data: {
                status: raw.status,
                events: {
                  create: {
                    status: raw.status,
                    message: raw.message || 'Soloplan Statusupdate',
                    createdBy: 'soloplan',
                  },
                },
              },
            });
          }
          const processed = join(dir, 'processed');
          if (!existsSync(processed)) mkdirSync(processed, { recursive: true });
          renameSync(join(dir, file), join(processed, file));
        } catch (err) {
          this.logger.error(`Status file failed ${file}`, err as Error);
        }
      }
    }
  }

  async pullPods() {
    // Placeholder for POD retrieval from Soloplan
  }

  async syncPending() {
    for (const id of [...this.pendingCreates]) {
      try {
        await this.createOrder(id);
        this.pendingCreates.delete(id);
      } catch (err) {
        this.logger.error(`createOrder failed ${id}`, err as Error);
      }
    }
    await this.syncStatuses();
    await this.pullPods();
  }

  private getFileFormat(): SoloplanFileFormat {
    const raw = String(this.config.get('SOLOPLAN_FILE_FORMAT') || 'order').toLowerCase();
    return raw === 'consignment' ? 'consignment' : 'order';
  }

  private getDefaultSender() {
    const number = this.config.get('SOLOPLAN_DEFAULT_SENDER_BP') || '2';
    return {
      number,
      matchcode: this.config.get('SOLOPLAN_DEFAULT_SENDER_MATCHCODE') || 'WOGDIEPO',
      name: this.config.get('SOLOPLAN_DEFAULT_SENDER_NAME') || 'WOG Logistics AG',
      phone: this.config.get('SOLOPLAN_DEFAULT_SENDER_PHONE') || '+41 71 733 77 00',
      vatId: this.config.get('SOLOPLAN_DEFAULT_SENDER_VAT') || undefined,
      street: this.config.get('SOLOPLAN_DEFAULT_SENDER_STREET') || 'Wildenaustraße 22',
      zip: this.config.get('SOLOPLAN_DEFAULT_SENDER_ZIP') || '9444',
      city: this.config.get('SOLOPLAN_DEFAULT_SENDER_CITY') || 'Diepoldsau',
      country: this.config.get('SOLOPLAN_DEFAULT_SENDER_COUNTRY') || 'CH',
    };
  }

  /**
   * Verzollungsauftrag (CustomsOrder) als SoloplanOrderImportPORTAL v6 File exportieren.
   *
   * 1) Create: Auftrags-/Sendungsdaten inkl. VLBPortal-Felder – OHNE Dokumente
   * 2) Update: nur externalNumber + documentData (sonst würden Sendungsdetails überschrieben)
   */
  async exportCustomsOrder(customsOrderId: string) {
    const order = await this.prisma.customsOrder.findUnique({
      where: { id: customsOrderId },
      include: {
        customer: { include: { contacts: true } },
        mandant: true,
        documents: {
          where: {
            type: { in: [DocumentType.CUSTOMS_PAPER, DocumentType.INVOICE] },
          },
          orderBy: { createdAt: 'desc' },
        },
      },
    });
    if (!order) throw new NotFoundException('Verzollungsauftrag nicht gefunden');

    const externalNumber = `VZ-${order.kennzeichen.replace(/[^\w.-]+/g, '_')}-${order.id.slice(-6)}`;
    const docs = (
      await Promise.all(
        (order.documents || []).map(async (d) => {
          try {
            if (!d.storagePath || !existsSync(d.storagePath)) return null;
            const contentBase64 = readFileSync(d.storagePath).toString('base64');
            return {
              fileName: d.fileName,
              // Rechnung → RG, Begleit-/Zollpapiere → CHBEL
              category: soloplanDocumentCategory(d.type),
              contentBase64,
            };
          } catch {
            return null;
          }
        }),
      )
    ).filter(Boolean) as Array<{ fileName: string; category: string; contentBase64: string }>;

    const shipmentBase: PortalShipmentForSoloplan = {
      id: order.id,
      trackingNumber: externalNumber,
      reference: externalNumber,
      goodsDescription: `Verzollung ${order.importeur}`,
      packageCount: 1,
      pickupCompany: order.absenderFirma,
      pickupStreet: order.absenderStreet,
      pickupZip: order.absenderZip,
      pickupCity: order.absenderCity,
      pickupCountry: order.absenderCountry,
      pickupDate: order.zeit,
      deliveryCompany: order.empfaengerFirma,
      deliveryStreet: order.empfaengerStreet,
      deliveryZip: order.empfaengerZip,
      deliveryCity: order.empfaengerCity,
      deliveryCountry: order.empfaengerCountry,
      deliveryDate: order.zeit,
      notes: order.notes,
      extras: { verzollung: true },
      verzollungsauftrag: true,
      kennzeichen: order.kennzeichen,
      kennzeichenAnhaenger: order.kennzeichenAnhaenger,
      grenzuebergang: order.grenzuebergang,
      grenzzollstelle: order.grenzzollstelle,
      zeitpunktGrenze: order.zeit,
      importeurVLBPortal: order.importeur,
      zAZVLBPortal: order.zazKonto,
      warenortVLBPortal: order.warenort,
      customer: {
        customerNumber: order.customer.customerNumber,
        name: order.customer.name,
        soloplanBusinessPartnerId: order.customer.soloplanBusinessPartnerId,
        matchcode: order.customer.matchcode,
        contacts: (order.customer.contacts || []).map((c) => ({
          soloplanContactNumber: c.soloplanContactNumber,
          firstName: c.firstName,
          lastName: c.lastName,
          name: c.name,
          email: c.email,
          phone: c.phone,
        })),
      },
      order: {
        externalNumber,
        freightPayer: order.abweichenderFrachtzahler
          ? {
              customerNumber: order.customer.customerNumber,
              name: order.frachtzahlerFirma || order.customer.name,
            }
          : undefined,
      },
      positions: [
        {
          description: `Verzollungsauftrag ${order.importeur}`,
          quantity: 1,
          packaging: 'KRT',
        },
      ],
      documents: [],
    };

    const mode = this.config.get('SOLOPLAN_MODE') || 'stub';
    const enabled = this.config.get('SOLOPLAN_ENABLED') === 'true';
    const format = this.getFileFormat();
    const objectOwnerId =
      Number(this.config.get('SOLOPLAN_OBJECT_OWNER_ID') || 0) || undefined;

    if (!enabled || mode === 'stub') {
      this.logger.log(`Soloplan stub exportCustomsOrder ${externalNumber}`);
      return { ok: true, stub: true, externalNumber, documents: docs.length };
    }

    if (mode !== 'file') {
      this.logger.warn(`Soloplan customs export: mode ${mode} nicht unterstützt für CustomsOrder`);
      return { ok: false, externalNumber };
    }

    if (!existsSync(this.ordersOutDir)) mkdirSync(this.ordersOutDir, { recursive: true });
    if (!existsSync(this.integrationOrdersOutDir)) {
      mkdirSync(this.integrationOrdersOutDir, { recursive: true });
    }

    const archiveDir = join(this.sftpOutboundRoot, 'soloplan', 'archive');
    const createFileName = `order-${externalNumber}.json`;
    const createAlreadyPickedUp =
      existsSync(join(archiveDir, createFileName)) || this.wasCreatePickedUp(externalNumber);

    let createFileNameWritten: string | null = null;
    // Create nur schreiben, solange Soloplan den Auftrag noch nicht abgeholt hat.
    // Erneutes Create mit Sendungsdetails würde Soloplan-Daten überschreiben.
    if (!createAlreadyPickedUp) {
      const createPayload = buildSoloplanFilePayload(
        { ...shipmentBase, documents: [] },
        {
          format,
          defaultSender: this.getDefaultSender(),
          objectOwnerId,
        },
      );
      const json = JSON.stringify(createPayload, null, 2);
      writeFileSync(join(this.ordersOutDir, createFileName), json);
      writeFileSync(join(this.integrationOrdersOutDir, createFileName), json);
      createFileNameWritten = createFileName;
      this.logger.log(
        `Soloplan PORTAL-v6 customs CREATE ${join(this.ordersOutDir, createFileName)} (ohne Dokumente)`,
      );
    } else {
      this.logger.log(
        `Soloplan customs CREATE übersprungen – ${externalNumber} bereits abgeholt; nur Dokument-Update`,
      );
    }

    let updateFileName: string | null = null;
    if (docs.length) {
      const updatePayload = buildSoloplanUpdatePayload(
        { ...shipmentBase, documents: docs },
        { format, objectOwnerId },
      );
      updateFileName = soloplanOutboundFileName(shipmentBase, format, {
        update: true,
        at: new Date(),
      });
      const json = JSON.stringify(updatePayload, null, 2);
      writeFileSync(join(this.ordersOutDir, updateFileName), json);
      writeFileSync(join(this.integrationOrdersOutDir, updateFileName), json);
      this.logger.log(
        `Soloplan PORTAL-v6 customs DOCS-UPDATE ${join(this.ordersOutDir, updateFileName)} (${docs.length} Datei(en), nur documentData)`,
      );
    } else {
      this.logger.warn(
        `Soloplan customs export ${externalNumber}: keine Anhänge (Rechnung/Begleitdokumente)`,
      );
    }

    return {
      ok: true,
      fileName: createFileNameWritten || updateFileName,
      updateFileName,
      externalNumber,
      documents: docs.length,
      createSkipped: createAlreadyPickedUp,
    };
  }
}

@Injectable()
export class PartnerImportService {
  private readonly logger = new Logger(PartnerImportService.name);
  private inboundDir: string;

  constructor(
    private config: ConfigService,
    private prisma: PrismaService,
    private notifications: NotificationsService,
  ) {
    this.inboundDir =
      this.config.get('SFTP_INBOUND_DIR') || join(process.cwd(), '../../data/sftp/inbound');
    if (!existsSync(this.inboundDir)) mkdirSync(this.inboundDir, { recursive: true });
  }

  async processInbound() {
    if (!existsSync(this.inboundDir)) return;
    const files = readdirSync(this.inboundDir).filter(
      (f) => f.endsWith('.json') && !f.startsWith('soloplan-'),
    );
    for (const fileName of files) {
      const full = join(this.inboundDir, fileName);
      const partnerCode = fileName.split('_')[0]?.toUpperCase();
      const partner = partnerCode
        ? await this.prisma.partner.findFirst({ where: { code: partnerCode, active: true } })
        : null;

      const job = await this.prisma.partnerJob.create({
        data: {
          partnerId: partner?.id || (await this.ensureUnknownPartner()),
          direction: 'INBOUND',
          fileName,
          status: PartnerJobStatus.PROCESSING,
        },
      });

      try {
        const content = JSON.parse(readFileSync(full, 'utf8'));
        await this.prisma.partnerJob.update({
          where: { id: job.id },
          data: {
            status: PartnerJobStatus.SUCCESS,
            message: `Verarbeitet (${Array.isArray(content) ? content.length : 1} Datensatz/Datensätze)`,
            processedAt: new Date(),
          },
        });
        const processed = join(this.inboundDir, 'processed');
        if (!existsSync(processed)) mkdirSync(processed, { recursive: true });
        renameSync(full, join(processed, fileName));

        if (partner) {
          await this.notifications.sendRaw(
            partner.sftpUsername
              ? `${partner.sftpUsername}@partners.local`
              : 'admin@wog.logistikberater.at',
            'Partnerdatei importiert',
            `Datei ${fileName} erfolgreich verarbeitet.`,
            NotificationEvent.PARTNER_FILE_IMPORTED,
          );
        }
      } catch (err: any) {
        await this.prisma.partnerJob.update({
          where: { id: job.id },
          data: {
            status: PartnerJobStatus.FAILED,
            message: err?.message || String(err),
            processedAt: new Date(),
          },
        });
        this.logger.error(`Partner import failed ${fileName}`, err);
      }
    }
  }

  private async ensureUnknownPartner() {
    const org = await this.prisma.organization.findFirst({ where: { slug: 'wog' } });
    if (!org) throw new Error('WOG org missing');
    const existing = await this.prisma.partner.findFirst({
      where: { organizationId: org.id, code: 'UNKNOWN' },
    });
    if (existing) return existing.id;
    const created = await this.prisma.partner.create({
      data: { organizationId: org.id, name: 'Unbekannt', code: 'UNKNOWN' },
    });
    return created.id;
  }
}
