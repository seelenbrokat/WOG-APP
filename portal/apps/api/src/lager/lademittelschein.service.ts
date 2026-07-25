import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DocumentType, UserRole } from '@prisma/client';
import { mkdirSync, writeFileSync, existsSync, renameSync, readdirSync, readFileSync } from 'fs';
import { join } from 'path';
import { PrismaService } from '../prisma/prisma.service';
import { AuthUser } from '../auth/auth.types';
import { AuditService } from '../audit/audit.service';
import { NotificationsService } from '../notifications/notifications.service';
import { LoadingUnitService } from '../integrations/loading-unit.service';
import { writeLademittelscheinPdf } from './lademittelschein-pdf';

type QtyInput = {
  eupOut?: number;
  rahmenOut?: number;
  deckelOut?: number;
  gitterboxOut?: number;
  otherOut?: string;
  eupIn?: number;
  rahmenIn?: number;
  deckelIn?: number;
  gitterboxIn?: number;
  otherIn?: string;
  noExchangeNoStock?: boolean;
  noExchangeDriverRefuse?: boolean;
  notes?: string;
  companyEntity?: string;
  partnerName?: string;
  partnerNumber?: string;
  partnerEmail?: string;
  vehiclePlate?: string;
  driverName?: string;
  reference?: string;
  locationText?: string;
};

@Injectable()
export class LademittelscheinService {
  private readonly logger = new Logger(LademittelscheinService.name);
  private readonly uploadDir: string;
  private readonly inboundDir: string;
  private readonly outboundDir: string;
  private readonly processedDir: string;

  constructor(
    private prisma: PrismaService,
    private config: ConfigService,
    private audit: AuditService,
    private notifications: NotificationsService,
    private loadingUnits: LoadingUnitService,
  ) {
    this.uploadDir = this.config.get('UPLOAD_DIR') || join(process.cwd(), 'data', 'uploads');
    const inboundRoot =
      this.config.get('SFTP_INBOUND_DIR') || join(process.cwd(), 'data', 'sftp', 'inbound');
    const outboundRoot =
      this.config.get('SFTP_OUTBOUND_DIR') || join(process.cwd(), 'data', 'sftp', 'outbound');
    this.inboundDir = join(inboundRoot, 'soloplan', 'lademittel');
    this.outboundDir = join(outboundRoot, 'soloplan', 'lademittel');
    this.processedDir = join(this.inboundDir, 'processed');
    for (const dir of [this.uploadDir, this.inboundDir, this.outboundDir, this.processedDir]) {
      mkdirSync(dir, { recursive: true });
    }
  }

  private assertStaff(user: AuthUser) {
    if (user.role !== UserRole.ORG_ADMIN && user.role !== UserRole.MANDANT_DISPATCHER) {
      throw new ForbiddenException('Nur WOG-Personal');
    }
  }

  private n(v: unknown) {
    const x = Number(v);
    if (!Number.isFinite(x) || x < 0) return 0;
    return Math.min(Math.floor(x), 9999);
  }

  private async nextNumber(organizationId: string) {
    const day = new Date().toISOString().slice(0, 10).replace(/-/g, '');
    const prefix = `LMS-${day}-`;
    const last = await this.prisma.lademittelschein.findFirst({
      where: { organizationId, number: { startsWith: prefix } },
      orderBy: { number: 'desc' },
      select: { number: true },
    });
    const seq = last ? Number(last.number.slice(prefix.length)) + 1 : 1;
    return `${prefix}${String(seq).padStart(4, '0')}`;
  }

