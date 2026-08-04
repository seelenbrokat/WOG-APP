'use client';

import { FormEvent, useEffect, useState } from 'react';
import { AppShell } from '@/components/AppShell';
import { api } from '@/lib/api';

export default function UsersPage() {
  const [users, setUsers] = useState<any[]>([]);
  const [mandanten, setMandanten] = useState<any[]>([]);
  const [form, setForm] = useState({
    email: '',
    firstName: '',
    lastName: '',
    role: 'MANDANT_DISPATCHER',
    mandantIds: [] as string[],
  });

  async function load() {
    setUsers(await api('/users'));
    setMandanten(await api('/mandanten'));
  }

  useEffect(() => {
    load().catch(console.error);
  }, []);

  async function onInvite(e: FormEvent) {
    e.preventDefault();
    await api('/users/invite', { method: 'POST', body: JSON.stringify(form) });
    setForm({ email: '', firstName: '', lastName: '', role: 'MANDANT_DISPATCHER', mandantIds: [] });
    await load();
  }

  return (
    <AppShell title="Benutzerverwaltung">
      <form className="panel stack" style={{ marginBottom: '1rem' }} onSubmit={onInvite}>
        <strong>Benutzer einladen</strong>
        <div className="grid-2">
          <input required placeholder="E-Mail" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
          <select value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })}>
            <option value="ORG_ADMIN">Organisations-Admin</option>
            <option value="MANDANT_DISPATCHER">Disponent</option>
            <option value="CUSTOMER_USER">Kunde</option>
            <option value="PARTNER">Partner</option>
          </select>
          <input required placeholder="Vorname" value={form.firstName} onChange={(e) => setForm({ ...form, firstName: e.target.value })} />
          <input required placeholder="Nachname" value={form.lastName} onChange={(e) => setForm({ ...form, lastName: e.target.value })} />
        </div>
        <div className="row">
          {mandanten.map((m) => (
            <label key={m.id} className="row">
              <input
                type="checkbox"
                checked={form.mandantIds.includes(m.id)}
                onChange={(e) => {
                  setForm({
                    ...form,
                    mandantIds: e.target.checked
                      ? [...form.mandantIds, m.id]
                      : form.mandantIds.filter((id) => id !== m.id),
                  });
                }}
              />
              {m.name}
            </label>
          ))}
        </div>
        <button className="btn btn-primary" type="submit">Einladen</button>
      </form>
      <div className="panel">
        <table className="table">
          <thead>
            <tr>
              <th>Name</th>
              <th>E-Mail</th>
              <th>Rolle</th>
              <th>Mandanten</th>
            </tr>
          </thead>
          <tbody>
            {users.map((u) => (
              <tr key={u.id}>
                <td>{u.firstName} {u.lastName}</td>
                <td>{u.email}</td>
                <td>{u.role}</td>
                <td>{u.mandantAccess?.map((a: any) => a.mandant?.code).join(', ') || '–'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </AppShell>
  );
}
