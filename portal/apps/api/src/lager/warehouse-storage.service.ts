import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  UserRole,
  WarehouseLocationKind,
  WarehouseMovementType,
  WarehousePalletType,
  WarehouseUnitStatus,
} from '@prisma/client';
import { AuthUser } from '../auth/auth.types';
import { AuditService } from '../audit/audit.service';
import { PrismaService } from '../prisma/prisma.service';

const DEFAULT_SLOT_UNITS: Record<WarehousePalletType, number> = {
  EURO: 1,
  HALF: 0.5,
  OVERSIZE: 2,
};

const PALLET_LABEL: Record<WarehousePalletType, string> = {
  EURO: 'Europalette',
  HALF: 'Halbpalette',
  OVERSIZE: 'Übergroße Palette',
};

export type EnsureRackLayoutOpts = {
  aisles?: number;
  levels?: number;
  bays?: number;
  slotsPerBay?: number;
  blockZones?: number;
};

@Injectable()
export class WarehouseStorageService {
  constructor(
    private prisma: PrismaService,
    private audit: AuditService,
  ) {}

  private assertStaff(user: AuthUser) {
    if (user.role !== UserRole.ORG_ADMIN && user.role !== UserRole.MANDANT_DISPATCHER) {
      throw new ForbiddenException('Nur Admin/Disposition/Lager');
    }
  }

  private assertOrg(user: AuthUser) {
    if (!user.organizationId) throw new ForbiddenException('Keine Organisation');
  }

  slotUnitsFor(type: WarehousePalletType, override?: number | null) {
    if (override != null && Number.isFinite(override) && override > 0) return override;
    return DEFAULT_SLOT_UNITS[type] ?? 1;
  }

  /** Standard-Hochregal: 10 Reihen × 3 Ebenen × 4 Fächer × 3 Stellplätze (+ Blocklager) */
  async ensureDefaultLayout(user: AuthUser, opts: EnsureRackLayoutOpts = {}) {
    this.assertStaff(user);
    this.assertOrg(user);
    const aisles = opts.aisles ?? 10;
    const levels = opts.levels ?? 3;
    const bays = opts.bays ?? 4;
    const slotsPerBay = opts.slotsPerBay ?? 3;
    const blockZones = opts.blockZones ?? 4;

    const existing = await this.prisma.warehouseLocation.count({
      where: { organizationId: user.organizationId, kind: WarehouseLocationKind.RACK },
    });
    if (existing > 0) {
      return {
        created: 0,
        skipped: true,
        rackCount: existing,
        message: 'Regalplätze existieren bereits – nichts angelegt.',
      };
    }

    const rows: Array<{
      organizationId: string;
      code: string;
      kind: WarehouseLocationKind;
      aisle: number | null;
      level: number | null;
      bay: number | null;
      slot: number | null;
      label: string;
      sortOrder: number;
      capacitySlots: number;
    }> = [];

    let sort = 0;
    for (let a = 1; a <= aisles; a++) {
      for (let e = 1; e <= levels; e++) {
        for (let f = 1; f <= bays; f++) {
          for (let p = 1; p <= slotsPerBay; p++) {
            const code = `R${String(a).padStart(2, '0')}-E${e}-F${String(f).padStart(2, '0')}-P${p}`;
            rows.push({
              organizationId: user.organizationId,
              code,
              kind: WarehouseLocationKind.RACK,
              aisle: a,
              level: e,
              bay: f,
              slot: p,
              label: `Reihe ${a} · Ebene ${e} · Fach ${f} · Platz ${p}`,
              sortOrder: sort++,
              capacitySlots: 1,
            });
          }
        }
      }
    }
    for (let b = 1; b <= blockZones; b++) {
      const code = `BLOCK-${String(b).padStart(2, '0')}`;
      rows.push({
        organizationId: user.organizationId,
        code,
        kind: WarehouseLocationKind.BLOCK,
        aisle: null,
        level: null,
        bay: null,
        slot: null,
        label: `Blocklager ${b}`,
        sortOrder: 100000 + b,
        capacitySlots: 50,
      });
    }

    await this.prisma.warehouseLocation.createMany({ data: rows });
    await this.audit.log(user.id, 'warehouse.layout.seed', 'WarehouseLocation', undefined, {
      aisles,
      levels,
      bays,
      slotsPerBay,
      blockZones,
      count: rows.length,
    });
    return { created: rows.length, skipped: false, rackCount: rows.length };
  }

