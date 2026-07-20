import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { SHIPMENT_STATUS_LABELS, ShipmentStatus } from '@wog/shared';
import { WogApiClient, errorResult, jsonResult } from '../client.js';

const statusEnum = z.enum([
  ShipmentStatus.DRAFT,
  ShipmentStatus.SUBMITTED,
  ShipmentStatus.ACCEPTED,
  ShipmentStatus.PICKED_UP,
  ShipmentStatus.IN_TRANSIT,
  ShipmentStatus.OUT_FOR_DELIVERY,
  ShipmentStatus.DELIVERED,
  ShipmentStatus.EXCEPTION,
  ShipmentStatus.CANCELLED,
]);

export function registerStatusTools(server: McpServer, client: WogApiClient) {
  server.registerTool(
    'wog_whoami',
    {
      title: 'Angemeldeter Benutzer',
      description: 'Zeigt den aktuell angemeldeten WOG-Portal-Benutzer (Rolle, Kunde, Organisation).',
      inputSchema: {},
    },
    async () => {
      try {
        const user = await client.whoami();
        return jsonResult({ api: client.getApiUrl(), user });
      } catch (err) {
        return errorResult(err);
      }
    },
  );

  server.registerTool(
    'wog_list_shipments',
    {
      title: 'Sendungen auflisten',
      description:
        'Listet Sendungen des Portals inkl. Status, Tracking-Nummer und Referenz. Optional nach Mandant filtern.',
      inputSchema: {
        mandantId: z.string().optional().describe('Mandanten-ID zum Filtern'),
      },
    },
    async ({ mandantId }) => {
      try {
        const q = mandantId ? `?mandantId=${encodeURIComponent(mandantId)}` : '';
        const shipments = await client.request<any[]>('GET', `/shipments${q}`);
        const summary = shipments.map((s) => ({
          id: s.id,
          trackingNumber: s.trackingNumber,
          reference: s.reference,
          status: s.status,
          statusLabel: SHIPMENT_STATUS_LABELS[s.status as ShipmentStatus] || s.status,
          packageCount: s.packageCount,
          weightKg: s.weightKg,
          pickupCity: s.pickupCity,
          deliveryCity: s.deliveryCity,
          orderExternalNumber: s.order?.externalNumber,
          updatedAt: s.updatedAt,
        }));
        return jsonResult({ count: summary.length, shipments: summary });
      } catch (err) {
        return errorResult(err);
      }
    },
  );

  server.registerTool(
    'wog_get_shipment',
    {
      title: 'Sendungsdetail',
      description:
        'Holt eine Sendung inkl. Status-Events, Colli, Zusatzinfos (extras), Avis-Telefon und Auftrag.',
      inputSchema: {
        shipmentId: z.string().describe('Sendungs-ID (cuid)'),
      },
    },
    async ({ shipmentId }) => {
      try {
        const s = await client.request<any>('GET', `/shipments/${shipmentId}`);
        return jsonResult({
          ...s,
          statusLabel: SHIPMENT_STATUS_LABELS[s.status as ShipmentStatus] || s.status,
        });
      } catch (err) {
        return errorResult(err);
      }
    },
  );

  server.registerTool(
    'wog_track',
    {
      title: 'Öffentliches Tracking',
      description:
        'Sendungsstatus per Tracking-Nummer und optional PIN (öffentlicher Endpoint, keine Login-Rechte nötig für die Abfrage selbst; Auth wird trotzdem genutzt wenn gesetzt).',
      inputSchema: {
        trackingNumber: z.string().describe('Tracking-Nummer, z. B. WOG2607…'),
        pin: z.string().optional().describe('Tracking-PIN (4-stellig)'),
      },
    },
    async ({ trackingNumber, pin }) => {
      try {
        const params = new URLSearchParams({ tn: trackingNumber });
        if (pin) params.set('pin', pin);
        // Tracking ist @Public – ohne Auth-Header
        const url = `${client.getApiUrl()}/tracking?${params.toString()}`;
        const res = await fetch(url, { headers: { Accept: 'application/json' } });
        const data = await res.json();
        if (!res.ok) {
          return errorResult(new Error(typeof data?.message === 'string' ? data.message : `HTTP ${res.status}`));
        }
        return jsonResult(data);
      } catch (err) {
        return errorResult(err);
      }
    },
  );

  server.registerTool(
    'wog_update_shipment_status',
    {
      title: 'Status setzen',
      description:
        'Setzt den Sendungsstatus (nur Dispo/Admin: ORG_ADMIN, MANDANT_DISPATCHER).',
      inputSchema: {
        shipmentId: z.string(),
        status: statusEnum.describe('Neuer Status'),
        message: z.string().optional().describe('Statusmeldung'),
        location: z.string().optional().describe('Ort / Standort'),
      },
    },
    async ({ shipmentId, status, message, location }) => {
      try {
        const updated = await client.request('PATCH', `/shipments/${shipmentId}/status`, {
          status,
          message,
          location,
        });
        return jsonResult(updated);
      } catch (err) {
        return errorResult(err);
      }
    },
  );

  server.registerTool(
    'wog_list_orders',
    {
      title: 'Aufträge (VLB) auflisten',
      description: 'Listet Transportaufträge (VLB-Nummern). openOnly=true nur offene Aufträge.',
      inputSchema: {
        customerId: z.string().optional(),
        openOnly: z.boolean().optional().describe('Nur offene Aufträge (default false)'),
      },
    },
    async ({ customerId, openOnly }) => {
      try {
        const params = new URLSearchParams();
        if (customerId) params.set('customerId', customerId);
        if (openOnly) params.set('openOnly', 'true');
        const q = params.toString() ? `?${params}` : '';
        const orders = await client.request('GET', `/orders${q}`);
        return jsonResult(orders);
      } catch (err) {
        return errorResult(err);
      }
    },
  );

  server.registerTool(
    'wog_get_order',
    {
      title: 'Auftragsdetail',
      description: 'Holt einen Transportauftrag inkl. zugehöriger Sendungen.',
      inputSchema: {
        orderId: z.string(),
      },
    },
    async ({ orderId }) => {
      try {
        const order = await client.request('GET', `/orders/${orderId}`);
        return jsonResult(order);
      } catch (err) {
        return errorResult(err);
      }
    },
  );

  server.registerTool(
    'wog_status_labels',
    {
      title: 'Status-Labels',
      description: 'Liste aller möglichen Sendungsstatus mit deutschen Bezeichnungen.',
      inputSchema: {},
    },
    async () => jsonResult(SHIPMENT_STATUS_LABELS),
  );
}
