import {
  BadRequestException,
  Injectable,
  NotFoundException,
  ForbiddenException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomBytes } from 'crypto';
import { DocumentType, NotificationEvent, Prisma, ShipmentStatus, UserRole } from '@prisma/client';
import {
  CH_LI_CUSTOMS_MANDANT_CODES,
  requiresChLiCustomsDocuments,
} from '@wog/shared';
import { PrismaService } from '../prisma/prisma.service';
import { AuthUser } from '../auth/auth.types';
import { mandantFilter, customerFilter, assertMandantAccess } from '../common/access';
import { AuditService } from '../audit/audit.service';
import { NotificationsService } from '../notifications/notifications.service';
import { SoloplanService } from '../integrations/soloplan.service';
import { TourEtaService } from '../integrations/tour-eta.service';
import { LabelsService } from '../labels/labels.service';
import { normalizeScanCode, parseSsccFromScan, ssccMatchCandidates } from '../labels/sscc';
import { CUSTOMS_REF_SOURCE_LABELS } from '../customs/shipment-customs-ref.service';
import { allocateVlbExternalNumber } from './order-number';

function trackingNumber() {
  const d = new Date();
  const y = d.getFullYear().toString().slice(-2);
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const rand = randomBytes(3).toString('hex').toUpperCase();
  return `WOG${y}${m}${rand}`;
}

type PositionInput = {
  description: string;
  quantity?: number;
  packaging?: string;
  weightKg?: number;
  lengthCm?: number;
  widthCm?: number;
  heightCm?: number;
  sscc?: string;
};

/**
 * quantity > 1 + Gesamtgewicht → einzelne Colli mit gleichem Stückgewicht.
 * Beispiel: 10× EUP, 2000 kg → 10 Positionen à 200 kg.
 */
export function expandPositionsToColli(positions: PositionInput[]): PositionInput[] {
  const out: PositionInput[] = [];
  for (const p of positions || []) {
    const qty = Math.max(1, Math.floor(Number(p.quantity) || 1));
    const totalWeight = p.weightKg != null ? Number(p.weightKg) : undefined;
    const unitWeight =
      totalWeight != null && Number.isFinite(totalWeight)
        ? Math.round((totalWeight / qty) * 1000) / 1000
        : undefined;
    for (let i = 0; i < qty; i++) {
      out.push({
        description: p.description,
        quantity: 1,
        packaging: p.packaging,
        weightKg: unitWeight,
        lengthCm: p.lengthCm,
        widthCm: p.widthCm,
        heightCm: p.heightCm,
        // SSCC nur auf erstes Collo der Gruppe übernehmen
        sscc: i === 0 ? p.sscc : undefined,
      });
    }
  }
  return out;
}

@Injectable()
export class ShipmentsService {
  constructor(
    private prisma: PrismaService,
    private config: ConfigService,
    private audit: AuditService,
    private notifications: NotificationsService,
    private soloplan: SoloplanService,
    private labels: LabelsService,
    private tourEta: TourEtaService,
  ) {}

  private scope(user: AuthUser) {
    return {
      organizationId: user.organizationId,
      ...mandantFilter(user),
      ...customerFilter(user),
    };
  }

  /**
   * Scanning nur Mandant Soloplan-OrgaNumber 2 (= Code AG / WOG Logistics AG).
   * Übersteuerbar via SCANNING_MANDANT_CODE.
   */
  private async resolveScanningMandantId(user: AuthUser): Promise<string> {
    const code = this.config.get<string>('SCANNING_MANDANT_CODE') || 'AG';
    const mandant = await this.prisma.mandant.findFirst({
      where: { organizationId: user.organizationId, code, active: true },
      select: { id: true, code: true, name: true },
    });
    if (!mandant) {
      throw new BadRequestException(
        `Scanning-Mandant „${code}“ (Soloplan-Organisation/Mandant 2) nicht gefunden`,
      );
    }
    if (
      (user.role === UserRole.MANDANT_DISPATCHER || user.role === UserRole.PARTNER) &&
      !user.mandantIds.includes(mandant.id)
    ) {
      throw new ForbiddenException(
        `Kein Zugriff auf Scanning-Mandant ${mandant.code} (Organisation/Mandant 2)`,
      );
    }
    return mandant.id;
  }

