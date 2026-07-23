'use client';

import { useEffect, useRef, useState } from 'react';
import { api, getToken } from '@/lib/api';

type Group = {
  externalRef: string;
  allCustomerShipments?: boolean;
  customerId: string | null;
  customerName: string | null;
  customerNumber: string | null;
  date: string;
  shipmentCount?: number;
  orderRefs?: string[];
  expected: number;
  received: number;
  damaged: number;
};

type Session = {
  id: string;
  status: string;
  externalRef: string;
  sessionDate: string;
  documentId?: string | null;
  customer: { id: string; name: string; customerNumber: string } | null;
  summary: {
    expected: number;
    received: number;
    damaged: number;
    cancelled?: number;
    pending: number;
    missing: number;
    surplus: number;
  };
  expectedColli: Array<{
    checkId: string;
    colloId: string;
    status: string;
    sscc: string;
    itemNumber: number;
    content?: string | null;
    packaging?: string | null;
    trackingNumber: string;
    reference?: string | null;
    note?: string | null;
    shipmentId: string;
    deliveryCompany?: string | null;
    deliveryZip?: string | null;
    deliveryCity?: string | null;
    deliveryCountry?: string | null;
  }>;
  surplus: Array<{
    id: string;
    sscc: string;
    scannedAt: string;
    note?: string | null;
    documentId?: string | null;
  }>;
};

type Customer = { id: string; name: string; customerNumber: string };

function todayIso() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function statusLabel(s: string) {
  switch (s) {
    case 'RECEIVED':
      return 'OK';
    case 'DAMAGED':
      return 'Beschädigt';
    case 'MISSING':
      return 'Fehlend';
    case 'CANCELLED':
      return 'Storniert';
    case 'PENDING':
      return 'Offen';
    default:
      return s;
  }
}

