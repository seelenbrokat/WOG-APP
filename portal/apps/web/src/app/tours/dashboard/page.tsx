'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { AppShell } from '@/components/AppShell';
import { api } from '@/lib/api';

type Mandant = { id: string; code: string; name: string };

type OpsDashboard = {
  mandantId: string | null;
  date?: string;
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

function todayLocal(): string {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'Europe/Zurich' });
}

function fmtDayLabel(value?: string) {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return 'Heute';
  const [y, m, d] = value.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString('de-CH', {
    weekday: 'short',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  });
}

type IntouchStatus = {
  root: string;
  channels: Array<{ channel: string; path: string; pendingFiles: number; files: string[] }>;
};

type Exceptions = {
  delayed: Array<{
    tourId: string;
    tourNumber: string;
    driverName: string | null;
    vehiclePlate: string | null;
    orderNumber: string | null;
    receiverName: string | null;
    consignmentStatus: string | null;
    targetEnd: string | null;
    minutesLate: number;
  }>;
  staleTelematics: Array<{
    tourId: string;
    tourNumber: string;
    status: string;
    telematicsStatus: string | null;
    driverName: string | null;
    vehiclePlate: string | null;
    lastStatusAt: string | null;
    minutesSinceUpdate: number | null;
  }>;
  openGoodsReceipts: Array<{
    id: string;
    externalRef: string;
    sessionDate: string;
    customerName: string | null;
    customerNumber: string | null;
    checkCount: number;
    createdAt: string;
  }>;
  counts: { delayed: number; staleTelematics: number; openGoodsReceipts: number };
  staleThresholdMinutes: number;
};

