import {
  BadRequestException,
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AuditService } from '../audit/audit.service';
import { AuthUser } from '../auth/auth.types';

export type ShippingNetStatusResult = {
  ok: boolean;
  shipmentNumber: string;
  statusId: string;
  description?: string;
  statusDate: string;
  shippingNet: unknown;
};

@Injectable()
export class ShippingNetService {
  private readonly logger = new Logger(ShippingNetService.name);

  constructor(
    private config: ConfigService,
    private audit: AuditService,
  ) {}

  status() {
    return {
      enabled: this.isEnabled(),
      mode: this.config.get('SHIPPINGNET_MODE') || 'rest',
      publicApiBaseConfigured: Boolean(this.getPublicApiBase()),
      clientIdConfigured: Boolean(this.config.get('SHIPPINGNET_CLIENT_ID')),
      orgUnitIdConfigured: Boolean(this.config.get('SHIPPINGNET_ORG_UNIT_ID')),
      authTokenConfigured: Boolean(this.config.get('SHIPPINGNET_ORG_UNIT_GUID')),
    };
  }

  /** Setzt in shipping.NET den finalen Status DVD (Zugestellt). */
  async markDelivered(
    actor: AuthUser,
    shipmentNumber: string,
    opts: { description?: string; statusDate?: string } = {},
  ): Promise<ShippingNetStatusResult> {
    return this.importStatus(actor, shipmentNumber, 'DVD', {
      description: opts.description || 'Zugestellt',
      statusDate: opts.statusDate,
    });
  }

  async importStatus(
    actor: AuthUser,
    shipmentNumber: string,
    statusId: string,
    opts: { description?: string; statusDate?: string } = {},
  ): Promise<ShippingNetStatusResult> {
    const number = String(shipmentNumber || '').trim();
    if (!number) throw new BadRequestException('Sendungsnummer fehlt');
    if (!statusId?.trim()) throw new BadRequestException('StatusID fehlt');

    if (!this.isEnabled()) {
      throw new ServiceUnavailableException('shipping.NET Integration ist deaktiviert (SHIPPINGNET_ENABLED=false)');
    }

    const base = this.getPublicApiBase();
    if (!base) {
      throw new ServiceUnavailableException('SHIPPINGNET_PUBLIC_API_BASE ist nicht konfiguriert');
    }

    const statusDate = opts.statusDate || new Date().toISOString();
    const description = opts.description;
    const body = {
      ShipmentMatching: { Number: number },
      StatusData: {
        StatusID: statusId.trim(),
        ...(description ? { Description: description } : {}),
        StatusDate: statusDate,
      },
    };

    const url = `${base.replace(/\/$/, '')}/Shipment/importStatus`;
    this.logger.log(`shipping.NET importStatus ${statusId} for ${number}`);

    let shippingNet: unknown;
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...this.authHeaders(),
        },
        body: JSON.stringify(body),
      });
      const text = await res.text();
      shippingNet = text ? JSON.parse(text) : {};
      if (!res.ok) {
        const msg =
          (shippingNet as any)?.ExceptionMessage ||
          (shippingNet as any)?.message ||
          `shipping.NET Fehler ${res.status}`;
        throw new BadRequestException(msg);
      }
      if ((shippingNet as any)?.ExceptionMessage) {
        throw new BadRequestException((shippingNet as any).ExceptionMessage);
      }
    } catch (err: any) {
      if (err instanceof BadRequestException || err instanceof ServiceUnavailableException) throw err;
      this.logger.error(`shipping.NET call failed: ${err?.message || err}`);
      throw new ServiceUnavailableException(`shipping.NET nicht erreichbar: ${err?.message || err}`);
    }

    await this.audit.log(actor.id, 'shippingnet.status.import', 'Shipment', number, {
      statusId,
      description,
      statusDate,
    });

    return {
      ok: true,
      shipmentNumber: number,
      statusId: statusId.trim(),
      description,
      statusDate,
      shippingNet,
    };
  }

  /** Liest aktuelle Statusliste aus shipping.NET (zur Kontrolle). */
  async retrieveStatus(shipmentNumber: string) {
    const number = String(shipmentNumber || '').trim();
    if (!number) throw new BadRequestException('Sendungsnummer fehlt');
    if (!this.isEnabled()) {
      throw new ServiceUnavailableException('shipping.NET Integration ist deaktiviert');
    }
    const base = this.getPublicApiBase();
    if (!base) throw new ServiceUnavailableException('SHIPPINGNET_PUBLIC_API_BASE fehlt');

    const url = `${base.replace(/\/$/, '')}/Shipment/statusRetrieve`;
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...this.authHeaders(),
      },
      body: JSON.stringify({ ShipmentMatchingList: [{ Number: number }] }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new BadRequestException(data?.ExceptionMessage || `Fehler ${res.status}`);
    }
    return { ok: true, shipmentNumber: number, result: data };
  }

  private isEnabled() {
    const enabled = this.config.get('SHIPPINGNET_ENABLED');
    // Default: aktiv, sobald Credentials vorhanden sind
    if (enabled === 'false') return false;
    if (enabled === 'true') return true;
    return Boolean(
      this.getPublicApiBase() &&
        this.config.get('SHIPPINGNET_CLIENT_ID') &&
        this.config.get('SHIPPINGNET_ORG_UNIT_ID') &&
        this.config.get('SHIPPINGNET_ORG_UNIT_GUID'),
    );
  }

  private getPublicApiBase() {
    return (
      this.config.get('SHIPPINGNET_PUBLIC_API_BASE') ||
      (this.config.get('SHIPPINGNET_BASE_URL')
        ? `${String(this.config.get('SHIPPINGNET_BASE_URL')).replace(/\/$/, '')}/DataService/PublicApi/v1`
        : '')
    );
  }

  private authHeaders(): Record<string, string> {
    const clientId = this.config.get('SHIPPINGNET_CLIENT_ID');
    const orgUnitId = this.config.get('SHIPPINGNET_ORG_UNIT_ID');
    const guid = this.config.get('SHIPPINGNET_ORG_UNIT_GUID');
    const apiKey =
      this.config.get('SHIPPINGNET_API_KEY') ||
      (clientId && orgUnitId && guid ? `${clientId}:${orgUnitId}:${guid}` : '');

    if (!clientId || !orgUnitId || !guid) {
      throw new ServiceUnavailableException(
        'shipping.NET Credentials unvollständig (CLIENT_ID / ORG_UNIT_ID / ORG_UNIT_GUID)',
      );
    }

    return {
      'client-id': String(clientId),
      'orgunit-id': String(orgUnitId),
      'auth-token': String(guid),
      ...(apiKey ? { 'api-key': String(apiKey) } : {}),
    };
  }
}
