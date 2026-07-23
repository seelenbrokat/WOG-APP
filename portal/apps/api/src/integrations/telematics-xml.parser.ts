/**
 * Parser für Soloplan StdTelematics-Rückmeldungen:
 * TourStatus, TransportOrderStatus, TourStopStatus, VehicleLocations, Document,
 * SsccStatus, Receipt, DriverActivities
 */

import { XMLParser } from 'fast-xml-parser';

export type GeoPoint = { latitude: number; longitude: number; locationAt?: Date; timeZone?: string };

export type ParsedTourStatus = {
  kind: 'TourStatus';
  vehicleId?: string;
  driverId?: string;
  sendDate?: Date;
  statusDate?: Date;
  tourNumber: string;
  status: string;
  statusText?: string;
  location?: GeoPoint;
};

export type ParsedTransportOrderStatus = {
  kind: 'TransportOrderStatus';
  vehicleId?: string;
  driverId?: string;
  sendDate?: Date;
  statusDate?: Date;
  transportOrderNumber: string;
  status: string;
  statusText?: string;
  location?: GeoPoint;
};

export type ParsedLoadingUnitExchange = {
  matchcode: string;
  given: number;
  taken: number;
};

export type ParsedTourStopStatus = {
  kind: 'TourStopStatus';
  tourStopId: string;
  tourNumber: string;
  vehicleId?: string;
  driverId?: string;
  sendDate?: Date;
  statusDate?: Date;
  status?: string;
  statusText?: string;
  location?: GeoPoint;
  exchanges: ParsedLoadingUnitExchange[];
};

export type ParsedVehicleLocations = {
  kind: 'VehicleLocations';
  vehicleId: string;
  driverId?: string;
  locations: GeoPoint[];
};

export type ParsedTelematicsDocument = {
  kind: 'Document';
  tourNumber?: string;
  transportOrderNumber?: string;
  vehicleId?: string;
  fileName: string;
  contentBase64: string;
};

export type ParsedSsccLine = {
  code: string;
  status?: string;
  statusTimestamp?: Date;
  transportStatus?: string;
  scanPoint?: string;
  comment?: string;
};

export type ParsedSsccStatus = {
  kind: 'SsccStatus';
  transportOrderNumber: string;
  itemNumber?: string;
  ssccs: ParsedSsccLine[];
};

export type ParsedReceipt = {
  kind: 'Receipt';
  vehicleId?: string;
  sendDate?: Date;
  receiptType?: string;
  referenceType?: string;
  referenceId?: string;
};

export type ParsedDriverActivities = {
  kind: 'DriverActivities';
  driverId?: string;
  vehicleId?: string;
  vehicleLicensePlate?: string;
  activities: Array<{ start?: Date; end?: Date; activity?: string }>;
};

export type ParsedTelematics =
  | ParsedTourStatus
  | ParsedTransportOrderStatus
  | ParsedTourStopStatus
  | ParsedVehicleLocations
  | ParsedTelematicsDocument
  | ParsedSsccStatus
  | ParsedReceipt
  | ParsedDriverActivities;

function asArray<T>(v: T | T[] | undefined | null): T[] {
  if (v == null) return [];
  return Array.isArray(v) ? v : [v];
}

function str(v: unknown): string {
  if (v == null) return '';
  if (typeof v === 'object' && v !== null) {
    const rec = v as Record<string, unknown>;
    if (rec['@_nil'] === 'true' || rec['@_xsi:nil'] === 'true') return '';
    if ('#text' in rec) return String(rec['#text'] ?? '').trim();
    // leere/unbekannte XML-Objekte nicht als "[object Object]" speichern
    return '';
  }
  return String(v).trim();
}

function num(v: unknown): number | undefined {
  const s = str(v);
  if (!s) return undefined;
  const n = Number(s);
  return Number.isFinite(n) ? n : undefined;
}

function intOrZero(v: unknown): number {
  const n = num(v);
  if (n == null) return 0;
  return Math.trunc(n);
}

function dt(v: unknown): Date | undefined {
  const s = str(v);
  if (!s) return undefined;
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? undefined : d;
}

