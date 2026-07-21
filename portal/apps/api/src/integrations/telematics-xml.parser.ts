/**
 * Parser für Soloplan StdTelematics-Rückmeldungen:
 * TourStatus, TransportOrderStatus, VehicleLocations, Document
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

export type ParsedTelematics =
  | ParsedTourStatus
  | ParsedTransportOrderStatus
  | ParsedVehicleLocations
  | ParsedTelematicsDocument;

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
  if (lower.includes('_vehiclelocations_')) return 'VehicleLocations';
  if (lower.includes('_document_')) return 'Document';
  return null;
}

export function parseTelematicsXml(xml: string, fileName?: string): ParsedTelematics | null {
  const parser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: '@_',
    removeNSPrefix: true,
    isArray: (name) => ['Location', 'Activity'].includes(name),
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
