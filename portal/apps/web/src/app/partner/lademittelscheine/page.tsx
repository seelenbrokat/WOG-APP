'use client';

import { useEffect, useState } from 'react';
import { AppShell } from '@/components/AppShell';
import { api, getToken } from '@/lib/api';

type Schein = {
  id: string;
  number: string;
  status: string;
  tourNumber?: string | null;
  vehiclePlate?: string | null;
  occurredAt: string;
  eupOut: number;
  eupIn: number;
  rahmenOut?: number;
  rahmenIn?: number;
  deckelOut?: number;
  deckelIn?: number;
  gitterboxOut?: number;
  gitterboxIn?: number;
};

type BalanceRow = {
  packagingMatchcode: string;
  packagingLabel?: string | null;
  given: number;
  taken: number;
  balance: number;
  owedQuantity: number;
  postings: number;
  lastAt?: string | null;
};

export default function PartnerLademittelscheinePage() {
  const [rows, setRows] = useState<Schein[]>([]);
  const [balances, setBalances] = useState<BalanceRow[]>([]);
  const [totals, setTotals] = useState({ given: 0, taken: 0, balance: 0, owedQuantity: 0 });
  const [error, setError] = useState('');

  useEffect(() => {
    Promise.all([
      api<Schein[]>('/lager/lademittelscheine/partner'),
      api<{ balances: BalanceRow[]; totals: typeof totals }>(
        '/lager/lademittelscheine/partner/balances',
      ),
    ])
      .then(([scheine, bal]) => {
        setRows(scheine);
        setBalances(bal.balances || []);
        setTotals(bal.totals || { given: 0, taken: 0, balance: 0, owedQuantity: 0 });
      })
      .catch((e: any) => setError(e?.message || 'Laden fehlgeschlagen'));
  }, []);

  async function openPdf(id: string) {
    const res = await fetch(`${process.env.NEXT_PUBLIC_API_URL || '/api'}/lager/lademittelscheine/${id}/pdf`, {
      headers: { Authorization: `Bearer ${getToken()}` },
    });
    if (!res.ok) throw new Error('PDF nicht verfügbar');
    const blob = await res.blob();
    window.open(URL.createObjectURL(blob), '_blank');
  }

  return (
    <AppShell title="Lademittelverwaltung" eyebrow="Partner">
      <p className="muted" style={{ marginTop: 0 }}>
        Ihr Partner-Saldo aus Lademittelscheinen (Lager) und Tour-Telematik – inkl. Schein-PDFs.
      </p>
      {error && <div className="error">{error}</div>}

      <div className="row" style={{ gap: '1rem', marginBottom: '1.25rem', flexWrap: 'wrap' }}>
        <div className="stat">
          <div className="label">WOG übergab (given)</div>
          <div className="value">{totals.given}</div>
        </div>
        <div className="stat">
          <div className="label">WOG übernahm (taken)</div>
          <div className="value">{totals.taken}</div>
        </div>
        <div className="stat">
          <div className="label">Saldo</div>
          <div className="value">{totals.balance}</div>
        </div>
        <div className="stat">
          <div className="label">Offen (schuldend)</div>
          <div className="value">{totals.owedQuantity}</div>
        </div>
      </div>

      <div className="panel" style={{ marginBottom: '1.25rem' }}>
        <strong>Partner-Saldo nach Typ</strong>
        <table className="table" style={{ marginTop: '0.75rem' }}>
          <thead>
            <tr>
              <th>Typ</th>
              <th>Übergabe</th>
              <th>Übernahme</th>
              <th>Saldo</th>
              <th>Offen</th>
            </tr>
          </thead>
          <tbody>
            {balances.map((b) => (
              <tr key={b.packagingMatchcode}>
                <td>
                  <code>{b.packagingMatchcode}</code>
                  {b.packagingLabel ? (
                    <span className="meta"> {b.packagingLabel}</span>
                  ) : null}
                </td>
                <td>{b.given}</td>
                <td>{b.taken}</td>
                <td>{b.balance}</td>
                <td>{b.owedQuantity}</td>
              </tr>
            ))}
            {!balances.length && (
              <tr>
                <td colSpan={5} className="muted">
                  Noch kein Saldo – sobald Scheine abgeschlossen sind, erscheinen die Mengen hier.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <div className="panel">
        <strong>Lademittelscheine</strong>
        <table className="table" style={{ marginTop: '0.75rem' }}>
          <thead>
            <tr>
              <th>Nummer</th>
              <th>Tour</th>
              <th>EUP raus / rein</th>
              <th>Datum</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id}>
                <td><strong>{r.number}</strong></td>
                <td>{r.tourNumber || '—'}{r.vehiclePlate ? ` · ${r.vehiclePlate}` : ''}</td>
                <td>{r.eupOut} / {r.eupIn}</td>
                <td>{new Date(r.occurredAt).toLocaleString('de-AT')}</td>
                <td>
                  <button type="button" className="btn btn-secondary" onClick={() => void openPdf(r.id)}>
                    PDF
                  </button>
                </td>
              </tr>
            ))}
            {!rows.length && (
              <tr>
                <td colSpan={5} className="muted">Noch keine Scheine.</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </AppShell>
  );
}
