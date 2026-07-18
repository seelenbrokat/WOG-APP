'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { AppShell } from '@/components/AppShell';
import { api, getToken, getUser, statusLabel } from '@/lib/api';

const STATUSES = [
  'ACCEPTED', 'PICKED_UP', 'IN_TRANSIT', 'OUT_FOR_DELIVERY', 'DELIVERED', 'EXCEPTION', 'CANCELLED',
];

export default function ShipmentDetailPage() {
  const params = useParams<{ id: string }>();
  const [shipment, setShipment] = useState<any>(null);
  const [status, setStatus] = useState('IN_TRANSIT');
  const [message, setMessage] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const user = getUser();

  async function load() {
    setShipment(await api(`/shipments/${params.id}`));
  }

  useEffect(() => {
    load().catch(console.error);
  }, [params.id]);

  if (!shipment) return <AppShell title="Sendung">Laden…</AppShell>;

  const canDispatch = user?.role === 'ORG_ADMIN' || user?.role === 'MANDANT_DISPATCHER';

  return (
    <AppShell title={`Sendung ${shipment.trackingNumber}`}>
      <div className="grid-2">
        <div className="panel stack">
          <div className="row">
            <span className="badge ok">{statusLabel(shipment.status)}</span>
            <span className="muted">{shipment.mandant?.name}</span>
          </div>
          <div><strong>Kunde:</strong> {shipment.customer?.name}</div>
          <div><strong>Referenz:</strong> {shipment.reference || '–'}</div>
          <div><strong>PIN:</strong> {shipment.trackingPin || '–'}</div>
          <div className="grid-2">
            <div>
              <strong>Abholung</strong>
              <div className="muted">{shipment.pickupCompany}</div>
              <div className="muted">{shipment.pickupStreet}</div>
              <div className="muted">{shipment.pickupZip} {shipment.pickupCity}</div>
            </div>
            <div>
              <strong>Zustellung</strong>
              <div className="muted">{shipment.deliveryCompany}</div>
              <div className="muted">{shipment.deliveryStreet}</div>
              <div className="muted">{shipment.deliveryZip} {shipment.deliveryCity}</div>
            </div>
          </div>
          {canDispatch && (
            <div className="stack" style={{ borderTop: '1px solid var(--line)', paddingTop: '1rem' }}>
              <strong>Status aktualisieren</strong>
              <select value={status} onChange={(e) => setStatus(e.target.value)}>
                {STATUSES.map((s) => <option key={s} value={s}>{statusLabel(s)}</option>)}
              </select>
              <input placeholder="Nachricht" value={message} onChange={(e) => setMessage(e.target.value)} />
              <button
                className="btn btn-secondary"
                onClick={async () => {
                  await api(`/shipments/${shipment.id}/status`, {
                    method: 'PATCH',
                    body: JSON.stringify({ status, message }),
                  });
                  await load();
                }}
              >
                Speichern
              </button>
              <button
                className="btn btn-ghost"
                onClick={async () => {
                  await api(`/documents/ablieferbeleg/${shipment.id}`, { method: 'POST' });
                  await load();
                }}
              >
                Ablieferbeleg erzeugen
              </button>
            </div>
          )}
        </div>
        <div className="stack">
          <div className="panel">
            <strong>Track & Trace</strong>
            <ul className="timeline" style={{ marginTop: '1rem' }}>
              {shipment.events?.map((e: any) => (
                <li key={e.id}>
                  <div><strong>{statusLabel(e.status)}</strong></div>
                  <div className="muted">{e.message}</div>
                  <div className="muted" style={{ fontSize: '0.8rem' }}>{new Date(e.createdAt).toLocaleString('de-AT')}</div>
                </li>
              ))}
            </ul>
          </div>
          <div className="panel stack">
            <strong>Dokumente</strong>
            {shipment.documents?.map((d: any) => (
              <div className="row" key={d.id} style={{ justifyContent: 'space-between' }}>
                <span>{d.fileName} <span className="badge">{d.type}</span></span>
                <a
                  href={`${process.env.NEXT_PUBLIC_API_URL || '/api'}/documents/${d.id}/download`}
                  onClick={(e) => {
                    e.preventDefault();
                    fetch(`${process.env.NEXT_PUBLIC_API_URL || '/api'}/documents/${d.id}/download`, {
                      headers: { Authorization: `Bearer ${getToken()}` },
                    })
                      .then((r) => r.blob())
                      .then((blob) => {
                        const url = URL.createObjectURL(blob);
                        const a = document.createElement('a');
                        a.href = url;
                        a.download = d.fileName;
                        a.click();
                      });
                  }}
                >
                  Download
                </a>
              </div>
            ))}
            <input type="file" onChange={(e) => setFile(e.target.files?.[0] || null)} />
            <button
              className="btn btn-primary"
              disabled={!file}
              onClick={async () => {
                if (!file) return;
                const fd = new FormData();
                fd.append('file', file);
                await api(`/documents/upload?shipmentId=${shipment.id}`, {
                  method: 'POST',
                  body: fd,
                });
                setFile(null);
                await load();
              }}
            >
              Dokument an WOG senden
            </button>
          </div>
        </div>
      </div>
    </AppShell>
  );
}
