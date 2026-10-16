'use client';

import { FormEvent, useEffect, useState } from 'react';
import { AppShell } from '@/components/AppShell';
import { api } from '@/lib/api';

const SYSTEMS = ['SOLOPLAN', 'LDV', 'MERCURIO'] as const;

export default function IntegrationsPage() {
  const [hub, setHub] = useState<any>(null);
  const [transfers, setTransfers] = useState<any[]>([]);
  const [customs, setCustoms] = useState<any[]>([]);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [form, setForm] = useState({
    fromSystem: 'SOLOPLAN',
    toSystem: 'LDV',
    customsOrderId: '',
    reference: '',
  });

  async function load() {
    const [h, t, c] = await Promise.all([
      api('/integrations/hub/status'),
      api<any[]>('/integrations/hub/transfers'),
      api<any[]>('/customs').catch(() => []),
    ]);
    setHub(h);
    setTransfers(t);
    setCustoms(c);
  }

  useEffect(() => {
    load().catch((err) => setError(err.message));
  }, []);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError('');
    setMessage('');
    try {
      const res = await api<any>('/integrations/hub/transfers', {
        method: 'POST',
        body: JSON.stringify({
          fromSystem: form.fromSystem,
          toSystem: form.toSystem,
          customsOrderId: form.customsOrderId || undefined,
          reference: form.reference || undefined,
          processNow: true,
        }),
      });
      setMessage(`Transfer ${res.reference || res.id}: ${res.status} – ${res.message || ''}`);
      await load();
    } catch (err: any) {
      setError(err.message);
    }
  }

  return (
    <AppShell title="EZOLL-Integration">
      <p className="muted" style={{ marginBottom: '1rem' }}>
        Interne Datenübermittlung zwischen <strong>Soloplan</strong>, <strong>LDV</strong> und{' '}
        <strong>Mercurio</strong>. Bidirektional: Soloplan → Zollprogramm und zurück.
      </p>

      {hub && (
        <div className="grid-3" style={{ marginBottom: '1rem' }}>
          <div className="stat">
            <div className="label">Soloplan</div>
            <div className="value" style={{ fontSize: '1.2rem' }}>
              {hub.adapters.soloplan.enabled ? hub.adapters.soloplan.mode : 'aus'}
            </div>
          </div>
          <div className="stat">
            <div className="label">LDV</div>
            <div className="value" style={{ fontSize: '1.2rem' }}>
              {hub.adapters.ldv.enabled ? hub.adapters.ldv.mode : 'aus / stub'}
            </div>
          </div>
          <div className="stat">
            <div className="label">Mercurio</div>
            <div className="value" style={{ fontSize: '1.2rem' }}>
              {hub.adapters.mercurio.enabled ? hub.adapters.mercurio.mode : 'aus / stub'}
            </div>
          </div>
        </div>
      )}

      <form className="panel stack" style={{ marginBottom: '1rem', maxWidth: 720 }} onSubmit={onSubmit}>
        <strong>Transfer anstoßen</strong>
        <div className="grid-2">
          <div className="field">
            <label>Von</label>
            <select value={form.fromSystem} onChange={(e) => setForm({ ...form, fromSystem: e.target.value })}>
              {SYSTEMS.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </div>
          <div className="field">
            <label>Nach</label>
            <select value={form.toSystem} onChange={(e) => setForm({ ...form, toSystem: e.target.value })}>
              {SYSTEMS.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </div>
        </div>
        <div className="field">
          <label>Verzollungsauftrag (optional)</label>
          <select value={form.customsOrderId} onChange={(e) => setForm({ ...form, customsOrderId: e.target.value })}>
            <option value="">– ohne / manuell –</option>
            {customs.map((c) => (
              <option key={c.id} value={c.id}>
                {c.kennzeichen} · {c.grenzuebergang} · {c.importeur}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label>Referenz (optional)</label>
          <input value={form.reference} onChange={(e) => setForm({ ...form, reference: e.target.value })} />
        </div>
        {error && <div className="error">{error}</div>}
        {message && <div className="success">{message}</div>}
        <div className="row">
          <button className="btn btn-primary" type="submit">Übermitteln</button>
          <button
            className="btn btn-ghost"
            type="button"
            onClick={async () => {
              const res = await api<{ processed: number }>('/integrations/hub/poll-inbox', { method: 'POST' });
              setMessage(`Inbox verarbeitet: ${res.processed}`);
              await load();
            }}
          >
            Inbox abholen
          </button>
        </div>
      </form>

      <div className="panel">
        <strong>Transfer-Log</strong>
        <table className="table">
          <thead>
            <tr>
              <th>Route</th>
              <th>Referenz</th>
              <th>Status</th>
              <th>Meldung</th>
              <th>Zeit</th>
            </tr>
          </thead>
          <tbody>
            {transfers.map((t) => (
              <tr key={t.id}>
                <td>{t.fromSystem} → {t.toSystem}</td>
                <td>{t.reference || '–'}</td>
                <td><span className={`badge ${t.status === 'SUCCESS' ? 'ok' : t.status === 'FAILED' ? 'warn' : ''}`}>{t.status}</span></td>
                <td className="muted">{t.message || '–'}</td>
                <td className="muted">{new Date(t.createdAt).toLocaleString('de-AT')}</td>
              </tr>
            ))}
            {!transfers.length && (
              <tr><td colSpan={5} className="muted">Noch keine Transfers.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </AppShell>
  );
}
