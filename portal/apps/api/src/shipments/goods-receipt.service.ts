import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DocumentType, UserRole } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuthUser } from '../auth/auth.types';
import { normalizeScanCode, parseSsccFromScan, ssccMatchCandidates } from '../labels/sscc';

function dayBounds(dateStr: string): { start: Date; end: Date } {
  // dateStr YYYY-MM-DD (lokal als UTC-Tag)
  const start = new Date(`${dateStr}T00:00:00.000Z`);
  if (Number.isNaN(start.getTime())) {
    throw new BadRequestException('Ungültiges Datum (YYYY-MM-DD erwartet)');
  }
  const end = new Date(start);
  end.setUTCDate(end.getUTCDate() + 1);
  return { start, end };
}

function normalizeExternalRef(raw: string): string {
  const s = String(raw || '').trim();
  if (!s) return '';
  if (/^WE-/i.test(s)) return s.replace(/^WE-/i, '');
  return s;
}

@Injectable()
export class GoodsReceiptService {
  constructor(
    private prisma: PrismaService,
    private config: ConfigService,
  ) {}

  private assertWarehouseRole(user: AuthUser) {
    if (user.role === UserRole.CUSTOMER_USER) {
      throw new ForbiddenException('Wareneingangs-Kontrolle nur für Lager / Disposition');
    }
  }

  private async scanningMandantId(user: AuthUser): Promise<string> {
    const code = this.config.get<string>('SCANNING_MANDANT_CODE') || 'AG';
    const mandant = await this.prisma.mandant.findFirst({
      where: { organizationId: user.organizationId, code, active: true },
      select: { id: true },
    });
    if (!mandant) {
      throw new BadRequestException(`Scanning-Mandant „${code}“ nicht gefunden`);
    }
    if (
      (user.role === UserRole.MANDANT_DISPATCHER || user.role === UserRole.PARTNER) &&
      !user.mandantIds.includes(mandant.id)
    ) {
      throw new ForbiddenException('Kein Zugriff auf Scanning-Mandant');
    }
    return mandant.id;
  }

  /** Offene Wareneingangs-Gruppen zum Filtern (Kunde / Datum / externe Nr.). */
  async listGroups(
    user: AuthUser,
    opts: { customerId?: string; date?: string; q?: string },
  ) {
    this.assertWarehouseRole(user);
    const mandantId = await this.scanningMandantId(user);

    const where: any = {
      organizationId: user.organizationId,
      mandantId,
      // Nur echte Wareneingangs-Importe (nicht normale Portal-/Soloplan-Aufträge)
      OR: [
        { reference: { startsWith: 'WE-' } },
        { goodsDescription: { contains: 'Wareneingang', mode: 'insensitive' } },
      ],
    };
    if (opts.customerId) where.customerId = opts.customerId;
    if (opts.date) {
      const { start, end } = dayBounds(opts.date);
      where.createdAt = { gte: start, lt: end };
    }
    if (opts.q?.trim()) {
      const q = opts.q.trim();
      const ref = normalizeExternalRef(q);
      where.AND = [
        {
          OR: [
            { reference: { contains: q, mode: 'insensitive' } },
            { soloplanRef: { contains: ref, mode: 'insensitive' } },
            { trackingNumber: { contains: q, mode: 'insensitive' } },
            { customer: { name: { contains: q, mode: 'insensitive' } } },
            { customer: { customerNumber: { contains: q, mode: 'insensitive' } } },
          ],
        },
      ];
    }

    const shipments = await this.prisma.shipment.findMany({
      where,
      select: {
        id: true,
        reference: true,
        soloplanRef: true,
        trackingNumber: true,
        createdAt: true,
        customerId: true,
        customer: { select: { id: true, name: true, customerNumber: true } },
        colli: {
          select: {
            id: true,
            warehouseStatus: true,
          },
        },
      },
      orderBy: { createdAt: 'desc' },
      take: 200,
    });

    type Group = {
      /** Anzeigename / Session-Schlüssel; bei Sammel z. B. ALLE oder Kundensuchbegriff */
      externalRef: string;
      /** true = alle WE-Sendungen des Kunden an diesem Tag */
      allCustomerShipments: boolean;
      customerId: string | null;
      customerName: string | null;
      customerNumber: string | null;
      date: string;
      shipmentIds: string[];
      shipmentCount: number;
      orderRefs: string[];
      expected: number;
      received: number;
      damaged: number;
    };

    // Primär: Sammelgruppe je Kunde + Tag (viele Soloplan-WE-Nr. gehören oft zu einer Kundenlieferung)
    const map = new Map<string, Group>();
    for (const s of shipments) {
      const orderRef =
        s.soloplanRef || (s.reference || '').replace(/^WE-/i, '') || s.reference || s.trackingNumber;
      const date = s.createdAt.toISOString().slice(0, 10);
      const key = `${s.customerId || 'none'}|${date}`;
      let g = map.get(key);
      if (!g) {
        g = {
          externalRef: 'ALLE',
          allCustomerShipments: true,
          customerId: s.customerId,
          customerName: s.customer?.name || null,
          customerNumber: s.customer?.customerNumber || null,
          date,
          shipmentIds: [],
          shipmentCount: 0,
          orderRefs: [],
          expected: 0,
          received: 0,
          damaged: 0,
        };
        map.set(key, g);
      }
      g.shipmentIds.push(s.id);
      g.shipmentCount += 1;
      if (orderRef && !g.orderRefs.includes(orderRef)) g.orderRefs.push(orderRef);
      g.expected += s.colli.length;
      g.received += s.colli.filter(
        (c) => c.warehouseStatus === 'RECEIVED' || c.warehouseStatus === 'DAMAGED',
      ).length;
      g.damaged += s.colli.filter((c) => c.warehouseStatus === 'DAMAGED').length;
    }

    for (const g of map.values()) {
      if (g.orderRefs.length === 1) {
        g.externalRef = g.orderRefs[0];
        // Eine einzige Soloplan-Nr. → Session genau darauf; sonst Sammel
        g.allCustomerShipments = false;
      } else {
        g.externalRef = 'ALLE';
        g.allCustomerShipments = true;
      }
    }

    return [...map.values()].sort(
      (a, b) => b.date.localeCompare(a.date) || (a.customerName || '').localeCompare(b.customerName || '', 'de'),
    );
  }