  async list(
    user: AuthUser,
    opts?: {
      mandantId?: string;
      q?: string;
      /** Kunden-Dokumente: fehlende Kategorie (z. B. CUSTOMS_EXIT) */
      missingDocCategory?: string;
      /** Kunden-Dokumente: not_downloaded | downloaded */
      docDownload?: string;
      docCategory?: string;
      /** pickupDate | deliveryDate | createdAt */
      sort?: string;
      /** asc | desc */
      dir?: string;
    },
  ) {
    const where: Record<string, unknown> = { ...this.scope(user) };
    const mandantId = opts?.mandantId;
    if (mandantId) {
      if (user.role === UserRole.MANDANT_DISPATCHER || user.role === UserRole.PARTNER) {
        assertMandantAccess(user, mandantId);
      }
      where.mandantId = mandantId;
    }
    const q = opts?.q?.trim();
    const and: Record<string, unknown>[] = [];
    if (q) {
      and.push({
        OR: [
          { trackingNumber: { contains: q, mode: 'insensitive' } },
          { reference: { contains: q, mode: 'insensitive' } },
          { soloplanRef: { contains: q, mode: 'insensitive' } },
          { deliveryCompany: { contains: q, mode: 'insensitive' } },
          { pickupCompany: { contains: q, mode: 'insensitive' } },
          { deliveryCity: { contains: q, mode: 'insensitive' } },
          { pickupCity: { contains: q, mode: 'insensitive' } },
          { deliveryZip: { contains: q, mode: 'insensitive' } },
          { pickupZip: { contains: q, mode: 'insensitive' } },
          { notes: { contains: q, mode: 'insensitive' } },
          // Soloplan / Kunden: externe Auftragsnr. (z. B. A-… / VLB…) + Soloplan-Auftrag
          { order: { externalNumber: { contains: q, mode: 'insensitive' } } },
          { order: { soloplanRef: { contains: q, mode: 'insensitive' } } },
          // Soloplan externe Sendungsnummer (WE/LAK) + Post-Barcode in extras
          { extras: { path: ['externalShipmentNumber'], string_contains: q } },
          { extras: { path: ['postBarcode'], string_contains: q } },
          { customer: { name: { contains: q, mode: 'insensitive' } } },
        ],
      });
    }

    const missingCat = opts?.missingDocCategory?.trim().toUpperCase();
    if (missingCat) {
      and.push({
        NOT: {
          documents: {
            some: { categoryCode: missingCat as any },
          },
        },
      });
    }

    const docCat = opts?.docCategory?.trim().toUpperCase();
    const downloadFilter = opts?.docDownload?.trim().toLowerCase();
    if (downloadFilter === 'not_downloaded' || downloadFilter === 'downloaded') {
      const categoryFilter = docCat ? { categoryCode: docCat as any } : { categoryCode: { not: null } };
      if (downloadFilter === 'not_downloaded') {
        and.push({
          documents: {
            some: {
              ...categoryFilter,
              downloads: user.id
                ? { none: { userId: user.id } }
                : { none: {} },
            },
          },
        });
      } else {
        and.push({
          documents: {
            some: {
              ...categoryFilter,
              downloads: user.id ? { some: { userId: user.id } } : { some: {} },
            },
          },
        });
      }
    } else if (docCat) {
      and.push({
        documents: { some: { categoryCode: docCat as any } },
      });
    }

    if (and.length) where.AND = and;

    // Kunden-Rolle: nur freigeschaltete Dokument-Kategorien in der Übersicht
    let customerAllowedCategories: Set<string> | null = null;
    let customerModuleEnabled = false;
    if (user.role === UserRole.CUSTOMER_USER && user.customerId) {
      const cust = await this.prisma.customer.findFirst({
        where: { id: user.customerId, organizationId: user.organizationId },
        select: {
          documentsModuleEnabled: true,
          documentCategoryAccess: {
            where: { active: true },
            select: { category: true },
          },
        },
      });
      customerModuleEnabled = Boolean(cust?.documentsModuleEnabled);
      if (customerModuleEnabled) {
        customerAllowedCategories = new Set(
          (cust?.documentCategoryAccess || []).map((a) => String(a.category)),
        );
      }
    }

    const sortKey = String(opts?.sort || 'createdAt').trim();
    const sortDir = String(opts?.dir || 'desc').toLowerCase() === 'asc' ? 'asc' : 'desc';
    const orderBy =
      sortKey === 'pickupDate'
        ? [{ pickupDate: sortDir as 'asc' | 'desc' }, { createdAt: 'desc' as const }]
        : sortKey === 'deliveryDate'
          ? [{ deliveryDate: sortDir as 'asc' | 'desc' }, { createdAt: 'desc' as const }]
          : [{ createdAt: sortDir as 'asc' | 'desc' }];

    const rows = await this.prisma.shipment.findMany({
      where,
      include: {
        mandant: true,
        customer: {
          select: {
            id: true,
            name: true,
            customerNumber: true,
            documentsModuleEnabled: true,
          },
        },
        order: { include: { freightPayer: true } },
        events: { orderBy: { createdAt: 'desc' }, take: 1 },
        documents: {
          where: { categoryCode: { not: null } },
          select: {
            id: true,
            fileName: true,
            categoryCode: true,
            createdAt: true,
            downloads: user.id
              ? { where: { userId: user.id }, select: { downloadedAt: true }, take: 1 }
              : { select: { downloadedAt: true }, take: 1 },
          },
          orderBy: { createdAt: 'desc' },
        },
      },
      orderBy,
      take: 500,
    });

    return rows.map((s) => {
      let docs = s.documents || [];
      if (user.role === UserRole.CUSTOMER_USER) {
        if (!customerModuleEnabled || !customerAllowedCategories?.size) {
          docs = [];
        } else {
          docs = docs.filter(
            (d) => d.categoryCode && customerAllowedCategories!.has(String(d.categoryCode)),
          );
        }
      }
      const extras =
        s.extras && typeof s.extras === 'object' && !Array.isArray(s.extras)
          ? (s.extras as Record<string, unknown>)
          : {};
      return {
        ...s,
        postBarcode: typeof extras.postBarcode === 'string' ? extras.postBarcode : null,
        externalShipmentNumber:
          typeof extras.externalShipmentNumber === 'string'
            ? extras.externalShipmentNumber
            : null,
        customerDocuments: docs.map((d) => ({
          id: d.id,
          fileName: d.fileName,
          categoryCode: d.categoryCode,
          createdAt: d.createdAt,
          downloaded: (d.downloads || []).length > 0,
          downloadedAt: d.downloads?.[0]?.downloadedAt || null,
        })),
        documents: undefined,
      };
    });
  }

