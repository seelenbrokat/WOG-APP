/**
 * Parser für Soloplan StdTelematics Tour-XML
 * Namespace: http://www.soloplan.de/StdTelematics
 *
 * Zusammenhänge:
 * - Header: TourId, TourNumber, VehicleId, Action (Create|Change|Delete), SendDate
 * - TourData.Truck / Driver1: Fahrzeug + Fahrer
 * - Stops: Stop-Reihenfolge; TransportOrderNumber verknüpft Sendung
 * - TransportOrders: Aufträge/Sendungen der Tour
 * Mehrere Dateien zur gleichen TourNumber = Aktualisierungen (Change) oder Löschung (Delete, TourData nil).
 */

import { XMLParser } from 'fast-xml-parser';

const NS = 'http://www.soloplan.de/StdTelematics';

export type ParsedTourHeader = {
  sendDate?: Date;
  vehicleId?: string;
  vehicleParam1?: string;
  vehicleParam2?: string;
  action: 'Create' | 'Change' | 'Delete' | string;
  tourId: string;
  tourNumber: string;
  utcDifference?: number;
};

export type ParsedTourStop = {
  sequence: number;
  soloplanTourStopId?: string;
  stopType?: string;
  transportOrderNumber?: string;
  name?: string;
  street?: string;
  zip?: string;
  city?: string;
  country?: string;
  latitude?: number;
  longitude?: number;
  targetStart?: Date;
  targetEnd?: Date;
  activityDescription?: string;
  phone?: string;
};

export type ParsedTourConsignment = {
  /** TransportOrder.Number */
  soloplanOrderNumber: string;
  /** OrderData.OrderNumber – Basis Sendungsnummer */
  orderNumber?: string;
  /** ConsignmentData.Number (meist 1) */
  consignmentIndex?: number;
  externalConsignmentNumber?: string;
  senderName?: string;
  senderBpNumber?: string;
  receiverName?: string;
  /** TransportOrder.Customer – Auftraggeber (z. B. DHL Paket) */
  customerName?: string;
  customerBpNumber?: string;
  /** TransportOrder.FreightPayer – Fallback Auftraggeber */
  freightPayerName?: string;
  freightPayerBpNumber?: string;
  loadingUnits?: Array<{ matchcode: string; quantity: number; description?: string }>;
};

/** Sendungsnummer = OrderNumber.ConsignmentIndex (z. B. 432984.1) */
export function formatSendungsnummer(opts: {
  orderNumber?: string | null;
  consignmentIndex?: number | null;
  externalConsignmentNumber?: string | null;
  soloplanOrderNumber?: string | null;
}): string {
  const order = opts.orderNumber?.trim();
  if (order) {
    const idx =
      opts.consignmentIndex != null && Number.isFinite(opts.consignmentIndex)
        ? opts.consignmentIndex
        : 1;
    return `${order}.${idx}`;
  }
  const ext = opts.externalConsignmentNumber?.trim();
  if (ext && /^\d+\.\d+$/.test(ext)) return ext;
  return opts.soloplanOrderNumber?.trim() || '—';
}

export type ParsedTour = {
  header: ParsedTourHeader;
  /** false bei Action=Delete / TourData xsi:nil */
  hasData: boolean;
  caption?: string;
  infoText?: string;
  targetStart?: Date;
  targetEnd?: Date;
  targetLoadKm?: number;
  driverName?: string;
  driverFirstName?: string;
  driverLastName?: string;
  driverTelematicsId?: string;
  truckNumber?: string;
  truckMatchcode?: string;
  truckLicensePlate?: string;
  dispatcherName?: string;
  dispatcherEmail?: string;
  dispatcherPhone?: string;
  stops: ParsedTourStop[];
  consignments: ParsedTourConsignment[];
};

function asArray<T>(v: T | T[] | undefined | null): T[] {
  if (v == null) return [];
  return Array.isArray(v) ? v : [v];
}

function str(v: unknown): string {
  if (v == null) return '';
  if (typeof v === 'object' && v !== null && '#text' in (v as object)) {
    return String((v as { '#text'?: unknown })['#text'] ?? '').trim();
  }
  return String(v).trim();
}

function num(v: unknown): number | undefined {
  const s = str(v);
  if (!s) return undefined;
  const n = Number(s);
  return Number.isFinite(n) ? n : undefined;
}

function dt(v: unknown): Date | undefined {
  const s = str(v);
  if (!s) return undefined;
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? undefined : d;
}

