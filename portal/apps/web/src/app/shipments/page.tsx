'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { AppShell } from '@/components/AppShell';
import { api, getToken, getUser, statusLabel } from '@/lib/api';

async function downloadDocument(docId: string, fileName: string) {
  const res = await fetch(`${process.env.NEXT_PUBLIC_API_URL || '/api'}/documents/${docId}/download`, {
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

/** Abhol-/Zustelltermine als UTC-Kalenderzeit (00:00 = 00:00). */
function formatSchedule(value?: string | null) {
  if (!value) return '–';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '–';
  return d.toLocaleString('de-CH', {
    timeZone: 'UTC',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function placeCell(company?: string | null, city?: string | null, zip?: string | null) {
  const name = (company || '').trim();
  const loc = [zip, city].filter(Boolean).join(' ');
  if (!name && !loc) return '–';
  return (
    <div>
      {name ? <div>{name}</div> : null}
      {loc ? <div className="muted" style={{ fontSize: '0.85rem' }}>{loc}</div> : null}
    </div>
  );
}

export default function ShipmentsPage() {
  const [shipments, setShipments] = useState<any[]>([]);
  const [mandanten, setMandanten] = useState<any[]>([]);
  const [mandantId, setMandantId] = useState('');
  const [q, setQ] = useState('');
  const [selected, setSelected] = useState<Record<string, boolean>>({});
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [info, setInfo] = useState('');

  async function load(opts?: { mandantId?: string; q?: string }) {
    const params = new URLSearchParams();
    if (opts?.mandantId) params.set('mandantId', opts.mandantId);
    if (opts?.q?.trim()) params.set('q', opts.q.trim());
    const qs = params.toString();
    const rows = await api<any[]>(`/shipments${qs ? `?${qs}` : ''}`);
    setShipments(rows);
    setSelected({});
  }

  useEffect(() => {
    api<any[]>('/mandanten').then(setMandanten).catch(() => setMandanten([]));
    load();
  }, []);

  useEffect(() => {
    const t = window.setTimeout(() => {
      load({ mandantId: mandantId || undefined, q }).catch((e: any) =>
        setError(e?.message || 'Laden fehlgeschlagen'),
      );
    }, 280);
    return () => window.clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q, mandantId]);

  const user = getUser();
  const isCustomer = user?.role === 'CUSTOMER_USER';
  const selectable = useMemo(
    () => shipments.filter((s) => s.orderId),
    [shipments],
  );
  const selectedIds = useMemo(
    () => selectable.filter((s) => selected[s.id]).map((s) => s.id),
    [selectable, selected],
  );
  const selectedOrderIds = useMemo(() => {
    const ids = selectable.filter((s) => selected[s.id]).map((s) => s.orderId as string);
    return [...new Set(ids)];
  }, [selectable, selected]);
  const allSelected = selectable.length > 0 && selectedIds.length === selectable.length;

  function toggleAll(checked: boolean) {
    if (!checked) {
      setSelected({});
      return;
    }
    const next: Record<string, boolean> = {};
    for (const s of selectable) next[s.id] = true;
    setSelected(next);
  }

  async function runBulk(handover: boolean) {
    if (!selectedOrderIds.length) return;
    setError('');
    setInfo('');
    setBusy(handover ? 'handover' : 'pdf');
    try {
      const res = await api<any>('/orders/loading-list/bulk', {
        method: 'POST',
        body: JSON.stringify({ orderIds: selectedOrderIds, handover }),
      });
      if (!res.document?.id) throw new Error('Ladeliste fehlt');
      await downloadDocument(res.document.id, res.document.fileName);
      const n = res.orderCount || selectedOrderIds.length;
      setInfo(
        handover
          ? `${n} Auftrag/Aufträge übergeben · Sammelladeliste heruntergeladen`
          : `Sammelladeliste für ${n} Auftrag/Aufträge heruntergeladen`,
      );
      await load({ mandantId: mandantId || undefined, q });
    } catch (e: any) {
      setError(e.message || 'Aktion fehlgeschlagen');
    } finally {
      setBusy('');
    }
  }

  return (
    <AppShell title="Sendungen">
      <div className="stack">
        <div className="row" style={{ marginBottom: 0, flexWrap: 'wrap', gap: '0.65rem' }}>
          <input
            type="search"
            placeholder="Suche: Empfänger, Tracking, Referenz, Ort…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            style={{ minWidth: 260, flex: '1 1 220px' }}
            aria-label="Sendungen suchen"
          />
          {!isCustomer && (
            <select
              value={mandantId}
              onChange={(e) => setMandantId(e.target.value)}
            >
              <option value="">Alle Mandanten</option>
              {mandanten.map((m) => (
                <option key={m.id} value={m.id}>{m.name}</option>
              ))}
            </select>
          )}
          {(user?.role === 'ORG_ADMIN' || user?.role === 'CUSTOMER_USER' || user?.role === 'MANDANT_DISPATCHER') && (
            <Link className="btn btn-primary" href="/shipments/new">Neuer Auftrag</Link>
          )}
          {selectedOrderIds.length > 0 && (
            <>
              <button
                className="btn btn-primary"
                disabled={!!busy}
                onClick={() => runBulk(true)}
              >
                {busy === 'handover'
                  ? 'Übergabe…'
                  : `${selectedOrderIds.length} übergeben & Ladeliste`}
              </button>
              <button
                className="btn btn-secondary"
                disabled={!!busy}
                onClick={() => runBulk(false)}
              >
                {busy === 'pdf' ? 'PDF…' : 'Nur Ladeliste'}
              </button>
              <button className="btn btn-ghost" disabled={!!busy} onClick={() => setSelected({})}>
                Auswahl aufheben
              </button>
            </>
          )}
        </div>

        {error && <div className="error">{error}</div>}
        {info && <div className="success">{info}</div>}

        <p className="muted" style={{ margin: 0, fontSize: '0.9rem' }}>
          {isCustomer
            ? 'Ihre Sendungen – Suche nach Empfänger, Tracking oder Referenz.'
            : 'Aufträge markieren und gemeinsam übergeben – sie erscheinen zusammen auf einer Ladeliste.'}
        </p>

        <div className="panel">
          <table className="table">
            <thead>
              <tr>
                {!isCustomer && (
                  <th style={{ width: 36 }}>
                    <input
                      type="checkbox"
                      aria-label="Alle markieren"
                      checked={allSelected}
                      onChange={(e) => toggleAll(e.target.checked)}
                      disabled={!selectable.length}
                    />
                  </th>
                )}
                <th>Auftrag</th>
                <th>Tracking</th>
                <th>Referenz</th>
                {!isCustomer && <th>Mandant</th>}
                <th>Absender</th>
                <th>Abholung</th>
                <th>Empfänger</th>
                <th>Zustellung</th>
                <th>Status</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {shipments.map((s) => (
                <tr key={s.id}>
                  {!isCustomer && (
                    <td>
                      {s.orderId ? (
                        <input
                          type="checkbox"
                          aria-label={`Auftrag ${s.order?.externalNumber || s.trackingNumber} markieren`}
                          checked={!!selected[s.id]}
                          onChange={(e) =>
                            setSelected((prev) => ({ ...prev, [s.id]: e.target.checked }))
                          }
                        />
                      ) : (
                        <span className="muted">–</span>
                      )}
                    </td>
                  )}
                  <td>{s.order?.externalNumber || '–'}</td>
                  <td>{s.trackingNumber}</td>
                  <td>{s.reference || '–'}</td>
                  {!isCustomer && <td>{s.mandant?.name}</td>}
                  <td>{placeCell(s.pickupCompany, s.pickupCity, s.pickupZip)}</td>
                  <td style={{ whiteSpace: 'nowrap' }}>{formatSchedule(s.pickupDate)}</td>
                  <td>{placeCell(s.deliveryCompany, s.deliveryCity, s.deliveryZip)}</td>
                  <td style={{ whiteSpace: 'nowrap' }}>
                    {formatSchedule(s.deliveryDate)}
                    {s.deliveryDateEnd && s.deliveryDateEnd !== s.deliveryDate ? (
                      <span className="muted"> – {formatSchedule(s.deliveryDateEnd)}</span>
                    ) : null}
                  </td>
                  <td><span className="badge">{statusLabel(s.status)}</span></td>
                  <td><Link href={`/shipments/${s.id}`}>Details</Link></td>
                </tr>
              ))}
              {!shipments.length && (
                <tr>
                  <td colSpan={isCustomer ? 9 : 11} className="muted">
                    {q.trim() ? 'Keine Treffer für diese Suche.' : 'Keine Sendungen.'}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </AppShell>
  );
}
