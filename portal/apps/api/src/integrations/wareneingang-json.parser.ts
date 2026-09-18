import type { ParsedWareneingangOrder, WareneingangConsignment, WareneingangItem } from './wareneingang-xml.parser';

function str(v: unknown): string | undefined {
  if (v == null) return undefined;
  const s = String(v).trim();
  return s || undefined;
}

function num(v: unknown): number | undefined {
  const s = str(v);
  if (!s) return undefined;
  const n = Number(s.replace(',', '.'));
  return Number.isFinite(n) ? n : undefined;
}

function asArray<T>(v: T | T[] | undefined | null): T[] {
  if (v == null) return [];
  return Array.isArray(v) ? v : [v];
}

function streetLine(street?: string, house?: string): string | undefined {
  const parts = [street, house].filter(Boolean);
  return parts.length ? parts.join(' ') : undefined;
}

function metersToCm(m?: number): number | undefined {
  if (m == null || !Number.isFinite(m) || m <= 0) return undefined;
  return Math.round(m * 1000) / 10;
}

function pick(obj: Record<string, unknown>, ...keys: string[]): unknown {
  for (const k of keys) {
    if (obj[k] != null && obj[k] !== '') return obj[k];
  }
  // case-insensitive fallback
  const lower = Object.fromEntries(
    Object.entries(obj).map(([k, v]) => [k.toLowerCase(), v]),
  );
  for (const k of keys) {
    const hit = lower[k.toLowerCase()];
    if (hit != null && hit !== '') return hit;
  }
  return undefined;
}

function stripBom(raw: string): string {
  return raw.replace(/^\uFEFF/, '');
}

/** JSON-Inhalt sieht aus wie Soloplan-Order-Feedback (Wareneingang)? */
export function isWareneingangOrderJson(fileName: string, preview?: string): boolean {
  const lower = fileName.toLowerCase();
  if (lower.endsWith('.json') && (lower.includes('wareneingang') || lower.includes('normalorder'))) {
    return true;
  }
  if (!preview) return false;
  const p = stripBom(preview);
  return (
    (/"OrderNumber"\s*:/i.test(p) || /"orderNumber"\s*:/i.test(p)) &&
    (/"ExternalNumber"\s*:/i.test(p) ||
      /"externalNumber"\s*:/i.test(p) ||
      /"Consignments"\s*:/i.test(p) ||
      /"consignments"\s*:/i.test(p) ||
      /"NormalOrder"\s*:/i.test(p) ||
      /"normalOrder"\s*:/i.test(p))
  );
}

function parseItems(rawItems: unknown): WareneingangItem[] {
  const items: WareneingangItem[] = [];
  for (const it of asArray(rawItems as Record<string, unknown> | Record<string, unknown>[])) {
    if (!it || typeof it !== 'object') continue;
    const rec = it as Record<string, unknown>;
    const qty = Math.max(1, Math.floor(num(pick(rec, 'Quantity', 'quantity')) || 1));
    const ssccs = asArray(
      pick(rec, 'SsccCurrents', 'ssccCurrents') as Record<string, unknown> | Record<string, unknown>[],
    )
      .map((s) => str(pick(s as Record<string, unknown>, 'Code', 'code')))
      .filter(Boolean) as string[];

    if (ssccs.length > 1) {
      const totalW = num(pick(rec, 'EffectiveWeightInKilogram', 'effectiveWeightInKilogram'));
      const unitW =
        totalW != null ? Math.round((totalW / ssccs.length) * 1000) / 1000 : undefined;
      for (let i = 0; i < ssccs.length; i++) {
        items.push({
          positionNumber: Number(str(pick(rec, 'PositionNumber', 'positionNumber')) || i + 1),
          quantity: 1,
          content: str(pick(rec, 'Content1', 'content1')),
          packaging: str(pick(rec, 'ShortDesignation', 'shortDesignation')),
          weightKg: unitW,
          lengthCm: metersToCm(num(pick(rec, 'LengthInMeters', 'lengthInMeters'))),
          widthCm: metersToCm(num(pick(rec, 'WidthInMeters', 'widthInMeters'))),
          heightCm: metersToCm(num(pick(rec, 'HeightInMeters', 'heightInMeters'))),
          sscc: ssccs[i],
        });
      }
    } else {
      items.push({
        positionNumber: Number(str(pick(rec, 'PositionNumber', 'positionNumber')) || items.length + 1),
        quantity: qty,
        content: str(pick(rec, 'Content1', 'content1')),
        packaging: str(pick(rec, 'ShortDesignation', 'shortDesignation')),
        weightKg: num(pick(rec, 'EffectiveWeightInKilogram', 'effectiveWeightInKilogram')),
        lengthCm: metersToCm(num(pick(rec, 'LengthInMeters', 'lengthInMeters'))),
        widthCm: metersToCm(num(pick(rec, 'WidthInMeters', 'widthInMeters'))),
        heightCm: metersToCm(num(pick(rec, 'HeightInMeters', 'heightInMeters'))),
        sscc: ssccs[0],
      });
    }
  }
  return items;
}

