'use client';

import Link from 'next/link';
import { FormEvent, useEffect, useRef, useState } from 'react';
import { BrowserMultiFormatReader, type IScannerControls } from '@zxing/browser';
import { DecodeHintType, BarcodeFormat } from '@zxing/library';
import { AppShell } from '@/components/AppShell';
import { api, getToken } from '@/lib/api';
import { GoodsReceiptControl } from './GoodsReceiptControl';

type PartyAddress = {
  company?: string | null;
  street?: string | null;
  zip?: string | null;
  city?: string | null;
  country?: string | null;
};

type ScanResult = {
  sscc: string;
  scannedAt: string;
  collo: {
    id: string;
    itemNumber: number;
    sscc: string;
    content?: string | null;
    packaging?: string | null;
    quantity: number;
    weightKg?: number | null;
  };
  shipment: {
    id: string;
    trackingNumber: string;
    reference?: string | null;
    status: string;
    goodsDescription?: string | null;
    packageCount: number;
    weightKg?: number | null;
    pickupCompany?: string | null;
    pickupStreet?: string | null;
    pickupCity?: string | null;
    pickupZip?: string | null;
    pickupCountry?: string | null;
    deliveryCompany?: string | null;
    deliveryStreet?: string | null;
    deliveryCity?: string | null;
    deliveryZip?: string | null;
    deliveryCountry?: string | null;
    mandant?: { code: string; name: string } | null;
    customer?: { name: string; customerNumber: string } | null;
    order?: { externalNumber: string } | null;
    colloCount: number;
    isWareneingang?: boolean;
  };
};

type HistoryItem = { sscc: string; trackingNumber: string; at: string; ok: boolean };

type TestLabelShipment = {
  id: string;
  reference: string | null;
  trackingNumber: string;
  status: string;
  goodsDescription?: string | null;
  pickupCompany?: string | null;
  pickupStreet?: string | null;
  pickupZip?: string | null;
  pickupCity?: string | null;
  pickupCountry?: string | null;
  deliveryCompany?: string | null;
  deliveryStreet?: string | null;
  deliveryZip?: string | null;
  deliveryCity?: string | null;
  deliveryCountry?: string | null;
  customer?: { name: string; customerNumber: string } | null;
  kind?: 'wareneingang' | 'test' | 'other';
  colli: Array<{ id: string; itemNumber: number; sscc: string | null }>;
  documents: Array<{ id: string; fileName: string; createdAt: string }>;
  printDocument: { id: string; fileName: string; createdAt: string } | null;
};

function formatParty(p: PartyAddress): string {
  const line1 = p.company?.trim() || '';
  const line2 = [p.street?.trim()].filter(Boolean).join('');
  const line3 = [p.zip?.trim(), p.city?.trim()].filter(Boolean).join(' ');
  const line4 = p.country?.trim() || '';
  return [line1, line2, line3, line4].filter(Boolean).join('\n') || '—';
}

function ScanField({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="muted" style={{ fontSize: '0.75rem' }}>
        {label}
      </div>
      <div style={{ fontWeight: 600, whiteSpace: 'pre-line', wordBreak: 'break-word' }}>{value}</div>
    </div>
  );
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

const STATUS_LABEL: Record<string, string> = {
  DRAFT: 'Entwurf',
  SUBMITTED: 'Übermittelt',
  CONFIRMED: 'Bestätigt',
  IN_TRANSIT: 'Unterwegs',
  DELIVERED: 'Zugestellt',
  CANCELLED: 'Storniert',
};

/** Rohscan → GS1-18 oder Soloplan-Code (Wareneingang / Intouch). */
function extractSsccCandidate(raw: string): string | null {
  // Etikett: AI (00) oft als führende 00 / "(00)" im Human Readable
  let digits = String(raw || '')
    .replace(/^\s*\]C1/i, '')
    .replace(/^\s*\(00\)/, '')
    .replace(/\D/g, '');
  if (digits) {
    if (digits.length === 20 && digits.startsWith('00')) digits = digits.slice(2);
    if (digits.length > 18 && digits.startsWith('00')) digits = digits.slice(-18);
    if (digits.length === 18) return digits;
    // Soloplan-WE manchmal ohne Extension-0 (17 statt 18)
    if (digits.length === 17 && digits.startsWith('9')) return `0${digits}`;
  }
  const cleaned = String(raw || '')
    .trim()
    .replace(/^\]C1/i, '')
    .replace(/^\(00\)/, '')
    .replace(/\s+/g, '')
    .toUpperCase();
  if (/^[A-Z0-9-]{6,32}$/i.test(cleaned)) return cleaned;
  return null;
}

