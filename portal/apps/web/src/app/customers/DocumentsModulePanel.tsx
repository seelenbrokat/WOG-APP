'use client';

import { useEffect, useState } from 'react';
import { api } from '@/lib/api';

type CategoryRow = {
  code: string;
  label: string;
  enabled: boolean;
  required: boolean;
};

type ModuleConfig = {
  customerId: string;
  documentsModuleEnabled: boolean;
  categories: CategoryRow[];
};

export function DocumentsModulePanel({
  customerId,
  initialEnabled,
}: {
  customerId: string;
  initialEnabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [cfg, setCfg] = useState<ModuleConfig | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const [err, setErr] = useState('');

  async function load() {
    const data = await api<ModuleConfig>(`/documents/module/customer/${customerId}`);
    setCfg(data);
  }

  useEffect(() => {
    if (!open) return;
    load().catch((e: any) => setErr(e?.message || 'Laden fehlgeschlagen'));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, customerId]);

  async function save() {
    if (!cfg) return;
    setBusy(true);
    setMsg('');
    setErr('');
    try {
      const saved = await api<ModuleConfig>(`/documents/module/customer/${customerId}`, {
        method: 'POST',
        body: JSON.stringify({
          documentsModuleEnabled: cfg.documentsModuleEnabled,
          categories: cfg.categories.map((c) => ({
            code: c.code,
            enabled: c.enabled,
            required: c.required,
          })),
        }),
      });
      setCfg(saved);
      setMsg('Dokumente-Modul gespeichert');
    } catch (e: any) {
      setErr(e?.message || 'Speichern fehlgeschlagen');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{ marginTop: '0.75rem' }}>
      <button
        type="button"
        className="btn btn-secondary"
        onClick={() => setOpen((v) => !v)}
      >
        {open ? 'Dokumente-Modul schließen' : 'Dokumente-Modul freischalten'}
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
                  checked={cfg.documentsModuleEnabled}
                  onChange={(e) =>
                    setCfg({ ...cfg, documentsModuleEnabled: e.target.checked })
                  }
                />
                <strong>Modul „Dokumente“ freischalten</strong>
              </label>
              <p className="muted" style={{ margin: 0, fontSize: '0.9rem' }}>
                Freigeschaltete Kategorien kann der Kunde in der Sendungsübersicht herunterladen.
              </p>
              <table className="table table-compact">
                <thead>
                  <tr>
                    <th>Kategorie</th>
                    <th>Freigabe</th>
                    <th>Pflicht (Filter „fehlt“)</th>
                  </tr>
                </thead>
                <tbody>
                  {cfg.categories.map((c, idx) => (
                    <tr key={c.code}>
                      <td>{c.label}</td>
                      <td>
                        <input
                          type="checkbox"
                          checked={c.enabled}
                          onChange={(e) => {
                            const categories = [...cfg.categories];
                            categories[idx] = { ...c, enabled: e.target.checked };
                            setCfg({ ...cfg, categories });
                          }}
                        />
                      </td>
                      <td>
                        <input
                          type="checkbox"
                          checked={c.required}
                          disabled={!c.enabled}
                          onChange={(e) => {
                            const categories = [...cfg.categories];
                            categories[idx] = { ...c, required: e.target.checked };
                            setCfg({ ...cfg, categories });
                          }}
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <button className="btn btn-primary" type="button" disabled={busy} onClick={save}>
                {busy ? 'Speichern…' : 'Speichern'}
              </button>
            </>
          )}
          {msg && <div className="success">{msg}</div>}
          {err && <div className="error">{err}</div>}
        </div>
      )}
    </div>
  );
}
