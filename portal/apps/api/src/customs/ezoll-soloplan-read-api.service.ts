import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

export type EzollApiBusinessPartner = {
  number: number | null;
  matchcode: string | null;
  name1: string | null;
};

export type EzollApiConsignment = {
  ordernumber: number;
  itemNumber: number;
  externalNumber: string | null;
  cC529C?: boolean;
  cC599C?: boolean;
  mRNATAPI?: string | null;
  lRN?: string | null;
  sender?: { masterDataBusinessPartner?: EzollApiBusinessPartner; name1?: string };
  receiver?: { masterDataBusinessPartner?: EzollApiBusinessPartner; name1?: string };
  raw: Record<string, unknown>;
};

export type EzollApiOrder = {
  number: number;
  externalNumber: string | null;
  freightPayer: EzollApiBusinessPartner | null;
  customer: EzollApiBusinessPartner | null;
  consignments: EzollApiConsignment[];
  raw: Record<string, unknown>;
};

/**
 * Soloplan CarLo REST: OrderEzoll_NurLesen (portal.worldofgreen.at).
 * Nur Lesen – Auth via X-API-KEY.
 */
@Injectable()
export class EzollSoloplanReadApiService {
  private readonly log = new Logger(EzollSoloplanReadApiService.name);
  private readonly baseUrl: string;
  private readonly apiKey: string;
  private readonly apiName: string;
  private readonly enabled: boolean;

  constructor(private config: ConfigService) {
    this.baseUrl = String(
      this.config.get('SOLOPLAN_EZOLL_API_BASE_URL') ||
        'https://portal.worldofgreen.at',
    ).replace(/\/$/, '');
    this.apiKey = String(this.config.get('SOLOPLAN_EZOLL_API_KEY') || '').trim();
    this.apiName = String(
      this.config.get('SOLOPLAN_EZOLL_API_NAME') || 'OrderEzoll_NurLesen',
    ).trim();
    this.enabled =
      this.config.get('SOLOPLAN_EZOLL_API_ENABLED') !== 'false' && !!this.apiKey;
  }

  isEnabled(): boolean {
    return this.enabled;
  }

  /** Sendung per Auftragsnummer (+ optional Position). */
  async getConsignmentByOrderNumber(
    orderNumber: number,
    itemNumber?: number,
  ): Promise<EzollApiConsignment | null> {
    if (!this.enabled) return null;
    let filter = `145004/500410 eq ${orderNumber}`;
    if (itemNumber != null && itemNumber > 0) {
      filter += ` and 145002 eq ${itemNumber}`;
    }
    const json = await this.getJson<{ consignment?: unknown[] }>(
      `/api/${this.apiName}/v5/Consignment/0`,
      filter,
    );
    const list = Array.isArray(json?.consignment) ? json.consignment : [];
    if (!list.length) return null;
    return this.mapConsignment(list[0] as Record<string, unknown>);
  }

  /** Auftrag inkl. Frachtzahler / Kunde. */
  async getOrderByNumber(orderNumber: number): Promise<EzollApiOrder | null> {
    if (!this.enabled) return null;
    const json = await this.getJson<{ order?: unknown[] }>(
      `/api/${this.apiName}/v5/Order/0`,
      `500410 eq ${orderNumber}`,
    );
    const list = Array.isArray(json?.order) ? json.order : [];
    if (!list.length) return null;
    return this.mapOrder(list[0] as Record<string, unknown>);
  }

  /**
   * Frachtzahler-BP: zuerst Order.freightPayer, sonst Order.customer.
   * Für Austritts-PDF (Kunde = Frachtzahler).
   */
  async resolveFreightPayerBp(
    orderNumber: number,
  ): Promise<{ bpNumber: string; name: string | null; source: string } | null> {
    if (!this.enabled) return null;
    try {
      const order = await this.getOrderByNumber(orderNumber);
      if (!order) {
        this.log.debug(`OrderEzoll API: Auftrag ${orderNumber} nicht gefunden`);
        return null;
      }
      const fp = order.freightPayer;
      if (fp?.number) {
        return {
          bpNumber: String(fp.number),
          name: fp.name1 || fp.matchcode,
          source: 'api.freightPayer',
        };
      }
      const cust = order.customer;
      if (cust?.number) {
        return {
          bpNumber: String(cust.number),
          name: cust.name1 || cust.matchcode,
          source: 'api.customer',
        };
      }
      return null;
    } catch (e: any) {
      this.log.warn(
        `OrderEzoll API Frachtzahler ${orderNumber}: ${e?.message || e}`,
      );
      return null;
    }
  }

  private async getJson<T>(path: string, filter: string): Promise<T | null> {
    const url = new URL(`${this.baseUrl}${path}`);
    url.searchParams.set('$filter', filter);
    url.searchParams.set('$top', '5');

    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 20_000);
    try {
      const res = await fetch(url.toString(), {
        method: 'GET',
        headers: {
          Accept: 'application/json',
          'X-API-KEY': this.apiKey,
        },
        signal: ctrl.signal,
      });
      if (!res.ok) {
        const text = await res.text().catch(() => '');
        throw new Error(`HTTP ${res.status}: ${text.slice(0, 200)}`);
      }
      return (await res.json()) as T;
    } finally {
      clearTimeout(timer);
    }
  }

  private mapBp(raw: unknown): EzollApiBusinessPartner | null {
    if (!raw || typeof raw !== 'object') return null;
    const o = raw as Record<string, unknown>;
    const md = (o.masterDataBusinessPartner || o) as Record<string, unknown>;
    const number = md.number != null ? Number(md.number) : null;
    return {
      number: Number.isFinite(number as number) ? (number as number) : null,
      matchcode: md.matchcode != null ? String(md.matchcode) : null,
      name1: md.name1 != null ? String(md.name1) : o.name1 != null ? String(o.name1) : null,
    };
  }

  private mapConsignment(raw: Record<string, unknown>): EzollApiConsignment {
    return {
      ordernumber: Number(raw.ordernumber || 0),
      itemNumber: Number(raw.itemNumber || raw.number || 1),
      externalNumber: raw.externalNumber != null ? String(raw.externalNumber) : null,
      cC529C: raw.cC529C === true,
      cC599C: raw.cC599C === true,
      mRNATAPI: raw.mRNATAPI != null ? String(raw.mRNATAPI) : null,
      lRN: raw.lRN != null ? String(raw.lRN) : null,
      sender: raw.sender as EzollApiConsignment['sender'],
      receiver: raw.receiver as EzollApiConsignment['receiver'],
      raw,
    };
  }

  private mapOrder(raw: Record<string, unknown>): EzollApiOrder {
    const consignmentsRaw = Array.isArray(raw.consignments)
      ? (raw.consignments as Record<string, unknown>[])
      : [];
    return {
      number: Number(raw.number || 0),
      externalNumber: raw.externalNumber != null ? String(raw.externalNumber) : null,
      freightPayer: this.mapBp(raw.freightPayer),
      customer: this.mapBp(raw.customer),
      consignments: consignmentsRaw.map((c) => this.mapConsignment(c)),
      raw,
    };
  }
}
