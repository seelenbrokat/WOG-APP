'use client';

import { FormEvent, useEffect, useState } from 'react';
import {
  VORARLBERG_CH_GOODS_BORDERS,
  FRANKATUREN,
  COUNTRIES,
  normalizeSmartBorderPlate,
  smartBorderPlateHint,
  type VorarlbergChGoodsBorder,
  type Frankatur,
} from '@wog/shared';
import { AppShell } from '@/components/AppShell';
import { api, getToken, getUser } from '@/lib/api';

const BORDER_PRESETS: VorarlbergChGoodsBorder[] = [...VORARLBERG_CH_GOODS_BORDERS];
const FRANKATUR_PRESETS: Frankatur[] = [...FRANKATUREN];
const API_URL = process.env.NEXT_PUBLIC_API_URL || '/api';

const STATUS_LABEL: Record<string, string> = {
  SUBMITTED: 'Übermittelt',
  IN_PROGRESS: 'In Bearbeitung',
  DONE: 'Erledigt',
  CANCELLED: 'Storniert',
};

type Address = {
  id: string;
  label?: string | null;
  company?: string | null;
  street: string;
  zip: string;
  city: string;
  country: string;
  usage: string;
  isDefault?: boolean;
};

type Party = {
  firma: string;
  street: string;
  zip: string;
  city: string;
  country: string;
};

type CustomerOption = {
  id: string;
  name: string;
  customerNumber: string;
};

const emptyParty = (country = 'AT'): Party => ({
  firma: '',
  street: '',
  zip: '',
  city: '',
  country,
});

function formatBytes(n: number) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

function PartyFields({
  title,
  party,
  setParty,
  addresses,
  defaultCountry,
}: {
  title: string;
  party: Party;
  setParty: (p: Party) => void;
  addresses: Address[];
  defaultCountry: string;
}) {
  return (
    <div className="stack">
      <strong>{title}</strong>
      {addresses.length > 0 && (
        <select
          defaultValue=""
          onChange={(e) => {
            const a = addresses.find((x) => x.id === e.target.value);
            if (!a) return;
            setParty({
              firma: a.company || a.label || '',
              street: a.street,
              zip: a.zip,
              city: a.city,
              country: a.country || defaultCountry,
            });
          }}
        >
          <option value="">– aus Adressbuch wählen –</option>
          {addresses.map((a) => (
            <option key={a.id} value={a.id}>
              {(a.label || a.company || a.street)} · {a.zip} {a.city}
            </option>
          ))}
        </select>
      )}
      <input
        required
        placeholder="Firma"
        value={party.firma}
        onChange={(e) => setParty({ ...party, firma: e.target.value })}
      />
      <input
        required
        placeholder="Straße"
        value={party.street}
        onChange={(e) => setParty({ ...party, street: e.target.value })}
      />
      <div className="row">
        <input
          required
          placeholder="PLZ"
          value={party.zip}
          onChange={(e) => setParty({ ...party, zip: e.target.value })}
        />
        <input
          required
          placeholder="Ort"
          value={party.city}
          onChange={(e) => setParty({ ...party, city: e.target.value })}
        />
        <input
          required
          placeholder="Land"
          value={party.country}
          onChange={(e) => setParty({ ...party, country: e.target.value })}
          style={{ maxWidth: 70 }}
        />
      </div>
    </div>
  );
}

