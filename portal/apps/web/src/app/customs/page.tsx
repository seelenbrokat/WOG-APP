'use client';

import { FormEvent, useEffect, useState } from 'react';
import { AppShell } from '@/components/AppShell';
import { api, getToken, getUser } from '@/lib/api';

const BORDER_PRESETS = [
  'Nickelsdorf / Hegyeshalom',
  'Spielfeld / Šentilj',
  'Suben / Suben',
  'Brenner',
  'Karawankentunnel',
  'Sonstiger',
];

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001/api';

function formatBytes(n: number) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

export default function CustomsPage() {
  const user = getUser();
  const [orders, setOrders] = useState<any[]>([]);
  const [mandanten, setMandanten] = useState<any[]>([]);
  const [customers, setCustomers] = useState<any[]>([]);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [papers, setPapers] = useState<FileList | null>(null);
  const [extraPapers, setExtraPapers] = useState<Record<string, FileList | null>>({});
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
      const grenzuebergang =
        form.grenzuebergang === 'Sonstiger'
          ? form.grenzuebergangCustom
          : form.grenzuebergang;

      const fd = new FormData();
      fd.append('kennzeichen', form.kennzeichen);
      fd.append('grenzuebergang', grenzuebergang);
      fd.append('zeit', new Date(form.zeit).toISOString());
      fd.append('importeur', form.importeur);
      if (form.mandantId) fd.append('mandantId', form.mandantId);
      if (form.customerId) fd.append('customerId', form.customerId);
      if (form.notes) fd.append('notes', form.notes);
      if (papers) {
        Array.from(papers).forEach((file) => fd.append('papers', file));
      }

      await api('/customs', { method: 'POST', body: fd });
      setMessage(
        papers?.length
          ? `Verzollungsauftrag mit ${papers.length} Zollpapier(en) übermittelt.`
          : 'Verzollungsauftrag übermittelt.',
      );
      setPapers(null);
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
    <AppShell title="Verzollung">
      <p className="muted" style={{ marginBottom: '1rem' }}>
        Verzollungsauftrag mit Kennzeichen, Grenzübergang, Zeit, Importeur und Zollpapieren übermitteln.
      </p>

      <form className="panel stack" style={{ marginBottom: '1.25rem', maxWidth: 720 }} onSubmit={onSubmit}>
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
          <label>Zollpapiere</label>
          <input
            type="file"
            multiple
            accept=".pdf,.png,.jpg,.jpeg,.tif,.tiff,.xml,.zip,application/pdf,image/*"
            onChange={(e) => setPapers(e.target.files)}
          />
          <span className="muted" style={{ fontSize: '0.85rem' }}>
            Mehrere Dateien möglich (PDF, Bilder, XML, ZIP) – max. 25 MB je Datei.
          </span>
          {papers && papers.length > 0 && (
            <ul style={{ margin: '0.35rem 0 0', paddingLeft: '1.1rem' }}>
              {Array.from(papers).map((f) => (
                <li key={f.name}>{f.name} ({formatBytes(f.size)})</li>
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
              <th>Zollpapiere</th>
              <th>Status</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {orders.map((o) => (
              <tr key={o.id}>
                <td><strong>{o.kennzeichen}</strong></td>
                <td>{o.grenzuebergang}</td>
                <td>{new Date(o.zeit).toLocaleString('de-AT')}</td>
                <td>{o.importeur}</td>
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
                <td><span className="badge">{o.status}</span></td>
                <td>
                  {(user?.role === 'ORG_ADMIN' || user?.role === 'MANDANT_DISPATCHER') && (
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
                  )}
                </td>
              </tr>
            ))}
            {!orders.length && (
              <tr><td colSpan={7} className="muted">Noch keine Verzollungsaufträge.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </AppShell>
  );
}
