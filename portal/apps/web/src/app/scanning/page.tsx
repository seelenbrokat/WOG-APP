'use client';

import Link from 'next/link';
import { FormEvent, useEffect, useRef, useState } from 'react';
import { BrowserMultiFormatReader, type IScannerControls } from '@zxing/browser';
import { DecodeHintType, BarcodeFormat } from '@zxing/library';
import { AppShell } from '@/components/AppShell';
import { api, getToken } from '@/lib/api';

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
    pickupCity?: string | null;
    pickupZip?: string | null;
    deliveryCompany?: string | null;
    deliveryCity?: string | null;
    deliveryZip?: string | null;
    mandant?: { code: string; name: string } | null;
    customer?: { name: string; customerNumber: string } | null;
    order?: { externalNumber: string } | null;
    colloCount: number;
  };
};

type HistoryItem = { sscc: string; trackingNumber: string; at: string; ok: boolean };

type TestLabelShipment = {
  id: string;
  reference: string | null;
  trackingNumber: string;
  status: string;
  colli: Array<{ id: string; itemNumber: number; sscc: string | null }>;
  documents: Array<{ id: string; fileName: string; createdAt: string }>;
  printDocument: { id: string; fileName: string; createdAt: string } | null;
};

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

/** Rohscan → 18-stellige SSCC-Ziffern (ohne strenge Prüfziffer – API validiert). */
function extractSsccCandidate(raw: string): string | null {
  let digits = String(raw || '').replace(/\D/g, '');
  if (!digits) return null;
  if (digits.length === 20 && digits.startsWith('00')) digits = digits.slice(2);
  if (digits.length > 18 && digits.startsWith('00')) digits = digits.slice(-18);
  if (digits.length === 18) return digits;
  return null;
}