function vibrate(pattern: number | number[]) {
  try {
    if (typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function') {
      navigator.vibrate(pattern);
    }
  } catch {
    /* ignore */
  }
}

type AudioCtx = AudioContext;

function playTone(ctx: AudioCtx, ok: boolean) {
  const now = ctx.currentTime;
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.connect(gain);
  gain.connect(ctx.destination);
  osc.type = 'sine';
  gain.gain.setValueAtTime(0.0001, now);

  if (ok) {
    osc.frequency.setValueAtTime(880, now);
    osc.frequency.setValueAtTime(1320, now + 0.07);
    gain.gain.exponentialRampToValueAtTime(0.22, now + 0.015);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.2);
    osc.start(now);
    osc.stop(now + 0.22);
  } else {
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(240, now);
    osc.frequency.setValueAtTime(160, now + 0.12);
    gain.gain.exponentialRampToValueAtTime(0.18, now + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.32);
    osc.start(now);
    osc.stop(now + 0.34);
  }
}

export default function ScanningPage() {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const controlsRef = useRef<IScannerControls | null>(null);
  const lastScanRef = useRef<string>('');
  const lastScanAtRef = useRef(0);
  const audioCtxRef = useRef<AudioCtx | null>(null);
  const weScanRef = useRef<((sscc: string) => Promise<void>) | null>(null);

  const [mode, setMode] = useState<'lookup' | 'goods-receipt'>('goods-receipt');
  const [cameraOn, setCameraOn] = useState(false);
  const [manual, setManual] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [info, setInfo] = useState('Kamera starten oder SSCC eingeben.');
  const [result, setResult] = useState<ScanResult | null>(null);
  const [flash, setFlash] = useState<'ok' | 'err' | null>(null);
  const [history, setHistory] = useState<HistoryItem[]>([]);
  const [testLabels, setTestLabels] = useState<TestLabelShipment[]>([]);
  const [testLabelsError, setTestLabelsError] = useState('');
  const [weCameraSscc, setWeCameraSscc] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    api<TestLabelShipment[]>('/shipments/scan-test-labels')
      .then((rows) => {
        if (!cancelled) setTestLabels(rows || []);
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setTestLabelsError(err instanceof Error ? err.message : 'Testlabels konnten nicht geladen werden');
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    return () => {
      controlsRef.current?.stop();
      controlsRef.current = null;
      void audioCtxRef.current?.close().catch(() => undefined);
      audioCtxRef.current = null;
    };
  }, []);

  async function ensureAudio(): Promise<AudioCtx | null> {
    try {
      const AC =
        typeof window !== 'undefined'
          ? window.AudioContext ||
            (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
          : undefined;
      if (!AC) return null;
      if (!audioCtxRef.current) audioCtxRef.current = new AC();
      if (audioCtxRef.current.state === 'suspended') await audioCtxRef.current.resume();
      return audioCtxRef.current;
    } catch {
      return null;
    }
  }

  async function feedback(ok: boolean) {
    if (ok) vibrate([25, 35, 55]);
    else vibrate([70, 45, 70, 45, 90]);
    setFlash(ok ? 'ok' : 'err');
    window.setTimeout(() => setFlash(null), 650);
    const ctx = await ensureAudio();
    if (ctx) playTone(ctx, ok);
  }

  async function lookup(raw: string) {
    const candidate =
      extractSsccCandidate(raw) ||
      String(raw)
        .trim()
        .replace(/\s+/g, '')
        .toUpperCase();
    if (!candidate) {
      setError('Kein gültiger Code erkannt.');
      void feedback(false);
      return;
    }
    const now = Date.now();
    if (candidate === lastScanRef.current && now - lastScanAtRef.current < 2500) return;
    lastScanRef.current = candidate;
    lastScanAtRef.current = now;

    if (mode === 'goods-receipt') {
      setError('');
      setWeCameraSscc(candidate);
      window.setTimeout(() => setWeCameraSscc(null), 50);
      void feedback(true);
      return;
    }

    setLoading(true);
    setError('');
    setInfo(`Suche ${candidate}…`);
    try {
      const data = await api<ScanResult>(`/shipments/by-sscc/${encodeURIComponent(candidate)}`);
      setResult(data);
      setInfo(`OK · ${data.shipment.trackingNumber}`);
      setHistory((h) =>
        [
          {
            sscc: data.sscc,
            trackingNumber: data.shipment.trackingNumber,
            at: new Date().toISOString(),
            ok: true,
          },
          ...h,
        ].slice(0, 20),
      );
      void feedback(true);
    } catch (e: unknown) {
      setResult(null);
      const msg = e instanceof Error ? e.message : 'Lookup fehlgeschlagen';
      setError(msg);
      setHistory((h) =>
        [
          {
            sscc: candidate,
            trackingNumber: '—',
            at: new Date().toISOString(),
            ok: false,
          },
          ...h,
        ].slice(0, 20),
      );
      void feedback(false);
    } finally {
      setLoading(false);
    }
  }

  async function startCamera() {
    setError('');
    setInfo('Kamera startet… Zugriff erlauben.');
    await ensureAudio();
    try {
      controlsRef.current?.stop();
      controlsRef.current = null;

      const hints = new Map();
      hints.set(DecodeHintType.POSSIBLE_FORMATS, [
        BarcodeFormat.CODE_128,
        BarcodeFormat.CODE_39,
        BarcodeFormat.EAN_13,
        BarcodeFormat.QR_CODE,
        BarcodeFormat.DATA_MATRIX,
      ]);
      hints.set(DecodeHintType.TRY_HARDER, true);

      const reader = new BrowserMultiFormatReader(hints);
      if (!videoRef.current) throw new Error('Video-Element fehlt');

      const controls = await reader.decodeFromConstraints(
        {
          audio: false,
          video: {
            facingMode: { ideal: 'environment' },
            width: { ideal: 1280 },
            height: { ideal: 720 },
          },
        },
        videoRef.current,
        (res) => {
          if (res) void lookup(res.getText());
        },
      );
      controlsRef.current = controls;
      setCameraOn(true);
      setInfo('Barcode ins Visier nehmen.');
    } catch (e: unknown) {
      setCameraOn(false);
      const err = e as { message?: string; name?: string };
      setError(
        err?.message?.includes('Permission') || err?.name === 'NotAllowedError'
          ? 'Kamerazugriff verweigert – in den Browser-Einstellungen erlauben (HTTPS).'
          : err?.message || 'Kamera konnte nicht gestartet werden.',
      );
      setInfo('Manuelle Eingabe möglich.');
    }
  }

  function stopCamera() {
    controlsRef.current?.stop();
    controlsRef.current = null;
    setCameraOn(false);
    setInfo('Kamera gestoppt.');
  }

  function onManual(e: FormEvent) {
    e.preventDefault();
    void ensureAudio().then(() => lookup(manual.trim()));
  }

  const flashBorder =
    flash === 'ok'
      ? '3px solid #2f9e62'
      : flash === 'err'
        ? '3px solid #c0392b'
        : '1px solid var(--border, #d8e0db)';

  return (
    <AppShell title="Scanning">
      <div
        className="stack"
        style={{
          maxWidth: 520,
          margin: '0 auto',
          width: '100%',
          gap: '0.85rem',
          paddingBottom: '1.5rem',
        }}
      >
        <p className="muted" style={{ margin: 0, fontSize: '0.92rem', lineHeight: 1.35 }}>
          SSCC scannen (Kamera) oder tippen. Vibration + Ton bei Treffer.
          Nur Aufträge von Organisation/Mandant 2 (WOG Logistics AG).
        </p>

        <div className="row" style={{ gap: '0.4rem' }}>
          <button
            type="button"
            className={mode === 'goods-receipt' ? 'btn btn-primary' : 'btn btn-secondary'}
            style={{ flex: 1, minHeight: 44 }}
            onClick={() => setMode('goods-receipt')}
          >
            WE-Kontrolle
          </button>
          <button
            type="button"
            className={mode === 'lookup' ? 'btn btn-primary' : 'btn btn-secondary'}
            style={{ flex: 1, minHeight: 44 }}
            onClick={() => setMode('lookup')}
          >
            Schnellsuche
          </button>
        </div>

        <div
          className="panel"
          style={{
            padding: 0,
            overflow: 'hidden',
            background: '#0b1210',
            position: 'relative',
            width: '100%',
            height: mode === 'goods-receipt' ? 'min(42vh, 320px)' : 'min(58vh, 420px)',
            minHeight: mode === 'goods-receipt' ? 200 : 260,
            borderRadius: 14,
            border: flashBorder,
            transition: 'border-color 120ms ease',
          }}
        >
          <video
            ref={videoRef}
            muted
            playsInline
            style={{
              width: '100%',
              height: '100%',
              objectFit: 'cover',
              display: cameraOn ? 'block' : 'none',
            }}
          />
          {!cameraOn && (
            <div
              style={{
                position: 'absolute',
                inset: 0,
                display: 'grid',
                placeItems: 'center',
                padding: '1rem',
                textAlign: 'center',
                color: '#c5d0cb',
                fontSize: '1rem',
              }}
            >
              Kamera aus
            </div>
          )}
          <div
            aria-hidden
            style={{
              pointerEvents: 'none',
              position: 'absolute',
              left: '8%',
              right: '8%',
              top: '28%',
              bottom: '28%',
              border: '2px solid rgba(90, 184, 122, 0.9)',
              borderRadius: 10,
              boxShadow: '0 0 0 999px rgba(0,0,0,0.32)',
            }}
          />
          {loading ? (
            <div
              style={{
                position: 'absolute',
                left: 12,
                right: 12,
                bottom: 12,
                background: 'rgba(0,0,0,0.55)',
                color: '#fff',
                borderRadius: 8,
                padding: '0.45rem 0.65rem',
                fontSize: '0.9rem',
                textAlign: 'center',
              }}
            >
              Laden…
            </div>
          ) : null}
        </div>

        <div
          style={{
            display: 'grid',
            gridTemplateColumns: cameraOn ? '1fr 1fr' : '1fr',
            gap: '0.55rem',
          }}
        >
          {!cameraOn ? (
            <button
              type="button"
              className="btn btn-primary"
              style={{ minHeight: 48, fontSize: '1rem' }}
              onClick={() => void startCamera()}
            >
              Kamera starten
            </button>
          ) : (
            <>
              <button
                type="button"
                className="btn btn-secondary"
                style={{ minHeight: 48, fontSize: '1rem' }}
                onClick={stopCamera}
              >
                Stoppen
              </button>
              <button
                type="button"
                className="btn btn-ghost"
                style={{ minHeight: 48, fontSize: '1rem' }}
                disabled={loading || !result}
                onClick={() => {
                  setResult(null);
                  setError('');
                  lastScanRef.current = '';
                  setInfo('Bereit für nächsten Scan.');
                }}
              >
                Nächster
              </button>
            </>
          )}
        </div>

        {mode === 'goods-receipt' ? (
          <GoodsReceiptControl
            cameraSscc={weCameraSscc}
            onScanHook={(fn) => {
              weScanRef.current = fn;
            }}
          />
        ) : null}

        {mode === 'lookup' && info ? (
          <p className="muted" style={{ margin: 0, fontSize: '0.9rem' }}>
            {info}
          </p>
        ) : null}
        {mode === 'lookup' && error ? (
          <p className="error" style={{ margin: 0, fontSize: '0.95rem' }}>
            {error}
          </p>
        ) : null}

        {mode === 'lookup' && result ? (
          <div
            className="panel stack"
            style={{
              gap: '0.55rem',
              border: '2px solid #2f9e62',
              background: 'color-mix(in srgb, #2f9e62 8%, transparent)',
            }}
          >
            <strong style={{ fontSize: '1.05rem' }}>
              Treffer
              {result.shipment.isWareneingang ? (
                <span className="badge" style={{ marginLeft: 8 }}>
                  Wareneingang
                </span>
              ) : null}
            </strong>
            <div>
              <div className="muted" style={{ fontSize: '0.75rem' }}>
                SSCC
              </div>
              <code style={{ fontSize: '1.05rem', wordBreak: 'break-all' }}>{result.sscc}</code>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.65rem' }}>
              <div>
                <div className="muted" style={{ fontSize: '0.75rem' }}>
                  Sendung
                </div>
                <Link href={`/shipments/${result.shipment.id}`} style={{ fontWeight: 600 }}>
                  {result.shipment.trackingNumber}
                </Link>
              </div>
              <div>
                <div className="muted" style={{ fontSize: '0.75rem' }}>
                  Status
                </div>
                <span className="badge">
                  {STATUS_LABEL[result.shipment.status] || result.shipment.status}
                </span>
              </div>
              <div>
                <div className="muted" style={{ fontSize: '0.75rem' }}>
                  Collo
                </div>
                <div>
                  #{result.collo.itemNumber}
                  {result.collo.packaging ? ` · ${result.collo.packaging}` : ''}
                </div>
              </div>
              <div>
                <div className="muted" style={{ fontSize: '0.75rem' }}>
                  Gewicht
                </div>
                <div>{result.collo.weightKg != null ? `${result.collo.weightKg} kg` : '—'}</div>
              </div>
            </div>
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: '1fr',
                gap: '0.55rem',
                paddingTop: '0.25rem',
                borderTop: '1px solid color-mix(in srgb, #2f9e62 25%, transparent)',
              }}
            >
              <ScanField
                label="Referenznummer"
                value={result.shipment.reference?.trim() || '—'}
              />
              <ScanField
                label="Auftraggeber"
                value={
                  result.shipment.customer
                    ? [
                        result.shipment.customer.name,
                        result.shipment.customer.customerNumber
                          ? `(${result.shipment.customer.customerNumber})`
                          : null,
                      ]
                        .filter(Boolean)
                        .join(' ')
                    : '—'
                }
              />
              <ScanField
                label="Absender"
                value={formatParty({
                  company: result.shipment.pickupCompany,
                  street: result.shipment.pickupStreet,
                  zip: result.shipment.pickupZip,
                  city: result.shipment.pickupCity,
                  country: result.shipment.pickupCountry,
                })}
              />
              <ScanField
                label="Empfänger"
                value={formatParty({
                  company: result.shipment.deliveryCompany,
                  street: result.shipment.deliveryStreet,
                  zip: result.shipment.deliveryZip,
                  city: result.shipment.deliveryCity,
                  country: result.shipment.deliveryCountry,
                })}
              />
              {result.shipment.goodsDescription ? (
                <ScanField label="Ware" value={result.shipment.goodsDescription} />
              ) : null}
            </div>
            <Link
              className="btn btn-primary"
              href={`/shipments/${result.shipment.id}`}
              style={{ minHeight: 48, textAlign: 'center' }}
            >
              Sendung öffnen
            </Link>
          </div>
        ) : null}

        {mode === 'lookup' ? (
        <>
        <form
          className="panel stack"
          onSubmit={onManual}
          style={{ gap: '0.55rem' }}
        >
          <strong>Manuelle SSCC</strong>
          <input
            inputMode="numeric"
            autoComplete="off"
            enterKeyHint="search"
            placeholder="18 Ziffern oder (00)…"
            value={manual}
            onChange={(e) => setManual(e.target.value)}
            style={{ minHeight: 48, fontSize: '1.05rem' }}
          />
          <button
            type="submit"
            className="btn btn-secondary"
            disabled={loading || !manual.trim()}
            style={{ minHeight: 48 }}
          >
            Suchen
          </button>
        </form>

        {history.length > 0 && (
          <details className="panel" open={false}>
            <summary style={{ cursor: 'pointer', fontWeight: 600, minHeight: 40 }}>
              Letzte Scans ({history.length})
            </summary>
            <ul style={{ listStyle: 'none', margin: '0.65rem 0 0', padding: 0 }}>
              {history.map((h, i) => (
                <li
                  key={`${h.sscc}-${h.at}-${i}`}
                  style={{
                    padding: '0.55rem 0',
                    borderTop: '1px solid var(--border, #d8e0db)',
                    display: 'grid',
                    gap: 2,
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
                    <span style={{ color: h.ok ? undefined : 'var(--danger, #b42318)', fontWeight: 600 }}>
                      {h.trackingNumber}
                    </span>
                    <span className="muted" style={{ fontSize: '0.8rem' }}>
                      {new Date(h.at).toLocaleTimeString('de-CH', {
                        hour: '2-digit',
                        minute: '2-digit',
                        second: '2-digit',
                      })}
                    </span>
                  </div>
                  <code style={{ fontSize: '0.82rem', wordBreak: 'break-all' }}>{h.sscc}</code>
                </li>
              ))}
            </ul>
          </details>
        )}

        {(testLabels.length > 0 || testLabelsError) && (
          <details className="panel" open>
            <summary style={{ cursor: 'pointer', fontWeight: 600, minHeight: 40 }}>
              Scan-Labels ({testLabels.length})
            </summary>
            <p className="muted" style={{ margin: '0.5rem 0 0', fontSize: '0.88rem' }}>
              Testlabels und Wareneingang (Auftrag 2291) – PDF drucken oder SSCC antippen.
            </p>
            {testLabelsError ? <p className="error">{testLabelsError}</p> : null}
            {testLabels.map((s) => (
              <div
                key={s.id}
                style={{
                  borderTop: '1px solid var(--border, #d8e0db)',
                  marginTop: '0.65rem',
                  paddingTop: '0.65rem',
                }}
              >
                <div style={{ marginBottom: '0.45rem' }}>
                  <strong>{s.reference || s.trackingNumber}</strong>{' '}
                  <Link href={`/shipments/${s.id}`}>{s.trackingNumber}</Link>
                  {s.kind === 'wareneingang' ? (
                    <span className="badge" style={{ marginLeft: 6 }}>
                      Wareneingang
                    </span>
                  ) : s.kind === 'test' ? (
                    <span className="badge" style={{ marginLeft: 6 }}>
                      Test
                    </span>
                  ) : null}
                  <div
                    style={{
                      marginTop: '0.4rem',
                      display: 'grid',
                      gap: '0.35rem',
                      fontSize: '0.88rem',
                    }}
                  >
                    <div>
                      <span className="muted">Referenz: </span>
                      <strong>{s.reference || '—'}</strong>
                    </div>
                    <div>
                      <span className="muted">Auftraggeber: </span>
                      {s.customer?.name || '—'}
                      {s.customer?.customerNumber ? ` (${s.customer.customerNumber})` : ''}
                    </div>
                    <div>
                      <span className="muted">Absender: </span>
                      {[s.pickupCompany, s.pickupZip, s.pickupCity].filter(Boolean).join(', ') || '—'}
                    </div>
                    <div>
                      <span className="muted">Empfänger: </span>
                      {[s.deliveryCompany, s.deliveryZip, s.deliveryCity].filter(Boolean).join(', ') ||
                        '—'}
                    </div>
                    {s.goodsDescription ? (
                      <div className="muted" style={{ fontSize: '0.85rem' }}>
                        Ware: {s.goodsDescription}
                      </div>
                    ) : null}
                  </div>
                </div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.4rem', marginBottom: '0.45rem' }}>
                  {s.printDocument ? (
                    <button
                      type="button"
                      className="btn btn-primary"
                      style={{ minHeight: 42 }}
                      onClick={() =>
                        downloadDocument(s.printDocument!.id, s.printDocument!.fileName).catch((e) =>
                          setError(e instanceof Error ? e.message : 'Download fehlgeschlagen'),
                        )
                      }
                    >
                      Etiketten-PDF
                    </button>
                  ) : null}
                </div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.4rem' }}>
                  {s.colli.map((c) =>
                    c.sscc ? (
                      <button
                        key={c.id}
                        type="button"
                        className="btn btn-secondary"
                        style={{
                          fontFamily: 'ui-monospace, monospace',
                          fontSize: '0.8rem',
                          minHeight: 42,
                        }}
                        onClick={() => {
                          setManual(c.sscc!);
                          void ensureAudio().then(() => lookup(c.sscc!));
                        }}
                      >
                        #{c.itemNumber} · {c.sscc}
                      </button>
                    ) : null,
                  )}
                </div>
              </div>
            ))}
          </details>
        )}
        </>
        ) : null}
      </div>
    </AppShell>
  );
}
