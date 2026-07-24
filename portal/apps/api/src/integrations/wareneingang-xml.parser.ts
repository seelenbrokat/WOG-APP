import { XMLParser } from 'fast-xml-parser';

export type WareneingangItem = {
  positionNumber: number;
  quantity: number;
  content?: string;
  packaging?: string;
  weightKg?: number;
  lengthCm?: number;
  widthCm?: number;
  heightCm?: number;
  sscc?: string;
};

export type WareneingangConsignment = {
  consignmentNumber?: string;
  absName?: string;
  absStreet?: string;
  absZip?: string;
  absCity?: string;
  absCountry?: string;
  empfName?: string;
  empfStreet?: string;
  empfZip?: string;
  empfCity?: string;
  empfCountry?: string;
  ladeStart?: string;
  lieferStart?: string;
  transportOrderNumber?: string;
  items: WareneingangItem[];
};

export type ParsedWareneingangOrder = {
  orderNumber: string;
  action?: string;
  date?: string;
  businessPartnerId?: string;
  name1?: string;
  street?: string;
  houseNumber?: string;
  zipCode?: string;
  location1?: string;
  country?: string;
  orgaNumber?: string;
  sendDate?: string;
  consignments: WareneingangConsignment[];
};

function str(v: unknown): string | undefined {
  if (v == null) return undefined;
  if (typeof v === 'object' && v !== null && '#text' in (v as object)) {
    return str((v as { '#text': unknown })['#text']);
  }
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

/** Dateiname oder XML-Inhalt → WareneingangXML? */
export function isWareneingangXml(fileName: string, xmlPreview?: string): boolean {
  const lower = fileName.toLowerCase();
  if (lower.includes('wareneingang')) return true;
  if (!xmlPreview) return false;
  return (
    xmlPreview.includes('WareneingangXML') ||
    xmlPreview.includes('<NormalOrderData') ||
    xmlPreview.includes('NormalOrderData')
  );
}

export function parseWareneingangXml(xml: string): ParsedWareneingangOrder | null {
  const parser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: '@_',
    removeNSPrefix: true,
    isArray: (name) =>
      ['Consignments', 'ConsignmentItems', 'SsccCurrents', 'TransportOrders', 'NormalOrder'].includes(
        name,
      ),
  });

  let raw: Record<string, unknown>;
  try {
    raw = parser.parse(xml) as Record<string, unknown>;
  } catch {
    return null;
  }

  const root = (raw.NormalOrderData || raw) as Record<string, unknown>;
  if (!root) return null;

  const header = (root.Header || {}) as Record<string, unknown>;
  const orders = asArray(root.NormalOrder as Record<string, unknown> | Record<string, unknown>[]);
  const order = orders[0];
  if (!order) return null;

  const orderNumber = str(order.OrderNumber);
  if (!orderNumber) return null;

  const consignments: WareneingangConsignment[] = [];
  for (const c of asArray(order.Consignments as Record<string, unknown> | Record<string, unknown>[])) {
    const items: WareneingangItem[] = [];
    for (const it of asArray(
      c.ConsignmentItems as Record<string, unknown> | Record<string, unknown>[],
    )) {
      const qty = Math.max(1, Math.floor(num(it.Quantity) || 1));
      const ssccs = asArray(it.SsccCurrents as Record<string, unknown> | Record<string, unknown>[])
        .map((s) => str(s.Code))
        .filter(Boolean) as string[];

      // Ein Item mit Quantity>1 und mehreren SSCCs → je SSCC ein Collo
      if (ssccs.length > 1) {
        const totalW = num(it.EffectiveWeightInKilogram);
        const unitW =
          totalW != null
            ? Math.round((totalW / ssccs.length) * 1000) / 1000
            : undefined;
        for (let i = 0; i < ssccs.length; i++) {
          items.push({
            positionNumber: Number(str(it.PositionNumber) || i + 1),
            quantity: 1,
            content: str(it.Content1),
            packaging: str(it.ShortDesignation),
            weightKg: unitW,
            lengthCm: metersToCm(num(it.LengthInMeters)),
            widthCm: metersToCm(num(it.WidthInMeters)),
            heightCm: metersToCm(num(it.HeightInMeters)),
            sscc: ssccs[i],
          });
        }
      } else {
        items.push({
          positionNumber: Number(str(it.PositionNumber) || items.length + 1),
          quantity: qty,
          content: str(it.Content1),
          packaging: str(it.ShortDesignation),
          weightKg: num(it.EffectiveWeightInKilogram),
          lengthCm: metersToCm(num(it.LengthInMeters)),
          widthCm: metersToCm(num(it.WidthInMeters)),
          heightCm: metersToCm(num(it.HeightInMeters)),
          sscc: ssccs[0],
        });
      }
    }

    const tos = asArray(
      c.TransportOrders as Record<string, unknown> | Record<string, unknown>[],
    );
    consignments.push({
      consignmentNumber: str(c.ConsignmentNumber),
      absName: str(c.AbsName1),
      absStreet: streetLine(str(c.AbsStreet), str(c.AbsHouseNumber)),
      absZip: str(c.AbsZipCode),
      absCity: str(c.AbsLocation1),
      absCountry: str(c.AbsLand),
      empfName: str(c.EmpfName1),
      empfStreet: streetLine(str(c.EmpfStreet), str(c.EmpfHouseNumber)),
      empfZip: str(c.EmpfZipCode),
      empfCity: str(c.EmpfLocation1),
      empfCountry: str(c.EmpfLand),
      ladeStart: str(c.LadeStart),
      lieferStart: str(c.LieferStart),
      transportOrderNumber: str(tos[0]?.TransportOrderNumber),
      items,
    });
  }

  return {
    orderNumber,
    action: str(order['@_Action']) || str(order.Action),
    date: str(order.Date),
    businessPartnerId: str(order.BusinessPartnerId),
    name1: str(order.Name1),
    street: streetLine(str(order.Street), str(order.HouseNumber)),
    houseNumber: str(order.HouseNumber),
    zipCode: str(order.ZipCode),
    location1: str(order.Location1),
    country: str(order.IsoTwoCharacterCountryCode),
    orgaNumber: str(order.OrgaNumber),
    sendDate: str(header.SendDate),
    consignments,
  };
}
