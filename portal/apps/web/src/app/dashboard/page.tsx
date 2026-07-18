'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { AppShell } from '@/components/AppShell';
import { api, statusLabel } from '@/lib/api';

export default function DashboardPage() {
  const [shipments, setShipments] = useState<any[]>([]);
  const [mandanten, setMandanten] = useState<any[]>([]);

  useEffect(() => {
    Promise.all([
      api<any[]>('/shipments'),
      api<any[]>('/mandanten'),
    ]).then(([s, m]) => {
      setShipments(s);
      setMandanten(m);
    }).catch(console.error);
  }, []);

  const open = shipments.filter((s) => !['DELIVERED', 'CANCELLED'].includes(s.status)).length;

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
          <div className="label">Mandanten</div>
          <div className="value">{mandanten.length}</div>
        </div>
      </div>
      <div className="panel">
        <div className="row" style={{ justifyContent: 'space-between', marginBottom: '1rem' }}>
          <div>
            <strong className="panel-title">Letzte Sendungen</strong>
            <p className="muted" style={{ margin: 0, fontSize: '0.92rem' }}>Aktuelle Aufträge im Überblick</p>
          </div>
          <Link className="btn btn-primary" href="/shipments/new">Neuer Auftrag</Link>
        </div>
        <table className="table">
          <thead>
            <tr>
              <th>Tracking</th>
              <th>Mandant</th>
              <th>Kunde</th>
              <th>Status</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {shipments.slice(0, 8).map((s) => (
              <tr key={s.id}>
                <td>{s.trackingNumber}</td>
                <td>{s.mandant?.name}</td>
                <td>{s.customer?.name}</td>
                <td><span className="badge">{statusLabel(s.status)}</span></td>
                <td><Link href={`/shipments/${s.id}`}>Öffnen</Link></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </AppShell>
  );
}
