'use client';

import { FormEvent, useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { AppShell } from '@/components/AppShell';
import { api, getToken, getUser, statusLabel } from '@/lib/api';

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001/api';

export default function TourDetailPage() {
  const params = useParams<{ id: string }>();
  const user = getUser();
  const allowed =
    user?.role === 'ORG_ADMIN' ||
    user?.role === 'MANDANT_DISPATCHER' ||
    user?.role === 'WAREHOUSE_STAFF';
  const [tour, setTour] = useState<any>(null);
  const [error, setError] = useState('');
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [files, setFiles] = useState<Record<string, File | null>>({});
  const [msg, setMsg] = useState('');

  async function load() {
    setTour(await api(`/warehouse/tours/${params.id}`));
  }

  useEffect(() => {
    if (!allowed) return;
    load().catch((e) => setError(e.message));
  }, [params.id, allowed]);

  if (!allowed) {
    return (
      <AppShell title="Tour">
        <div className="panel">Kein Zugriff.</div>
      </AppShell>
    );
  }

  if (!tour && !error) return <AppShell title="Tour">Laden…</AppShell>;

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

  async function submitNote(e: FormEvent, shipmentId: string) {
    e.preventDefault();
    setError('');
    setMsg('');
    try {
      await api(`/warehouse/tours/${params.id}/shipments/${shipmentId}/notes`, {
        method: 'POST',
        body: JSON.stringify({ body: notes[shipmentId] || '' }),
      });
      setNotes((n) => ({ ...n, [shipmentId]: '' }));
      setMsg('Kommentar gespeichert.');
      await load();
    } catch (err: any) {
      setError(err.message);
    }
  }

  async function submitPhoto(e: FormEvent, shipmentId: string) {
    e.preventDefault();
    setError('');
    setMsg('');
    const file = files[shipmentId];
    if (!file) return;
    try {
      const fd = new FormData();
      fd.append('file', file);
      await api(`/warehouse/tours/${params.id}/shipments/${shipmentId}/photos`, {
        method: 'POST',
        body: fd,
      });
      setFiles((f) => ({ ...f, [shipmentId]: null }));
      setMsg('Foto hochgeladen.');
      await load();
    } catch (err: any) {
      setError(err.message);
    }
  }

  const dateLabel = tour
    ? new Date(String(tour.date).slice(0, 10) + 'T12:00:00').toLocaleDateString('de-AT', {
        weekday: 'long',
        day: '2-digit',
        month: 'long',
        year: 'numeric',
      })
    : '';

  return (
    <AppShell title={tour?.name || 'Tour'}>
      <div className="row" style={{ marginBottom: '1rem', gap: '1rem' }}>
        <Link href="/lager" className="btn btn-ghost">← Touren</Link>
        <span className="muted">{dateLabel} · {tour?.mandant?.name}</span>
      </div>
      {error && <div className="error">{error}</div>}
      {msg && <div className="success">{msg}</div>}

      <div className="stack" style={{ gap: '1rem' }}>
        {(tour?.shipments || []).map((link: any) => {
          const s = link.shipment;
          return (
            <div key={link.id} className="panel stack">
              <div className="row" style={{ justifyContent: 'space-between' }}>
                <div>
                  <strong>{s.trackingNumber}</strong>
                  <span className="badge" style={{ marginLeft: 8 }}>{statusLabel(s.status)}</span>
                  <div className="muted">{s.customer?.name} · Ref. {s.reference || '–'}</div>
                </div>
                <Link href={`/shipments/${s.id}`} className="btn btn-ghost">Details</Link>
              </div>
              <div className="grid-2">
                <div>
                  <div className="muted">Abholung</div>
                  <div>{s.pickupCompany}</div>
                  <div className="muted">{s.pickupZip} {s.pickupCity}</div>
                </div>
                <div>
                  <div className="muted">Zustellung</div>
                  <div>{s.deliveryCompany}</div>
                  <div className="muted">{s.deliveryZip} {s.deliveryCity}</div>
                </div>
              </div>

              <div>
                <strong>Lager-Fotos</strong>
                <ul style={{ margin: '0.35rem 0', paddingLeft: '1.1rem' }}>
                  {(s.documents || []).map((d: any) => (
                    <li key={d.id}>
                      <button
                        type="button"
                        className="btn btn-ghost"
                        style={{ padding: '0.15rem 0.4rem' }}
                        onClick={() => downloadDoc(d.id, d.fileName)}
                      >
                        {d.fileName}
                      </button>
                    </li>
                  ))}
                  {!s.documents?.length && <li className="muted">keine Fotos</li>}
                </ul>
                <form className="row" onSubmit={(e) => submitPhoto(e, s.id)}>
                  <input
                    type="file"
                    accept="image/*,.pdf"
                    onChange={(e) =>
                      setFiles((f) => ({ ...f, [s.id]: e.target.files?.[0] || null }))
                    }
                  />
                  <button className="btn btn-secondary" type="submit" disabled={!files[s.id]}>
                    Foto speichern
                  </button>
                </form>
              </div>

              <div>
                <strong>Kommentare</strong>
                <ul style={{ margin: '0.35rem 0', paddingLeft: '1.1rem' }}>
                  {(s.warehouseNotes || []).map((n: any) => (
                    <li key={n.id}>
                      <span className="muted" style={{ fontSize: '0.8rem' }}>
                        {new Date(n.createdAt).toLocaleString('de-AT')}:
                      </span>{' '}
                      {n.body}
                    </li>
                  ))}
                  {!s.warehouseNotes?.length && <li className="muted">keine Kommentare</li>}
                </ul>
                <form className="row" onSubmit={(e) => submitNote(e, s.id)}>
                  <input
                    required
                    placeholder="Kommentar…"
                    value={notes[s.id] || ''}
                    onChange={(e) => setNotes((n) => ({ ...n, [s.id]: e.target.value }))}
                    style={{ flex: 1 }}
                  />
                  <button className="btn btn-primary" type="submit">Kommentar</button>
                </form>
              </div>
            </div>
          );
        })}
        {!tour?.shipments?.length && (
          <div className="panel muted">Keine Sendungen in dieser Tour (Abhol-/Zustelldatum am Tourtag).</div>
        )}
      </div>
    </AppShell>
  );
}