  async get(user: AuthUser, id: string) {
    const shipment = await this.prisma.shipment.findFirst({
      where: { id, ...this.scope(user) },
      include: {
        mandant: true,
        customer: true,
        order: { include: { freightPayer: { include: { contacts: true } } } },
        positions: true,
        colli: { orderBy: { itemNumber: 'asc' } },
        events: { orderBy: { createdAt: 'asc' } },
        documents: {
          orderBy: { createdAt: 'desc' },
          include: {
            // Kunde: eigener Download; Dispo/Admin: ob jemand geöffnet hat
            downloads:
              user.role === UserRole.CUSTOMER_USER && user.id
                ? {
                    where: { userId: user.id },
                    select: { downloadedAt: true },
                    take: 1,
                  }
                : {
                    select: { downloadedAt: true },
                    take: 1,
                    orderBy: { downloadedAt: 'desc' as const },
                  },
          },
        },
        customsRefs: { orderBy: { lastSeenAt: 'desc' } },
      },
    });
    if (!shipment) throw new NotFoundException();
    if (
      (user.role === UserRole.MANDANT_DISPATCHER || user.role === UserRole.PARTNER) &&
      !user.mandantIds.includes(shipment.mandantId)
    ) {
      throw new ForbiddenException();
    }
    const eta = await this.tourEta.findEtaForShipment({
      organizationId: shipment.organizationId,
      soloplanRef: shipment.soloplanRef || shipment.order?.soloplanRef,
      trackingNumber: shipment.trackingNumber,
      reference: shipment.reference,
      orderExternalNumber: shipment.order?.externalNumber,
    });
    const customsRefs = (shipment.customsRefs || []).map((r) => ({
      ...r,
      sourceLabel: CUSTOMS_REF_SOURCE_LABELS[r.source] || r.source,
    }));
    const documents = (shipment.documents || []).map((d) => ({
      ...d,
      downloaded: (d.downloads || []).length > 0,
      downloadedAt: d.downloads?.[0]?.downloadedAt || null,
      downloads: undefined,
    }));

    // Kunden-Rolle: Dokumentenfreigabe für Checkbox „Austritt hochgeladen“
    let documentsModule: {
      enabled: boolean;
      categories: string[];
    } | null = null;
    if (user.role === UserRole.CUSTOMER_USER && user.customerId) {
      const cust = await this.prisma.customer.findFirst({
        where: { id: user.customerId, organizationId: user.organizationId },
        select: {
          documentsModuleEnabled: true,
          documentCategoryAccess: {
            where: { active: true },
            select: { category: true },
          },
        },
      });
      documentsModule = {
        enabled: Boolean(cust?.documentsModuleEnabled),
        categories: (cust?.documentCategoryAccess || []).map((a) => String(a.category)),
      };
    }

    return { ...shipment, documents, customsRefs, eta, documentsModule };
  }

