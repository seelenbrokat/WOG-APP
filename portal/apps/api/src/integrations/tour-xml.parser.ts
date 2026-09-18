/**
 * Parser für Soloplan StdTelematics Tour-XML
 * Namespace: http://www.soloplan.de/StdTelematics
 *
 * Zusammenhänge:
 * - Header: TourId, TourNumber, VehicleId, Action (Create|Change|Delete), SendDate
 * - TourData.Truck / Driver1: Fahrzeug + Fahrer
 * - Stops: Stop-Reihenfolge; TransportOrderNumber verknüpft Sendung
 * - TransportOrders: Aufträge/Sendungen der Tour (inkl. Adressen, Freight, Items/SSCC, Hinweise)
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

export type ParsedAddress = {
  street?: string;
  zip?: string;
  city?: string;
  city2?: string;
  country?: string;
};

export type ParsedGeo = {
  latitude?: number;
  longitude?: number;
};

export type ParsedContact = {
  firstName?: string;
  lastName?: string;
  name?: string;
  telephone?: string;
  mobile?: string;
  email?: string;
  title?: string;
  department?: string;
};

export type ParsedPartner = {
  name?: string;
  name2?: string;
  name3?: string;
  name4?: string;
  bpNumber?: string;
  externalBpNumber?: string;
  address?: ParsedAddress;
  geo?: ParsedGeo;
  contact?: ParsedContact;
  openingHours?: Record<string, unknown>;
  stallageFreeTime?: string;
};

export type ParsedFreight = {
  effectiveWeightKg?: number;
  chargeableWeightKg?: number;
  carrierWeightKg?: number;
  loadingMeter?: number;
  squareMeter?: number;
  cubicMeter?: number;
  quantity?: number;
  storagePlaces?: number;
  containerNumber?: string;
  kilometer?: number;
  tollKilometer?: number;
  incoterms?: string;
  content?: string;
  content2?: string;
  packaging?: string;
  unit?: string;
  articleNumber?: string;
  eanCode?: string;
  length?: number;
  width?: number;
  height?: number;
};

export type ParsedTourItem = {
  number?: number;
  extNumber?: string;
  freight?: ParsedFreight;
  ssccs?: string[];
  dangerousGoods?: Record<string, unknown>;
};

export type ParsedInfoLine = {
  number?: string;
  value?: string;
};

export type ParsedConsignmentDetails = {
  externalOrderNumber?: string;
  externalTransportOrderNumber?: string;
  sender?: ParsedPartner;
  receiver?: ParsedPartner;
  customer?: ParsedPartner;
  freightPayer?: ParsedPartner;
  differentLoadingPoint?: ParsedPartner;
  differentUnloadingPoint?: ParsedPartner;
  freight?: ParsedFreight;
  planned?: {
    loadingFrom?: string;
    loadingUntil?: string;
    unloadingFrom?: string;
    unloadingUntil?: string;
    loadingOrder?: number;
    deliveryOrder?: number;
  };
  remarks?: {
    senderInformation1?: string;
    senderInformation2?: string;
    receiverInformation?: string;
    informations?: ParsedInfoLine[];
    consignmentInformations?: ParsedInfoLine[];
  };
  references?: ParsedInfoLine[];
  items?: ParsedTourItem[];
  checkFields?: Array<{ number?: string; value?: string }>;
};

export type ParsedStopDetails = {
  name2?: string;
  city2?: string;
  activityDescription2?: string;
  remarksLines?: string[];
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
  details?: ParsedStopDetails;
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
  /** Vollständige Sendungsdetails für Zustellapp */
  details?: ParsedConsignmentDetails;
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
  tourStopSummary?: string;
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

function isoStr(v: unknown): string | undefined {
  const s = str(v);
  return s || undefined;
}

function isNilObj(v: unknown): boolean {
  if (v == null) return true;
  if (typeof v !== 'object') return false;
  const rec = v as Record<string, unknown>;
  return rec['@_nil'] === 'true' || rec['@_xsi:nil'] === 'true' || rec['@_xsi:nil'] === true;
}

