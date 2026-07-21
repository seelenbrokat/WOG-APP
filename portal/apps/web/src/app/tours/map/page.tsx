'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { AppShell } from '@/components/AppShell';
import { FleetMap, FleetVehicle } from '@/components/FleetMap';
import { api, getUser } from '@/lib/api';

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

export default function FleetMapPage() {
  const user = getUser();
  const canPoll = user?.role === 'ORG_ADMIN' || user?.role === 'MANDANT_DISPATCHER';
  const [vehicles, setVehicles] = useState<FleetVehicle[]>([]);
  const [error, setError] = useState('');
  const [info, setInfo] = useState('');
  const [loading, setLoading] = useState(true);
  const [polling, setPolling] = useState(false);

  const load = useCallback(async () => {
    setError('');
    try {
      const rows = await api<FleetVehicle[]>('/tours/fleet-map');
      setVehicles(rows);
    } catch (e: any) {
      setError(e.message || 'Laden fehlgeschlagen');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
    const t = setInterval(() => void load(), 60_000);
    return () => clearInterval(t);
  }, [load]);

  async function pollInbox() {
    setPolling(true);
    setInfo('');
    setError('');
    try {
      const res = await api<{
        tours: { processed: number };
        telematics: {
          processed: number;
          tourStatus: number;
          orderStatus: number;
          locations: number;
          documents: number;
        };
      }>('/tours/poll-inbox', { method: 'POST' });
      const t = res.telematics;
      setInfo(
        `Import: ${t.processed} Rückmeldungen (Tour ${t.tourStatus} · TO ${t.orderStatus} · GPS ${t.locations} · Docs ${t.documents})` +
          (res.tours?.processed ? ` · ${res.tours.processed} Tour-XMLs` : ''),
      );
      await load();
    } catch (e: any) {
      setError(e.message || 'Import fehlgeschlagen');
    } finally {
      setPolling(false);
    }
  }

  return (
    <AppShell title="Kartenmonitor">
      <p className="muted" style={{ marginBottom: '1rem' }}>
        Live-Positionen aus Soloplan <code>VehicleLocations</code> / Statusmeldungen.{' '}
        <Link href="/tours">Zur Tourübersicht</Link>
      </p>

      <div className="row" style={{ marginBottom: '1rem', gap: '0.65rem' }}>
        <button type="button" className="btn btn-ghost" onClick={() => void load()}>
          Aktualisieren
        </button>
        {canPoll ? (
          <button type="button" className="btn" disabled={polling} onClick={() => void pollInbox()}>
            {polling ? 'Importiere…' : 'Rückmeldungen importieren'}
          </button>
        ) : null}
        <span className="muted">{loading ? 'Laden…' : `${vehicles.length} Fahrzeuge mit Position`}</span>
      </div>

      {error ? <div className="error">{error}</div> : null}
      {info ? <div className="success">{info}</div> : null}

      <div className="panel" style={{ padding: 0, overflow: 'hidden', marginBottom: '1rem' }}>
        <FleetMap vehicles={vehicles} />
      </div>

      <div className="panel" style={{ overflowX: 'auto' }}>
        <table className="table">
          <thead>
            <tr>
              <th>Fahrzeug</th>
              <th>Position</th>
              <th>Zuletzt</th>
              <th>Tour</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {vehicles.length === 0 ? (
              <tr>
                <td colSpan={5} className="muted">
                  Noch keine GPS-Positionen. Rückmeldungen importieren.
                </td>
              </tr>
            ) : (
              vehicles.map((v) => (
                <tr key={v.id}>
                  <td>
                    <strong>{v.licensePlate || v.number || '—'}</strong>
                    <div className="muted">{[v.number, v.matchcode].filter(Boolean).join(' · ')}</div>
                  </td>
                  <td className="muted">
                    {v.latitude?.toFixed(5)}, {v.longitude?.toFixed(5)}
                  </td>
                  <td style={{ whiteSpace: 'nowrap' }}>{fmt(v.locationAt)}</td>
                  <td>
                    {v.tour ? (
                      <Link href={`/tours/${v.tour.id}`}>{v.tour.tourNumber}</Link>
                    ) : (
                      '—'
                    )}
                    {v.tour?.driverName ? <div className="muted">{v.tour.driverName}</div> : null}
                  </td>
                  <td>
                    <span className="badge">{v.tour?.telematicsStatus || v.tour?.status || '—'}</span>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </AppShell>
  );
}
