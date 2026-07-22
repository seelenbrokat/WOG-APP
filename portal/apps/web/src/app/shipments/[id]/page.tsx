'use client';

import { Suspense, useEffect, useMemo, useState } from 'react';
import { useParams, useSearchParams } from 'next/navigation';
import { AppShell } from '@/components/AppShell';
import {
  shipmentExtrasLabels,
  shipmentExtrasLabelsForSite,
  type ShipmentExtras,
} from '@wog/shared';
import { api, getToken, getUser, statusLabel } from '@/lib/api';

const STATUSES = [
  'ACCEPTED', 'PICKED_UP', 'IN_TRANSIT', 'OUT_FOR_DELIVERY', 'DELIVERED', 'EXCEPTION', 'CANCELLED',
];

function soloplanStatusLabel(ref?: string | null) {
  if (!ref) return { label: 'TMS: noch nicht übergeben', tone: 'muted' as const };
  if (ref.startsWith('SP-STUB-')) return { label: 'TMS: Stub', tone: 'muted' as const };
  if (ref.startsWith('FILE:')) return { label: 'TMS: Datei exportiert', tone: 'ok' as const };
  return { label: `TMS: ${ref}`, tone: 'ok' as const };
}

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
                disabled={busy === 'labels'}
                onClick={async () => {
                  setError('');
                  setBusy('labels');
                  try {
                    const res = await api<any>(`/shipments/${shipment.id}/labels`, {
                      method: 'POST',
                    });
                    const printDoc = res.printDocument || res.documents?.[res.documents.length - 1];
                    if (!printDoc?.id) throw new Error('Etiketten-PDF fehlt');
                    await downloadDocument(printDoc.id, printDoc.fileName);
                    await load();
                  } catch (e: any) {
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
                    try {
                      const res = await api<any>(`/orders/${shipment.orderId}/loading-list`, {
                        method: 'POST',
                      });
                      await downloadDocument(res.document.id, res.document.fileName);
                      await load();
                    } catch (e: any) {
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
            <div><strong>PIN:</strong> {shipment.trackingPin || '–'}</div>
            <div className="muted" style={{ fontSize: '0.85rem' }}>{tms.label}</div>
            <div className="grid-2">
              <div>
                <strong>Abholung</strong>
                <div className="muted">{shipment.pickupCompany}</div>
                <div className="muted">{shipment.pickupStreet}</div>
                <div className="muted">{shipment.pickupZip} {shipment.pickupCity}</div>
              </div>
              <div>
                <strong>Zustellung</strong>
                <div className="muted">{shipment.deliveryCompany}</div>
                <div className="muted">{shipment.deliveryStreet}</div>
                <div className="muted">{shipment.deliveryZip} {shipment.deliveryCity}</div>
                {shipment.deliveryAvisPhone && (
                  <div className="muted">Avis-Tel: {shipment.deliveryAvisPhone}</div>
                )}
              </div>
            </div>
            {shipment.extras && (
              <div className="stack" style={{ borderTop: '1px solid var(--line)', paddingTop: '1rem', gap: '0.75rem' }}>
                {(() => {
                  const ex = shipment.extras as ShipmentExtras & { pickupAvisPhone?: string };
                  const pickupLabels = shipmentExtrasLabelsForSite(ex, 'pickup');
                  const deliveryLabels = shipmentExtrasLabelsForSite(ex, 'delivery');
                  const allLabels = shipmentExtrasLabels(ex);
                  if (!allLabels.length && !ex.pickupNote && !ex.deliveryNote && !ex.extrasNote) {
                    return null;
                  }
                  return (
                    <>
                      <strong>Zusatzinformationen</strong>
                      {(pickupLabels.length > 0 || ex.pickupNote || ex.pickupAvisPhone) && (
                        <div>
                          <div style={{ fontWeight: 600, fontSize: '0.9rem' }}>Ladestelle</div>
                          <div className="muted" style={{ fontSize: '0.9rem' }}>
                            {[
                              ex.pickupAvisPhone ? `Avis-Tel: ${ex.pickupAvisPhone}` : '',
                              pickupLabels.join(' · '),
                              ex.pickupNote || '',
                            ]
                              .filter(Boolean)
                              .join(' · ') || '—'}
                          </div>
                        </div>
                      )}
                      {(deliveryLabels.length > 0 ||
                        ex.deliveryNote ||
                        shipment.deliveryAvisPhone) && (
                        <div>
                          <div style={{ fontWeight: 600, fontSize: '0.9rem' }}>Entladestelle</div>
                          <div className="muted" style={{ fontSize: '0.9rem' }}>
                            {[
                              shipment.deliveryAvisPhone
                                ? `Avis-Tel: ${shipment.deliveryAvisPhone}`
                                : '',
                              deliveryLabels.join(' · '),
                              ex.deliveryNote || '',
                            ]
                              .filter(Boolean)
                              .join(' · ') || '—'}
                          </div>
                        </div>
                      )}
                      {ex.goodsValueEur != null ? (
                        <div className="muted" style={{ fontSize: '0.9rem' }}>
                          Warenwert {ex.goodsValueEur} EUR
                        </div>
                      ) : null}
                    </>
                  );
                })()}
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
              {[
                ...(shipment.documents || []),
                ...((orderDetail?.documents || []).filter(
                  (d: any) => !(shipment.documents || []).some((s: any) => s.id === d.id),
                )),
              ].map((d: any) => (
                <div className="row" key={d.id} style={{ justifyContent: 'space-between' }}>
                  <span>
                    {d.fileName}{' '}
                    <span className="badge">{DOC_TYPE_LABELS[d.type] || d.type}</span>
                  </span>
                  <a
                    href={`${process.env.NEXT_PUBLIC_API_URL || '/api'}/documents/${d.id}/download`}
                    onClick={(e) => {
                      e.preventDefault();
                      downloadDocument(d.id, d.fileName).catch(console.error);
                    }}
                  >
                    Download
                  </a>
                </div>
              ))}
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
