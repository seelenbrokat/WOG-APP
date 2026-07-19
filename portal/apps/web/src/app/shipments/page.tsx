'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { AppShell } from '@/components/AppShell';
import { api, getUser, statusLabel } from '@/lib/api';

export default function ShipmentsPage() {
  const [shipments, setShipments] = useState<any[]>([]);
  const [mandanten, setMandanten] = useState<any[]>([]);
  const [mandantId, setMandantId] = useState('');

  async function load(filter?: string) {
    const q = filter ? `?mandantId=${filter}` : '';
    setShipments(await api(`/shipments${q}`));
  }

  useEffect(() => {
    api<any[]>('/mandanten').then(setMandanten);
    load();
  }, []);

  const user = getUser();

  return (
    <AppShell title="Sendungen">
      <div className="row" style={{ marginBottom: '1rem' }}>
        <select
          value={mandantId}
          onChange={(e) => {
            setMandantId(e.target.value);
            load(e.target.value || undefined);
          }}
        >
          <option value="">Alle Mandanten</option>
          {mandanten.map((m) => (
            <option key={m.id} value={m.id}>{m.name}</option>
          ))}
        </select>
        {(user?.role === 'ORG_ADMIN' || user?.role === 'CUSTOMER_USER' || user?.role === 'MANDANT_DISPATCHER') && (
          <Link className="btn btn-primary" href="/shipments/new">Neuer Auftrag</Link>
        )}
      </div>
      <div className="panel">
        <table className="table">
          <thead>
            <tr>
              <th>Tracking</th>
              <th>Referenz</th>
              <th>Mandant</th>
              <th>Von</th>
              <th>Nach</th>
              <th>Status</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {shipments.map((s) => (
              <tr key={s.id}>
                <td>{s.trackingNumber}</td>
                <td>{s.reference || '–'}</td>
                <td>{s.mandant?.name}</td>
                <td>{s.pickupCity || '–'}</td>
                <td>{s.deliveryCity || '–'}</td>
                <td><span className="badge">{statusLabel(s.status)}</span></td>
                <td><Link href={`/shipments/${s.id}`}>Details</Link></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </AppShell>
  );
}