  /** Session öffnen/fortsetzen und Soll-Liste laden. */
  async openSession(
    user: AuthUser,
    data: {
      customerId?: string;
      date: string;
      externalRef: string;
      /** Alle WE-Sendungen des Kunden an diesem Tag (Sammelkontrolle) */
      allCustomerShipments?: boolean;
      /** Anzeigename/Session-Schlüssel, z. B. Kunden-Auftragsnr. RPK… */
      sessionLabel?: string;
    },
  ) {
    this.assertWarehouseRole(user);
    const mandantId = await this.scanningMandantId(user);
    const externalRefRaw = normalizeExternalRef(data.externalRef);
    if (!data.date) throw new BadRequestException('Datum fehlt');

    const { start, end } = dayBounds(data.date);
    const wantAll =
      !!data.allCustomerShipments ||
      !externalRefRaw ||
      externalRefRaw.toUpperCase() === 'ALLE' ||
      externalRefRaw === '*';

    const weClause = {
      OR: [
        { reference: { startsWith: 'WE-' } },
        { goodsDescription: { contains: 'Wareneingang', mode: 'insensitive' as const } },
      ],
    };

    if (wantAll && !data.customerId) {
      throw new BadRequestException('Für Sammelkontrolle bitte einen Kunden wählen');
    }

    let shipments = await this.prisma.shipment.findMany({
      where: {
        organizationId: user.organizationId,
        mandantId,
        ...(data.customerId ? { customerId: data.customerId } : {}),
        createdAt: { gte: start, lt: end },
        AND: [
          weClause,
          ...(wantAll
            ? []
            : [
                {
                  OR: [
                    { soloplanRef: externalRefRaw },
                    { reference: `WE-${externalRefRaw}` },
                    { reference: { equals: externalRefRaw, mode: 'insensitive' as const } },
                    { soloplanRef: { equals: externalRefRaw, mode: 'insensitive' as const } },
                  ],
                },
              ]),
        ],
      },
      include: {
        customer: { select: { id: true, name: true, customerNumber: true } },
        colli: { orderBy: { itemNumber: 'asc' } },
      },
      orderBy: { createdAt: 'asc' },
    });

    // Kunden-Auftragsnr. (z. B. RPK…) steckt oft nicht in Soloplan-WE → bei Kunde+Tag auf Sammel fallen
    if (!shipments.length && data.customerId && !wantAll) {
      shipments = await this.prisma.shipment.findMany({
        where: {
          organizationId: user.organizationId,
          mandantId,
          customerId: data.customerId,
          createdAt: { gte: start, lt: end },
          AND: [weClause],
        },
        include: {
          customer: { select: { id: true, name: true, customerNumber: true } },
          colli: { orderBy: { itemNumber: 'asc' } },
        },
        orderBy: { createdAt: 'asc' },
      });
    }

    if (!shipments.length) {
      throw new NotFoundException(
        `Keine Wareneingangs-Sendungen${data.customerId ? ' für diesen Kunden' : ''} am ${data.date}`,
      );
    }

    const customerId = data.customerId || shipments[0].customerId;
    const sessionKey = normalizeExternalRef(
      data.sessionLabel || data.externalRef || (wantAll ? 'ALLE' : externalRefRaw),
    ) || 'ALLE';

    let session = await this.prisma.goodsReceiptSession.findFirst({
      where: {
        organizationId: user.organizationId,
        customerId: customerId || undefined,
        externalRef: sessionKey,
        sessionDate: start,
        status: 'OPEN',
      },
    });

    if (!session) {
      session = await this.prisma.goodsReceiptSession.create({
        data: {
          organizationId: user.organizationId,
          mandantId,
          customerId: customerId || undefined,
          externalRef: sessionKey,
          sessionDate: start,
          createdById: user.id,
          status: 'OPEN',
        },
      });
    }

    // Soll-Checks anlegen
    for (const s of shipments) {
      for (const collo of s.colli) {
        await this.prisma.goodsReceiptColloCheck.upsert({
          where: {
            sessionId_colloId: { sessionId: session.id, colloId: collo.id },
          },
          create: {
            sessionId: session.id,
            colloId: collo.id,
            status:
              collo.warehouseStatus === 'DAMAGED'
                ? 'DAMAGED'
                : collo.warehouseStatus === 'RECEIVED'
                  ? 'RECEIVED'
                  : 'PENDING',
            scannedAt: collo.receivedAt,
            scannedById: collo.receivedById,
            note: collo.warehouseNote,
          },
          update: {},
        });
      }
    }

    return this.getSession(user, session.id);
  }

