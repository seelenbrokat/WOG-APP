/**
 * BT Swiss Cargo-Eventcodes → Soloplan TransportOrderStatus.
 * Beschreibung/Freitext ist optional – Status geht auch ohne.
 */
import type { OutTransportOrderStatus } from '../telematics-xml.builder';
import type { BtSwissStatusEvent } from './bt-swiss-status.parser';
import { primaryBtSwissReference } from './bt-swiss-status.parser';

export type MappedBtSwissStatus = {
  transportOrderNumber: string;
  status: OutTransportOrderStatus['status'];
  /** Kann leer sein – Soloplan akzeptiert Status ohne StatusText. */
  statusText?: string;
  statusDate?: Date;
  originalCode: string;
  deliveredTo?: string;
  location?: { latitude: number; longitude: number };
  hasProof: boolean;
};

/**
 * Buchstabe = Phase, Zahl = Detail (Cargo-Status BT Swiss).
 * C50 = zugestellt m. Unterschrift, C56 = zugestellt m. Foto / Ablage.
 */
const EVENT_MAP: Record<string, OutTransportOrderStatus['status']> = {
  A00: 'LoadingPlaceArrived',
  A50: 'LoadingFinished',
  B00: 'Other', // unterwegs / Depot / Transit
  B50: 'Other',
  C00: 'UnloadingPlaceArrived',
  C40: 'UnloadingStart',
  C50: 'UnloadingFinished',
  C56: 'UnloadingFinished',
  C60: 'UnloadingFinished',
  C70: 'UnloadingPlaceLeft',
};

export function mapBtSwissEventToTransportOrderStatus(
  ev: BtSwissStatusEvent,
): MappedBtSwissStatus | null {
  const transportOrderNumber = primaryBtSwissReference(ev);
  if (!transportOrderNumber) return null;

  const originalCode = String(ev.eventCode || '')
    .trim()
    .toUpperCase();
  const status = EVENT_MAP[originalCode] || 'Other';

  // Kurztext nur wenn sinnvoll – nie Pflicht
  const bits = [
    originalCode ? `BT ${originalCode}` : null,
    ev.deliveredTo ? `Empf: ${ev.deliveredTo}` : null,
  ].filter(Boolean);

  const location =
    ev.latitude != null && ev.longitude != null
      ? { latitude: ev.latitude, longitude: ev.longitude }
      : undefined;

  return {
    transportOrderNumber,
    status,
    statusText: bits.length ? bits.join(' · ').slice(0, 500) : undefined,
    statusDate: ev.eventAt || undefined,
    originalCode,
    deliveredTo: ev.deliveredTo,
    location,
    hasProof: Boolean(ev.signatureBase64 || ev.pictureBase64),
  };
}