function unwrapNs(obj: unknown): unknown {
  if (!obj || typeof obj !== 'object') return obj;
  if (Array.isArray(obj)) return obj.map(unwrapNs);
  const rec = obj as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(rec)) {
    const plain = k.includes(':') ? k.split(':').pop()! : k.replace(`{${NS}}`, '');
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

function parseAddress(addrRaw: unknown): ParsedAddress | undefined {
  if (!addrRaw || typeof addrRaw !== 'object' || isNilObj(addrRaw)) return undefined;
  const addr = addrRaw as Record<string, unknown>;
  const out: ParsedAddress = {
    street: addrStreet(addr),
    zip: str(addr.ZipCode) || undefined,
    city: str(addr.City1 || addr.City) || undefined,
    city2: str(addr.City2) || undefined,
    country: countryCode(addr),
  };
  return Object.values(out).some(Boolean) ? out : undefined;
}

function parseGeo(geoRaw: unknown): ParsedGeo | undefined {
  if (!geoRaw || typeof geoRaw !== 'object' || isNilObj(geoRaw)) return undefined;
  const geo = geoRaw as Record<string, unknown>;
  const latitude = num(geo.Latitude);
  const longitude = num(geo.Longitude);
  if (latitude == null && longitude == null) return undefined;
  return { latitude, longitude };
}

function parseContact(contactRaw: unknown): ParsedContact | undefined {
  if (!contactRaw || typeof contactRaw !== 'object' || isNilObj(contactRaw)) return undefined;
  const c = contactRaw as Record<string, unknown>;
  const firstName = str(c.FirstName) || undefined;
  const lastName = str(c.LastName) || undefined;
  const out: ParsedContact = {
    firstName,
    lastName,
    name: [firstName, lastName].filter(Boolean).join(' ') || undefined,
    telephone: str(c.TelephoneNumber) || undefined,
    mobile: str(c.MobilePhoneNumber) || undefined,
    email: str(c.EmailAddress) || undefined,
    title: str(c.Title) || undefined,
    department: str(c.Department) || undefined,
  };
  return Object.values(out).some(Boolean) ? out : undefined;
}

function parseDayWindow(dayRaw: unknown): Record<string, string> | undefined {
  if (!dayRaw || typeof dayRaw !== 'object' || isNilObj(dayRaw)) return undefined;
  const day = dayRaw as Record<string, unknown>;
  const out: Record<string, string> = {};
  for (const part of ['Morning', 'Afternoon'] as const) {
    const w = day[part] as Record<string, unknown> | undefined;
    if (!w || isNilObj(w)) continue;
    const from = str(w.From);
    const to = str(w.To);
    if (from || to) out[part.toLowerCase()] = [from, to].filter(Boolean).join('–');
  }
  return Object.keys(out).length ? out : undefined;
}

function parseOpeningHours(ohRaw: unknown): Record<string, unknown> | undefined {
  if (!ohRaw || typeof ohRaw !== 'object' || isNilObj(ohRaw)) return undefined;
  const oh = ohRaw as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const day of [
    'Monday',
    'Tuesday',
    'Wednesday',
    'Thursday',
    'Friday',
    'Saturday',
    'Sunday',
  ]) {
    const w = parseDayWindow(oh[day]);
    if (w) out[day] = w;
  }
  return Object.keys(out).length ? out : undefined;
}

function parsePartner(partnerRaw: unknown): ParsedPartner | undefined {
  if (!partnerRaw || typeof partnerRaw !== 'object' || isNilObj(partnerRaw)) return undefined;
  const p = partnerRaw as Record<string, unknown>;
  const out: ParsedPartner = {
    name: str(p.Name1 || p.Name) || undefined,
    name2: str(p.Name2) || undefined,
    name3: str(p.Name3) || undefined,
    name4: str(p.Name4) || undefined,
    bpNumber: str(p.BusinessPartnerNumber) || undefined,
    externalBpNumber: str(p.ExternalBusinessPartnerNumber) || undefined,
    address: parseAddress(p.Address),
    geo: parseGeo(p.GeoCoordinate),
    contact: parseContact(p.ContactPerson),
    openingHours: parseOpeningHours(p.OpeningHours),
    stallageFreeTime: str(p.StallageFreeTime) || undefined,
  };
  const has =
    out.name ||
    out.bpNumber ||
    out.address ||
    out.geo ||
    out.contact ||
    out.openingHours ||
    out.name2;
  return has ? out : undefined;
}

