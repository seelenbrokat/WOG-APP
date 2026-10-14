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
  customer: { id: string; name: string; customerNumber: string };
  location: { id: string; code: string; kind: string; label?: string | null };
};

const PALLET: Record<string, string> = {
  EURO: 'Euro',
  HALF: 'Halb',
  OVERSIZE: 'Übergroß',
};

function LagerBestandInner() {
  const user = getUser();
  const isCustomer = user?.role === 'CUSTOMER_USER';
  const searchParams = useSearchParams();
  const customerIdFilter = searchParams.get('customerId') || '';
  const [units, setUnits] = useState<Unit[]>([]);
  const [q, setQ] = useState('');
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [busyId, setBusyId] = useState<string | null>(null);

  async function load(search = q) {
    const qs = new URLSearchParams();
    if (search.trim()) qs.set('q', search.trim());
    if (customerIdFilter && !isCustomer) qs.set('customerId', customerIdFilter);
    qs.set('status', 'STORED');
    const list = await api<Unit[]>(`/warehouse/stock?${qs}`);
    setUnits(list);
  }

  useEffect(() => {
    load().catch((e) => setError(e.message));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [customerIdFilter]);

  async function outbound(id: string) {
    if (!confirm('Palette wirklich auslagern?')) return;
    setBusyId(id);
    setError('');
    setMessage('');
    try {
      await api(`/warehouse/units/${id}/outbound`, { method: 'POST', body: JSON.stringify({}) });
      setMessage('Ausgelagert');
      await load();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusyId(null);
    }
  }

  return (
    <AppShell title="Lagerbestand" eyebrow="Lagerverwaltung">
      <div className="row" style={{ gap: '0.75rem', flexWrap: 'wrap', marginBottom: '1rem' }}>
        {!isCustomer && (
          <>
            <Link className="btn btn-primary" href="/lager/einlagern">
              Einlagern
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
        style={{ gap: '0.5rem', marginBottom: '1rem' }}
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
        <button className="btn btn-primary" type="submit">
          Suchen
        </button>
      </form>

      {error ? <p className="error">{error}</p> : null}
      {message ? <p className="ok">{message}</p> : null}

      <div className="panel" style={{ overflowX: 'auto' }}>
        <table className="table">
          <thead>
            <tr>
              {!isCustomer && <th>Kunde</th>}
              <th>Platz</th>
              <th>Typ</th>
              <th>Artikel</th>
              <th>Serie</th>
              <th>Seit</th>
              {!isCustomer && <th></th>}
            </tr>
          </thead>
          <tbody>
            {units.map((u) => (
              <tr key={u.id}>
                {!isCustomer && <td>{u.customer.name}</td>}
                <td>
                  <strong>{u.location.code}</strong>
                </td>
                <td>
                  {PALLET[u.palletType] || u.palletType} ({u.slotUnits})
                </td>
                <td>{u.articleName || '–'}</td>
                <td>{u.serialNumber || '–'}</td>
                <td>{new Date(u.storedAt).toLocaleDateString('de-AT')}</td>
                {!isCustomer && (
                  <td>
                    <button
                      className="btn btn-ghost"
                      type="button"
                      disabled={busyId === u.id}
                      onClick={() => outbound(u.id)}
                    >
                      Auslagern
                    </button>
                  </td>
                )}
              </tr>
            ))}
            {!units.length && (
              <tr>
                <td colSpan={isCustomer ? 5 : 7} className="muted">
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
