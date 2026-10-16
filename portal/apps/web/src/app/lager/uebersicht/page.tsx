'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { AppShell } from '@/components/AppShell';
import { api } from '@/lib/api';

type Overview = {
  summary: {
    warehouseCustomers: number;
    storedUnits: number;
    usedSlots: number;
    capacitySlots: number;
    freeSlots: number;
    occupiedLocations: number;
    locationCount: number;
  };
  customers: Array<{
    customer: {
      id: string;
      name: string;
      customerNumber: string;
      matchcode?: string | null;
      email?: string | null;
    };
    unitCount: number;
    slotUnits: number;
    byPalletType: Record<string, { count: number; slotUnits: number }>;
    locationCount: number;
    locationSample: string[];
  }>;
  palletLabels: Record<string, string>;
};

export default function LagerUebersichtPage() {
  const [data, setData] = useState<Overview | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    api<Overview>('/warehouse/overview')
      .then(setData)
      .catch((e) => setError(e.message));
  }, []);

  const s = data?.summary;

  return (
    <AppShell title="Lager-Übersicht" eyebrow="Lagerverwaltung">
      <p className="muted" style={{ marginTop: 0 }}>
        Alle Kunden mit Checkbox <strong>Lagerkunde</strong> und aktuellem Bestand.
      </p>

      <div className="row" style={{ gap: '0.75rem', flexWrap: 'wrap', marginBottom: '1rem' }}>
        <Link className="btn btn-primary" href="/lager/einlagern">
          Einlagern
        </Link>
        <Link className="btn btn-ghost" href="/lager/artikel">
          Artikel
        </Link>
        <Link className="btn btn-ghost" href="/lager/bestand">
          Bestand
        </Link>
        <Link className="btn btn-ghost" href="/lager/plaetze">
          Plätze
        </Link>
        <Link className="btn btn-ghost" href="/customers">
          Kunden (Lagerkunde setzen)
        </Link>
      </div>

      {error ? <p className="error">{error}</p> : null}

      {s ? (
        <div
          className="row"
          style={{ gap: '0.75rem', flexWrap: 'wrap', marginBottom: '1rem' }}
        >
          <div className="panel" style={{ minWidth: 140 }}>
            <div className="muted" style={{ fontSize: '0.8rem' }}>
              Lagerkunden
            </div>
            <strong style={{ fontSize: '1.4rem' }}>{s.warehouseCustomers}</strong>
          </div>
          <div className="panel" style={{ minWidth: 140 }}>
            <div className="muted" style={{ fontSize: '0.8rem' }}>
              Paletten eingelagert
            </div>
            <strong style={{ fontSize: '1.4rem' }}>{s.storedUnits}</strong>
          </div>
          <div className="panel" style={{ minWidth: 160 }}>
            <div className="muted" style={{ fontSize: '0.8rem' }}>
              Stellplätze belegt
            </div>
            <strong style={{ fontSize: '1.4rem' }}>
              {s.usedSlots.toFixed(1)} / {s.capacitySlots.toFixed(1)}
            </strong>
          </div>
          <div className="panel" style={{ minWidth: 140 }}>
            <div className="muted" style={{ fontSize: '0.8rem' }}>
              Plätze mit Ware
            </div>
            <strong style={{ fontSize: '1.4rem' }}>
              {s.occupiedLocations} / {s.locationCount}
            </strong>
          </div>
        </div>
      ) : null}

      <div className="panel" style={{ overflowX: 'auto' }}>
        <table className="table">
          <thead>
            <tr>
              <th>Kunde</th>
              <th>Paletten</th>
              <th>Stellplätze</th>
              <th>Typen</th>
              <th>Plätze</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {(data?.customers || []).map((row) => {
              const types = Object.entries(row.byPalletType)
                .map(([code, v]) => {
                  const label = data?.palletLabels?.[code] || code;
                  return `${label}: ${v.count}`;
                })
                .join(' · ');
              return (
                <tr key={row.customer.id}>
                  <td>
                    <strong>{row.customer.name}</strong>
                    <div className="muted" style={{ fontSize: '0.85rem' }}>
                      Nr. {row.customer.customerNumber}
                      {row.customer.matchcode ? ` · ${row.customer.matchcode}` : ''}
                    </div>
                  </td>
                  <td>{row.unitCount}</td>
                  <td>{row.slotUnits.toFixed(1)}</td>
                  <td className="muted">{types || '–'}</td>
                  <td className="muted">
                    {row.locationCount
                      ? `${row.locationCount}${
                          row.locationSample.length
                            ? ` (${row.locationSample.join(', ')}${
                                row.locationCount > row.locationSample.length ? '…' : ''
                              })`
                            : ''
                        }`
                      : '–'}
                  </td>
                  <td>
                    <Link
                      className="btn btn-ghost"
                      href={`/lager/bestand?customerId=${encodeURIComponent(row.customer.id)}`}
                      style={{ padding: '0.25rem 0.5rem', fontSize: '0.85rem' }}
                    >
                      Bestand
                    </Link>
                  </td>
                </tr>
              );
            })}
            {data && !data.customers.length ? (
              <tr>
                <td colSpan={6} className="muted">
                  Noch keine Lagerkunden. Unter Kunden die Checkbox „Lagerkunde“ setzen.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </AppShell>
  );
}