export default function CustomsPage() {
  const user = getUser();
  const isCustomer = user?.role === 'CUSTOMER_USER';
  const isStaff = user?.role === 'ORG_ADMIN' || user?.role === 'MANDANT_DISPATCHER';
  const [orders, setOrders] = useState<any[]>([]);
  const [mandanten, setMandanten] = useState<any[]>([]);
  const [customers, setCustomers] = useState<CustomerOption[]>([]);
  const [addresses, setAddresses] = useState<Address[]>([]);
  const [customerName, setCustomerName] = useState('');
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [papers, setPapers] = useState<FileList | null>(null);
  const [extraPapers, setExtraPapers] = useState<Record<string, FileList | null>>({});
  const [abweichend, setAbweichend] = useState(false);
  const [absender, setAbsender] = useState<Party>(emptyParty('AT'));
  const [empfaenger, setEmpfaenger] = useState<Party>(emptyParty('CH'));
  const [frachtzahler, setFrachtzahler] = useState<Party>(emptyParty('AT'));
  const [form, setForm] = useState({
    customerId: '',
    kennzeichen: '',
    zulassungsland: 'AT',
    kennzeichenAnhaenger: '',
    zulassungslandAnhaenger: 'AT',
    grenzuebergang: BORDER_PRESETS[0],
    grenzzollstelle: '',
    zeit: '',
    importeur: '',
    frankatur: FRANKATUR_PRESETS[0],
    mandantId: '',
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
    load().catch((err) => setError(err.message));

    if (isCustomer) {
      api<any>('/auth/me')
        .then((me) => {
          setCustomerName(me.customer?.name || `${me.firstName} ${me.lastName}`);
          if (me.customer?.name) {
            setAbsender((a) => ({ ...a, firma: a.firma || me.customer.name }));
          }
        })
        .catch(() => null);
      api<Address[]>('/customers/me/addresses')
        .then((list) => {
          setAddresses(list);
          const def = list.find((a) => a.isDefault) || list[0];
          if (def) {
            setAbsender({
              firma: def.company || def.label || '',
              street: def.street,
              zip: def.zip,
              city: def.city,
              country: def.country || 'AT',
            });
          }
        })
        .catch(() => null);
    }

    if (isStaff) {
      api<CustomerOption[]>('/customers')
        .then((list) => {
          setCustomers(list);
          if (list[0]) setForm((f) => ({ ...f, customerId: f.customerId || list[0].id }));
        })
        .catch(() => null);
    }
  }, []);

  useEffect(() => {
    if (!isStaff || !form.customerId) return;
    api<Address[]>(`/customers/${form.customerId}/addresses`)
      .then((list) => {
        setAddresses(list);
        const def = list.find((a) => a.isDefault) || list[0];
        const cust = customers.find((c) => c.id === form.customerId);
        if (def) {
          setAbsender({
            firma: def.company || def.label || cust?.name || '',
            street: def.street,
            zip: def.zip,
            city: def.city,
            country: def.country || 'AT',
          });
        } else if (cust) {
          setAbsender((a) => ({ ...a, firma: a.firma || cust.name }));
        }
      })
      .catch(() => setAddresses([]));
  }, [form.customerId, isStaff, customers]);

  async function downloadDoc(docId: string, fileName: string) {
    const res = await fetch(`${API_URL}/customs/documents/${docId}/download`, {
      headers: { Authorization: `Bearer ${getToken()}` },
    });
    if (!res.ok) throw new Error('Download fehlgeschlagen');
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = fileName;
    a.click();
    URL.revokeObjectURL(url);
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError('');
    setMessage('');
    try {
      if (isStaff && !form.customerId) {
        throw new Error('Bitte einen Kunden wählen');
      }
      const fd = new FormData();
      if (isStaff) fd.append('customerId', form.customerId);
      const kennzeichen = normalizeSmartBorderPlate(form.kennzeichen, form.zulassungsland);
      fd.append('kennzeichen', kennzeichen);
      fd.append('zulassungsland', form.zulassungsland.trim().toUpperCase());
      if (form.kennzeichenAnhaenger.trim()) {
        fd.append(
          'kennzeichenAnhaenger',
          normalizeSmartBorderPlate(form.kennzeichenAnhaenger, form.zulassungslandAnhaenger),
        );
        fd.append('zulassungslandAnhaenger', form.zulassungslandAnhaenger.trim().toUpperCase());
      }
      fd.append('grenzuebergang', form.grenzuebergang);
      if (form.grenzzollstelle.trim()) fd.append('grenzzollstelle', form.grenzzollstelle.trim());
      fd.append('zeit', new Date(form.zeit).toISOString());
      fd.append('importeur', form.importeur);
      fd.append('frankatur', form.frankatur);
      if (form.mandantId) fd.append('mandantId', form.mandantId);
      if (form.notes) fd.append('notes', form.notes);
      fd.append('abweichenderFrachtzahler', abweichend ? 'true' : 'false');
      fd.append('absenderFirma', absender.firma);
      fd.append('absenderStreet', absender.street);
      fd.append('absenderZip', absender.zip);
      fd.append('absenderCity', absender.city);
      fd.append('absenderCountry', absender.country);
      fd.append('empfaengerFirma', empfaenger.firma);
      fd.append('empfaengerStreet', empfaenger.street);
      fd.append('empfaengerZip', empfaenger.zip);
      fd.append('empfaengerCity', empfaenger.city);
      fd.append('empfaengerCountry', empfaenger.country);
      if (abweichend) {
        fd.append('frachtzahlerFirma', frachtzahler.firma);
        fd.append('frachtzahlerStreet', frachtzahler.street);
        fd.append('frachtzahlerZip', frachtzahler.zip);
        fd.append('frachtzahlerCity', frachtzahler.city);
        fd.append('frachtzahlerCountry', frachtzahler.country);
      }
      if (papers) {
        Array.from(papers).forEach((file) => fd.append('papers', file));
      }

      await api('/customs', { method: 'POST', body: fd });
      setMessage('Verzollungsauftrag übermittelt.');
      setPapers(null);
      setForm((f) => ({
        ...f,
        kennzeichen: '',
        kennzeichenAnhaenger: '',
        grenzzollstelle: '',
        importeur: '',
        notes: '',
      }));
      await load();
    } catch (err: any) {
      setError(err.message);
    }
  }

  async function uploadExtra(orderId: string) {
    const files = extraPapers[orderId];
    if (!files?.length) return;
    const fd = new FormData();
    Array.from(files).forEach((file) => fd.append('papers', file));
    await api(`/customs/${orderId}/papers`, { method: 'POST', body: fd });
    setExtraPapers((prev) => ({ ...prev, [orderId]: null }));
    await load();
  }

  return (
    <AppShell title="Verzollungsauftrag">
      <p className="muted" style={{ marginBottom: '1rem' }}>
        Verzollungsauftrag Vorarlberg–Schweiz inkl. Absender, Empfänger, Frankatur und Zollpapieren.
        Kennzeichen nach den Eingaberichtlinien von Smart Border Austria.
        {isCustomer
          ? ` Auftraggeber: ${customerName || 'angemeldeter Kunde'}.`
          : ' Admin/Disposition kann Aufträge für Kunden erfassen und bearbeiten.'}
      </p>

      <form className="panel stack" style={{ marginBottom: '1.25rem', maxWidth: 920 }} onSubmit={onSubmit}>
        <strong>Neuer Verzollungsauftrag</strong>

        {isStaff ? (
          <div className="field">
            <label>Kunde</label>
            <select
              required
              value={form.customerId}
              onChange={(e) => setForm({ ...form, customerId: e.target.value })}
            >
              <option value="">– Kunde wählen –</option>
              {customers.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name} ({c.customerNumber})
                </option>
              ))}
            </select>
          </div>
        ) : null}

        <div className="grid-2">
          <div className="field">
            <label>Kennzeichen</label>
            <input
              required
              placeholder="z. B. W-12345T"
              value={form.kennzeichen}
              onChange={(e) => setForm({ ...form, kennzeichen: e.target.value })}
              onBlur={() =>
                setForm((f) => ({
                  ...f,
                  kennzeichen: normalizeSmartBorderPlate(f.kennzeichen, f.zulassungsland),
                }))
              }
              autoCapitalize="characters"
              spellCheck={false}
            />
            <span className="muted" style={{ fontSize: '0.8rem' }}>
              {smartBorderPlateHint(form.zulassungsland)}
            </span>
          </div>
          <div className="field">
            <label>Zulassungsland</label>
            <select
              required
              value={form.zulassungsland}
              onChange={(e) => setForm({ ...form, zulassungsland: e.target.value })}
            >
              {COUNTRIES.map((c) => (
                <option key={c.code} value={c.code}>
                  {c.code} – {c.label}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="grid-2">
          <div className="field">
            <label>Kennzeichen Anhänger</label>
            <input
              placeholder="optional, z. B. W-98765A"
              value={form.kennzeichenAnhaenger}
              onChange={(e) => setForm({ ...form, kennzeichenAnhaenger: e.target.value })}
              onBlur={() =>
                setForm((f) => ({
                  ...f,
                  kennzeichenAnhaenger: f.kennzeichenAnhaenger
                    ? normalizeSmartBorderPlate(f.kennzeichenAnhaenger, f.zulassungslandAnhaenger)
                    : '',
                }))
              }
              autoCapitalize="characters"
              spellCheck={false}
            />
            <span className="muted" style={{ fontSize: '0.8rem' }}>
              {form.kennzeichenAnhaenger
                ? smartBorderPlateHint(form.zulassungslandAnhaenger)
                : 'Optional – gleiche Schreibweise wie Kennzeichen (Smart Border Austria).'}
            </span>
          </div>
          <div className="field">
            <label>Zulassungsland Anhänger</label>
            <select
              value={form.zulassungslandAnhaenger}
              onChange={(e) => setForm({ ...form, zulassungslandAnhaenger: e.target.value })}
              disabled={!form.kennzeichenAnhaenger.trim()}
            >
              {COUNTRIES.map((c) => (
                <option key={c.code} value={c.code}>
                  {c.code} – {c.label}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="grid-2">
          <div className="field">
            <label>Zeit (Grenze)</label>
            <input
              required
              type="datetime-local"
              value={form.zeit}
              onChange={(e) => setForm({ ...form, zeit: e.target.value })}
            />
          </div>
          <div className="field">
            <label>Grenzzollstelle</label>
            <input
              placeholder="Freitext, z. B. AT330400"
              value={form.grenzzollstelle}
              onChange={(e) => setForm({ ...form, grenzzollstelle: e.target.value })}
            />
          </div>
        </div>

        <div className="grid-2">
          <div className="field">
            <label>Grenzübergang (Warenverkehr V / CH)</label>
            <select
              required
              value={form.grenzuebergang}
              onChange={(e) =>
                setForm({
                  ...form,
                  grenzuebergang: e.target.value as VorarlbergChGoodsBorder,
                })
              }
            >
              {BORDER_PRESETS.map((b) => (
                <option key={b} value={b}>
                  {b}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label>Frankatur</label>
            <select
              required
              value={form.frankatur}
              onChange={(e) =>
                setForm({
                  ...form,
                  frankatur: e.target.value as Frankatur,
                })
              }
            >
              {FRANKATUR_PRESETS.map((f) => (
                <option key={f} value={f}>
                  {f}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="grid-2">
          <div className="field">
            <label>Importeur</label>
            <input
              required
              placeholder="Firmenname Importeur"
              value={form.importeur}
              onChange={(e) => setForm({ ...form, importeur: e.target.value })}
            />
          </div>
          <div className="field">
            <label>Mandant</label>
            <select
              value={form.mandantId}
              onChange={(e) => setForm({ ...form, mandantId: e.target.value })}
            >
              {mandanten.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="grid-2">
          <PartyFields
            title="Absender"
            party={absender}
            setParty={setAbsender}
            addresses={addresses}
            defaultCountry="AT"
          />
          <PartyFields
            title="Empfänger"
            party={empfaenger}
            setParty={setEmpfaenger}
            addresses={addresses}
            defaultCountry="CH"
          />
        </div>

        <div className="panel stack" style={{ background: 'var(--bg-panel)' }}>
          <label className="row">
            <input
              type="checkbox"
              checked={abweichend}
              onChange={(e) => setAbweichend(e.target.checked)}
            />
            Abweichender Frachtzahler
            {isCustomer
              ? ` (sonst: angemeldeter Kunde${customerName ? ` – ${customerName}` : ''})`
              : ' (sonst: gewählter Kunde)'}
          </label>
          {abweichend && (
            <PartyFields
              title="Frachtzahler"
              party={frachtzahler}
              setParty={setFrachtzahler}
              addresses={addresses}
              defaultCountry="AT"
            />
          )}
        </div>

        <div className="field">
          <label>Zollpapiere</label>
          <input
            type="file"
            multiple
            accept=".pdf,.png,.jpg,.jpeg,.tif,.tiff,.xml,.zip,application/pdf,image/*"
            onChange={(e) => setPapers(e.target.files)}
          />
          {papers && papers.length > 0 && (
            <ul style={{ margin: '0.35rem 0 0', paddingLeft: '1.1rem' }}>
              {Array.from(papers).map((f) => (
                <li key={f.name}>
                  {f.name} ({formatBytes(f.size)})
                </li>
              ))}
            </ul>
          )}
        </div>
        <div className="field">
          <label>Hinweis (optional)</label>
          <input value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
        </div>
        {error && <div className="error">{error}</div>}
        {message && <div className="success">{message}</div>}
        <button className="btn btn-primary" type="submit">
          Auftrag übermitteln
        </button>
      </form>

      <div className="panel">
        <strong>Verzollungsaufträge</strong>
        <table className="table">
          <thead>
            <tr>
              {isStaff ? <th>Kunde</th> : null}
              <th>Kennzeichen</th>
              <th>Kennzeichen Anhänger</th>
              <th>Grenze</th>
              <th>Absender → Empfänger</th>
              <th>Frankatur</th>
              <th>Papiere</th>
              <th>Status</th>
              {isStaff ? <th></th> : null}
            </tr>
          </thead>
          <tbody>
            {orders.map((o) => (
              <tr key={o.id}>
                {isStaff ? (
                  <td>
                    <strong>{o.customer?.name || '–'}</strong>
                    <div className="muted" style={{ fontSize: '0.8rem' }}>
                      {o.customer?.customerNumber || ''}
                    </div>
                  </td>
                ) : null}
                <td>
                  <strong>{o.kennzeichen}</strong>
                  <div className="muted" style={{ fontSize: '0.8rem' }}>
                    Zulassungsland: {o.zulassungsland || '–'}
                  </div>
                  <div className="muted" style={{ fontSize: '0.8rem' }}>
                    {new Date(o.zeit).toLocaleString('de-AT')}
                  </div>
                </td>
                <td>
                  {o.kennzeichenAnhaenger ? (
                    <>
                      <strong>{o.kennzeichenAnhaenger}</strong>
                      <div className="muted" style={{ fontSize: '0.8rem' }}>
                        Zulassungsland: {o.zulassungslandAnhaenger || '–'}
                      </div>
                    </>
                  ) : (
                    <span className="muted">–</span>
                  )}
                </td>
                <td>
                  <div>{o.grenzuebergang}</div>
                  {o.grenzzollstelle ? (
                    <div className="muted" style={{ fontSize: '0.8rem' }}>
                      Grenzzollstelle: {o.grenzzollstelle}
                    </div>
                  ) : (
                    <div className="muted" style={{ fontSize: '0.8rem' }}>
                      Grenzzollstelle: –
                    </div>
                  )}
                </td>
                <td>
                  <div>{o.absenderFirma || '–'}</div>
                  <div className="muted">→ {o.empfaengerFirma || '–'}</div>
                  {o.abweichenderFrachtzahler && (
                    <div className="muted" style={{ fontSize: '0.8rem' }}>
                      Frachtzahler: {o.frachtzahlerFirma}
                    </div>
                  )}
                </td>
                <td>{o.frankatur || '–'}</td>
                <td>
                  <div className="stack" style={{ gap: '0.35rem' }}>
                    {(o.documents || []).map((d: any) => (
                      <button
                        key={d.id}
                        type="button"
                        className="btn btn-ghost"
                        style={{ padding: '0.2rem 0.45rem', justifyContent: 'flex-start' }}
                        onClick={() => downloadDoc(d.id, d.fileName)}
                      >
                        {d.fileName}
                      </button>
                    ))}
                    {!o.documents?.length && <span className="muted">keine</span>}
                    <div className="row">
                      <input
                        type="file"
                        multiple
                        onChange={(e) =>
                          setExtraPapers((prev) => ({ ...prev, [o.id]: e.target.files }))
                        }
                      />
                      <button
                        type="button"
                        className="btn btn-secondary"
                        disabled={!extraPapers[o.id]?.length}
                        onClick={() => uploadExtra(o.id)}
                      >
                        Hochladen
                      </button>
                    </div>
                  </div>
                </td>
                <td>
                  <span className="badge">{STATUS_LABEL[o.status] || o.status}</span>
                </td>
                {isStaff ? (
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
                ) : null}
              </tr>
            ))}
            {!orders.length && (
              <tr>
                <td colSpan={isStaff ? 9 : 7} className="muted">
                  Noch keine Verzollungsaufträge.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </AppShell>
  );
}
