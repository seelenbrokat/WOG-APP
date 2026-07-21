'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import { AppShell } from '@/components/AppShell';
import { api } from '@/lib/api';

type TourDetail = {
  id: string;
  tourNumber: string;
  status: string;
  lastAction: string | null;
  caption: string | null;
  infoText: string | null;
  driverName: string | null;
  driverFirstName: string | null;
  driverLastName: string | null;
  dispatcherName: string | null;
  dispatcherEmail: string | null;
  dispatcherPhone: string | null;
  targetStart: string | null;
  targetEnd: string | null;
  targetLoadKm: number | null;
  lastSendDate: string | null;
  lastFileName: string | null;
  vehicle: {
    id: string;
    number: string | null;
    licensePlate: string | null;
    matchcode: string | null;
  } | null;
  stops: Array<{
    id: string;
    sequence: number;
    stopType: string | null;
    transportOrderNumber: string | null;
    name: string | null;
    street: string | null;
    zip: string | null;
    city: string | null;
    country: string | null;
    phone: string | null;
    targetStart: string | null;
    targetEnd: string | null;
    activityDescription: string | null;
  }>;
  consignments: Array<{
    id: string;
    soloplanOrderNumber: string;
    externalConsignmentNumber: string | null;
    senderName: string | null;
    senderBpNumber: string | null;
    receiverName: string | null;
  }>;
};

const TOUR_STATUS: Record<string, string> = {
  PLANNED: 'Geplant',
  ACTIVE: 'Aktiv',
  COMPLETED: 'Abgeschlossen',
  CANCELLED: 'Storniert',
};

function fmt(value?: string | null) {
  if (!value) return '—';
  return new Date(value).toLocaleString('de-CH', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function stopTypeLabel(t?: string | null) {
  if (!t) return '—';
  const lower = t.toLowerCase();
  if (lower.includes('load') || lower.includes('belad')) return 'Beladung';
  if (lower.includes('unload') || lower.includes('entlad')) return 'Entladung';
  return t;
}

export default function TourDetailPage() {
  const params = useParams<{ id: string }>();
  const [tour, setTour] = useState<TourDetail | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!params.id) return;
    void api<TourDetail>(`/tours/${params.id}`)
      .then(setTour)
      .catch((e: any) => setError(e.message || 'Laden fehlgeschlagen'));
  }, [params.id]);

  if (error) {
    return (
      <AppShell title="Tour">
        <p>
          <Link href="/tours">← Touren</Link>
        </p>
        <div className="error">{error}</div>
      </AppShell>
    );
  }

  if (!tour) {
    return (
      <AppShell title="Tour">
        <p className="muted">Laden…</p>
      </AppShell>
    );
  }

  return (
    <AppShell title={`Tour ${tour.tourNumber}`}>
      <p style={{ marginBottom: '1rem' }}>
        <Link href="/tours">← Touren</Link>
      </p>

      <div className="grid-3" style={{ marginBottom: '1rem' }}>
        <div className="stat">
          <div className="label">Status</div>
          <div className="value" style={{ fontSize: '1.15rem' }}>
            {TOUR_STATUS[tour.status] || tour.status}
          </div>
          {tour.lastAction ? <div className="muted">letzte Aktion: {tour.lastAction}</div> : null}
        </div>
        <div className="stat">
          <div className="label">Fahrzeug</div>
          <div className="value" style={{ fontSize: '1.15rem' }}>
            {tour.vehicle?.licensePlate || tour.vehicle?.number || '—'}
          </div>
          <div className="muted">
            {[tour.vehicle?.number, tour.vehicle?.matchcode].filter(Boolean).join(' · ') || '—'}
          </div>
        </div>
        <div className="stat">
          <div className="label">Fahrer / Disponent</div>
          <div className="value" style={{ fontSize: '1.15rem' }}>
            {tour.driverName || '—'}
          </div>
          <div className="muted">{tour.dispatcherName || '—'}</div>
        </div>
      </div>

      <div className="panel" style={{ marginBottom: '1rem' }}>
        <div className="row" style={{ flexWrap: 'wrap', gap: '1.5rem' }}>
          <div>
            <div className="muted">Ziel-Start</div>
            <strong>{fmt(tour.targetStart)}</strong>
          </div>
          <div>
            <div className="muted">Ziel-Ende</div>
            <strong>{fmt(tour.targetEnd)}</strong>
          </div>
          <div>
            <div className="muted">km (Soll)</div>
            <strong>{tour.targetLoadKm ?? '—'}</strong>
          </div>
          <div>
            <div className="muted">Letzter Import</div>
            <strong>{fmt(tour.lastSendDate)}</strong>
            {tour.lastFileName ? <div className="muted">{tour.lastFileName}</div> : null}
          </div>
        </div>
        {tour.infoText ? (
          <p className="muted" style={{ marginTop: '0.75rem', marginBottom: 0 }}>
            {tour.infoText}
          </p>
        ) : null}
      </div>

      <h2 style={{ marginBottom: '0.5rem' }}>Stops ({tour.stops.length})</h2>
      <div className="panel" style={{ overflowX: 'auto', marginBottom: '1.25rem' }}>
        <table className="table">
          <thead>
            <tr>
              <th>#</th>
              <th>Art</th>
              <th>TO</th>
              <th>Adresse</th>
              <th>Ankunft</th>
              <th>Abfahrt</th>
            </tr>
          </thead>
          <tbody>
            {tour.stops.map((s) => (
              <tr key={s.id}>
                <td>{s.sequence}</td>
                <td>{stopTypeLabel(s.stopType)}</td>
                <td>
                  <code>{s.transportOrderNumber || '—'}</code>
                </td>
                <td>
                  <strong>{s.name || '—'}</strong>
                  <div className="muted">
                    {[s.street, [s.zip, s.city].filter(Boolean).join(' '), s.country]
                      .filter(Boolean)
                      .join(', ')}
                  </div>
                  {s.activityDescription ? <div className="muted">{s.activityDescription}</div> : null}
                </td>
                <td style={{ whiteSpace: 'nowrap' }}>{fmt(s.targetStart)}</td>
                <td style={{ whiteSpace: 'nowrap' }}>{fmt(s.targetEnd)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <h2 style={{ marginBottom: '0.5rem' }}>Transportaufträge ({tour.consignments.length})</h2>
      <div className="panel" style={{ overflowX: 'auto' }}>
        <table className="table">
          <thead>
            <tr>
              <th>TO-Nr.</th>
              <th>Ext. Sendung</th>
              <th>Absender</th>
              <th>Empfänger</th>
            </tr>
          </thead>
          <tbody>
            {tour.consignments.map((c) => (
              <tr key={c.id}>
                <td>
                  <code>{c.soloplanOrderNumber}</code>
                </td>
                <td>{c.externalConsignmentNumber || '—'}</td>
                <td>
                  {c.senderName || '—'}
                  {c.senderBpNumber ? <div className="muted">BP {c.senderBpNumber}</div> : null}
                </td>
                <td>{c.receiverName || '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="muted" style={{ marginTop: '0.75rem' }}>
        Stops und TransportOrders sind über die TO-Nummer verknüpft. Statusmeldungen werden später an Tour/Stop
        angehängt.
      </p>
    </AppShell>
  );
}
