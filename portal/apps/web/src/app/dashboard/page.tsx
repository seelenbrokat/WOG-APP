'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { AppShell } from '@/components/AppShell';
import { api, getUser, statusLabel } from '@/lib/api';

export default function DashboardPage() {
  const user = getUser();
  const isCustomer = user?.role === 'CUSTOMER_USER';
  const [shipments, setShipments] = useState<any[]>([]);
  const [mandanten, setMandanten] = useState<any[]>([]);
  const [q, setQ] = useState('');

  useEffect(() => {
    const params = new URLSearchParams();
    if (q.trim()) params.set('q', q.trim());
    const qs = params.toString();
    const t = window.setTimeout(() => {
      Promise.all([
        api<any[]>(`/shipments${qs ? `?${qs}` : ''}`),
        isCustomer ? Promise.resolve([]) : api<any[]>('/mandanten').catch(() => []),
      ])
        .then(([s, m]) => {
          setShipments(s);
          setMandanten(m);
        })
        .catch(console.error);
    }, 280);
    return () => window.clearTimeout(t);
  }, [q, isCustomer]);

  const open = useMemo(
    () => shipments.filter((s) => !['DELIVERED', 'CANCELLED'].includes(s.status)).length,
    [shipments],
  );

  const rows = shipments.slice(0, q.trim() ? 50 : 12);

  return (
    <AppShell title="Übersicht">
      <div className="grid-3" style={{ marginBottom: '1.25rem' }}>
        <div className="stat">
          <div className="label">Sendungen</div>
          <div className="value">{shipments.length}</div>
        </div>
        <div className="stat">
          <div className="label">Offen</div>
          <div className="value">{open}</div>
        </div>
        <div className="stat">
          <div className="label">{isCustomer ? 'Treffer' : 'Mandanten'}</div>
          <div className="value">{isCustomer ? rows.length : mandanten.length}</div>
        </div>
      </div>
      <div className="panel">
        <div className="row" style={{ justifyContent: 'space-between', marginBottom: '1rem', flexWrap: 'wrap', gap: '0.65rem' }}>
          <div style={{ flex: '1 1 220px' }}>
            <strong className="panel-title">Letzte Sendungen</strong>
            <p className="muted" style={{ margin: 0, fontSize: '0.92rem' }}>
              {isCustomer ? 'Ihre Aufträge im Überblick' : 'Aktuelle Aufträge im Überblick'}
            </p>
          </div>
          <input
            type="search"
            placeholder="Suche: Empfänger, Tracking, Referenz…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            style={{ minWidth: 240, flex: '1 1 200px' }}
            aria-label="Übersicht durchsuchen"
          />
          <Link className="btn btn-primary" href="/shipments/new">Neuer Auftrag</Link>
        </div>
        <table className="table">
          <thead>
            <tr>
              <th>Tracking</th>
              <th>Referenz</th>
              {!isCustomer && <th>Mandant</th>}
              {!isCustomer && <th>Kunde</th>}
              <th>Empfänger</th>
              <th>Ort</th>
              <th>Status</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {rows.map((s) => (
              <tr key={s.id}>
                <td>{s.trackingNumber}</td>
                <td>{s.reference || '–'}</td>
                {!isCustomer && <td>{s.mandant?.name}</td>}
                {!isCustomer && <td>{s.customer?.name}</td>}
                <td>{s.deliveryCompany || '–'}</td>
                <td>{[s.deliveryZip, s.deliveryCity].filter(Boolean).join(' ') || '–'}</td>
                <td><span className="badge">{statusLabel(s.status)}</span></td>
                <td><Link href={`/shipments/${s.id}`}>Öffnen</Link></td>
              </tr>
            ))}
            {!rows.length && (
              <tr>
                <td colSpan={isCustomer ? 6 : 8} className="muted">
                  {q.trim() ? 'Keine Treffer.' : 'Keine Sendungen.'}
                </td>
              </tr>
            )}
          </tbody>
        </table>
        {shipments.length > rows.length && !q.trim() && (
          <p className="muted" style={{ marginTop: '0.75rem' }}>
            <Link href="/shipments">Alle Sendungen anzeigen</Link>
          </p>
        )}
      </div>
    </AppShell>
  );
}
