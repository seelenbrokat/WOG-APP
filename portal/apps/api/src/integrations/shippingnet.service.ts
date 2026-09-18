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

export type ShippingNetDocumentResult = {
  ok: boolean;
  shipmentNumber: string;
  documentType: string;
  fileType: 'PDF' | 'PNG' | 'JPG';
  fileName: string;
  comment?: string;
  shippingNet: unknown;
};

/** shipping.NET Public API ShipmentDocumentType (OpenAPI). */
const SHIPPINGNET_DOCUMENT_TYPES = new Set([
  'AuthorizationForm',
  'CommercialInvoice',
  'CertificateOfOrigin',
  'ExportAccompanyingDocument',
  'ExportLicense',
  'ImportPermit',
  'OneTimeNAFTA/CO',
  'OtherDocument',
  'PowerOfAttorney',
  'PackingList',
  'SEDDocument',
  'ShippersLetterOfInstruction',
  'Declaration',
  'Waybill',
  'ADRDocument',
  'CustomsDocument',
  'ProformaInvoice',
  'DualUse',
  'DeliveryNote',
  'EUR.1MovementCertificate',
  'EUR.2MovementCertificate',
  'ATRDocument',
  'InvoiceThirdParty',
  'T1Document',
  'T2Document',
  'ConsularInvoice',
  'FumigationCertificate',
  'RadioLicense',
  'MaterialSafetyDataSheets',
  'Visa',
  'PickupDocument',
]);

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

  /**
   * Lädt einen Ablieferbeleg (POD) als Sendungsdokument nach shipping.NET.
   * Voraussetzung: Dokumenttyp in OnDot Systemkonfiguration aktiviert
   * (z. B. OtherDocument oder DeliveryNote) – sonst meldet die API „is not enabled“.
   */
  async uploadAblieferbeleg(
    actor: AuthUser,
    shipmentNumber: string,
    file: { buffer: Buffer; originalname?: string; mimetype?: string },
    opts: {
      documentType?: string;
      comment?: string;
      number?: string;
      markDelivered?: boolean;
      statusDate?: string;
    } = {},
  ): Promise<{ document: ShippingNetDocumentResult; delivered?: ShippingNetStatusResult }> {
    const documentType =
      opts.documentType?.trim() ||
      this.config.get('SHIPPINGNET_POD_DOCUMENT_TYPE') ||
      'DeliveryNote';
    if (!SHIPPINGNET_DOCUMENT_TYPES.has(documentType)) {
      throw new BadRequestException(
        `Ungültiger Dokumenttyp "${documentType}". Erlaubt: ${[...SHIPPINGNET_DOCUMENT_TYPES].join(', ')}`,
      );
    }

    const document = await this.addDocument(actor, shipmentNumber, file, {
      documentType,
      comment: opts.comment || 'Ablieferbeleg',
      number: opts.number || 'POD',
    });

    let delivered: ShippingNetStatusResult | undefined;
    if (opts.markDelivered) {
      delivered = await this.markDelivered(actor, shipmentNumber, {
        description: opts.comment || 'Zugestellt (mit Ablieferbeleg)',
        statusDate: opts.statusDate,
      });
    }

    return { document, delivered };
  }

  async addDocument(
    actor: AuthUser,
    shipmentNumber: string,
    file: { buffer: Buffer; originalname?: string; mimetype?: string },
    opts: { documentType: string; comment?: string; number?: string; documentDate?: string } = {
      documentType: 'OtherDocument',
    },
  ): Promise<ShippingNetDocumentResult> {
    const number = String(shipmentNumber || '').trim();
    if (!number) throw new BadRequestException('Sendungsnummer fehlt');
    if (!file?.buffer?.length) throw new BadRequestException('Datei fehlt');
    if (!this.isEnabled()) {
      throw new ServiceUnavailableException('shipping.NET Integration ist deaktiviert');
    }

    const base = this.getPublicApiBase();
    if (!base) {
      throw new ServiceUnavailableException('SHIPPINGNET_PUBLIC_API_BASE ist nicht konfiguriert');
    }

    const fileType = this.mapFileType(file.originalname, file.mimetype);
    const fileName = file.originalname || `ablieferbeleg.${fileType.toLowerCase()}`;
    const body = {
      ShipmentMatching: { Number: number },
      Document: {
        Type: opts.documentType,
        ...(opts.comment ? { Comment: opts.comment } : {}),
        ...(opts.number ? { Number: opts.number } : {}),
        ...(opts.documentDate ? { DocumentDate: opts.documentDate } : {}),
        File: {
          ContentBase64: file.buffer.toString('base64'),
          FileType: fileType,
        },
      },
    };

    const url = `${base.replace(/\/$/, '')}/Shipment/addDocument`;
    this.logger.log(`shipping.NET addDocument ${opts.documentType} for ${number} (${fileName})`);

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
        throw new BadRequestException(this.friendlyDocumentError(msg, opts.documentType));
      }
      if ((shippingNet as any)?.ExceptionMessage) {
        throw new BadRequestException(
          this.friendlyDocumentError((shippingNet as any).ExceptionMessage, opts.documentType),
        );
      }
    } catch (err: any) {
      if (err instanceof BadRequestException || err instanceof ServiceUnavailableException) throw err;
      this.logger.error(`shipping.NET addDocument failed: ${err?.message || err}`);
      throw new ServiceUnavailableException(`shipping.NET nicht erreichbar: ${err?.message || err}`);
    }

    await this.audit.log(actor.id, 'shippingnet.document.add', 'Shipment', number, {
      documentType: opts.documentType,
      fileType,
      fileName,
      comment: opts.comment,
    });

    return {
      ok: true,
      shipmentNumber: number,
      documentType: opts.documentType,
      fileType,
      fileName,
      comment: opts.comment,
      shippingNet,
    };
  }

  private mapFileType(fileName?: string, mimeType?: string): 'PDF' | 'PNG' | 'JPG' {
    const name = (fileName || '').toLowerCase();
    const mime = (mimeType || '').toLowerCase();
    if (name.endsWith('.png') || mime.includes('png')) return 'PNG';
    if (name.endsWith('.jpg') || name.endsWith('.jpeg') || mime.includes('jpeg') || mime.includes('jpg')) {
      return 'JPG';
    }
    if (name.endsWith('.pdf') || mime.includes('pdf') || !name) return 'PDF';
    throw new BadRequestException('Nur PDF, PNG oder JPG werden von shipping.NET unterstützt');
  }

  private friendlyDocumentError(message: string, documentType: string) {
    if (/not enabled/i.test(message)) {
      return (
        `${message}. In shipping.NET unter Systemkonfiguration den Dokumenttyp ` +
        `"${documentType}" aktivieren, oder SHIPPINGNET_POD_DOCUMENT_TYPE auf einen ` +
        `aktivierten Typ setzen (siehe docs/SHIPPINGNET_STATUS.md).`
      );
    }
    return message;
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