  async listLocations(
    user: AuthUser,
    opts: { kind?: string; freeOnly?: boolean; q?: string } = {},
  ) {
    this.assertOrg(user);
    if (user.role === UserRole.CUSTOMER_USER) throw new ForbiddenException();
    this.assertStaff(user);

    const locs = await this.prisma.warehouseLocation.findMany({
      where: {
        organizationId: user.organizationId,
        active: true,
        ...(opts.kind === 'RACK' || opts.kind === 'BLOCK'
          ? { kind: opts.kind as WarehouseLocationKind }
          : {}),
        ...(opts.q?.trim()
          ? {
              OR: [
                { code: { contains: opts.q.trim(), mode: 'insensitive' } },
                { label: { contains: opts.q.trim(), mode: 'insensitive' } },
              ],
            }
          : {}),
      },
      include: {
        units: {
          where: { status: WarehouseUnitStatus.STORED },
          select: { id: true, slotUnits: true, palletType: true, customerId: true },
        },
      },
      orderBy: [{ sortOrder: 'asc' }, { code: 'asc' }],
    });

    const mapped = locs.map((l) => {
      const used = l.units.reduce((s, u) => s + u.slotUnits, 0);
      const free = Math.max(0, l.capacitySlots - used);
      return {
        id: l.id,
        code: l.code,
        kind: l.kind,
        aisle: l.aisle,
        level: l.level,
        bay: l.bay,
        slot: l.slot,
        label: l.label,
        capacitySlots: l.capacitySlots,
        usedSlots: used,
        freeSlots: free,
        occupied: used > 0,
        unitCount: l.units.length,
      };
    });
    return opts.freeOnly ? mapped.filter((m) => m.freeSlots >= 0.5) : mapped;
  }

  async createLocation(
    user: AuthUser,
    data: {
      code: string;
      kind?: WarehouseLocationKind;
      aisle?: number;
      level?: number;
      bay?: number;
      slot?: number;
      label?: string;
      capacitySlots?: number;
    },
  ) {
    this.assertStaff(user);
    this.assertOrg(user);
    const code = String(data.code || '')
      .trim()
      .toUpperCase();
    if (!code) throw new BadRequestException('Code fehlt');
    return this.prisma.warehouseLocation.create({
      data: {
        organizationId: user.organizationId,
        code,
        kind: data.kind || WarehouseLocationKind.RACK,
        aisle: data.aisle ?? null,
        level: data.level ?? null,
        bay: data.bay ?? null,
        slot: data.slot ?? null,
        label: data.label?.trim() || code,
        capacitySlots: data.capacitySlots && data.capacitySlots > 0 ? data.capacitySlots : 1,
        sortOrder: (data.aisle || 0) * 10000 + (data.level || 0) * 100 + (data.bay || 0) * 10 + (data.slot || 0),
      },
    });
  }

  async updateLocation(
    user: AuthUser,
    id: string,
    data: Partial<{
      label: string;
      active: boolean;
      capacitySlots: number;
      code: string;
    }>,
  ) {
    this.assertStaff(user);
    const loc = await this.prisma.warehouseLocation.findFirst({
      where: { id, organizationId: user.organizationId },
    });
    if (!loc) throw new NotFoundException('Platz nicht gefunden');
    return this.prisma.warehouseLocation.update({
      where: { id },
      data: {
        ...(data.label !== undefined ? { label: data.label } : {}),
        ...(data.active !== undefined ? { active: data.active } : {}),
        ...(data.capacitySlots !== undefined ? { capacitySlots: data.capacitySlots } : {}),
        ...(data.code !== undefined ? { code: data.code.trim().toUpperCase() } : {}),
      },
    });
  }