function parseConsignment(c: Record<string, unknown>): WareneingangConsignment {
  const tos = asArray(
    pick(c, 'TransportOrders', 'transportOrders') as Record<string, unknown> | Record<string, unknown>[],
  );
  const to0 = (tos[0] || {}) as Record<string, unknown>;
  return {
    consignmentNumber: str(pick(c, 'ConsignmentNumber', 'consignmentNumber')),
    externalNumber: str(pick(c, 'ExternalNumber', 'externalNumber')),
    absName: str(pick(c, 'AbsName1', 'absName1')),
    absStreet: streetLine(str(pick(c, 'AbsStreet', 'absStreet')), str(pick(c, 'AbsHouseNumber', 'absHouseNumber'))),
    absZip: str(pick(c, 'AbsZipCode', 'absZipCode')),
    absCity: str(pick(c, 'AbsLocation1', 'absLocation1')),
    absCountry: str(pick(c, 'AbsLand', 'absLand')),
    empfName: str(pick(c, 'EmpfName1', 'empfName1')),
    empfStreet: streetLine(
      str(pick(c, 'EmpfStreet', 'empfStreet')),
      str(pick(c, 'EmpfHouseNumber', 'empfHouseNumber')),
    ),
    empfZip: str(pick(c, 'EmpfZipCode', 'empfZipCode')),
    empfCity: str(pick(c, 'EmpfLocation1', 'empfLocation1')),
    empfCountry: str(pick(c, 'EmpfLand', 'empfLand')),
    ladeStart: str(pick(c, 'LadeStart', 'ladeStart')),
    lieferStart: str(pick(c, 'LieferStart', 'lieferStart')),
    transportOrderNumber: str(pick(to0, 'TransportOrderNumber', 'transportOrderNumber')),
    items: parseItems(pick(c, 'ConsignmentItems', 'consignmentItems')),
  };
}

function parseOrderObject(order: Record<string, unknown>, sendDate?: string): ParsedWareneingangOrder | null {
  const orderNumber = str(pick(order, 'OrderNumber', 'orderNumber'));
  if (!orderNumber) return null;

  const consignments = asArray(
    pick(order, 'Consignments', 'consignments') as Record<string, unknown> | Record<string, unknown>[],
  )
    .filter((c) => c && typeof c === 'object')
    .map((c) => parseConsignment(c as Record<string, unknown>));

  return {
    orderNumber,
    externalNumber:
      str(pick(order, 'ExternalNumber', 'externalNumber')) ||
      consignments.find((c) => c.externalNumber?.startsWith('VLB'))?.externalNumber,
    action: str(pick(order, 'ActionAttribute', 'actionAttribute', 'Action', 'action')),
    date: str(pick(order, 'Date', 'date')),
    businessPartnerId: str(pick(order, 'BusinessPartnerId', 'businessPartnerId')),
    name1: str(pick(order, 'Name1', 'name1')),
    street: streetLine(str(pick(order, 'Street', 'street')), str(pick(order, 'HouseNumber', 'houseNumber'))),
    houseNumber: str(pick(order, 'HouseNumber', 'houseNumber')),
    zipCode: str(pick(order, 'ZipCode', 'zipCode')),
    location1: str(pick(order, 'Location1', 'location1')),
    country: str(pick(order, 'IsoTwoCharacterCountryCode', 'isoTwoCharacterCountryCode')),
    orgaNumber: str(pick(order, 'OrgaNumber', 'orgaNumber')),
    sendDate,
    consignments,
  };
}

/**
 * Soloplan Order-Feedback JSON (PascalCase flat oder camelCase mit header/normalOrder).
 */
export function parseWareneingangJson(raw: string): ParsedWareneingangOrder | null {
  let data: unknown;
  try {
    data = JSON.parse(stripBom(raw));
  } catch {
    return null;
  }
  if (!data || typeof data !== 'object') return null;
  const root = data as Record<string, unknown>;

  // Variante A: flat { OrderNumber, ExternalNumber, Consignments, ... }
  if (pick(root, 'OrderNumber', 'orderNumber') != null) {
    return parseOrderObject(root);
  }

  // Variante B: { header, normalOrder: [ {...} ] }
  const header = (pick(root, 'Header', 'header') || {}) as Record<string, unknown>;
  const sendDate = str(pick(header, 'SendDate', 'sendDate'));
  const orders = asArray(
    pick(root, 'NormalOrder', 'normalOrder') as Record<string, unknown> | Record<string, unknown>[],
  );
  if (orders[0] && typeof orders[0] === 'object') {
    return parseOrderObject(orders[0] as Record<string, unknown>, sendDate);
  }

  return null;
}