function unwrapNs(obj: unknown): unknown {
  if (!obj || typeof obj !== 'object') return obj;
  if (Array.isArray(obj)) return obj.map(unwrapNs);
  const rec = obj as Record<string, unknown>;
  // Prefer namespaced keys from Soloplan
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(rec)) {
    const plain = k.includes(':') ? k.split(':').pop()! : k.replace(`{${NS}}`, '');
    // Also strip xmlns noise
    if (plain.startsWith('@_')) {
      out[plain] = v;
      continue;
    }
    out[plain] = unwrapNs(v);
  }
  return out;
}

function addrStreet(addr: Record<string, unknown> | undefined): string | undefined {
  if (!addr) return undefined;
  const street = str(addr.Street);
  const hn = str(addr.HouseNumber);
  return [street, hn].filter(Boolean).join(' ') || undefined;
}

function countryCode(addr: Record<string, unknown> | undefined): string | undefined {
  if (!addr) return undefined;
  const c = addr.Country as Record<string, unknown> | undefined;
  return str(c?.IsoAlpha2 || c?.Matchcode || addr.CountryCode) || undefined;
}

function phoneFromStopLines(lines: unknown): string | undefined {
  const arr = asArray(lines).map(str).filter(Boolean);
  for (const line of arr) {
    if (/^\+?\d[\d\s\/-]{5,}$/.test(line.replace(/\s/g, ''))) return line;
  }
  return undefined;
}


function parseLoadingUnits(order: Record<string, unknown>) {
  return asArray(order.LoadingUnits as Record<string, unknown> | Record<string, unknown>[] | undefined)
    .map((lu) => {
      const matchcode = str(lu.Matchcode);
      const quantity = num(lu.Quantity) ?? 0;
      if (!matchcode || quantity <= 0) return null;
      return {
        matchcode,
        quantity,
        description: str(lu.Description) || undefined,
      };
    })
    .filter(Boolean) as Array<{ matchcode: string; quantity: number; description?: string }>;
}

