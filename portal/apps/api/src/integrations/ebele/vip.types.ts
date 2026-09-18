/** VIP eLogistics (BDK) – Auftragskopf / Ladegut / Status (ohne Preise). */

export type VipAddress = {
  name?: string;
  name2?: string;
  street?: string;
  country?: string;
  zip?: string;
  city?: string;
  phone?: string;
  contactName?: string;
};

export type VipGoodsLine = {
  /** Positionsnummer (LPOS), 1-basiert */
  position: number;
  articleNumber?: string;
  quantity?: number;
  /** Einheit z. B. Pal, Col, Stk – Absprache mit Transporteur */
  unit?: string;
  lengthCm?: number;
  widthCm?: number;
  heightCm?: number;
  content?: string;
  weightKg?: number;
  volumeM3?: number;
  packaging?: string;
  barcodeNve?: string;
  dangerousGoods?: boolean;
};

export type VipShipmentInput = {
  /** Verlader-Auftragsnr (AUFTNR) – eindeutig! */
  orderNumber: string;
  /** Lieferschein / Referenz (LSR) */
  deliveryNote?: string;
  orderDate?: Date;
  loadingFrom?: Date;
  loadingUntil?: Date;
  unloadingFrom?: Date;
  unloadingUntil?: Date;
  loadingRemark1?: string;
  loadingRemark2?: string;
  unloadingRemark1?: string;
  unloadingRemark2?: string;
  sender: VipAddress;
  receiver: VipAddress;
  palletCount?: number;
  loadingMeter?: number;
  storagePlaces?: number;
  goods: VipGoodsLine[];
};

export type VipBuildOptions = {
  /** Auftraggebernummer (ANR) – vom VIP/ebele zugeteilt */
  anr: string;
  /** CRLF laut Spec */
  lineEnding?: '\r\n' | '\n';
};

export type VipStatusEvent = {
  anr?: string;
  statusCode: string;
  eventAt?: Date;
  /** Feld 5 – oft interne/AUFTNR-Referenz */
  ref1?: string;
  /** Feld 6 – weitere Referenz */
  ref2?: string;
  /** Feld 7 – Lieferschein / LSR */
  deliveryNote?: string;
  rawLine: string;
};
