'use client';

import { FormEvent, useEffect, useState } from 'react';
import {
  VORARLBERG_CH_GOODS_BORDERS,
  COUNTRIES,
  normalizeSmartBorderPlate,
  smartBorderPlateHint,
  type VorarlbergChGoodsBorder,
} from '@wog/shared';
import { AppShell } from '@/components/AppShell';
import { api, getToken, getUser } from '@/lib/api';

const BORDER_PRESETS: VorarlbergChGoodsBorder[] = [...VORARLBERG_CH_GOODS_BORDERS];
const BORDER_OTHER = '__other__';
const API_URL = process.env.NEXT_PUBLIC_API_URL || '/api';

const STATUS_LABEL: Record<string, string> = {
  SUBMITTED: 'Übermittelt',
  ACCEPTED: 'Angenommen',
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

function clip(value: string | null | undefined, max = 40) {
  const s = String(value || '').trim();
  if (!s) return '–';
  if (s.length <= max) return s;
  return `${s.slice(0, max - 1)}…`;
}

function soloplanLabel(ref?: string | null) {
  if (!ref) return null;
  if (ref.startsWith('FILE:') || ref.startsWith('SP-STUB-')) return null;
  return ref;
}

function statusBadgeClass(status: string) {
  if (status === 'ACCEPTED' || status === 'DONE') return 'badge ok';
  if (status === 'CANCELLED') return 'badge warn';
  return 'badge';
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
  const [invoice, setInvoice] = useState<FileList | null>(null);
  const [extraPapers, setExtraPapers] = useState<Record<string, FileList | null>>({});
  const [inquiryBusy, setInquiryBusy] = useState('');
  const [abweichend, setAbweichend] = useState(false);
  const [absender, setAbsender] = useState<Party>(emptyParty('AT'));
  const [empfaenger, setEmpfaenger] = useState<Party>(emptyParty('CH'));
  const [frachtzahler, setFrachtzahler] = useState<Party>(emptyParty('AT'));
  const [borderPreset, setBorderPreset] = useState<string>(BORDER_PRESETS[0]);
  const [borderCustom, setBorderCustom] = useState('');
  const [form, setForm] = useState({
    customerId: '',
    kennzeichen: '',
    zulassungsland: 'AT',
    kennzeichenAnhaenger: '',
    zulassungslandAnhaenger: 'AT',
    zeit: '',
    importeur: '',
    zazKonto: '',
    warenort: '',
    mandantId: '',
    notes: '',
  });

  const fromChFl = ['CH', 'LI', 'FL'].includes(absender.country.trim().toUpperCase());
  const toAt = ['AT', 'A'].includes(empfaenger.country.trim().toUpperCase());
  const needsWarenort = fromChFl && toAt;
  const grenzuebergang =
    borderPreset === BORDER_OTHER ? borderCustom.trim() : borderPreset;

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
      if (needsWarenort && !form.warenort.trim()) {
        throw new Error('Warenort/Verzollungsort ist bei CH/FL → Österreich Pflicht');
      }
      if (!grenzuebergang || grenzuebergang.length < 2) {
        throw new Error('Grenzübergang bitte auswählen oder als Freitext eingeben');
      }
      if (!invoice?.length) {
        throw new Error('Rechnung ist Pflicht – bitte die Rechnung hochladen');
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
      fd.append('grenzuebergang', grenzuebergang);
      fd.append('zeit', new Date(form.zeit).toISOString());
      fd.append('importeur', form.importeur);
      if (form.zazKonto.trim()) fd.append('zazKonto', form.zazKonto.trim());
      if (form.warenort.trim()) fd.append('warenort', form.warenort.trim());
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
      Array.from(invoice).forEach((file) => fd.append('invoice', file));
      if (papers) {
        Array.from(papers).forEach((file) => fd.append('papers', file));
      }

      await api('/customs', { method: 'POST', body: fd });
      setMessage('Verzollungsauftrag übermittelt.');
      setPapers(null);
      setInvoice(null);
      setBorderCustom('');
      setBorderPreset(BORDER_PRESETS[0]);
      setForm((f) => ({
        ...f,
        kennzeichen: '',
        kennzeichenAnhaenger: '',
        importeur: '',
        zazKonto: '',
        warenort: '',
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

  async function requestInquiry(orderId: string) {
    setError('');
    setMessage('');
    setInquiryBusy(orderId);
    try {
      const note = window.prompt(
        'Optionaler Hinweis zur Sendungsnachfrage (Status / Zustellung):',
        '',
      );
      if (note === null) return;
      await api(`/customs/${orderId}/inquiry`, {
        method: 'POST',
        body: JSON.stringify({ note: note.trim() || undefined }),
      });
      setMessage('Sendungsnachfrage an info@worldofgreen.ch gesendet.');
    } catch (err: any) {
      setError(err?.message || 'Sendungsnachfrage fehlgeschlagen');
    } finally {
      setInquiryBusy('');
    }
  }

  return (
    <AppShell title="Verzollungsauftrag">
      <p className="muted" style={{ marginBottom: '1rem' }}>
        Verzollungsauftrag Vorarlberg–Schweiz inkl. Absender, Empfänger und Pflicht-Rechnung.
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
            <label>Grenzübergang / Grenzzollstelle</label>
            <select
              required
              value={borderPreset}
              onChange={(e) => setBorderPreset(e.target.value)}
            >
              {BORDER_PRESETS.map((b) => (
                <option key={b} value={b}>
                  {b}
                </option>
              ))}
              <option value={BORDER_OTHER}>Andere (Freitext)</option>
            </select>
            {borderPreset === BORDER_OTHER && (
              <input
                required
                style={{ marginTop: '0.4rem' }}
                placeholder="Grenzübergang als Freitext"
                value={borderCustom}
                onChange={(e) => setBorderCustom(e.target.value)}
              />
            )}
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
            <label>ZAZ-Konto</label>
            <input
              placeholder="ZAZ-Kontonummer"
              value={form.zazKonto}
              onChange={(e) => setForm({ ...form, zazKonto: e.target.value })}
            />
          </div>
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

        <div className="field">
          <label>
            Warenort / Verzollungsort
            {needsWarenort ? '' : ' (optional)'}
          </label>
          <input
            required={needsWarenort}
            placeholder={
              needsWarenort
                ? 'Ort der Verzollung (CH/FL → AT)'
                : 'Relevant bei Verkehrsrichtung CH/FL → Österreich'
            }
            value={form.warenort}
            onChange={(e) => setForm({ ...form, warenort: e.target.value })}
          />
          {needsWarenort && (
            <span className="muted" style={{ fontSize: '0.8rem' }}>
              Pflicht bei Verkehrsrichtung Schweiz/Liechtenstein nach Österreich.
            </span>
          )}
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
          <label>Rechnung (Pflicht)</label>
          <input
            required
            type="file"
            multiple
            accept=".pdf,.png,.jpg,.jpeg,.tif,.tiff,application/pdf,image/*"
            onChange={(e) => setInvoice(e.target.files)}
          />
          {invoice && invoice.length > 0 && (
            <ul style={{ margin: '0.35rem 0 0', paddingLeft: '1.1rem' }}>
              {Array.from(invoice).map((f) => (
                <li key={f.name}>
                  {f.name} ({formatBytes(f.size)})
                </li>
              ))}
            </ul>
          )}
        </div>
        <div className="field">
          <label>Begleitdokumente / Zollpapiere (optional)</label>
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
        <p className="muted" style={{ margin: '0 0 0.75rem', fontSize: '0.85rem' }}>
          {orders.length
            ? `${orders.length} Auftrag${orders.length === 1 ? '' : 'e'} – Soloplan-Nummer erscheint nach Rückmeldung.`
            : 'Noch keine Aufträge erfasst.'}
        </p>
        {error && <div className="error" style={{ marginBottom: '0.75rem' }}>{error}</div>}
        {message && <div className="success" style={{ marginBottom: '0.75rem' }}>{message}</div>}
        <table className="table table-compact">
          <thead>
            <tr>
              <th>Auftrag</th>
              <th>Soloplan</th>
              {isStaff ? <th>Kunde</th> : null}
              <th>Fahrzeug</th>
              <th>Route</th>
              <th>Grenze / Importeur</th>
              <th>Dokumente</th>
              <th>Status</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {orders.map((o) => {
              const sp = soloplanLabel(o.soloplanRef);
              const docs = o.documents || [];
              const invoiceDocs = docs.filter((d: any) => d.type === 'INVOICE');
              const otherDocs = docs.filter((d: any) => d.type !== 'INVOICE');
              return (
                <tr key={o.id}>
                  <td style={{ whiteSpace: 'nowrap', minWidth: '7.5rem' }}>
                    <strong className="mono">{o.externalNumber || '–'}</strong>
                    <span className="meta">
                      {new Date(o.zeit).toLocaleString('de-AT', {
                        day: '2-digit',
                        month: '2-digit',
                        year: 'numeric',
                        hour: '2-digit',
                        minute: '2-digit',
                      })}
                    </span>
                  </td>
                  <td style={{ whiteSpace: 'nowrap' }}>
                    {sp ? (
                      <strong className="mono">{sp}</strong>
                    ) : (
                      <span className="meta">–</span>
                    )}
                  </td>
                  {isStaff ? (
                    <td>
                      <span className="cell-clip" title={o.customer?.name || ''}>
                        {clip(o.customer?.name, 28)}
                      </span>
                      <span className="meta mono">{o.customer?.customerNumber || ''}</span>
                    </td>
                  ) : null}
                  <td style={{ whiteSpace: 'nowrap' }}>
                    <strong className="mono">{o.kennzeichen}</strong>
                    <span className="meta">{o.zulassungsland || '–'}</span>
                    {o.kennzeichenAnhaenger ? (
                      <span className="meta mono" title={`Anhänger ${o.kennzeichenAnhaenger}`}>
                        Anh. {o.kennzeichenAnhaenger}
                        {o.zulassungslandAnhaenger ? ` (${o.zulassungslandAnhaenger})` : ''}
                      </span>
                    ) : null}
                  </td>
                  <td>
                    <span className="cell-clip" title={o.absenderFirma || ''}>
                      {clip(o.absenderFirma, 32)}
                    </span>
                    <span className="meta" title={o.empfaengerFirma || ''}>
                      → {clip(o.empfaengerFirma, 32)}
                    </span>
                    <span className="meta">
                      {[o.absenderCountry, o.empfaengerCountry].filter(Boolean).join(' → ') || '–'}
                    </span>
                    {o.abweichenderFrachtzahler ? (
                      <span className="meta" title={o.frachtzahlerFirma || ''}>
                        Fracht: {clip(o.frachtzahlerFirma, 24)}
                      </span>
                    ) : null}
                  </td>
                  <td>
                    <span className="cell-clip-wide" title={o.grenzuebergang || ''}>
                      {clip(o.grenzuebergang, 36)}
                    </span>
                    <span className="meta" title={o.importeur || ''}>
                      Imp. {clip(o.importeur, 28)}
                    </span>
                    <div className="meta-row">
                      {o.zazKonto ? <span title={o.zazKonto}>ZAZ {clip(o.zazKonto, 16)}</span> : null}
                      {o.warenort ? <span title={o.warenort}>Ort {clip(o.warenort, 18)}</span> : null}
                    </div>
                  </td>
                  <td>
                    <div className="docs-list">
                      {invoiceDocs.map((d: any) => (
                        <button
                          key={d.id}
                          type="button"
                          className="btn btn-ghost"
                          style={{ padding: '0.15rem 0.35rem', fontSize: '0.78rem' }}
                          title={d.fileName}
                          onClick={() => downloadDoc(d.id, d.fileName)}
                        >
                          RG {clip(d.fileName, 18)}
                        </button>
                      ))}
                      {otherDocs.map((d: any) => (
                        <button
                          key={d.id}
                          type="button"
                          className="btn btn-ghost"
                          style={{ padding: '0.15rem 0.35rem', fontSize: '0.78rem' }}
                          title={d.fileName}
                          onClick={() => downloadDoc(d.id, d.fileName)}
                        >
                          {clip(d.fileName, 20)}
                        </button>
                      ))}
                      {!docs.length ? <span className="meta">keine Dateien</span> : null}
                      <div className="row" style={{ gap: '0.35rem', marginTop: '0.25rem', alignItems: 'center' }}>
                        <label
                          className="btn btn-secondary"
                          style={{
                            padding: '0.2rem 0.45rem',
                            fontSize: '0.75rem',
                            cursor: 'pointer',
                            margin: 0,
                          }}
                        >
                          + Datei
                          <input
                            type="file"
                            multiple
                            hidden
                            onChange={(e) =>
                              setExtraPapers((prev) => ({ ...prev, [o.id]: e.target.files }))
                            }
                          />
                        </label>
                        {extraPapers[o.id]?.length ? (
                          <button
                            type="button"
                            className="btn btn-primary"
                            style={{ padding: '0.2rem 0.45rem', fontSize: '0.75rem' }}
                            onClick={() => uploadExtra(o.id)}
                          >
                            Hochladen ({extraPapers[o.id]?.length})
                          </button>
                        ) : null}
                      </div>
                    </div>
                  </td>
                  <td>
                    <span className={statusBadgeClass(o.status)}>
                      {STATUS_LABEL[o.status] || o.status}
                    </span>
                  </td>
                  <td>
                    <div className="stack" style={{ gap: '0.35rem' }}>
                      {isStaff ? (
                        <select
                          aria-label={`Status ${o.externalNumber || o.id}`}
                          value={o.status}
                          style={{ maxWidth: '9.5rem', fontSize: '0.8rem' }}
                          onChange={async (e) => {
                            await api(`/customs/${o.id}/status`, {
                              method: 'PATCH',
                              body: JSON.stringify({ status: e.target.value }),
                            });
                            await load();
                          }}
                        >
                          <option value="SUBMITTED">Übermittelt</option>
                          <option value="ACCEPTED">Angenommen</option>
                          <option value="IN_PROGRESS">In Bearbeitung</option>
                          <option value="DONE">Erledigt</option>
                          <option value="CANCELLED">Storniert</option>
                        </select>
                      ) : null}
                      <button
                        type="button"
                        className="btn btn-secondary"
                        style={{ padding: '0.25rem 0.55rem', fontSize: '0.78rem' }}
                        disabled={inquiryBusy === o.id || o.status === 'CANCELLED'}
                        title="Status- und Zustellinfo bei WOG anfragen"
                        onClick={() => requestInquiry(o.id)}
                      >
                        {inquiryBusy === o.id ? 'Sende…' : 'Sendungsnachfrage'}
                      </button>
                    </div>
                  </td>
                </tr>
              );
            })}
            {!orders.length && (
              <tr>
                <td colSpan={isStaff ? 9 : 8} className="muted">
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
