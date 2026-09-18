'use client';

import { FormEvent, useEffect, useMemo, useState } from 'react';
import { COUNTRIES, isValidZipForCountry } from '@wog/shared';
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
  scheduleEnabled?: boolean;
  scheduleFreq?: string | null;
  scheduleWeekdays?: string | null;
  scheduleNextRun?: string | null;
  scheduleLastRun?: string | null;
};

type Mandant = { id: string; code: string; name: string };

const WEEKDAYS = [
  { v: '1', l: 'Mo' },
  { v: '2', l: 'Di' },
  { v: '3', l: 'Mi' },
  { v: '4', l: 'Do' },
  { v: '5', l: 'Fr' },
  { v: '6', l: 'Sa' },
  { v: '7', l: 'So' },
];

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

function fmtWhen(value?: string | null) {
  if (!value) return '—';
  return new Date(value).toLocaleString('de-CH', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export default function AddressBookPage() {
  const user = getUser();
  const [addresses, setAddresses] = useState<Address[]>([]);
  const [templates, setTemplates] = useState<Template[]>([]);
  const [customers, setCustomers] = useState<any[]>([]);
  const [mandanten, setMandanten] = useState<Mandant[]>([]);
  const [customerId, setCustomerId] = useState(user?.customerId || '');
  const [form, setForm] = useState(emptyAddress);
  const [templateName, setTemplateName] = useState('');
  const [templateMandantId, setTemplateMandantId] = useState('');
  const [scheduleEnabled, setScheduleEnabled] = useState(false);
  const [scheduleFreq, setScheduleFreq] = useState<'DAILY' | 'WEEKLY'>('WEEKLY');
  const [scheduleWeekdays, setScheduleWeekdays] = useState<string[]>(['1', '2', '3', '4', '5']);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [forceSaveAddress, setForceSaveAddress] = useState(false);
  const [addressFilter, setAddressFilter] = useState('');
  const [savingScheduleId, setSavingScheduleId] = useState<string | null>(null);

  const filteredAddresses = useMemo(() => {
    const q = addressFilter.trim().toLowerCase();
    if (!q) return addresses;
    return addresses.filter((a) =>
      [a.company, a.label, a.street, a.zip, a.city, a.country]
        .filter(Boolean)
        .join(' ')
        .toLowerCase()
        .includes(q),
    );
  }, [addresses, addressFilter]);

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
    api<Mandant[]>('/mandanten')
      .then((list) => {
        setMandanten(list);
        if (!templateMandantId && list[0]) setTemplateMandantId(list[0].id);
      })
      .catch(() => setMandanten([]));
    if (user?.role !== 'CUSTOMER_USER') {
      api<any[]>('/customers').then((list) => {
        setCustomers(list);
        if (!customerId && list[0]) setCustomerId(list[0].id);
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    load().catch((err) => setError(err.message));
  }, [query, customerId]);

  async function onCreateAddress(e: FormEvent) {
    e.preventDefault();
    setError('');
    setMessage('');
    try {
      if (!form.country) throw new Error('Bitte Land wählen.');
      if (!isValidZipForCountry(form.zip, form.country)) {
        throw new Error(`PLZ-Format für ${form.country} ungültig.`);
      }
      const check = await api<{
        ok: boolean;
        status: string;
        message: string;
      }>('/shipments/validate-address', {
        method: 'POST',
        body: JSON.stringify({
          street: form.street,
          zip: form.zip,
          city: form.city,
          country: form.country,
          company: form.company,
        }),
      });
      if ((check.status === 'FORMAT_ERROR' || check.status === 'INVALID') && !forceSaveAddress) {
        throw new Error(
          (check.message || 'Adresse ungültig') +
            ' – oder unten „Trotzdem speichern“ wählen (z. B. Baustelle).',
        );
      }
      await api(`/customers/me/addresses${query}`, {
        method: 'POST',
        body: JSON.stringify(form),
      });
      setForm(emptyAddress);
      setForceSaveAddress(false);
      setMessage(
        check.status === 'AMBIGUOUS' || check.status === 'INVALID' || check.status === 'FORMAT_ERROR'
          ? 'Adresse gespeichert (Prüfung ungenau/nicht gefunden – bitte Eintrag kontrollieren).'
          : 'Adresse gespeichert und geprüft',
      );
      await load();
    } catch (err: any) {
      setError(err.message);
    }
  }

  async function onCreateTemplateFromSelection(e: FormEvent) {
    e.preventDefault();
    if (!templateName) return;
    setError('');
    setMessage('');
    try {
      if (scheduleEnabled && !templateMandantId) {
        throw new Error('Für wiederkehrende Vorlagen bitte einen Mandanten wählen.');
      }
      const pickup = addresses.find((a) => a.usage !== 'DELIVERY') || addresses[0];
      const delivery =
        addresses.find((a) => a.usage !== 'PICKUP' && a.id !== pickup?.id) ||
        addresses[1] ||
        pickup;
      await api(`/customers/me/templates${query}`, {
        method: 'POST',
        body: JSON.stringify({
          name: templateName,
          customerId: customerId || undefined,
          mandantId: templateMandantId || undefined,
          pickupAddressId: pickup?.id,
          deliveryAddressId: delivery?.id,
          transportMode: 'LKW',
          packageCount: 1,
          scheduleEnabled,
          scheduleFreq: scheduleEnabled ? scheduleFreq : undefined,
          scheduleWeekdays:
            scheduleEnabled && scheduleFreq === 'WEEKLY'
              ? scheduleWeekdays.join(',')
              : undefined,
        }),
      });
      setTemplateName('');
      setScheduleEnabled(false);
      setMessage(
        scheduleEnabled
          ? 'Wiederkehrende Vorlage gespeichert – Aufträge werden automatisch erstellt.'
          : 'Vorlage gespeichert',
      );
      await load();
    } catch (err: any) {
      setError(err.message);
    }
  }

  async function updateTemplateSchedule(t: Template, patch: Partial<Template>) {
    setSavingScheduleId(t.id);
    setError('');
    setMessage('');
    try {
      await api(`/customers/templates/${t.id}`, {
        method: 'PATCH',
        body: JSON.stringify({
          name: t.name,
          mandantId: patch.mandantId ?? t.mandantId ?? templateMandantId,
          scheduleEnabled: patch.scheduleEnabled ?? t.scheduleEnabled ?? false,
          scheduleFreq: patch.scheduleFreq ?? t.scheduleFreq ?? 'WEEKLY',
          scheduleWeekdays: patch.scheduleWeekdays ?? t.scheduleWeekdays ?? '1,2,3,4,5',
        }),
      });
      setMessage('Zeitplan aktualisiert');
      await load();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setSavingScheduleId(null);
    }
  }

  function toggleWeekday(day: string) {
    setScheduleWeekdays((prev) =>
      prev.includes(day) ? prev.filter((d) => d !== day) : [...prev, day].sort(),
    );
  }

  return (
    <AppShell title="Adressbuch & Vorlagen">
      <p className="muted" style={{ marginBottom: '1rem' }}>
        Gespeicherte Adressen und Auftragsvorlagen – beim nächsten Auftrag einfach auswählen statt neu tippen.
        Vorlagen können täglich oder wöchentlich automatisch Aufträge erzeugen.
      </p>

      {user?.role !== 'CUSTOMER_USER' && (
        <div className="panel" style={{ marginBottom: '1rem' }}>
          <div className="field">
            <label>Kunde</label>
            <select value={customerId} onChange={(e) => setCustomerId(e.target.value)}>
              {customers.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </div>
        </div>
      )}

      {error && <div className="error" style={{ marginBottom: '1rem' }}>{error}</div>}
      {message && <div className="success" style={{ marginBottom: '1rem' }}>{message}</div>}

      <div className="panel row" style={{ marginBottom: '1rem', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <strong>Aus bisherigen Sendungen übernehmen</strong>
          <div className="muted" style={{ fontSize: '0.88rem' }}>
            Einmalig Abhol- und Zustelladressen aus erfassten Aufträgen ins Adressbuch laden.
          </div>
        </div>
        <button
          type="button"
          className="btn btn-secondary"
          disabled={user?.role !== 'CUSTOMER_USER' && !customerId}
          onClick={async () => {
            setError('');
            setMessage('');
            try {
              const res = await api<{ created: number; updated: number; skipped: number }>(
                `/customers/me/addresses/import-from-shipments${query}`,
                { method: 'POST' },
              );
              setMessage(
                `${res.created} Adressen neu, ${res.updated} aktualisiert, ${res.skipped} bereits vorhanden.`,
              );
              await load();
            } catch (err: any) {
              setError(err.message);
            }
          }}
        >
          Adressen importieren
        </button>
      </div>

      <div className="grid-2">
        <div className="stack">
          <form className="panel stack" onSubmit={onCreateAddress}>
            <strong>Neue Adresse</strong>
            <input
              placeholder="Bezeichnung (z.B. Lager Wien)"
              value={form.label}
              onChange={(e) => setForm({ ...form, label: e.target.value })}
            />
            <input
              placeholder="Firma"
              value={form.company}
              onChange={(e) => setForm({ ...form, company: e.target.value })}
            />
            <input
              required
              placeholder="Straße"
              value={form.street}
              onChange={(e) => setForm({ ...form, street: e.target.value })}
            />
            <div className="row">
              <input
                required
                placeholder="PLZ"
                value={form.zip}
                onChange={(e) => setForm({ ...form, zip: e.target.value })}
              />
              <input
                required
                placeholder="Ort"
                value={form.city}
                onChange={(e) => setForm({ ...form, city: e.target.value })}
              />
            </div>
            <div className="field">
              <label>Land</label>
              <select
                required
                value={form.country}
                onChange={(e) => setForm({ ...form, country: e.target.value })}
              >
                {COUNTRIES.map((c) => (
                  <option key={c.code} value={c.code}>
                    {c.label} ({c.code})
                  </option>
                ))}
              </select>
            </div>
            <select value={form.usage} onChange={(e) => setForm({ ...form, usage: e.target.value })}>
              <option value="BOTH">Abholung & Zustellung</option>
              <option value="PICKUP">Nur Abholung</option>
              <option value="DELIVERY">Nur Zustellung</option>
            </select>
            <label className="row">
              <input
                type="checkbox"
                checked={form.isDefault}
                onChange={(e) => setForm({ ...form, isDefault: e.target.checked })}
              />
              Als Standardadresse
            </label>
            <label className="row" style={{ alignItems: 'flex-start', gap: '0.5rem' }}>
              <input
                type="checkbox"
                checked={forceSaveAddress}
                onChange={(e) => setForceSaveAddress(e.target.checked)}
              />
              <span style={{ fontSize: '0.85rem' }}>
                Trotzdem speichern, falls Adresse in der Karte nicht gefunden wird (z.&nbsp;B. Baustelle)
              </span>
            </label>
            <button className="btn btn-primary" type="submit">
              Adresse speichern
            </button>
          </form>

          <div className="panel">
            <strong>Adressbuch</strong>
            <input
              type="search"
              placeholder="Kundenname / Firma suchen…"
              value={addressFilter}
              onChange={(e) => setAddressFilter(e.target.value)}
              style={{ margin: '0.5rem 0', width: '100%' }}
            />
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
                {filteredAddresses.map((a) => (
                  <tr key={a.id}>
                    <td>
                      {a.label || a.company || '–'}
                      {a.isDefault ? ' ★' : ''}
                    </td>
                    <td>
                      {a.street}, {a.zip} {a.city} ({a.country})
                    </td>
                    <td>
                      <span className="badge">{a.usage}</span>
                    </td>
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
                  <tr>
                    <td colSpan={4} className="muted">
                      Noch keine Adressen gespeichert.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>

        <div className="stack">
          <form className="panel stack" onSubmit={onCreateTemplateFromSelection}>
            <strong>Vorlage anlegen</strong>
            <p className="muted">Nutzt die ersten passenden Adressen aus dem Adressbuch.</p>
            <input
              required
              placeholder="Vorlagenname (z.B. Standard Wien)"
              value={templateName}
              onChange={(e) => setTemplateName(e.target.value)}
            />
            <div className="field">
              <label>Mandant (für wiederkehrende Aufträge Pflicht)</label>
              <select
                value={templateMandantId}
                onChange={(e) => setTemplateMandantId(e.target.value)}
              >
                <option value="">—</option>
                {mandanten.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.name} ({m.code})
                  </option>
                ))}
              </select>
            </div>
            <label className="row">
              <input
                type="checkbox"
                checked={scheduleEnabled}
                onChange={(e) => setScheduleEnabled(e.target.checked)}
              />
              Wiederkehrend automatisch Aufträge erstellen
            </label>
            {scheduleEnabled && (
              <div className="stack" style={{ gap: '0.65rem' }}>
                <div className="field">
                  <label>Frequenz</label>
                  <select
                    value={scheduleFreq}
                    onChange={(e) => setScheduleFreq(e.target.value as 'DAILY' | 'WEEKLY')}
                  >
                    <option value="DAILY">Täglich</option>
                    <option value="WEEKLY">Wöchentlich</option>
                  </select>
                </div>
                {scheduleFreq === 'WEEKLY' && (
                  <div className="row" style={{ flexWrap: 'wrap', gap: '0.5rem' }}>
                    {WEEKDAYS.map((d) => (
                      <label key={d.v} className="row" style={{ gap: '0.25rem' }}>
                        <input
                          type="checkbox"
                          checked={scheduleWeekdays.includes(d.v)}
                          onChange={() => toggleWeekday(d.v)}
                        />
                        {d.l}
                      </label>
                    ))}
                  </div>
                )}
              </div>
            )}
            <button className="btn btn-secondary" type="submit" disabled={!addresses.length}>
              Vorlage speichern
            </button>
          </form>

          <div className="panel">
            <strong>Auftragsvorlagen</strong>
            <table className="table">
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Route / Zeitplan</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {templates.map((t) => (
                  <tr key={t.id}>
                    <td>
                      {t.name}
                      {t.scheduleEnabled ? (
                        <div>
                          <span className="badge ok">Wiederkehrend</span>
                        </div>
                      ) : null}
                    </td>
                    <td className="muted">
                      <div>
                        {t.pickupCity || '–'} → {t.deliveryCity || '–'}
                      </div>
                      {t.scheduleEnabled ? (
                        <div style={{ marginTop: '0.35rem', fontSize: '0.88rem' }}>
                          {t.scheduleFreq === 'DAILY' ? 'Täglich' : `Wöchentlich (${t.scheduleWeekdays || '1–5'})`}
                          <br />
                          Nächster Lauf: {fmtWhen(t.scheduleNextRun)}
                          <br />
                          Letzter Lauf: {fmtWhen(t.scheduleLastRun)}
                        </div>
                      ) : (
                        <button
                          type="button"
                          className="btn btn-ghost"
                          style={{ marginTop: '0.25rem', paddingLeft: 0 }}
                          disabled={savingScheduleId === t.id || !templateMandantId}
                          onClick={() =>
                            updateTemplateSchedule(t, {
                              scheduleEnabled: true,
                              scheduleFreq: 'WEEKLY',
                              scheduleWeekdays: '1,2,3,4,5',
                              mandantId: t.mandantId || templateMandantId,
                            })
                          }
                        >
                          Zeitplan aktivieren
                        </button>
                      )}
                      {t.scheduleEnabled ? (
                        <button
                          type="button"
                          className="btn btn-ghost"
                          style={{ marginTop: '0.25rem', paddingLeft: 0 }}
                          disabled={savingScheduleId === t.id}
                          onClick={() => updateTemplateSchedule(t, { scheduleEnabled: false })}
                        >
                          Zeitplan aus
                        </button>
                      ) : null}
                    </td>
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
                  <tr>
                    <td colSpan={3} className="muted">
                      Noch keine Vorlagen.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </AppShell>
  );
}
