/**
 * Parser für BT Swiss Cargo-Status-XML (nicht FORTRAS STAT512).
 *
 * Beispiel:
 *   <status>
 *     <control><sender>BTSWISS</sender>…</control>
 *     <shipment event="C50" shipmentreference="969384"
 *       signature="…" deliveredto="Balmer" latitude="…" longitude="…" />
 *   </status>
 */
import { XMLParser } from 'fast-xml-parser';
import { parseTelematicsDateTime } from '../../common/zurich-date';

export type BtSwissStatusEvent = {
  shipmentId: string;
  shipmentReference: string;
  shipmentIdBuyer?: string;
  shipmentIdConsignor?: string;
  /** z. B. B00, C50, C56, A00 */
  eventCode: string;
  eventAt: Date | null;
  deliveredTo?: string;
  latitude?: number;
  longitude?: number;
  /** Base64 TIFF/PNG Unterschrift */
  signatureBase64?: string;
  /** Base64 JPEG/PNG Foto */
  pictureBase64?: string;
};

export type BtSwissStatusMessage = {
  sender?: string;
  recipient?: string;
  creationDate?: string;
  sourceFileName?: string;
  events: BtSwissStatusEvent[];
};

export function isBtSwissStatusXml(content: string): boolean {
  const head = String(content || '')
    .slice(0, 1200)
    .toLowerCase();
  if (!head.includes('<status')) return false;
  return (
    head.includes('btswiss') ||
    (head.includes('<control') && head.includes('shipment'))
  );
}

function parseBtDate(raw: string): Date | null {
  const s = String(raw || '').trim();
  if (!s) return null;
  // 14.09.2026 14:02 → als Europe/Zurich interpretieren
  const m = /^(\d{2})\.(\d{2})\.(\d{4})\s+(\d{1,2}):(\d{2})(?::(\d{2}))?/.exec(s);
  if (m) {
    const [, dd, mm, yyyy, hh, mi, ss] = m;
    const isoLocal = `${yyyy}-${mm}-${dd}T${String(hh).padStart(2, '0')}:${mi}:${ss || '00'}`;
    return parseTelematicsDateTime(isoLocal) || null;
  }
  return parseTelematicsDateTime(s) || null;
}

function parseCoord(raw: string): number | undefined {
  const n = Number(String(raw || '').trim());
  if (!Number.isFinite(n)) return undefined;
  if (Math.abs(n) < 1e-9) return undefined; // 0.0 = kein Fix
  return n;
}

function asShipmentArray(raw: unknown): any[] {
  if (!raw) return [];
  return Array.isArray(raw) ? raw : [raw];
}

export function parseBtSwissStatusXml(
  content: string,
  sourceFileName?: string,
): BtSwissStatusMessage {
  const xml = String(content || '').trim();
  if (!xml) throw new Error('BT-Swiss-Status: leere Datei');

  const parser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: '@_',
    trimValues: false,
  });

  let root: any;
  try {
    root = parser.parse(xml);
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    throw new Error(`BT-Swiss-Status: XML ungültig (${msg})`);
  }

  const status = root?.status;
  if (!status) throw new Error('BT-Swiss-Status: Wurzel <status> fehlt');

  const control = status.control || {};
  const shipments = asShipmentArray(status.shipment);
  if (!shipments.length) {
    throw new Error('BT-Swiss-Status: keine <shipment>-Einträge');
  }

  const events: BtSwissStatusEvent[] = [];
  for (const sh of shipments) {
    if (!sh || typeof sh !== 'object') continue;
    const eventCode = String(sh['@_event'] || sh.event || '')
      .trim()
      .toUpperCase();
    if (!eventCode) continue;

    const details = sh.details;
    let pictureBase64: string | undefined;
    if (details && typeof details === 'object') {
      const pic = details['@_picture'] ?? details.picture;
      pictureBase64 = String(pic || '').trim() || undefined;
    }

    const signatureBase64 =
      String(sh['@_signature'] || sh.signature || '').trim() || undefined;

    events.push({
      shipmentId: String(sh['@_shipmentid'] || sh.shipmentid || '').trim(),
      shipmentReference: String(
        sh['@_shipmentreference'] || sh.shipmentreference || '',
      ).trim(),
      shipmentIdBuyer:
        String(sh['@_shipmentidbuyer'] || sh.shipmentidbuyer || '').trim() ||
        undefined,
      shipmentIdConsignor:
        String(
          sh['@_shipmentidconsignor'] || sh.shipmentidconsignor || '',
        ).trim() || undefined,
      eventCode,
      eventAt: parseBtDate(
        String(sh['@_datetimestamp'] || sh.datetimestamp || ''),
      ),
      deliveredTo:
        String(sh['@_deliveredto'] || sh.deliveredto || '').trim() || undefined,
      latitude: parseCoord(String(sh['@_latitude'] || sh.latitude || '')),
      longitude: parseCoord(String(sh['@_longitude'] || sh.longitude || '')),
      signatureBase64,
      pictureBase64,
    });
  }

  if (!events.length) {
    throw new Error('BT-Swiss-Status: keine verwertbaren Events');
  }

  return {
    sender: String(control.sender || '').trim() || undefined,
    recipient: String(control.recipient || '').trim() || undefined,
    creationDate: String(control.creationdate || '').trim() || undefined,
    sourceFileName,
    events,
  };
}

/** Primäre Referenz für Soloplan-/Portal-Match. */
export function primaryBtSwissReference(ev: BtSwissStatusEvent): string {
  if (ev.shipmentReference) return ev.shipmentReference;
  if (ev.shipmentIdBuyer) return ev.shipmentIdBuyer;
  if (ev.shipmentIdConsignor) return ev.shipmentIdConsignor;
  if (ev.shipmentId) {
    // 188145/452359.1 → bevorzugt Teil nach /
    const parts = ev.shipmentId.split('/');
    return (parts[1] || parts[0] || '').trim();
  }
  return '';
}
