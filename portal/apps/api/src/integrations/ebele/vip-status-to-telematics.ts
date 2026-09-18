/**
 * VIP Statuscodes (gpANLAGE) → Soloplan TransportOrderStatus.
 *
 * B001-G0030  Sendung abgeholt
 * B001-G0031  Sendung ausgeliefert (beendet)
 */
import type { OutTransportOrderStatus } from '../telematics-xml.builder';
import type { VipStatusEvent } from './vip.types';
import { vipStatusMatchKeys } from './vip-status.parser';

export type MappedVipStatus = {
  transportOrderNumber: string;
  status: OutTransportOrderStatus['status'];
  statusText?: string;
  statusDate?: Date;
  originalCode: string;
  /** Ausgeliefert → POD erwarten / möglich */
  delivered: boolean;
  matchKeys: string[];
};

function normalizeCode(raw: string): string {
  return String(raw || '')
    .trim()
    .toUpperCase()
    .replace(/\s+/g, '');
}

const CODE_MAP: Record<string, OutTransportOrderStatus['status']> = {
  'B001-G0030': 'LoadingFinished',
  G0030: 'LoadingFinished',
  'B001-G0031': 'UnloadingFinished',
  G0031: 'UnloadingFinished',
};

const CODE_LABEL: Record<string, string> = {
  'B001-G0030': 'Sendung abgeholt',
  G0030: 'Sendung abgeholt',
  'B001-G0031': 'Sendung ausgeliefert',
  G0031: 'Sendung ausgeliefert',
};

export function mapVipStatusToTransportOrderStatus(ev: VipStatusEvent): MappedVipStatus | null {
  const code = normalizeCode(ev.statusCode);
  if (!code) return null;
  const matchKeys = vipStatusMatchKeys(ev);
  const transportOrderNumber = matchKeys[0];
  if (!transportOrderNumber) return null;

  const status = CODE_MAP[code] || 'Other';
  const label = CODE_LABEL[code];
  const delivered = status === 'UnloadingFinished';

  return {
    transportOrderNumber,
    status,
    statusText: [`VIP ${code}`, label].filter(Boolean).join(' · ').slice(0, 500),
    statusDate: ev.eventAt,
    originalCode: code,
    delivered,
    matchKeys,
  };
}