  async listStock(
    user: AuthUser,
    opts: {
      customerId?: string;
      q?: string;
      locationId?: string;
      status?: 'STORED' | 'RELEASED' | 'ALL';
    } = {},
  ) {
    this.assertOrg(user);
    let customerId = opts.customerId;
    if (user.role === UserRole.CUSTOMER_USER) {
      if (!user.customerId) throw new ForbiddenException();
      customerId = user.customerId;
    } else {
      this.assertStaff(user);
    }

    const status =
      opts.status === 'ALL'
        ? undefined
        : opts.status === 'RELEASED'
          ? WarehouseUnitStatus.RELEASED
          : WarehouseUnitStatus.STORED;

    const q = opts.q?.trim();
    return this.prisma.warehouseStorageUnit.findMany({
      where: {
        organizationId: user.organizationId,
        ...(customerId ? { customerId } : {}),
        ...(opts.locationId ? { locationId: opts.locationId } : {}),
        ...(status ? { status } : {}),
        ...(q
          ? {
              OR: [
                { articleName: { contains: q, mode: 'insensitive' } },
                { serialNumber: { contains: q, mode: 'insensitive' } },
                { sscc: { contains: q, mode: 'insensitive' } },
                { externalRef: { contains: q, mode: 'insensitive' } },
                { location: { code: { contains: q, mode: 'insensitive' } } },
                { customer: { name: { contains: q, mode: 'insensitive' } } },
              ],
            }
          : {}),
      },
      include: {
        customer: { select: { id: true, name: true, customerNumber: true } },
        location: { select: { id: true, code: true, kind: true, label: true } },
      },
      orderBy: [{ status: 'asc' }, { storedAt: 'desc' }],
      take: 500,
    });
  }

  async inbound(
    user: AuthUser,
    data: {
      customerId: string;
      locationId: string;
      palletType: WarehousePalletType;
      slotUnits?: number;
      articleName?: string;
      serialNumber?: string;
      sscc?: string;
      externalRef?: string;
      shipmentId?: string;
      notes?: string;
    },
  ) {
    this.assertStaff(user);
    this.assertOrg(user);

    const customer = await this.prisma.customer.findFirst({
      where: { id: data.customerId, organizationId: user.organizationId },
    });
    if (!customer) throw new BadRequestException('Kunde nicht gefunden');

    const location = await this.prisma.warehouseLocation.findFirst({
      where: { id: data.locationId, organizationId: user.organizationId, active: true },
      include: { units: { where: { status: WarehouseUnitStatus.STORED } } },
    });
    if (!location) throw new BadRequestException('Lagerplatz nicht gefunden');

    const palletType = data.palletType || WarehousePalletType.EURO;
    const slotUnits = this.slotUnitsFor(palletType, data.slotUnits);
    const used = location.units.reduce((s, u) => s + u.slotUnits, 0);
    if (used + slotUnits > location.capacitySlots + 0.001) {
      throw new BadRequestException(
        `Platz ${location.code} voll (frei ${Math.max(0, location.capacitySlots - used).toFixed(2)} / braucht ${slotUnits})`,
      );
    }

    const rate = await this.getRate(user.organizationId, data.customerId, palletType);
    const unitPrice = rate?.inboundFee ?? 0;

    const unit = await this.prisma.warehouseStorageUnit.create({
      data: {
        organizationId: user.organizationId,
        customerId: data.customerId,
        locationId: location.id,
        shipmentId: data.shipmentId || null,
        palletType,
        slotUnits,
        articleName: data.articleName?.trim() || null,
        serialNumber: data.serialNumber?.trim() || null,
        sscc: data.sscc?.trim() || null,
        externalRef: data.externalRef?.trim() || null,
        notes: data.notes?.trim() || null,
        status: WarehouseUnitStatus.STORED,
        storedById: user.id,
      },
      include: {
        customer: { select: { id: true, name: true, customerNumber: true } },
        location: { select: { id: true, code: true, kind: true, label: true } },
      },
    });

    await this.prisma.warehouseMovement.create({
      data: {
        organizationId: user.organizationId,
        customerId: data.customerId,
        storageUnitId: unit.id,
        locationId: location.id,
        type: WarehouseMovementType.IN,
        palletType,
        slotUnits,
        unitPrice,
        amount: unitPrice,
        articleName: unit.articleName,
        serialNumber: unit.serialNumber,
        shipmentId: unit.shipmentId,
        performedById: user.id,
      },
    });

    await this.audit.log(user.id, 'warehouse.inbound', 'WarehouseStorageUnit', unit.id, {
      location: location.code,
      customerId: data.customerId,
      palletType,
    });

    return unit;
  }