  async list(user: AuthUser, opts?: { q?: string; status?: string; take?: number }) {
    this.assertStaff(user);
    const take = Math.min(Math.max(opts?.take ?? 80, 1), 200);
    const where: Record<string, unknown> = { organizationId: user.organizationId };
    if (opts?.status?.trim()) where.status = opts.status.trim();
    if (opts?.q?.trim()) {
      const q = opts.q.trim();
      where.OR = [
        { number: { contains: q, mode: 'insensitive' } },
        { tourNumber: { contains: q, mode: 'insensitive' } },
        { partnerName: { contains: q, mode: 'insensitive' } },
        { reference: { contains: q, mode: 'insensitive' } },
        { vehiclePlate: { contains: q, mode: 'insensitive' } },
      ];
    }
    return this.prisma.lademittelschein.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take,
      include: {
        tour: { select: { id: true, tourNumber: true, status: true, vehicleId: true } },
        partner: { select: { id: true, name: true, code: true, email: true } },
      },
    });
  }

  /** Partner sieht eigene Scheine (Partner-Bereich). */
  async listForPartner(user: AuthUser) {
    if (user.role !== UserRole.PARTNER || !user.partnerId) {
      throw new ForbiddenException();
    }
    return this.prisma.lademittelschein.findMany({
      where: {
        organizationId: user.organizationId,
        partnerId: user.partnerId,
        status: { in: ['COMPLETED', 'SENT'] },
      },
      orderBy: { occurredAt: 'desc' },
      take: 100,
    });
  }

  /** Partner-Saldo aus Lademittelverwaltung (gebuchte Scheine + Telematik). */
  async balancesForPartner(user: AuthUser) {
    if (user.role !== UserRole.PARTNER || !user.partnerId) {
      throw new ForbiddenException();
    }
    const partner = await this.prisma.partner.findFirst({
      where: { id: user.partnerId, organizationId: user.organizationId },
    });
    if (!partner) throw new ForbiddenException();

    const numbers = [
      partner.soloplanBusinessPartnerId,
      partner.code,
      partner.matchcode,
    ]
      .map((x) => (x || '').trim())
      .filter(Boolean);

    const or: Array<Record<string, unknown>> = [
      { partnerName: { equals: partner.name, mode: 'insensitive' } },
    ];
    if (numbers.length) {
      or.push({ partnerNumber: { in: numbers } });
    }

    const rows = await this.prisma.loadingUnitPosting.groupBy({
      by: ['packagingMatchcode', 'packagingLabel'],
      where: {
        organizationId: user.organizationId,
        status: { in: ['BOOKED', 'SKIPPED_ZERO'] },
        OR: or,
      },
      _sum: { given: true, taken: true, balanceDelta: true, owedQuantity: true },
      _count: { _all: true },
      _max: { occurredAt: true },
    });

    const balances = rows
      .map((r) => {
        const given = r._sum.given || 0;
        const taken = r._sum.taken || 0;
        const balance = r._sum.balanceDelta ?? given - taken;
        const owedQuantity = r._sum.owedQuantity || 0;
        return {
          packagingMatchcode: r.packagingMatchcode,
          packagingLabel: r.packagingLabel,
          given,
          taken,
          balance,
          owedQuantity: owedQuantity > 0 ? owedQuantity : Math.max(0, balance),
          postings: r._count._all,
          lastAt: r._max.occurredAt,
        };
      })
      .filter((r) => r.given !== 0 || r.taken !== 0 || r.owedQuantity !== 0)
      .sort((a, b) => a.packagingMatchcode.localeCompare(b.packagingMatchcode, 'de'));

    const totals = balances.reduce(
      (acc, r) => {
        acc.given += r.given;
        acc.taken += r.taken;
        acc.balance += r.balance;
        acc.owedQuantity += r.owedQuantity;
        return acc;
      },
      { given: 0, taken: 0, balance: 0, owedQuantity: 0 },
    );

    return { partner: { id: partner.id, name: partner.name, code: partner.code }, balances, totals };
  }

  async get(user: AuthUser, id: string) {
    const row = await this.prisma.lademittelschein.findFirst({
      where: { id, organizationId: user.organizationId },
      include: {
        tour: {
          include: {
            consignments: true,
            vehicle: { select: { id: true, licensePlate: true, number: true, matchcode: true } },
          },
        },
        partner: true,
      },
    });
    if (!row) throw new NotFoundException();
    if (user.role === UserRole.PARTNER) {
      if (row.partnerId !== user.partnerId) throw new ForbiddenException();
    } else {
      this.assertStaff(user);
    }
    return row;
  }

  async createFromTour(user: AuthUser, tourId: string) {
    this.assertStaff(user);
    const tour = await this.prisma.tour.findFirst({
      where: { id: tourId, organizationId: user.organizationId },
      include: {
        consignments: true,
        vehicle: true,
        stops: { orderBy: { sequence: 'asc' }, take: 3 },
      },
    });
    if (!tour) throw new NotFoundException('Tour nicht gefunden');

    const partner = await this.resolvePartner(user.organizationId, tour.consignments);
    const firstStop = tour.stops[0];
    const number = await this.nextNumber(user.organizationId);
    const driverName =
      [tour.driverFirstName, tour.driverLastName].filter(Boolean).join(' ') ||
      tour.driverName ||
      null;

    const row = await this.prisma.lademittelschein.create({
      data: {
        organizationId: user.organizationId,
        mandantId: tour.mandantId,
        number,
        status: 'DRAFT',
        companyEntity: 'AG',
        tourId: tour.id,
        tourNumber: tour.tourNumber,
        partnerId: partner?.id,
        partnerName: partner?.name || firstStop?.name || null,
        partnerNumber:
          partner?.soloplanBusinessPartnerId || partner?.code || partner?.matchcode || null,
        partnerEmail: partner?.email || null,
        vehiclePlate: tour.vehicle?.licensePlate || tour.vehicle?.number || tour.vehicleId || null,
        driverName,
        reference: tour.tourNumber,
        locationText: firstStop?.city || 'Diepoldsau',
        occurredAt: tour.targetStart || new Date(),
        createdById: user.id,
      },
    });

    await this.audit.log(user.id, 'lademittelschein.create', 'Lademittelschein', row.id, {
      number: row.number,
      tourNumber: tour.tourNumber,
      partnerId: partner?.id,
    });
    return this.get(user, row.id);
  }

  async createManual(user: AuthUser, data: QtyInput & { partnerId?: string }) {
    this.assertStaff(user);
    const number = await this.nextNumber(user.organizationId);
    let partner = null as Awaited<ReturnType<typeof this.prisma.partner.findFirst>>;
    if (data.partnerId) {
      partner = await this.prisma.partner.findFirst({
        where: { id: data.partnerId, organizationId: user.organizationId },
      });
    }
    const row = await this.prisma.lademittelschein.create({
      data: {
        organizationId: user.organizationId,
        number,
        status: 'DRAFT',
        companyEntity: data.companyEntity === 'GMBH' ? 'GMBH' : 'AG',
        partnerId: partner?.id,
        partnerName: data.partnerName || partner?.name || null,
        partnerNumber:
          data.partnerNumber ||
          partner?.soloplanBusinessPartnerId ||
          partner?.code ||
          null,
        partnerEmail: data.partnerEmail || partner?.email || null,
        vehiclePlate: data.vehiclePlate || null,
        driverName: data.driverName || null,
        reference: data.reference || null,
        locationText: data.locationText || 'Diepoldsau',
        eupOut: this.n(data.eupOut),
        rahmenOut: this.n(data.rahmenOut),
        deckelOut: this.n(data.deckelOut),
        gitterboxOut: this.n(data.gitterboxOut),
        otherOut: data.otherOut || null,
        eupIn: this.n(data.eupIn),
        rahmenIn: this.n(data.rahmenIn),
        deckelIn: this.n(data.deckelIn),
        gitterboxIn: this.n(data.gitterboxIn),
        otherIn: data.otherIn || null,
        noExchangeNoStock: !!data.noExchangeNoStock,
        noExchangeDriverRefuse: !!data.noExchangeDriverRefuse,
        notes: data.notes || null,
        createdById: user.id,
      },
    });
    await this.audit.log(user.id, 'lademittelschein.create', 'Lademittelschein', row.id, {
      number: row.number,
      manual: true,
    });
    return this.get(user, row.id);
  }

  async updateDraft(user: AuthUser, id: string, data: QtyInput) {
    this.assertStaff(user);
    const current = await this.get(user, id);
    if (current.status !== 'DRAFT') {
      throw new BadRequestException('Nur Entwürfe können bearbeitet werden');
    }
    await this.prisma.lademittelschein.update({
      where: { id },
      data: {
        companyEntity: data.companyEntity === 'GMBH' ? 'GMBH' : data.companyEntity === 'AG' ? 'AG' : undefined,
        partnerName: data.partnerName ?? undefined,
        partnerNumber: data.partnerNumber ?? undefined,
        partnerEmail: data.partnerEmail ?? undefined,
        vehiclePlate: data.vehiclePlate ?? undefined,
        driverName: data.driverName ?? undefined,
        reference: data.reference ?? undefined,
        locationText: data.locationText ?? undefined,
        eupOut: data.eupOut != null ? this.n(data.eupOut) : undefined,
        rahmenOut: data.rahmenOut != null ? this.n(data.rahmenOut) : undefined,
        deckelOut: data.deckelOut != null ? this.n(data.deckelOut) : undefined,
        gitterboxOut: data.gitterboxOut != null ? this.n(data.gitterboxOut) : undefined,
        otherOut: data.otherOut !== undefined ? data.otherOut || null : undefined,
        eupIn: data.eupIn != null ? this.n(data.eupIn) : undefined,
        rahmenIn: data.rahmenIn != null ? this.n(data.rahmenIn) : undefined,
        deckelIn: data.deckelIn != null ? this.n(data.deckelIn) : undefined,
        gitterboxIn: data.gitterboxIn != null ? this.n(data.gitterboxIn) : undefined,
        otherIn: data.otherIn !== undefined ? data.otherIn || null : undefined,
        noExchangeNoStock:
          data.noExchangeNoStock != null ? !!data.noExchangeNoStock : undefined,
        noExchangeDriverRefuse:
          data.noExchangeDriverRefuse != null ? !!data.noExchangeDriverRefuse : undefined,
        notes: data.notes !== undefined ? data.notes || null : undefined,
      },
    });
    return this.get(user, id);
  }

  private decodeDataUrl(dataUrl: string) {
    const m = /^data:image\/(png|jpeg|jpg);base64,(.+)$/i.exec(dataUrl.trim());
    if (!m) throw new BadRequestException('Ungültige Signatur (PNG/JPEG Data-URL erwartet)');
    return Buffer.from(m[2], 'base64');
  }

  async complete(
    user: AuthUser,
    id: string,
    body: {
      wogSignedByName?: string;
      partnerSignedByName?: string;
      wogSignatureDataUrl?: string;
      partnerSignatureDataUrl?: string;
      sendEmail?: boolean;
    } & QtyInput,
  ) {
    this.assertStaff(user);
    await this.updateDraft(user, id, body);
    const row = await this.get(user, id);

    if (!body.wogSignatureDataUrl || !body.partnerSignatureDataUrl) {
      throw new BadRequestException('Beide Unterschriften sind erforderlich');
    }

    const sigDir = join(this.uploadDir, 'lademittelscheine', row.id);
    mkdirSync(sigDir, { recursive: true });
    const wogSigPath = join(sigDir, 'wog-signature.png');
    const partnerSigPath = join(sigDir, 'partner-signature.png');
    writeFileSync(wogSigPath, this.decodeDataUrl(body.wogSignatureDataUrl));
    writeFileSync(partnerSigPath, this.decodeDataUrl(body.partnerSignatureDataUrl));

    const updated = await this.prisma.lademittelschein.update({
      where: { id },
      data: {
        wogSignedByName: (body.wogSignedByName || user.email || 'WOG').trim(),
        partnerSignedByName: (body.partnerSignedByName || row.partnerName || 'Partner').trim(),
        wogSignaturePath: wogSigPath,
        partnerSignaturePath: partnerSigPath,
        status: 'COMPLETED',
      },
    });

    const pdfName = `Lademittelschein-${updated.number}.pdf`.replace(/[^\w.\-+]/g, '_');
    const pdfPath = join(this.uploadDir, pdfName);
    await writeLademittelscheinPdf(
      {
        ...updated,
        wogSignaturePath: wogSigPath,
        partnerSignaturePath: partnerSigPath,
      },
      pdfPath,
    );

    const doc = await this.prisma.document.create({
      data: {
        organizationId: user.organizationId,
        type: DocumentType.LADEMITTELSCHEIN,
        fileName: pdfName,
        mimeType: 'application/pdf',
        storagePath: pdfPath,
        sizeBytes: Buffer.byteLength(readFileSync(pdfPath)),
        uploadedById: user.id,
      },
    });

    const exportPath = await this.exportOutbound(updated);

    // In Lademittelverwaltung (Partner-Saldo) buchen
    const luBooked = await this.loadingUnits.bookFromLademittelschein(updated);

    let emailedAt: Date | null = null;
    const shouldMail = body.sendEmail !== false;
    const mailTo = updated.partnerEmail?.trim();
    if (shouldMail && mailTo) {
      await this.notifications.sendRaw(
        mailTo,
        `WOG Lademittel-Schein ${updated.number}`,
        [
          'Anbei der digitale Lademittel-Schein.',
          '',
          `Nummer: ${updated.number}`,
          updated.tourNumber ? `Tour: ${updated.tourNumber}` : null,
          updated.partnerName ? `Partner: ${updated.partnerName}` : null,
          updated.vehiclePlate ? `LKW: ${updated.vehiclePlate}` : null,
          '',
          'Mit freundlichen Grüssen',
          'WOG Logistics AG – Lager',
        ]
          .filter(Boolean)
          .join('\n'),
        undefined,
        [{ filename: pdfName, path: pdfPath, contentType: 'application/pdf' }],
      );
      emailedAt = new Date();
    }

    const final = await this.prisma.lademittelschein.update({
      where: { id },
      data: {
        documentId: doc.id,
        exportPath,
        exportedAt: exportPath ? new Date() : null,
        emailedAt,
        status: emailedAt ? 'SENT' : 'COMPLETED',
      },
    });

    await this.audit.log(user.id, 'lademittelschein.complete', 'Lademittelschein', id, {
      number: final.number,
      emailed: !!emailedAt,
      mailTo: mailTo || null,
      documentId: doc.id,
      loadingUnitsBooked: luBooked.booked,
    });

    return { ...final, document: doc, loadingUnits: luBooked };
  }

  async openPdf(user: AuthUser, id: string) {
    const row = await this.get(user, id);
    if (!row.documentId) throw new NotFoundException('PDF noch nicht erzeugt');
    const doc = await this.prisma.document.findFirst({
      where: { id: row.documentId, organizationId: user.organizationId },
    });
    if (!doc || !existsSync(doc.storagePath)) throw new NotFoundException('PDF fehlt');
    return doc;
  }

  private async resolvePartner(
    organizationId: string,
    consignments: Array<{ senderBpNumber?: string | null; senderName?: string | null }>,
  ) {
    const bpIds = [
      ...new Set(consignments.map((c) => (c.senderBpNumber || '').trim()).filter(Boolean)),
    ];
    if (!bpIds.length) return null;
    return this.prisma.partner.findFirst({
      where: {
        organizationId,
        OR: [
          { soloplanBusinessPartnerId: { in: bpIds } },
          { code: { in: bpIds } },
          { matchcode: { in: bpIds } },
        ],
      },
    });
  }

  private async exportOutbound(row: {
    id: string;
    number: string;
    tourNumber: string | null;
    partnerNumber: string | null;
    partnerName: string | null;
    vehiclePlate: string | null;
    driverName: string | null;
    reference: string | null;
    occurredAt: Date;
    eupOut: number;
    rahmenOut: number;
    deckelOut: number;
    gitterboxOut: number;
    eupIn: number;
    rahmenIn: number;
    deckelIn: number;
    gitterboxIn: number;
    otherOut: string | null;
    otherIn: string | null;
  }) {
    mkdirSync(this.outboundDir, { recursive: true });
    const fileName = `${row.number}.json`;
    const full = join(this.outboundDir, fileName);
    const payload = {
      type: 'Lademittelschein',
      number: row.number,
      tourNumber: row.tourNumber,
      partnerNumber: row.partnerNumber,
      partnerName: row.partnerName,
      vehiclePlate: row.vehiclePlate,
      driverName: row.driverName,
      reference: row.reference,
      occurredAt: row.occurredAt.toISOString(),
      handover: {
        eup: row.eupOut,
        rahmen: row.rahmenOut,
        deckel: row.deckelOut,
        gitterbox: row.gitterboxOut,
        other: row.otherOut,
      },
      takeover: {
        eup: row.eupIn,
        rahmen: row.rahmenIn,
        deckel: row.deckelIn,
        gitterbox: row.gitterboxIn,
        other: row.otherIn,
      },
    };
    writeFileSync(full, JSON.stringify(payload, null, 2), 'utf8');
    this.logger.log(`Lademittelschein exportiert: ${full}`);
    return full;
  }

  /** Worker: Soloplan-Vorschläge aus inbound/soloplan/lademittel lesen. */
  async processInboundDir(organizationId?: string) {
    mkdirSync(this.inboundDir, { recursive: true });
    mkdirSync(this.processedDir, { recursive: true });
    const org =
      organizationId ||
      (
        await this.prisma.organization.findFirst({
          where: { slug: 'wog' },
          select: { id: true },
        })
      )?.id;
    if (!org) return { processed: 0, failed: 0 };

    let processed = 0;
    let failed = 0;
    const files = readdirSync(this.inboundDir).filter((f) => f.endsWith('.json'));
    for (const file of files) {
      const full = join(this.inboundDir, file);
      try {
        const raw = JSON.parse(readFileSync(full, 'utf8'));
        const tourNumber = String(raw.tourNumber || raw.TourNumber || '').trim();
        if (!tourNumber) throw new Error('tourNumber fehlt');
        const tour = await this.prisma.tour.findFirst({
          where: { organizationId: org, tourNumber },
          include: { consignments: true, vehicle: true, stops: { orderBy: { sequence: 'asc' }, take: 1 } },
        });
        if (!tour) throw new Error(`Tour ${tourNumber} nicht gefunden`);

        const existing = await this.prisma.lademittelschein.findFirst({
          where: { organizationId: org, tourId: tour.id, status: 'DRAFT' },
        });
        if (existing) {
          renameSync(full, join(this.processedDir, `${Date.now()}_${file}`));
          processed += 1;
          continue;
        }

        const partner = await this.resolvePartner(org, tour.consignments);
        const number = await this.nextNumber(org);
        await this.prisma.lademittelschein.create({
          data: {
            organizationId: org,
            mandantId: tour.mandantId,
            number,
            status: 'DRAFT',
            tourId: tour.id,
            tourNumber: tour.tourNumber,
            partnerId: partner?.id,
            partnerName: partner?.name || tour.stops[0]?.name || null,
            partnerNumber:
              partner?.soloplanBusinessPartnerId || partner?.code || null,
            partnerEmail: partner?.email || null,
            vehiclePlate: tour.vehicle?.licensePlate || tour.vehicle?.number || null,
            driverName:
              [tour.driverFirstName, tour.driverLastName].filter(Boolean).join(' ') ||
              tour.driverName ||
              null,
            reference: String(raw.reference || tour.tourNumber),
            locationText: tour.stops[0]?.city || 'Diepoldsau',
            eupOut: this.n(raw.handover?.eup ?? raw.eupOut),
            rahmenOut: this.n(raw.handover?.rahmen ?? raw.rahmenOut),
            deckelOut: this.n(raw.handover?.deckel ?? raw.deckelOut),
            gitterboxOut: this.n(raw.handover?.gitterbox ?? raw.gitterboxOut),
            eupIn: this.n(raw.takeover?.eup ?? raw.eupIn),
            rahmenIn: this.n(raw.takeover?.rahmen ?? raw.rahmenIn),
            deckelIn: this.n(raw.takeover?.deckel ?? raw.deckelIn),
            gitterboxIn: this.n(raw.takeover?.gitterbox ?? raw.gitterboxIn),
            sourceFile: file,
          },
        });
        renameSync(full, join(this.processedDir, `${Date.now()}_${file}`));
        processed += 1;
      } catch (err: any) {
        failed += 1;
        this.logger.warn(`Lademittel inbound ${file}: ${err?.message || err}`);
      }
    }
    return { processed, failed };
  }

  dirs() {
    return {
      inbound: this.inboundDir,
      outbound: this.outboundDir,
      processed: this.processedDir,
    };
  }
}