function parseLocation(node: Record<string, unknown> | undefined): GeoPoint | undefined {
  if (!node) return undefined;
  const geo = (node.GeoCoordinate || {}) as Record<string, unknown>;
  const latitude = num(geo.Latitude);
  const longitude = num(geo.Longitude);
  if (latitude == null || longitude == null) return undefined;
  return {
    latitude,
    longitude,
    locationAt: dt(node.LocationDate),
    timeZone: str(node.TimeZone) || undefined,
  };
}

export function detectTelematicsKind(fileName: string): ParsedTelematics['kind'] | null {
  const lower = fileName.toLowerCase();
  if (lower.includes('_tourstatus_')) return 'TourStatus';
  if (lower.includes('_transportorderstatus_')) return 'TransportOrderStatus';
  if (lower.includes('_tourstopstatus_')) return 'TourStopStatus';
  if (lower.includes('_vehiclelocations_')) return 'VehicleLocations';
  if (lower.includes('_document_')) return 'Document';
  if (lower.includes('_ssccstatus_')) return 'SsccStatus';
  if (lower.includes('_receipt_')) return 'Receipt';
  if (lower.includes('_driveractivities_')) return 'DriverActivities';
  return null;
}

export function parseTelematicsXml(xml: string, fileName?: string): ParsedTelematics | null {
  const parser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: '@_',
    removeNSPrefix: true,
    isArray: (name) => ['Location', 'Activity', 'LoadingUnitExchange'].includes(name),
  });

  let raw: Record<string, unknown>;
  try {
    raw = parser.parse(xml) as Record<string, unknown>;
  } catch {
    return null;
  }

  if (raw.TourStatus) {
    const n = raw.TourStatus as Record<string, unknown>;
    const tourNumber = str(n.TourNumber);
    const status = str(n.Status);
    if (!tourNumber || !status) return null;
    return {
      kind: 'TourStatus',
      vehicleId: str(n.VehicleId) || undefined,
      driverId: str(n.DriverId) || undefined,
      sendDate: dt(n.SendDate),
      statusDate: dt(n.StatusDate),
      tourNumber,
      status,
      statusText: str(n.StatusText) || undefined,
      location: parseLocation(n.VehicleLocation as Record<string, unknown> | undefined),
    };
  }

  if (raw.TransportOrderStatus) {
    const n = raw.TransportOrderStatus as Record<string, unknown>;
    const transportOrderNumber = str(n.TransportOrderNumber);
    const status = str(n.Status);
    if (!transportOrderNumber || !status) return null;
    return {
      kind: 'TransportOrderStatus',
      vehicleId: str(n.VehicleId) || undefined,
      driverId: str(n.DriverId) || undefined,
      sendDate: dt(n.SendDate),
      statusDate: dt(n.StatusDate),
      transportOrderNumber,
      status,
      statusText: str(n.StatusText) || undefined,
      location: parseLocation(n.VehicleLocation as Record<string, unknown> | undefined),
    };
  }

  if (raw.TourStopStatus) {
    const n = raw.TourStopStatus as Record<string, unknown>;
    const tourStopId = str(n.TourStopId);
    const tourNumber = str(n.TourNumber);
    if (!tourStopId || !tourNumber) return null;
    const exchangeNodes = asArray(
      (n.LoadingUnitExchanges as Record<string, unknown> | undefined)?.LoadingUnitExchange as
        | Record<string, unknown>
        | Record<string, unknown>[]
        | undefined,
    );
    const exchanges: ParsedLoadingUnitExchange[] = exchangeNodes
      .map((ex) => {
        const matchcode = str(ex.LoadingUnitMatchcode);
        if (!matchcode) return null;
        return {
          matchcode,
          given: intOrZero(ex.Given),
          taken: intOrZero(ex.Taken),
        };
      })
      .filter(Boolean) as ParsedLoadingUnitExchange[];
    return {
      kind: 'TourStopStatus',
      tourStopId,
      tourNumber,
      vehicleId: str(n.VehicleId) || undefined,
      driverId: str(n.DriverId) || undefined,
      sendDate: dt(n.SendDate),
      statusDate: dt(n.StatusDate),
      status: str(n.Status) || undefined,
      statusText: str(n.StatusText) || undefined,
      location: parseLocation(n.VehicleLocation as Record<string, unknown> | undefined),
      exchanges,
    };
  }

  if (raw.VehicleLocations) {
    const n = raw.VehicleLocations as Record<string, unknown>;
    const vehicleId = str(n.VehicleId);
    if (!vehicleId) return null;
    const locs = asArray(
      (n.Locations as Record<string, unknown> | undefined)?.Location as
        | Record<string, unknown>
        | Record<string, unknown>[]
        | undefined,
    )
      .map((l) => parseLocation(l as Record<string, unknown>))
      .filter(Boolean) as GeoPoint[];
    return {
      kind: 'VehicleLocations',
      vehicleId,
      driverId: str(n.DriverId) || undefined,
      locations: locs,
    };
  }

  if (raw.Document) {
    const n = raw.Document as Record<string, unknown>;
    const fileNameDoc = str(n.Filename || n.FileName);
    const contentBase64 = str(n.Content);
    if (!fileNameDoc || !contentBase64) return null;
    return {
      kind: 'Document',
      tourNumber: str(n.TourNumber) || undefined,
      transportOrderNumber: str(n.TransportOrderNumber) || undefined,
      vehicleId: str(n.VehicleId) || undefined,
      fileName: fileNameDoc,
      contentBase64,
    };
  }

  if (raw.SsccStatus) {
    const n = raw.SsccStatus as Record<string, unknown>;
    const transportOrderNumber = str(n.TransportOrderNumber);
    if (!transportOrderNumber) return null;
    const ssccNodes = asArray(
      (n.Ssccs as Record<string, unknown> | undefined)?.Sscc as
        | Record<string, unknown>
        | Record<string, unknown>[]
        | undefined,
    );
    const ssccs: ParsedSsccLine[] = ssccNodes
      .map((s) => {
        const code = str(s.Code);
        if (!code) return null;
        return {
          code,
          status: str(s.Status) || undefined,
          statusTimestamp: dt(s.StatusTimestamp),
          transportStatus: str(s.TransportStatus) || undefined,
          scanPoint: str(s.ScanPoint) || undefined,
          comment: str(s.Comment) || undefined,
        };
      })
      .filter(Boolean) as ParsedSsccLine[];
    return {
      kind: 'SsccStatus',
      transportOrderNumber,
      itemNumber: str(n.ItemNumber) || undefined,
      ssccs,
    };
  }

  if (raw.Receipt) {
    const n = raw.Receipt as Record<string, unknown>;
    const ref = (n.Reference || {}) as Record<string, unknown>;
    return {
      kind: 'Receipt',
      vehicleId: str(n.VehicleId) || undefined,
      sendDate: dt(n.SendDate),
      receiptType: str(n.ReceiptType) || undefined,
      referenceType: str(ref.Type) || undefined,
      referenceId: str(ref.Id) || undefined,
    };
  }

  if (raw.DriverActivities) {
    const n = raw.DriverActivities as Record<string, unknown>;
    const activities = asArray(
      (n.Activities as Record<string, unknown> | undefined)?.Activity as
        | Record<string, unknown>
        | Record<string, unknown>[]
        | undefined,
    ).map((a) => ({
      start: dt(a.Start),
      end: dt(a.End),
      activity: str(a.Activity) || undefined,
    }));
    return {
      kind: 'DriverActivities',
      driverId: str(n.DriverId) || undefined,
      vehicleId: str(n.VehicleId) || undefined,
      vehicleLicensePlate: str(n.VehicleLicensePlate) || undefined,
      activities,
    };
  }

  // Fallback via filename if root unexpected
  if (fileName && detectTelematicsKind(fileName)) return null;
  return null;
}

export function mimeFromFileName(fileName: string): string {
  const lower = fileName.toLowerCase();
  if (lower.endsWith('.jpg') || lower.endsWith('.jpeg')) return 'image/jpeg';
  if (lower.endsWith('.png')) return 'image/png';
  if (lower.endsWith('.pdf')) return 'application/pdf';
  if (lower.endsWith('.tif') || lower.endsWith('.tiff')) return 'image/tiff';
  return 'application/octet-stream';
}