  async outbound(user: AuthUser, unitId: string, note?: string) {
    this.assertStaff(user);
    this.assertOrg(user);

    const unit = await this.prisma.warehouseStorageUnit.findFirst({
      where: { id: unitId, organizationId: user.organizationId },
      include: { location: true, customer: true },
    });
    if (!unit) throw new NotFoundException('Lagerposition nicht gefunden');
    if (unit.status !== WarehouseUnitStatus.STORED) {
      throw new BadRequestException('Bereits ausgelagert');
    }

    const rate = await this.getRate(user.organizationId, unit.customerId, unit.palletType);
    const unitPrice = rate?.outboundFee ?? 0;

    const updated = await this.prisma.warehouseStorageUnit.update({
      where: { id: unit.id },
      data: {
        status: WarehouseUnitStatus.RELEASED,
        releasedAt: new Date(),
        releasedById: user.id,
        notes: note?.trim()
          ? [unit.notes, `Auslagerung: ${note.trim()}`].filter(Boolean).join('\n')
          : unit.notes,
      },
      include: {
        customer: { select: { id: true, name: true, customerNumber: true } },
        location: { select: { id: true, code: true, kind: true, label: true } },
      },
    });

    await this.prisma.warehouseMovement.create({
      data: {
        organizationId: user.organizationId,
        customerId: unit.customerId,
        storageUnitId: unit.id,
        locationId: unit.locationId,
        type: WarehouseMovementType.OUT,
        palletType: unit.palletType,
        slotUnits: unit.slotUnits,
        unitPrice,
        amount: unitPrice,
        articleName: unit.articleName,
        serialNumber: unit.serialNumber,
        shipmentId: unit.shipmentId,
        note: note?.trim() || null,
        performedById: user.id,
      },
    });

    await this.audit.log(user.id, 'warehouse.outbound', 'WarehouseStorageUnit', unit.id, {
      location: unit.location.code,
    });

    return updated;
  }

  async listRates(user: AuthUser, customerId?: string) {
    this.assertStaff(user);
    return this.prisma.warehousePriceRate.findMany({
      where: {
        organizationId: user.organizationId,
        ...(customerId ? { customerId } : {}),
        active: true,
      },
      include: { customer: { select: { id: true, name: true, customerNumber: true } } },
      orderBy: [{ customer: { name: 'asc' } }, { palletType: 'asc' }],
    });
  }

  async upsertRate(
    user: AuthUser,
    data: {
      customerId: string;
      palletType: WarehousePalletType;
      inboundFee: number;
      outboundFee: number;
      storageFeePerSlot: number;
    },
  ) {
    this.assertStaff(user);
    const customer = await this.prisma.customer.findFirst({
      where: { id: data.customerId, organizationId: user.organizationId },
    });
    if (!customer) throw new BadRequestException('Kunde nicht gefunden');

    return this.prisma.warehousePriceRate.upsert({
      where: {
        customerId_palletType: {
          customerId: data.customerId,
          palletType: data.palletType,
        },
      },
      create: {
        organizationId: user.organizationId,
        customerId: data.customerId,
        palletType: data.palletType,
        inboundFee: Number(data.inboundFee) || 0,
        outboundFee: Number(data.outboundFee) || 0,
        storageFeePerSlot: Number(data.storageFeePerSlot) || 0,
      },
      update: {
        inboundFee: Number(data.inboundFee) || 0,
        outboundFee: Number(data.outboundFee) || 0,
        storageFeePerSlot: Number(data.storageFeePerSlot) || 0,
        active: true,
      },
    });
  }

  private async getRate(
    organizationId: string,
    customerId: string,
    palletType: WarehousePalletType,
  ) {
    return this.prisma.warehousePriceRate.findFirst({
      where: { organizationId, customerId, palletType, active: true },
    });
  }

