'use client';

import { useEffect, useState } from 'react';
import { AppShell } from '@/components/AppShell';
import { api, getUser } from '@/lib/api';

type PartnerTour = {
  id: string;
  tourNumber: string;
  status: string;
  telematicsStatus?: string | null;
  caption: string | null;
  driverName: string | null;
  targetStart: string | null;
  targetEnd: string | null;
  vehicle?: { licensePlate: string | null; number: string | null } | null;
  stops: Array<{
    id: string;
    sequence: number;
    name: string | null;
    city: string | null;
    stopType: string | null;
    targetStart: string | null;
    targetEnd: string | null;
  }>;
  consignments: Array<{
    id: string;
    soloplanOrderNumber: string;
    receiverName: string | null;
    status: string | null;
    lastStatusAt: string | null;
  }>;
};

const TOUR_STATUS: Record<string, string> = {
  PLANNED: 'Geplant',
  ACTIVE: 'Aktiv',
  COMPLETED: 'Abgeschlossen',
  CANCELLED: 'Storniert',
};

function todayLocal(): string {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'Europe/Zurich' });
}

function fmt(value?: string | null) {
  if (!value) return '—';
  return new Date(value).toLocaleString('de-CH', {
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export default function PartnerToursPage() {
  const user = getUser();
  const [date, setDate] = useState(todayLocal);
  const [tours, setTours] = useState<PartnerTour[]>([]);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);

  async function load(day?: string) {
    setLoading(true);
    setError('');
    try {
      const d = day ?? date;
      const q = d ? `?date=${encodeURIComponent(d)}` : '';
      const data = await api<PartnerTour[]>(`/tours/mine${q}`);
      setTours(data);
    } catch (e: any) {
      setError(e.message || 'Laden fehlgeschlagen');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load(date);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [date]);

  return (
    <AppShell title="Meine Touren">
      <p className="muted" style={{ marginBottom: '1rem' }}>
        Zugewiesene Touren und Stops
        {user?.partnerName ? (
          <>
            {' '}
            für <strong>{user.partnerName}</strong>
          </>
        ) : null}
        . Status-Updates erfolgen über die Zustell-App / Telematik.
      </p>

      <div className="row" style={{ marginBottom: '1rem', gap: '0.75rem', flexWrap: 'wrap' }}>
        <label>
          Startdatum
          <input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        </label>
        <button
          type="button"
          className="btn btn-secondary"
          style={{ alignSelf: 'end' }}
          onClick={() => setDate(todayLocal())}
        >
          Heute
        </button>
        <button
          type="button"
          className="btn btn-ghost"
          style={{ alignSelf: 'end' }}
          onClick={() => void load(date)}
        >
          Aktualisieren
        </button>
      </div>

      {error ? <div className="error">{error}</div> : null}
      {loading ? <p className="muted">Laden…</p> : null}

      <div className="stack" style={{ gap: '0.85rem' }}>
        {tours.map((t) => {
          const open = expanded === t.id;
          return (
            <div key={t.id} className="panel">
              <div className="row" style={{ justifyContent: 'space-between', gap: '0.75rem', flexWrap: 'wrap' }}>
                <div>
                  <strong>Tour {t.tourNumber}</strong>
                  <div className="muted">
                    {TOUR_STATUS[t.status] || t.status}
                    {t.telematicsStatus ? ` · ${t.telematicsStatus}` : ''}
                    {' · '}
                    {t.vehicle?.licensePlate || t.vehicle?.number || 'ohne Fahrzeug'}
                    {t.driverName ? ` · ${t.driverName}` : ''}
                  </div>
                  <div className="muted" style={{ fontSize: '0.9rem' }}>
                    {fmt(t.targetStart)} – {fmt(t.targetEnd)} · {t.consignments.length} Sendung(en) ·{' '}
                    {t.stops.length} Stop(s)
                  </div>
                </div>
                <button
                  type="button"
                  className="btn btn-secondary"
                  onClick={() => setExpanded(open ? null : t.id)}
                >
                  {open ? 'Schließen' : 'Details'}
                </button>
              </div>
              {open ? (
                <div style={{ marginTop: '1rem' }}>
                  <strong>Sendungen</strong>
                  <table className="table" style={{ marginTop: '0.5rem' }}>
                    <thead>
                      <tr>
                        <th>Auftrag</th>
                        <th>Empfänger</th>
                        <th>Status</th>
                        <th>Aktualisiert</th>
                      </tr>
                    </thead>
                    <tbody>
                      {t.consignments.map((c) => (
                        <tr key={c.id}>
                          <td>{c.soloplanOrderNumber}</td>
                          <td>{c.receiverName || '—'}</td>
                          <td>{c.status || 'offen'}</td>
                          <td className="muted">{fmt(c.lastStatusAt)}</td>
                        </tr>
                      ))}
                      {!t.consignments.length && (
                        <tr>
                          <td colSpan={4} className="muted">
                            Keine Sendungen.
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                  <strong style={{ display: 'block', marginTop: '1rem' }}>Stops</strong>
                  <table className="table" style={{ marginTop: '0.5rem' }}>
                    <thead>
                      <tr>
                        <th>#</th>
                        <th>Ort</th>
                        <th>Typ</th>
                        <th>Zeitfenster</th>
                      </tr>
                    </thead>
                    <tbody>
                      {t.stops.map((s) => (
                        <tr key={s.id}>
                          <td>{s.sequence}</td>
                          <td>
                            {s.name || '—'}
                            {s.city ? ` · ${s.city}` : ''}
                          </td>
                          <td>{s.stopType || '—'}</td>
                          <td className="muted">
                            {fmt(s.targetStart)} – {fmt(s.targetEnd)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : null}
            </div>
          );
        })}
        {!loading && !tours.length && (
          <div className="panel muted">Keine Touren für dieses Datum.</div>
        )}
      </div>
    </AppShell>
  );
}
