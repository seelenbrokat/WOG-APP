'use client';

import { FormEvent, useEffect, useMemo, useState } from 'react';
import { AppShell } from '@/components/AppShell';
import { api, getUser } from '@/lib/api';

type Address = {
  id: string;
  label?: string | null;
  company?: string | null;
  street: string;
  zip: string;
  city: string;
  country: string;
  usage: string;
  isDefault: boolean;
};

type Template = {
  id: string;
  name: string;
  mandantId?: string | null;
  reference?: string | null;
  transportMode?: string | null;
  goodsDescription?: string | null;
  packageCount: number;
  weightKg?: number | null;
  pickupCompany?: string | null;
  pickupStreet?: string | null;
  pickupZip?: string | null;
  pickupCity?: string | null;
  deliveryCompany?: string | null;
  deliveryStreet?: string | null;
  deliveryZip?: string | null;
  deliveryCity?: string | null;
  notes?: string | null;
};

const emptyAddress = {
  label: '',
  company: '',
  street: '',
  zip: '',
  city: '',
  country: 'AT',
  usage: 'BOTH',
  isDefault: false,
};

export default function AddressBookPage() {
  const user = getUser();
  const [addresses, setAddresses] = useState<Address[]>([]);
  const [templates, setTemplates] = useState<Template[]>([]);
  const [customers, setCustomers] = useState<any[]>([]);
  const [customerId, setCustomerId] = useState(user?.customerId || '');
  const [form, setForm] = useState(emptyAddress);
  const [templateName, setTemplateName] = useState('');
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  const query = useMemo(() => {
    if (user?.role === 'CUSTOMER_USER') return '';
    return customerId ? `?customerId=${customerId}` : '';
  }, [customerId, user?.role]);

  async function load() {
    if (user?.role !== 'CUSTOMER_USER' && !customerId) {
      setAddresses([]);
      setTemplates([]);
      return;
    }
    const [a, t] = await Promise.all([
      api<Address[]>(`/customers/me/addresses${query}`),
      api<Template[]>(`/customers/me/templates${query}`),
    ]);
    setAddresses(a);
    setTemplates(t);
  }

  useEffect(() => {
    if (user?.role !== 'CUSTOMER_USER') {
      api<any[]>('/customers').then((list) => {
        setCustomers(list);
        if (!customerId && list[0]) setCustomerId(list[0].id);
      });
    }
  }, []);

  useEffect(() => {
    load().catch((err) => setError(err.message));
  }, [query, customerId]);

  async function onCreateAddress(e: FormEvent) {
    e.preventDefault();
    setError('');
    setMessage('');
    try {
      await api(`/customers/me/addresses${query}`, {
        method: 'POST',
        body: JSON.stringify(form),
      });
      setForm(emptyAddress);
      setMessage('Adresse gespeichert');
      await load();
    } catch (err: any) {
      setError(err.message);
    }
  }

  async function onCreateTemplateFromSelection(e: FormEvent) {
    e.preventDefault();
    if (!templateName) return;
    setError('');
    try {
      const pickup = addresses.find((a) => a.usage !== 'DELIVERY') || addresses[0];
      const delivery = addresses.find((a) => a.usage !== 'PICKUP' && a.id !== pickup?.id) || addresses[1] || pickup;
      await api(`/customers/me/templates${query}`, {
        method: 'POST',
        body: JSON.stringify({
          name: templateName,
          customerId: customerId || undefined,
          pickupAddressId: pickup?.id,
          deliveryAddressId: delivery?.id,
          transportMode: 'LKW',
          packageCount: 1,
        }),
      });
      setTemplateName('');
      setMessage('Vorlage gespeichert');
      await load();
    } catch (err: any) {
      setError(err.message);
    }
  }

  return (
    <AppShell title="Adressbuch & Vorlagen">
      <p className="muted" style={{ marginBottom: '1rem' }}>
        Gespeicherte Adressen und Auftragsvorlagen – beim nächsten Auftrag einfach auswählen statt neu tippen.
      </p>

      {user?.role !== 'CUSTOMER_USER' && (
        <div className="panel" style={{ marginBottom: '1rem' }}>
          <div className="field">
            <label>Kunde</label>
            <select value={customerId} onChange={(e) => setCustomerId(e.target.value)}>
              {customers.map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
          </div>
        </div>
      )}

      {error && <div className="error" style={{ marginBottom: '1rem' }}>{error}</div>}
      {message && <div className="success" style={{ marginBottom: '1rem' }}>{message}</div>}

      <div className="grid-2">
        <div className="stack">
          <form className="panel stack" onSubmit={onCreateAddress}>
            <strong>Neue Adresse</strong>
            <input placeholder="Bezeichnung (z.B. Lager Wien)" value={form.label} onChange={(e) => setForm({ ...form, label: e.target.value })} />
            <input placeholder="Firma" value={form.company} onChange={(e) => setForm({ ...form, company: e.target.value })} />
            <input required placeholder="Straße" value={form.street} onChange={(e) => setForm({ ...form, street: e.target.value })} />
            <div className="row">
              <input required placeholder="PLZ" value={form.zip} onChange={(e) => setForm({ ...form, zip: e.target.value })} />
              <input required placeholder="Ort" value={form.city} onChange={(e) => setForm({ ...form, city: e.target.value })} />
            </div>
            <select value={form.usage} onChange={(e) => setForm({ ...form, usage: e.target.value })}>
              <option value="BOTH">Abholung & Zustellung</option>
              <option value="PICKUP">Nur Abholung</option>
              <option value="DELIVERY">Nur Zustellung</option>
            </select>
            <label className="row">
              <input type="checkbox" checked={form.isDefault} onChange={(e) => setForm({ ...form, isDefault: e.target.checked })} />
              Als Standardadresse
            </label>
            <button className="btn btn-primary" type="submit">Adresse speichern</button>
          </form>

          <div className="panel">
            <strong>Adressbuch</strong>
            <table className="table">
              <thead>
                <tr>
                  <th>Label</th>
                  <th>Adresse</th>
                  <th>Nutzung</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {addresses.map((a) => (
                  <tr key={a.id}>
                    <td>{a.label || a.company || '–'}{a.isDefault ? ' ★' : ''}</td>
                    <td>{a.street}, {a.zip} {a.city}</td>
                    <td><span className="badge">{a.usage}</span></td>
                    <td>
                      <button
                        className="btn btn-ghost"
                        type="button"
                        onClick={async () => {
                          await api(`/customers/addresses/${a.id}`, { method: 'DELETE' });
                          await load();
                        }}
                      >
                        Löschen
                      </button>
                    </td>
                  </tr>
                ))}
                {!addresses.length && (
                  <tr><td colSpan={4} className="muted">Noch keine Adressen gespeichert.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>

        <div className="stack">
          <form className="panel stack" onSubmit={onCreateTemplateFromSelection}>
            <strong>Vorlage anlegen</strong>
            <p className="muted">Nutzt die ersten passenden Adressen aus dem Adressbuch.</p>
            <input required placeholder="Vorlagenname (z.B. Standard Wien)" value={templateName} onChange={(e) => setTemplateName(e.target.value)} />
            <button className="btn btn-secondary" type="submit" disabled={!addresses.length}>Vorlage speichern</button>
          </form>

          <div className="panel">
            <strong>Auftragsvorlagen</strong>
            <table className="table">
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Route</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {templates.map((t) => (
                  <tr key={t.id}>
                    <td>{t.name}</td>
                    <td className="muted">{t.pickupCity || '–'} → {t.deliveryCity || '–'}</td>
                    <td>
                      <button
                        className="btn btn-ghost"
                        type="button"
                        onClick={async () => {
                          await api(`/customers/templates/${t.id}`, { method: 'DELETE' });
                          await load();
                        }}
                      >
                        Löschen
                      </button>
                    </td>
                  </tr>
                ))}
                {!templates.length && (
                  <tr><td colSpan={3} className="muted">Noch keine Vorlagen.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </AppShell>
  );
}
