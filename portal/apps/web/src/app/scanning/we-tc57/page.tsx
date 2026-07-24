'use client';

import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { AppShell } from '@/components/AppShell';
import { api, getToken } from '@/lib/api';

type Group = {
  externalRef: string;
  displayLabel?: string;
  sessionId?: string;
  kind?: 'shipments' | 'session';
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
    note?: string | null;
    freeNote?: string | null;
    documentId?: string | null;
    packaging?: string | null;
    weightKg?: number | null;
    lengthCm?: number | null;
    widthCm?: number | null;
    heightCm?: number | null;
    deliveryCompany?: string | null;
    deliveryZip?: string | null;
    deliveryCity?: string | null;
    shipmentId?: string;
    reference?: string | null;
    trackingNumber?: string | null;
  }>;
  surplus?: Array<{
    id: string;
    sscc: string;
    scannedAt: string;
    note?: string | null;
    documentId?: string | null;
  }>;
};

type LastScan = {
  kind: 'expected' | 'surplus';
  colloId?: string;
  surplusId?: string;
  shipmentId?: string;
  sscc: string;
  status?: string;
  note: string;
  damaged: boolean;
  photoRequired?: boolean;
  hasPhoto?: boolean;
  documentId?: string | null;
  knownLabel?: string;
  lengthCm: string;
  widthCm: string;
  heightCm: string;
  weightKg: string;
};

type WorkTab = 'scan' | 'abweichung';