function parseFreight(fdRaw: unknown): ParsedFreight | undefined {
  if (!fdRaw || typeof fdRaw !== 'object' || isNilObj(fdRaw)) return undefined;
  const fd = fdRaw as Record<string, unknown>;
  const out: ParsedFreight = {
    effectiveWeightKg: num(fd.EffectiveWeight),
    chargeableWeightKg: num(fd.ChargeableWeight),
    carrierWeightKg: num(fd.CarrierWeight),
    loadingMeter: num(fd.LoadingMeter),
    squareMeter: num(fd.SquareMeter),
    cubicMeter: num(fd.CubicMeter),
    quantity: num(fd.Quantity),
    storagePlaces: num(fd.StoragePlaces),
    containerNumber: str(fd.ContainerNumber) || undefined,
    kilometer: num(fd.Kilometer),
    tollKilometer: num(fd.TollKilometer),
    incoterms: str(fd.Incoterms) || undefined,
    content: str(fd.Content1) || undefined,
    content2: str(fd.Content2) || undefined,
    packaging: str(fd.Packaging) || undefined,
    unit: str(fd.Unit) || undefined,
    articleNumber: str(fd.ArticleNumber) || undefined,
    eanCode: str(fd.EanCode) || undefined,
    length: num(fd.Length),
    width: num(fd.Width),
    height: num(fd.Height),
  };
  return Object.values(out).some((v) => v != null && v !== '') ? out : undefined;
}

function parseInfoLines(raw: unknown): ParsedInfoLine[] {
  if (!raw || typeof raw !== 'object' || isNilObj(raw)) return [];
  const container = raw as Record<string, unknown>;
  const lines = asArray(container.Information ?? container.Reference ?? raw);
  return lines
    .map((line) => {
      if (!line || typeof line !== 'object') return null;
      const rec = line as Record<string, unknown>;
      const number = str(rec.Number) || undefined;
      const value = str(rec.Value) || undefined;
      if (!number && !value) return null;
      return { number, value };
    })
    .filter(Boolean) as ParsedInfoLine[];
}

function parseDangerousGoods(dgRaw: unknown): Record<string, unknown> | undefined {
  if (!dgRaw || typeof dgRaw !== 'object' || isNilObj(dgRaw)) return undefined;
  const dg = dgRaw as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(dg)) {
    if (k.startsWith('@_')) continue;
    const s = str(v);
    if (s) out[k] = s;
  }
  return Object.keys(out).length ? out : undefined;
}

function parseItems(itemsRaw: unknown): ParsedTourItem[] {
  if (!itemsRaw || typeof itemsRaw !== 'object' || isNilObj(itemsRaw)) return [];
  const container = itemsRaw as Record<string, unknown>;
  return asArray(container.Item)
    .map((itemRaw) => {
      if (!itemRaw || typeof itemRaw !== 'object') return null;
      const item = itemRaw as Record<string, unknown>;
      const ssccContainer = item.SSCCs as Record<string, unknown> | undefined;
      const ssccs = asArray(ssccContainer?.SSCC)
        .map((s) => {
          if (!s || typeof s !== 'object') return str(s);
          return str((s as Record<string, unknown>).Code);
        })
        .filter(Boolean);
      const freight = parseFreight(item.FreightData);
      const dangerousGoods = parseDangerousGoods(item.DangerousGoodsInformation);
      const out: ParsedTourItem = {
        number: num(item.Number),
        extNumber: str(item.ExtNumber) || undefined,
        freight,
        ssccs: ssccs.length ? ssccs : undefined,
        dangerousGoods,
      };
      if (!out.freight && !out.ssccs?.length && out.number == null && !out.extNumber) return null;
      return out;
    })
    .filter(Boolean) as ParsedTourItem[];
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

function pruneUndefined<T extends Record<string, unknown>>(obj: T): T {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) {
    if (v === undefined) continue;
    if (v && typeof v === 'object' && !Array.isArray(v) && !(v instanceof Date)) {
      const nested = pruneUndefined(v as Record<string, unknown>);
      if (Object.keys(nested).length) out[k] = nested;
      continue;
    }
    if (Array.isArray(v) && v.length === 0) continue;
    out[k] = v;
  }
  return out as T;
}