  /** Lager-Scan: Collo anhand SSCC finden – nur Mandant 2 (AG). */
  async findBySscc(user: AuthUser, rawSscc: string) {
    if (user.role === UserRole.CUSTOMER_USER) {
      throw new ForbiddenException('Scanning nur für Lager / Disposition');
    }
    // GS1-18 oder Soloplan-Code (z. B. IKU… / Wareneingang).
    // Etikett oft mit AI (00) → führende 00 im Scan; DB ggf. 17/18/20 Stellen.
    const candidates = ssccMatchCandidates(rawSscc);
    const sscc = candidates[0] || normalizeScanCode(rawSscc) || parseSsccFromScan(rawSscc);
    if (!sscc) {
      throw new BadRequestException('Ungültige SSCC (GS1-18 oder Soloplan-Code erwartet)');
    }

    const scanningMandantId = await this.resolveScanningMandantId(user);

    const collo = await this.prisma.shipmentCollo.findFirst({
      where: {
        sscc: { in: candidates },
        shipment: {
          organizationId: user.organizationId,
          mandantId: scanningMandantId,
          ...customerFilter(user),
        },
      },
      include: {
        shipment: {
          include: {
            mandant: { select: { id: true, code: true, name: true } },
            customer: { select: { id: true, name: true, customerNumber: true } },
            order: { select: { id: true, externalNumber: true } },
            colli: { orderBy: { itemNumber: 'asc' }, select: { id: true, itemNumber: true, sscc: true } },
          },
        },
      },
    });
    if (!collo) throw new NotFoundException(`Kein Collo mit SSCC ${sscc} gefunden`);

    const shipment = collo.shipment;

    const isWareneingang =
      /wareneingang/i.test(shipment.goodsDescription || '') ||
      /wareneingang/i.test(shipment.reference || '') ||
      /^2291\b/i.test(shipment.reference || '') ||
      shipment.reference?.includes('2291');

    return {
      sscc: collo.sscc || sscc,
      scannedAt: new Date().toISOString(),
      collo: {
        id: collo.id,
        itemNumber: collo.itemNumber,
        sscc: collo.sscc,
        content: collo.content,
        packaging: collo.packaging,
        quantity: collo.quantity,
        weightKg: collo.weightKg,
        lengthCm: collo.lengthCm,
        widthCm: collo.widthCm,
        heightCm: collo.heightCm,
      },
      shipment: {
        id: shipment.id,
        trackingNumber: shipment.trackingNumber,
        reference: shipment.reference,
        status: shipment.status,
        goodsDescription: shipment.goodsDescription,
        packageCount: shipment.packageCount,
        weightKg: shipment.weightKg,
        pickupCompany: shipment.pickupCompany,
        pickupStreet: shipment.pickupStreet,
        pickupCity: shipment.pickupCity,
        pickupZip: shipment.pickupZip,
        pickupCountry: shipment.pickupCountry,
        deliveryCompany: shipment.deliveryCompany,
        deliveryStreet: shipment.deliveryStreet,
        deliveryCity: shipment.deliveryCity,
        deliveryZip: shipment.deliveryZip,
        deliveryCountry: shipment.deliveryCountry,
        mandant: shipment.mandant,
        customer: shipment.customer,
        order: shipment.order,
        colloCount: shipment.colli.length,
        isWareneingang: !!isWareneingang,
      },
    };
  }

  /**
   * Labels für Lager-Scanning (nur Mandant 2 / AG):
   * - SCAN-TEST-* (Übung)
   * - Auftrag 2291 / Bezeichnung Wareneingang
   */
  async listScanTestLabels(user: AuthUser) {
    if (user.role === UserRole.CUSTOMER_USER) {
      throw new ForbiddenException('Scanning nur für Lager / Disposition');
    }

    const scanningMandantId = await this.resolveScanningMandantId(user);

    const scope = {
      organizationId: user.organizationId,
      mandantId: scanningMandantId,
      ...customerFilter(user),
    };

    const shipments = await this.prisma.shipment.findMany({
      where: {
        ...scope,
        status: { not: 'CANCELLED' },
        OR: [
          { reference: { startsWith: 'SCAN-TEST-' } },
          { reference: { startsWith: 'WE-' } },
          { reference: { startsWith: 'BK', mode: 'insensitive' } },
          { reference: { startsWith: 'LAK', mode: 'insensitive' } },
          { reference: { contains: '2291', mode: 'insensitive' } },
          { reference: { contains: 'Wareneingang', mode: 'insensitive' } },
          { goodsDescription: { contains: 'Wareneingang', mode: 'insensitive' } },
        ],
      },
      select: {
        id: true,
        reference: true,
        trackingNumber: true,
        status: true,
        goodsDescription: true,
        pickupCompany: true,
        pickupStreet: true,
        pickupZip: true,
        pickupCity: true,
        pickupCountry: true,
        deliveryCompany: true,
        deliveryStreet: true,
        deliveryZip: true,
        deliveryCity: true,
        deliveryCountry: true,
        customer: { select: { id: true, name: true, customerNumber: true } },
        colli: {
          orderBy: { itemNumber: 'asc' },
          select: { id: true, itemNumber: true, sscc: true },
        },
        documents: {
          where: { type: DocumentType.LABEL },
          orderBy: { createdAt: 'asc' },
          select: { id: true, fileName: true, createdAt: true },
        },
      },
      orderBy: [{ reference: 'asc' }, { createdAt: 'desc' }],
      take: 50,
    });

    return shipments.map((s) => {
      const printDocument =
        s.documents.find((d) => d.fileName.startsWith('Etiketten-')) || s.documents[0] || null;
      const isWareneingang =
        /wareneingang/i.test(s.goodsDescription || '') ||
        /wareneingang/i.test(s.reference || '') ||
        (s.reference || '').includes('2291');
      const isTest = (s.reference || '').startsWith('SCAN-TEST-');
      return {
        id: s.id,
        reference: s.reference,
        trackingNumber: s.trackingNumber,
        status: s.status,
        goodsDescription: s.goodsDescription,
        pickupCompany: s.pickupCompany,
        pickupStreet: s.pickupStreet,
        pickupZip: s.pickupZip,
        pickupCity: s.pickupCity,
        pickupCountry: s.pickupCountry,
        deliveryCompany: s.deliveryCompany,
        deliveryStreet: s.deliveryStreet,
        deliveryZip: s.deliveryZip,
        deliveryCity: s.deliveryCity,
        deliveryCountry: s.deliveryCountry,
        customer: s.customer,
        kind: isWareneingang ? 'wareneingang' : isTest ? 'test' : 'other',
        colli: s.colli,
        documents: s.documents,
        printDocument,
      };
    });
  }

