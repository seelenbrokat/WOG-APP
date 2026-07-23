/**
 * Builder für Soloplan StdTelematics-Rückmeldungen (Outbound).
 * Namespace und Felder entsprechen den Soloplan-Beispielen (TourStatus,
 * TourStopStatus, TransportOrderStatus, Document, SsccStatus, …).
 *
 * VehicleId „VLBPortal“ = Identität der WOG-Zustell-App gegenüber Soloplan.
 */

export const TELEMATTICS_NS = 'http://www.soloplan.de/StdTelematics';
/** Virtuelle Fahrzeug-ID der Fahrer-Zustellapp (Portal → Soloplan) */
export const VLB_PORTAL_VEHICLE_ID = 'VLBPortal';

function esc(v: string | number | null | undefined): string {
  return String(v ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function iso(d: Date = new Date()): string {
  return d.toISOString();
}

function geoXml(loc?: { latitude: number; longitude: number; information?: string; at?: Date }) {
  if (!loc) return '';
  return `
  <VehicleLocation>
    <LocationDate>${esc(iso(loc.at || new Date()))}</LocationDate>
    <GeoCoordinate>
      <Longitude>${esc(loc.longitude)}</Longitude>
      <Latitude>${esc(loc.latitude)}</Latitude>
    </GeoCoordinate>
    ${loc.information ? `<Information>${esc(loc.information)}</Information>` : ''}
  </VehicleLocation>`;
}

export type OutTourStatus = {
  vehicleId?: string;
  driverId?: string | null;
  tourNumber: string;
  status: 'Started' | 'Finished' | 'TourBreak' | 'TourBreakEnd' | string;
  statusText?: string;
  statusDate?: Date;
  sendDate?: Date;
  location?: { latitude: number; longitude: number; information?: string; at?: Date };
};

/** TourStatus – z. B. Tour starten/beenden */
export function buildTourStatusXml(input: OutTourStatus): string {
  const vehicleId = input.vehicleId || VLB_PORTAL_VEHICLE_ID;
  const statusDate = input.statusDate || new Date();
  const sendDate = input.sendDate || new Date();
  const driver =
    input.driverId == null
      ? '  <DriverId xsi:nil="true" />'
      : `  <DriverId>${esc(input.driverId)}</DriverId>`;
  return `<?xml version="1.0" encoding="utf-8"?>
<TourStatus xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xmlns="${TELEMATTICS_NS}">
  <VehicleId>${esc(vehicleId)}</VehicleId>
${driver}
  <SendDate>${esc(iso(sendDate))}</SendDate>
  <StatusDate>${esc(iso(statusDate))}</StatusDate>
  <TourNumber>${esc(input.tourNumber)}</TourNumber>
  <Status>${esc(input.status)}</Status>
  ${input.statusText ? `<StatusText>${esc(input.statusText)}</StatusText>` : ''}
${geoXml(input.location)}
</TourStatus>
`;
}

export type OutTourStopStatus = {
  vehicleId?: string;
  driverId?: string | null;
  tourStopId: string;
  tourNumber: string;
  status: 'Arrival' | 'Departure' | 'Other' | string;
  statusText?: string;
  statusDate?: Date;
  sendDate?: Date;
  location?: { latitude: number; longitude: number; information?: string; at?: Date };
};

/** TourStopStatus – Ankunft / Abfahrt an Station */
export function buildTourStopStatusXml(input: OutTourStopStatus): string {
  const vehicleId = input.vehicleId || VLB_PORTAL_VEHICLE_ID;
  const statusDate = input.statusDate || new Date();
  const sendDate = input.sendDate || new Date();
  const driver =
    input.driverId == null
      ? '  <DriverId xsi:nil="true" />'
      : `  <DriverId>${esc(input.driverId)}</DriverId>`;
  return `<?xml version="1.0" encoding="utf-8"?>
<TourStopStatus xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xmlns="${TELEMATTICS_NS}">
  <TourStopId>${esc(input.tourStopId)}</TourStopId>
  <TourNumber>${esc(input.tourNumber)}</TourNumber>
  <VehicleId>${esc(vehicleId)}</VehicleId>
${driver}
  <SendDate>${esc(iso(sendDate))}</SendDate>
  <StatusDate>${esc(iso(statusDate))}</StatusDate>
  <Status>${esc(input.status)}</Status>
  ${input.statusText ? `<StatusText>${esc(input.statusText)}</StatusText>` : ''}
${geoXml(input.location)}
</TourStopStatus>
`;
}

export type OutTransportOrderStatus = {
  vehicleId?: string;
  driverId?: string | null;
  transportOrderNumber: string;
  status:
    | 'LoadingPlaceArrived'
    | 'LoadingStart'
    | 'LoadingFinished'
    | 'LoadingPlaceLeft'
    | 'UnloadingPlaceArrived'
    | 'UnloadingStart'
    | 'UnloadingFinished'
    | 'UnloadingPlaceLeft'
    | string;
  statusText?: string;
  statusDate?: Date;
  sendDate?: Date;
  location?: { latitude: number; longitude: number; information?: string; at?: Date };
};

/** TransportOrderStatus – Belade-/Entlade-Status je Auftrag */
export function buildTransportOrderStatusXml(input: OutTransportOrderStatus): string {
  const vehicleId = input.vehicleId || VLB_PORTAL_VEHICLE_ID;
  const statusDate = input.statusDate || new Date();
  const sendDate = input.sendDate || new Date();
  const driver =
    input.driverId == null
      ? '  <DriverId xsi:nil="true" />'
      : `  <DriverId>${esc(input.driverId)}</DriverId>`;
  return `<?xml version="1.0" encoding="utf-8"?>
<TransportOrderStatus xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xmlns="${TELEMATTICS_NS}">
  <VehicleId>${esc(vehicleId)}</VehicleId>
${driver}
  <SendDate>${esc(iso(sendDate))}</SendDate>
  <StatusDate>${esc(iso(statusDate))}</StatusDate>
  <TransportOrderNumber>${esc(input.transportOrderNumber)}</TransportOrderNumber>
  <Status>${esc(input.status)}</Status>
  ${input.statusText ? `<StatusText>${esc(input.statusText)}</StatusText>` : ''}
${geoXml(input.location)}
</TransportOrderStatus>
`;
}

export type OutDocument = {
  vehicleId?: string;
  tourNumber?: string;
  transportOrderNumber?: string;
  tourStopId?: string;
  fileName: string;
  /** Base64-Inhalt (JPG/PDF) */
  contentBase64: string;
  fileSignature?: string;
};

/** Document – POD / Foto / Unterschrift zurück an Soloplan */
export function buildDocumentXml(input: OutDocument): string {
  const vehicleId = input.vehicleId || VLB_PORTAL_VEHICLE_ID;
  return `<?xml version="1.0" encoding="utf-8"?>
<Document xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xmlns="${TELEMATTICS_NS}">
  ${input.tourNumber ? `<TourNumber>${esc(input.tourNumber)}</TourNumber>` : ''}
  ${
    input.transportOrderNumber
      ? `<TransportOrderNumber>${esc(input.transportOrderNumber)}</TransportOrderNumber>`
      : ''
  }
  <VehicleId>${esc(vehicleId)}</VehicleId>
  <Filename>${esc(input.fileName)}</Filename>
  <Content>${input.contentBase64}</Content>
  ${input.tourStopId ? `<TourStopId>${esc(input.tourStopId)}</TourStopId>` : ''}
  ${input.fileSignature ? `<FileSignature>${esc(input.fileSignature)}</FileSignature>` : ''}
</Document>
`;
}

export type OutSsccStatus = {
  transportOrderNumber: string;
  itemNumber?: string;
  tourNumber?: string;
  ssccs: Array<{
    code: string;
    status?: string | number;
    statusTimestamp?: Date;
    transportStatus?: string | number;
    scanPoint?: string;
    comment?: string;
  }>;
};

/** SsccStatus – Scan-Ergebnisse je Packstück */
export function buildSsccStatusXml(input: OutSsccStatus): string {
  const lines = input.ssccs
    .map((s) => {
      const ts = s.statusTimestamp || new Date();
      return `    <Sscc>
      <Code>${esc(s.code)}</Code>
      ${s.status != null ? `<Status>${esc(s.status)}</Status>` : ''}
      <StatusTimestamp>${esc(iso(ts))}</StatusTimestamp>
      ${s.transportStatus != null ? `<TransportStatus>${esc(s.transportStatus)}</TransportStatus>` : ''}
      ${s.scanPoint ? `<ScanPoint>${esc(s.scanPoint)}</ScanPoint>` : ''}
      ${s.comment ? `<Comment>${esc(s.comment)}</Comment>` : ''}
      <CarloFieldValues />
    </Sscc>`;
    })
    .join('\n');
  return `<?xml version="1.0" encoding="utf-8"?>
<SsccStatus xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xmlns="${TELEMATTICS_NS}">
  <TransportOrderNumber>${esc(input.transportOrderNumber)}</TransportOrderNumber>
  ${input.itemNumber != null ? `<ItemNumber>${esc(input.itemNumber)}</ItemNumber>` : ''}
  ${input.tourNumber ? `<TourNumber>${esc(input.tourNumber)}</TourNumber>` : ''}
  <Ssccs>
${lines}
  </Ssccs>
</SsccStatus>
`;
}