export function parseTourXml(xml: string, fileName?: string): ParsedTour | null {
  const parser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: '@_',
    removeNSPrefix: true,
    isArray: (name) =>
      [
        'Stop',
        'TransportOrder',
        'string',
        'Item',
        'SSCC',
        'Information',
        'Reference',
        'CheckField',
        'LoadingUnit',
      ].includes(name),
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
    const linesRaw = (stop.TourStopLines as Record<string, unknown> | undefined)?.string;
    const remarksLines = asArray(linesRaw).map(str).filter(Boolean);
    const details = pruneUndefined({
      name2: str(stop.Name2) || undefined,
      city2: str(addr.City2) || undefined,
      activityDescription2: str(stop.ActivityDescription2) || undefined,
      remarksLines: remarksLines.length ? remarksLines : undefined,
    } as ParsedStopDetails);
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
      targetStart: dt(stop.TargetStart || stop.PlannedStart),
      targetEnd: dt(stop.TargetEnd || stop.PlannedEnd),
      activityDescription: str(stop.ActivityDescription1) || undefined,
      phone: phoneFromStopLines(remarksLines),
      details: Object.keys(details).length ? details : undefined,
    };
  });

  const consignments: ParsedTourConsignment[] = asArray(
    (tourDataRaw.TransportOrders as Record<string, unknown> | undefined)?.TransportOrder,
  )
    .map((o) => {
      const order = o as Record<string, unknown>;
      const cd = (order.ConsignmentData || {}) as Record<string, unknown>;
      const od = (order.OrderData || {}) as Record<string, unknown>;
      const sender = parsePartner(order.Sender || cd.Sender);
      const receiver = parsePartner(order.Receiver || cd.Receiver);
      const customer = parsePartner(order.Customer);
      const freightPayer = parsePartner(order.FreightPayer);
      const number = str(order.Number);
      if (!number) return null;
      const loadingUnits = parseLoadingUnits(order);
      const consignmentIndex = num(cd.Number);
      const infos = (order.Informations || {}) as Record<string, unknown>;
      const restrictions = (order.Restrictions || {}) as Record<string, unknown>;
      const items = parseItems(order.Items);
      const checkFields = asArray(
        (cd.CheckFields as Record<string, unknown> | undefined)?.CheckField,
      )
        .map((cf) => {
          if (!cf || typeof cf !== 'object') return null;
          const rec = cf as Record<string, unknown>;
          return {
            number: str(rec.Number) || undefined,
            value: str(rec.Value) || undefined,
          };
        })
        .filter((x) => x && (x.number || x.value)) as Array<{ number?: string; value?: string }>;

      const details = pruneUndefined({
        externalOrderNumber: str(od.ExternalOrderNumber) || undefined,
        externalTransportOrderNumber: str(order.ExternalNumber) || undefined,
        sender,
        receiver,
        customer,
        freightPayer,
        differentLoadingPoint: parsePartner(order.DifferentLoadingPoint || cd.DifferentLoadingPoint),
        differentUnloadingPoint: parsePartner(
          order.DifferentUnloadingPoint || cd.DifferentUnloadingPoint,
        ),
        freight: parseFreight(order.FreightData),
        planned: pruneUndefined({
          loadingFrom: isoStr(restrictions.PlannedLoadingFrom),
          loadingUntil: isoStr(restrictions.PlannedLoadingUntil),
          unloadingFrom: isoStr(restrictions.PlannedUnloadingFrom),
          unloadingUntil: isoStr(restrictions.PlannedUnloadingUntil),
          loadingOrder: num(restrictions.LoadingOrder),
          deliveryOrder: num(restrictions.DeliveryOrder),
        }),
        remarks: pruneUndefined({
          senderInformation1: str(infos.SenderInformation1) || undefined,
          senderInformation2: str(infos.SenderInformation2) || undefined,
          receiverInformation: str(infos.ReceiverInformation) || undefined,
          informations: parseInfoLines(infos.Informations),
          consignmentInformations: parseInfoLines(infos.ConsignmentInformations),
        }),
        references: parseInfoLines(cd.ConsignmentReferences),
        items: items.length ? items : undefined,
        checkFields: checkFields.length ? checkFields : undefined,
      } as ParsedConsignmentDetails);

      return {
        soloplanOrderNumber: number,
        orderNumber: str(od.OrderNumber) || undefined,
        consignmentIndex:
          consignmentIndex != null && consignmentIndex > 0
            ? Math.floor(consignmentIndex)
            : 1,
        externalConsignmentNumber: str(cd.ExternalConsignmentNumber) || undefined,
        senderName: sender?.name,
        senderBpNumber: sender?.bpNumber,
        receiverName: receiver?.name,
        customerName: customer?.name,
        customerBpNumber: customer?.bpNumber,
        freightPayerName: freightPayer?.name,
        freightPayerBpNumber: freightPayer?.bpNumber,
        loadingUnits: loadingUnits.length ? loadingUnits : undefined,
        details: Object.keys(details).length ? details : undefined,
      } as ParsedTourConsignment;
    })
    .filter(Boolean) as ParsedTourConsignment[];

  const dispFirst = str(dispatcher.FirstName);
  const dispLast = str(dispatcher.LastName);

  return {
    header,
    hasData: true,
    caption: str(tourDataRaw.TourCaption || tourDataRaw.Designation) || undefined,
    infoText: str(tourDataRaw.Infotext) || undefined,
    tourStopSummary: str(tourDataRaw.TourStopSummary) || undefined,
    targetStart: dt(tourDataRaw.TargetStart || tourDataRaw.PlannedStart),
    targetEnd: dt(tourDataRaw.TargetEnd || tourDataRaw.PlannedEnd),
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