function fmtShort(value?: string | null) {
  if (!value) return '—';
  return new Date(value).toLocaleString('de-CH', {
    timeZone: 'Europe/Zurich',
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export default function ToursDashboardPage() {
  const [mandantId, setMandantId] = useState('');
  const [date, setDate] = useState(todayLocal);
  const [data, setData] = useState<OpsDashboard | null>(null);
  const [exceptions, setExceptions] = useState<Exceptions | null>(null);
  const [intouch, setIntouch] = useState<IntouchStatus | null>(null);
  const [error, setError] = useState('');

  async function load(mid?: string, day?: string) {
    setError('');
    try {
      const params = new URLSearchParams();
      const m = mid ?? mandantId;
      const d = day ?? date;
      if (m) params.set('mandantId', m);
      if (d) params.set('date', d);
      const q = params.toString() ? `?${params}` : '';
      const [dash, ito, ex] = await Promise.all([
        api<OpsDashboard>(`/tours/ops-dashboard${q}`),
        api<IntouchStatus>('/tours/intouch/status'),
        api<Exceptions>(`/tours/exceptions${q}`),
      ]);
      setData(dash);
      setIntouch(ito);
      setExceptions(ex);
      if (dash.date && dash.date !== date) setDate(dash.date);
      if (!mandantId && dash.mandanten.length === 1) {
        setMandantId(dash.mandanten[0].id);
      }
    } catch (e: any) {
      setError(e.message || 'Laden fehlgeschlagen');
    }
  }

  useEffect(() => {
    void load(mandantId || undefined, date);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mandantId, date]);

  const d = data?.deliveries;
  const pct = d?.percentDone ?? 0;

  return (
    <AppShell title="Dispo-Dashboard">
      <p className="muted" style={{ marginBottom: '1rem' }}>
        Zustellungsfortschritt für <strong>WOG Logistics AG</strong> – nur Touren mit{' '}
        <strong>Startdatum {fmtDayLabel(date)}</strong>.{' '}
        <Link href="/tours">Touren</Link>
        {' · '}
        <Link href="/tours/lademittel">Lademittel</Link>
        {' · '}
        <Link href="/tours/map">Kartenmonitor</Link>
      </p>

      <div className="row" style={{ marginBottom: '1rem', gap: '0.75rem', flexWrap: 'wrap' }}>
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
          onClick={() => void load(mandantId || undefined, date)}
        >
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

          {exceptions ? (
            <div className="panel" style={{ marginBottom: '1rem' }}>
              <strong className="panel-title">Abweichungs-Cockpit</strong>
              <p className="muted" style={{ marginTop: '0.35rem' }}>
                Verspätet · fehlende Telematik (&gt;{exceptions.staleThresholdMinutes} Min.) · offene
                Wareneingänge
              </p>
              <div className="grid-3" style={{ marginBottom: '1rem' }}>
                <div className="stat">
                  <div className="label">Verspätet</div>
                  <div className="value">{exceptions.counts.delayed}</div>
                </div>
                <div className="stat">
                  <div className="label">Telematik fehlt</div>
                  <div className="value">{exceptions.counts.staleTelematics}</div>
                </div>
                <div className="stat">
                  <div className="label">Offene WE</div>
                  <div className="value">{exceptions.counts.openGoodsReceipts}</div>
                </div>
              </div>

              <strong>Verspätete Zustellungen</strong>
              <table className="table" style={{ marginTop: '0.5rem', marginBottom: '1rem' }}>
                <thead>
                  <tr>
                    <th>Tour</th>
                    <th>Auftrag / Empfänger</th>
                    <th>Soll-Ende</th>
                    <th>Verspätung</th>
                  </tr>
                </thead>
                <tbody>
                  {exceptions.delayed.slice(0, 25).map((row, idx) => (
                    <tr key={`${row.tourId}-${row.orderNumber}-${idx}`}>
                      <td>
                        <Link href={`/tours/${row.tourId}`}>{row.tourNumber}</Link>
                        <div className="muted" style={{ fontSize: '0.85rem' }}>
                          {row.vehiclePlate || '—'}
                          {row.driverName ? ` · ${row.driverName}` : ''}
                        </div>
                      </td>
                      <td>
                        {row.orderNumber || '—'}
                        <div className="muted" style={{ fontSize: '0.85rem' }}>
                          {row.receiverName || '—'} · {row.consignmentStatus || 'ohne Status'}
                        </div>
                      </td>
                      <td className="muted">{fmtShort(row.targetEnd)}</td>
                      <td>
                        <span className="badge">{row.minutesLate} Min.</span>
                      </td>
                    </tr>
                  ))}
                  {!exceptions.delayed.length && (
                    <tr>
                      <td colSpan={4} className="muted">
                        Keine Verspätungen.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>

              <strong>Fehlende / veraltete Telematik</strong>
              <table className="table" style={{ marginTop: '0.5rem', marginBottom: '1rem' }}>
                <thead>
                  <tr>
                    <th>Tour</th>
                    <th>Status</th>
                    <th>Letztes Update</th>
                    <th>Alter</th>
                  </tr>
                </thead>
                <tbody>
                  {exceptions.staleTelematics.slice(0, 25).map((row) => (
                    <tr key={row.tourId}>
                      <td>
                        <Link href={`/tours/${row.tourId}`}>{row.tourNumber}</Link>
                        <div className="muted" style={{ fontSize: '0.85rem' }}>
                          {row.vehiclePlate || '—'}
                          {row.driverName ? ` · ${row.driverName}` : ''}
                        </div>
                      </td>
                      <td>
                        {row.status}
                        {row.telematicsStatus ? ` / ${row.telematicsStatus}` : ''}
                      </td>
                      <td className="muted">{fmtShort(row.lastStatusAt)}</td>
                      <td>
                        {row.minutesSinceUpdate != null
                          ? `${row.minutesSinceUpdate} Min.`
                          : 'nie'}
                      </td>
                    </tr>
                  ))}
                  {!exceptions.staleTelematics.length && (
                    <tr>
                      <td colSpan={4} className="muted">
                        Alle aktiven Touren aktuell.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>

              <strong>Offene Wareneingänge</strong>
              <table className="table" style={{ marginTop: '0.5rem' }}>
                <thead>
                  <tr>
                    <th>Referenz</th>
                    <th>Kunde</th>
                    <th>Datum</th>
                    <th>Checks</th>
                  </tr>
                </thead>
                <tbody>
                  {exceptions.openGoodsReceipts.slice(0, 25).map((row) => (
                    <tr key={row.id}>
                      <td>
                        <Link href="/scanning/we-tc57">{row.externalRef}</Link>
                      </td>
                      <td>
                        {row.customerName || '—'}
                        {row.customerNumber ? (
                          <div className="muted" style={{ fontSize: '0.85rem' }}>
                            {row.customerNumber}
                          </div>
                        ) : null}
                      </td>
                      <td className="muted">{fmtShort(row.sessionDate)}</td>
                      <td>{row.checkCount}</td>
                    </tr>
                  ))}
                  {!exceptions.openGoodsReceipts.length && (
                    <tr>
                      <td colSpan={4} className="muted">
                        Keine offenen WE-Sitzungen.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          ) : null}
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
