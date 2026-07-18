'use client';

import { FormEvent, useEffect, useState } from 'react';
import { AppShell } from '@/components/AppShell';
import { api, getUser } from '@/lib/api';

export default function CustomersPage() {
  const user = getUser();
  const [customers, setCustomers] = useState<any[]>([]);
  const [form, setForm] = useState({ customerNumber: '', name: '', email: '', phone: '' });
  const canEdit = user?.role === 'ORG_ADMIN' || user?.role === 'MANDANT_DISPATCHER';

  async function load() {
    setCustomers(await api('/customers'));
  }

  useEffect(() => {
    load().catch(console.error);
  }, []);

  async function onCreate(e: FormEvent) {
    e.preventDefault();
    await api('/customers', { method: 'POST', body: JSON.stringify(form) });
    setForm({ customerNumber: '', name: '', email: '', phone: '' });
    await load();
  }

  return (
    <AppShell title="Kundenverwaltung">
      {canEdit && (
        <form className="panel stack" style={{ marginBottom: '1rem' }} onSubmit={onCreate}>
          <strong>Neuer Kunde</strong>
          <div className="grid-2">
            <input required placeholder="Kundennummer" value={form.customerNumber} onChange={(e) => setForm({ ...form, customerNumber: e.target.value })} />
            <input required placeholder="Name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
            <input placeholder="E-Mail" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
            <input placeholder="Telefon" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
          </div>
          <button className="btn btn-primary" type="submit">Anlegen</button>
        </form>
      )}
      <div className="panel">
        <table className="table">
          <thead>
            <tr>
              <th>Nr.</th>
              <th>Name</th>
              <th>E-Mail</th>
              <th>Telefon</th>
              <th>Adressen</th>
            </tr>
          </thead>
          <tbody>
            {customers.map((c) => (
              <tr key={c.id}>
                <td>{c.customerNumber}</td>
                <td>{c.name}</td>
                <td>{c.email || '–'}</td>
                <td>{c.phone || '–'}</td>
                <td>{c.addresses?.length || 0}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </AppShell>
  );
}