  /**
   * Monatsabrechnung: Ein-/Auslagerung + Lagerung am Höchststand (Stellplätze je Palettentyp).
   */
  async monthlyBilling(user: AuthUser, year: number, month: number, customerId?: string) {
    this.assertOrg(user);
    if (user.role === UserRole.CUSTOMER_USER) {
      if (!user.customerId) throw new ForbiddenException();
      customerId = user.customerId;
    } else {
      this.assertStaff(user);
    }
    if (!year || !month || month < 1 || month > 12) {
      throw new BadRequestException('Jahr/Monat ungültig');
    }

    const from = new Date(Date.UTC(year, month - 1, 1, 0, 0, 0));
    const to = new Date(Date.UTC(year, month, 1, 0, 0, 0));

    const customers = await this.prisma.customer.findMany({
      where: {
        organizationId: user.organizationId,
        active: true,
        ...(customerId ? { id: customerId } : {}),
      },
      select: { id: true, name: true, customerNumber: true },
      orderBy: { name: 'asc' },
    });

    const movements = await this.prisma.warehouseMovement.findMany({
      where: {
        organizationId: user.organizationId,
        occurredAt: { gte: from, lt: to },
        ...(customerId ? { customerId } : {}),
      },
    });

    const units = await this.prisma.warehouseStorageUnit.findMany({
      where: {
        organizationId: user.organizationId,
        ...(customerId ? { customerId } : {}),
        storedAt: { lt: to },
        OR: [{ releasedAt: null }, { releasedAt: { gt: from } }],
      },
      select: {
        id: true,
        customerId: true,
        palletType: true,
        slotUnits: true,
        storedAt: true,
        releasedAt: true,
      },
    });

    const rates = await this.prisma.warehousePriceRate.findMany({
      where: {
        organizationId: user.organizationId,
        active: true,
        ...(customerId ? { customerId } : {}),
      },
    });
    const rateMap = new Map(rates.map((r) => [`${r.customerId}:${r.palletType}`, r]));

    const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
    const reports = [];

    for (const c of customers) {
      const custMoves = movements.filter((m) => m.customerId === c.id);
      const inbound = custMoves.filter((m) => m.type === WarehouseMovementType.IN);
      const outbound = custMoves.filter((m) => m.type === WarehouseMovementType.OUT);
      const inboundAmount = inbound.reduce((s, m) => s + m.amount, 0);
      const outboundAmount = outbound.reduce((s, m) => s + m.amount, 0);

      const peakByType: Record<string, { peakSlots: number; peakDay: string; fee: number; amount: number }> =
        {};
      for (const t of Object.values(WarehousePalletType)) {
        let peak = 0;
        let peakDay = `${year}-${String(month).padStart(2, '0')}-01`;
        for (let d = 1; d <= daysInMonth; d++) {
          const dayEnd = new Date(Date.UTC(year, month - 1, d, 23, 59, 59, 999));
          const slots = units
            .filter(
              (u) =>
                u.customerId === c.id &&
                u.palletType === t &&
                u.storedAt <= dayEnd &&
                (!u.releasedAt || u.releasedAt > dayEnd),
            )
            .reduce((s, u) => s + u.slotUnits, 0);
          if (slots > peak) {
            peak = slots;
            peakDay = dayEnd.toISOString().slice(0, 10);
          }
        }
        const rate = rateMap.get(`${c.id}:${t}`);
        const fee = rate?.storageFeePerSlot ?? 0;
        peakByType[t] = {
          peakSlots: peak,
          peakDay,
          fee,
          amount: Math.round(peak * fee * 100) / 100,
        };
      }

      const storageAmount = Object.values(peakByType).reduce((s, p) => s + p.amount, 0);
      const total = Math.round((inboundAmount + outboundAmount + storageAmount) * 100) / 100;
      if (
        !inbound.length &&
        !outbound.length &&
        storageAmount === 0 &&
        !units.some((u) => u.customerId === c.id)
      ) {
        continue;
      }

      reports.push({
        customer: c,
        year,
        month,
        inbound: {
          count: inbound.length,
          amount: Math.round(inboundAmount * 100) / 100,
        },
        outbound: {
          count: outbound.length,
          amount: Math.round(outboundAmount * 100) / 100,
        },
        storage: {
          byPalletType: peakByType,
          amount: Math.round(storageAmount * 100) / 100,
        },
        total,
        palletLabels: PALLET_LABEL,
      });
    }

    return {
      year,
      month,
      currency: 'EUR',
      customers: reports,
      totals: {
        inbound: reports.reduce((s, r) => s + r.inbound.amount, 0),
        outbound: reports.reduce((s, r) => s + r.outbound.amount, 0),
        storage: reports.reduce((s, r) => s + r.storage.amount, 0),
        grand: reports.reduce((s, r) => s + r.total, 0),
      },
    };
  }

  meta() {
    return {
      palletTypes: Object.values(WarehousePalletType).map((t) => ({
        code: t,
        label: PALLET_LABEL[t],
        defaultSlotUnits: DEFAULT_SLOT_UNITS[t],
      })),
      locationKinds: Object.values(WarehouseLocationKind),
      defaultLayout: { aisles: 10, levels: 3, bays: 4, slotsPerBay: 3, blockZones: 4 },
    };
  }
}
