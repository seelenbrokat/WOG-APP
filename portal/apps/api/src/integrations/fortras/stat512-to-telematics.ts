/**
 * FORTRAS STAT512 Statuscodes → Soloplan TransportOrderStatus.
 * Code-Liste System Alliance / REL100 – erweiterbar nach erstem Live-Sample von BT Swiss.
 */

import type { OutTransportOrderStatus } from '../telematics-xml.builder';
import type { Stat512Q10 } from './stat512.parser';
import { primaryConsignmentNumber } from './stat512.parser';

export type MappedPartnerStatus = {
  transportOrderNumber: string;
  status: OutTransportOrderStatus['status'];
  statusText: string;
  statusDate?: Date;
  originalCode: string;
};

/**
 * Häufige SA-/FORTRAS-Statuscodes (3-stellig).
 * Unbekannte Codes → Other (Originalcode im Text).
 */
const CODE_MAP: Record<string, OutTransportOrderStatus['status']> = {
  // Abholung / Beladung
  '010': 'LoadingPlaceArrived',
  '020': 'LoadingStart',
  '030': 'LoadingFinished',
  '040': 'LoadingPlaceLeft',
  // Zustellung / Entladung
  '050': 'UnloadingPlaceArrived',
  '060': 'UnloadingStart',
  '070': 'UnloadingFinished',
  '080': 'UnloadingPlaceLeft',
  '090': 'Other', // Zustellhindernis / Ausnahme
  // alternative Nummernkreise (häufig in Netzen)
  '100': 'LoadingPlaceArrived',
  '110': 'LoadingFinished',
  '120': 'LoadingPlaceLeft',
  '200': 'Other', // Transit / Umschlag
  '210': 'Other',
  '300': 'UnloadingPlaceArrived',
  '310': 'UnloadingStart',
  '320': 'UnloadingFinished',
  '330': 'UnloadingPlaceLeft',
  '400': 'Other', // Ausnahme / Hindernis
};

function normalizeCode(raw: string): string {
  const s = String(raw || '').trim().toUpperCase();
  if (/^\d+$/.test(s)) return s.padStart(3, '0').slice(-3);
  return s;
}

export function mapStat512EventToTransportOrderStatus(ev: Stat512Q10): MappedPartnerStatus | null {
  const transportOrderNumber = primaryConsignmentNumber(ev);
  if (!transportOrderNumber) return null;

  const originalCode = normalizeCode(ev.statusCode);
  const status = CODE_MAP[originalCode] || 'Other';
  const bits = [
    originalCode ? `STAT ${originalCode}` : null,
    ev.additionalText || null,
    ev.nameOfAcknowledgingParty ? `Ack: ${ev.nameOfAcknowledgingParty}` : null,
  ].filter(Boolean);

  return {
    transportOrderNumber,
    status,
    statusText: bits.join(' · ').slice(0, 500),
    statusDate: ev.eventAt,
    originalCode,
  };
}
