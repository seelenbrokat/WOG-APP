'use client';

import Link from 'next/link';
import { FormEvent, useEffect, useState } from 'react';
import { AppShell } from '@/components/AppShell';
import { api } from '@/lib/api';

type BalanceRow = {
  partnerNumber: string | null;
  partnerName: string;
  partnerCity: string | null;
  packagingMatchcode: string;
  packagingLabel: string | null;
  given: number;
  taken: number;
  balance: number;
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

export default function LademittelPage() {
  const [q, setQ] = useState('');
  const [matchcode, setMatchcode] = useState('');
  const [balances, setBalances] = useState<BalanceRow[]>([]);
  const [totals, setTotals] = useState({ given: 0, taken: 0, balance: 0 });
  const [postings, setPostings] = useState<Posting[]>([]);
  const [selectedPartner, setSelectedPartner] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [showSkipped, setShowSkipped] = useState(false);

  async function load(next?: { q?: string; matchcode?: string; partnerName?: string | null }) {
    setLoading(true);
    setError('');
    try {
      const qq = next?.q ?? q;
      const mc = next?.matchcode ?? matchcode;
      const partnerName = next?.partnerName === undefined ? selectedPartner : next.partnerName;
      const balParams = new URLSearchParams();
      if (qq.trim()) balParams.set('q', qq.trim());
      if (mc.trim()) balParams.set('matchcode', mc.trim());
      const postParams = new URLSearchParams();
      if (qq.trim()) postParams.set('q', qq.trim());
      if (mc.trim()) postParams.set('matchcode', mc.trim());
      if (partnerName) postParams.set('partnerName', partnerName);
      if (showSkipped) postParams.set('includeSkipped', '1');
      postParams.set('take', '150');

      const [bal, posts] = await Promise.all([
        api<{ balances: BalanceRow[]; totals: { given: number; taken: number; balance: number } }>(
          `/tours/loading-units/balances?${balParams}`,
        ),
        api<Posting[]>(`/tours/loading-units/postings?${postParams}`),
      ]);
      setBalances(bal.balances);
      setTotals(bal.totals);
      setPostings(posts);
    } catch (e: any) {
      setError(e.message || 'Laden fehlgeschlagen');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showSkipped]);

  function onSearch(e: FormEvent) {
    e.preventDefault();
    void load();
  }

  return (
    <AppShell title="Lademittel">
      <p className="muted" style={{ marginBottom: '1rem' }}>
        Partner-Saldo aus TourStopStatus (Given / Taken). Gebucht werden nur Matchcodes aus der
        PackagingType-CSV.{' '}
        <Link href="/tours">Touren</Link>
        {' · '}
        <Link href="/tours/dashboard">Dispo-Dashboard</Link>
      </p>

      <form className="row" onSubmit={onSearch} style={{ marginBottom: '1rem', gap: '0.75rem' }}>
        <label style={{ flex: 1 }}>
          Suche
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Partner, Matchcode, Stadt…"
          />
        </label>
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
        <button type="submit" className="btn" style={{ alignSelf: 'end' }}>
          Filtern
        </button>
      </form>

      {error ? <p className="error">{error}</p> : null}

      <div className="row" style={{ gap: '1rem', marginBottom: '1.25rem', flexWrap: 'wrap' }}>
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

      <h2 style={{ fontSize: '1.1rem', marginBottom: '0.5rem' }}>Partner-Salden</h2>
      {loading ? (
        <p className="muted">Laden…</p>
      ) : balances.length === 0 ? (
        <p className="muted">Noch keine gebuchten Lademitteltäusche.</p>
      ) : (
        <div style={{ marginBottom: '1.5rem', overflowX: 'auto' }}>
          <table className="table">
            <thead>
              <tr>
                <th>Partner</th>
                <th>Nr.</th>
                <th>Ort</th>
                <th>Typ</th>
                <th>Given</th>
                <th>Taken</th>
                <th>Saldo</th>
                <th>Buchungen</th>
                <th>Zuletzt</th>
              </tr>
            </thead>
            <tbody>
              {balances.map((r) => {
                const key = `${r.partnerName}|${r.packagingMatchcode}|${r.partnerNumber || ''}`;
                const active = selectedPartner === r.partnerName;
                return (
                  <tr
                    key={key}
                    style={{ cursor: 'pointer', background: active ? 'var(--wog-green-soft)' : undefined }}
                    onClick={() => {
                      const next = active ? null : r.partnerName;
                      setSelectedPartner(next);
                      void load({ partnerName: next });
                    }}
                  >
                    <td>{r.partnerName}</td>
                    <td>{r.partnerNumber || '—'}</td>
                    <td>{r.partnerCity || '—'}</td>
                    <td>
                      <code>{r.packagingMatchcode}</code>
                      {r.packagingLabel ? (
                        <span className="muted"> · {r.packagingLabel}</span>
                      ) : null}
                    </td>
                    <td>{r.given}</td>
                    <td>{r.taken}</td>
                    <td>
                      <strong>{r.balance}</strong>
                    </td>
                    <td>{r.postings}</td>
                    <td>{fmt(r.lastAt)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <h2 style={{ fontSize: '1.1rem', marginBottom: '0.5rem' }}>
        Einzelbuchungen
        {selectedPartner ? (
          <span className="muted" style={{ fontWeight: 400 }}>
            {' '}
            · {selectedPartner}{' '}
            <button
              type="button"
              className="btn-ghost"
              style={{ marginLeft: '0.5rem', padding: '0.15rem 0.5rem' }}
              onClick={() => {
                setSelectedPartner(null);
                void load({ partnerName: null });
              }}
            >
              Filter lösen
            </button>
          </span>
        ) : null}
      </h2>
      {postings.length === 0 ? (
        <p className="muted">Keine Buchungen für die aktuelle Auswahl.</p>
      ) : (
        <div style={{ overflowX: 'auto' }}>
          <table className="table">
            <thead>
              <tr>
                <th>Zeit</th>
                <th>Partner</th>
                <th>Typ</th>
                <th>Given</th>
                <th>Taken</th>
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
                    {p.partnerName || '—'}
                    {p.partnerCity ? (
                      <div className="muted" style={{ fontSize: '0.85em' }}>
                        {p.partnerCity}
                      </div>
                    ) : null}
                  </td>
                  <td>
                    <code>{p.packagingMatchcode}</code>
                  </td>
                  <td>{p.given}</td>
                  <td>{p.taken}</td>
                  <td>{p.balanceDelta}</td>
                  <td>
                    {p.tour?.id ? (
                      <Link href={`/tours/${p.tour.id}`}>{p.tour.tourNumber}</Link>
                    ) : (
                      p.tourNumber || '—'
                    )}
                  </td>
                  <td>
                    {p.status === 'BOOKED' ? (
                      'Gebucht'
                    ) : (
                      <span title={p.skipReason || undefined} className="muted">
                        {p.status === 'SKIPPED_UNKNOWN_TYPE' ? 'Unbekannter Typ' : p.status}
                      </span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </AppShell>
  );
}
