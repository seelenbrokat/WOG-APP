'use client';

import { FormEvent, useEffect, useState } from 'react';
import { AppShell } from '@/components/AppShell';
import { api } from '@/lib/api';

type AuditEntry = {
  id: string;
  action: string;
  entityType: string;
  entityId?: string | null;
  meta?: unknown;
  createdAt: string;
  actor?: { email: string; firstName: string; lastName: string } | null;
};

function fmt(value: string) {
  return new Date(value).toLocaleString('de-CH', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}

export default function AuditPage() {
  const [rows, setRows] = useState<AuditEntry[]>([]);
  const [q, setQ] = useState('');
  const [entityType, setEntityType] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);

  async function load(next?: { q?: string; entityType?: string }) {
    setLoading(true);
    setError('');
    try {
      const params = new URLSearchParams();
      params.set('take', '200');
      const qq = next?.q ?? q;
      const et = next?.entityType ?? entityType;
      if (qq.trim()) params.set('q', qq.trim());
      if (et.trim()) params.set('entityType', et.trim());
      const data = await api<AuditEntry[]>(`/audit?${params}`);
      setRows(data);
    } catch (e: any) {
      setError(e.message || 'Laden fehlgeschlagen');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function onSearch(e: FormEvent) {
    e.preventDefault();
    void load();
  }

  return (
    <AppShell title="Änderungsprotokoll">
      <p className="muted" style={{ marginBottom: '1rem' }}>
        Wer hat was geändert – Aktionen der Benutzer in Ihrer Organisation.
      </p>

      <form className="row" style={{ marginBottom: '1rem', gap: '0.75rem', flexWrap: 'wrap' }} onSubmit={onSearch}>
        <label>
          Suche
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Aktion, Entity, ID…"
          />
        </label>
        <label>
          Entity-Typ
          <input
            value={entityType}
            onChange={(e) => setEntityType(e.target.value)}
            placeholder="z. B. Shipment"
          />
        </label>
        <button className="btn btn-secondary" type="submit" style={{ alignSelf: 'end' }}>
          Filtern
        </button>
      </form>

      {error ? <div className="error">{error}</div> : null}
      {loading ? <p className="muted">Laden…</p> : null}

      <div className="panel">
        <table className="table">
          <thead>
            <tr>
              <th>Zeit</th>
              <th>Benutzer</th>
              <th>Aktion</th>
              <th>Entity</th>
              <th>Details</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id}>
                <td className="muted" style={{ whiteSpace: 'nowrap' }}>
                  {fmt(r.createdAt)}
                </td>
                <td>
                  {r.actor
                    ? `${r.actor.firstName} ${r.actor.lastName}`
                    : '—'}
                  {r.actor?.email ? (
                    <div className="muted" style={{ fontSize: '0.85rem' }}>
                      {r.actor.email}
                    </div>
                  ) : null}
                </td>
                <td>
                  <code>{r.action}</code>
                </td>
                <td>
                  {r.entityType}
                  {r.entityId ? (
                    <div className="muted" style={{ fontSize: '0.8rem' }}>
                      {r.entityId}
                    </div>
                  ) : null}
                </td>
                <td className="muted" style={{ fontSize: '0.85rem', maxWidth: 280 }}>
                  {r.meta ? JSON.stringify(r.meta) : '—'}
                </td>
              </tr>
            ))}
            {!loading && !rows.length && (
              <tr>
                <td colSpan={5} className="muted">
                  Keine Einträge.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </AppShell>
  );
}