  async create(
    user: AuthUser,
    data: {
      mandantId: string;
      orderId?: string;
      customerId?: string;
      reference?: string;
      transportMode?: string;
      goodsDescription?: string;
      packageCount?: number;
      weightKg?: number;
      volumeM3?: number;
      pickupAddressId?: string;
      deliveryAddressId?: string;
      pickupCompany?: string;
      pickupStreet?: string;
      pickupZip?: string;
      pickupCity?: string;
      pickupCountry?: string;
      pickupDate?: string;
      deliveryCompany?: string;
      deliveryStreet?: string;
      deliveryZip?: string;
      deliveryCity?: string;
      deliveryCountry?: string;
      deliveryDate?: string;
      deliveryDateEnd?: string;
      deliveryAvisPhone?: string;
      notes?: string;
      extras?: Record<string, unknown>;
      submit?: boolean;
      savePickupAddress?: boolean;
      saveDeliveryAddress?: boolean;
      saveAsTemplateName?: string;
      positions?: PositionInput[];
    },
  ) {
    const expandedPositions = data.positions?.length
      ? expandPositionsToColli(data.positions)
      : [];

    let customerId = data.customerId;
    if (user.role === UserRole.CUSTOMER_USER) {
      if (!user.customerId) throw new ForbiddenException('Kein Kundenkonto verknüpft');
      customerId = user.customerId;
    }
    if (!customerId) throw new ForbiddenException('customerId erforderlich');

    let pickupCompany = data.pickupCompany;
    let pickupStreet = data.pickupStreet;
    let pickupZip = data.pickupZip;
    let pickupCity = data.pickupCity;
    let pickupCountry = data.pickupCountry || 'AT';
    let deliveryCompany = data.deliveryCompany;
    let deliveryStreet = data.deliveryStreet;
    let deliveryZip = data.deliveryZip;
    let deliveryCity = data.deliveryCity;
    let deliveryCountry = data.deliveryCountry || 'AT';

    if (data.pickupAddressId) {
      const addr = await this.prisma.address.findFirst({
        where: { id: data.pickupAddressId, customerId },
      });
      if (!addr) throw new NotFoundException('Abholadresse nicht gefunden');
      pickupCompany = addr.company || pickupCompany;
      pickupStreet = addr.street;
      pickupZip = addr.zip;
      pickupCity = addr.city;
      pickupCountry = addr.country;
    }
    if (data.deliveryAddressId) {
      const addr = await this.prisma.address.findFirst({
        where: { id: data.deliveryAddressId, customerId },
      });
      if (!addr) throw new NotFoundException('Zustelladresse nicht gefunden');
      deliveryCompany = addr.company || deliveryCompany;
      deliveryStreet = addr.street;
      deliveryZip = addr.zip;
      deliveryCity = addr.city;
      deliveryCountry = addr.country;
    }

    // Grenzverkehr ↔ CH/LI: Verzollungsbelege + Mandant 2 (GmbH).
    // Inland CH↔CH / CH↔LI: keine Dokumentenpflicht.
    let mandantId = data.mandantId;
    let extrasObj: Record<string, unknown> =
      data.extras && typeof data.extras === 'object' && !Array.isArray(data.extras)
        ? { ...(data.extras as Record<string, unknown>) }
        : {};
    if (requiresChLiCustomsDocuments(pickupCountry, deliveryCountry)) {
      extrasObj = { ...extrasObj, verzollung: true, begleitpapiere: true };
      const customsMandant = await this.prisma.mandant.findFirst({
        where: {
          organizationId: user.organizationId,
          active: true,
          OR: [
            { code: { in: [...CH_LI_CUSTOMS_MANDANT_CODES], mode: 'insensitive' } },
            { name: { contains: 'GmbH', mode: 'insensitive' } },
          ],
        },
        orderBy: { createdAt: 'asc' },
      });
      if (customsMandant) mandantId = customsMandant.id;
    }

    const mandant = await this.prisma.mandant.findFirst({
      where: { id: mandantId, organizationId: user.organizationId, active: true },
    });
    if (!mandant) throw new NotFoundException('Mandant nicht gefunden');

    const status = data.submit ? ShipmentStatus.SUBMITTED : ShipmentStatus.DRAFT;

    // Frachtzahler = eingeloggter Kunde; Fallback für Admin ohne Kundenkonto = Sendungskunde
    const freightPayerCustomerId = user.customerId || customerId;

    // 1:1 Auftrag ↔ Sendung: Anhängen weiterer Sendungen ist nicht erlaubt.
    let transportOrder;
    if (data.orderId) {
      transportOrder = await this.prisma.transportOrder.findFirst({
        where: {
          id: data.orderId,
          organizationId: user.organizationId,
          mandantId,
        },
        include: { _count: { select: { shipments: true } } },
      });
      if (!transportOrder) throw new NotFoundException('Auftrag nicht gefunden');
      if (
        user.role === UserRole.CUSTOMER_USER &&
        user.customerId &&
        transportOrder.freightPayerCustomerId !== user.customerId
      ) {
        throw new ForbiddenException('Auftrag gehört nicht zu Ihrem Kundenkonto');
      }
      if (
        (user.role === UserRole.MANDANT_DISPATCHER || user.role === UserRole.PARTNER) &&
        !user.mandantIds.includes(transportOrder.mandantId)
      ) {
        throw new ForbiddenException();
      }
      if (transportOrder._count.shipments > 0) {
        throw new BadRequestException(
          'Pro Auftrag ist nur eine Sendung erlaubt. Bitte einen neuen Auftrag anlegen.',
        );
      }
    } else {
      transportOrder = await this.createTransportOrder(user, {
        mandantId,
        freightPayerCustomerId,
      });
    }

    const shipment = await this.prisma.shipment.create({
      data: {
        organizationId: user.organizationId,
        mandantId,
        customerId,
        orderId: transportOrder.id,
        trackingNumber: trackingNumber(),
        // 8-stellige PIN – erschwert Brute-Force gegenüber 4 Stellen
        trackingPin: String(Math.floor(10_000_000 + Math.random() * 90_000_000)),
        // Sendungsreferenz optional; Auftragsnummer nur am TransportOrder (VLB…)
        reference: data.reference,
        status,
        transportMode: data.transportMode,
        goodsDescription: data.goodsDescription,
        packageCount: expandedPositions.length || data.packageCount || 1,
        weightKg:
          data.weightKg ??
          (expandedPositions.length
            ? expandedPositions.reduce((sum, p) => sum + (p.weightKg || 0), 0) || undefined
            : undefined),
        volumeM3: data.volumeM3,
        pickupCompany,
        pickupStreet,
        pickupZip,
        pickupCity,
        pickupCountry,
        pickupDate: data.pickupDate ? new Date(data.pickupDate) : undefined,
        deliveryCompany,
        deliveryStreet,
        deliveryZip,
        deliveryCity,
        deliveryCountry,
        deliveryDate: data.deliveryDate ? new Date(data.deliveryDate) : undefined,
        deliveryDateEnd: data.deliveryDateEnd ? new Date(data.deliveryDateEnd) : undefined,
        deliveryAvisPhone: data.deliveryAvisPhone?.trim() || undefined,
        notes: data.notes,
        extras:
          Object.keys(extrasObj).length
            ? (extrasObj as Prisma.InputJsonValue)
            : undefined,
        createdById: user.id,
        positions: expandedPositions.length
          ? {
              create: expandedPositions.map((p) => ({
                description: p.description,
                quantity: 1,
                packaging: p.packaging,
                weightKg: p.weightKg,
                lengthCm: p.lengthCm,
                widthCm: p.widthCm,
                heightCm: p.heightCm,
                sscc: p.sscc,
              })),
            }
          : undefined,
        events: {
          create: {
            status,
            message: status === ShipmentStatus.SUBMITTED ? 'Auftrag übermittelt' : 'Entwurf angelegt',
            createdBy: user.id,
          },
        },
      },
      include: {
        mandant: true,
        customer: true,
        order: { include: { freightPayer: true } },
        positions: true,
        events: true,
      },
    });

    // Adressen standardmäßig ins Adressbuch (außer explizit abgewählt)
    if (data.savePickupAddress !== false && pickupStreet && pickupZip && pickupCity) {
      await this.ensureCustomerAddress(customerId, {
        label: pickupCompany || 'Abholung',
        company: pickupCompany,
        street: pickupStreet,
        zip: pickupZip,
        city: pickupCity,
        country: pickupCountry,
        usage: 'PICKUP',
      });
    }
    if (data.saveDeliveryAddress !== false && deliveryStreet && deliveryZip && deliveryCity) {
      await this.ensureCustomerAddress(customerId, {
        label: deliveryCompany || 'Zustellung',
        company: deliveryCompany,
        street: deliveryStreet,
        zip: deliveryZip,
        city: deliveryCity,
        country: deliveryCountry,
        usage: 'DELIVERY',
      });
    }
    if (data.saveAsTemplateName) {
      await this.prisma.shipmentTemplate.create({
        data: {
          customerId,
          name: data.saveAsTemplateName,
          mandantId: data.mandantId,
          reference: data.reference,
          transportMode: data.transportMode,
          goodsDescription: data.goodsDescription,
          packageCount: data.packageCount ?? 1,
          weightKg: data.weightKg,
          pickupAddressId: data.pickupAddressId,
          deliveryAddressId: data.deliveryAddressId,
          pickupCompany,
          pickupStreet,
          pickupZip,
          pickupCity,
          pickupCountry,
          deliveryCompany,
          deliveryStreet,
          deliveryZip,
          deliveryCity,
          deliveryCountry,
          notes: data.notes,
        },
      });
    }

    await this.audit.log(user.id, 'shipment.create', 'Shipment', shipment.id, {
      trackingNumber: shipment.trackingNumber,
      mandantId: shipment.mandantId,
      orderId: transportOrder.id,
      orderExternalNumber: transportOrder.externalNumber,
    });

    // Colli inkl. Abmessungen/SSCC sofort anlegen (nicht erst bei Etikettenerzeugung)
    await this.labels.ensureColli({
      id: shipment.id,
      organizationId: shipment.organizationId,
      packageCount: shipment.packageCount,
      weightKg: shipment.weightKg,
      goodsDescription: shipment.goodsDescription,
      positions: shipment.positions,
    });

    const needsCustomsInvoice = Boolean(extrasObj.verzollung === true);

    if (status === ShipmentStatus.SUBMITTED) {
      await this.notifications.notifyShipmentUsers(shipment.id, NotificationEvent.SHIPMENT_CREATED, {
        trackingNumber: shipment.trackingNumber,
        mandant: mandant.name,
      });
      // Bei Verzollung erst nach Rechnung (INVOICE) nach Soloplan exportieren
      if (!needsCustomsInvoice) {
        await this.soloplan.exportShipment(shipment.id);
      }
    }

    const created = await this.get(user, shipment.id);
    return {
      ...created,
      pendingSoloplanExport: needsCustomsInvoice && status === ShipmentStatus.SUBMITTED,
      requiresInvoice: needsCustomsInvoice,
    };
  }

