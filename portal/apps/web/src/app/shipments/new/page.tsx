'use client';

import { FormEvent, Suspense, useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
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

type ColloDraft = {
  description: string;
  weightKg: string;
  lengthCm: string;
  widthCm: string;
  heightCm: string;
};

function emptyCollo(description = ''): ColloDraft {
  return { description, weightKg: '', lengthCm: '', widthCm: '', heightCm: '' };
}

function resizeColli(colli: ColloDraft[], count: number, fallbackDescription: string): ColloDraft[] {
  const n = Math.max(1, count);
  if (colli.length === n) return colli;
  if (colli.length < n) {
    const next = [...colli];
    while (next.length < n) {
      next.push(emptyCollo(fallbackDescription));
    }
    return next;
  }
  return colli.slice(0, n);
}

type OpenOrder = {
  id: string;
  externalNumber: string;
  mandantId: string;
  freightPayerCustomerId: string;
  status: string;
  mandant?: { name: string };
  freightPayer?: { name: string };
  _count?: { shipments: number };
  shipments?: Array<{ trackingNumber: string }>;
};

function NewShipmentInner() {
  const router = useRouter();
  const search = useSearchParams();
  const user = getUser();
  const [mandanten, setMandanten] = useState<any[]>([]);
  const [customers, setCustomers] = useState<any[]>([]);
  const [addresses, setAddresses] = useState<Address[]>([]);
  const [templates, setTemplates] = useState<Template[]>([]);
  const [openOrders, setOpenOrders] = useState<OpenOrder[]>([]);
  const [error, setError] = useState('');
  const [colli, setColli] = useState<ColloDraft[]>([emptyCollo()]);
  const [form, setForm] = useState({
    mandantId: '',
    customerId: '',
    orderId: '',
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
    const presetOrderId = search.get('orderId') || '';
    const presetMandantId = search.get('mandantId') || '';
    const presetCustomerId = search.get('customerId') || '';
    api<any[]>('/mandanten').then((m) => {
      setMandanten(m);
      setForm((f) => ({
        ...f,
        mandantId: presetMandantId || f.mandantId || m[0]?.id || '',
        customerId: presetCustomerId || f.customerId,
        orderId: presetOrderId || f.orderId,
      }));
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

  useEffect(() => {
    const q =
      user?.role === 'CUSTOMER_USER'
        ? '?openOnly=1'
        : form.customerId
          ? `?openOnly=1&customerId=${form.customerId}`
          : '?openOnly=1';
    if (user?.role !== 'CUSTOMER_USER' && !form.customerId && !form.orderId) {
      setOpenOrders([]);
      return;
    }
    api<OpenOrder[]>(`/orders${q}`)
      .then((orders) => {
        const filtered = form.mandantId
          ? orders.filter((o) => o.mandantId === form.mandantId)
          : orders;
        setOpenOrders(filtered);
      })
      .catch(() => setOpenOrders([]));
  }, [form.customerId, form.mandantId, user?.role]);

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
    const count = Math.max(1, t.packageCount || 1);
    setForm((f) => ({
      ...f,
      mandantId: t.mandantId || f.mandantId,
      reference: t.reference || '',
      transportMode: t.transportMode || 'LKW',
      goodsDescription: t.goodsDescription || '',
      packageCount: count,
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
    setColli(resizeColli([], count, t.goodsDescription || ''));
  }

  function updateCollo(index: number, patch: Partial<ColloDraft>) {
    setColli((rows) => rows.map((row, i) => (i === index ? { ...row, ...patch } : row)));
  }

  function setPackageCount(count: number) {
    const n = Math.max(1, count || 1);
    setForm((f) => ({ ...f, packageCount: n }));
    setColli((rows) => resizeColli(rows, n, form.goodsDescription));
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError('');
    try {
      const positions = colli.map((c) => {
        const weightKg = Number(c.weightKg);
        const lengthCm = Number(c.lengthCm);
        const widthCm = Number(c.widthCm);
        const heightCm = Number(c.heightCm);
        return {
          description: c.description.trim() || form.goodsDescription || `Collo`,
          quantity: 1,
          weightKg: Number.isFinite(weightKg) && weightKg > 0 ? weightKg : undefined,
          lengthCm: Number.isFinite(lengthCm) && lengthCm > 0 ? lengthCm : undefined,
          widthCm: Number.isFinite(widthCm) && widthCm > 0 ? widthCm : undefined,
          heightCm: Number.isFinite(heightCm) && heightCm > 0 ? heightCm : undefined,
        };
      });
      const totalWeight = positions.reduce((sum, p) => sum + (p.weightKg || 0), 0);
      const volumeM3 = positions.reduce((sum, p) => {
        if (!p.lengthCm || !p.widthCm || !p.heightCm) return sum;
        return sum + (p.lengthCm * p.widthCm * p.heightCm) / 1_000_000;
      }, 0);
      const goodsDescription =
        form.goodsDescription.trim() ||
        positions.map((p) => p.description).filter(Boolean).join('; ') ||
        undefined;

      const created = await api<any>('/shipments', {
        method: 'POST',
        body: JSON.stringify({
          ...form,
          orderId: form.orderId || undefined,
          customerId: form.customerId || undefined,
          pickupAddressId: form.pickupAddressId || undefined,
          deliveryAddressId: form.deliveryAddressId || undefined,
          packageCount: positions.length,
          weightKg: totalWeight || Number(form.weightKg) || undefined,
          volumeM3: volumeM3 > 0 ? Math.round(volumeM3 * 1000) / 1000 : undefined,
          goodsDescription,
          saveAsTemplateName: form.saveAsTemplateName || undefined,
          positions,
        }),
      });
      router.push(`/shipments/${created.id}?handover=1`);
    } catch (err: any) {
      setError(err.message);
    }
  }

  const selectedOrder = openOrders.find((o) => o.id === form.orderId);

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
            <select
              required
              value={form.mandantId}
              onChange={(e) => setForm({ ...form, mandantId: e.target.value, orderId: '' })}
            >
              {mandanten.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
            </select>
          </div>
          {user?.role !== 'CUSTOMER_USER' && (
            <div className="field">
              <label>Kunde</label>
              <select
                required
                value={form.customerId}
                onChange={(e) => setForm({ ...form, customerId: e.target.value, orderId: '' })}
              >
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

        {(openOrders.length > 0 || form.orderId) && (
          <div className="field">
            <label>Auftrag</label>
            <select
              value={form.orderId}
              onChange={(e) => {
                const orderId = e.target.value;
                const o = openOrders.find((x) => x.id === orderId);
                setForm((f) => ({
                  ...f,
                  orderId,
                  mandantId: o?.mandantId || f.mandantId,
                  customerId: o?.freightPayerCustomerId || f.customerId,
                }));
              }}
            >
              <option value="">Neuer Auftrag (neue VLB-Nummer)</option>
              {openOrders.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.externalNumber}
                  {o._count?.shipments != null ? ` · ${o._count.shipments} Sendung(en)` : ''}
                  {o.mandant?.name ? ` · ${o.mandant.name}` : ''}
                </option>
              ))}
            </select>
            {selectedOrder && (
              <p className="muted" style={{ margin: '0.35rem 0 0', fontSize: '0.85rem' }}>
                Weitere Sendung wird an {selectedOrder.externalNumber} angehängt (kumulierte Ladeliste).
              </p>
            )}
          </div>
        )}

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

        <div className="stack">
          <div className="row" style={{ justifyContent: 'space-between', alignItems: 'end' }}>
            <strong>Colli</strong>
            <div className="field" style={{ margin: 0, maxWidth: 120 }}>
              <label>Anzahl</label>
              <input
                type="number"
                min={1}
                value={form.packageCount}
                onChange={(e) => setPackageCount(Number(e.target.value))}
              />
            </div>
          </div>
          <div className="field">
            <label>Warenbeschreibung (gesamt, optional)</label>
            <input
              value={form.goodsDescription}
              onChange={(e) => setForm({ ...form, goodsDescription: e.target.value })}
              placeholder="z. B. Heiztechnik / Mischsendung"
            />
          </div>
          {colli.map((c, index) => (
            <div key={index} className="stack" style={{ borderTop: '1px solid var(--line)', paddingTop: '0.75rem' }}>
              <strong style={{ fontSize: '0.95rem' }}>Collo {index + 1}</strong>
              <div className="field">
                <label>Inhalt</label>
                <input
                  value={c.description}
                  onChange={(e) => updateCollo(index, { description: e.target.value })}
                  placeholder={form.goodsDescription || 'Inhalt / Packstück'}
                />
              </div>
              <div className="grid-2">
                <div className="field">
                  <label>Gewicht (kg)</label>
                  <input
                    type="number"
                    min={0}
                    step="0.1"
                    value={c.weightKg}
                    onChange={(e) => updateCollo(index, { weightKg: e.target.value })}
                  />
                </div>
                <div className="field">
                  <label>Abmessungen L × B × H (cm)</label>
                  <div className="row">
                    <input
                      type="number"
                      min={0}
                      step="1"
                      placeholder="L"
                      value={c.lengthCm}
                      onChange={(e) => updateCollo(index, { lengthCm: e.target.value })}
                      aria-label={`Collo ${index + 1} Länge cm`}
                    />
                    <input
                      type="number"
                      min={0}
                      step="1"
                      placeholder="B"
                      value={c.widthCm}
                      onChange={(e) => updateCollo(index, { widthCm: e.target.value })}
                      aria-label={`Collo ${index + 1} Breite cm`}
                    />
                    <input
                      type="number"
                      min={0}
                      step="1"
                      placeholder="H"
                      value={c.heightCm}
                      onChange={(e) => updateCollo(index, { heightCm: e.target.value })}
                      aria-label={`Collo ${index + 1} Höhe cm`}
                    />
                  </div>
                </div>
              </div>
            </div>
          ))}
          <p className="muted" style={{ margin: 0, fontSize: '0.85rem' }}>
            Abmessungen und Gewicht je Collo fließen in Etiketten und Soloplan-Export ein.
          </p>
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


export default function NewShipmentPage() {
  return (
    <Suspense fallback={<AppShell title="Neuer Auftrag">Laden…</AppShell>}>
      <NewShipmentInner />
    </Suspense>
  );
}
