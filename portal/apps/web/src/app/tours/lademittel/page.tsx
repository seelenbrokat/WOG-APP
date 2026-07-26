'use client';

import Link from 'next/link';
import { FormEvent, useEffect, useMemo, useState } from 'react';
import { AppShell } from '@/components/AppShell';
import { api, getToken } from '@/lib/api';

async function downloadExport(params: Record<string, string>) {
  const qs = new URLSearchParams(params);
  const res = await fetch(
    `${process.env.NEXT_PUBLIC_API_URL || '/api'}/tours/loading-units/export?${qs}`,
    { headers: { Authorization: `Bearer ${getToken()}` } },
  );
  if (!res.ok) {
    const text = await res.text();
    throw new Error(text || 'Export fehlgeschlagen');
  }
  const blob = await res.blob();
  const cd = res.headers.get('Content-Disposition') || '';
  const m = /filename="([^"]+)"/.exec(cd);
  const fileName = m?.[1] || 'Lademittel-Export.csv';
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  a.click();
  URL.revokeObjectURL(url);
}

type BalanceRow = {
  partnerNumber: string | null;
  partnerName: string;
  partnerCity: string | null;
  packagingMatchcode: string;
  packagingLabel: string | null;
  given: number;
  taken: number;
  balance: number;
  owedQuantity: number;
  postings: number;
  lastAt: string | null;
};

type Posting = {
  id: string;
  packagingMatchcode: string;
  packagingLabel: string | null;
  given: number;
  taken: number;
  balanceDelta: number;
  owedQuantity?: number;
  partnerNumber: string | null;
  partnerName: string | null;
  partnerCity: string | null;
  tourNumber: string | null;
  status: string;
  skipReason: string | null;
  occurredAt: string | null;
  sourceFile: string;
  tour?: { id: string; tourNumber: string } | null;
};

type NoExchangeCustomer = {
  partnerName: string;
  partnerNumber: string | null;
  partnerCity: string | null;
  tourNumber?: string | null;
  tourId?: string | null;
  stopType?: string | null;
  packagingMatchcodes: string[];
  owedByMatchcode?: Record<string, number>;
  owedQuantity?: number;
  occurredAt?: string | null;
  events?: number;
  days?: string[];
  dayCount?: number;
  lastAt?: string | null;
};

type NoExchangeDay = {
  date: string;
  customerCount: number;
  eventCount: number;
  owedQuantity?: number;
  customers: NoExchangeCustomer[];
};

type NoExchangeOverview = {
  month: string;
  groupBy: 'day' | 'month' | 'customer';
  days?: NoExchangeDay[];
  customers?: NoExchangeCustomer[];
  excludedMatchcodes?: string[];
  totals: {
    customers: number;
    events: number;
    days: number;
    stopsWithoutExchange?: number;
    owedQuantity?: number;
    byMatchcode?: Record<string, number>;
    owedByMatchcode?: Record<string, number>;
  };
};

function fmtOwed(n?: number | null) {
  if (n == null || n < 0) return '—';
  return String(n);
}

function fmtOwedByMatchcode(
  codes: string[],
  owedBy?: Record<string, number> | null,
  total?: number | null,
) {
  if (owedBy && Object.keys(owedBy).length) {
    return Object.entries(owedBy)
      .filter(([, n]) => n > 0)
      .sort((a, b) => b[1] - a[1])
      .map(([mc, n]) => `${mc}: ${n}`)
      .join(', ');
  }
  if (total && total > 0) {
    return codes.length ? `${codes.join(', ')}: ${total}` : String(total);
  }
  return '—';
}

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

function fmtDay(value: string) {
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    const [y, m, d] = value.split('-').map(Number);
    return new Date(y, m - 1, d).toLocaleDateString('de-CH', {
      weekday: 'short',
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
    });
  }
  if (/^\d{4}-\d{2}$/.test(value)) {
    const [y, m] = value.split('-').map(Number);
    return new Date(y, m - 1, 1).toLocaleDateString('de-CH', {
      month: 'long',
      year: 'numeric',
    });
  }
  return value;
}

function currentMonth() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

