'use client';

import { FormEvent, useEffect, useState } from 'react';
import { AppShell } from '@/components/AppShell';
import { api } from '@/lib/api';

type Customer = { id: string; name: string; customerNumber: string };
type Rate = {
  id: string;
  palletType: string;
  inboundFee: number;
  outboundFee: number;
  storageFeePerSlot: number;
  customer: Customer;
};
type Meta = { palletTypes: Array<{ code: string; label: string }> };

const empty = {
  customerId: '',
  palletType: 'EURO',
  inboundFee: '0',
  outboundFee: '0',
  storageFeePerSlot: '0',
};

export default function LagerPreisePage() {
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [rates, setRates] = useState<Rate[]>([]);
  const [meta, setMeta] = useState<Meta | null>(null);
  const [form, setForm] = useState(empty);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');

  async function load() {
    const [c, r, m] = await Promise.all([
      api<Customer[]>('/warehouse/customers'),
      api<Rate[]>('/warehouse/rates'),
      api<Meta>('/warehouse/meta'),
    ]);
    setCustomers(c);
    setRates(r);
    setMeta(m);
    setForm((f) => ({
      ...f,
      customerId: f.customerId || c[0]?.id || '',
      palletType: f.palletType || m.palletTypes[0]?.code || 'EURO',
    }));
  }

  useEffect(() => {
    load().catch((e) => setError(e.message));
  }, []);

  async function onSave(e: FormEvent) {
    e.preventDefault();
    setError('');
    setMessage('');
    try {
      await api('/warehouse/rates', {
        method: 'POST',
        body: JSON.stringify({
          customerId: form.customerId,
          palletType: form.palletType,
          inboundFee: Number(form.inboundFee) || 0,
          outboundFee: Number(form.outboundFee) || 0,
          storageFeePerSlot: Number(form.storageFeePerSlot) || 0,
        }),
      });
      setMessage('Preise gespeichert');
      await load();
    } catch (err: any) {
      setError(err.message);
    }
  }

  function editRate(r: Rate) {
    setForm({
      customerId: r.customer.id,
      palletType: r.palletType,
      inboundFee: String(r.inboundFee),
      outboundFee: String(r.outboundFee),
      storageFeePerSlot: String(r.storageFeePerSlot),
    });
  }

  return (
    <AppShell title="Lagerpreise" eyebrow="Lagerverwaltung">
      <p className="muted" style={{ marginTop: 0 }}>
        Je Kunde und Palettentyp: Einlagerung, Auslagerung, Lagerung (€/Stellplatz am Monatshöchststand).
      </p>
      {error ? <p className="error">{error}</p> : null}
      {message ? <p className="ok">{message}</p> : null}

      <form className="panel stack" onSubmit={onSave} style={{ maxWidth: 560, marginBottom: '1rem' }}>
        <strong>Preis hinterlegen</strong>
        <select
          required
          value={form.customerId}
          onChange={(e) => setForm({ ...form, customerId: e.target.value })}
        >
          {customers.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
        <select
          value={form.palletType}
          onChange={(e) => setForm({ ...form, palletType: e.target.value })}
        >
          {(meta?.palletTypes || []).map((p) => (
            <option key={p.code} value={p.code}>
              {p.label}
            </option>
          ))}
        </select>
        <div className="row" style={{ gap: '0.5rem', flexWrap: 'wrap' }}>
          <label className="field" style={{ flex: 1 }}>
            Einlagerung €
            <input
              type="number"
              step="0.01"
              min="0"
              value={form.inboundFee}
              onChange={(e) => setForm({ ...form, inboundFee: e.target.value })}
            />
          </label>
          <label className="field" style={{ flex: 1 }}>
            Auslagerung €
            <input
              type="number"
              step="0.01"
              min="0"
              value={form.outboundFee}
              onChange={(e) => setForm({ ...form, outboundFee: e.target.value })}
            />
          </label>
          <label className="field" style={{ flex: 1 }}>
            Lager / Stellplatz €
            <input
              type="number"
              step="0.01"
              min="0"
              value={form.storageFeePerSlot}
              onChange={(e) => setForm({ ...form, storageFeePerSlot: e.target.value })}
            />
          </label>
        </div>
        <button className="btn btn-primary" type="submit">
          Speichern
        </button>
      </form>

      <div className="panel" style={{ overflowX: 'auto' }}>
        <table className="table">
          <thead>
            <tr>
              <th>Kunde</th>
              <th>Typ</th>
              <th>Ein</th>
              <th>Aus</th>
              <th>Lager/Slot</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {rates.map((r) => (
              <tr key={r.id}>
                <td>{r.customer.name}</td>
                <td>{r.palletType}</td>
                <td>{r.inboundFee.toFixed(2)}</td>
                <td>{r.outboundFee.toFixed(2)}</td>
                <td>{r.storageFeePerSlot.toFixed(2)}</td>
                <td>
                  <button className="btn btn-ghost" type="button" onClick={() => editRate(r)}>
                    Bearbeiten
                  </button>
                </td>
              </tr>
            ))}
            {!rates.length && (
              <tr>
                <td colSpan={6} className="muted">
                  Noch keine Preise.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </AppShell>
  );
}
