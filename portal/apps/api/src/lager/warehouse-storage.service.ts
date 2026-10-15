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
import { DIEPOLDSAU_HOCHREGAL } from './diepoldsau-layout';

const DEFAULT_SLOT_UNITS: Record<WarehousePalletType, number> = {
  EURO: 1,
  HALF: 0.5,
  OVERSIZE: 2,
  CUSTOM: 1,
};

const PALLET_LABEL: Record<WarehousePalletType, string> = {
  EURO: 'Europalette',
  HALF: 'Halbpalette',
  OVERSIZE: 'Übergroße Palette',
  CUSTOM: 'Individuell / EWP',
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

  /** Parst Datum/Zeit aus ISO, YYYY-MM-DD oder datetime-local. */
  private parseDateTime(raw?: string | null, label = 'Datum'): Date | null {
    if (raw == null || !String(raw).trim()) return null;
    const s = String(raw).trim();
    const d = new Date(s.includes('T') || s.includes(' ') ? s : `${s}T12:00:00`);
    if (Number.isNaN(d.getTime())) {
      throw new BadRequestException(`${label} ungültig`);
    }
    return d;
  }

  private buildLayoutRows(
    organizationId: string,
    opts: Required<EnsureRackLayoutOpts>,
  ) {
    const { aisles, levels, bays, slotsPerBay, blockZones } = opts;
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
              organizationId,
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
        organizationId,
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
    return rows;
  }

  private normalizeLayoutOpts(opts: EnsureRackLayoutOpts = {}): Required<EnsureRackLayoutOpts> {
    return {
      aisles: Math.max(1, Math.min(50, Math.floor(opts.aisles ?? 10))),
      levels: Math.max(1, Math.min(10, Math.floor(opts.levels ?? 3))),
      bays: Math.max(1, Math.min(20, Math.floor(opts.bays ?? 4))),
      slotsPerBay: Math.max(1, Math.min(10, Math.floor(opts.slotsPerBay ?? 3))),
      blockZones: Math.max(0, Math.min(50, Math.floor(opts.blockZones ?? 4))),
    };
  }

  /** Zeilen für Diepoldsau Hochregal (Matchcode Reihe-Ebene-Säule). */
  private buildDiepoldsauRows(organizationId: string, blockZones = 4) {
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
      active: boolean;
    }> = [];

    for (const p of DIEPOLDSAU_HOCHREGAL) {
      rows.push({
        organizationId,
        code: p.code,
        kind: WarehouseLocationKind.RACK,
        aisle: p.aisle,
        level: p.level,
        bay: 1,
        slot: p.slot,
        label: `Reihe ${String(p.aisle).padStart(3, '0')} · Ebene ${String(p.level).padStart(3, '0')} · Säule ${String(p.slot).padStart(3, '0')}`,
        sortOrder: p.aisle * 100000 + p.level * 1000 + p.slot,
        capacitySlots: 1,
        active: true,
      });
    }
    for (let b = 1; b <= blockZones; b++) {
      const code = `BLOCK-${String(b).padStart(2, '0')}`;
      rows.push({
        organizationId,
        code,
        kind: WarehouseLocationKind.BLOCK,
        aisle: null,
        level: null,
        bay: null,
        slot: null,
        label: `Blocklager ${b}`,
        sortOrder: 1000000 + b,
        capacitySlots: 50,
        active: true,
      });
    }
    return rows;
  }

  /**
   * Standard: Diepoldsau Hochregal (284 Matchcodes RRR-EEE-SSS) + Blocklager.
   * Wenn bereits Regalplätze existieren → skipped (dann „Diepoldsau übernehmen“).
   */
  async ensureDefaultLayout(user: AuthUser, opts: EnsureRackLayoutOpts = {}) {
    this.assertStaff(user);
    this.assertOrg(user);
    const blockZones = Math.max(0, Math.min(50, Math.floor(opts.blockZones ?? 4)));

    const existing = await this.prisma.warehouseLocation.count({
      where: { organizationId: user.organizationId, kind: WarehouseLocationKind.RACK },
    });
    if (existing > 0) {
      return {
        created: 0,
        skipped: true,
        rackCount: existing,
        message:
          'Regalplätze existieren bereits – „Diepoldsau übernehmen“ ersetzt das Layout (nur ohne Bestand).',
      };
    }

    const rows = this.buildDiepoldsauRows(user.organizationId, blockZones);
    await this.prisma.warehouseLocation.createMany({ data: rows });
    await this.audit.log(user.id, 'warehouse.layout.seed', 'WarehouseLocation', undefined, {
      layout: 'diepoldsau',
      rackCount: DIEPOLDSAU_HOCHREGAL.length,
      blockZones,
      count: rows.length,
    });
    return {
      created: rows.length,
      skipped: false,
      rackCount: DIEPOLDSAU_HOCHREGAL.length,
      layout: { name: 'diepoldsau', rackCount: DIEPOLDSAU_HOCHREGAL.length, blockZones },
    };
  }

  /**
   * Diepoldsau-Layout übernehmen: legt Matchcodes an und deaktiviert alte Regalcodes
   * (R01-E…), sofern kein Bestand. Blocklager bleibt erhalten/wird ergänzt.
   */
  async importDiepoldsauLayout(
    user: AuthUser,
    opts: { replace?: boolean; blockZones?: number } = {},
  ) {
    this.assertStaff(user);
    this.assertOrg(user);
    const replace = opts.replace !== false;
    const blockZones = Math.max(0, Math.min(50, Math.floor(opts.blockZones ?? 4)));
    const orgId = user.organizationId!;
    const desired = this.buildDiepoldsauRows(orgId, blockZones);
    const desiredCodes = new Set(desired.map((r) => r.code));

    if (replace) {
      const stocked = await this.prisma.warehouseStorageUnit.count({
        where: {
          organizationId: orgId,
          status: WarehouseUnitStatus.STORED,
          location: { kind: WarehouseLocationKind.RACK, code: { notIn: [...desiredCodes] } },
        },
      });
      if (stocked > 0) {
        throw new BadRequestException(
          `Noch ${stocked} eingelagerte Position(en) auf alten Plätzen – bitte zuerst auslagern.`,
        );
      }
    }

    const existing = await this.prisma.warehouseLocation.findMany({
      where: { organizationId: orgId },
      select: {
        id: true,
        code: true,
        kind: true,
        active: true,
        aisle: true,
        level: true,
        bay: true,
        slot: true,
        label: true,
        sortOrder: true,
      },
    });
    const byCode = new Map(existing.map((e) => [e.code, e]));

    let created = 0;
    let reactivated = 0;
    let updated = 0;
    const toCreate = desired.filter((r) => !byCode.has(r.code));
    if (toCreate.length) {
      await this.prisma.warehouseLocation.createMany({ data: toCreate });
      created = toCreate.length;
    }

    for (const r of desired) {
      const cur = byCode.get(r.code);
      if (!cur) continue;
      const needsReactivate = !cur.active;
      const needsSync =
        cur.aisle !== r.aisle ||
        cur.level !== r.level ||
        cur.bay !== r.bay ||
        cur.slot !== r.slot ||
        cur.label !== r.label ||
        cur.sortOrder !== r.sortOrder;
      if (!needsReactivate && !needsSync) continue;
      await this.prisma.warehouseLocation.update({
        where: { id: cur.id },
        data: {
          active: true,
          aisle: r.aisle,
          level: r.level,
          bay: r.bay,
          slot: r.slot,
          label: r.label,
          sortOrder: r.sortOrder,
          capacitySlots: r.capacitySlots,
          kind: r.kind,
        },
      });
      if (needsReactivate) reactivated++;
      else updated++;
    }

    let deactivated = 0;
    if (replace) {
      const obsolete = existing.filter(
        (e) =>
          e.kind === WarehouseLocationKind.RACK &&
          e.active &&
          !desiredCodes.has(e.code),
      );
      if (obsolete.length) {
        await this.prisma.warehouseLocation.updateMany({
          where: { id: { in: obsolete.map((o) => o.id) } },
          data: { active: false },
        });
        deactivated = obsolete.length;
      }
    }

    await this.audit.log(user.id, 'warehouse.layout.diepoldsau', 'WarehouseLocation', undefined, {
      created,
      reactivated,
      deactivated,
      rackCount: DIEPOLDSAU_HOCHREGAL.length,
      blockZones,
    });

    return {
      created,
      reactivated,
      updated,
      deactivated,
      rackCount: DIEPOLDSAU_HOCHREGAL.length,
      skipped: created === 0 && reactivated === 0 && updated === 0 && deactivated === 0,
      message: `Diepoldsau: ${DIEPOLDSAU_HOCHREGAL.length} Regalplätze (Matchcode Reihe-Ebene-Säule)`,
    };
  }

  /** Fehlende Codes nachziehen (generisches Raster; für Diepoldsau „übernehmen“ nutzen). */
  async extendLayout(user: AuthUser, opts: EnsureRackLayoutOpts = {}) {
    this.assertStaff(user);
    this.assertOrg(user);
    const layout = this.normalizeLayoutOpts(opts);
    const desired = this.buildLayoutRows(user.organizationId!, layout);
    const existing = await this.prisma.warehouseLocation.findMany({
      where: { organizationId: user.organizationId },
      select: { code: true },
    });
    const have = new Set(existing.map((e) => e.code));
    const missing = desired.filter((r) => !have.has(r.code));
    if (!missing.length) {
      return { created: 0, skipped: true, message: 'Alle gewünschten Plätze existieren bereits.', layout };
    }
    await this.prisma.warehouseLocation.createMany({ data: missing });
    await this.audit.log(user.id, 'warehouse.layout.extend', 'WarehouseLocation', undefined, {
      ...layout,
      created: missing.length,
    });
    return { created: missing.length, skipped: false, layout };
  }

  /** Belegungskarte für Visualisierung (Reihen → Ebenen → Fächer → Plätze). */
  async occupancyMap(user: AuthUser) {
    this.assertStaff(user);
    this.assertOrg(user);
    const locs = await this.listLocations(user, { kind: 'RACK' });
    const blocks = await this.listLocations(user, { kind: 'BLOCK' });

    const aisles = new Map<
      number,
      {
        aisle: number;
        levels: Map<
          number,
          {
            level: number;
            bays: Map<
              number,
              {
                bay: number;
                slots: Array<{
                  id: string;
                  code: string;
                  slot: number;
                  usedSlots: number;
                  capacitySlots: number;
                  freeSlots: number;
                  occupied: boolean;
                  unitCount: number;
                }>;
              }
            >;
          }
        >;
      }
    >();

    for (const l of locs) {
      if (l.aisle == null || l.level == null || l.bay == null || l.slot == null) continue;
      if (!aisles.has(l.aisle)) aisles.set(l.aisle, { aisle: l.aisle, levels: new Map() });
      const a = aisles.get(l.aisle)!;
      if (!a.levels.has(l.level)) a.levels.set(l.level, { level: l.level, bays: new Map() });
      const e = a.levels.get(l.level)!;
      if (!e.bays.has(l.bay)) e.bays.set(l.bay, { bay: l.bay, slots: [] });
      e.bays.get(l.bay)!.slots.push({
        id: l.id,
        code: l.code,
        slot: l.slot,
        usedSlots: l.usedSlots,
        capacitySlots: l.capacitySlots,
        freeSlots: l.freeSlots,
        occupied: l.occupied,
        unitCount: l.unitCount,
      });
    }

    const rackTree = [...aisles.values()]
      .sort((x, y) => x.aisle - y.aisle)
      .map((a) => ({
        aisle: a.aisle,
        levels: [...a.levels.values()]
          .sort((x, y) => y.level - x.level)
          .map((lv) => ({
            level: lv.level,
            bays: [...lv.bays.values()]
              .sort((x, y) => x.bay - y.bay)
              .map((b) => ({
                bay: b.bay,
                slots: b.slots.sort((x, y) => x.slot - y.slot),
              })),
          })),
      }));

    const used = [...locs, ...blocks].reduce((s, l) => s + l.usedSlots, 0);
    const cap = [...locs, ...blocks].reduce((s, l) => s + l.capacitySlots, 0);

    return {
      summary: {
        rackSlots: locs.length,
        blockZones: blocks.length,
        usedSlots: used,
        capacitySlots: cap,
        freeSlots: Math.max(0, cap - used),
        occupiedSlots: locs.filter((l) => l.occupied).length + blocks.filter((l) => l.occupied).length,
      },
      aisles: rackTree,
      blocks: blocks.map((b) => ({
        id: b.id,
        code: b.code,
        label: b.label,
        usedSlots: b.usedSlots,
        capacitySlots: b.capacitySlots,
        freeSlots: b.freeSlots,
        occupied: b.occupied,
        unitCount: b.unitCount,
      })),
    };
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

  /** Nächsten freien Platz vorschlagen (Regal vor Block, dann niedrigste Reihe/Ebene). */
  async suggestFreeLocation(
    user: AuthUser,
    palletType: WarehousePalletType = WarehousePalletType.EURO,
    slots?: number,
  ) {
    this.assertStaff(user);
    const need = this.slotUnitsFor(palletType, slots);
    const locs = await this.listLocations(user, { freeOnly: true });
    const rack = locs
      .filter((l) => l.kind === WarehouseLocationKind.RACK && l.freeSlots + 0.001 >= need)
      .sort(
        (a, b) =>
          (a.aisle || 0) - (b.aisle || 0) ||
          (a.level || 0) - (b.level || 0) ||
          (a.bay || 0) - (b.bay || 0) ||
          (a.slot || 0) - (b.slot || 0),
      );
    const block = locs
      .filter((l) => l.kind === WarehouseLocationKind.BLOCK && l.freeSlots + 0.001 >= need)
      .sort((a, b) => a.code.localeCompare(b.code));
    const pick = rack[0] || block[0] || null;
    return { needSlots: need, location: pick, alternatives: [...rack, ...block].slice(0, 8) };
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

  async listArticles(user: AuthUser, customerId?: string, includeInactive = false) {
    this.assertOrg(user);
    if (user.role === UserRole.CUSTOMER_USER) {
      if (!user.customerId) throw new ForbiddenException();
      customerId = user.customerId;
    } else {
      this.assertStaff(user);
    }
    return this.prisma.warehouseArticle.findMany({
      where: {
        organizationId: user.organizationId,
        ...(customerId ? { customerId } : {}),
        ...(includeInactive ? {} : { active: true }),
      },
      include: {
        customer: { select: { id: true, name: true, customerNumber: true } },
      },
      orderBy: [{ customer: { name: 'asc' } }, { name: 'asc' }],
    });
  }

  async createArticle(
    user: AuthUser,
    data: {
      customerId: string;
      name: string;
      articleNumber?: string;
      palletType?: WarehousePalletType;
      slotUnits?: number;
      notes?: string;
    },
  ) {
    this.assertStaff(user);
    this.assertOrg(user);
    const customer = await this.prisma.customer.findFirst({
      where: { id: data.customerId, organizationId: user.organizationId },
    });
    if (!customer) throw new BadRequestException('Kunde nicht gefunden');
    if (!customer.warehouseCustomer) {
      throw new BadRequestException('Kunde ist kein Lagerkunde');
    }
    const name = String(data.name || '').trim();
    if (!name) throw new BadRequestException('Artikelname fehlt');
    const palletType = data.palletType || WarehousePalletType.EURO;
    const slotUnits = this.slotUnitsFor(palletType, data.slotUnits);
    const articleNumber = data.articleNumber?.trim() || null;
    try {
      const article = await this.prisma.warehouseArticle.create({
        data: {
          organizationId: user.organizationId,
          customerId: customer.id,
          name,
          articleNumber,
          palletType,
          slotUnits,
          notes: data.notes?.trim() || null,
        },
        include: {
          customer: { select: { id: true, name: true, customerNumber: true } },
        },
      });
      await this.audit.log(user.id, 'warehouse.article.create', 'WarehouseArticle', article.id, {
        customerId: customer.id,
        name,
        palletType,
        slotUnits,
      });
      return article;
    } catch (e: any) {
      if (e?.code === 'P2002') {
        throw new BadRequestException('Artikelnummer bereits vergeben für diesen Kunden');
      }
      throw e;
    }
  }

  async updateArticle(
    user: AuthUser,
    id: string,
    data: Partial<{
      name: string;
      articleNumber: string | null;
      palletType: WarehousePalletType;
      slotUnits: number;
      notes: string | null;
      active: boolean;
    }>,
  ) {
    this.assertStaff(user);
    const existing = await this.prisma.warehouseArticle.findFirst({
      where: { id, organizationId: user.organizationId },
    });
    if (!existing) throw new NotFoundException('Artikel nicht gefunden');
    const palletType = data.palletType ?? existing.palletType;
    const slotUnits =
      data.slotUnits !== undefined
        ? this.slotUnitsFor(palletType, data.slotUnits)
        : existing.slotUnits;
    try {
      const article = await this.prisma.warehouseArticle.update({
        where: { id },
        data: {
          ...(data.name !== undefined ? { name: String(data.name).trim() } : {}),
          ...(data.articleNumber !== undefined
            ? { articleNumber: data.articleNumber?.trim() || null }
            : {}),
          ...(data.palletType !== undefined ? { palletType: data.palletType } : {}),
          ...(data.slotUnits !== undefined || data.palletType !== undefined ? { slotUnits } : {}),
          ...(data.notes !== undefined ? { notes: data.notes?.trim() || null } : {}),
          ...(data.active !== undefined ? { active: data.active } : {}),
        },
        include: {
          customer: { select: { id: true, name: true, customerNumber: true } },
        },
      });
      await this.audit.log(user.id, 'warehouse.article.update', 'WarehouseArticle', id, data);
      return article;
    } catch (e: any) {
      if (e?.code === 'P2002') {
        throw new BadRequestException('Artikelnummer bereits vergeben für diesen Kunden');
      }
      throw e;
    }
  }

  async inbound(
    user: AuthUser,
    data: {
      customerId: string;
      locationId: string;
      palletType?: WarehousePalletType;
      slotUnits?: number;
      articleId?: string;
      articleName?: string;
      serialNumber?: string;
      sscc?: string;
      externalRef?: string;
      shipmentId?: string;
      notes?: string;
      storedAt?: string;
    },
  ) {
    this.assertStaff(user);
    this.assertOrg(user);

    const customer = await this.prisma.customer.findFirst({
      where: { id: data.customerId, organizationId: user.organizationId },
    });
    if (!customer) throw new BadRequestException('Kunde nicht gefunden');
    if (!customer.warehouseCustomer) {
      throw new BadRequestException(
        'Kunde ist kein Lagerkunde – unter Kunden die Checkbox „Lagerkunde“ setzen',
      );
    }
    const storedAt = this.parseDateTime(data.storedAt, 'Einlagerungsdatum') || new Date();

    let article: {
      id: string;
      name: string;
      articleNumber: string | null;
      palletType: WarehousePalletType;
      slotUnits: number;
    } | null = null;
    if (data.articleId) {
      article = await this.prisma.warehouseArticle.findFirst({
        where: {
          id: data.articleId,
          organizationId: user.organizationId,
          customerId: customer.id,
          active: true,
        },
      });
      if (!article) throw new BadRequestException('Artikel nicht gefunden / nicht aktiv');
    }

    const location = await this.prisma.warehouseLocation.findFirst({
      where: { id: data.locationId, organizationId: user.organizationId, active: true },
      include: { units: { where: { status: WarehouseUnitStatus.STORED } } },
    });
    if (!location) throw new BadRequestException('Lagerplatz nicht gefunden');

    const palletType =
      data.palletType || article?.palletType || WarehousePalletType.EURO;
    const slotUnits = this.slotUnitsFor(
      palletType,
      data.slotUnits ?? article?.slotUnits ?? undefined,
    );
    const articleName =
      data.articleName?.trim() ||
      (article
        ? [article.articleNumber, article.name].filter(Boolean).join(' · ')
        : null);
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
        articleId: article?.id || null,
        shipmentId: data.shipmentId || null,
        palletType,
        slotUnits,
        articleName,
        serialNumber: data.serialNumber?.trim() || null,
        sscc: data.sscc?.trim() || null,
        externalRef: data.externalRef?.trim() || null,
        notes: data.notes?.trim() || null,
        status: WarehouseUnitStatus.STORED,
        storedAt,
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
        occurredAt: storedAt,
      },
    });

    await this.audit.log(user.id, 'warehouse.inbound', 'WarehouseStorageUnit', unit.id, {
      location: location.code,
      customerId: data.customerId,
      palletType,
      storedAt: storedAt.toISOString(),
    });

    return unit;
  }

  async outbound(user: AuthUser, unitId: string, note?: string, releasedAtRaw?: string) {
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

    const releasedAt = this.parseDateTime(releasedAtRaw, 'Auslagerungsdatum') || new Date();
    if (releasedAt < unit.storedAt) {
      throw new BadRequestException('Auslagerungsdatum liegt vor dem Einlagerungsdatum');
    }

    const rate = await this.getRate(user.organizationId, unit.customerId, unit.palletType);
    const unitPrice = rate?.outboundFee ?? 0;

    const updated = await this.prisma.warehouseStorageUnit.update({
      where: { id: unit.id },
      data: {
        status: WarehouseUnitStatus.RELEASED,
        releasedAt,
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
        occurredAt: releasedAt,
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
      defaultLayout: {
        name: 'diepoldsau',
        rackCount: DIEPOLDSAU_HOCHREGAL.length,
        blockZones: 4,
        codeFormat: 'RRR-EEE-SSS',
      },
    };
  }

  /** Lagerkunden mit aktuellem Bestand (für Übersicht). */
  async overview(user: AuthUser) {
    this.assertStaff(user);
    this.assertOrg(user);

    const customers = await this.prisma.customer.findMany({
      where: {
        organizationId: user.organizationId,
        active: true,
        warehouseCustomer: true,
      },
      select: {
        id: true,
        name: true,
        customerNumber: true,
        matchcode: true,
        email: true,
      },
      orderBy: { name: 'asc' },
    });

    const units = await this.prisma.warehouseStorageUnit.findMany({
      where: {
        organizationId: user.organizationId,
        status: WarehouseUnitStatus.STORED,
        customerId: { in: customers.map((c) => c.id) },
      },
      select: {
        customerId: true,
        palletType: true,
        slotUnits: true,
        location: { select: { code: true, kind: true } },
      },
    });

    const map = new Map(customers.map((c) => [c.id, {
      customer: c,
      unitCount: 0,
      slotUnits: 0,
      byPalletType: {} as Record<string, { count: number; slotUnits: number }>,
      locations: new Set<string>(),
    }]));

    for (const u of units) {
      const row = map.get(u.customerId);
      if (!row) continue;
      row.unitCount += 1;
      row.slotUnits += u.slotUnits;
      if (!row.byPalletType[u.palletType]) {
        row.byPalletType[u.palletType] = { count: 0, slotUnits: 0 };
      }
      row.byPalletType[u.palletType].count += 1;
      row.byPalletType[u.palletType].slotUnits += u.slotUnits;
      if (u.location?.code) row.locations.add(u.location.code);
    }

    const rows = [...map.values()].map((r) => ({
      customer: r.customer,
      unitCount: r.unitCount,
      slotUnits: Math.round(r.slotUnits * 100) / 100,
      byPalletType: Object.fromEntries(
        Object.entries(r.byPalletType).map(([k, v]) => [
          k,
          { count: v.count, slotUnits: Math.round(v.slotUnits * 100) / 100 },
        ]),
      ),
      locationCount: r.locations.size,
      locationSample: [...r.locations].slice(0, 5),
    }));

    const locStats = await this.prisma.warehouseLocation.findMany({
      where: { organizationId: user.organizationId, active: true },
      include: {
        units: {
          where: { status: WarehouseUnitStatus.STORED },
          select: { slotUnits: true },
        },
      },
    });
    let usedSlots = 0;
    let capacitySlots = 0;
    let occupiedLocations = 0;
    for (const l of locStats) {
      capacitySlots += l.capacitySlots;
      const used = l.units.reduce((s, u) => s + u.slotUnits, 0);
      usedSlots += used;
      if (used > 0) occupiedLocations += 1;
    }

    return {
      summary: {
        warehouseCustomers: customers.length,
        storedUnits: units.length,
        usedSlots: Math.round(usedSlots * 100) / 100,
        capacitySlots: Math.round(capacitySlots * 100) / 100,
        freeSlots: Math.round(Math.max(0, capacitySlots - usedSlots) * 100) / 100,
        occupiedLocations,
        locationCount: locStats.length,
      },
      customers: rows,
      palletLabels: PALLET_LABEL,
    };
  }

  /** Aktive Lagerkunden (für Dropdowns Einlagern/Preise). */
  async listWarehouseCustomers(user: AuthUser) {
    this.assertStaff(user);
    this.assertOrg(user);
    return this.prisma.customer.findMany({
      where: {
        organizationId: user.organizationId,
        active: true,
        warehouseCustomer: true,
      },
      select: {
        id: true,
        name: true,
        customerNumber: true,
        matchcode: true,
      },
      orderBy: { name: 'asc' },
    });
  }
}