  /** Neuer Portal-Auftrag mit externer Nummer VLB{TT}{MM}{#####}. */
  private async createTransportOrder(
    user: AuthUser,
    data: { mandantId: string; freightPayerCustomerId: string },
  ) {
    const externalNumber = await allocateVlbExternalNumber(
      this.prisma,
      user.organizationId,
    );

    const order = await this.prisma.transportOrder.create({
      data: {
        organizationId: user.organizationId,
        mandantId: data.mandantId,
        freightPayerCustomerId: data.freightPayerCustomerId,
        externalNumber,
        createdById: user.id,
      },
    });

    await this.audit.log(user.id, 'order.create', 'TransportOrder', order.id, {
      externalNumber: order.externalNumber,
      freightPayerCustomerId: data.freightPayerCustomerId,
    });

    return order;
  }

  async updateStatus(user: AuthUser, id: string, status: ShipmentStatus, message?: string, location?: string) {
    const shipment = await this.get(user, id);
    if (user.role === UserRole.CUSTOMER_USER) throw new ForbiddenException();
    assertMandantAccess(user, shipment.mandantId);

    const updated = await this.prisma.shipment.update({
      where: { id },
      data: {
        status,
        events: {
          create: {
            status,
            message: message || `Status: ${status}`,
            location,
            createdBy: user.id,
          },
        },
      },
      include: { events: { orderBy: { createdAt: 'asc' } }, mandant: true, customer: true },
    });

    await this.notifications.notifyShipmentUsers(id, NotificationEvent.STATUS_CHANGED, {
      trackingNumber: updated.trackingNumber,
      status,
      message,
    });

    if (status === ShipmentStatus.DELIVERED) {
      await this.notifications.notifyShipmentUsers(id, NotificationEvent.POD_AVAILABLE, {
        trackingNumber: updated.trackingNumber,
      });
    }

    await this.audit.log(user.id, 'shipment.status', 'Shipment', id, { status, message });
    return updated;
  }

