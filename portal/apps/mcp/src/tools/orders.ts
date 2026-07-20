import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import {
  PACKAGING_TYPES,
  SHIPMENT_EXTRA_OPTIONS,
  shipmentExtrasLabels,
  type ShipmentExtras,
} from '@wog/shared';
import { WogApiClient, errorResult, jsonResult } from '../client.js';

const positionSchema = z.object({
  description: z.string().describe('Inhalt / Packstückbeschreibung'),
  quantity: z.number().int().min(1).optional().describe('Anzahl gleichartiger Colli (default 1)'),
  packaging: z.string().optional().describe('Verpackungscode, z. B. EUP, KRT'),
  weightKg: z.number().optional().describe('Gewicht in kg (bei quantity>1 = Gesamtgewicht)'),
  lengthCm: z.number().optional(),
  widthCm: z.number().optional(),
  heightCm: z.number().optional(),
  sscc: z.string().optional(),
});

const extrasSchema = z
  .record(z.union([z.boolean(), z.number(), z.string(), z.null()]))
  .optional()
  .describe(
    'Zusatzflags, z. B. { hebebuehneZustellung: true, smsAviso: true, gefahrgut: true, warenwertVersicherung: true, goodsValueEur: 15000 }. Codes via wog_list_extra_options.',
  );

export function registerOrderTools(server: McpServer, client: WogApiClient) {
  server.registerTool(
    'wog_list_mandanten',
    {
      title: 'Mandanten',
      description: 'Listet verfügbare Mandanten (WOG AG / GmbH) für die Auftragserfassung.',
      inputSchema: {},
    },
    async () => {
      try {
        const mandanten = await client.request('GET', '/mandanten');
        return jsonResult(mandanten);
      } catch (err) {
        return errorResult(err);
      }
    },
  );

  server.registerTool(
    'wog_list_addresses',
    {
      title: 'Adressbuch',
      description: 'Adressen des angemeldeten Kunden (Abholung/Zustellung).',
      inputSchema: {
        customerId: z
          .string()
          .optional()
          .describe('Nur für Dispo/Admin: Kunden-ID; Kunden nutzen /me automatisch'),
      },
    },
    async ({ customerId }) => {
      try {
        const path = customerId
          ? `/customers/${customerId}/addresses`
          : '/customers/me/addresses';
        const addresses = await client.request('GET', path);
        return jsonResult(addresses);
      } catch (err) {
        return errorResult(err);
      }
    },
  );

  server.registerTool(
    'wog_list_templates',
    {
      title: 'Auftragsvorlagen',
      description: 'Gespeicherte Sendungsvorlagen zum Vorausfüllen neuer Aufträge.',
      inputSchema: {
        customerId: z.string().optional(),
      },
    },
    async ({ customerId }) => {
      try {
        const path = customerId
          ? `/customers/${customerId}/templates`
          : '/customers/me/templates';
        const templates = await client.request('GET', path);
        return jsonResult(templates);
      } catch (err) {
        return errorResult(err);
      }
    },
  );

  server.registerTool(
    'wog_list_packaging_types',
    {
      title: 'Verpackungsarten',
      description: 'Erlaubte Verpackungscodes für Colli (EUP, KRT, …).',
      inputSchema: {},
    },
    async () => jsonResult(PACKAGING_TYPES),
  );

  server.registerTool(
    'wog_list_extra_options',
    {
      title: 'Zusatzoptionen',
      description:
        'Checkbox-Codes für Zusatzinformationen (Hebebühne, Aviso, Gefahrgut, Versicherung, …).',
      inputSchema: {},
    },
    async () => jsonResult(SHIPMENT_EXTRA_OPTIONS),
  );

  server.registerTool(
    'wog_create_shipment',
    {
      title: 'Auftrag / Sendung anlegen',
      description:
        'Erfasst eine neue Sendung (optional an bestehenden VLB-Auftrag). Unterstützt Colli/Positionen, Avis-Telefon und Zusatzinformationen. Standardmäßig wird übermittelt (submit=true).',
      inputSchema: {
        mandantId: z.string().describe('Mandanten-ID (siehe wog_list_mandanten)'),
        orderId: z
          .string()
          .optional()
          .describe('Bestehenden Auftrag nutzen; sonst neue VLB-Nummer'),
        customerId: z.string().optional().describe('Pflicht für Dispo/Admin'),
        reference: z.string().optional(),
        transportMode: z.string().optional().describe('z. B. LKW'),
        goodsDescription: z.string().optional(),
        packageCount: z.number().int().min(1).optional(),
        weightKg: z.number().optional(),
        volumeM3: z.number().optional(),
        pickupCompany: z.string().optional(),
        pickupStreet: z.string().optional(),
        pickupZip: z.string().optional(),
        pickupCity: z.string().optional(),
        pickupCountry: z.string().optional().describe('ISO-Land, default AT'),
        pickupDate: z.string().optional().describe('ISO-Datum'),
        pickupAddressId: z.string().optional(),
        deliveryCompany: z.string().optional(),
        deliveryStreet: z.string().optional(),
        deliveryZip: z.string().optional(),
        deliveryCity: z.string().optional(),
        deliveryCountry: z.string().optional(),
        deliveryDate: z.string().optional(),
        deliveryAddressId: z.string().optional(),
        deliveryAvisPhone: z
          .string()
          .optional()
          .describe('Telefonnummer für Zustell-Aviso'),
        notes: z.string().optional(),
        extras: extrasSchema,
        positions: z
          .array(positionSchema)
          .optional()
          .describe('Colli/Positionen; bei quantity>1 werden Colli aufgeteilt'),
        submit: z
          .boolean()
          .optional()
          .describe('true = übermitteln (default), false = Entwurf'),
        savePickupAddress: z.boolean().optional(),
        saveDeliveryAddress: z.boolean().optional(),
        saveAsTemplateName: z.string().optional().describe('Als Vorlage speichern'),
      },
    },
    async (input) => {
      try {
        const extras = input.extras as ShipmentExtras | undefined;
        const created = await client.request<any>('POST', '/shipments', {
          ...input,
          submit: input.submit !== false,
          transportMode: input.transportMode || 'LKW',
          pickupCountry: input.pickupCountry || 'AT',
          deliveryCountry: input.deliveryCountry || 'AT',
        });
        return jsonResult({
          id: created.id,
          trackingNumber: created.trackingNumber,
          trackingPin: created.trackingPin,
          status: created.status,
          orderId: created.orderId,
          orderExternalNumber: created.order?.externalNumber,
          deliveryAvisPhone: created.deliveryAvisPhone,
          extras: created.extras,
          extrasLabels: shipmentExtrasLabels(created.extras as ShipmentExtras),
          packageCount: created.packageCount,
          weightKg: created.weightKg,
          message: `Sendung ${created.trackingNumber} angelegt (${created.status}).`,
        });
      } catch (err) {
        return errorResult(err);
      }
    },
  );
}