export function GoodsReceiptControl(props: {
  onScanHook?: (handler: (sscc: string) => Promise<void>) => void;
  cameraSscc?: string | null;
}) {
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [customerId, setCustomerId] = useState('');
  const [date, setDate] = useState(todayIso());
  const [q, setQ] = useState('');
  /** Kunden-Auftragsnummer für Sammelkontrolle (z. B. RPK1002343) */
  const [customerOrderNo, setCustomerOrderNo] = useState('');
  const [groups, setGroups] = useState<Group[]>([]);
  const [session, setSession] = useState<Session | null>(null);
  const [manual, setManual] = useState('');
  const [damagedNext, setDamagedNext] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [info, setInfo] = useState('');
  const [lastKind, setLastKind] = useState<'expected' | 'surplus' | null>(null);
  const photoInputRef = useRef<HTMLInputElement | null>(null);
  const photoTargetRef = useRef<{ colloId?: string; surplusId?: string; shipmentId?: string } | null>(
    null,
  );

  async function loadGroups() {
    setError('');
    const params = new URLSearchParams();
    if (customerId) params.set('customerId', customerId);
    if (date) params.set('date', date);
    if (q.trim()) params.set('q', q.trim());
    const rows = await api<Group[]>(`/goods-receipt/groups?${params.toString()}`);
    setGroups(rows || []);
  }

  useEffect(() => {
    api<Customer[]>('/customers')
      .then((list) => setCustomers(list || []))
      .catch(() => setCustomers([]));
  }, []);

  useEffect(() => {
    loadGroups().catch((e) => setError(e instanceof Error ? e.message : 'Gruppen laden fehlgeschlagen'));
  }, [customerId, date]);

  async function startSession(g: Group) {
    setLoading(true);
    setError('');
    try {
      const label = customerOrderNo.trim() || undefined;
      const all = !!g.allCustomerShipments || (g.shipmentCount != null && g.shipmentCount > 1);
      const s = await api<Session>('/goods-receipt/sessions', {
        method: 'POST',
        body: JSON.stringify({
          customerId: g.customerId || undefined,
          date: g.date,
          externalRef: all ? label || 'ALLE' : g.externalRef,
          allCustomerShipments: all,
          sessionLabel: label,
        }),
      });
      setSession(s);
      setInfo(
        `Kontrolle gestartet: ${s.externalRef}` +
          (all && g.shipmentCount ? ` · ${g.shipmentCount} Sendungen · ${g.expected} Colli` : ''),
      );
    } catch (e: any) {
      setError(e.message || 'Sitzung konnte nicht geöffnet werden');
    } finally {
      setLoading(false);
    }
  }

  async function scanSscc(raw: string) {
    if (!session) {
      setError('Bitte zuerst eine Lieferung (Kunde/Datum/Auftragsnr.) wählen.');
      return;
    }
    if (session.status !== 'OPEN') {
      setError('Sitzung ist abgeschlossen.');
      return;
    }
    // Rohscan inkl. führender GS1-AI „00“ – API normalisiert/matcht Varianten
    const sscc = String(raw || '')
      .trim()
      .replace(/^\]C1/i, '')
      .replace(/^\(00\)/, '');
    if (!sscc) return;
    setLoading(true);
    setError('');
    try {
      const res = await api<any>(`/goods-receipt/sessions/${session.id}/scan`, {
        method: 'POST',
        body: JSON.stringify({ sscc, damaged: damagedNext }),
      });
      setSession(res.session);
      setLastKind(res.kind);
      setDamagedNext(false);
      const shown = res.sscc || sscc;
      const dest = [res.shipment?.deliveryZip, res.shipment?.deliveryCompany]
        .filter(Boolean)
        .join(' · ');
      if (res.kind === 'expected') {
        setInfo(
          res.alreadyScanned
            ? `Bereits gescannt: ${shown}${res.status === 'DAMAGED' ? ' (beschädigt)' : ''}${dest ? ` – ${dest}` : ''}`
            : `Soll ✓ ${shown}${res.status === 'DAMAGED' ? ' – beschädigt' : ''}${dest ? ` – ${dest}` : ''}`,
        );
      } else if (res.photoRequired) {
        setInfo(
          `Überzählig: ${shown} – nicht im System. Bitte Label-Foto aufnehmen (sonst kein Abschluss).`,
        );
      } else {
        setInfo(
          `Überzählig: ${shown}${
            res.knownShipment
              ? ` (im System: ${res.knownShipment.reference || res.knownShipment.trackingNumber})`
              : ''
          }`,
        );
      }
      setManual('');
    } catch (e: any) {
      setError(e.message || 'Scan fehlgeschlagen');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    props.onScanHook?.(scanSscc);
  });

  useEffect(() => {
    if (props.cameraSscc) void scanSscc(props.cameraSscc);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.cameraSscc]);

  async function markDamaged(colloId: string) {
    if (!session) return;
    setLoading(true);
    try {
      const s = await api<Session>(`/goods-receipt/sessions/${session.id}/colli/${colloId}/damage`, {
        method: 'POST',
        body: JSON.stringify({ note: 'Beschädigt' }),
      });
      setSession(s);
      setInfo('Als beschädigt markiert');
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }

  async function cancelCollo(colloId: string, sscc: string) {
    if (!session) return;
    if (!confirm(`Packstück ${sscc} stornieren? Wird nicht angedruckt.`)) return;
    setLoading(true);
    setError('');
    try {
      const s = await api<Session>(`/goods-receipt/sessions/${session.id}/colli/${colloId}/cancel`, {
        method: 'POST',
        body: JSON.stringify({ note: 'Storno WE – nicht entladen / nicht andrucken' }),
      });
      setSession(s);
      setInfo(`Storniert: ${sscc} · nicht andrucken`);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }

  async function cancelShipment(shipmentId: string, label: string, openCount: number) {
    if (!session) return;
    if (
      !confirm(
        `Ganzen Auftrag ${label} stornieren (${openCount} offene Positionen)? Wird nicht angedruckt.`,
      )
    )
      return;
    setLoading(true);
    setError('');
    try {
      const s = await api<Session>(
        `/goods-receipt/sessions/${session.id}/shipments/${shipmentId}/cancel`,
        {
          method: 'POST',
          body: JSON.stringify({
            note: `Storno WE Auftrag ${label} – nicht entladen / nicht andrucken`,
          }),
        },
      );
      setSession(s);
      setInfo(`Auftrag storniert: ${label} · ${openCount} Positionen · nicht andrucken`);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }

  function requestPhoto(target: { colloId?: string; surplusId?: string; shipmentId?: string }) {
    photoTargetRef.current = target;
    photoInputRef.current?.click();
  }

  async function onPhotoSelected(file: File | null) {
    if (!file || !session || !photoTargetRef.current) return;
    const target = photoTargetRef.current;
    setLoading(true);
    setError('');
    try {
      const fd = new FormData();
      fd.append('file', file);
      const q = new URLSearchParams();
      if (target.shipmentId) q.set('shipmentId', target.shipmentId);
      q.set('type', 'WAREHOUSE_PHOTO');
      const res = await fetch(
        `${process.env.NEXT_PUBLIC_API_URL || '/api'}/documents/upload?${q.toString()}`,
        {
          method: 'POST',
          headers: { Authorization: `Bearer ${getToken()}` },
          body: fd,
        },
      );
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.message || 'Foto-Upload fehlgeschlagen');
      }
      const doc = await res.json();
      const s = await api<Session>(`/goods-receipt/sessions/${session.id}/photo`, {
        method: 'POST',
        body: JSON.stringify({
          documentId: doc.id,
          colloId: target.colloId,
          surplusId: target.surplusId,
          note: target.surplusId ? 'Label-Foto Überzählig' : 'Foto Wareneingang',
        }),
      });
      setSession(s);
      setInfo(target.surplusId ? 'Label-Foto gespeichert' : 'Foto gespeichert');
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
      photoTargetRef.current = null;
      if (photoInputRef.current) photoInputRef.current.value = '';
    }
  }

  async function closeSession() {
    if (!session) return;
    if (
      !confirm(
        'Kontrolle abschließen? Offene Packstücke werden als fehlend markiert. Unbekannte Überzählige brauchen ein Label-Foto. ETB wird per E-Mail versendet.',
      )
    )
      return;
    setLoading(true);
    try {
      const s = await api<Session>(`/goods-receipt/sessions/${session.id}/close`, {
        method: 'POST',
        body: JSON.stringify({}),
      });
      setSession(s);
      setInfo(
        s.documentId
          ? 'Kontrolle abgeschlossen · Entladebericht (ETB) erzeugt und an info@worldofgreen.ch / mb@logistikberater.at gesendet'
          : 'Kontrolle abgeschlossen',
      );
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }

  async function downloadEtb() {
    if (!session?.documentId) return;
    const res = await fetch(
      `${process.env.NEXT_PUBLIC_API_URL || '/api'}/documents/${session.documentId}/download`,
      { headers: { Authorization: `Bearer ${getToken()}` } },
    );
    if (!res.ok) throw new Error('ETB-Download fehlgeschlagen');
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `ETB-${session.externalRef}.pdf`;
    a.click();
    URL.revokeObjectURL(url);
  }

  const pending = session?.expectedColli.filter((c) => c.status === 'PENDING') || [];
  const missing = session?.expectedColli.filter((c) => c.status === 'MISSING') || [];
  const damaged = session?.expectedColli.filter((c) => c.status === 'DAMAGED') || [];
  const received = session?.expectedColli.filter((c) => c.status === 'RECEIVED') || [];

  return (
    <div className="stack" style={{ gap: '0.75rem' }}>
      <input
        ref={photoInputRef}
        type="file"
        accept="image/*"
        capture="environment"
        style={{ display: 'none' }}
        onChange={(e) => void onPhotoSelected(e.target.files?.[0] || null)}
      />

      {!session ? (
        <>
          <div className="panel stack" style={{ gap: '0.55rem' }}>
            <strong>Lieferung wählen</strong>
            <p className="muted" style={{ margin: 0, fontSize: '0.88rem' }}>
              Sendungen eines Kunden am gleichen Tag werden gebündelt (z.&nbsp;B. alle WE von
              Schmidt&apos;s). Optional Kunden-Auftragsnummer eintragen (z.&nbsp;B. RPK…).
            </p>
            <div className="field">
              <label>Kunde</label>
              <select value={customerId} onChange={(e) => setCustomerId(e.target.value)}>
                <option value="">– alle Kunden –</option>
                {customers.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name} ({c.customerNumber})
                  </option>
                ))}
              </select>
            </div>
            <div className="field">
              <label>Datum</label>
              <input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
            </div>
            <div className="field">
              <label>Kunden-Auftragsnummer (optional)</label>
              <input
                value={customerOrderNo}
                onChange={(e) => setCustomerOrderNo(e.target.value)}
                placeholder="z. B. RPK1002343"
              />
            </div>
            <div className="field">
              <label>Suche (Kunde / Soloplan-WE)</label>
              <input
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="z. B. Schmidt"
                onKeyDown={(e) => {
                  if (e.key === 'Enter') void loadGroups().catch((err) => setError(err.message));
                }}
              />
            </div>
            <button
              type="button"
              className="btn btn-secondary"
              style={{ minHeight: 44 }}
              onClick={() => void loadGroups().catch((e) => setError(e.message))}
            >
              Aktualisieren
            </button>
          </div>

          {error ? <p className="error">{error}</p> : null}

          <div className="panel stack" style={{ gap: '0.45rem' }}>
            <strong>Offene Lieferungen ({groups.length})</strong>
            {!groups.length ? (
              <p className="muted" style={{ margin: 0 }}>
                Keine Wareneingangs-Sendungen für diesen Filter.
              </p>
            ) : (
              groups.map((g) => (
                <button
                  key={`${g.customerId}-${g.date}-${g.externalRef}`}
                  type="button"
                  className="btn btn-ghost"
                  style={{
                    textAlign: 'left',
                    justifyContent: 'flex-start',
                    minHeight: 56,
                    border: '1px solid var(--border, #d8e0db)',
                  }}
                  disabled={loading}
                  onClick={() => void startSession(g)}
                >
                  <div>
                    <div>
                      <strong>
                        {g.allCustomerShipments || (g.shipmentCount || 0) > 1
                          ? `${g.customerName || 'Kunde'} · Sammelkontrolle`
                          : `Auftrag ${g.externalRef}`}
                      </strong>
                      <span className="muted" style={{ marginLeft: 8 }}>
                        {g.date}
                      </span>
                    </div>
                    <div className="muted" style={{ fontSize: '0.85rem' }}>
                      {g.shipmentCount && g.shipmentCount > 1
                        ? `${g.shipmentCount} Sendungen · `
                        : ''}
                      {g.received}/{g.expected} Colli gescannt
                      {g.damaged ? ` · ${g.damaged} beschädigt` : ''}
                      {customerOrderNo.trim()
                        ? ` · Nr. ${customerOrderNo.trim()}`
                        : ''}
                    </div>
                  </div>
                </button>
              ))
            )}
          </div>
        </>
      ) : (
        <>
          <div className="panel stack" style={{ gap: '0.45rem' }}>
            <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center' }}>
              <strong>
                Auftrag {session.externalRef}
                {session.status === 'CLOSED' ? (
                  <span className="badge" style={{ marginLeft: 8 }}>
                    Abgeschlossen
                  </span>
                ) : null}
              </strong>
              <button
                type="button"
                className="btn btn-ghost"
                onClick={() => {
                  setSession(null);
                  setInfo('');
                  void loadGroups();
                }}
              >
                Andere Lieferung
              </button>
            </div>
            <div className="muted" style={{ fontSize: '0.9rem' }}>
              {session.customer?.name || '—'} · {session.sessionDate}
            </div>
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(3, 1fr)',
                gap: '0.4rem',
                fontSize: '0.85rem',
              }}
            >
              <div>
                <div className="muted">Soll</div>
                <strong>{session.summary.expected}</strong>
              </div>
              <div>
                <div className="muted">Ist</div>
                <strong style={{ color: 'var(--ok, #2f9e62)' }}>{session.summary.received}</strong>
              </div>
              <div>
                <div className="muted">Offen / Fehlend</div>
                <strong>{session.summary.missing}</strong>
              </div>
              <div>
                <div className="muted">Beschädigt</div>
                <strong style={{ color: 'var(--warn, #b78103)' }}>{session.summary.damaged}</strong>
              </div>
              <div>
                <div className="muted">Storniert</div>
                <strong>{session.summary.cancelled ?? 0}</strong>
              </div>
              <div>
                <div className="muted">Überzählig</div>
                <strong style={{ color: lastKind === 'surplus' ? '#c0392b' : undefined }}>
                  {session.summary.surplus}
                </strong>
              </div>
            </div>
          </div>

          {session.status === 'OPEN' ? (
            <div className="panel stack" style={{ gap: '0.55rem' }}>
              <strong>Packstück scannen</strong>
              <label className="row" style={{ fontSize: '0.92rem' }}>
                <input
                  type="checkbox"
                  checked={damagedNext}
                  onChange={(e) => setDamagedNext(e.target.checked)}
                />
                Nächsten Scan als beschädigt buchen
              </label>
              <input
                value={manual}
                onChange={(e) => setManual(e.target.value)}
                placeholder="SSCC tippen oder Kamera nutzen"
                style={{ minHeight: 48, fontSize: '1.05rem' }}
                enterKeyHint="search"
              />
              <button
                type="button"
                className="btn btn-primary"
                style={{ minHeight: 48 }}
                disabled={loading || !manual.trim()}
                onClick={() => void scanSscc(manual)}
              >
                {loading ? '…' : 'Buchen'}
              </button>
            </div>
          ) : null}

          {info ? (
            <p
              className={lastKind === 'surplus' ? 'error' : 'success'}
              style={{ margin: 0, fontSize: '0.92rem' }}
            >
              {info}
            </p>
          ) : null}
          {error ? <p className="error">{error}</p> : null}

          {session.status === 'CLOSED' ? (
            <div className="panel stack" style={{ gap: '0.5rem' }}>
              <strong>Ergebnis (wie ETB)</strong>
              <div>
                OK: <strong>{received.length}</strong>
              </div>
              <div>
                Beschädigt: <strong>{damaged.length}</strong>
              </div>
              <div>
                Fehlend: <strong>{missing.length}</strong>
              </div>
              <div>
                Storniert: <strong>{session.summary.cancelled ?? 0}</strong>
              </div>
              <div>
                Überzählig: <strong>{session.surplus.length}</strong>
              </div>
              {session.documentId ? (
                <button
                  type="button"
                  className="btn btn-primary"
                  style={{ minHeight: 44 }}
                  onClick={() => void downloadEtb().catch((e) => setError(e.message))}
                >
                  Entladebericht (ETB) herunterladen
                </button>
              ) : null}
              <p className="muted" style={{ margin: 0, fontSize: '0.82rem' }}>
                ETB per Mail an info@worldofgreen.ch und mb@logistikberater.at · Speicherung 30 Tage
              </p>
            </div>
          ) : null}

          {session.status === 'OPEN' ? (
            <details className="panel" open>
              <summary style={{ cursor: 'pointer', fontWeight: 600 }}>
                Offene Aufträge stornieren
              </summary>
              <p className="muted" style={{ margin: '0.35rem 0 0', fontSize: '0.82rem' }}>
                Ganzen Auftrag mit einem Klick stornieren (z. B. 20+ Positionen).
              </p>
              <ul style={{ listStyle: 'none', margin: '0.45rem 0 0', padding: 0 }}>
                {(() => {
                  const open = session.expectedColli.filter(
                    (c) => c.status === 'PENDING' || c.status === 'MISSING',
                  );
                  const map = new Map<
                    string,
                    { shipmentId: string; label: string; dest: string; count: number }
                  >();
                  for (const c of open) {
                    const sid = c.shipmentId;
                    const label = c.reference || c.trackingNumber || sid.slice(-8);
                    const dest = [c.deliveryZip, c.deliveryCompany].filter(Boolean).join(' · ');
                    const prev = map.get(sid);
                    if (prev) prev.count += 1;
                    else map.set(sid, { shipmentId: sid, label, dest, count: 1 });
                  }
                  return Array.from(map.values())
                    .sort((a, b) => b.count - a.count)
                    .map((g) => (
                      <li
                        key={g.shipmentId}
                        style={{
                          borderTop: '1px solid var(--border, #d8e0db)',
                          padding: '0.5rem 0',
                        }}
                      >
                        <div
                          className="row"
                          style={{ justifyContent: 'space-between', gap: 8, alignItems: 'center' }}
                        >
                          <div>
                            <strong>Auftrag {g.label}</strong>
                            <div className="muted" style={{ fontSize: '0.82rem' }}>
                              {g.count} offen{g.dest ? ` · ${g.dest}` : ''}
                            </div>
                          </div>
                          <button
                            type="button"
                            className="btn btn-secondary"
                            style={{ minHeight: 42, fontSize: '0.85rem' }}
                            disabled={loading}
                            onClick={() => void cancelShipment(g.shipmentId, g.label, g.count)}
                          >
                            Storno Auftrag
                          </button>
                        </div>
                      </li>
                    ));
                })()}
              </ul>
            </details>
          ) : null}

          <details className="panel" open>
            <summary style={{ cursor: 'pointer', fontWeight: 600 }}>
              Soll-Liste ({session.expectedColli.length})
            </summary>
            <ul style={{ listStyle: 'none', margin: '0.5rem 0 0', padding: 0 }}>
              {session.expectedColli.map((c) => (
                <li
                  key={c.checkId}
                  style={{
                    borderTop: '1px solid var(--border, #d8e0db)',
                    padding: '0.55rem 0',
                    opacity: c.status === 'RECEIVED' ? 0.75 : 1,
                  }}
                >
                  <div className="row" style={{ justifyContent: 'space-between', gap: 8 }}>
                    <div>
                      <code style={{ fontSize: '0.82rem' }}>{c.sscc}</code>
                      <div className="muted" style={{ fontSize: '0.8rem' }}>
                        #{c.itemNumber}
                        {c.content ? ` · ${c.content}` : ''}
                        {c.packaging ? ` · ${c.packaging}` : ''}
                      </div>
                      {(c.deliveryCompany || c.deliveryZip || c.deliveryCity) && (
                        <div style={{ fontSize: '0.85rem', marginTop: 2, lineHeight: 1.35 }}>
                          {c.deliveryCompany ? <div>{c.deliveryCompany}</div> : null}
                          <div className="muted">
                            {[c.deliveryZip, c.deliveryCity].filter(Boolean).join(' ')}
                            {c.deliveryCountry ? ` · ${c.deliveryCountry}` : ''}
                          </div>
                        </div>
                      )}
                    </div>
                    <span
                      className="badge"
                      style={{
                        background:
                          c.status === 'RECEIVED'
                            ? 'color-mix(in srgb, #2f9e62 20%, transparent)'
                            : c.status === 'DAMAGED'
                              ? 'color-mix(in srgb, #b78103 25%, transparent)'
                              : c.status === 'MISSING'
                                ? 'color-mix(in srgb, #c0392b 20%, transparent)'
                                : c.status === 'CANCELLED'
                                  ? 'color-mix(in srgb, #666 18%, transparent)'
                                  : undefined,
                      }}
                    >
                      {statusLabel(c.status)}
                    </span>
                  </div>
                  {session.status === 'OPEN' && c.status !== 'CANCELLED' ? (
                    <div className="row" style={{ marginTop: 6, gap: 6, flexWrap: 'wrap' }}>
                      {c.status !== 'DAMAGED' && c.status !== 'RECEIVED' ? (
                        <button
                          type="button"
                          className="btn btn-secondary"
                          style={{ minHeight: 40, fontSize: '0.85rem' }}
                          onClick={() => void cancelCollo(c.colloId, c.sscc)}
                        >
                          Storno
                        </button>
                      ) : null}
                      {c.status !== 'DAMAGED' ? (
                        <button
                          type="button"
                          className="btn btn-secondary"
                          style={{ minHeight: 40, fontSize: '0.85rem' }}
                          onClick={() => void markDamaged(c.colloId)}
                        >
                          Beschädigt
                        </button>
                      ) : null}
                      <button
                        type="button"
                        className="btn btn-secondary"
                        style={{ minHeight: 40, fontSize: '0.85rem' }}
                        onClick={() =>
                          requestPhoto({
                            colloId: c.colloId,
                            shipmentId: c.shipmentId,
                          })
                        }
                      >
                        Foto
                      </button>
                    </div>
                  ) : null}
                </li>
              ))}
            </ul>
          </details>

          {session.surplus.length > 0 ? (
            <details className="panel" open>
              <summary style={{ cursor: 'pointer', fontWeight: 600, color: '#c0392b' }}>
                Überzählig ({session.surplus.length})
              </summary>
              <ul style={{ listStyle: 'none', margin: '0.5rem 0 0', padding: 0 }}>
                {session.surplus.map((s) => (
                  <li
                    key={s.id}
                    style={{ borderTop: '1px solid var(--border, #d8e0db)', padding: '0.45rem 0' }}
                  >
                    <code>{s.sscc}</code>
                    <span className="muted" style={{ marginLeft: 8, fontSize: '0.8rem' }}>
                      {s.documentId ? 'Label-Foto ok' : 'Label-Foto nötig falls unbekannt'}
                    </span>
                    {!s.documentId ? (
                      <button
                        type="button"
                        className="btn btn-secondary"
                        style={{ marginLeft: 8, minHeight: 36, fontSize: '0.8rem' }}
                        onClick={() => requestPhoto({ surplusId: s.id })}
                      >
                        Label-Foto
                      </button>
                    ) : null}
                  </li>
                ))}
              </ul>
            </details>
          ) : null}

          {session.status === 'OPEN' ? (
            <button
              type="button"
              className="btn btn-primary"
              style={{ minHeight: 48 }}
              disabled={loading}
              onClick={() => void closeSession()}
            >
              Kontrolle abschließen
              {pending.length ? ` (${pending.length} noch offen)` : ''}
            </button>
          ) : null}
        </>
      )}
    </div>
  );
}