export function parseTourXml(xml: string, fileName?: string): ParsedTour | null {
  const parser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: '@_',
    removeNSPrefix: true,
    isArray: (name) =>
      ['Stop', 'TransportOrder', 'string', 'Item', 'SSCC', 'Information', 'Reference', 'CheckField'].includes(
        name,
      ),
  });
  let raw: unknown;
  try {
    raw = unwrapNs(parser.parse(xml));
  } catch {
    return null;
  }
  const root = (raw as Record<string, unknown>)?.Tour as Record<string, unknown> | undefined;
  if (!root) return null;

  const headerRaw = (root.Header || {}) as Record<string, unknown>;
  const tourId = str(headerRaw.TourId);
  const tourNumber = str(headerRaw.TourNumber);
  if (!tourId && !tourNumber) return null;

  const action = str(headerRaw.Action) || 'Change';
  const header: ParsedTourHeader = {
    sendDate: dt(headerRaw.SendDate),
    vehicleId: str(headerRaw.VehicleId) || undefined,
    vehicleParam1: str(headerRaw.VehicleParam1) || undefined,
    vehicleParam2: str(headerRaw.VehicleParam2) || undefined,
    action,
    tourId: tourId || tourNumber,
    tourNumber: tourNumber || tourId,
    utcDifference: num(headerRaw.UtcDifference),
  };

  const tourDataRaw = root.TourData as Record<string, unknown> | undefined;
  const nil =
    !tourDataRaw ||
    tourDataRaw['@_nil'] === 'true' ||
    tourDataRaw['@_xsi:nil'] === 'true' ||
    Object.keys(tourDataRaw).filter((k) => !k.startsWith('@_')).length === 0;

  if (nil || action === 'Delete') {
    return { header, hasData: false, stops: [], consignments: [] };
  }

  const truck = (tourDataRaw.Truck || {}) as Record<string, unknown>;
  const driver1 = (tourDataRaw.Driver1 || {}) as Record<string, unknown>;
  const dispatcher = (tourDataRaw.Dispatcher || {}) as Record<string, unknown>;

  const stops: ParsedTourStop[] = asArray(
    (tourDataRaw.Stops as Record<string, unknown> | undefined)?.Stop,
  ).map((s, idx) => {
    const stop = s as Record<string, unknown>;
    const addr = (stop.Address || {}) as Record<string, unknown>;
    const geo = (stop.GeoCoordinate || {}) as Record<string, unknown>;
    const lines = (stop.TourStopLines as Record<string, unknown> | undefined)?.string;
    return {
      sequence: num(stop.Order) ?? idx + 1,
      soloplanTourStopId: str(stop.TourStopId) || undefined,
      stopType: str(stop.StopType) || undefined,
      transportOrderNumber: str(stop.TransportOrderNumber) || undefined,
      name: str(stop.Name1 || stop.Name) || undefined,
      street: addrStreet(addr),
      zip: str(addr.ZipCode) || undefined,
      city: str(addr.City1 || addr.City) || undefined,
      country: countryCode(addr),
      latitude: num(geo.Latitude),
      longitude: num(geo.Longitude),
      targetStart: dt(stop.TargetStart),
      targetEnd: dt(stop.TargetEnd),
      activityDescription: str(stop.ActivityDescription1) || undefined,
      phone: phoneFromStopLines(lines),
    };
  });

  const consignments: ParsedTourConsignment[] = asArray(
    (tourDataRaw.TransportOrders as Record<string, unknown> | undefined)?.TransportOrder,
  )
    .map((o) => {
      const order = o as Record<string, unknown>;
      const cd = (order.ConsignmentData || {}) as Record<string, unknown>;
      const od = (order.OrderData || {}) as Record<string, unknown>;
      // Sender/Receiver können auf TO-Ebene oder in ConsignmentData liegen
      const sender = (order.Sender ||
        (cd as Record<string, unknown>).Sender ||
        {}) as Record<string, unknown>;
      const receiver = (order.Receiver ||
        (cd as Record<string, unknown>).Receiver ||
        {}) as Record<string, unknown>;
      const customer = (order.Customer || {}) as Record<string, unknown>;
      const freightPayer = (order.FreightPayer || {}) as Record<string, unknown>;
      const number = str(order.Number);
      if (!number) return null;
      const loadingUnits = parseLoadingUnits(order);
      const consignmentIndex = num(cd.Number);
      return {
        soloplanOrderNumber: number,
        orderNumber: str(od.OrderNumber) || undefined,
        consignmentIndex:
          consignmentIndex != null && consignmentIndex > 0
            ? Math.floor(consignmentIndex)
            : 1,
        externalConsignmentNumber: str(cd.ExternalConsignmentNumber) || undefined,
        senderName: str(sender.Name1) || undefined,
        senderBpNumber: str(sender.BusinessPartnerNumber) || undefined,
        receiverName: str(receiver.Name1) || undefined,
        customerName: str(customer.Name1) || undefined,
        customerBpNumber: str(customer.BusinessPartnerNumber) || undefined,
        freightPayerName: str(freightPayer.Name1) || undefined,
        freightPayerBpNumber: str(freightPayer.BusinessPartnerNumber) || undefined,
        loadingUnits: loadingUnits.length ? loadingUnits : undefined,
      } as ParsedTourConsignment;
    })
    .filter(Boolean) as ParsedTourConsignment[];

  const dispFirst = str(dispatcher.FirstName);
  const dispLast = str(dispatcher.LastName);

  return {
    header,
    hasData: true,
    caption: str(tourDataRaw.TourCaption) || undefined,
    infoText: str(tourDataRaw.Infotext) || undefined,
    targetStart: dt(tourDataRaw.TargetStart),
    targetEnd: dt(tourDataRaw.TargetEnd),
    targetLoadKm: num(tourDataRaw.TargetLoadKm),
    driverName: str(tourDataRaw.Driver1Name) || undefined,
    driverFirstName: str(driver1.FirstName) || undefined,
    driverLastName: str(driver1.LastName) || undefined,
    driverTelematicsId: str(driver1.TelematicsId) || undefined,
    truckNumber: str(truck.Number) || header.vehicleId,
    truckMatchcode: str(truck.Matchcode) || undefined,
    truckLicensePlate: str(truck.LicensePlate) || undefined,
    dispatcherName: [dispFirst, dispLast].filter(Boolean).join(' ') || undefined,
    dispatcherEmail: str(dispatcher.EmailAddress) || undefined,
    dispatcherPhone: str(dispatcher.TelephoneNumber) || undefined,
    stops,
    consignments,
  };
}

export function describeTourXml(xml: string): string {
  const parsed = parseTourXml(xml);
  if (!parsed) return 'Kein Soloplan-Tour-XML';
  const { header } = parsed;
  return `Tour ${header.tourNumber} · Action=${header.action} · Vehicle=${header.vehicleId || '–'} · Stops=${parsed.stops.length} · Orders=${parsed.consignments.length}`;
}
