'use client';

import { useEffect, useState } from 'react';
import { AppShell } from '@/components/AppShell';
import { api, getUser } from '@/lib/api';

type StaffUser = {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  role: string;
};

type QrResult = {
  expiresAt: string;
  ttlDays: number;
  singleUse: boolean;
  redirectPath: string;
  label: string;
  payload: string;
  qrDataUrl: string;
  user: {
    id: string;
    email: string;
    firstName: string;
    lastName: string;
    role: string;
  };
};

const DEFAULT_LAGER_EMAIL = 'lager@wog.logistikberater.at';

function staffLabel(u: StaffUser) {
  const name = [u.firstName, u.lastName].filter(Boolean).join(' ');
  return name ? `${name} · ${u.email}` : u.email;
}

export default function LagerLoginQrPage() {
  const user = getUser();
  const [staff, setStaff] = useState<StaffUser[]>([]);
  const [userId, setUserId] = useState('');
  const [ttlDays, setTtlDays] = useState(90);
  const [singleUse, setSingleUse] = useState(false);
  const [redirectPath, setRedirectPath] = useState('/scanning/we-tc57');
  const [label, setLabel] = useState('Lager WE TC57');
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [qrResult, setQrResult] = useState<QrResult | null>(null);
  const [copyOk, setCopyOk] = useState(false);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const list = await api<StaffUser[]>('/auth/login-qr/staff');
      setStaff(list);
      const lager =
        list.find((u) => u.email.toLowerCase() === DEFAULT_LAGER_EMAIL) || list[0];
      if (lager && !userId) setUserId(lager.id);
    } catch (e: any) {
      setError(e?.message || 'Mitarbeiter konnten nicht geladen werden');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function createQr() {
    if (!userId) {
      setError('Bitte Benutzer wählen');
      return;
    }
    setCreating(true);
    setError(null);
    setInfo(null);
    setCopyOk(false);
    try {
      const res = await api<QrResult>('/auth/login-qr', {
        method: 'POST',
        body: JSON.stringify({
          userId,
          ttlDays,
          singleUse,
          redirectPath,
          label: label || undefined,
        }),
      });
      setQrResult(res);
      setInfo(
        `QR erzeugt für ${res.user.email}. Gültig bis ${new Date(res.expiresAt).toLocaleString('de-AT')}` +
          (res.singleUse ? ' · einmalig' : ' · mehrfach nutzbar (Station-Badge).'),
      );
    } catch (e: any) {
      setError(e?.message || 'QR-Erzeugung fehlgeschlagen');
      setQrResult(null);
    } finally {
      setCreating(false);
    }
  }

  async function copyPayload() {
    if (!qrResult?.payload) return;
    try {
      await navigator.clipboard.writeText(qrResult.payload);
      setCopyOk(true);
      setTimeout(() => setCopyOk(false), 2000);
    } catch {
      setError('Kopieren fehlgeschlagen');
    }
  }

  function printQr() {
    if (!qrResult) return;
    const w = window.open('', '_blank', 'noopener,noreferrer,width=480,height=760');
    if (!w) {
      setError('Druckfenster blockiert – bitte Pop-ups erlauben');
      return;
    }
    const name =
      [qrResult.user.firstName, qrResult.user.lastName].filter(Boolean).join(' ') ||
      qrResult.user.email;
    w.document.write(`<!doctype html><html><head><title>Lager Login QR</title>
<style>
  body { font-family: system-ui, sans-serif; text-align: center; padding: 28px; color: #111; }
  img { width: 340px; height: 340px; image-rendering: pixelated; }
  h1 { font-size: 22px; margin: 0 0 8px; }
  p { margin: 4px 0; font-size: 14px; }
  .muted { color: #555; font-size: 12px; margin-top: 16px; word-break: break-all; }
</style></head><body>
  <h1>WOG Lager – Anmeldung</h1>
  <p><strong>${qrResult.label || 'Lager'}</strong></p>
  <p>${name} · ${qrResult.user.email}</p>
  <p>Ziel: ${qrResult.redirectPath}</p>
  <p>Gültig bis ${new Date(qrResult.expiresAt).toLocaleString('de-AT')}${
    qrResult.singleUse ? ' · einmalig' : ' · mehrfach nutzbar'
  }</p>
  <img src="${qrResult.qrDataUrl}" alt="Lager Login QR" />
  <p class="muted">${qrResult.payload}</p>
  <script>window.onload=()=>{window.print();}</script>
</body></html>`);
    w.document.close();
  }

  if (!user) {
    return (
      <AppShell title="Lager Login-QR">
        <p>Bitte anmelden.</p>
      </AppShell>
    );
  }

  return (
    <AppShell title="Lager Login-QR" eyebrow="WOG Lager">
      <div style={{ display: 'grid', gap: 24, maxWidth: 920 }}>
        <p className="muted" style={{ margin: 0, maxWidth: 720 }}>
          Erzeugt einen QR-Code zum Anmelden am Lager-Tablet (ohne Passwort tippen). Nach dem Scan
          öffnet sich direkt die gewünschte Seite – Standard: WE TC57. Der Code ist als
          Station-Badge mehrfach nutzbar, bis er abläuft oder neu erzeugt wird.
        </p>

        <section
          style={{
            display: 'flex',
            flexWrap: 'wrap',
            gap: 12,
            alignItems: 'flex-end',
          }}
        >
          <label style={{ display: 'grid', gap: 4, minWidth: 260 }}>
            <span style={{ fontSize: 13 }} className="muted">
              Benutzer
            </span>
            <select
              value={userId}
              onChange={(e) => setUserId(e.target.value)}
              disabled={loading || staff.length === 0}
              style={{ minWidth: 260, padding: '8px 10px' }}
            >
              {staff.length === 0 ? (
                <option value="">Keine Mitarbeiter</option>
              ) : (
                staff.map((u) => (
                  <option key={u.id} value={u.id}>
                    {staffLabel(u)}
                  </option>
                ))
              )}
            </select>
          </label>

          <label style={{ display: 'grid', gap: 4, minWidth: 120 }}>
            <span style={{ fontSize: 13 }} className="muted">
              Gültig (Tage)
            </span>
            <input
              type="number"
              min={1}
              max={365}
              value={ttlDays}
              onChange={(e) => setTtlDays(Number(e.target.value) || 90)}
              style={{ padding: '8px 10px', width: 120 }}
            />
          </label>

          <label style={{ display: 'grid', gap: 4, minWidth: 220 }}>
            <span style={{ fontSize: 13 }} className="muted">
              Ziel nach Login
            </span>
            <select
              value={redirectPath}
              onChange={(e) => setRedirectPath(e.target.value)}
              style={{ minWidth: 220, padding: '8px 10px' }}
            >
              <option value="/scanning/we-tc57">WE TC57</option>
              <option value="/scanning">Scanning</option>
              <option value="/lager/lademittelscheine">Lademittelscheine</option>
              <option value="/dashboard">Dashboard</option>
            </select>
          </label>

          <label style={{ display: 'grid', gap: 4, minWidth: 180 }}>
            <span style={{ fontSize: 13 }} className="muted">
              Bezeichnung
            </span>
            <input
              type="text"
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              style={{ padding: '8px 10px', minWidth: 180 }}
            />
          </label>

          <label
            style={{
              display: 'flex',
              gap: 8,
              alignItems: 'center',
              paddingBottom: 8,
              minWidth: 160,
            }}
          >
            <input
              type="checkbox"
              checked={singleUse}
              onChange={(e) => setSingleUse(e.target.checked)}
            />
            <span style={{ fontSize: 14 }}>Nur einmalig</span>
          </label>

          <button
            type="button"
            className="btn btn-primary"
            onClick={() => void createQr()}
            disabled={creating || !userId}
          >
            {creating ? 'Erzeuge…' : 'QR erzeugen'}
          </button>
        </section>

        {error && (
          <p style={{ color: '#b00020', margin: 0 }} role="alert">
            {error}
          </p>
        )}
        {info && (
          <p style={{ color: '#0a5', margin: 0 }} role="status">
            {info}
          </p>
        )}

        {qrResult && (
          <section
            style={{
              display: 'grid',
              gap: 16,
              justifyItems: 'start',
              borderTop: '1px solid var(--border, #ddd)',
              paddingTop: 20,
            }}
          >
            <img
              src={qrResult.qrDataUrl}
              alt="Lager Login QR"
              width={280}
              height={280}
              style={{ imageRendering: 'pixelated', background: '#fff' }}
            />
            <p className="muted" style={{ margin: 0, wordBreak: 'break-all', maxWidth: 560 }}>
              {qrResult.payload}
            </p>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10 }}>
              <button type="button" className="btn btn-primary" onClick={printQr}>
                Drucken
              </button>
              <button type="button" className="btn" onClick={() => void copyPayload()}>
                {copyOk ? 'Kopiert' : 'Link kopieren'}
              </button>
              <a
                className="btn"
                href={qrResult.qrDataUrl}
                download={`lager-login-qr-${qrResult.user.email}.png`}
              >
                PNG speichern
              </a>
            </div>
          </section>
        )}
      </div>
    </AppShell>
  );
}
