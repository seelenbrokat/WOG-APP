'use client';

import { FormEvent, useEffect, useState } from 'react';
import { AppShell } from '@/components/AppShell';
import { api } from '@/lib/api';

export default function UsersPage() {
  const [users, setUsers] = useState<any[]>([]);
  const [customers, setCustomers] = useState<any[]>([]);
  const [mandanten, setMandanten] = useState<any[]>([]);
  const [message, setMessage] = useState('');
  const [tempPassword, setTempPassword] = useState('');
  const [error, setError] = useState('');
  const [form, setForm] = useState({
    email: '',
    firstName: '',
    lastName: '',
    role: 'CUSTOMER_USER',
    customerId: '',
    mandantIds: [] as string[],
  });

  async function load() {
    setUsers(await api('/users'));
    setMandanten(await api('/mandanten'));
    setCustomers(await api('/customers'));
  }

  useEffect(() => {
    load().catch(console.error);
  }, []);

  async function onInvite(e: FormEvent) {
    e.preventDefault();
    setError('');
    setMessage('');
    setTempPassword('');
    try {
      const res = await api<any>('/users/invite', {
        method: 'POST',
        body: JSON.stringify({
          ...form,
          customerId: form.customerId || undefined,
        }),
      });
      setMessage(
        `User ${res.email} angelegt. Einmal-Passwort wurde per E-Mail an den User gesendet.`,
      );
      if (res.temporaryPassword) setTempPassword(res.temporaryPassword);
      setForm({
        email: '',
        firstName: '',
        lastName: '',
        role: 'CUSTOMER_USER',
        customerId: '',
        mandantIds: [],
      });
      await load();
    } catch (err: any) {
      setError(err.message);
    }
  }

  async function resetPassword(userId: string) {
    setError('');
    setMessage('');
    setTempPassword('');
    try {
      const res = await api<any>(`/users/${userId}/reset-password`, { method: 'POST' });
      setMessage(`Passwort für ${res.email} zurückgesetzt. Neues Einmal-Passwort per E-Mail gesendet.`);
      if (res.temporaryPassword) setTempPassword(res.temporaryPassword);
      await load();
    } catch (err: any) {
      setError(err.message);
    }
  }

  return (
    <AppShell title="Benutzerverwaltung">
      <p className="muted" style={{ marginBottom: '1rem' }}>
        Kunden-/Partner-User benötigen eine Soloplan-BusinessPartnerId am Kundenstamm.
        Beim Anlegen/Zurücksetzen erzeugt das Portal ein <strong>zufälliges Einmal-Passwort</strong>,
        sendet es per E-Mail und zeigt es hier einmalig an. Nach dem ersten Login muss der User das
        Passwort ändern (API erzwingt das).
      </p>

      <form className="panel stack" style={{ marginBottom: '1rem' }} onSubmit={onInvite}>
        <strong>Benutzer anlegen</strong>
        <div className="grid-2">
          <input required placeholder="E-Mail (aus Soloplan-Ansprechpartner)" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
          <select value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })}>
            <option value="ORG_ADMIN">Organisations-Admin</option>
            <option value="MANDANT_DISPATCHER">Disponent</option>
            <option value="CUSTOMER_USER">Kunde</option>
            <option value="PARTNER">Partner</option>
          </select>
          <input required placeholder="Vorname" value={form.firstName} onChange={(e) => setForm({ ...form, firstName: e.target.value })} />
          <input required placeholder="Nachname" value={form.lastName} onChange={(e) => setForm({ ...form, lastName: e.target.value })} />
          {(form.role === 'CUSTOMER_USER' || form.role === 'PARTNER') && (
            <select
              required={form.role === 'CUSTOMER_USER'}
              value={form.customerId}
              onChange={(e) => setForm({ ...form, customerId: e.target.value })}
            >
              <option value="">– Soloplan-Kunde wählen –</option>
              {customers
                .filter((c) => c.soloplanBusinessPartnerId)
                .map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name} (BP {c.soloplanBusinessPartnerId})
                  </option>
                ))}
            </select>
          )}
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
        <button className="btn btn-primary" type="submit">Anlegen</button>
      </form>

      {message && <div className="success" style={{ marginBottom: '1rem' }}>{message}</div>}
      {tempPassword && (
        <div className="panel" style={{ marginBottom: '1rem', borderColor: 'var(--wog-green)' }}>
          <strong>Einmal-Passwort (nur jetzt sichtbar)</strong>
          <p className="muted" style={{ margin: '0.35rem 0 0.55rem', fontSize: '0.85rem' }}>
            Bitte dem User sicher weitergeben, falls die E-Mail nicht ankommt. Danach nicht mehr abrufbar.
          </p>
          <code
            style={{
              display: 'inline-block',
              padding: '0.45rem 0.7rem',
              background: 'var(--wog-green-soft)',
              borderRadius: '6px',
              fontSize: '1.05rem',
              letterSpacing: '0.04em',
            }}
          >
            {tempPassword}
          </code>
          <div style={{ marginTop: '0.65rem' }}>
            <button
              type="button"
              className="btn btn-secondary"
              onClick={() => {
                void navigator.clipboard?.writeText(tempPassword);
              }}
            >
              Kopieren
            </button>
          </div>
        </div>
      )}
      {error && <div className="error" style={{ marginBottom: '1rem' }}>{error}</div>}

      <div className="panel">
        <table className="table">
          <thead>
            <tr>
              <th>Name</th>
              <th>E-Mail</th>
              <th>Rolle</th>
              <th>Kunde / BP</th>
              <th>Passwort</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {users.map((u) => (
              <tr key={u.id}>
                <td>{u.firstName} {u.lastName}</td>
                <td>{u.email}</td>
                <td>{u.role}</td>
                <td>
                  {u.customer
                    ? `${u.customer.name}${u.customer.soloplanBusinessPartnerId ? ` (BP ${u.customer.soloplanBusinessPartnerId})` : ''}`
                    : '–'}
                </td>
                <td>
                  {u.mustChangePassword
                    ? <span className="badge warn">Änderung nötig</span>
                    : <span className="badge ok">ok</span>}
                </td>
                <td>
                  <button className="btn btn-ghost" type="button" style={{ color: 'var(--ink)', borderColor: 'var(--line)' }} onClick={() => resetPassword(u.id)}>
                    Passwort zurücksetzen
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </AppShell>
  );
}
