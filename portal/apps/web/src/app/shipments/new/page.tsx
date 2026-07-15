'use client';

import { FormEvent, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { AppShell } from '@/components/AppShell';
import { api, getUser } from '@/lib/api';

export default function NewShipmentPage() {
  const router = useRouter();
  const user = getUser();
  const [mandanten, setMandanten] = useState<any[]>([]);
  const [customers, setCustomers] = useState<any[]>([]);
  const [error, setError] = useState('');
  const [form, setForm] = useState({
    mandantId: '',
    customerId: '',
    reference: '',
    transportMode: 'LKW',
    goodsDescription: '',
    packageCount: 1,
    weightKg: 0,
    pickupCompany: '',
    pickupStreet: '',
    pickupZip: '',
    pickupCity: '',
    deliveryCompany: '',
    deliveryStreet: '',
    deliveryZip: '',
    deliveryCity: '',
    notes: '',
    submit: true,
  });

  useEffect(() => {
    api<any[]>('/mandanten').then((m) => {
      setMandanten(m);
      if (m[0]) setForm((f) => ({ ...f, mandantId: m[0].id }));
    });
    if (user?.role !== 'CUSTOMER_USER') {
      api<any[]>('/customers').then(setCustomers);
    }
  }, []);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError('');
    try {
      const created = await api<any>('/shipments', {
        method: 'POST',
        body: JSON.stringify({
          ...form,
          customerId: form.customerId || undefined,
          packageCount: Number(form.packageCount),
          weightKg: Number(form.weightKg) || undefined,
          positions: form.goodsDescription
            ? [{ description: form.goodsDescription, quantity: Number(form.packageCount) || 1, weightKg: Number(form.weightKg) || undefined }]
            : [],
        }),
      });
      router.push(`/shipments/${created.id}`);
    } catch (err: any) {
      setError(err.message);
    }
  }

  return (
    <AppShell title="Neuer Auftrag">
      <form className="panel stack" onSubmit={onSubmit}>
        <p className="muted">Auftrag an WOG AG oder WOG GmbH erfassen. Kunden sehen später beide, Disponenten nur ihren Mandanten.</p>
        <div className="grid-2">
          <div className="field">
            <label>Mandant</label>
            <select required value={form.mandantId} onChange={(e) => setForm({ ...form, mandantId: e.target.value })}>
              {mandanten.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
            </select>
          </div>
          {user?.role !== 'CUSTOMER_USER' && (
            <div className="field">
              <label>Kunde</label>
              <select required value={form.customerId} onChange={(e) => setForm({ ...form, customerId: e.target.value })}>
                <option value="">Bitte wählen</option>
                {customers.map((c) => <option key={c.id} value={c.id}>{c.name} ({c.customerNumber})</option>)}
              </select>
            </div>
          )}
          <div className="field">
            <label>Referenz</label>
            <input value={form.reference} onChange={(e) => setForm({ ...form, reference: e.target.value })} />
          </div>
          <div className="field">
            <label>Transportart</label>
            <input value={form.transportMode} onChange={(e) => setForm({ ...form, transportMode: e.target.value })} />
          </div>
        </div>
        <div className="grid-2">
          <div className="stack">
            <strong>Abholung</strong>
            <input placeholder="Firma" value={form.pickupCompany} onChange={(e) => setForm({ ...form, pickupCompany: e.target.value })} />
            <input placeholder="Straße" value={form.pickupStreet} onChange={(e) => setForm({ ...form, pickupStreet: e.target.value })} />
            <div className="row">
              <input placeholder="PLZ" value={form.pickupZip} onChange={(e) => setForm({ ...form, pickupZip: e.target.value })} />
              <input placeholder="Ort" value={form.pickupCity} onChange={(e) => setForm({ ...form, pickupCity: e.target.value })} />
            </div>
          </div>
          <div className="stack">
            <strong>Zustellung</strong>
            <input placeholder="Firma" value={form.deliveryCompany} onChange={(e) => setForm({ ...form, deliveryCompany: e.target.value })} />
            <input placeholder="Straße" value={form.deliveryStreet} onChange={(e) => setForm({ ...form, deliveryStreet: e.target.value })} />
            <div className="row">
              <input placeholder="PLZ" value={form.deliveryZip} onChange={(e) => setForm({ ...form, deliveryZip: e.target.value })} />
              <input placeholder="Ort" value={form.deliveryCity} onChange={(e) => setForm({ ...form, deliveryCity: e.target.value })} />
            </div>
          </div>
        </div>
        <div className="grid-3">
          <div className="field">
            <label>Kolli</label>
            <input type="number" min={1} value={form.packageCount} onChange={(e) => setForm({ ...form, packageCount: Number(e.target.value) })} />
          </div>
          <div className="field">
            <label>Gewicht (kg)</label>
            <input type="number" value={form.weightKg} onChange={(e) => setForm({ ...form, weightKg: Number(e.target.value) })} />
          </div>
          <div className="field">
            <label>Warenbeschreibung</label>
            <input value={form.goodsDescription} onChange={(e) => setForm({ ...form, goodsDescription: e.target.value })} />
          </div>
        </div>
        <div className="field">
          <label>Hinweise</label>
          <textarea rows={3} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
        </div>
        {error && <div className="error">{error}</div>}
        <button className="btn btn-primary" type="submit">Auftrag übermitteln</button>
      </form>
    </AppShell>
  );
}