function freeTextFromCheck(c: {
  freeNote?: string | null;
  note?: string | null;
  status?: string;
}) {
  const raw = (c.freeNote ?? c.note ?? '')
    .replace(/\[DIMS_CHANGED\]/g, '')
    .replace(/Abmessungen angepasst:[^·]*/gi, '')
    .replace(/Gewicht:\s*[\d.,]+\s*kg(?:\s*\([^)]*\))?/gi, '')
    .replace(/(?:Label-)?Foto[^·]*/gi, '')
    .replace(/[·]+/g, '·')
    .replace(/\s{2,}/g, ' ')
    .replace(/^[·\s]+|[·\s]+$/g, '')
    .trim();
  return raw.replace(/(?:\s*·\s*)?Beschädigt\s*$/i, '').trim();
}

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
  const photoInputRef = useRef<HTMLInputElement | null>(null);
  const sessionRef = useRef<Session | null>(null);
  const busyRef = useRef(false);
  const lastScanRef = useRef({ code: '', at: 0 });
  const audioCtxRef = useRef<AudioContext | null>(null);
  /** Zeichenpuffer für DataWedge (zuverlässiger als React-State). */
  const bufferRef = useRef('');
  /** Auto-Bestätigen ohne Enter (DataWedge oft ohne Suffix). */
  const autoTimerRef = useRef<number | null>(null);
  /** Während Abmessungen tippen: Scanner-Fokus nicht stehlen. */
  const editingRef = useRef(false);

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
  const [lastScan, setLastScan] = useState<LastScan | null>(null);
  const [showDims, setShowDims] = useState(false);
  const [workTab, setWorkTab] = useState<WorkTab>('scan');
  const workTabRef = useRef<WorkTab>('scan');

  sessionRef.current = session;
  workTabRef.current = workTab;

  function loadLastScanFromCheck(
    c: Session['expectedColli'][number],
    overrides?: Partial<LastScan>,
  ): LastScan {
    return {
      kind: 'expected',
      colloId: c.colloId,
      shipmentId: c.shipmentId || '',
      sscc: c.sscc,
      status: c.status,
      note: freeTextFromCheck(c),
      damaged: c.status === 'DAMAGED',
      hasPhoto: !!c.documentId,
      documentId: c.documentId,
      lengthCm: c.lengthCm != null ? String(c.lengthCm) : '',
      widthCm: c.widthCm != null ? String(c.widthCm) : '',
      heightCm: c.heightCm != null ? String(c.heightCm) : '',
      weightKg: c.weightKg != null ? String(c.weightKg) : '',
      ...overrides,
    };
  }

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
      if (editingRef.current) return;
      if (document.activeElement !== inputRef.current) focusScanner();
    }, 400);
    const onVis = () => {
      if (document.visibilityState === 'visible' && !editingRef.current) focusScanner();
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
      // Offene Proforma-/Kontroll-Session fortsetzen
      if (g.sessionId) {
        const s = await api<Session>(`/goods-receipt/sessions/${g.sessionId}`);
        setSession(s);
        bufferRef.current = '';
        if (inputRef.current) inputRef.current.value = '';
        setFlash(null);
        setHeadline('Bereit zum Scannen');
        setDetail(
          `${g.displayLabel || s.externalRef} · ${s.summary.received}/${s.summary.expected} Colli`,
        );
        window.setTimeout(() => focusScanner(), 80);
        window.setTimeout(() => focusScanner(), 300);
        return;
      }

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

    // Nächster Scan hat Vorrang: Nachbearbeitung (Abmessungen) schließen
    setShowDims(false);
    editingRef.current = false;

    busyRef.current = true;
    setLoading(true);
    clearScannerField();

    try {
      const res = await api<{
        kind: 'expected' | 'surplus';
        status: string;
        sscc: string;
        alreadyScanned?: boolean;
        surplusId?: string;
        photoRequired?: boolean;
        hasPhoto?: boolean;
        collo?: {
          id: string;
          itemNumber: number;
          content?: string | null;
          packaging?: string | null;
          weightKg?: number | null;
          lengthCm?: number | null;
          widthCm?: number | null;
          heightCm?: number | null;
        };
        shipment?: {
          id?: string;
          reference?: string | null;
          deliveryCompany?: string | null;
          deliveryZip?: string | null;
          deliveryCity?: string | null;
        };
        knownShipment?: {
          reference?: string | null;
          trackingNumber?: string | null;
          deliveryZip?: string | null;
          deliveryCompany?: string | null;
          customer?: { name?: string } | null;
        } | null;
        session: Session;
      }>(`/goods-receipt/sessions/${current.id}/scan`, {
        method: 'POST',
        body: JSON.stringify({ sscc: candidate }),
      });

      setSession(res.session);
      const shown = res.sscc || candidate;
      const dest = [res.shipment?.deliveryZip, res.shipment?.deliveryCompany].filter(Boolean).join(' · ');
      const sum = res.session.summary;

      if (res.kind === 'expected' && res.collo) {
        const fromSession = res.session.expectedColli.find((c) => c.colloId === res.collo!.id);
        if (fromSession) {
          setLastScan(
            loadLastScanFromCheck(fromSession, {
              lengthCm: res.collo.lengthCm != null ? String(res.collo.lengthCm) : '',
              widthCm: res.collo.widthCm != null ? String(res.collo.widthCm) : '',
              heightCm: res.collo.heightCm != null ? String(res.collo.heightCm) : '',
              weightKg: res.collo.weightKg != null ? String(res.collo.weightKg) : '',
              sscc: shown,
            }),
          );
        } else {
          setLastScan({
            kind: 'expected',
            colloId: res.collo.id,
            shipmentId: res.shipment?.id || '',
            sscc: shown,
            status: res.status,
            note: '',
            damaged: res.status === 'DAMAGED',
            lengthCm: res.collo.lengthCm != null ? String(res.collo.lengthCm) : '',
            widthCm: res.collo.widthCm != null ? String(res.collo.widthCm) : '',
            heightCm: res.collo.heightCm != null ? String(res.collo.heightCm) : '',
            weightKg: res.collo.weightKg != null ? String(res.collo.weightKg) : '',
          });
        }
        setShowDims(false);
        // Im Abweichungs-Register nach Scan Formular fokussieren
        editingRef.current = workTabRef.current === 'abweichung';
      } else if (res.kind === 'surplus') {
        const knownLabel = res.knownShipment
          ? [
              res.knownShipment.trackingNumber,
              res.knownShipment.reference,
              res.knownShipment.customer?.name,
              res.knownShipment.deliveryZip,
              res.knownShipment.deliveryCompany,
            ]
              .filter(Boolean)
              .join(' · ')
          : undefined;
        setLastScan({
          kind: 'surplus',
          surplusId: res.surplusId,
          sscc: shown,
          note: '',
          damaged: false,
          photoRequired: !!res.photoRequired,
          hasPhoto: !!res.hasPhoto,
          knownLabel,
          lengthCm: '',
          widthCm: '',
          heightCm: '',
          weightKg: '',
        });
        setShowDims(false);
        editingRef.current = workTabRef.current === 'abweichung';
      }

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
      } else if (res.photoRequired) {
        setFlash('dup');
        setHeadline('Überzählig – weiter scannen');
        setDetail(
          `${shown} nicht im System · Label-Foto später unter „Überzählig“ · Fremd ${sum.surplus}`,
        );
        vibrate([80, 50, 80]);
        playTone(false);
      } else {
        setFlash('dup');
        setHeadline('Überzählig – weiter scannen');
        setDetail(
          `${shown}${
            res.knownShipment
              ? ` · ${res.knownShipment.reference || res.knownShipment.trackingNumber || 'im System'}`
              : ''
          } · Fremd ${sum.surplus}`,
        );
        vibrate([40, 40, 40]);
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
      setFlash('ok');
      setHeadline('Kontrolle abgeschlossen');
      setDetail(
        `OK ${s.summary.received} · Fehlend ${s.summary.missing} · Storno ${s.summary.cancelled ?? 0} · Überzählig ${s.summary.surplus}` +
          (s.documentId
            ? ' · ETB an info@worldofgreen.ch / mb@logistikberater.at gesendet'
            : ''),
      );
    } catch (e: unknown) {
      setFlash('err');
      setHeadline('Abschluss fehlgeschlagen');
      setDetail(e instanceof Error ? e.message : 'Fehler');
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

  async function markLastDamaged(noteOverride?: string) {
    if (!session || !lastScan?.colloId) return;
    setLoading(true);
    try {
      const s = await api<Session>(
        `/goods-receipt/sessions/${session.id}/colli/${lastScan.colloId}/damage`,
        {
          method: 'POST',
          body: JSON.stringify({ note: noteOverride ?? lastScan.note ?? 'Beschädigt' }),
        },
      );
      setSession(s);
      const updated = s.expectedColli.find((c) => c.colloId === lastScan.colloId);
      if (updated) setLastScan(loadLastScanFromCheck(updated));
      else setLastScan({ ...lastScan, damaged: true, status: 'DAMAGED' });
      setFlash('dup');
      setHeadline('Als beschädigt markiert');
      setDetail(lastScan.sscc);
      playTone(false);
      vibrate([50, 40, 50]);
    } catch (e: unknown) {
      setFlash('err');
      setHeadline('Beschädigt fehlgeschlagen');
      setDetail(e instanceof Error ? e.message : 'Fehler');
    } finally {
      setLoading(false);
      if (workTabRef.current !== 'abweichung') {
        editingRef.current = false;
        focusScanner();
      }
    }
  }

  async function saveAbweichung() {
    if (!session || !lastScan?.colloId || lastScan.kind !== 'expected') return;
    const toNum = (v: string) => {
      const n = Number(String(v).replace(',', '.'));
      return Number.isFinite(n) && n > 0 ? n : null;
    };
    setLoading(true);
    try {
      let s = await api<Session>(
        `/goods-receipt/sessions/${session.id}/colli/${lastScan.colloId}/dimensions`,
        {
          method: 'PATCH',
          body: JSON.stringify({
            lengthCm: toNum(lastScan.lengthCm),
            widthCm: toNum(lastScan.widthCm),
            heightCm: toNum(lastScan.heightCm),
            weightKg: toNum(lastScan.weightKg),
          }),
        },
      );
      s = await api<Session>(
        `/goods-receipt/sessions/${session.id}/colli/${lastScan.colloId}/note`,
        {
          method: 'PATCH',
          body: JSON.stringify({ note: lastScan.note || '' }),
        },
      );
      if (lastScan.damaged) {
        s = await api<Session>(
          `/goods-receipt/sessions/${session.id}/colli/${lastScan.colloId}/damage`,
          {
            method: 'POST',
            body: JSON.stringify({ note: lastScan.note || 'Beschädigt' }),
          },
        );
      }
      setSession(s);
      const updated = s.expectedColli.find((c) => c.colloId === lastScan.colloId);
      if (updated) setLastScan(loadLastScanFromCheck(updated));
      setFlash('ok');
      setHeadline('Abweichung gespeichert');
      setDetail(
        `${lastScan.sscc}${lastScan.damaged ? ' · beschädigt' : ''} · ${lastScan.lengthCm || '–'}×${lastScan.widthCm || '–'}×${lastScan.heightCm || '–'} cm`,
      );
      playTone(true);
      vibrate([25, 30, 50]);
    } catch (e: unknown) {
      setFlash('err');
      setHeadline('Abweichung fehlgeschlagen');
      setDetail(e instanceof Error ? e.message : 'Fehler');
    } finally {
      setLoading(false);
      editingRef.current = true;
    }
  }

  async function cancelCollo(colloId: string, sscc: string) {
    if (!session) return;
    if (!confirm(`Packstück ${sscc} stornieren? Wird nicht angedruckt.`)) return;
    setLoading(true);
    try {
      const s = await api<Session>(`/goods-receipt/sessions/${session.id}/colli/${colloId}/cancel`, {
        method: 'POST',
        body: JSON.stringify({ note: 'Storno WE – nicht entladen / nicht andrucken' }),
      });
      setSession(s);
      setFlash('dup');
      setHeadline('Storniert');
      setDetail(`${sscc} · nicht andrucken`);
      playTone(false);
    } catch (e: unknown) {
      setFlash('err');
      setHeadline('Storno fehlgeschlagen');
      setDetail(e instanceof Error ? e.message : 'Fehler');
    } finally {
      setLoading(false);
      focusScanner();
    }
  }

  async function cancelShipment(
    shipmentId: string,
    label: string,
    openCount: number,
  ) {
    if (!session) return;
    if (
      !confirm(
        `Ganzen Auftrag ${label} stornieren (${openCount} offene Positionen)? Wird nicht angedruckt.`,
      )
    )
      return;
    setLoading(true);
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
      setFlash('dup');
      setHeadline('Auftrag storniert');
      setDetail(`${label} · ${openCount} Positionen · nicht andrucken`);
      playTone(false);
    } catch (e: unknown) {
      setFlash('err');
      setHeadline('Auftrags-Storno fehlgeschlagen');
      setDetail(e instanceof Error ? e.message : 'Fehler');
    } finally {
      setLoading(false);
      focusScanner();
    }
  }

  async function saveDimensions() {
    if (!session || !lastScan?.colloId) return;
    const toNum = (v: string) => {
      const n = Number(String(v).replace(',', '.'));
      return Number.isFinite(n) && n > 0 ? n : null;
    };
    setLoading(true);
    try {
      const s = await api<Session>(
        `/goods-receipt/sessions/${session.id}/colli/${lastScan.colloId}/dimensions`,
        {
          method: 'PATCH',
          body: JSON.stringify({
            lengthCm: toNum(lastScan.lengthCm),
            widthCm: toNum(lastScan.widthCm),
            heightCm: toNum(lastScan.heightCm),
            weightKg: toNum(lastScan.weightKg),
          }),
        },
      );
      setSession(s);
      setShowDims(false);
      editingRef.current = false;
      setFlash('ok');
      setHeadline('Abmessungen gespeichert');
      setDetail(
        `${lastScan.sscc} · ${lastScan.lengthCm || '–'}×${lastScan.widthCm || '–'}×${lastScan.heightCm || '–'} cm`,
      );
      playTone(true);
    } catch (e: unknown) {
      setFlash('err');
      setHeadline('Abmessungen fehlgeschlagen');
      setDetail(e instanceof Error ? e.message : 'Fehler');
    } finally {
      setLoading(false);
      focusScanner();
    }
  }

  async function onPhotoSelected(file: File | null) {
    // Kamera/Galerie geschlossen → sofort wieder scannen (auch bei Abbruch)
    editingRef.current = false;
    if (!file || !session || !lastScan) {
      focusScanner();
      return;
    }
    setLoading(true);
    try {
      const fd = new FormData();
      fd.append('file', file);
      const q = new URLSearchParams();
      if (lastScan.shipmentId) q.set('shipmentId', lastScan.shipmentId);
      q.set('type', 'WAREHOUSE_PHOTO');
      const uploadRes = await fetch(
        `${process.env.NEXT_PUBLIC_API_URL || '/api'}/documents/upload?${q.toString()}`,
        {
          method: 'POST',
          headers: { Authorization: `Bearer ${getToken()}` },
          body: fd,
        },
      );
      if (!uploadRes.ok) {
        const err = await uploadRes.json().catch(() => ({}));
        throw new Error(err.message || 'Foto-Upload fehlgeschlagen');
      }
      const doc = await uploadRes.json();
      const s = await api<Session>(`/goods-receipt/sessions/${session.id}/photo`, {
        method: 'POST',
        body: JSON.stringify({
          documentId: doc.id,
          colloId: lastScan.colloId,
          surplusId: lastScan.surplusId,
          note: lastScan.kind === 'surplus' ? 'Label-Foto Überzählig' : 'Foto Wareneingang',
        }),
      });
      setSession(s);
      if (lastScan.kind === 'expected' && lastScan.colloId) {
        const updated = s.expectedColli.find((c) => c.colloId === lastScan.colloId);
        if (updated) setLastScan(loadLastScanFromCheck(updated));
        else setLastScan({ ...lastScan, hasPhoto: true, photoRequired: false, documentId: doc.id });
      } else {
        setLastScan({ ...lastScan, hasPhoto: true, photoRequired: false });
      }
      setFlash('ok');
      setHeadline(lastScan.kind === 'surplus' ? 'Label-Foto gespeichert' : 'Foto gespeichert');
      setDetail(`${lastScan.sscc} · ${workTabRef.current === 'abweichung' ? 'Abweichung' : 'weiter scannen'}`);
      playTone(true);
    } catch (e: unknown) {
      setFlash('err');
      setHeadline('Foto fehlgeschlagen');
      setDetail(e instanceof Error ? e.message : 'Fehler');
    } finally {
      setLoading(false);
      if (photoInputRef.current) photoInputRef.current.value = '';
      if (workTabRef.current === 'abweichung') {
        editingRef.current = true;
      } else {
        editingRef.current = false;
        focusScanner();
        window.setTimeout(() => focusScanner(), 80);
      }
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
          Wareneingangskontrolle für Zebra TC57 – Hardware-Scanner, ohne Kamera. Vollständige SSCC
          wird automatisch bestätigt (kein Enter nötig).
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
                    key={`${g.sessionId || g.customerId}-${g.date}-${g.externalRef}`}
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
                        {g.displayLabel ||
                          (g.allCustomerShipments || (g.shipmentCount || 0) > 1
                            ? `${g.customerName || 'Kunde'} · Sammel`
                            : `Auftrag ${g.externalRef}`)}
                      </div>
                      <div style={{ fontSize: '0.85rem', opacity: 0.9 }}>
                        {g.kind === 'session' ? 'Proforma · ' : ''}
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
            <input
              ref={photoInputRef}
              type="file"
              accept="image/*"
              capture="environment"
              style={{ display: 'none' }}
              onChange={(e) => void onPhotoSelected(e.target.files?.[0] || null)}
            />
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
              onClick={() => {
                if (!editingRef.current) focusScanner();
              }}
            >
              <div style={{ fontSize: '1.35rem', fontWeight: 700, lineHeight: 1.2 }}>{headline}</div>
              <div style={{ fontSize: '0.95rem', opacity: 0.95, wordBreak: 'break-word' }}>{detail}</div>
              {loading ? (
                <div style={{ fontSize: '0.85rem', opacity: 0.85, marginTop: 4 }}>Verarbeite…</div>
              ) : null}
            </div>

            {session.status === 'OPEN' ? (
              <div className="tabs" role="tablist" aria-label="WE TC57">
                <button
                  type="button"
                  className={workTab === 'scan' ? 'active' : undefined}
                  onClick={() => {
                    setWorkTab('scan');
                    editingRef.current = false;
                    focusScanner();
                  }}
                >
                  Scannen
                </button>
                <button
                  type="button"
                  className={workTab === 'abweichung' ? 'active' : undefined}
                  onClick={() => {
                    setWorkTab('abweichung');
                    editingRef.current = true;
                  }}
                >
                  Abweichung
                </button>
              </div>
            ) : null}

            {/* Scanner in beiden Registern – bei Abweichung für SSCC-Auswahl */}
            <div className="panel stack" style={{ gap: '0.45rem' }}>
              <label style={{ fontWeight: 600 }}>
                {workTab === 'abweichung' ? 'SSCC für Abweichung scannen' : 'Barcode scannen'}
              </label>
              <input
                ref={inputRef}
                defaultValue=""
                onKeyDown={onScannerKeyDown}
                onInput={onScannerInput}
                onBlur={() => {
                  if (
                    sessionRef.current?.status === 'OPEN' &&
                    !editingRef.current &&
                    workTabRef.current === 'scan'
                  ) {
                    window.setTimeout(() => {
                      if (!editingRef.current && workTabRef.current === 'scan') focusScanner();
                    }, 30);
                  }
                }}
                inputMode="numeric"
                autoComplete="off"
                autoCorrect="off"
                autoCapitalize="off"
                spellCheck={false}
                enterKeyHint="done"
                placeholder="Scanner bereit – hier tippt der TC57…"
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
                {workTab === 'abweichung'
                  ? 'SSCC scannen oder unten aus der Liste wählen – dann Maße, Foto, Freitext, Beschädigt.'
                  : 'Weiter scannen – Nachbearbeitung ist optional und unterbricht nicht. Ausführliche Abweichung im Register „Abweichung“.'}
              </p>
              {workTab === 'scan' ? (
                <button
                  type="button"
                  className="btn btn-ghost"
                  style={{ minHeight: 40, fontSize: '0.9rem' }}
                  onClick={() => {
                    void unlockAudio();
                    editingRef.current = false;
                    focusScanner();
                  }}
                >
                  Fokus + Ton freischalten
                </button>
              ) : null}
            </div>

            {workTab === 'scan' ? (
              <div
                className="panel"
                style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(5, 1fr)',
                  gap: '0.35rem',
                  textAlign: 'center',
                  padding: '0.65rem 0.5rem',
                }}
              >
                <div>
                  <div style={{ fontSize: '1.15rem', fontWeight: 700 }}>{session.summary.expected}</div>
                  <div className="muted" style={{ fontSize: '0.72rem' }}>
                    Soll
                  </div>
                </div>
                <div>
                  <div style={{ fontSize: '1.15rem', fontWeight: 700, color: '#1f7a4a' }}>
                    {session.summary.received}
                  </div>
                  <div className="muted" style={{ fontSize: '0.72rem' }}>
                    OK
                  </div>
                </div>
                <div>
                  <div style={{ fontSize: '1.15rem', fontWeight: 700 }}>
                    {session.summary.pending ?? session.summary.missing}
                  </div>
                  <div className="muted" style={{ fontSize: '0.72rem' }}>
                    Offen
                  </div>
                </div>
                <div>
                  <div style={{ fontSize: '1.15rem', fontWeight: 700 }}>
                    {session.summary.cancelled ?? 0}
                  </div>
                  <div className="muted" style={{ fontSize: '0.72rem' }}>
                    Storno
                  </div>
                </div>
                <div>
                  <div style={{ fontSize: '1.15rem', fontWeight: 700, color: '#a12622' }}>
                    {session.summary.surplus}
                  </div>
                  <div className="muted" style={{ fontSize: '0.72rem' }}>
                    Fremd
                  </div>
                </div>
              </div>
            ) : null}

            {workTab === 'scan' && lastScan && session.status === 'OPEN' ? (
              <details className="panel" style={{ gap: '0.5rem' }}>
                <summary style={{ cursor: 'pointer', fontWeight: 600, minHeight: 40 }}>
                  Nachbearbeitung optional · {lastScan.sscc}
                </summary>
                <div className="stack" style={{ gap: '0.45rem', marginTop: '0.45rem' }}>
                  {lastScan.kind === 'surplus' ? (
                    <>
                      {lastScan.knownLabel ? (
                        <p style={{ margin: 0, fontSize: '0.85rem' }}>
                          Im System: {lastScan.knownLabel}
                        </p>
                      ) : (
                        <p style={{ margin: 0, fontSize: '0.85rem', color: '#a12622' }}>
                          Label-Foto vor Abschluss nötig (auch unter „Überzählig“).
                        </p>
                      )}
                      <button
                        type="button"
                        className="btn btn-secondary"
                        style={{ minHeight: 48 }}
                        disabled={loading || !!lastScan.hasPhoto}
                        onClick={() => {
                          photoInputRef.current?.click();
                          window.setTimeout(() => {
                            if (!editingRef.current) focusScanner();
                          }, 400);
                        }}
                      >
                        {lastScan.hasPhoto
                          ? 'Label-Foto gespeichert'
                          : lastScan.photoRequired
                            ? 'Label-Foto aufnehmen'
                            : 'Foto (optional)'}
                      </button>
                    </>
                  ) : (
                    <>
                      <div className="row" style={{ gap: '0.4rem', flexWrap: 'wrap' }}>
                        <button
                          type="button"
                          className="btn btn-secondary"
                          style={{ flex: 1, minHeight: 48 }}
                          disabled={loading}
                          onClick={() => void markLastDamaged('Beschädigt')}
                        >
                          Beschädigt
                        </button>
                        <button
                          type="button"
                          className="btn btn-secondary"
                          style={{ flex: 1, minHeight: 48 }}
                          disabled={loading}
                          onClick={() => {
                            photoInputRef.current?.click();
                            window.setTimeout(() => {
                              if (!editingRef.current) focusScanner();
                            }, 400);
                          }}
                        >
                          Foto
                        </button>
                        <button
                          type="button"
                          className="btn btn-secondary"
                          style={{ flex: 1, minHeight: 48 }}
                          disabled={loading}
                          onClick={() => {
                            setShowDims((v) => {
                              const next = !v;
                              editingRef.current = next;
                              if (!next) focusScanner();
                              return next;
                            });
                          }}
                        >
                          Abmessungen
                        </button>
                      </div>
                      {showDims ? (
                        <div className="stack" style={{ gap: '0.4rem' }}>
                          <div
                            style={{
                              display: 'grid',
                              gridTemplateColumns: '1fr 1fr 1fr',
                              gap: '0.35rem',
                            }}
                          >
                            {(
                              [
                                ['lengthCm', 'L cm'],
                                ['widthCm', 'B cm'],
                                ['heightCm', 'H cm'],
                              ] as const
                            ).map(([key, label]) => (
                              <div className="field" key={key}>
                                <label>{label}</label>
                                <input
                                  inputMode="decimal"
                                  value={lastScan[key]}
                                  onFocus={() => {
                                    editingRef.current = true;
                                  }}
                                  onChange={(e) =>
                                    setLastScan({ ...lastScan, [key]: e.target.value })
                                  }
                                  style={{ minHeight: 48, fontSize: '1rem' }}
                                />
                              </div>
                            ))}
                          </div>
                          <div className="field">
                            <label>Gewicht kg</label>
                            <input
                              inputMode="decimal"
                              value={lastScan.weightKg}
                              onFocus={() => {
                                editingRef.current = true;
                              }}
                              onChange={(e) =>
                                setLastScan({ ...lastScan, weightKg: e.target.value })
                              }
                              style={{ minHeight: 48, fontSize: '1rem' }}
                            />
                          </div>
                          <div className="row" style={{ gap: '0.4rem' }}>
                            <button
                              type="button"
                              className="btn btn-primary"
                              style={{ flex: 1, minHeight: 48 }}
                              disabled={loading}
                              onClick={() => void saveDimensions()}
                            >
                              Speichern
                            </button>
                            <button
                              type="button"
                              className="btn btn-ghost"
                              style={{ flex: 1, minHeight: 48 }}
                              onClick={() => {
                                setShowDims(false);
                                editingRef.current = false;
                                focusScanner();
                              }}
                            >
                              Abbrechen
                            </button>
                          </div>
                        </div>
                      ) : null}
                    </>
                  )}
                </div>
              </details>
            ) : null}

            {workTab === 'abweichung' && session.status === 'OPEN' ? (
              <div className="panel stack" style={{ gap: '0.55rem' }}>
                <strong>Abweichung erfassen</strong>
                {lastScan?.kind === 'expected' && lastScan.colloId ? (
                  <>
                    <div>
                      <code style={{ fontSize: '0.95rem' }}>{lastScan.sscc}</code>
                      <div className="muted" style={{ fontSize: '0.85rem' }}>
                        Status: {lastScan.damaged || lastScan.status === 'DAMAGED' ? 'beschädigt' : lastScan.status || '—'}
                        {lastScan.hasPhoto ? ' · Foto vorhanden' : ''}
                      </div>
                    </div>
                    <div
                      style={{
                        display: 'grid',
                        gridTemplateColumns: '1fr 1fr 1fr',
                        gap: '0.35rem',
                      }}
                    >
                      {(
                        [
                          ['lengthCm', 'L cm'],
                          ['widthCm', 'B cm'],
                          ['heightCm', 'H cm'],
                        ] as const
                      ).map(([key, label]) => (
                        <div className="field" key={key}>
                          <label>{label}</label>
                          <input
                            inputMode="decimal"
                            value={lastScan[key]}
                            onFocus={() => {
                              editingRef.current = true;
                            }}
                            onChange={(e) => setLastScan({ ...lastScan, [key]: e.target.value })}
                            style={{ minHeight: 48, fontSize: '1rem' }}
                          />
                        </div>
                      ))}
                    </div>
                    <div className="field">
                      <label>Gewicht kg</label>
                      <input
                        inputMode="decimal"
                        value={lastScan.weightKg}
                        onFocus={() => {
                          editingRef.current = true;
                        }}
                        onChange={(e) => setLastScan({ ...lastScan, weightKg: e.target.value })}
                        style={{ minHeight: 48, fontSize: '1rem' }}
                      />
                    </div>
                    <div className="field">
                      <label>Freitext / Bemerkung</label>
                      <textarea
                        value={lastScan.note}
                        rows={3}
                        onFocus={() => {
                          editingRef.current = true;
                        }}
                        onChange={(e) => setLastScan({ ...lastScan, note: e.target.value })}
                        placeholder="z. B. Ecke eingedrückt, Folie gerissen…"
                        style={{ minHeight: 88, fontSize: '1rem', width: '100%', resize: 'vertical' }}
                      />
                    </div>
                    <label className="row" style={{ gap: '0.5rem', minHeight: 44 }}>
                      <input
                        type="checkbox"
                        checked={!!lastScan.damaged}
                        onChange={(e) => setLastScan({ ...lastScan, damaged: e.target.checked })}
                        style={{ width: 22, height: 22 }}
                      />
                      <span style={{ fontWeight: 600 }}>Als beschädigt markieren</span>
                    </label>
                    <div className="row" style={{ gap: '0.4rem', flexWrap: 'wrap' }}>
                      <button
                        type="button"
                        className="btn btn-secondary"
                        style={{ flex: 1, minHeight: 48 }}
                        disabled={loading}
                        onClick={() => {
                          editingRef.current = true;
                          photoInputRef.current?.click();
                        }}
                      >
                        {lastScan.hasPhoto ? 'Weiteres Foto' : 'Foto aufnehmen'}
                      </button>
                      <button
                        type="button"
                        className="btn btn-primary"
                        style={{ flex: 1, minHeight: 48 }}
                        disabled={loading}
                        onClick={() => void saveAbweichung()}
                      >
                        Abweichung speichern
                      </button>
                    </div>
                  </>
                ) : lastScan?.kind === 'surplus' ? (
                  <div className="stack" style={{ gap: '0.45rem' }}>
                    <p style={{ margin: 0 }}>
                      Überzählig: <code>{lastScan.sscc}</code>
                    </p>
                    <p className="muted" style={{ margin: 0, fontSize: '0.85rem' }}>
                      Für Überzählige nur Label-Foto – Abmessungen/Schaden gelten für Soll-Packstücke.
                    </p>
                    <button
                      type="button"
                      className="btn btn-secondary"
                      style={{ minHeight: 48 }}
                      disabled={loading || !!lastScan.hasPhoto}
                      onClick={() => photoInputRef.current?.click()}
                    >
                      {lastScan.hasPhoto ? 'Label-Foto gespeichert' : 'Label-Foto aufnehmen'}
                    </button>
                  </div>
                ) : (
                  <p className="muted" style={{ margin: 0 }}>
                    Noch keine SSCC gewählt – scannen oder aus der Liste tippen.
                  </p>
                )}

                <div style={{ marginTop: '0.25rem' }}>
                  <strong style={{ fontSize: '0.9rem' }}>Packstücke wählen</strong>
                  <ul style={{ listStyle: 'none', margin: '0.4rem 0 0', padding: 0 }}>
                    {session.expectedColli
                      .filter((c) => c.status !== 'CANCELLED')
                      .slice(0, 40)
                      .map((c) => (
                        <li
                          key={c.checkId}
                          style={{
                            borderTop: '1px solid var(--border, #d8e0db)',
                            padding: '0.4rem 0',
                          }}
                        >
                          <button
                            type="button"
                            className="btn btn-ghost"
                            style={{
                              width: '100%',
                              minHeight: 44,
                              justifyContent: 'flex-start',
                              textAlign: 'left',
                              fontSize: '0.85rem',
                            }}
                            onClick={() => {
                              setLastScan(loadLastScanFromCheck(c));
                              editingRef.current = true;
                              setFlash(null);
                              setHeadline('Abweichung');
                              setDetail(c.sscc);
                            }}
                          >
                            <div>
                              <code>{c.sscc}</code>
                              <div className="muted" style={{ fontSize: '0.78rem' }}>
                                {c.status}
                                {c.documentId ? ' · Foto' : ''}
                                {c.freeNote || c.note ? ' · Notiz' : ''}
                                {c.lengthCm != null
                                  ? ` · ${c.lengthCm}×${c.widthCm ?? '–'}×${c.heightCm ?? '–'}`
                                  : ''}
                              </div>
                            </div>
                          </button>
                        </li>
                      ))}
                  </ul>
                </div>
              </div>
            ) : null}

            <div className="row" style={{ gap: '0.45rem' }}>
              <button
                type="button"
                className="btn btn-ghost"
                style={{ flex: 1, minHeight: 48 }}
                onClick={() => {
                  setSession(null);
                  setFlash(null);
                  setLastScan(null);
                  setShowDims(false);
                  setWorkTab('scan');
                  editingRef.current = false;
                  bufferRef.current = '';
                  setHeadline('Lieferung wählen');
                  setDetail(
                    'Danach Barcode mit dem TC57 scannen – bei vollständiger SSCC wird automatisch bestätigt.',
                  );
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
              ) : session.documentId ? (
                <button
                  type="button"
                  className="btn btn-primary"
                  style={{ flex: 1, minHeight: 48 }}
                  onClick={() =>
                    void downloadEtb().catch((e) => {
                      setFlash('err');
                      setHeadline('Download fehlgeschlagen');
                      setDetail(e instanceof Error ? e.message : 'Fehler');
                    })
                  }
                >
                  ETB laden
                </button>
              ) : null}
            </div>

            {workTab === 'scan' ? (
            <>
            <details className="panel" open={session.status === 'OPEN'}>
              <summary style={{ cursor: 'pointer', fontWeight: 600, minHeight: 40 }}>
                Fehlend / Offen (
                {
                  session.expectedColli.filter(
                    (c) => c.status === 'PENDING' || c.status === 'MISSING',
                  ).length
                }
                )
              </summary>
              <p className="muted" style={{ margin: '0.35rem 0 0', fontSize: '0.8rem' }}>
                Pro Position: Storno · zusätzlich pro Auftrag: Storno Auftrag (alle offenen) → nicht
                andrucken.
              </p>
              <div style={{ marginTop: '0.4rem' }}>
                {(() => {
                  const open = session.expectedColli.filter(
                    (c) => c.status === 'PENDING' || c.status === 'MISSING',
                  );
                  const byShipment = new Map<
                    string,
                    {
                      shipmentId: string;
                      label: string;
                      dest: string;
                      colli: typeof open;
                    }
                  >();
                  for (const c of open) {
                    const sid = c.shipmentId || c.checkId;
                    const label = c.reference || c.trackingNumber || sid.slice(-8);
                    const dest = [c.deliveryZip, c.deliveryCompany].filter(Boolean).join(' · ');
                    let g = byShipment.get(sid);
                    if (!g) {
                      g = { shipmentId: sid, label, dest, colli: [] };
                      byShipment.set(sid, g);
                    }
                    g.colli.push(c);
                  }
                  const groups = Array.from(byShipment.values()).sort(
                    (a, b) => b.colli.length - a.colli.length || a.label.localeCompare(b.label),
                  );
                  return groups.map((g) => (
                    <div
                      key={g.shipmentId}
                      style={{
                        borderTop: '1px solid var(--border, #d8e0db)',
                        padding: '0.55rem 0',
                      }}
                    >
                      <div
                        className="row"
                        style={{
                          justifyContent: 'space-between',
                          gap: 8,
                          alignItems: 'flex-start',
                          marginBottom: 4,
                        }}
                      >
                        <div style={{ minWidth: 0 }}>
                          <strong style={{ fontSize: '0.92rem' }}>
                            Auftrag {g.label}
                          </strong>
                          <div className="muted" style={{ fontSize: '0.8rem' }}>
                            {g.colli.length} offen
                            {g.dest ? ` · ${g.dest}` : ''}
                          </div>
                        </div>
                        {session.status === 'OPEN' ? (
                          <button
                            type="button"
                            className="btn btn-secondary"
                            style={{ minHeight: 44, fontSize: '0.82rem', flexShrink: 0 }}
                            disabled={loading}
                            onClick={() =>
                              void cancelShipment(g.shipmentId, g.label, g.colli.length)
                            }
                          >
                            Storno Auftrag
                          </button>
                        ) : null}
                      </div>
                      <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
                        {g.colli.map((c) => (
                          <li
                            key={c.checkId}
                            style={{
                              padding: '0.35rem 0 0.35rem 0.15rem',
                              fontSize: '0.82rem',
                              borderTop: '1px dashed color-mix(in srgb, var(--border, #d8e0db) 70%, transparent)',
                            }}
                          >
                            <div
                              className="row"
                              style={{
                                justifyContent: 'space-between',
                                gap: 8,
                                alignItems: 'center',
                              }}
                            >
                              <div style={{ minWidth: 0 }}>
                                <code style={{ fontSize: '0.78rem' }}>{c.sscc}</code>
                                <div className="muted" style={{ fontSize: '0.75rem' }}>
                                  {[c.packaging, c.deliveryZip, c.deliveryCompany]
                                    .filter(Boolean)
                                    .join(' · ')}
                                </div>
                              </div>
                              {session.status === 'OPEN' ? (
                                <button
                                  type="button"
                                  className="btn btn-secondary"
                                  style={{ minHeight: 40, fontSize: '0.78rem', flexShrink: 0 }}
                                  disabled={loading}
                                  onClick={() => void cancelCollo(c.colloId, c.sscc)}
                                >
                                  Storno
                                </button>
                              ) : null}
                            </div>
                          </li>
                        ))}
                      </ul>
                    </div>
                  ));
                })()}
              </div>
            </details>

            {(session.surplus?.length || 0) > 0 ? (
              <details className="panel" open>
                <summary style={{ cursor: 'pointer', fontWeight: 600, color: '#a12622', minHeight: 40 }}>
                  Überzählig ({session.surplus!.length})
                </summary>
                <ul style={{ listStyle: 'none', margin: '0.4rem 0 0', padding: 0 }}>
                  {session.surplus!.map((s) => (
                    <li
                      key={s.id}
                      style={{
                        borderTop: '1px solid var(--border, #d8e0db)',
                        padding: '0.45rem 0',
                        fontSize: '0.85rem',
                      }}
                    >
                      <div className="row" style={{ justifyContent: 'space-between', gap: 8, alignItems: 'center' }}>
                        <div>
                          <code>{s.sscc}</code>
                          <div className="muted" style={{ fontSize: '0.78rem' }}>
                            {s.documentId ? 'Label-Foto vorhanden' : 'ohne Foto'}
                          </div>
                        </div>
                        {session.status === 'OPEN' && !s.documentId ? (
                          <button
                            type="button"
                            className="btn btn-secondary"
                            style={{ minHeight: 40, fontSize: '0.8rem' }}
                            disabled={loading}
                            onClick={() => {
                              setLastScan({
                                kind: 'surplus',
                                surplusId: s.id,
                                sscc: s.sscc,
                                note: '',
                                damaged: false,
                                photoRequired: true,
                                hasPhoto: false,
                                lengthCm: '',
                                widthCm: '',
                                heightCm: '',
                                weightKg: '',
                              });
                              photoInputRef.current?.click();
                              window.setTimeout(() => {
                                if (!editingRef.current) focusScanner();
                              }, 400);
                            }}
                          >
                            Label-Foto
                          </button>
                        ) : null}
                      </div>
                    </li>
                  ))}
                </ul>
              </details>
            ) : null}

            {session.expectedColli.some((c) => c.status === 'CANCELLED') ? (
              <details className="panel">
                <summary style={{ cursor: 'pointer', fontWeight: 600, minHeight: 40 }}>
                  Storniert (
                  {session.expectedColli.filter((c) => c.status === 'CANCELLED').length})
                </summary>
                <ul style={{ listStyle: 'none', margin: '0.4rem 0 0', padding: 0 }}>
                  {session.expectedColli
                    .filter((c) => c.status === 'CANCELLED')
                    .map((c) => (
                      <li
                        key={c.checkId}
                        style={{
                          borderTop: '1px solid var(--border, #d8e0db)',
                          padding: '0.4rem 0',
                          fontSize: '0.85rem',
                          opacity: 0.8,
                        }}
                      >
                        <code>{c.sscc}</code>
                        <div className="muted">nicht andrucken</div>
                      </li>
                    ))}
                </ul>
              </details>
            ) : null}
            </>
            ) : null}
          </>
        )}
      </div>
    </AppShell>
  );
}
