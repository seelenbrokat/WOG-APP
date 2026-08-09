'use client';

import { useEffect, useState } from 'react';
import { api } from '@/lib/api';

type SftpConfig = {
  kind: 'CUSTOMER' | 'PARTNER';
  id: string;
  name: string;
  sftpInboundEnabled: boolean;
  sftpUsername: string | null;
  sftpInboundFormat: string;
  dropPath: string | null;
  host: string;
  port: number;
  suggestedUsername: string;
  temporaryPassword?: string;
  provisionHint?: string;
};

export function SftpInboundPanel({
  customerId,
  initialEnabled,
}: {
  customerId: string;
  initialEnabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [cfg, setCfg] = useState<SftpConfig | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const [err, setErr] = useState('');
  const [passwordOnce, setPasswordOnce] = useState('');

  async function load() {
    const data = await api<SftpConfig>(
      `/integrations/partner-orders/sftp/customer/${customerId}`,
    );
    setCfg(data);
  }

  useEffect(() => {
    if (!open) return;
    load().catch((e: any) => setErr(e?.message || 'Laden fehlgeschlagen'));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, customerId]);

  async function save(regeneratePassword = false) {
    if (!cfg) return;
    setBusy(true);
    setMsg('');
    setErr('');
    try {
      const saved = await api<SftpConfig>(
        `/integrations/partner-orders/sftp/customer/${customerId}`,
        {
          method: 'POST',
          body: JSON.stringify({
            sftpInboundEnabled: cfg.sftpInboundEnabled,
            sftpUsername: cfg.sftpUsername || cfg.suggestedUsername,
            sftpInboundFormat: cfg.sftpInboundFormat || 'BORD512',
            regeneratePassword,
          }),
        },
      );
      setCfg(saved);
      if (saved.temporaryPassword) {
        setPasswordOnce(saved.temporaryPassword);
        setMsg('SFTP freigeschaltet – Passwort einmalig notieren');
      } else {
        setMsg('SFTP-Einstellungen gespeichert');
      }
    } catch (e: any) {
      setErr(e?.message || 'Speichern fehlgeschlagen');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{ marginTop: '0.5rem' }}>
      <button
        type="button"
        className="btn btn-secondary"
        onClick={() => setOpen((v) => !v)}
      >
        {open ? 'SFTP-Inbound schließen' : 'SFTP-Inbound freischalten'}
        {initialEnabled ? ' · aktiv' : ''}
      </button>
      {open && (
        <div className="panel stack" style={{ marginTop: '0.65rem' }}>
          {!cfg && <p className="muted">Lade…</p>}
          {cfg && (
            <>
              <label className="row" style={{ gap: '0.5rem', alignItems: 'center' }}>
                <input
                  type="checkbox"
                  checked={cfg.sftpInboundEnabled}
                  onChange={(e) =>
                    setCfg({ ...cfg, sftpInboundEnabled: e.target.checked })
                  }
                />
                <strong>SFTP-Upload für Auftragsdateien freischalten</strong>
              </label>
              <p className="muted" style={{ margin: 0, fontSize: '0.9rem' }}>
                Nur für diesen Kunden. Dateien (z. B. FORTRAS BORD512) werden automatisch
                ins Soloplan-Format transformiert und nach{' '}
                <code>outbound/soloplan/orders/</code> gelegt.
              </p>
              <label className="stack" style={{ gap: '0.25rem' }}>
                <span>SFTP-Benutzer</span>
                <input
                  value={cfg.sftpUsername || cfg.suggestedUsername || ''}
                  onChange={(e) => setCfg({ ...cfg, sftpUsername: e.target.value })}
                  placeholder={cfg.suggestedUsername}
                />
              </label>
              <label className="stack" style={{ gap: '0.25rem' }}>
                <span>Format</span>
                <select
                  value={cfg.sftpInboundFormat || 'BORD512'}
                  onChange={(e) => setCfg({ ...cfg, sftpInboundFormat: e.target.value })}
                >
                  <option value="BORD512">FORTRAS BORD512</option>
                  <option value="AUTO">Automatisch erkennen</option>
                </select>
              </label>
              {cfg.sftpInboundEnabled && cfg.dropPath && (
                <div className="muted" style={{ fontSize: '0.9rem' }}>
                  <div>
                    Host: <code>{cfg.host}</code> · Port <code>{cfg.port}</code>
                  </div>
                  <div>
                    Pfad: <code>{cfg.dropPath}</code>
                  </div>
                </div>
              )}
              {passwordOnce && (
                <div className="success">
                  Passwort (nur jetzt sichtbar): <code>{passwordOnce}</code>
                  <div style={{ marginTop: '0.35rem' }}>
                    Auf dem Server danach:{' '}
                    <code>sudo bash portal/scripts/provision-partner-sftp.sh {cfg.sftpUsername}</code>
                  </div>
                </div>
              )}
              <div className="row" style={{ gap: '0.5rem' }}>
                <button className="btn btn-primary" type="button" disabled={busy} onClick={() => save(false)}>
                  {busy ? 'Speichern…' : 'Speichern'}
                </button>
                {cfg.sftpInboundEnabled && (
                  <button
                    className="btn btn-secondary"
                    type="button"
                    disabled={busy}
                    onClick={() => save(true)}
                  >
                    Passwort neu erzeugen
                  </button>
                )}
              </div>
            </>
          )}
          {msg && <div className="success">{msg}</div>}
          {err && <div className="error">{err}</div>}
        </div>
      )}
    </div>
  );
}