  async getSession(user: AuthUser, sessionId: string) {
    this.assertWarehouseRole(user);
    const session = await this.prisma.goodsReceiptSession.findFirst({
      where: { id: sessionId, organizationId: user.organizationId },
      include: {
        customer: { select: { id: true, name: true, customerNumber: true } },
        checks: {
          include: {
            collo: {
              include: {
                shipment: {
                  select: {
                    id: true,
                    trackingNumber: true,
                    reference: true,
                    soloplanRef: true,
                    deliveryCompany: true,
                    deliveryZip: true,
                    deliveryCity: true,
                    deliveryCountry: true,
                  },
                },
              },
            },
          },
          orderBy: { createdAt: 'asc' },
        },
        surplus: { orderBy: { scannedAt: 'asc' } },
      },
    });
    if (!session) throw new NotFoundException('Kontrollsitzung nicht gefunden');

    const expected = session.checks.length;
    const received = session.checks.filter((c) => c.status === 'RECEIVED' || c.status === 'DAMAGED').length;
    const damaged = session.checks.filter((c) => c.status === 'DAMAGED').length;
    const pending = session.checks.filter((c) => c.status === 'PENDING' || c.status === 'MISSING').length;
    const missing =
      session.status === 'CLOSED'
        ? session.checks.filter((c) => c.status === 'MISSING' || c.status === 'PENDING').length
        : session.checks.filter((c) => c.status === 'PENDING').length;

    return {
      id: session.id,
      status: session.status,
      externalRef: session.externalRef,
      sessionDate: session.sessionDate.toISOString().slice(0, 10),
      customer: session.customer,
      notes: session.notes,
      closedAt: session.closedAt,
      summary: {
        expected,
        received,
        damaged,
        pending: session.status === 'OPEN' ? pending : 0,
        missing: session.status === 'CLOSED' ? missing : session.checks.filter((c) => c.status === 'PENDING').length,
        surplus: session.surplus.length,
      },
      expectedColli: session.checks.map((c) => ({
        checkId: c.id,
        colloId: c.colloId,
        status: c.status,
        scannedAt: c.scannedAt,
        note: c.note,
        sscc: c.collo.sscc,
        itemNumber: c.collo.itemNumber,
        content: c.collo.content,
        packaging: c.collo.packaging,
        weightKg: c.collo.weightKg,
        shipmentId: c.collo.shipment.id,
        trackingNumber: c.collo.shipment.trackingNumber,
        reference: c.collo.shipment.reference,
        deliveryCompany: c.collo.shipment.deliveryCompany,
        deliveryZip: c.collo.shipment.deliveryZip,
        deliveryCity: c.collo.shipment.deliveryCity,
        deliveryCountry: c.collo.shipment.deliveryCountry,
      })),
      surplus: session.surplus.map((s) => ({
        id: s.id,
        sscc: s.sscc,
        scannedAt: s.scannedAt,
        note: s.note,
        documentId: s.documentId,
      })),
    };
  }

