'use client';

import { Suspense, useEffect, useMemo, useState } from 'react';
import { useParams, useSearchParams } from 'next/navigation';
import { AppShell } from '@/components/AppShell';
import { shipmentExtrasLabels, type ShipmentExtras } from '@wog/shared';
import { api, getUser, statusLabel } from '@/lib/api';
import { openBlankTabForAsyncWork, openDocumentInNewTab } from '@/lib/download';

const STATUSES = [
  'ACCEPTED', 'PICKED_UP', 'IN_TRANSIT', 'OUT_FOR_DELIVERY', 'DELIVERED', 'EXCEPTION', 'CANCELLED',
];

const CUSTOMS_REF_LABELS: Record<string, string> = {
  EZOLL_CC529: 'AT Ausfuhr (CC529)',
  EZOLL_CC599: 'AT Austritt (CC599)',
  EZOLL_EZ922: 'AT Import Abgaben (EZ922)',
  EZOLL_EZ923: 'AT Import Freigabe (EZ923)',
  EZOLL_CC029: 'AT Transit (CC029)',
  SMARTBORDER_CCATBT02: 'SmartBorder Eingang',
  SMARTBORDER_CCATBT12: 'SmartBorder Transit',
  MERCURIO_CH: 'CH e-dec (Mercurio)',
};

function soloplanStatusLabel(ref?: string | null) {
  if (!ref) return { label: 'TMS: noch nicht übergeben', tone: 'muted' as const, orderNumber: null as string | null };
  if (ref.startsWith('SP-STUB-')) return { label: 'TMS: Stub', tone: 'muted' as const, orderNumber: null };
  if (ref.startsWith('FILE:')) return { label: 'TMS: Datei exportiert', tone: 'ok' as const, orderNumber: null };
  return { label: `Soloplan-Ordernummer: ${ref}`, tone: 'ok' as const, orderNumber: ref };
}

