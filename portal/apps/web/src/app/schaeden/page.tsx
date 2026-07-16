'use client';

import { FormEvent, useEffect, useState } from 'react';
import { AppShell } from '@/components/AppShell';
import { api, getToken, getUser } from '@/lib/api';

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001/api';

const STATUS_LABELS: Record<string, string> = {
  OPEN: 'Offen',
  IN_PROGRESS: 'In Bearbeitung',
  RESOLVED: 'Behoben',
  CLOSED: 'Geschlossen',
};

export default function SchaedenPage() {
  const user = getUser();
  const allowed =
    user?.role === 'ORG_ADMIN' ||
    user?.role === 'MANDANT_DISPATCHER' ||
    user?.role === 'WAREHOUSE_STAFF';
  const [items, setItems] = useState<any[]>([]);
  const [shipments, setShipments] = useState<any[]>([]);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [photo, setPhoto] = useState<File | null>(null);
  const [form, setForm] = useState({
    title: '',
    description: '',
    shipmentId: '',
    location: '',
  });

  async function load() {
    setItems(await api('/damages'));
  }

  useEffect(() => {
    if (!allowed) return;
    load().catch((e) => setError(e.message));
    api<any[]>('/shipments')
      .then(setShipments)
      .catch(() => null);
  }, [allowed]);

  if (!allowed) {
    return (
      <AppShell title="Schäden">
        <div className="panel">Kein Zugriff – nur für interne WOG-Mitarbeiter.</div>
      </AppShell>
    );
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError('');
    setMessage('');
    try {
      const created = await api<any>('/damages', {
        method: 'POST',
        body: JSON.stringify({
          title: form.title,
          description: form.description,
          location: form.location || undefined,
          shipmentId: form.shipmentId || undefined,
        }),
      });
      if (photo) {
        const fd = new FormData();
        fd.append('file', photo);
        await api(`/damages/${created.id}/photos`, { method: 'POST', body: fd });
      }
      setForm({ title: '', description: '', shipmentId: '', location: '' });
      setPhoto(null);
      setMessage('Schadenmeldung erfasst.');
      await load();
    } catch (err: any) {
      setError(err.message);
    }
  }

  async function downloadDoc(docId: string, fileName: string) {
    const res = await fetch(`${API_URL}/documents/${docId}/download`, {
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

  return (
    <AppShell title="Schäden">
      <p className="muted" style={{ marginBottom: '1rem' }}>
        Interne Schadenmeldungen – optional einer Sendung zugeordnet, mit Fotos.
      </p>

      <form className="panel stack" style={{ marginBottom: '1.25rem', maxWidth: 720 }} onSubmit={onSubmit}>
        <strong>Neue Schadenmeldung</strong>
        <div className="field">
          <label>Titel</label>
          <input
            required
            value={form.title}
            onChange={(e) => setForm({ ...form, title: e.target.value })}
            placeholder="z.B. Beschädigte Palette"
          />
        </div>
        <div className="field">
          <label>Beschreibung</label>
          <textarea
            required
            rows={3}
            value={form.description}
            onChange={(e) => setForm({ ...form, description: e.target.value })}
            style={{ width: '100%', padding: '0.6rem', borderRadius: 8, border: '1px solid var(--line)' }}
          />
        </div>
        <div className="grid-2">
          <div className="field">
            <label>Sendung (optional)</label>
            <select
              value={form.shipmentId}
              onChange={(e) => setForm({ ...form, shipmentId: e.target.value })}
            >
              <option value="">– keine –</option>
              {shipments.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.trackingNumber} · {s.customer?.name || ''}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label>Ort (optional)</label>
            <input
              value={form.location}
              onChange={(e) => setForm({ ...form, location: e.target.value })}
              placeholder="Lager / Rampe / Tour"
            />
          </div>
        </div>
        <div className="field">
          <label>Foto (optional)</label>
          <input type="file" accept="image/*,.pdf" onChange={(e) => setPhoto(e.target.files?.[0] || null)} />
        </div>
        {error && <div className="error">{error}</div>}
        {message && <div className="success">{message}</div>}
        <button className="btn btn-primary" type="submit">Melden</button>
      </form>

      <div className="panel">
        <strong>Meldungen</strong>
        <table className="table">
          <thead>
            <tr>
              <th>Titel</th>
              <th>Sendung</th>
              <th>Ort</th>
              <th>Fotos</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {items.map((d) => (
              <tr key={d.id}>
                <td>
                  <strong>{d.title}</strong>
                  <div className="muted" style={{ fontSize: '0.85rem' }}>{d.description}</div>
                  <div className="muted" style={{ fontSize: '0.75rem' }}>
                    {new Date(d.createdAt).toLocaleString('de-AT')}
                  </div>
                </td>
                <td>
                  {d.shipment ? (
                    <>
                      {d.shipment.trackingNumber}
                      <div className="muted">{d.shipment.customer?.name}</div>
                    </>
                  ) : (
                    '–'
                  )}
                </td>
                <td>{d.location || '–'}</td>
                <td>
                  {(d.documents || []).map((doc: any) => (
                    <button
                      key={doc.id}
                      type="button"
                      className="btn btn-ghost"
                      style={{ display: 'block', padding: '0.15rem 0.4rem' }}
                      onClick={() => downloadDoc(doc.id, doc.fileName)}
                    >
                      {doc.fileName}
                    </button>
                  ))}
                  {!d.documents?.length && <span className="muted">–</span>}
                </td>
                <td>
                  <select
                    value={d.status}
                    onChange={async (e) => {
                      await api(`/damages/${d.id}/status`, {
                        method: 'PATCH',
                        body: JSON.stringify({ status: e.target.value }),
                      });
                      await load();
                    }}
                  >
                    {Object.entries(STATUS_LABELS).map(([k, v]) => (
                      <option key={k} value={k}>{v}</option>
                    ))}
                  </select>
                </td>
              </tr>
            ))}
            {!items.length && (
              <tr><td colSpan={5} className="muted">Noch keine Schadenmeldungen.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </AppShell>
  );
}
