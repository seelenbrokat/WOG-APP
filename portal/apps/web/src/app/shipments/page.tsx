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

function formatScheduleShort(value?: string | null) {
  if (!value) return '–';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '–';
  return d.toLocaleString('de-CH', {
    timeZone: 'UTC',
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function clip(value: string | null | undefined, max = 28) {
  const s = String(value || '').trim();
  if (!s) return '–';
  if (s.length <= max) return s;
  return `${s.slice(0, max - 1)}…`;
}

function soloplanOrderNumber(s: {
  soloplanRef?: string | null;
  order?: { soloplanRef?: string | null } | null;
}) {
  for (const ref of [s.order?.soloplanRef, s.soloplanRef]) {
    if (ref && !ref.startsWith('FILE:') && !ref.startsWith('SP-STUB-')) return ref;
  }
  return null;
}

const DOC_CAT_LABELS: Record<string, string> = {
  INVOICE: 'Rechnung',
  CUSTOMS_EXIT: 'Austrittsbestätigung',
  POD: 'POD / Abliefernachweis',
  CMR: 'CMR',
  OTHER: 'Sonstiges',
};

type CustomerDoc = {
  id: string;
  fileName: string;
  categoryCode: string | null;
  createdAt: string;
  downloaded: boolean;
  downloadedAt?: string | null;
};

export default function ShipmentsPage() {
  const [shipments, setShipments] = useState<any[]>([]);
  const [mandanten, setMandanten] = useState<any[]>([]);
  const [mandantId, setMandantId] = useState('');
  const [q, setQ] = useState('');
  const [missingDocCategory, setMissingDocCategory] = useState('');
  const [docDownload, setDocDownload] = useState('');
  const [docCategory, setDocCategory] = useState('');
  const [docsModule, setDocsModule] = useState<{
    documentsModuleEnabled: boolean;
    categories: Array<{ code: string; label: string }>;
  } | null>(null);
  const [selected, setSelected] = useState<Record<string, boolean>>({});
  const [busy, setBusy] = useState('');
  const [inquiryBusy, setInquiryBusy] = useState<string>('');
  const [dlBusy, setDlBusy] = useState('');
  const [error, setError] = useState('');
  const [info, setInfo] = useState('');

  const user = getUser();
  const isCustomer = user?.role === 'CUSTOMER_USER';
  const showDocs = Boolean(isCustomer && docsModule?.documentsModuleEnabled);

  async function load(opts?: {
    mandantId?: string;
    q?: string;
    missingDocCategory?: string;
    docDownload?: string;
    docCategory?: string;
  }) {
    const params = new URLSearchParams();
    if (opts?.mandantId) params.set('mandantId', opts.mandantId);
    if (opts?.q?.trim()) params.set('q', opts.q.trim());
    if (opts?.missingDocCategory) params.set('missingDocCategory', opts.missingDocCategory);
    if (opts?.docDownload) params.set('docDownload', opts.docDownload);
    if (opts?.docCategory) params.set('docCategory', opts.docCategory);
    const qs = params.toString();
    const rows = await api<any[]>(`/shipments${qs ? `?${qs}` : ''}`);
    setShipments(rows);
    setSelected({});
  }

  useEffect(() => {
    api<any[]>('/mandanten').then(setMandanten).catch(() => setMandanten([]));
    if (isCustomer) {
      api<any>('/documents/module/me')
        .then((m) => setDocsModule(m))
        .catch(() => setDocsModule(null));
    }
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const t = window.setTimeout(() => {
      load({
        mandantId: mandantId || undefined,
        q,
        missingDocCategory: missingDocCategory || undefined,
        docDownload: docDownload || undefined,
        docCategory: docCategory || undefined,
      }).catch((e: any) => setError(e?.message || 'Laden fehlgeschlagen'));
    }, 280);
    return () => window.clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q, mandantId, missingDocCategory, docDownload, docCategory]);

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

  async function requestInquiry(shipmentId: string) {
    setError('');
    setInfo('');
    setInquiryBusy(shipmentId);
    try {
      const note = window.prompt(
        'Optionaler Hinweis zur Sendungsnachfrage (Status / Zustellung):',
        '',
      );
      if (note === null) return;
      await api(`/shipments/${shipmentId}/inquiry`, {
        method: 'POST',
        body: JSON.stringify({ note: note.trim() || undefined }),
      });
      setInfo('Sendungsnachfrage an info@worldofgreen.ch gesendet.');
    } catch (e: any) {
      setError(e?.message || 'Sendungsnachfrage fehlgeschlagen');
    } finally {
      setInquiryBusy('');
    }
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
      await load({
        mandantId: mandantId || undefined,
        q,
        missingDocCategory: missingDocCategory || undefined,
        docDownload: docDownload || undefined,
        docCategory: docCategory || undefined,
      });
    } catch (e: any) {
      setError(e.message || 'Aktion fehlgeschlagen');
    } finally {
      setBusy('');
    }
  }

  async function downloadCustomerDoc(doc: CustomerDoc) {
    setDlBusy(doc.id);
    setError('');
    try {
      await downloadDocument(doc.id, doc.fileName);
      setShipments((prev) =>
        prev.map((s) => ({
          ...s,
          customerDocuments: (s.customerDocuments || []).map((d: CustomerDoc) =>
            d.id === doc.id ? { ...d, downloaded: true, downloadedAt: new Date().toISOString() } : d,
          ),
        })),
      );
    } catch (e: any) {
      setError(e?.message || 'Download fehlgeschlagen');
    } finally {
      setDlBusy('');
    }
  }

  const colSpan = (isCustomer ? 4 : 5) + (showDocs ? 1 : 0);

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
          {showDocs && (
            <>
              <select
                value={missingDocCategory}
                onChange={(e) => setMissingDocCategory(e.target.value)}
                aria-label="Fehlendes Dokument"
              >
                <option value="">Dokument fehlt: alle</option>
                {(docsModule?.categories || []).map((c) => (
                  <option key={c.code} value={c.code}>
                    Fehlt: {c.label}
                  </option>
                ))}
              </select>
              <select
                value={docCategory}
                onChange={(e) => setDocCategory(e.target.value)}
                aria-label="Dokumentenkategorie"
              >
                <option value="">Kategorie: alle</option>
                {(docsModule?.categories || []).map((c) => (
                  <option key={c.code} value={c.code}>
                    {c.label}
                  </option>
                ))}
              </select>
              <select
                value={docDownload}
                onChange={(e) => setDocDownload(e.target.value)}
                aria-label="Download-Status"
              >
                <option value="">Download: alle</option>
                <option value="not_downloaded">Noch nicht heruntergeladen</option>
                <option value="downloaded">Bereits heruntergeladen</option>
              </select>
            </>
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
            ? showDocs
              ? 'Ihre Sendungen – Dokumente je Sendung herunterladen; Filter für fehlende / noch nicht geladene Belege.'
              : 'Ihre Sendungen – Soloplan-Nummer unter dem Auftrag, Nachfrage rechts.'
            : 'Aufträge markieren und gemeinsam übergeben. Soloplan unter VLB · Aktion rechts.'}
        </p>

        <div className="panel">
          <div className="table-scroll">
            <table className={`table table-compact table-shipments${isCustomer ? ' is-customer' : ''}`}>
              <thead>
                <tr>
                  {!isCustomer && (
                    <th className="col-check">
                      <input
                        type="checkbox"
                        aria-label="Alle markieren"
                        checked={allSelected}
                        onChange={(e) => toggleAll(e.target.checked)}
                        disabled={!selectable.length}
                      />
                    </th>
                  )}
                  <th className="col-ref">Auftrag</th>
                  <th className="col-route">Route</th>
                  <th className="col-schedule">Termine</th>
                  {showDocs && <th className="col-docs">Dokumente</th>}
                  <th className="col-side">Status / Aktion</th>
                </tr>
              </thead>
              <tbody>
                {shipments.map((s) => {
                  const sp = soloplanOrderNumber(s);
                  const pickupTitle = [s.pickupCompany, [s.pickupZip, s.pickupCity].filter(Boolean).join(' ')]
                    .filter(Boolean)
                    .join('\n');
                  const deliveryTitle = [
                    s.deliveryCompany,
                    [s.deliveryZip, s.deliveryCity].filter(Boolean).join(' '),
                  ]
                    .filter(Boolean)
                    .join('\n');
                  const scheduleTitle = [
                    `Abholung: ${formatSchedule(s.pickupDate)}`,
                    `Zustellung: ${formatSchedule(s.deliveryDate)}${
                      s.deliveryDateEnd && s.deliveryDateEnd !== s.deliveryDate
                        ? ` – ${formatSchedule(s.deliveryDateEnd)}`
                        : ''
                    }`,
                  ].join('\n');
                  const docs: CustomerDoc[] = s.customerDocuments || [];
                  return (
                    <tr key={s.id}>
                      {!isCustomer && (
                        <td className="col-check">
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
                      <td className="col-ref">
                        <strong className="mono">{s.order?.externalNumber || '–'}</strong>
                        {sp ? (
                          <span className="soloplan-num mono" title={`Soloplan ${sp}`}>
                            SP {sp}
                          </span>
                        ) : (
                          <span className="soloplan-pending">Soloplan ausstehend</span>
                        )}
                        <span className="meta mono" title={s.trackingNumber}>
                          {s.trackingNumber}
                        </span>
                        {s.reference ? (
                          <span className="meta" title={s.reference}>
                            Ref {clip(s.reference, 22)}
                          </span>
                        ) : null}
                        {!isCustomer && s.mandant?.code ? (
                          <span className="meta">{s.mandant.code}</span>
                        ) : null}
                      </td>
                      <td className="col-route">
                        <span className="cell-clip" title={pickupTitle}>
                          {clip(s.pickupCompany, 26)}
                        </span>
                        <span className="meta cell-clip" title={pickupTitle}>
                          {[s.pickupZip, s.pickupCity].filter(Boolean).join(' ') || '–'}
                        </span>
                        <span className="meta cell-clip" title={deliveryTitle}>
                          → {clip(s.deliveryCompany, 26)}
                        </span>
                        <span className="meta cell-clip" title={deliveryTitle}>
                          {[s.deliveryZip, s.deliveryCity].filter(Boolean).join(' ') || '–'}
                        </span>
                      </td>
                      <td className="col-schedule" title={scheduleTitle}>
                        <span className="meta-label">Abhol</span>
                        <strong>{formatScheduleShort(s.pickupDate)}</strong>
                        <span className="meta-label">Zustell</span>
                        <strong>
                          {formatScheduleShort(s.deliveryDate)}
                          {s.deliveryDateEnd && s.deliveryDateEnd !== s.deliveryDate
                            ? `–${formatScheduleShort(s.deliveryDateEnd)}`
                            : ''}
                        </strong>
                      </td>
                      {showDocs && (
                        <td className="col-docs">
                          <div className="stack" style={{ gap: '0.35rem', alignItems: 'flex-start' }}>
                            {docs.length === 0 && <span className="muted">Keine Dokumente</span>}
                            {docs.map((d) => (
                              <label
                                key={d.id}
                                className="row"
                                style={{ gap: '0.4rem', alignItems: 'center', margin: 0 }}
                              >
                                <input type="checkbox" checked={d.downloaded} readOnly title="Heruntergeladen" />
                                <button
                                  type="button"
                                  className="btn btn-ghost"
                                  style={{ padding: '0.15rem 0.4rem', fontSize: '0.85rem' }}
                                  disabled={dlBusy === d.id}
                                  onClick={() => downloadCustomerDoc(d)}
                                  title={d.fileName}
                                >
                                  {dlBusy === d.id
                                    ? '…'
                                    : DOC_CAT_LABELS[d.categoryCode || ''] || d.fileName}
                                </button>
                              </label>
                            ))}
                          </div>
                        </td>
                      )}
                      <td className="col-side">
                        <div className="side-stack">
                          <span className="badge">{statusLabel(s.status)}</span>
                          <Link className="btn btn-ghost btn-details" href={`/shipments/${s.id}`}>
                            Details
                          </Link>
                          <button
                            type="button"
                            className="btn btn-secondary btn-inquiry"
                            disabled={inquiryBusy === s.id || s.status === 'CANCELLED'}
                            title="Status und Zustellung bei WOG anfragen (wenn kein POD)"
                            onClick={() => requestInquiry(s.id)}
                          >
                            {inquiryBusy === s.id ? 'Sende…' : 'Sendungsnachfrage'}
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
                {!shipments.length && (
                  <tr>
                    <td colSpan={colSpan} className="muted">
                      {q.trim() || missingDocCategory || docDownload
                        ? 'Keine Treffer für diese Filter.'
                        : 'Keine Sendungen.'}
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
