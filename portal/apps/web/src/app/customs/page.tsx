'use client';

import { FormEvent, useEffect, useState } from 'react';
import { AppShell } from '@/components/AppShell';
import { api, getUser } from '@/lib/api';

const BORDER_PRESETS = [
  'Nickelsdorf / Hegyeshalom',
  'Spielfeld / Šentilj',
  'Suben / Suben',
  'Brenner',
  'Karawankentunnel',
  'Sonstiger',
];

export default function CustomsPage() {
  const user = getUser();
  const [orders, setOrders] = useState<any[]>([]);
  const [mandanten, setMandanten] = useState<any[]>([]);
  const [customers, setCustomers] = useState<any[]>([]);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [form, setForm] = useState({
    kennzeichen: '',
    grenzuebergang: BORDER_PRESETS[0],
    grenzuebergangCustom: '',
    zeit: '',
    importeur: '',
    mandantId: '',
    customerId: '',
    notes: '',
  });

  async function load() {
    setOrders(await api('/customs'));
  }

  useEffect(() => {
    const now = new Date();
    now.setMinutes(now.getMinutes() - now.getTimezoneOffset());
    setForm((f) => ({ ...f, zeit: now.toISOString().slice(0, 16) }));
    api<any[]>('/mandanten').then((m) => {
      setMandanten(m);
      if (m[0]) setForm((f) => ({ ...f, mandantId: m[0].id }));
    });
    if (user?.role !== 'CUSTOMER_USER') {
      api<any[]>('/customers').then(setCustomers);
    }
    load().catch((err) => setError(err.message));
  }, []);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError('');
    setMessage('');
    try {
      const grenzuebergang =
        form.grenzuebergang === 'Sonstiger'
          ? form.grenzuebergangCustom
          : form.grenzuebergang;
      await api('/customs', {
        method: 'POST',
        body: JSON.stringify({
          kennzeichen: form.kennzeichen,
          grenzuebergang,
          zeit: new Date(form.zeit).toISOString(),
          importeur: form.importeur,
          mandantId: form.mandantId || undefined,
          customerId: form.customerId || undefined,
          notes: form.notes || undefined,
        }),
      });
      setMessage('Verzollungsauftrag übermittelt.');
      setForm((f) => ({
        ...f,
        kennzeichen: '',
        importeur: '',
        notes: '',
        grenzuebergangCustom: '',
      }));
      await load();
    } catch (err: any) {
      setError(err.message);
    }
  }

  return (
    <AppShell title="Verzollung">
      <p className="muted" style={{ marginBottom: '1rem' }}>
        Verzollungsauftrag einfach übermitteln: Kennzeichen, Grenzübergang, Zeit und Importeur.
      </p>

      <form className="panel stack" style={{ marginBottom: '1.25rem', maxWidth: 640 }} onSubmit={onSubmit}>
        <strong>Neuer Verzollungsauftrag</strong>
        <div className="grid-2">
          <div className="field">
            <label>Kennzeichen</label>
            <input
              required
              placeholder="z.B. W-12345"
              value={form.kennzeichen}
              onChange={(e) => setForm({ ...form, kennzeichen: e.target.value })}
            />
          </div>
          <div className="field">
            <label>Zeit (Grenze)</label>
            <input
              required
              type="datetime-local"
              value={form.zeit}
              onChange={(e) => setForm({ ...form, zeit: e.target.value })}
            />
          </div>
        </div>
        <div className="field">
          <label>Grenzübergang</label>
          <select
            value={form.grenzuebergang}
            onChange={(e) => setForm({ ...form, grenzuebergang: e.target.value })}
          >
            {BORDER_PRESETS.map((b) => (
              <option key={b} value={b}>{b}</option>
            ))}
          </select>
        </div>
        {form.grenzuebergang === 'Sonstiger' && (
          <div className="field">
            <label>Grenzübergang (Freitext)</label>
            <input
              required
              value={form.grenzuebergangCustom}
              onChange={(e) => setForm({ ...form, grenzuebergangCustom: e.target.value })}
            />
          </div>
        )}
        <div className="field">
          <label>Importeur</label>
          <input
            required
            placeholder="Firmenname Importeur"
            value={form.importeur}
            onChange={(e) => setForm({ ...form, importeur: e.target.value })}
          />
        </div>
        <div className="grid-2">
          <div className="field">
            <label>Mandant</label>
            <select value={form.mandantId} onChange={(e) => setForm({ ...form, mandantId: e.target.value })}>
              {mandanten.map((m) => (
                <option key={m.id} value={m.id}>{m.name}</option>
              ))}
            </select>
          </div>
          {user?.role !== 'CUSTOMER_USER' && (
            <div className="field">
              <label>Kunde</label>
              <select
                required
                value={form.customerId}
                onChange={(e) => setForm({ ...form, customerId: e.target.value })}
              >
                <option value="">Bitte wählen</option>
                {customers.map((c) => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </select>
            </div>
          )}
        </div>
        <div className="field">
          <label>Hinweis (optional)</label>
          <input value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
        </div>
        {error && <div className="error">{error}</div>}
        {message && <div className="success">{message}</div>}
        <button className="btn btn-primary" type="submit">Auftrag übermitteln</button>
      </form>

      <div className="panel">
        <strong>Meine Verzollungsaufträge</strong>
        <table className="table">
          <thead>
            <tr>
              <th>Kennzeichen</th>
              <th>Grenze</th>
              <th>Zeit</th>
              <th>Importeur</th>
              <th>Status</th>
              {(user?.role === 'ORG_ADMIN' || user?.role === 'MANDANT_DISPATCHER') && <th></th>}
            </tr>
          </thead>
          <tbody>
            {orders.map((o) => (
              <tr key={o.id}>
                <td><strong>{o.kennzeichen}</strong></td>
                <td>{o.grenzuebergang}</td>
                <td>{new Date(o.zeit).toLocaleString('de-AT')}</td>
                <td>{o.importeur}</td>
                <td><span className="badge">{o.status}</span></td>
                {(user?.role === 'ORG_ADMIN' || user?.role === 'MANDANT_DISPATCHER') && (
                  <td>
                    <select
                      value={o.status}
                      onChange={async (e) => {
                        await api(`/customs/${o.id}/status`, {
                          method: 'PATCH',
                          body: JSON.stringify({ status: e.target.value }),
                        });
                        await load();
                      }}
                    >
                      <option value="SUBMITTED">Übermittelt</option>
                      <option value="IN_PROGRESS">In Bearbeitung</option>
                      <option value="DONE">Erledigt</option>
                      <option value="CANCELLED">Storniert</option>
                    </select>
                  </td>
                )}
              </tr>
            ))}
            {!orders.length && (
              <tr><td colSpan={6} className="muted">Noch keine Verzollungsaufträge.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </AppShell>
  );
}
