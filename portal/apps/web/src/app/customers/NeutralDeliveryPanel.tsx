'use client';

import { useState } from 'react';
import { api } from '@/lib/api';

/** Kunden-Einstellung: Ablieferbelege immer ohne Auftraggeber (nur Absender + Empfänger). */
export function NeutralDeliveryPanel({
  customerId,
  initialEnabled,
  onChanged,
}: {
  customerId: string;
  initialEnabled?: boolean;
  onChanged?: (enabled: boolean) => void;
}) {
  const [enabled, setEnabled] = useState(Boolean(initialEnabled));
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const [err, setErr] = useState('');

  async function toggle(next: boolean) {
    setBusy(true);
    setMsg('');
    setErr('');
    try {
      await api(`/customers/${customerId}`, {
        method: 'PATCH',
        body: JSON.stringify({ neutralDeliveryReceipt: next }),
      });
      setEnabled(next);
      onChanged?.(next);
      setMsg(next ? 'Neutrale Ablieferbelege aktiv' : 'Neutrale Ablieferbelege aus');
    } catch (e: any) {
      setErr(e?.message || 'Speichern fehlgeschlagen');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{ marginTop: '0.65rem' }}>
      <label className="row" style={{ gap: '0.5rem', alignItems: 'center', margin: 0 }}>
        <input
          type="checkbox"
          checked={enabled}
          disabled={busy}
          onChange={(e) => toggle(e.target.checked)}
        />
        <span>
          <strong>Ablieferbeleg immer neutral</strong>
          <span className="muted" style={{ display: 'block', fontSize: '0.85rem' }}>
            Nur Absender + Empfänger andrucken, keinen Auftraggeber (z. B. Europapier).
          </span>
        </span>
      </label>
      {msg && <div className="success" style={{ marginTop: '0.35rem' }}>{msg}</div>}
      {err && <div className="error" style={{ marginTop: '0.35rem' }}>{err}</div>}
    </div>
  );
}
