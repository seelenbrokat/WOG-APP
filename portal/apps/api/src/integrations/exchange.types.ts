/**
 * Kanonisches Austauschformat zwischen Soloplan, LDV und Mercurio.
 * Systemspezifische Mapping-Details folgen mit der Vendor-Doku.
 */
export type CustomsExchangePayload = {
  exchangeVersion: '1.0';
  reference: string;
  sourceSystem: 'SOLOPLAN' | 'LDV' | 'MERCURIO';
  targetSystem: 'SOLOPLAN' | 'LDV' | 'MERCURIO';
  kennzeichen?: string;
  grenzuebergang?: string;
  zeit?: string;
  importeur?: string;
  customsOrderId?: string;
  shipmentTrackingNumber?: string;
  shipmentId?: string;
  mandantCode?: string;
  customerNumber?: string;
  status?: string;
  notes?: string;
  /** CH/AT Zollreferenzen, falls vom Quellsystem geliefert */
  mrn?: string;
  lrn?: string;
  orderNumber?: string;
  consignmentIndex?: number;
  /** Rohdaten des Quellsystems bis Mapping finalisiert ist */
  raw?: Record<string, unknown>;
};

export interface CustomsSystemAdapter {
  readonly system: 'SOLOPLAN' | 'LDV' | 'MERCURIO';
  send(payload: CustomsExchangePayload): Promise<{ ok: boolean; fileName?: string; response?: unknown; message?: string }>;
  receiveInbound(): Promise<CustomsExchangePayload[]>;
}
