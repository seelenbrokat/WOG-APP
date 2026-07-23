'use client';

import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { AppShell } from '@/components/AppShell';
import { api } from '@/lib/api';

type Group = {
  externalRef: string;
  allCustomerShipments?: boolean;
  customerId: string | null;
  customerName: string | null;
  customerNumber: string | null;
  date: string;
  shipmentCount?: number;
  expected: number;
  received: number;
  damaged: number;
};

type Session = {
  id: string;
  status: string;
  externalRef: string;
  sessionDate: string;
  customer: { id: string; name: string; customerNumber: string } | null;
  summary: {
    expected: number;
    received: number;
    damaged: number;
    pending: number;
    missing: number;
    surplus: number;
  };
  expectedColli: Array<{
    checkId: string;
    status: string;
    sscc: string;
    packaging?: string | null;
    deliveryCompany?: string | null;
    deliveryZip?: string | null;
    deliveryCity?: string | null;
  }>;
};

type Customer = { id: string; name: string; customerNumber: string };

type FlashKind = 'ok' | 'dup' | 'miss' | 'err' | null;

function todayIso() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** Rohscan (Zebra DataWedge) → SSCC-Kandidat. */
function extractSsccCandidate(raw: string): string | null {
  const stripped = String(raw || '').replace(/[\r\n\t]+/g, '');
  let digits = stripped
    .replace(/^\s*\]C1/i, '')
    .replace(/^\s*\(00\)/, '')
    .replace(/\D/g, '');
  if (digits) {
    if (digits.length === 20 && digits.startsWith('00')) digits = digits.slice(2);
    if (digits.length > 18 && digits.startsWith('00')) digits = digits.slice(-18);
    if (digits.length === 18) return digits;
    if (digits.length === 17 && digits.startsWith('9')) return `0${digits}`;
  }
  const cleaned = stripped
    .trim()
    .replace(/^\]C1/i, '')
    .replace(/^\(00\)/, '')
    .replace(/\s+/g, '')
    .toUpperCase();
  if (/^[A-Z0-9-]{6,32}$/i.test(cleaned)) return cleaned;
  return null;
}

/** GS1-SSCC fertig (18 bzw. AI+18 = 20 Ziffern) – ohne Enter vom Scanner. */
function isGs1SsccComplete(raw: string): boolean {
  const digits = String(raw || '')
    .replace(/[\r\n\t]+/g, '')
    .replace(/\D/g, '');
  if (digits.length === 20 && digits.startsWith('00')) return true;
  if (digits.length === 18) return true;
  return false;
}

function vibrate(pattern: number | number[]) {
  try {
    navigator.vibrate?.(pattern);
  } catch {
    /* ignore */
  }
}

