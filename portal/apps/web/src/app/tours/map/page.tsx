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

type Mandant = { id: string; code: string; name: string };

export default function FleetMapPage() {
  const user = getUser();
  const canPoll = user?.role === 'ORG_ADMIN' || user?.role === 'MANDANT_DISPATCHER';
  const [vehicles, setVehicles] = useState<FleetVehicle[]>([]);
  const [mandanten, setMandanten] = useState<Mandant[]>([]);
  const [mandantId, setMandantId] = useState('');
  const [error, setError] = useState('');
  const [info, setInfo] = useState('');
  const [loading, setLoading] = useState(true);
  const [polling, setPolling] = useState(false);

  const load = useCallback(async (mid?: string) => {
    setError('');
    try {
      const id = mid ?? mandantId;
      const q = id ? `?mandantId=${id}` : '';
      const [rows, mandantRows] = await Promise.all([
        api<FleetVehicle[]>(`/tours/fleet-map${q}`),
        api<Mandant[]>('/mandanten'),
      ]);
      setVehicles(rows);
      setMandanten(mandantRows);
      if (!id && mandantRows.length === 1) setMandantId(mandantRows[0].id);
    } catch (e: any) {
      setError(e.message || 'Laden fehlgeschlagen');
    } finally {
      setLoading(false);
    }
  }, [mandantId]);

  useEffect(() => {
    void load(mandantId || undefined);
    const t = setInterval(() => void load(mandantId || undefined), 60_000);
    return () => clearInterval(t);
  }, [load, mandantId]);

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
        Live-Positionen: VLB-Zustellapp und mTrack-Fahrzeuge.{' '}
        <Link href="/tours/dashboard">Dispo-Dashboard</Link>
        {' · '}
        <Link href="/tours">Touren</Link>
      </p>

      <div className="row" style={{ marginBottom: '1rem', gap: '0.65rem', alignItems: 'end' }}>
        <label>
          Mandant
          <select value={mandantId} onChange={(e) => setMandantId(e.target.value)}>
            <option value="">Alle aktiven</option>
            {mandanten.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name}
              </option>
            ))}
          </select>
        </label>
        <button type="button" className="btn btn-ghost" onClick={() => void load(mandantId || undefined)}>
          Aktualisieren
        </button>
        {canPoll ? (
          <button type="button" className="btn" disabled={polling} onClick={() => void pollInbox()}>
            {polling ? 'Importiere…' : 'Rückmeldungen importieren'}
          </button>
        ) : null}
        <span className="muted">
          {loading
            ? 'Laden…'
            : (() => {
                const mtrack = vehicles.filter((v) => (v.locationSource || '').toLowerCase() === 'mtrack').length;
                const vlb = vehicles.length - mtrack;
                return `${vehicles.length} Fahrzeug${vehicles.length === 1 ? '' : 'e'} (VLB ${vlb} · mTrack ${mtrack})`;
              })()}
        </span>
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
              <th>Fahrer</th>
              <th>Quelle</th>
              <th>Position</th>
              <th>Zuletzt</th>
              <th>Tour</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {vehicles.length === 0 ? (
              <tr>
                <td colSpan={7} className="muted">
                  Keine Positionen. VLB: Fahrer muss GPS senden. mTrack: Zugangsdaten prüfen
                  (MTRACK_ENABLED).
                </td>
              </tr>
            ) : (
              vehicles.map((v) => (
                <tr key={v.id}>
                  <td>
                    <strong>{v.licensePlate || v.number || '—'}</strong>
                    <div className="muted">{[v.number, v.matchcode].filter(Boolean).join(' · ')}</div>
                  </td>
                  <td>
                    <strong>{v.driverName || v.tour?.driverName || '—'}</strong>
                    {v.driverId ? <div className="muted">{v.driverId}</div> : null}
                  </td>
                  <td>
                    <span className="badge">
                      {(v.locationSource || '').toLowerCase() === 'mtrack' ? 'mTrack' : 'VLB'}
                    </span>
                  </td>
                  <td className="muted">
                    {v.latitude?.toFixed(5)}, {v.longitude?.toFixed(5)}
                    {v.address ? <div>{v.address}</div> : null}
                  </td>
                  <td style={{ whiteSpace: 'nowrap' }}>{fmt(v.locationAt)}</td>
                  <td>
                    {v.tour ? (
                      <Link href={`/tours/${v.tour.id}`}>{v.tour.tourNumber}</Link>
                    ) : (
                      '—'
                    )}
                  </td>
                  <td>
                    <span className="badge">
                      {v.tour?.telematicsStatus || v.tour?.status || v.statusText || '—'}
                    </span>
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