function ShipmentDetailInner() {
  const params = useParams<{ id: string }>();
  const search = useSearchParams();
  const [shipment, setShipment] = useState<any>(null);
  const [orderDetail, setOrderDetail] = useState<any>(null);
  const [status, setStatus] = useState('IN_TRANSIT');
  const [message, setMessage] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [docType, setDocType] = useState('CUSTOMER_UPLOAD');
  const [banner, setBanner] = useState(false);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [info, setInfo] = useState('');
  const user = getUser();

  const DOC_TYPE_LABELS: Record<string, string> = {
    INVOICE: 'Rechnung',
    CUSTOMER_UPLOAD: 'Sonstiges',
    CMR: 'CMR',
    OTHER: 'Andere',
    CUSTOMS_PAPER: 'Zollpapier',
    LOADING_LIST: 'Ladeliste',
    ABLIEFERBELEG: 'Ablieferbeleg',
    POD: 'POD',
    LABEL: 'Etikett',
  };

  const DOC_CAT_LABELS: Record<string, string> = {
    INVOICE: 'Rechnung',
    CUSTOMS_EXIT: 'Austrittsbestätigung',
    POD: 'POD / Abliefernachweis',
    CMR: 'CMR',
    OTHER: 'Sonstiges',
  };

  const needsInvoice =
    Boolean((shipment?.extras as ShipmentExtras | null)?.verzollung) &&
    !(shipment?.documents || []).some((d: any) => d.type === 'INVOICE');

  async function load() {
    const s = await api<any>(`/shipments/${params.id}`);
    setShipment(s);
    if (s.orderId) {
      try {
        setOrderDetail(await api(`/orders/${s.orderId}`));
      } catch {
        setOrderDetail(null);
      }
    } else {
      setOrderDetail(null);
    }
  }

  useEffect(() => {
    load().catch(console.error);
  }, [params.id]);

  useEffect(() => {
    if (search.get('handover') === '1') setBanner(true);
  }, [search]);

  const canDispatch = user?.role === 'ORG_ADMIN' || user?.role === 'MANDANT_DISPATCHER';
  const tms = useMemo(
    () => soloplanStatusLabel(shipment?.order?.soloplanRef || shipment?.soloplanRef),
    [shipment],
  );
  if (!shipment) return <AppShell title="Sendung">Laden…</AppShell>;

  return (
    <AppShell title={`Sendung ${shipment.trackingNumber}`}>
      <div className="stack">
        {(banner || shipment.status === 'SUBMITTED') && (
          <div className="success" style={{ padding: '0.85rem 1rem' }}>
            <strong>Auftrag übermittelt</strong>
            <div>
              Auftragsnummer <strong>{shipment.order?.externalNumber || '–'}</strong>
              {' · '}
              Tracking <strong>{shipment.trackingNumber}</strong>
              {shipment.trackingPin ? ` · PIN ${shipment.trackingPin}` : ''}
            </div>
            <div className="muted" style={{ marginTop: '0.35rem', fontSize: '0.85rem' }}>
              WOG und Sie können die Übergabe an dieser Auftragsnummer und am Status „Übermittelt“ erkennen.
              {tms.tone === 'ok' ? ` ${tms.label}.` : ''}
            </div>
            <div className="row" style={{ marginTop: '0.65rem', gap: '0.5rem', flexWrap: 'wrap' }}>
              <button
                className="btn btn-primary"
                disabled={busy === 'labels' || shipment.status === 'CANCELLED'}
                title={
                  shipment.status === 'CANCELLED'
                    ? 'Stornierte Sendung – nicht andrucken'
                    : undefined
                }
                onClick={async () => {
                  setError('');
                  setBusy('labels');
                  const win = openBlankTabForAsyncWork();
                  try {
                    const res = await api<any>(`/shipments/${shipment.id}/labels`, {
                      method: 'POST',
                    });
                    const printDoc = res.printDocument || res.documents?.[res.documents.length - 1];
                    if (!printDoc?.id) throw new Error('Etiketten-PDF fehlt');
                    await openDocumentInNewTab(printDoc.id, printDoc.fileName, { targetWin: win });
                    await load();
                  } catch (e: any) {
                    try {
                      win?.close();
                    } catch {
                      /* ignore */
                    }
                    setError(e.message);
                  } finally {
                    setBusy('');
                  }
                }}
              >
                Etiketten drucken
              </button>
              {shipment.orderId && (
                <button
                  className="btn btn-secondary"
                  disabled={busy === 'loading-list'}
                  onClick={async () => {
                    setError('');
                    setBusy('loading-list');
                    const win = openBlankTabForAsyncWork();
                    try {
                      const res = await api<any>(`/orders/${shipment.orderId}/loading-list`, {
                        method: 'POST',
                      });
                      await openDocumentInNewTab(res.document.id, res.document.fileName, {
                        targetWin: win,
                      });
                      await load();
                    } catch (e: any) {
                      try {
                        win?.close();
                      } catch {
                        /* ignore */
                      }
                      setError(e.message);
                    } finally {
                      setBusy('');
                    }
                  }}
                >
                  Ladeliste / Auftragsbestätigung drucken
                </button>
              )}
            </div>
          </div>
        )}
        {error && <div className="error">{error}</div>}
        {info && <div className="success">{info}</div>}

        <div className="grid-2">
          <div className="panel stack">
            <div className="row">
              <span className="badge ok">{statusLabel(shipment.status)}</span>
              <span className="muted">{shipment.mandant?.name}</span>
            </div>
            <div><strong>Kunde:</strong> {shipment.customer?.name}</div>
            <div>
              <strong>Auftrag:</strong> {shipment.order?.externalNumber || '–'}
            </div>
            <div><strong>Frachtzahler:</strong> {shipment.order?.freightPayer?.name || shipment.customer?.name || '–'}</div>
            <div><strong>Referenz:</strong> {shipment.reference || '–'}</div>
            {(shipment.eta?.etaAt || shipment.eta?.etaText) && (
              <div
                style={{
                  marginTop: '0.5rem',
                  padding: '0.65rem 0.75rem',
                  borderRadius: 8,
                  background: 'rgba(26,107,60,0.08)',
                  border: '1px solid rgba(26,107,60,0.22)',
                }}
              >
                <div className="muted">Erwartete Zustellung (Live-ETA)</div>
                <strong>
                  {shipment.eta.etaAt
                    ? new Date(shipment.eta.etaAt).toLocaleString('de-CH', {
                        timeZone: 'Europe/Zurich',
                        day: '2-digit',
                        month: '2-digit',
                        year: 'numeric',
                        hour: '2-digit',
                        minute: '2-digit',
                      })
                    : '—'}
                </strong>
                {shipment.eta.etaText ? (
                  <div className="muted" style={{ marginTop: 4, fontSize: '0.85rem' }}>
                    {shipment.eta.etaText}
                  </div>
                ) : null}
                {shipment.eta.tourNumber ? (
                  <div className="muted" style={{ fontSize: '0.8rem' }}>
                    Tour {shipment.eta.tourNumber}
                  </div>
                ) : null}
              </div>
            )}
            <div>
              <strong>Soloplan:</strong>{' '}
              {tms.orderNumber ? <strong>{tms.orderNumber}</strong> : <span className="muted">–</span>}
            </div>
            {(shipment.customsRefs || []).length > 0 && (
              <div style={{ marginTop: '0.5rem' }}>
                <strong>Zoll-Referenzen (MRN / LRN)</strong>
                <ul style={{ margin: '0.35rem 0 0', paddingLeft: '1.1rem' }}>
                  {(shipment.customsRefs as any[]).map((r) => (
                    <li key={r.id} style={{ marginBottom: '0.25rem' }}>
                      <span className="badge">
                        {r.sourceLabel || CUSTOMS_REF_LABELS[r.source] || r.source}
                      </span>
                      {r.mrn ? (
                        <div style={{ fontSize: '0.9rem' }}>
                          <strong>MRN:</strong> {r.mrn}
                        </div>
                      ) : null}
                      {r.lrn ? (
                        <div style={{ fontSize: '0.9rem' }}>
                          <strong>LRN:</strong> {r.lrn}
                        </div>
                      ) : null}
                    </li>
                  ))}
                </ul>
              </div>
            )}
            <div><strong>PIN:</strong> {shipment.trackingPin || '–'}</div>
            <div className="muted" style={{ fontSize: '0.85rem' }}>{tms.label}</div>
            <button
              type="button"
              className="btn btn-secondary"
              disabled={busy === 'inquiry' || shipment.status === 'CANCELLED'}
              title="Status- und Zustellinfo bei WOG anfragen"
              onClick={async () => {
                setError('');
                setInfo('');
                setBusy('inquiry');
                try {
                  const note = window.prompt(
                    'Optionaler Hinweis zur Sendungsnachfrage (Status / Zustellung):',
                    '',
                  );
                  if (note === null) return;
                  await api(`/shipments/${shipment.id}/inquiry`, {
                    method: 'POST',
                    body: JSON.stringify({ note: note.trim() || undefined }),
                  });
                  setInfo('Sendungsnachfrage an info@worldofgreen.ch gesendet.');
                } catch (e: any) {
                  setError(e?.message || 'Sendungsnachfrage fehlgeschlagen');
                } finally {
                  setBusy('');
                }
              }}
            >
              {busy === 'inquiry' ? 'Sende…' : 'Sendungsnachfrage'}
            </button>
            <div className="grid-2">
              <div>
                <strong>Abholung</strong>
                <div className="muted">{shipment.pickupCompany}</div>
                <div className="muted">{shipment.pickupStreet}</div>
                <div className="muted">{shipment.pickupZip} {shipment.pickupCity}</div>
                {shipment.pickupDate ? (
                  <div className="muted" style={{ marginTop: '0.35rem' }}>
                    Datum:{' '}
                    {new Date(shipment.pickupDate).toLocaleString('de-CH', {
                      timeZone: 'UTC',
                      day: '2-digit',
                      month: '2-digit',
                      year: 'numeric',
                      hour: '2-digit',
                      minute: '2-digit',
                    })}
                  </div>
                ) : null}
                {(shipment.extras as ShipmentExtras | null)?.pickupNote ? (
                  <div className="muted" style={{ marginTop: '0.35rem' }}>
                    Info: {(shipment.extras as ShipmentExtras).pickupNote}
                  </div>
                ) : null}
              </div>
              <div>
                <strong>Zustellung</strong>
                <div className="muted">{shipment.deliveryCompany}</div>
                <div className="muted">{shipment.deliveryStreet}</div>
                <div className="muted">{shipment.deliveryZip} {shipment.deliveryCity}</div>
                {shipment.deliveryDate ? (
                  <div className="muted" style={{ marginTop: '0.35rem' }}>
                    Von:{' '}
                    {new Date(shipment.deliveryDate).toLocaleString('de-CH', {
                      timeZone: 'UTC',
                      day: '2-digit',
                      month: '2-digit',
                      year: 'numeric',
                      hour: '2-digit',
                      minute: '2-digit',
                    })}
                    {shipment.deliveryDateEnd
                      ? ` · Bis: ${new Date(shipment.deliveryDateEnd).toLocaleString('de-CH', {
                          timeZone: 'UTC',
                          day: '2-digit',
                          month: '2-digit',
                          year: 'numeric',
                          hour: '2-digit',
                          minute: '2-digit',
                        })}`
                      : ''}
                  </div>
                ) : null}
                {shipment.deliveryAvisPhone && (
                  <div className="muted">Avis-Tel: {shipment.deliveryAvisPhone}</div>
                )}
                {(shipment.extras as ShipmentExtras | null)?.deliveryNote ? (
                  <div className="muted" style={{ marginTop: '0.35rem' }}>
                    Info: {(shipment.extras as ShipmentExtras).deliveryNote}
                  </div>
                ) : null}
              </div>
            </div>
            {shipment.extras && shipmentExtrasLabels(shipment.extras as ShipmentExtras).length > 0 && (
              <div className="stack" style={{ borderTop: '1px solid var(--line)', paddingTop: '1rem' }}>
                <strong>Zusatzinformationen</strong>
                <div className="muted" style={{ fontSize: '0.9rem' }}>
                  {shipmentExtrasLabels(shipment.extras as ShipmentExtras).join(' · ')}
                  {(shipment.extras as ShipmentExtras).goodsValueEur != null
                    ? ` · Warenwert ${(shipment.extras as ShipmentExtras).goodsValueEur} EUR`
                    : ''}
                </div>
              </div>
            )}

            {canDispatch && (
              <div className="stack" style={{ borderTop: '1px solid var(--line)', paddingTop: '1rem' }}>
                <strong>Status aktualisieren</strong>
                <select value={status} onChange={(e) => setStatus(e.target.value)}>
                  {STATUSES.map((s) => <option key={s} value={s}>{statusLabel(s)}</option>)}
                </select>
                <input placeholder="Nachricht" value={message} onChange={(e) => setMessage(e.target.value)} />
                <button
                  className="btn btn-secondary"
                  onClick={async () => {
                    await api(`/shipments/${shipment.id}/status`, {
                      method: 'PATCH',
                      body: JSON.stringify({ status, message }),
                    });
                    await load();
                  }}
                >
                  Speichern
                </button>
                <button
                  className="btn btn-ghost"
                  onClick={async () => {
                    await api(`/documents/ablieferbeleg/${shipment.id}`, { method: 'POST' });
                    await load();
                  }}
                >
                  Ablieferbeleg erzeugen
                </button>
              </div>
            )}
            {(shipment.colli?.length > 0 || shipment.positions?.length > 0) && (
              <div className="stack" style={{ borderTop: '1px solid var(--line)', paddingTop: '1rem' }}>
                <strong>Colli</strong>
                {(shipment.colli?.length > 0 ? shipment.colli : shipment.positions).map((c: any, idx: number) => {
                  const n = c.itemNumber ?? idx + 1;
                  const dims =
                    c.lengthCm != null || c.widthCm != null || c.heightCm != null
                      ? `${c.lengthCm ?? '–'} × ${c.widthCm ?? '–'} × ${c.heightCm ?? '–'} cm`
                      : null;
                  return (
                    <div key={c.id || idx} className="muted" style={{ fontSize: '0.9rem' }}>
                      #{n}
                      {c.packaging ? ` · ${c.packaging}` : ''}
                      {c.sscc ? `: ${c.sscc}` : ''}
                      {c.content || c.description ? ` · ${c.content || c.description}` : ''}
                      {c.weightKg != null ? ` · ${c.weightKg} kg` : ''}
                      {dims ? ` · ${dims}` : ''}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
          <div className="stack">
            <div className="panel">
              <strong>Track & Trace</strong>
              <ul className="timeline" style={{ marginTop: '1rem' }}>
                {shipment.events?.map((e: any) => (
                  <li key={e.id}>
                    <div><strong>{statusLabel(e.status)}</strong></div>
                    <div className="muted">{e.message}</div>
                    <div className="muted" style={{ fontSize: '0.8rem' }}>{new Date(e.createdAt).toLocaleString('de-AT')}</div>
                  </li>
                ))}
              </ul>
            </div>
            <div className="panel stack">
              <strong>Dokumente</strong>
              {needsInvoice && (
                <div className="error" style={{ margin: 0 }}>
                  Verzollung aktiv: bitte eine <strong>Rechnung</strong> hochladen.
                </div>
              )}
              {(() => {
                const isCustomerUser = user?.role === 'CUSTOMER_USER';
                const moduleEnabled = Boolean(shipment.documentsModule?.enabled);
                const moduleCats: string[] = shipment.documentsModule?.categories || [];
                const exitFreigabe =
                  !isCustomerUser ||
                  (moduleEnabled && moduleCats.includes('CUSTOMS_EXIT'));
                const allDocs = [
                  ...(shipment.documents || []),
                  ...((orderDetail?.documents || []).filter(
                    (d: any) => !(shipment.documents || []).some((s: any) => s.id === d.id),
                  )),
                ];
                const exitDoc = allDocs.find((d: any) => d.categoryCode === 'CUSTOMS_EXIT');
                // Kunde: Modul-Dokumente nur bei Freigabe; sonst normale Upload-/Etikett-Docs
                const otherDocs = allDocs.filter((d: any) => {
                  if (d.categoryCode === 'CUSTOMS_EXIT') return false;
                  if (
                    isCustomerUser &&
                    d.categoryCode &&
                    (!moduleEnabled || !moduleCats.includes(String(d.categoryCode)))
                  ) {
                    return false;
                  }
                  return true;
                });
                return (
                  <>
                    {exitFreigabe && (
                    <label
                      className="row"
                      style={{ gap: '0.5rem', alignItems: 'center', margin: 0 }}
                      title={
                        exitDoc
                          ? exitDoc.downloaded
                            ? 'Austritt geöffnet/heruntergeladen'
                            : 'Austritt vorhanden – bitte öffnen'
                          : 'Noch keine Austrittsbestätigung'
                      }
                    >
                      <input
                        type="checkbox"
                        checked={Boolean(exitDoc?.downloaded)}
                        readOnly
                        disabled={!exitDoc}
                        aria-label="Austritt hochgeladen"
                      />
                      <span>Austritt hochgeladen</span>
                      {exitDoc ? (
                        <button
                          type="button"
                          className="btn btn-ghost"
                          style={{ padding: '0.15rem 0.5rem' }}
                          disabled={busy === `dl-${exitDoc.id}`}
                          onClick={async () => {
                            setBusy(`dl-${exitDoc.id}`);
                            setError('');
                            const win = openBlankTabForAsyncWork();
                            try {
                              await openDocumentInNewTab(exitDoc.id, exitDoc.fileName, {
                                targetWin: win,
                              });
                              setShipment((prev: any) =>
                                prev
                                  ? {
                                      ...prev,
                                      documents: (prev.documents || []).map((d: any) =>
                                        d.id === exitDoc.id
                                          ? {
                                              ...d,
                                              downloaded: true,
                                              downloadedAt: new Date().toISOString(),
                                            }
                                          : d,
                                      ),
                                    }
                                  : prev,
                              );
                            } catch (e: any) {
                              try {
                                win?.close();
                              } catch {
                                /* ignore */
                              }
                              setError(e?.message || 'Download fehlgeschlagen');
                            } finally {
                              setBusy('');
                            }
                          }}
                        >
                          {busy === `dl-${exitDoc.id}` ? '…' : 'Öffnen'}
                        </button>
                      ) : (
                        <span className="muted">fehlt</span>
                      )}
                    </label>
                    )}
                    {otherDocs.map((d: any) => (
                      <div className="row" key={d.id} style={{ justifyContent: 'space-between' }}>
                        <span>
                          {d.fileName}{' '}
                          <span className="badge">
                            {d.categoryCode
                              ? DOC_CAT_LABELS[d.categoryCode] || d.categoryCode
                              : DOC_TYPE_LABELS[d.type] || d.type}
                          </span>
                          {d.downloaded ? (
                            <span className="muted" style={{ marginLeft: '0.35rem', fontSize: '0.8rem' }}>
                              ✓ geöffnet
                            </span>
                          ) : null}
                        </span>
                        <a
                          href={`${process.env.NEXT_PUBLIC_API_URL || '/api'}/documents/${d.id}/download`}
                          onClick={(e) => {
                            e.preventDefault();
                            const win = openBlankTabForAsyncWork();
                            openDocumentInNewTab(d.id, d.fileName, { targetWin: win })
                              .then(() => {
                                setShipment((prev: any) =>
                                  prev
                                    ? {
                                        ...prev,
                                        documents: (prev.documents || []).map((x: any) =>
                                          x.id === d.id
                                            ? {
                                                ...x,
                                                downloaded: true,
                                                downloadedAt: new Date().toISOString(),
                                              }
                                            : x,
                                        ),
                                      }
                                    : prev,
                                );
                              })
                              .catch((err) => {
                                try {
                                  win?.close();
                                } catch {
                                  /* ignore */
                                }
                                console.error(err);
                              });
                          }}
                        >
                          Öffnen
                        </a>
                      </div>
                    ))}
                  </>
                );
              })()}
              <div className="field">
                <label>Dokumenttyp</label>
                <select
                  value={needsInvoice ? 'INVOICE' : docType}
                  onChange={(e) => setDocType(e.target.value)}
                >
                  <option value="INVOICE">Rechnung</option>
                  <option value="CUSTOMER_UPLOAD">Sonstiges Dokument</option>
                  <option value="CMR">CMR / Frachtbrief</option>
                  <option value="OTHER">Andere</option>
                </select>
              </div>
              <input
                type="file"
                accept=".pdf,.png,.jpg,.jpeg,.tif,.tiff,application/pdf,image/*"
                onChange={(e) => setFile(e.target.files?.[0] || null)}
              />
              <button
                className="btn btn-primary"
                disabled={!file || busy === 'upload'}
                onClick={async () => {
                  if (!file) return;
                  setBusy('upload');
                  setError('');
                  try {
                    const type = needsInvoice ? 'INVOICE' : docType;
                    const fd = new FormData();
                    fd.append('file', file);
                    await api(`/documents/upload?shipmentId=${shipment.id}&type=${type}`, {
                      method: 'POST',
                      body: fd,
                    });
                    setFile(null);
                    await load();
                  } catch (e: any) {
                    setError(e.message || 'Upload fehlgeschlagen');
                  } finally {
                    setBusy('');
                  }
                }}
              >
                Dokument an WOG senden
              </button>
            </div>
          </div>
        </div>
      </div>
    </AppShell>
  );
}


export default function ShipmentDetailPage() {
  return (
    <Suspense fallback={<AppShell title="Sendung">Laden…</AppShell>}>
      <ShipmentDetailInner />
    </Suspense>
  );
}
