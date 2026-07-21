'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { AppShell } from '@/components/AppShell';
import { api } from '@/lib/api';

type Mandant = { id: string; code: string; name: string };

type OpsDashboard = {
  mandantId: string | null;
  mandanten: Mandant[];
  tours: { total: number; planned: number; active: number; completed: number };
  deliveries: {
    total: number;
    done: number;
    inProgress: number;
    open: number;
    percentDone: number;
  };
  vehiclesWithGps: number;
};

type IntouchStatus = {
  root: string;
  channels: Array<{ channel: string; path: string; pendingFiles: number; files: string[] }>;
};

export default function ToursDashboardPage() {
  const [mandantId, setMandantId] = useState('');
  const [data, setData] = useState<OpsDashboard | null>(null);
  const [intouch, setIntouch] = useState<IntouchStatus | null>(null);
  const [error, setError] = useState('');

  async function load(mid?: string) {
    setError('');
    try {
      const q = mid ? `?mandantId=${mid}` : '';
      const [dash, ito] = await Promise.all([
        api<OpsDashboard>(`/tours/ops-dashboard${q}`),
        api<IntouchStatus>('/tours/intouch/status'),
      ]);
      setData(dash);
      setIntouch(ito);
      if (!mandantId && dash.mandanten.length === 1) {
        setMandantId(dash.mandanten[0].id);
      }
    } catch (e: any) {
      setError(e.message || 'Laden fehlgeschlagen');
    }
  }

  useEffect(() => {
    void load(mandantId || undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mandantId]);

  const d = data?.deliveries;
  const pct = d?.percentDone ?? 0;

  return (
    <AppShell title="Dispo-Dashboard">
      <p className="muted" style={{ marginBottom: '1rem' }}>
        Zustellungsfortschritt für <strong>WOG Logistics AG</strong>.{' '}
        <Link href="/tours">Touren</Link>
        {' · '}
        <Link href="/tours/lademittel">Lademittel</Link>
        {' · '}
        <Link href="/tours/map">Kartenmonitor</Link>
      </p>

      <div className="row" style={{ marginBottom: '1rem', gap: '0.75rem' }}>
        <label>
          Mandant / Organisation
          <select value={mandantId} onChange={(e) => setMandantId(e.target.value)}>
            <option value="">Alle aktiven</option>
            {(data?.mandanten || []).map((m) => (
              <option key={m.id} value={m.id}>
                {m.name} ({m.code})
              </option>
            ))}
          </select>
        </label>
        <button type="button" className="btn btn-ghost" onClick={() => void load(mandantId || undefined)}>
          Aktualisieren
        </button>
      </div>

      {error ? <div className="error">{error}</div> : null}

      {data ? (
        <>
          <div className="grid-3" style={{ marginBottom: '1rem' }}>
            <div className="stat">
              <div className="label">Zustellungen erledigt</div>
              <div className="value">
                {d?.done ?? 0}
                <span style={{ fontSize: '1rem', color: 'var(--muted)' }}> / {d?.total ?? 0}</span>
              </div>
              <div className="muted">{pct} %</div>
            </div>
            <div className="stat">
              <div className="label">In Zustellung</div>
              <div className="value">{d?.inProgress ?? 0}</div>
              <div className="muted">offen ohne Status: {d?.open ?? 0}</div>
            </div>
            <div className="stat">
              <div className="label">Touren</div>
              <div className="value">{data.tours.total}</div>
              <div className="muted">
                aktiv {data.tours.active} · fertig {data.tours.completed} · geplant {data.tours.planned}
              </div>
            </div>
          </div>

          <div className="panel" style={{ marginBottom: '1rem' }}>
            <strong className="panel-title">Zustellfortschritt</strong>
            <div
              style={{
                marginTop: '0.75rem',
                height: 14,
                borderRadius: 8,
                background: 'var(--line)',
                overflow: 'hidden',
              }}
            >
              <div
                style={{
                  width: `${Math.min(100, pct)}%`,
                  height: '100%',
                  background: 'var(--wog-green)',
                  transition: 'width 300ms ease',
                }}
              />
            </div>
            <p className="muted" style={{ marginBottom: 0, marginTop: '0.65rem' }}>
              Erledigt = Entladung beendet / Entladestelle verlassen (Telematics). Fahrzeuge mit GPS:{' '}
              {data.vehiclesWithGps}
            </p>
          </div>
        </>
      ) : (
        <p className="muted">Laden…</p>
      )}

      {intouch ? (
        <div className="panel">
          <strong className="panel-title">Intouch SFTP-Upload</strong>
          <p className="muted" style={{ marginTop: '0.35rem' }}>
            Zwei Ordner für Intouch-Meldungen (User <code>soloplan</code>, Port 22):
          </p>
          <table className="table">
            <thead>
              <tr>
                <th>Kanal</th>
                <th>Pfad</th>
                <th>Wartend</th>
              </tr>
            </thead>
            <tbody>
              {intouch.channels.map((ch) => (
                <tr key={ch.channel}>
                  <td>
                    <strong>{ch.channel}</strong>
                  </td>
                  <td>
                    <code>{ch.path}</code>
                  </td>
                  <td>{ch.pendingFiles}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </AppShell>
  );
}