export default function ScanningPage() {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const controlsRef = useRef<IScannerControls | null>(null);
  const lastScanRef = useRef<string>('');
  const lastScanAtRef = useRef(0);

  const [cameraOn, setCameraOn] = useState(false);
  const [manual, setManual] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [info, setInfo] = useState('Kamera starten oder SSCC manuell eingeben.');
  const [result, setResult] = useState<ScanResult | null>(null);
  const [history, setHistory] = useState<HistoryItem[]>([]);
  const [testLabels, setTestLabels] = useState<TestLabelShipment[]>([]);
  const [testLabelsError, setTestLabelsError] = useState('');

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
    };
  }, []);

  async function lookup(raw: string) {
    const candidate = extractSsccCandidate(raw) || String(raw).replace(/\D/g, '');
    if (!candidate) {
      setError('Kein gültiger Code erkannt.');
      return;
    }
    // Debounce gleicher Scan
    const now = Date.now();
    if (candidate === lastScanRef.current && now - lastScanAtRef.current < 2500) return;
    lastScanRef.current = candidate;
    lastScanAtRef.current = now;

    setLoading(true);
    setError('');
    setInfo(`Suche SSCC ${candidate}…`);
    try {
      const data = await api<ScanResult>(`/shipments/by-sscc/${encodeURIComponent(candidate)}`);
      setResult(data);
      setInfo(`Gefunden: ${data.shipment.trackingNumber}`);
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
      // Kurze Pause der Kamera nach Treffer (Feedback)
      if (typeof navigator !== 'undefined' && navigator.vibrate) {
        navigator.vibrate(40);
      }
    } catch (e: any) {
      setResult(null);
      setError(e.message || 'Lookup fehlgeschlagen');
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
    } finally {
      setLoading(false);
    }
  }

  async function startCamera() {
    setError('');
    setInfo('Kamera wird gestartet… Bitte Zugriff erlauben.');
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
        (res, err) => {
          if (res) {
            const text = res.getText();
            void lookup(text);
          }
          // NotFoundException ist normal zwischen Frames
          if (err && err.name !== 'NotFoundException') {
            // ignore continuous decode noise
          }
        },
      );
      controlsRef.current = controls;
      setCameraOn(true);
      setInfo('Kamera aktiv – SSCC-Barcode ins Visier nehmen.');
    } catch (e: any) {
      setCameraOn(false);
      setError(
        e?.message?.includes('Permission') || e?.name === 'NotAllowedError'
          ? 'Kamerazugriff verweigert. Bitte in den Browser-Einstellungen erlauben (HTTPS).'
          : e?.message || 'Kamera konnte nicht gestartet werden.',
      );
      setInfo('Manuelle Eingabe weiterhin möglich.');
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
    void lookup(manual.trim());
  }

  return (
    <AppShell title="Scanning">
      <p className="muted" style={{ marginBottom: '1rem' }}>
        WOG-Lager: Collo per <strong>SSCC</strong> scannen (Kamera) oder manuell eingeben. Läuft als
        Webapp auf iPhone/Android im Browser (HTTPS, Kamerazugriff).
      </p>

      {(testLabels.length > 0 || testLabelsError) && (
        <div className="panel stack" style={{ marginBottom: '1rem' }}>
          <strong>Testlabels</strong>
          <p className="muted" style={{ margin: 0 }}>
            PDFs drucken und Barcode mit der Kamera scannen – oder SSCC antippen zum manuellen Test.
          </p>
          {testLabelsError ? <p className="error">{testLabelsError}</p> : null}
          {testLabels.map((s) => (
            <div
              key={s.id}
              style={{
                borderTop: '1px solid var(--border, #d8e0db)',
                paddingTop: '0.75rem',
              }}
            >
              <div className="row" style={{ justifyContent: 'space-between', flexWrap: 'wrap', gap: '0.5rem' }}>
                <div>
                  <div>
                    <strong>{s.reference}</strong>{' '}
                    <Link href={`/shipments/${s.id}`}>{s.trackingNumber}</Link>
                  </div>
                  <div className="muted" style={{ fontSize: '0.85rem' }}>
                    {s.colli.length} Colli
                  </div>
                </div>
                <div className="row" style={{ gap: '0.5rem', flexWrap: 'wrap' }}>
                  {s.printDocument ? (
                    <button
                      type="button"
                      className="btn btn-primary"
                      onClick={() =>
                        downloadDocument(s.printDocument!.id, s.printDocument!.fileName).catch((e) =>
                          setError(e instanceof Error ? e.message : 'Download fehlgeschlagen'),
                        )
                      }
                    >
                      Etiketten-PDF
                    </button>
                  ) : null}
                  {s.documents
                    .filter((d) => d.id !== s.printDocument?.id)
                    .map((d) => (
                      <button
                        key={d.id}
                        type="button"
                        className="btn btn-ghost"
                        onClick={() =>
                          downloadDocument(d.id, d.fileName).catch((e) =>
                            setError(e instanceof Error ? e.message : 'Download fehlgeschlagen'),
                          )
                        }
                      >
                        {d.fileName.replace(/^Label-/, '').replace(/\.pdf$/i, '')}
                      </button>
                    ))}
                </div>
              </div>
              <div className="row" style={{ gap: '0.4rem', flexWrap: 'wrap', marginTop: '0.5rem' }}>
                {s.colli.map((c) =>
                  c.sscc ? (
                    <button
                      key={c.id}
                      type="button"
                      className="btn btn-secondary"
                      style={{ fontFamily: 'ui-monospace, monospace', fontSize: '0.85rem' }}
                      title={`Collo #${c.itemNumber} suchen`}
                      onClick={() => {
                        setManual(c.sscc!);
                        void lookup(c.sscc!);
                      }}
                    >
                      #{c.itemNumber} · {c.sscc}
                    </button>
                  ) : null,
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="grid-2" style={{ gap: '1rem', alignItems: 'start' }}>
        <div className="stack">
          <div
            className="panel"
            style={{
              padding: 0,
              overflow: 'hidden',
              background: '#0b1210',
              aspectRatio: '4 / 3',
              position: 'relative',
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
                className="muted"
                style={{
                  position: 'absolute',
                  inset: 0,
                  display: 'grid',
                  placeItems: 'center',
                  padding: '1rem',
                  textAlign: 'center',
                  color: '#c5d0cb',
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
                inset: '18% 12%',
                border: '2px solid rgba(90, 184, 122, 0.85)',
                borderRadius: 12,
                boxShadow: '0 0 0 999px rgba(0,0,0,0.28)',
              }}
            />
          </div>

          <div className="row" style={{ gap: '0.5rem', flexWrap: 'wrap' }}>
            {!cameraOn ? (
              <button type="button" className="btn btn-primary" onClick={() => void startCamera()}>
                Kamera starten
              </button>
            ) : (
              <button type="button" className="btn btn-secondary" onClick={stopCamera}>
                Kamera stoppen
              </button>
            )}
            <button
              type="button"
              className="btn btn-ghost"
              disabled={loading || !result}
              onClick={() => {
                setResult(null);
                lastScanRef.current = '';
                setInfo('Bereit für nächsten Scan.');
              }}
            >
              Nächster Scan
            </button>
          </div>

          <form className="panel stack" onSubmit={onManual}>
            <strong>Manuelle SSCC</strong>
            <input
              inputMode="numeric"
              autoComplete="off"
              placeholder="18 Ziffern oder (00)…"
              value={manual}
              onChange={(e) => setManual(e.target.value)}
            />
            <button type="submit" className="btn btn-secondary" disabled={loading || !manual.trim()}>
              Suchen
            </button>
          </form>

          {info ? <p className="muted">{info}</p> : null}
          {error ? <p className="error">{error}</p> : null}
          {loading ? <p className="muted">Laden…</p> : null}
        </div>

        <div className="stack">
          {result ? (
            <div className="panel stack">
              <strong>Scan-Ergebnis</strong>
              <div>
                <div className="label">SSCC</div>
                <div className="value" style={{ fontSize: '1.15rem' }}>
                  <code>{result.sscc}</code>
                </div>
              </div>
              <div className="row" style={{ gap: '1rem', flexWrap: 'wrap' }}>
                <div>
                  <div className="muted" style={{ fontSize: '0.8rem' }}>
                    Sendung
                  </div>
                  <div>
                    <Link href={`/shipments/${result.shipment.id}`}>
                      {result.shipment.trackingNumber}
                    </Link>
                  </div>
                </div>
                <div>
                  <div className="muted" style={{ fontSize: '0.8rem' }}>
                    Status
                  </div>
                  <div>
                    <span className="badge">
                      {STATUS_LABEL[result.shipment.status] || result.shipment.status}
                    </span>
                  </div>
                </div>
                <div>
                  <div className="muted" style={{ fontSize: '0.8rem' }}>
                    Collo
                  </div>
                  <div>
                    #{result.collo.itemNumber}
                    {result.collo.packaging ? ` · ${result.collo.packaging}` : ''}
                    {result.collo.weightKg != null ? ` · ${result.collo.weightKg} kg` : ''}
                  </div>
                </div>
              </div>
              {result.shipment.reference ? (
                <div className="muted">Referenz: {result.shipment.reference}</div>
              ) : null}
              {result.shipment.order?.externalNumber ? (
                <div className="muted">Auftrag: {result.shipment.order.externalNumber}</div>
              ) : null}
              {result.shipment.customer ? (
                <div className="muted">
                  Kunde: {result.shipment.customer.name} ({result.shipment.customer.customerNumber})
                </div>
              ) : null}
              <div className="muted">
                Abholung: {[result.shipment.pickupCompany, result.shipment.pickupZip, result.shipment.pickupCity]
                  .filter(Boolean)
                  .join(', ') || '—'}
              </div>
              <div className="muted">
                Zustellung:{' '}
                {[result.shipment.deliveryCompany, result.shipment.deliveryZip, result.shipment.deliveryCity]
                  .filter(Boolean)
                  .join(', ') || '—'}
              </div>
              <div className="muted">
                Colli gesamt: {result.shipment.colloCount}
                {result.shipment.goodsDescription ? ` · ${result.shipment.goodsDescription}` : ''}
              </div>
              <Link className="btn btn-primary" href={`/shipments/${result.shipment.id}`}>
                Sendung öffnen
              </Link>
            </div>
          ) : (
            <div className="panel">
              <strong>Kein Treffer</strong>
              <p className="muted" style={{ marginBottom: 0 }}>
                Nach dem Scan erscheinen hier Sendung, Status und Collo-Daten.
              </p>
            </div>
          )}

          {history.length > 0 && (
            <div className="panel" style={{ overflowX: 'auto' }}>
              <strong>Letzte Scans</strong>
              <table className="table" style={{ marginTop: '0.5rem' }}>
                <thead>
                  <tr>
                    <th>Zeit</th>
                    <th>SSCC</th>
                    <th>Sendung</th>
                  </tr>
                </thead>
                <tbody>
                  {history.map((h, i) => (
                    <tr key={`${h.sscc}-${h.at}-${i}`}>
                      <td>
                        {new Date(h.at).toLocaleTimeString('de-CH', {
                          hour: '2-digit',
                          minute: '2-digit',
                          second: '2-digit',
                        })}
                      </td>
                      <td>
                        <code style={{ fontSize: '0.85em' }}>{h.sscc}</code>
                      </td>
                      <td style={{ color: h.ok ? undefined : 'var(--danger, #b42318)' }}>
                        {h.trackingNumber}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </AppShell>
  );
}