  /**
   * Kunden-Sendungsnachfrage an Disposition (info@worldofgreen.ch):
   * Status-/Zustellinfo anfordern, wenn kein POD/Ablieferbeleg im Portal liegt.
   */
  async requestStatusInquiry(user: AuthUser, id: string, note?: string) {
    const shipment = await this.prisma.shipment.findFirst({
      where: { id, ...this.scope(user) },
      include: {
        mandant: true,
        customer: true,
        order: true,
        documents: {
          where: { type: { in: [DocumentType.POD, DocumentType.ABLIEFERBELEG] } },
          select: { id: true, type: true, fileName: true, createdAt: true },
          orderBy: { createdAt: 'desc' },
          take: 5,
        },
      },
    });
    if (!shipment) throw new NotFoundException();
    if (
      (user.role === UserRole.MANDANT_DISPATCHER || user.role === UserRole.PARTNER) &&
      !user.mandantIds.includes(shipment.mandantId)
    ) {
      throw new ForbiddenException();
    }
    if (user.role === UserRole.CUSTOMER_USER && shipment.customerId !== user.customerId) {
      throw new ForbiddenException();
    }

    const soloplanRef = [shipment.order?.soloplanRef, shipment.soloplanRef].find(
      (r) => r && !r.startsWith('FILE:') && !r.startsWith('SP-STUB-'),
    );
    const hasPod = shipment.documents.length > 0;
    const fmt = (d?: Date | null) =>
      d
        ? d.toLocaleString('de-AT', {
            day: '2-digit',
            month: '2-digit',
            year: 'numeric',
            hour: '2-digit',
            minute: '2-digit',
          })
        : '–';

    const requester = await this.prisma.user.findUnique({
      where: { id: user.id },
      select: { firstName: true, lastName: true, email: true },
    });
    const requesterName =
      [requester?.firstName, requester?.lastName].filter(Boolean).join(' ') ||
      requester?.email ||
      user.email;
    const to =
      this.config.get('SHIPMENT_INQUIRY_MAIL_TO') ||
      this.config.get('CUSTOMS_NOTIFY_TO') ||
      'info@worldofgreen.ch';

    const subject = [
      'Sendungsnachfrage',
      shipment.order?.externalNumber || shipment.trackingNumber,
      soloplanRef ? `Soloplan ${soloplanRef}` : null,
    ]
      .filter(Boolean)
      .join(' · ');

    const body = [
      'Sendungsnachfrage aus dem WOG Kundenportal',
      '',
      'Bitte um Information zum aktuellen Sendungsstatus und zur voraussichtlichen bzw. erfolgten Zustellung.',
      '',
      `Anfragender: ${requesterName}`,
      `E-Mail: ${requester?.email || user.email}`,
      `Rolle: ${user.role}`,
      '',
      `Auftragsnummer (VLB): ${shipment.order?.externalNumber || '–'}`,
      `Soloplan-Ordernummer: ${soloplanRef || '– (noch nicht verknüpft)'}`,
      `Tracking: ${shipment.trackingNumber}`,
      `Referenz: ${shipment.reference || '–'}`,
      `Kunde: ${shipment.customer?.name || '–'} (${shipment.customer?.customerNumber || '–'})`,
      `Mandant: ${shipment.mandant?.name || '–'}`,
      `Portal-Status: ${shipment.status}`,
      '',
      `Abholung: ${shipment.pickupCompany || '–'}, ${[shipment.pickupZip, shipment.pickupCity].filter(Boolean).join(' ')} (${shipment.pickupCountry || '–'})`,
      `Abholtermin: ${fmt(shipment.pickupDate)}`,
      `Empfänger: ${shipment.deliveryCompany || '–'}, ${[shipment.deliveryZip, shipment.deliveryCity].filter(Boolean).join(' ')} (${shipment.deliveryCountry || '–'})`,
      `Zustelltermin: ${fmt(shipment.deliveryDate)}${
        shipment.deliveryDateEnd && shipment.deliveryDateEnd.getTime() !== shipment.deliveryDate?.getTime()
          ? ` – ${fmt(shipment.deliveryDateEnd)}`
          : ''
      }`,
      '',
      `POD / Ablieferbeleg im Portal: ${hasPod ? 'Ja' : 'Nein – bitte Zustellinfo nachreichen'}`,
      ...(hasPod
        ? shipment.documents.map(
            (d) => `  - ${d.type}: ${d.fileName} (${fmt(d.createdAt)})`,
          )
        : []),
      '',
      note?.trim() ? `Hinweis des Kunden:\n${note.trim()}` : 'Hinweis des Kunden: (keiner)',
      '',
      `Portal-Link: ${(this.config.get('PUBLIC_WEB_URL') || 'https://wog.logistikberater.at').replace(/\/$/, '')}/shipments/${shipment.id}`,
    ].join('\n');

    await this.notifications.sendRaw(
      to,
      subject,
      body,
      NotificationEvent.STATUS_CHANGED,
      undefined,
      { replyTo: requester?.email || user.email },
    );
    await this.audit.log(user.id, 'shipment.inquiry', 'Shipment', id, {
      to,
      soloplanRef: soloplanRef || null,
      hasPod,
    });

    return { ok: true, to, hasPod, soloplanRef: soloplanRef || null };
  }

