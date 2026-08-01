'use client';

import { FormEvent, useEffect, useState } from 'react';
import { AppShell } from '@/components/AppShell';
import { api, getUser } from '@/lib/api';

export default function MandantenPage() {
  const user = getUser();
  const [mandanten, setMandanten] = useState<any[]>([]);
  const [form, setForm] = useState({ code: '', name: '', legalName: '' });

  async function load() {
    setMandanten(await api('/mandanten'));
  }

  useEffect(() => {
    load().catch(console.error);
  }, []);

  async function onCreate(e: FormEvent) {
    e.preventDefault();
    await api('/mandanten', { method: 'POST', body: JSON.stringify(form) });
    setForm({ code: '', name: '', legalName: '' });
    await load();
  }

  return (
    <AppShell title="Mandantenverwaltung">
      <p className="muted" style={{ marginBottom: '1rem' }}>
        Organisation WOG Logistics mit Mandanten WOG AG und WOG GmbH. Kunden können an beide Aufträge erteilen; die Sichtbarkeit der Sendungen bleibt mandantenseitig getrennt.
      </p>
      {user?.role === 'ORG_ADMIN' && (
        <form className="panel stack" style={{ marginBottom: '1rem' }} onSubmit={onCreate}>
          <strong>Mandant anlegen</strong>
          <div className="grid-3">
            <input required placeholder="Code (z.B. AG)" value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value })} />
            <input required placeholder="Name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
            <input placeholder="Firmenname" value={form.legalName} onChange={(e) => setForm({ ...form, legalName: e.target.value })} />
          </div>
          <button className="btn btn-primary" type="submit">Speichern</button>
        </form>
      )}
      <div className="panel">
        <table className="table">
          <thead>
            <tr>
              <th>Code</th>
              <th>Name</th>
              <th>Rechtlicher Name</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {mandanten.map((m) => (
              <tr key={m.id}>
                <td>{m.code}</td>
                <td>{m.name}</td>
                <td>{m.legalName || '–'}</td>
                <td><span className={`badge ${m.active ? 'ok' : ''}`}>{m.active ? 'Aktiv' : 'Inaktiv'}</span></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </AppShell>
  );
}