export default function WeTc57Page() {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const sessionRef = useRef<Session | null>(null);
  const busyRef = useRef(false);
  const lastScanRef = useRef({ code: '', at: 0 });
  const audioCtxRef = useRef<AudioContext | null>(null);
  /** Zeichenpuffer für DataWedge (zuverlässiger als React-State). */
  const bufferRef = useRef('');
  /** Auto-Bestätigen ohne Enter (DataWedge oft ohne Suffix). */
  const autoTimerRef = useRef<number | null>(null);

  const [customers, setCustomers] = useState<Customer[]>([]);
  const [customerId, setCustomerId] = useState('');
  const [date, setDate] = useState(todayIso());
  const [customerOrderNo, setCustomerOrderNo] = useState('');
  const [groups, setGroups] = useState<Group[]>([]);
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(false);
  const [flash, setFlash] = useState<FlashKind>(null);
  const [headline, setHeadline] = useState('Lieferung wählen');
  const [detail, setDetail] = useState(
    'Danach Barcode mit dem TC57 scannen – bei vollständiger SSCC wird automatisch bestätigt.',
  );

  sessionRef.current = session;

  async function unlockAudio() {
    try {
      const AC =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!AC) return;
      if (!audioCtxRef.current) audioCtxRef.current = new AC();
      if (audioCtxRef.current.state === 'suspended') {
        await audioCtxRef.current.resume();
      }
    } catch {
      /* ignore */
    }
  }

  function playTone(ok: boolean) {
    void (async () => {
      try {
        await unlockAudio();
        const ctx = audioCtxRef.current;
        if (!ctx) return;
        if (ctx.state === 'suspended') await ctx.resume();
        const now = ctx.currentTime;
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.connect(gain);
        gain.connect(ctx.destination);
        gain.gain.setValueAtTime(0.0001, now);
        if (ok) {
          osc.type = 'sine';
          osc.frequency.setValueAtTime(980, now);
          osc.frequency.setValueAtTime(1400, now + 0.07);
          gain.gain.exponentialRampToValueAtTime(0.28, now + 0.015);
          gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.22);
          osc.start(now);
          osc.stop(now + 0.24);
        } else {
          osc.type = 'square';
          osc.frequency.setValueAtTime(240, now);
          osc.frequency.setValueAtTime(160, now + 0.12);
          gain.gain.exponentialRampToValueAtTime(0.22, now + 0.02);
          gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.35);
          osc.start(now);
          osc.stop(now + 0.36);
        }
      } catch {
        /* ignore */
      }
    })();
  }

  function focusScanner() {
    const el = inputRef.current;
    if (!el) return;
    try {
      el.focus({ preventScroll: true });
      // Cursor ans Ende – DataWedge tippt dann weiter
      const len = el.value.length;
      el.setSelectionRange(len, len);
    } catch {
      el.focus();
    }
  }

  async function loadGroups() {
    const params = new URLSearchParams();
    if (customerId) params.set('customerId', customerId);
    if (date) params.set('date', date);
    const rows = await api<Group[]>(`/goods-receipt/groups?${params.toString()}`);
    setGroups(rows || []);
  }

  useEffect(() => {
    api<Customer[]>('/customers')
      .then((list) => setCustomers(list || []))
      .catch(() => setCustomers([]));
  }, []);

  useEffect(() => {
    loadGroups().catch(() => setGroups([]));
  }, [customerId, date]);

  useEffect(() => {
    if (!session || session.status !== 'OPEN') return;
    focusScanner();
    const id = window.setInterval(() => {
      if (document.activeElement !== inputRef.current) focusScanner();
    }, 400);
    const onVis = () => {
      if (document.visibilityState === 'visible') focusScanner();
    };
    document.addEventListener('visibilitychange', onVis);
    return () => {
      window.clearInterval(id);
      document.removeEventListener('visibilitychange', onVis);
    };
  }, [session?.id, session?.status]);

  useEffect(() => {
    return () => {
      void audioCtxRef.current?.close().catch(() => undefined);
      audioCtxRef.current = null;
    };
  }, []);

  async function startSession(g: Group) {
    setLoading(true);
    void unlockAudio();
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
      bufferRef.current = '';
      if (inputRef.current) inputRef.current.value = '';
      setFlash(null);
      setHeadline('Bereit zum Scannen');
      setDetail(
        `${s.customer?.name || 'Kunde'} · ${s.externalRef} · ${s.summary.received}/${s.summary.expected} Colli`,
      );
      window.setTimeout(() => focusScanner(), 80);
      window.setTimeout(() => focusScanner(), 300);
    } catch (e: unknown) {
      setFlash('err');
      setHeadline('Start fehlgeschlagen');
      setDetail(e instanceof Error ? e.message : 'Sitzung konnte nicht geöffnet werden');
    } finally {
      setLoading(false);
    }
  }

  async function processScan(raw: string) {
    const current = sessionRef.current;
    if (!current || current.status !== 'OPEN' || busyRef.current) return;

    const candidate = extractSsccCandidate(raw) || String(raw || '').trim();
    if (!candidate) {
      focusScanner();
      return;
    }

    const now = Date.now();
    // Hardware sendet oft 2× denselben Code – nur sehr kurze Sperre
    if (candidate === lastScanRef.current.code && now - lastScanRef.current.at < 900) {
      focusScanner();
      return;
    }
    lastScanRef.current = { code: candidate, at: now };

    busyRef.current = true;
    setLoading(true);
    bufferRef.current = '';
    if (inputRef.current) inputRef.current.value = '';

    try {
      const res = await api<{
        kind: 'expected' | 'surplus';
        status: string;
        sscc: string;
        alreadyScanned?: boolean;
        shipment?: {
          reference?: string | null;
          deliveryCompany?: string | null;
          deliveryZip?: string | null;
          deliveryCity?: string | null;
        };
        knownShipment?: { reference?: string | null; trackingNumber?: string | null } | null;
        session: Session;
      }>(`/goods-receipt/sessions/${current.id}/scan`, {
        method: 'POST',
        body: JSON.stringify({ sscc: candidate }),
      });

      setSession(res.session);
      const shown = res.sscc || candidate;
      const dest = [res.shipment?.deliveryZip, res.shipment?.deliveryCompany].filter(Boolean).join(' · ');
      const sum = res.session.summary;

      if (res.kind === 'expected' && res.alreadyScanned) {
        setFlash('dup');
        setHeadline('Bereits gescannt');
        setDetail(`${shown}${dest ? ` – ${dest}` : ''} · ${sum.received}/${sum.expected}`);
        vibrate([40, 40, 40]);
        playTone(false);
      } else if (res.kind === 'expected') {
        setFlash('ok');
        setHeadline('OK – gebucht');
        setDetail(`${shown}${dest ? ` – ${dest}` : ''} · ${sum.received}/${sum.expected}`);
        vibrate([25, 30, 50]);
        playTone(true);
      } else {
        setFlash('miss');
        setHeadline('SSCC nicht gefunden');
        setDetail(
          `${shown} ist nicht in dieser Kontrolle` +
            (res.knownShipment
              ? ` (bekannt: ${res.knownShipment.reference || res.knownShipment.trackingNumber})`
              : '') +
            ` · ${sum.received}/${sum.expected}`,
        );
        vibrate([80, 50, 80]);
        playTone(false);
      }
    } catch (e: unknown) {
      setFlash('err');
      setHeadline('SSCC nicht gefunden');
      setDetail(e instanceof Error ? e.message : 'Scan fehlgeschlagen');
      vibrate([90, 40, 90, 40, 90]);
      playTone(false);
    } finally {
      busyRef.current = false;
      setLoading(false);
      // Fokus mehrfach – Android/Chrome verliert ihn sonst nach API-Antwort
      focusScanner();
      window.setTimeout(() => focusScanner(), 50);
      window.setTimeout(() => focusScanner(), 200);
      window.setTimeout(() => focusScanner(), 500);
    }
  }

  function clearAutoTimer() {
    if (autoTimerRef.current != null) {
      window.clearTimeout(autoTimerRef.current);
      autoTimerRef.current = null;
    }
  }

  function readScannerRaw(): string {
    const fromInput = inputRef.current?.value || '';
    return (fromInput || bufferRef.current).replace(/[\r\n\t]+/g, '').trim();
  }

  function clearScannerField() {
    bufferRef.current = '';
    clearAutoTimer();
    if (inputRef.current) inputRef.current.value = '';
  }

  function commitScan(raw: string) {
    const cleaned = String(raw || '')
      .replace(/[\r\n\t]+/g, '')
      .trim();
    clearScannerField();
    if (!cleaned) {
      focusScanner();
      return;
    }
    void processScan(cleaned);
  }

  /** Ohne Enter: sobald SSCC vollständig → nach kurzer Pause buchen. */
  function scheduleAutoConfirm(raw: string) {
    clearAutoTimer();
    const cleaned = String(raw || '')
      .replace(/[\r\n\t]+/g, '')
      .trim();
    if (!cleaned || busyRef.current) return;

    // Terminator im Wert (manche Profile hängen \n an statt Key-Enter)
    if (/[\r\n]/.test(String(raw || ''))) {
      commitScan(cleaned);
      return;
    }

    if (isGs1SsccComplete(cleaned)) {
      // Kurz warten falls noch 1–2 Zeichen nachkommen
      autoTimerRef.current = window.setTimeout(() => {
        autoTimerRef.current = null;
        commitScan(readScannerRaw() || cleaned);
      }, 80);
      return;
    }

    // Andere Codes (z. B. alphanumerisch): nach Scan-Pause bestätigen
    const candidate = extractSsccCandidate(cleaned);
    if (candidate && cleaned.length >= 12) {
      autoTimerRef.current = window.setTimeout(() => {
        autoTimerRef.current = null;
        const latest = readScannerRaw();
        if (latest.length >= cleaned.length) commitScan(latest);
      }, 160);
    }
  }

  function isConfirmKey(e: KeyboardEvent<HTMLInputElement>): boolean {
    if (e.key === 'Enter' || e.key === 'Tab' || e.key === 'Go' || e.key === 'Done') return true;
    // Android / DataWedge oft nur keyCode
    const code = e.keyCode || (e as unknown as { which?: number }).which || 0;
    if (code === 13 || code === 66) return true; // Enter / KEYCODE_ENTER
    if (code === 9) return true; // Tab
    return false;
  }

  /** DataWedge: Zeichen; Enter optional. Auto-Confirm bei voller SSCC. */
  function onScannerKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (isConfirmKey(e)) {
      e.preventDefault();
      e.stopPropagation();
      commitScan(readScannerRaw());
      return;
    }
    if (e.key.length === 1 && !e.ctrlKey && !e.altKey && !e.metaKey) {
      // Wert kommt zusätzlich über onInput – hier nur Timer anstoßen nach Tick
      window.setTimeout(() => scheduleAutoConfirm(readScannerRaw()), 0);
    }
  }

  function onScannerInput() {
    const raw = inputRef.current?.value || '';
    bufferRef.current = raw;
    scheduleAutoConfirm(raw);
  }

  async function closeSession() {
    if (!session) return;
    if (!confirm('Kontrolle abschließen? Offene Packstücke werden als fehlend markiert.')) return;
    setLoading(true);
    try {
      const s = await api<Session>(`/goods-receipt/sessions/${session.id}/close`, {
        method: 'POST',
        body: JSON.stringify({}),
      });
      setSession(s);
      setFlash(null);
      setHeadline('Kontrolle abgeschlossen');
      setDetail(`OK ${s.summary.received} · Fehlend ${s.summary.missing} · Überzählig ${s.summary.surplus}`);
    } catch (e: unknown) {
      setFlash('err');
      setHeadline('Abschluss fehlgeschlagen');
      setDetail(e instanceof Error ? e.message : 'Fehler');
    } finally {
      setLoading(false);
    }
  }

  const flashBg =
    flash === 'ok'
      ? '#1f7a4a'
      : flash === 'dup'
        ? '#9a6b12'
        : flash === 'miss' || flash === 'err'
          ? '#a12622'
          : '#1a2420';

  return (
    <AppShell title="WE TC57">
      <div
        className="stack"
        style={{
          maxWidth: 480,
          margin: '0 auto',
          width: '100%',
          gap: '0.65rem',
          paddingBottom: '1.25rem',
        }}
        onPointerDown={() => void unlockAudio()}
      >
        <p className="muted" style={{ margin: 0, fontSize: '0.88rem', lineHeight: 1.35 }}>
          Wareneingangskontrolle für Zebra TC57 – Hardware-Scanner, ohne Kamera. Scan + Enter
          bestätigt sofort.
        </p>

        {!session ? (
          <div className="panel stack" style={{ gap: '0.55rem' }}>
            <strong>Lieferung wählen</strong>
            <div className="field">
              <label>Kunde</label>
              <select
                value={customerId}
                onChange={(e) => setCustomerId(e.target.value)}
                style={{ minHeight: 48, fontSize: '1rem' }}
              >
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
              <input
                type="date"
                value={date}
                onChange={(e) => setDate(e.target.value)}
                style={{ minHeight: 48, fontSize: '1rem' }}
              />
            </div>
            <div className="field">
              <label>Kunden-Auftragsnummer (optional)</label>
              <input
                value={customerOrderNo}
                onChange={(e) => setCustomerOrderNo(e.target.value)}
                placeholder="z. B. RPK1002343"
                style={{ minHeight: 48, fontSize: '1rem' }}
              />
            </div>
            <div className="stack" style={{ gap: '0.4rem' }}>
              {!groups.length ? (
                <p className="muted" style={{ margin: 0 }}>
                  Keine WE-Sendungen für diesen Filter.
                </p>
              ) : (
                groups.map((g) => (
                  <button
                    key={`${g.customerId}-${g.date}-${g.externalRef}`}
                    type="button"
                    className="btn btn-primary"
                    style={{
                      minHeight: 64,
                      textAlign: 'left',
                      justifyContent: 'flex-start',
                      fontSize: '1rem',
                    }}
                    disabled={loading}
                    onClick={() => void startSession(g)}
                  >
                    <div>
                      <div>
                        {g.allCustomerShipments || (g.shipmentCount || 0) > 1
                          ? `${g.customerName || 'Kunde'} · Sammel`
                          : `Auftrag ${g.externalRef}`}
                      </div>
                      <div style={{ fontSize: '0.85rem', opacity: 0.9 }}>
                        {g.shipmentCount && g.shipmentCount > 1 ? `${g.shipmentCount} Sendungen · ` : ''}
                        {g.received}/{g.expected} Colli
                        {customerOrderNo.trim() ? ` · ${customerOrderNo.trim()}` : ''}
                      </div>
                    </div>
                  </button>
                ))
              )}
            </div>
          </div>
        ) : (
          <>
            <div
              style={{
                background: flashBg,
                color: '#fff',
                borderRadius: 12,
                padding: '0.85rem 1rem',
                minHeight: 96,
                display: 'flex',
                flexDirection: 'column',
                justifyContent: 'center',
                gap: 4,
              }}
              onClick={() => focusScanner()}
            >
              <div style={{ fontSize: '1.35rem', fontWeight: 700, lineHeight: 1.2 }}>{headline}</div>
              <div style={{ fontSize: '0.95rem', opacity: 0.95, wordBreak: 'break-word' }}>{detail}</div>
              {loading ? (
                <div style={{ fontSize: '0.85rem', opacity: 0.85, marginTop: 4 }}>Verarbeite…</div>
              ) : null}
            </div>

            <div
              className="panel"
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(4, 1fr)',
                gap: '0.35rem',
                textAlign: 'center',
                padding: '0.65rem 0.5rem',
              }}
            >
              <div>
                <div style={{ fontSize: '1.25rem', fontWeight: 700 }}>{session.summary.expected}</div>
                <div className="muted" style={{ fontSize: '0.75rem' }}>
                  Soll
                </div>
              </div>
              <div>
                <div style={{ fontSize: '1.25rem', fontWeight: 700, color: '#1f7a4a' }}>
                  {session.summary.received}
                </div>
                <div className="muted" style={{ fontSize: '0.75rem' }}>
                  OK
                </div>
              </div>
              <div>
                <div style={{ fontSize: '1.25rem', fontWeight: 700 }}>
                  {session.summary.pending ?? session.summary.missing}
                </div>
                <div className="muted" style={{ fontSize: '0.75rem' }}>
                  Offen
                </div>
              </div>
              <div>
                <div style={{ fontSize: '1.25rem', fontWeight: 700, color: '#a12622' }}>
                  {session.summary.surplus}
                </div>
                <div className="muted" style={{ fontSize: '0.75rem' }}>
                  Fremd
                </div>
              </div>
            </div>

            <div className="panel stack" style={{ gap: '0.45rem' }}>
              <label style={{ fontWeight: 600 }}>Barcode scannen</label>
              {/* Uncontrolled: DataWedge tippt schneller als React-State */}
              <input
                ref={inputRef}
                defaultValue=""
                onKeyDown={onScannerKeyDown}
                onInput={onScannerInput}
                onBlur={() => {
                  if (sessionRef.current?.status === 'OPEN') {
                    window.setTimeout(() => focusScanner(), 30);
                  }
                }}
                inputMode="numeric"
                autoComplete="off"
                autoCorrect="off"
                autoCapitalize="off"
                spellCheck={false}
                enterKeyHint="done"
                placeholder="Scanner bereit – hier tippt der TC57…"
                // Nie disabled: sonst verliert DataWedge den Fokus nach dem 1. Scan
                readOnly={false}
                style={{
                  minHeight: 56,
                  fontSize: '1.15rem',
                  letterSpacing: '0.02em',
                  fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
                  background: loading ? '#f3f6f4' : undefined,
                }}
              />
              <p className="muted" style={{ margin: 0, fontSize: '0.8rem' }}>
                Zebra: SSCC + Enter → sofort buchen. Feld wird nie deaktiviert.
              </p>
              <button
                type="button"
                className="btn btn-ghost"
                style={{ minHeight: 40, fontSize: '0.9rem' }}
                onClick={() => {
                  void unlockAudio();
                  focusScanner();
                }}
              >
                Fokus + Ton freischalten
              </button>
            </div>

            <div className="row" style={{ gap: '0.45rem' }}>
              <button
                type="button"
                className="btn btn-ghost"
                style={{ flex: 1, minHeight: 48 }}
                onClick={() => {
                  setSession(null);
                  setFlash(null);
                  bufferRef.current = '';
                  setHeadline('Lieferung wählen');
                  setDetail('Danach Barcode mit dem TC57 scannen – Enter bestätigt automatisch.');
                  void loadGroups();
                }}
              >
                Andere Lieferung
              </button>
              {session.status === 'OPEN' ? (
                <button
                  type="button"
                  className="btn btn-secondary"
                  style={{ flex: 1, minHeight: 48 }}
                  disabled={loading}
                  onClick={() => void closeSession()}
                >
                  Abschließen
                </button>
              ) : null}
            </div>

            <details className="panel">
              <summary style={{ cursor: 'pointer', fontWeight: 600, minHeight: 40 }}>
                Offene Colli (
                {session.expectedColli.filter((c) => c.status === 'PENDING').length})
              </summary>
              <ul style={{ listStyle: 'none', margin: '0.4rem 0 0', padding: 0 }}>
                {session.expectedColli
                  .filter((c) => c.status === 'PENDING')
                  .slice(0, 40)
                  .map((c) => (
                    <li
                      key={c.checkId}
                      style={{
                        borderTop: '1px solid var(--border, #d8e0db)',
                        padding: '0.4rem 0',
                        fontSize: '0.85rem',
                      }}
                    >
                      <code>{c.sscc}</code>
                      <div className="muted">
                        {[c.packaging, c.deliveryZip, c.deliveryCompany].filter(Boolean).join(' · ')}
                      </div>
                    </li>
                  ))}
              </ul>
            </details>
          </>
        )}
      </div>
    </AppShell>
  );
}
