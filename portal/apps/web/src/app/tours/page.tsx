'use client';

import Link from 'next/link';
import { FormEvent, useEffect, useMemo, useState } from 'react';
import { AppShell } from '@/components/AppShell';
import { api, getUser } from '@/lib/api';

type Vehicle = {
  id: string;
  number: string | null;
  licensePlate: string | null;
  matchcode: string | null;
  tours: Array<{
    id: string;
    tourNumber: string;
    status: string;
    targetStart: string | null;
    driverName: string | null;
  }>;
  _count: { tours: number };
};

type Tour = {
  id: string;
  tourNumber: string;
  status: string;
  telematicsStatus?: string | null;
  lastAction: string | null;
  caption: string | null;
  driverName: string | null;
  dispatcherName: string | null;
  targetStart: string | null;
  targetEnd: string | null;
  stopCount: number;
  orderCount: number;
  vehicle: {
    id: string;
    number: string | null;
    licensePlate: string | null;
    matchcode: string | null;
  } | null;
  _count?: { stops: number; consignments: number };
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

export default function ToursPage() {
  const user = getUser();
  const canPoll = user?.role === 'ORG_ADMIN' || user?.role === 'MANDANT_DISPATCHER';
  const [tab, setTab] = useState<'tours' | 'vehicles'>('tours');
  const [tours, setTours] = useState<Tour[]>([]);
  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [q, setQ] = useState('');
  const [vehicleId, setVehicleId] = useState('');
  const [includeCancelled, setIncludeCancelled] = useState(false);
  const [error, setError] = useState('');
  const [info, setInfo] = useState('');
  const [loading, setLoading] = useState(true);
  const [polling, setPolling] = useState(false);

  async function load(next?: { q?: string; vehicleId?: string; includeCancelled?: boolean }) {
    setLoading(true);
    setError('');
    try {
      const params = new URLSearchParams();
      const qq = next?.q ?? q;
      const vid = next?.vehicleId ?? vehicleId;
      const cancelled = next?.includeCancelled ?? includeCancelled;
      if (qq.trim()) params.set('q', qq.trim());
      if (vid) params.set('vehicleId', vid);
      if (cancelled) params.set('includeCancelled', '1');
      const [tourRows, vehicleRows] = await Promise.all([
        api<Tour[]>(`/tours?${params.toString()}`),
        api<Vehicle[]>('/tours/vehicles'),
      ]);
      setTours(tourRows);
      setVehicles(vehicleRows);
    } catch (e: any) {
      setError(e.message || 'Laden fehlgeschlagen');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function onFilter(e: FormEvent) {
    e.preventDefault();
    await load();
  }

  async function pollInbox() {
    setPolling(true);
    setInfo('');
    setError('');
    try {
      const res = await api<{
        tours?: { processed: number; imported: number; deleted: number };
        telematics?: {
          processed: number;
          tourStatus: number;
          orderStatus: number;
          locations: number;
          documents: number;
        };
        processed?: number;
        imported?: number;
        deleted?: number;
      }>('/tours/poll-inbox', { method: 'POST' });
      const t = res.tours || res;
      const tel = res.telematics;
      setInfo(
        `Touren: ${t.processed || 0} Datei(en)` +
          (tel
            ? ` · Rückmeldungen: ${tel.processed} (Tour ${tel.tourStatus}, TO ${tel.orderStatus}, GPS ${tel.locations}, Docs ${tel.documents})`
            : ''),
      );
      await load();
    } catch (e: any) {
      setError(e.message || 'Import fehlgeschlagen');
    } finally {
      setPolling(false);
    }
  }

  const vehicleOptions = useMemo(
    () =>
      vehicles.map((v) => ({
        id: v.id,
        label: [v.licensePlate || v.number || v.matchcode || v.id, v.number && v.licensePlate ? v.number : null]
          .filter(Boolean)
          .join(' · '),
      })),
    [vehicles],
  );

  return (
    <AppShell title="Touren & Fahrzeuge">
      <p className="muted" style={{ marginBottom: '1rem' }}>
        Soloplan-Touren und Telematics-Rückmeldungen.{' '}
        <Link href="/tours/map">Kartenmonitor</Link>
      </p>

      <div className="row" style={{ marginBottom: '1rem', flexWrap: 'wrap', gap: '0.65rem' }}>
        <button
          type="button"
          className={tab === 'tours' ? 'btn' : 'btn btn-ghost'}
          onClick={() => setTab('tours')}
        >
          Tourübersicht ({tours.length})
        </button>
        <button
          type="button"
          className={tab === 'vehicles' ? 'btn' : 'btn btn-ghost'}
          onClick={() => setTab('vehicles')}
        >
          Fahrzeuge ({vehicles.length})
        </button>
        {canPoll ? (
          <button type="button" className="btn" disabled={polling} onClick={() => void pollInbox()}>
            {polling ? 'Importiere…' : 'XMLs / Rückmeldungen importieren'}
          </button>
        ) : null}
      </div>

      {error ? <div className="error">{error}</div> : null}
      {info ? <div className="success">{info}</div> : null}

      {tab === 'tours' ? (
        <div className="stack">
          <form className="panel stack" onSubmit={onFilter}>
            <div className="row" style={{ flexWrap: 'wrap', gap: '0.75rem', alignItems: 'end' }}>
              <label>
                Suche
                <input
                  value={q}
                  onChange={(e) => setQ(e.target.value)}
                  placeholder="Tournr., Kennzeichen, Fahrer…"
                />
              </label>
              <label>
                Fahrzeug
                <select value={vehicleId} onChange={(e) => setVehicleId(e.target.value)}>
                  <option value="">Alle</option>
                  {vehicleOptions.map((v) => (
                    <option key={v.id} value={v.id}>
                      {v.label}
                    </option>
                  ))}
                </select>
              </label>
              <label style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', marginBottom: '0.35rem' }}>
                <input
                  type="checkbox"
                  checked={includeCancelled}
                  onChange={(e) => setIncludeCancelled(e.target.checked)}
                />
                Stornierte anzeigen
              </label>
              <button type="submit" className="btn btn-ghost">
                Filtern
              </button>
            </div>
          </form>

          <div className="panel" style={{ overflowX: 'auto' }}>
            <table className="table">
              <thead>
                <tr>
                  <th>Tour</th>
                  <th>Status</th>
                  <th>Fahrzeug</th>
                  <th>Fahrer</th>
                  <th>Disponent</th>
                  <th>Start</th>
                  <th>Stops / TO</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr>
                    <td colSpan={8} className="muted">
                      Laden…
                    </td>
                  </tr>
                ) : tours.length === 0 ? (
                  <tr>
                    <td colSpan={8} className="muted">
                      Keine Touren. XMLs nach <code>inbound/soloplan/tours</code> oder{' '}
                      <code>business-partners</code> legen und importieren.
                    </td>
                  </tr>
                ) : (
                  tours.map((t) => (
                    <tr key={t.id}>
                      <td>
                        <strong>{t.tourNumber}</strong>
                        {t.caption ? <div className="muted">{t.caption}</div> : null}
                      </td>
                      <td>
                        <span className="badge">{TOUR_STATUS[t.status] || t.status}</span>
                        {t.telematicsStatus ? <div className="muted">{t.telematicsStatus}</div> : null}
                      </td>
                      <td>
                        {t.vehicle?.licensePlate || t.vehicle?.number || '—'}
                        {t.vehicle?.number && t.vehicle?.licensePlate ? (
                          <div className="muted">{t.vehicle.number}</div>
                        ) : null}
                      </td>
                      <td>{t.driverName || '—'}</td>
                      <td>{t.dispatcherName || '—'}</td>
                      <td style={{ whiteSpace: 'nowrap' }}>{fmt(t.targetStart)}</td>
                      <td>
                        {t._count?.stops ?? t.stopCount} / {t._count?.consignments ?? t.orderCount}
                      </td>
                      <td>
                        <Link href={`/tours/${t.id}`}>Details</Link>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      ) : (
        <div className="panel" style={{ overflowX: 'auto' }}>
          <table className="table">
            <thead>
              <tr>
                <th>Nr.</th>
                <th>Kennzeichen</th>
                <th>Matchcode</th>
                <th>Touren</th>
                <th>Letzte Tour</th>
                <th>Fahrer</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={6} className="muted">
                    Laden…
                  </td>
                </tr>
              ) : vehicles.length === 0 ? (
                <tr>
                  <td colSpan={6} className="muted">
                    Keine Fahrzeuge aus Tour-XMLs.
                  </td>
                </tr>
              ) : (
                vehicles.map((v) => {
                  const last = v.tours[0];
                  return (
                    <tr key={v.id}>
                      <td>
                        <strong>{v.number || '—'}</strong>
                      </td>
                      <td>{v.licensePlate || '—'}</td>
                      <td>{v.matchcode || '—'}</td>
                      <td>{v._count.tours}</td>
                      <td>
                        {last ? <Link href={`/tours/${last.id}`}>{last.tourNumber}</Link> : '—'}
                        {last?.targetStart ? <div className="muted">{fmt(last.targetStart)}</div> : null}
                      </td>
                      <td>{last?.driverName || '—'}</td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      )}
    </AppShell>
  );
}
