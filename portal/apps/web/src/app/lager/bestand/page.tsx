'use client';

import { Suspense, useEffect, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { AppShell } from '@/components/AppShell';
import { api, getUser } from '@/lib/api';

type Unit = {
  id: string;
  palletType: string;
  slotUnits: number;
  articleName?: string | null;
  serialNumber?: string | null;
  sscc?: string | null;
  externalRef?: string | null;
  status: string;
  storedAt: string;
  releasedAt?: string | null;
  customer: { id: string; name: string; customerNumber: string };
  location: { id: string; code: string; kind: string; label?: string | null };
};

const PALLET: Record<string, string> = {
  EURO: 'Euro',
  HALF: 'Halb',
  OVERSIZE: 'Übergroß',
  CUSTOM: 'Individuell/EWP',
};

function fmtDateTime(iso?: string | null) {
  if (!iso) return '–';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '–';
  return d.toLocaleString('de-AT', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function toLocalInputValue(d = new Date()) {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function LagerBestandInner() {
  const user = getUser();
  const isCustomer = user?.role === 'CUSTOMER_USER';
  const searchParams = useSearchParams();
  const customerIdFilter = searchParams.get('customerId') || '';
  const [units, setUnits] = useState<Unit[]>([]);
  const [q, setQ] = useState('');
  const [status, setStatus] = useState<'STORED' | 'RELEASED' | 'ALL'>('STORED');
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [busyId, setBusyId] = useState<string | null>(null);
  const [outboundId, setOutboundId] = useState<string | null>(null);
  const [outboundAt, setOutboundAt] = useState(toLocalInputValue());

  async function load(search = q, st = status) {
    const qs = new URLSearchParams();
    if (search.trim()) qs.set('q', search.trim());
    if (customerIdFilter && !isCustomer) qs.set('customerId', customerIdFilter);
    qs.set('status', st);
    const list = await api<Unit[]>(`/warehouse/stock?${qs}`);
    setUnits(list);
  }

  useEffect(() => {
    load().catch((e) => setError(e.message));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [customerIdFilter, status]);

  function openOutbound(id: string) {
    setOutboundId(id);
    setOutboundAt(toLocalInputValue());
    setError('');
    setMessage('');
  }

  async function confirmOutbound() {
    if (!outboundId) return;
    setBusyId(outboundId);
    setError('');
    setMessage('');
    try {
      await api(`/warehouse/units/${outboundId}/outbound`, {
        method: 'POST',
        body: JSON.stringify({ releasedAt: outboundAt || undefined }),
      });
      setMessage('Ausgelagert');
      setOutboundId(null);
      await load();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusyId(null);
    }
  }

  const colSpan = isCustomer ? 7 : 9;

  return (
    <AppShell title="Lagerbestand" eyebrow="Lagerverwaltung">
      <div className="row" style={{ gap: '0.75rem', flexWrap: 'wrap', marginBottom: '1rem' }}>
        {!isCustomer && (
          <>
            <Link className="btn btn-primary" href="/lager/einlagern">
              Einlagern
            </Link>
            <Link className="btn btn-ghost" href="/lager/artikel">
              Artikel
            </Link>
            <Link className="btn btn-ghost" href="/lager/plaetze">
              Plätze
            </Link>
            <Link className="btn btn-ghost" href="/lager/preise">
              Preise
            </Link>
            <Link className="btn btn-ghost" href="/lager/abrechnung">
              Abrechnung
            </Link>
          </>
        )}
      </div>

      <form
        className="row"
        style={{ gap: '0.5rem', marginBottom: '1rem', flexWrap: 'wrap' }}
        onSubmit={(e) => {
          e.preventDefault();
          load().catch((err) => setError(err.message));
        }}
      >
        <input
          style={{ flex: 1, minWidth: 200 }}
          placeholder="Suche Artikel, Seriennr., SSCC, Platz, Kunde…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
        <select
          value={status}
          onChange={(e) => setStatus(e.target.value as 'STORED' | 'RELEASED' | 'ALL')}
        >
          <option value="STORED">Eingelagert</option>
          <option value="RELEASED">Ausgelagert</option>
          <option value="ALL">Alle</option>
        </select>
        <button className="btn btn-primary" type="submit">
          Suchen
        </button>
      </form>

      {error ? <p className="error">{error}</p> : null}
      {message ? <p className="ok">{message}</p> : null}

      {outboundId && !isCustomer ? (
        <div className="panel stack" style={{ marginBottom: '1rem', maxWidth: 420 }}>
          <strong>Auslagern</strong>
          <div className="field">
            <label>Auslagerungsdatum / -zeit</label>
            <input
              type="datetime-local"
              value={outboundAt}
              onChange={(e) => setOutboundAt(e.target.value)}
              required
            />
          </div>
          <div className="row" style={{ gap: '0.5rem' }}>
            <button
              className="btn btn-primary"
              type="button"
              disabled={busyId === outboundId}
              onClick={confirmOutbound}
            >
              Bestätigen
            </button>
            <button className="btn btn-ghost" type="button" onClick={() => setOutboundId(null)}>
              Abbrechen
            </button>
          </div>
        </div>
      ) : null}

      <div className="panel" style={{ overflowX: 'auto' }}>
        <table className="table">
          <thead>
            <tr>
              {!isCustomer && <th>Kunde</th>}
              <th>Platz</th>
              <th>Typ</th>
              <th>Artikel</th>
              <th>Serie</th>
              <th>Einlagerung</th>
              <th>Auslagerung</th>
              {!isCustomer && <th></th>}
            </tr>
          </thead>
          <tbody>
            {units.map((u) => (
              <tr key={u.id} style={{ opacity: u.status === 'RELEASED' ? 0.7 : 1 }}>
                {!isCustomer && <td>{u.customer.name}</td>}
                <td>
                  <strong>{u.location.code}</strong>
                </td>
                <td>
                  {PALLET[u.palletType] || u.palletType} ({u.slotUnits})
                </td>
                <td>{u.articleName || '–'}</td>
                <td>{u.serialNumber || '–'}</td>
                <td>{fmtDateTime(u.storedAt)}</td>
                <td>{fmtDateTime(u.releasedAt)}</td>
                {!isCustomer && (
                  <td>
                    {u.status === 'STORED' ? (
                      <button
                        className="btn btn-ghost"
                        type="button"
                        disabled={busyId === u.id}
                        onClick={() => openOutbound(u.id)}
                      >
                        Auslagern
                      </button>
                    ) : (
                      <span className="muted">ausgelagert</span>
                    )}
                  </td>
                )}
              </tr>
            ))}
            {!units.length && (
              <tr>
                <td colSpan={colSpan} className="muted">
                  Kein Bestand.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </AppShell>
  );
}

export default function LagerBestandPage() {
  return (
    <Suspense fallback={<AppShell title="Lagerbestand">Laden…</AppShell>}>
      <LagerBestandInner />
    </Suspense>
  );
}
