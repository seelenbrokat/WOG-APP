'use client';

import { useEffect, useState } from 'react';
import { AppShell } from '@/components/AppShell';
import { api, getUser } from '@/lib/api';

type Billing = {
  year: number;
  month: number;
  currency: string;
  totals: { inbound: number; outbound: number; storage: number; grand: number };
  customers: Array<{
    customer: { id: string; name: string; customerNumber: string };
    inbound: { count: number; amount: number };
    outbound: { count: number; amount: number };
    storage: {
      amount: number;
      byPalletType: Record<
        string,
        { peakSlots: number; peakDay: string; fee: number; amount: number }
      >;
    };
    total: number;
  }>;
};

export default function LagerAbrechnungPage() {
  const user = getUser();
  const isCustomer = user?.role === 'CUSTOMER_USER';
  const now = new Date();
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth() + 1);
  const [data, setData] = useState<Billing | null>(null);
  const [error, setError] = useState('');

  async function load(y = year, m = month) {
    setError('');
    const res = await api<Billing>(`/warehouse/billing/monthly?year=${y}&month=${m}`);
    setData(res);
  }

  useEffect(() => {
    load().catch((e) => setError(e.message));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <AppShell title="Lager-Abrechnung" eyebrow="Lagerverwaltung">
      <p className="muted" style={{ marginTop: 0 }}>
        Monatshöchststand (Stellplätze je Palettentyp) + Ein-/Auslagergebühren.
      </p>

      <div className="row" style={{ gap: '0.5rem', marginBottom: '1rem', flexWrap: 'wrap' }}>
        <input
          type="number"
          value={year}
          onChange={(e) => setYear(Number(e.target.value))}
          style={{ width: 100 }}
        />
        <select value={month} onChange={(e) => setMonth(Number(e.target.value))}>
          {Array.from({ length: 12 }, (_, i) => i + 1).map((m) => (
            <option key={m} value={m}>
              {String(m).padStart(2, '0')}
            </option>
          ))}
        </select>
        <button
          className="btn btn-primary"
          type="button"
          onClick={() => load().catch((e) => setError(e.message))}
        >
          Laden
        </button>
      </div>

      {error ? <p className="error">{error}</p> : null}

      {data && (
        <>
          <div className="panel" style={{ marginBottom: '1rem' }}>
            <strong>
              Summe {data.month}/{data.year}
            </strong>
            <p style={{ margin: '0.4rem 0 0' }}>
              Einlagerung {data.totals.inbound.toFixed(2)} € · Auslagerung{' '}
              {data.totals.outbound.toFixed(2)} € · Lagerung {data.totals.storage.toFixed(2)} € ·{' '}
              <strong>Gesamt {data.totals.grand.toFixed(2)} €</strong>
            </p>
          </div>

          {data.customers.map((row) => (
            <div key={row.customer.id} className="panel" style={{ marginBottom: '0.75rem' }}>
              {!isCustomer && (
                <strong>
                  {row.customer.name} ({row.customer.customerNumber})
                </strong>
              )}
              {isCustomer && <strong>Ihre Lagerkosten</strong>}
              <p className="muted" style={{ margin: '0.35rem 0' }}>
                Ein: {row.inbound.count} / {row.inbound.amount.toFixed(2)} € · Aus:{' '}
                {row.outbound.count} / {row.outbound.amount.toFixed(2)} € · Lager:{' '}
                {row.storage.amount.toFixed(2)} € · <strong>{row.total.toFixed(2)} €</strong>
              </p>
              <table className="table">
                <thead>
                  <tr>
                    <th>Typ</th>
                    <th>Höchststand (Slots)</th>
                    <th>Tag</th>
                    <th>€/Slot</th>
                    <th>Betrag</th>
                  </tr>
                </thead>
                <tbody>
                  {Object.entries(row.storage.byPalletType)
                    .filter(([, v]) => v.peakSlots > 0 || v.amount > 0)
                    .map(([t, v]) => (
                      <tr key={t}>
                        <td>{t}</td>
                        <td>{v.peakSlots}</td>
                        <td>{v.peakDay}</td>
                        <td>{v.fee.toFixed(2)}</td>
                        <td>{v.amount.toFixed(2)}</td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>
          ))}
          {!data.customers.length && <p className="muted">Keine Bewegungen/Bestand in diesem Monat.</p>}
        </>
      )}
    </AppShell>
  );
}