  /** SSCC scannen: Soll treffen oder als Überzählig buchen. */
  async scan(
    user: AuthUser,
    sessionId: string,
    rawSscc: string,
    opts?: { damaged?: boolean; note?: string },
  ) {
    this.assertWarehouseRole(user);
    const candidates = ssccMatchCandidates(rawSscc);
    const sscc = candidates[0] || normalizeScanCode(rawSscc) || parseSsccFromScan(rawSscc);
    if (!sscc) throw new BadRequestException('Ungültige SSCC');

    const session = await this.prisma.goodsReceiptSession.findFirst({
      where: { id: sessionId, organizationId: user.organizationId },
    });
    if (!session) throw new NotFoundException('Kontrollsitzung nicht gefunden');
    if (session.status !== 'OPEN') throw new BadRequestException('Sitzung ist geschlossen');

    const check = await this.prisma.goodsReceiptColloCheck.findFirst({
      where: { sessionId, collo: { sscc: { in: candidates } } },
      include: {
        collo: {
          include: {
            shipment: { select: { id: true, trackingNumber: true, reference: true } },
          },
        },
      },
    });

    if (check) {
      const status = opts?.damaged ? 'DAMAGED' : 'RECEIVED';
      const now = new Date();
      await this.prisma.$transaction([
        this.prisma.goodsReceiptColloCheck.update({
          where: { id: check.id },
          data: {
            status,
            scannedAt: now,
            scannedById: user.id,
            note: opts?.note || check.note,
          },
        }),
        this.prisma.shipmentCollo.update({
          where: { id: check.colloId },
          data: {
            warehouseStatus: status,
            receivedAt: now,
            receivedById: user.id,
            warehouseNote: opts?.note || undefined,
          },
        }),
      ]);
      return {
        kind: 'expected' as const,
        status,
        sscc: check.collo.sscc || sscc,
        alreadyScanned: check.status === 'RECEIVED' || check.status === 'DAMAGED',
        collo: {
          id: check.collo.id,
          itemNumber: check.collo.itemNumber,
          content: check.collo.content,
          packaging: check.collo.packaging,
        },
        shipment: check.collo.shipment,
        session: await this.getSession(user, sessionId),
      };
    }

    // Überzählig (nicht in Soll-Liste) – kanonische SSCC ohne AI-00 speichern
    const existingSurplus = await this.prisma.goodsReceiptSurplus.findFirst({
      where: { sessionId, sscc: { in: candidates } },
    });
    if (!existingSurplus) {
      await this.prisma.goodsReceiptSurplus.create({
        data: {
          sessionId,
          sscc,
          scannedById: user.id,
          note: opts?.note || (opts?.damaged ? 'Beschädigt (überzählig)' : undefined),
        },
      });
    }

    // Falls SSCC irgendwo im System existiert – Info mitgeben
    const known = await this.prisma.shipmentCollo.findFirst({
      where: {
        sscc: { in: candidates },
        shipment: { organizationId: user.organizationId },
      },
      include: {
        shipment: {
          select: {
            id: true,
            trackingNumber: true,
            reference: true,
            soloplanRef: true,
            customer: { select: { name: true, customerNumber: true } },
          },
        },
      },
    });

    return {
      kind: 'surplus' as const,
      status: 'SURPLUS',
      sscc,
      alreadyScanned: !!existingSurplus,
      knownShipment: known
        ? {
            id: known.shipment.id,
            trackingNumber: known.shipment.trackingNumber,
            reference: known.shipment.reference,
            soloplanRef: known.shipment.soloplanRef,
            customer: known.shipment.customer,
          }
        : null,
      session: await this.getSession(user, sessionId),
    };
  }