export default function LademittelPage() {
  const [tab, setTab] = useState<'no-exchange' | 'balances'>('balances');
  const [q, setQ] = useState('');
  const [matchcode, setMatchcode] = useState('');
  const [balances, setBalances] = useState<BalanceRow[]>([]);
  const [totals, setTotals] = useState({ given: 0, taken: 0, balance: 0, owedQuantity: 0 });
  const [postings, setPostings] = useState<Posting[]>([]);
  const [selectedPartner, setSelectedPartner] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [showSkipped, setShowSkipped] = useState(false);

  const [month, setMonth] = useState(currentMonth);
  const [groupBy, setGroupBy] = useState<'day' | 'customer'>('customer');
  const [overview, setOverview] = useState<NoExchangeOverview | null>(null);
  const [openDay, setOpenDay] = useState<string | null>(null);

  const monthLabel = useMemo(() => fmtDay(month), [month]);

  /** Eine Zeile pro Kunde/Partner – Typen kommuliert */
  const partnersAgg = useMemo(() => {
    const map = new Map<
      string,
      {
        partnerName: string;
        partnerNumber: string | null;
        partnerCity: string | null;
        given: number;
        taken: number;
        balance: number;
        owedQuantity: number;
        postings: number;
        lastAt: string | null;
        types: BalanceRow[];
      }
    >();
    for (const r of balances) {
      const key = r.partnerName;
      let row = map.get(key);
      if (!row) {
        row = {
          partnerName: r.partnerName,
          partnerNumber: r.partnerNumber,
          partnerCity: r.partnerCity,
          given: 0,
          taken: 0,
          balance: 0,
          owedQuantity: 0,
          postings: 0,
          lastAt: null,
          types: [],
        };
        map.set(key, row);
      }
      row.given += r.given;
      row.taken += r.taken;
      row.balance += r.balance;
      row.owedQuantity += r.owedQuantity ?? Math.max(0, r.balance);
      row.postings += r.postings;
      row.types.push(r);
      if (!row.partnerNumber && r.partnerNumber) row.partnerNumber = r.partnerNumber;
      if (!row.partnerCity && r.partnerCity) row.partnerCity = r.partnerCity;
      if (r.lastAt && (!row.lastAt || r.lastAt > row.lastAt)) row.lastAt = r.lastAt;
    }
    return [...map.values()].sort((a, b) =>
      a.partnerName.localeCompare(b.partnerName, 'de'),
    );
  }, [balances]);

  const selectedTypes = useMemo(
    () => partnersAgg.find((p) => p.partnerName === selectedPartner)?.types ?? [],
    [partnersAgg, selectedPartner],
  );

  async function loadBalances(next?: {
    q?: string;
    matchcode?: string;
    partnerName?: string | null;
  }) {
    setLoading(true);
    setError('');
    try {
      const qq = next?.q ?? q;
      const mc = next?.matchcode ?? matchcode;
      const partnerName = next?.partnerName === undefined ? selectedPartner : next.partnerName;
      const balParams = new URLSearchParams();
      if (qq.trim()) balParams.set('q', qq.trim());
      if (mc.trim()) balParams.set('matchcode', mc.trim());

      const bal = await api<{
        balances: BalanceRow[];
        totals: { given: number; taken: number; balance: number; owedQuantity: number };
      }>(`/tours/loading-units/balances?${balParams}`);
      setBalances(bal.balances);
      setTotals({
        given: bal.totals.given,
        taken: bal.totals.taken,
        balance: bal.totals.balance,
        owedQuantity: bal.totals.owedQuantity ?? Math.max(0, bal.totals.balance),
      });

      // Einzelbuchungen nur wenn ein Kunde gewählt ist
      if (partnerName) {
        const postParams = new URLSearchParams();
        postParams.set('partnerName', partnerName);
        if (mc.trim()) postParams.set('matchcode', mc.trim());
        if (showSkipped) postParams.set('includeSkipped', '1');
        postParams.set('take', '80');
        setPostings(await api<Posting[]>(`/tours/loading-units/postings?${postParams}`));
      } else {
        setPostings([]);
      }
    } catch (e: any) {
      setError(e.message || 'Laden fehlgeschlagen');
    } finally {
      setLoading(false);
    }
  }

  async function loadNoExchange(next?: { month?: string; groupBy?: 'day' | 'customer'; q?: string }) {
    setLoading(true);
    setError('');
    try {
      const params = new URLSearchParams();
      params.set('month', next?.month ?? month);
      params.set('groupBy', next?.groupBy ?? groupBy);
      const qq = next?.q ?? q;
      if (qq.trim()) params.set('q', qq.trim());
      const data = await api<NoExchangeOverview>(`/tours/loading-units/no-exchange?${params}`);
      setOverview(data);
      if (data.days?.length && !openDay) {
        setOpenDay(data.days[0].date);
      }
    } catch (e: any) {
      setError(e.message || 'Laden fehlgeschlagen');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (tab === 'no-exchange') void loadNoExchange();
    else void loadBalances();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, showSkipped, month, groupBy]);

  function onSearch(e: FormEvent) {
    e.preventDefault();
    if (tab === 'no-exchange') void loadNoExchange();
    else void loadBalances();
  }

  function shiftMonth(delta: number) {
    const [y, m] = month.split('-').map(Number);
    const d = new Date(y, m - 1 + delta, 1);
    const next = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    setMonth(next);
    setOpenDay(null);
  }

  return (
    <AppShell title="Lademittel">
      <p className="muted" style={{ marginBottom: '1rem' }}>
        Übersicht Lademitteltausch aus TourStopStatus und abgeschlossenen{' '}
        <Link href="/lager/lademittelscheine">Lager-Lademittelscheinen</Link>. Unter{' '}
        <strong>Partner-Saldo</strong> erscheinen die Mengen je Partner. Gebucht werden Matchcodes
        aus der PackagingType-CSV (EUP, RAH, GIBO, …).{' '}
        <Link href="/tours">Touren</Link>
        {' · '}
        <Link href="/tours/dashboard">Dispo-Dashboard</Link>
      </p>

      <div className="row" style={{ gap: '0.5rem', marginBottom: '1rem', flexWrap: 'wrap' }}>
        <button
          type="button"
          className={tab === 'no-exchange' ? 'btn btn-primary' : 'btn btn-secondary'}
          onClick={() => setTab('no-exchange')}
        >
          Nicht getauscht
        </button>
        <button
          type="button"
          className={tab === 'balances' ? 'btn btn-primary' : 'btn btn-secondary'}
          onClick={() => setTab('balances')}
        >
          Partner-Saldo
        </button>
      </div>

      <form className="row" onSubmit={onSearch} style={{ marginBottom: '1rem', gap: '0.75rem' }}>
        <label style={{ flex: 1 }}>
          Suche
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Kunde, Matchcode, Stadt…"
          />
        </label>
        {tab === 'no-exchange' ? (
          <>
            <label>
              Monat
              <input
                type="month"
                value={month}
                onChange={(e) => {
                  setMonth(e.target.value);
                  setOpenDay(null);
                }}
              />
            </label>
            <label>
              Ansicht
              <select
                value={groupBy}
                onChange={(e) => setGroupBy(e.target.value as 'day' | 'customer')}
              >
                <option value="day">Nach Tag</option>
                <option value="customer">Nach Kunde</option>
              </select>
            </label>
          </>
        ) : (
          <>
            <label>
              Lademittel
              <input
                value={matchcode}
                onChange={(e) => setMatchcode(e.target.value)}
                placeholder="z. B. EUP"
                style={{ width: '8rem' }}
              />
            </label>
            <label style={{ alignSelf: 'end', display: 'flex', gap: '0.4rem', alignItems: 'center' }}>
              <input
                type="checkbox"
                checked={showSkipped}
                onChange={(e) => setShowSkipped(e.target.checked)}
              />
              Übersprungene zeigen
            </label>
          </>
        )}
        <button type="submit" className="btn" style={{ alignSelf: 'end' }}>
          Filtern
        </button>
      </form>

      {error ? <p className="error">{error}</p> : null}

      {tab === 'no-exchange' ? (
        <>
          <div className="row" style={{ gap: '0.75rem', marginBottom: '1rem', alignItems: 'center' }}>
            <button type="button" className="btn btn-secondary" onClick={() => shiftMonth(-1)}>
              ←
            </button>
            <strong style={{ minWidth: '10rem', textAlign: 'center' }}>{monthLabel}</strong>
            <button type="button" className="btn btn-secondary" onClick={() => shiftMonth(1)}>
              →
            </button>
          </div>

          <p className="muted" style={{ marginBottom: '0.75rem' }}>
            Stops ohne Lademitteltausch inkl. <strong>Anzahl nicht getauschter</strong> Stück
            (aus Sendung, sonst mindestens 1 je gemeldetem Typ). Nur tauschrelevante Typen
            (z. B. EUP). <strong>EWP/HP werden nicht gebucht</strong>.
          </p>

          <div className="row" style={{ gap: '1rem', marginBottom: '1.25rem', flexWrap: 'wrap' }}>
            <div className="stat">
              <div className="label">Anzahl nicht getauscht</div>
              <div className="value">{overview?.totals.owedQuantity ?? 0}</div>
            </div>
            <div className="stat">
              <div className="label">Stops ohne Tausch</div>
              <div className="value">
                {overview?.totals.stopsWithoutExchange ?? overview?.totals.events ?? 0}
              </div>
            </div>
            <div className="stat">
              <div className="label">Kunden ohne Tausch</div>
              <div className="value">{overview?.totals.customers ?? 0}</div>
            </div>
            <div className="stat">
              <div className="label">Tage</div>
              <div className="value">{overview?.totals.days ?? 0}</div>
            </div>
            {overview?.totals.owedByMatchcode &&
            Object.keys(overview.totals.owedByMatchcode).length > 0 ? (
              <div className="stat">
                <div className="label">Anzahl nach Typ</div>
                <div className="value" style={{ fontSize: '1.1rem', lineHeight: 1.4 }}>
                  {Object.entries(overview.totals.owedByMatchcode)
                    .sort((a, b) => b[1] - a[1])
                    .map(([mc, n]) => (
                      <div key={mc}>
                        <code>{mc}</code> {n}
                      </div>
                    ))}
                </div>
              </div>
            ) : overview?.totals.byMatchcode &&
              Object.keys(overview.totals.byMatchcode).length > 0 ? (
              <div className="stat">
                <div className="label">Stops nach Typ</div>
                <div className="value" style={{ fontSize: '1.1rem', lineHeight: 1.4 }}>
                  {Object.entries(overview.totals.byMatchcode)
                    .sort((a, b) => b[1] - a[1])
                    .map(([mc, n]) => (
                      <div key={mc}>
                        <code>{mc}</code> {n}
                      </div>
                    ))}
                </div>
              </div>
            ) : null}
          </div>

          {loading ? (
            <p className="muted">Laden…</p>
          ) : groupBy === 'customer' ? (
            !overview?.customers?.length ? (
              <p className="muted">In diesem Monat keine gemeldeten Nicht-Tausche.</p>
            ) : (
              <div style={{ overflowX: 'auto' }}>
                <table className="table">
                  <thead>
                    <tr>
                      <th>Kunde</th>
                      <th>Nr.</th>
                      <th>Ort</th>
                      <th>Tage</th>
                      <th>Ereignisse</th>
                      <th>Anzahl</th>
                      <th>Lademittel</th>
                      <th>Zuletzt</th>
                    </tr>
                  </thead>
                  <tbody>
                    {overview.customers.map((c) => (
                      <tr key={`${c.partnerNumber}|${c.partnerName}`}>
                        <td>{c.partnerName}</td>
                        <td>{c.partnerNumber || '—'}</td>
                        <td>{c.partnerCity || '—'}</td>
                        <td>
                          <strong>{c.dayCount ?? c.days?.length ?? 0}</strong>
                          {c.days?.length ? (
                            <div className="muted" style={{ fontSize: '0.85em' }}>
                              {c.days.slice(0, 5).map(fmtDay).join(', ')}
                              {c.days.length > 5 ? ' …' : ''}
                            </div>
                          ) : null}
                        </td>
                        <td>{c.events}</td>
                        <td>
                          <strong>{fmtOwed(c.owedQuantity)}</strong>
                          {c.owedByMatchcode && Object.keys(c.owedByMatchcode).length > 0 ? (
                            <div className="muted" style={{ fontSize: '0.85em' }}>
                              {fmtOwedByMatchcode(c.packagingMatchcodes, c.owedByMatchcode)}
                            </div>
                          ) : null}
                        </td>
                        <td>
                          {c.packagingMatchcodes.map((mc) => (
                            <code key={mc} style={{ marginRight: '0.35rem' }}>
                              {mc}
                            </code>
                          ))}
                        </td>
                        <td>{fmt(c.lastAt)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )
          ) : !overview?.days?.length ? (
            <p className="muted">In diesem Monat keine gemeldeten Nicht-Tausche.</p>
          ) : (
            <div style={{ display: 'grid', gap: '0.75rem' }}>
              {overview.days.map((day) => {
                const open = openDay === day.date;
                return (
                  <section
                    key={day.date}
                    style={{
                      border: '1px solid var(--line)',
                      borderRadius: 'var(--radius-lg)',
                      background: 'var(--bg-panel)',
                      overflow: 'hidden',
                    }}
                  >
                    <button
                      type="button"
                      onClick={() => setOpenDay(open ? null : day.date)}
                      style={{
                        width: '100%',
                        textAlign: 'left',
                        border: 0,
                        background: open ? 'var(--wog-green-soft)' : 'transparent',
                        padding: '0.9rem 1.1rem',
                        cursor: 'pointer',
                        display: 'flex',
                        justifyContent: 'space-between',
                        gap: '1rem',
                        alignItems: 'center',
                      }}
                    >
                      <div>
                        <strong>{fmtDay(day.date)}</strong>
                        <div className="muted" style={{ fontSize: '0.9em' }}>
                          {day.customerCount} Kunde{day.customerCount === 1 ? '' : 'n'} ·{' '}
                          {day.eventCount} Stop{day.eventCount === 1 ? '' : 's'} ohne Tausch
                          {day.owedQuantity != null && day.owedQuantity > 0
                            ? ` · Anzahl ${day.owedQuantity}`
                            : ''}
                        </div>
                      </div>
                      <span className="muted">{open ? '▲' : '▼'}</span>
                    </button>
                    {open ? (
                      <div style={{ padding: '0 1rem 1rem', overflowX: 'auto' }}>
                        <table className="table">
                          <thead>
                            <tr>
                              <th>Kunde</th>
                              <th>Nr.</th>
                              <th>Ort</th>
                              <th>Tour</th>
                              <th>Typ</th>
                              <th>Anzahl</th>
                              <th>Lademittel</th>
                              <th>Zeit</th>
                            </tr>
                          </thead>
                          <tbody>
                            {day.customers.map((c, idx) => (
                              <tr key={`${c.partnerName}|${c.tourNumber}|${idx}`}>
                                <td>{c.partnerName}</td>
                                <td>{c.partnerNumber || '—'}</td>
                                <td>{c.partnerCity || '—'}</td>
                                <td>
                                  {c.tourId ? (
                                    <Link href={`/tours/${c.tourId}`}>{c.tourNumber}</Link>
                                  ) : (
                                    c.tourNumber || '—'
                                  )}
                                </td>
                                <td>{c.stopType || '—'}</td>
                                <td>
                                  <strong>{fmtOwed(c.owedQuantity)}</strong>
                                  {c.owedByMatchcode &&
                                  Object.values(c.owedByMatchcode).some((n) => n > 0) ? (
                                    <div className="muted" style={{ fontSize: '0.85em' }}>
                                      {fmtOwedByMatchcode(
                                        c.packagingMatchcodes,
                                        c.owedByMatchcode,
                                      )}
                                    </div>
                                  ) : null}
                                </td>
                                <td>
                                  {c.packagingMatchcodes.map((mc) => (
                                    <code key={mc} style={{ marginRight: '0.35rem' }}>
                                      {mc}
                                    </code>
                                  ))}
                                </td>
                                <td>{fmt(c.occurredAt)}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    ) : null}
                  </section>
                );
              })}
            </div>
          )}
        </>
      ) : (
        <>
          <div className="row" style={{ gap: '1rem', marginBottom: '1.25rem', flexWrap: 'wrap' }}>
            <div className="stat">
              <div className="label">Anzahl schuldend</div>
              <div className="value">{totals.owedQuantity}</div>
            </div>
            <div className="stat">
              <div className="label">Given</div>
              <div className="value">{totals.given}</div>
            </div>
            <div className="stat">
              <div className="label">Taken</div>
              <div className="value">{totals.taken}</div>
            </div>
            <div className="stat">
              <div className="label">Saldo (Given − Taken)</div>
              <div className="value">{totals.balance}</div>
            </div>
          </div>

          <div
            className="row"
            style={{ gap: '0.5rem', marginBottom: '1.25rem', flexWrap: 'wrap', alignItems: 'center' }}
          >
            <strong style={{ marginRight: '0.35rem' }}>Listen exportieren</strong>
            <button
              type="button"
              className="btn btn-secondary"
              onClick={() =>
                void downloadExport({
                  view: 'overview',
                  format: 'csv',
                  ...(q.trim() ? { q: q.trim() } : {}),
                  ...(matchcode.trim() ? { matchcode: matchcode.trim() } : {}),
                }).catch((e: Error) => setError(e.message))
              }
            >
              Übersicht CSV
            </button>
            <button
              type="button"
              className="btn btn-secondary"
              onClick={() =>
                void downloadExport({
                  view: 'overview',
                  format: 'csv-matrix',
                  ...(q.trim() ? { q: q.trim() } : {}),
                }).catch((e: Error) => setError(e.message))
              }
            >
              Matrix Offen CSV
            </button>
            <button
              type="button"
              className="btn btn-secondary"
              onClick={() =>
                void downloadExport({
                  view: 'overview',
                  format: 'pdf',
                  ...(q.trim() ? { q: q.trim() } : {}),
                  ...(matchcode.trim() ? { matchcode: matchcode.trim() } : {}),
                }).catch((e: Error) => setError(e.message))
              }
            >
              Übersicht PDF
            </button>
            {selectedPartner ? (
              <>
                <button
                  type="button"
                  className="btn btn-primary"
                  onClick={() =>
                    void downloadExport({
                      view: 'partner',
                      format: 'csv',
                      partnerName: selectedPartner,
                    }).catch((e: Error) => setError(e.message))
                  }
                >
                  Partner CSV · {selectedPartner}
                </button>
                <button
                  type="button"
                  className="btn btn-primary"
                  onClick={() =>
                    void downloadExport({
                      view: 'partner',
                      format: 'pdf',
                      partnerName: selectedPartner,
                    }).catch((e: Error) => setError(e.message))
                  }
                >
                  Partner PDF · {selectedPartner}
                </button>
              </>
            ) : (
              <span className="muted" style={{ fontSize: '0.9rem' }}>
                Partner in der Tabelle wählen für Partner-Liste (Total je Lademittel)
              </span>
            )}
          </div>

          <h2 style={{ fontSize: '1.1rem', marginBottom: '0.5rem' }}>
            Saldo nach Kunde
            <span className="muted" style={{ fontWeight: 400, fontSize: '0.9rem' }}>
              {' '}
              · {partnersAgg.length} Kunde{partnersAgg.length === 1 ? '' : 'n'}
            </span>
          </h2>
          <p className="muted" style={{ marginTop: 0, marginBottom: '0.75rem' }}>
            Eine Zeile je Kunde (Totals). Klick öffnet die Aufschlüsselung nach Lademittel.
          </p>
          {loading ? (
            <p className="muted">Laden…</p>
          ) : partnersAgg.length === 0 ? (
            <p className="muted">Noch keine gebuchten Lademitteltäusche.</p>
          ) : (
            <div style={{ marginBottom: '1.5rem', overflowX: 'auto' }}>
              <table className="table">
                <thead>
                  <tr>
                    <th>Kunde</th>
                    <th>Nr.</th>
                    <th>Ort</th>
                    <th>Lademittel</th>
                    <th>Übergabe</th>
                    <th>Übernahme</th>
                    <th>Offen</th>
                    <th>Saldo</th>
                    <th>Buchungen</th>
                    <th>Zuletzt</th>
                  </tr>
                </thead>
                <tbody>
                  {partnersAgg.map((r) => {
                    const active = selectedPartner === r.partnerName;
                    const typeSummary = r.types
                      .map((t) => `${t.packagingMatchcode} ${t.given}/${t.taken}`)
                      .join(' · ');
                    return (
                      <tr
                        key={r.partnerName}
                        style={{
                          cursor: 'pointer',
                          background: active ? 'var(--wog-green-soft)' : undefined,
                        }}
                        onClick={() => {
                          const next = active ? null : r.partnerName;
                          setSelectedPartner(next);
                          void loadBalances({ partnerName: next });
                        }}
                      >
                        <td>
                          <strong>{r.partnerName}</strong>
                          <span className="muted" style={{ marginLeft: '0.35rem' }}>
                            {active ? '▲' : '▼'}
                          </span>
                        </td>
                        <td>{r.partnerNumber || '—'}</td>
                        <td>{r.partnerCity || '—'}</td>
                        <td>
                          <span className="muted" style={{ fontSize: '0.9em' }}>
                            {typeSummary || '—'}
                          </span>
                        </td>
                        <td>{r.given}</td>
                        <td>{r.taken}</td>
                        <td>
                          <strong>{r.owedQuantity}</strong>
                        </td>
                        <td>{r.balance}</td>
                        <td>{r.postings}</td>
                        <td>{fmt(r.lastAt)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}

          {selectedPartner ? (
            <>
              <h2 style={{ fontSize: '1.1rem', marginBottom: '0.5rem' }}>
                {selectedPartner}
                <button
                  type="button"
                  className="btn btn-ghost"
                  style={{ marginLeft: '0.5rem', padding: '0.15rem 0.5rem' }}
                  onClick={() => {
                    setSelectedPartner(null);
                    void loadBalances({ partnerName: null });
                  }}
                >
                  Schliessen
                </button>
              </h2>

              <h3 style={{ fontSize: '1rem', margin: '0.75rem 0 0.4rem' }}>
                Total je Lademittel
              </h3>
              {selectedTypes.length === 0 ? (
                <p className="muted">Keine Typen.</p>
              ) : (
                <div style={{ marginBottom: '1.25rem', overflowX: 'auto' }}>
                  <table className="table">
                    <thead>
                      <tr>
                        <th>Typ</th>
                        <th>Übergabe</th>
                        <th>Übernahme</th>
                        <th>Offen</th>
                        <th>Saldo</th>
                        <th>Buchungen</th>
                      </tr>
                    </thead>
                    <tbody>
                      {selectedTypes.map((t) => (
                        <tr key={t.packagingMatchcode}>
                          <td>
                            <code>{t.packagingMatchcode}</code>
                            {t.packagingLabel ? (
                              <span className="muted"> · {t.packagingLabel}</span>
                            ) : null}
                          </td>
                          <td>{t.given}</td>
                          <td>{t.taken}</td>
                          <td>
                            <strong>{t.owedQuantity ?? Math.max(0, t.balance)}</strong>
                          </td>
                          <td>{t.balance}</td>
                          <td>{t.postings}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              <h3 style={{ fontSize: '1rem', margin: '0.75rem 0 0.4rem' }}>
                Einzelbuchungen
              </h3>
              {postings.length === 0 ? (
                <p className="muted">Keine Einzelbuchungen.</p>
              ) : (
                <div style={{ overflowX: 'auto' }}>
                  <table className="table">
                    <thead>
                      <tr>
                        <th>Zeit</th>
                        <th>Typ</th>
                        <th>Übergabe</th>
                        <th>Übernahme</th>
                        <th>Offen</th>
                        <th>Δ</th>
                        <th>Tour</th>
                        <th>Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {postings.map((p) => (
                        <tr key={p.id}>
                          <td>{fmt(p.occurredAt)}</td>
                          <td>
                            <code>{p.packagingMatchcode}</code>
                          </td>
                          <td>{p.given}</td>
                          <td>{p.taken}</td>
                          <td>
                            <strong>
                              {fmtOwed(p.owedQuantity ?? Math.max(0, p.balanceDelta))}
                            </strong>
                          </td>
                          <td>{p.balanceDelta}</td>
                          <td>
                            {p.tour?.id ? (
                              <Link href={`/tours/${p.tour.id}`}>{p.tour.tourNumber}</Link>
                            ) : (
                              p.tourNumber || '—'
                            )}
                          </td>
                          <td>
                            {p.status === 'BOOKED'
                              ? 'Gebucht'
                              : p.status === 'SKIPPED_ZERO'
                                ? 'Kein Tausch'
                                : (
                                  <span title={p.skipReason || undefined} className="muted">
                                    {p.status === 'SKIPPED_UNKNOWN_TYPE'
                                      ? 'Unbekannter Typ'
                                      : p.status}
                                  </span>
                                )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </>
          ) : null}
        </>
      )}
    </AppShell>
  );
}