  /**
   * Adresse im Kunden-Adressbuch anlegen bzw. wiederverwenden (ohne Duplikate).
   * Gleiche Straße/PLZ/Ort/Land → bestehender Eintrag; Usage ggf. auf BOTH erweitern.
   */
  private async ensureCustomerAddress(
    customerId: string,
    data: {
      label?: string | null;
      company?: string | null;
      street: string;
      zip: string;
      city: string;
      country?: string | null;
      usage: 'PICKUP' | 'DELIVERY' | 'BOTH';
    },
  ) {
    const street = data.street.trim();
    const zip = data.zip.trim();
    const city = data.city.trim();
    const country = (data.country || 'AT').trim().toUpperCase() || 'AT';
    if (!street || !zip || !city) return null;

    const existing = await this.prisma.address.findFirst({
      where: {
        customerId,
        zip,
        country,
        street: { equals: street, mode: 'insensitive' },
        city: { equals: city, mode: 'insensitive' },
      },
    });

    if (existing) {
      const nextUsage =
        existing.usage === 'BOTH' || existing.usage === data.usage
          ? existing.usage
          : 'BOTH';
      const patch: {
        usage?: string;
        company?: string;
        label?: string;
      } = {};
      if (nextUsage !== existing.usage) patch.usage = nextUsage;
      if (data.company && !existing.company) patch.company = data.company;
      if (data.label && !existing.label) patch.label = data.label;
      if (Object.keys(patch).length) {
        return this.prisma.address.update({ where: { id: existing.id }, data: patch });
      }
      return existing;
    }

    return this.prisma.address.create({
      data: {
        customerId,
        label: data.label || data.company || (data.usage === 'PICKUP' ? 'Abholung' : 'Zustellung'),
        company: data.company || undefined,
        street,
        zip,
        city,
        country,
        usage: data.usage,
      },
    });
  }
}