  async markDamaged(
    user: AuthUser,
    sessionId: string,
    colloId: string,
    note?: string,
  ) {
    this.assertWarehouseRole(user);
    const check = await this.prisma.goodsReceiptColloCheck.findFirst({
      where: { sessionId, colloId, session: { organizationId: user.organizationId } },
    });
    if (!check) throw new NotFoundException('Packstück nicht in dieser Sitzung');

    const now = new Date();
    await this.prisma.$transaction([
      this.prisma.goodsReceiptColloCheck.update({
        where: { id: check.id },
        data: {
          status: 'DAMAGED',
          scannedAt: check.scannedAt || now,
          scannedById: user.id,
          note: note || check.note || 'Beschädigt',
        },
      }),
      this.prisma.shipmentCollo.update({
        where: { id: colloId },
        data: {
          warehouseStatus: 'DAMAGED',
          receivedAt: check.scannedAt || now,
          receivedById: user.id,
          warehouseNote: note || 'Beschädigt',
        },
      }),
    ]);
    return this.getSession(user, sessionId);
  }

  async attachPhotoMeta(
    user: AuthUser,
    sessionId: string,
    data: { colloId?: string; surplusId?: string; documentId: string; note?: string },
  ) {
    this.assertWarehouseRole(user);
    const session = await this.prisma.goodsReceiptSession.findFirst({
      where: { id: sessionId, organizationId: user.organizationId },
    });
    if (!session) throw new NotFoundException('Sitzung nicht gefunden');

    const doc = await this.prisma.document.findFirst({
      where: { id: data.documentId, organizationId: user.organizationId },
    });
    if (!doc) throw new NotFoundException('Dokument nicht gefunden');

    if (data.surplusId) {
      await this.prisma.goodsReceiptSurplus.updateMany({
        where: { id: data.surplusId, sessionId },
        data: { documentId: data.documentId, note: data.note },
      });
    }
    if (data.colloId && data.note) {
      await this.prisma.goodsReceiptColloCheck.updateMany({
        where: { sessionId, colloId: data.colloId },
        data: { note: data.note },
      });
      await this.prisma.shipmentCollo.update({
        where: { id: data.colloId },
        data: { warehouseNote: data.note },
      });
    }

    // Dokumenttyp auf WAREHOUSE_PHOTO setzen falls OTHER/CUSTOMER_UPLOAD
    if (doc.type === DocumentType.OTHER || doc.type === DocumentType.CUSTOMER_UPLOAD) {
      await this.prisma.document.update({
        where: { id: doc.id },
        data: { type: DocumentType.WAREHOUSE_PHOTO },
      });
    }

    return this.getSession(user, sessionId);
  }

  /** Sitzung abschließen → fehlende Packstücke markieren, Soll/Ist-Bericht. */
  async closeSession(user: AuthUser, sessionId: string, notes?: string) {
    this.assertWarehouseRole(user);
    const session = await this.prisma.goodsReceiptSession.findFirst({
      where: { id: sessionId, organizationId: user.organizationId },
      include: { checks: true, surplus: true },
    });
    if (!session) throw new NotFoundException('Sitzung nicht gefunden');
    if (session.status === 'CLOSED') return this.getSession(user, sessionId);

    const pendingIds = session.checks.filter((c) => c.status === 'PENDING').map((c) => c.id);
    if (pendingIds.length) {
      await this.prisma.goodsReceiptColloCheck.updateMany({
        where: { id: { in: pendingIds } },
        data: { status: 'MISSING' },
      });
    }

    await this.prisma.goodsReceiptSession.update({
      where: { id: sessionId },
      data: {
        status: 'CLOSED',
        closedAt: new Date(),
        notes: notes || session.notes,
      },
    });

    return this.getSession(user, sessionId);
  }
}
