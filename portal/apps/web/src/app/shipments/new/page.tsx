'use client';

import { FormEvent, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
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
  pickupCountry?: string | null;
  deliveryCompany?: string | null;
  deliveryStreet?: string | null;
  deliveryZip?: string | null;
  deliveryCity?: string | null;
  deliveryCountry?: string | null;
  notes?: string | null;
  pickupAddressId?: string | null;
  deliveryAddressId?: string | null;
};

export default function NewShipmentPage() {
  const router = useRouter();
  const user = getUser();
  const [mandanten, setMandanten] = useState<any[]>([]);
  const [customers, setCustomers] = useState<any[]>([]);
  const [addresses, setAddresses] = useState<Address[]>([]);
  const [templates, setTemplates] = useState<Template[]>([]);
  const [error, setError] = useState('');
  const [form, setForm] = useState({
    mandantId: '',
    customerId: '',
    reference: '',
    transportMode: 'LKW',
    goodsDescription: '',
    packageCount: 1,
    weightKg: 0,
    pickupAddressId: '',
    deliveryAddressId: '',
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
    savePickupAddress: false,
    saveDeliveryAddress: false,
    saveAsTemplateName: '',
  });

  const customerQuery =
    user?.role === 'CUSTOMER_USER'
      ? ''
      : form.customerId
        ? `?customerId=${form.customerId}`
        : '';

  async function loadAddressBook(customerId?: string) {
    const q =
      user?.role === 'CUSTOMER_USER'
        ? ''
        : customerId
          ? `?customerId=${customerId}`
          : '';
    if (user?.role !== 'CUSTOMER_USER' && !customerId) {
      setAddresses([]);
      setTemplates([]);
      return;
    }
    const [a, t] = await Promise.all([
      api<Address[]>(`/customers/me/addresses${q}`),
      api<Template[]>(`/customers/me/templates${q}`),
    ]);
    setAddresses(a);
    setTemplates(t);
  }

  useEffect(() => {
    api<any[]>('/mandanten').then((m) => {
      setMandanten(m);
      if (m[0]) setForm((f) => ({ ...f, mandantId: m[0].id }));
    });
    if (user?.role !== 'CUSTOMER_USER') {
      api<any[]>('/customers').then(setCustomers);
    } else {
      loadAddressBook();
    }
  }, []);

  useEffect(() => {
    if (user?.role !== 'CUSTOMER_USER' && form.customerId) {
      loadAddressBook(form.customerId);
    }
  }, [form.customerId]);

  function applyAddress(kind: 'pickup' | 'delivery', addressId: string) {
    const addr = addresses.find((a) => a.id === addressId);
    if (!addr) {
      if (kind === 'pickup') setForm((f) => ({ ...f, pickupAddressId: '' }));
      else setForm((f) => ({ ...f, deliveryAddressId: '' }));
      return;
    }
    if (kind === 'pickup') {
      setForm((f) => ({
        ...f,
        pickupAddressId: addr.id,
        pickupCompany: addr.company || '',
        pickupStreet: addr.street,
        pickupZip: addr.zip,
        pickupCity: addr.city,
      }));
    } else {
      setForm((f) => ({
        ...f,
        deliveryAddressId: addr.id,
        deliveryCompany: addr.company || '',
        deliveryStreet: addr.street,
        deliveryZip: addr.zip,
        deliveryCity: addr.city,
      }));
    }
  }

  function applyTemplate(templateId: string) {
    const t = templates.find((x) => x.id === templateId);
    if (!t) return;
    setForm((f) => ({
      ...f,
      mandantId: t.mandantId || f.mandantId,
      reference: t.reference || '',
      transportMode: t.transportMode || 'LKW',
      goodsDescription: t.goodsDescription || '',
      packageCount: t.packageCount || 1,
      weightKg: t.weightKg || 0,
      pickupAddressId: t.pickupAddressId || '',
      deliveryAddressId: t.deliveryAddressId || '',
      pickupCompany: t.pickupCompany || '',
      pickupStreet: t.pickupStreet || '',
      pickupZip: t.pickupZip || '',
      pickupCity: t.pickupCity || '',
      deliveryCompany: t.deliveryCompany || '',
      deliveryStreet: t.deliveryStreet || '',
      deliveryZip: t.deliveryZip || '',
      deliveryCity: t.deliveryCity || '',
      notes: t.notes || '',
    }));
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError('');
    try {
      const created = await api<any>('/shipments', {
        method: 'POST',
        body: JSON.stringify({
          ...form,
          customerId: form.customerId || undefined,
          pickupAddressId: form.pickupAddressId || undefined,
          deliveryAddressId: form.deliveryAddressId || undefined,
          packageCount: Number(form.packageCount),
          weightKg: Number(form.weightKg) || undefined,
          saveAsTemplateName: form.saveAsTemplateName || undefined,
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

  const pickupAddresses = addresses.filter((a) => a.usage !== 'DELIVERY');
  const deliveryAddresses = addresses.filter((a) => a.usage !== 'PICKUP');

  return (
    <AppShell title="Neuer Auftrag">
      <form className="panel stack" onSubmit={onSubmit}>
        <div className="row" style={{ justifyContent: 'space-between' }}>
          <p className="muted" style={{ margin: 0 }}>
            Auftrag an WOG AG oder WOG GmbH. Adressen und Vorlagen aus dem Adressbuch vorausfüllen.
          </p>
          <Link href="/addresses">Adressbuch verwalten</Link>
        </div>

        {(user?.role === 'CUSTOMER_USER' || form.customerId) && templates.length > 0 && (
          <div className="field">
            <label>Vorlage laden</label>
            <select defaultValue="" onChange={(e) => applyTemplate(e.target.value)}>
              <option value="">– Vorlage wählen –</option>
              {templates.map((t) => (
                <option key={t.id} value={t.id}>{t.name} ({t.pickupCity || '?'} → {t.deliveryCity || '?'})</option>
              ))}
            </select>
          </div>
        )}

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
            <select
              value={form.pickupAddressId}
              onChange={(e) => applyAddress('pickup', e.target.value)}
            >
              <option value="">– aus Adressbuch oder neu –</option>
              {pickupAddresses.map((a) => (
                <option key={a.id} value={a.id}>
                  {(a.label || a.company || a.street)} · {a.zip} {a.city}
                </option>
              ))}
            </select>
            <input placeholder="Firma" value={form.pickupCompany} onChange={(e) => setForm({ ...form, pickupCompany: e.target.value, pickupAddressId: '' })} />
            <input placeholder="Straße" value={form.pickupStreet} onChange={(e) => setForm({ ...form, pickupStreet: e.target.value, pickupAddressId: '' })} />
            <div className="row">
              <input placeholder="PLZ" value={form.pickupZip} onChange={(e) => setForm({ ...form, pickupZip: e.target.value, pickupAddressId: '' })} />
              <input placeholder="Ort" value={form.pickupCity} onChange={(e) => setForm({ ...form, pickupCity: e.target.value, pickupAddressId: '' })} />
            </div>
            <label className="row">
              <input type="checkbox" checked={form.savePickupAddress} onChange={(e) => setForm({ ...form, savePickupAddress: e.target.checked })} />
              Abholung im Adressbuch speichern
            </label>
          </div>
          <div className="stack">
            <strong>Zustellung</strong>
            <select
              value={form.deliveryAddressId}
              onChange={(e) => applyAddress('delivery', e.target.value)}
            >
              <option value="">– aus Adressbuch oder neu –</option>
              {deliveryAddresses.map((a) => (
                <option key={a.id} value={a.id}>
                  {(a.label || a.company || a.street)} · {a.zip} {a.city}
                </option>
              ))}
            </select>
            <input placeholder="Firma" value={form.deliveryCompany} onChange={(e) => setForm({ ...form, deliveryCompany: e.target.value, deliveryAddressId: '' })} />
            <input placeholder="Straße" value={form.deliveryStreet} onChange={(e) => setForm({ ...form, deliveryStreet: e.target.value, deliveryAddressId: '' })} />
            <div className="row">
              <input placeholder="PLZ" value={form.deliveryZip} onChange={(e) => setForm({ ...form, deliveryZip: e.target.value, deliveryAddressId: '' })} />
              <input placeholder="Ort" value={form.deliveryCity} onChange={(e) => setForm({ ...form, deliveryCity: e.target.value, deliveryAddressId: '' })} />
            </div>
            <label className="row">
              <input type="checkbox" checked={form.saveDeliveryAddress} onChange={(e) => setForm({ ...form, saveDeliveryAddress: e.target.checked })} />
              Zustellung im Adressbuch speichern
            </label>
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
        <div className="field">
          <label>Als Vorlage speichern (optional)</label>
          <input
            placeholder="Name der Vorlage"
            value={form.saveAsTemplateName}
            onChange={(e) => setForm({ ...form, saveAsTemplateName: e.target.value })}
          />
        </div>
        {error && <div className="error">{error}</div>}
        <div className="row">
          <button className="btn btn-primary" type="submit">Auftrag übermitteln</button>
          <span className="muted">{customerQuery ? '' : ''}</span>
        </div>
      </form>
    </AppShell>
  );
}
