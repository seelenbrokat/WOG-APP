'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { AppShell } from '@/components/AppShell';
import { api, getToken } from '@/lib/api';

type Schein = {
  id: string;
  number: string;
  status: string;
  tourNumber?: string | null;
  partnerName?: string | null;
  vehiclePlate?: string | null;
  occurredAt: string;
  eupOut: number;
  eupIn: number;
  emailedAt?: string | null;
};

const STATUS: Record<string, string> = {
  DRAFT: 'Entwurf',
  COMPLETED: 'Abgeschlossen',
  SENT: 'An Partner gesendet',
};

export default function LademittelscheinePage() {
  const [rows, setRows] = useState<Schein[]>([]);
  const [q, setQ] = useState('');
  const [error, setError] = useState('');
  const [dirs, setDirs] = useState<{ inbound?: string; outbound?: string } | null>(null);

  async function load(nextQ?: string) {
    setError('');
    try {
      const params = new URLSearchParams();
      if ((nextQ ?? q).trim()) params.set('q', (nextQ ?? q).trim());
      const data = await api<Schein[]>(`/lager/lademittelscheine?${params}`);
      setRows(data);
    } catch (e: any) {
      setError(e?.message || 'Laden fehlgeschlagen');
    }
  }

  useEffect(() => {
    void load();
    api<{ inbound: string; outbound: string }>('/lager/lademittelscheine/dirs')
      .then(setDirs)
      .catch(() => setDirs(null));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function openPdf(id: string) {
    const res = await fetch(
      `${process.env.NEXT_PUBLIC_API_URL || '/api'}/lager/lademittelscheine/${id}/pdf`,
      { headers: { Authorization: `Bearer ${getToken()}` } },
    );
    if (!res.ok) throw new Error('PDF nicht verfügbar');
    const blob = await res.blob();
    window.open(URL.createObjectURL(blob), '_blank');
  }

  return (
    <AppShell title="Lademittelscheine" eyebrow="Lager">
      <div className="row" style={{ flexWrap: 'wrap', gap: '0.65rem', marginBottom: '0.75rem' }}>
        <input
          type="search"
          placeholder="Suche: Nummer, Tour, Partner…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') void load();
          }}
          style={{ minWidth: 240, flex: '1 1 220px' }}
        />
        <button type="button" className="btn btn-secondary" onClick={() => void load()}>
          Suchen
        </button>
        <Link className="btn btn-primary" href="/lager/lademittelscheine/new">
          Neuer Schein (Tablet)
        </Link>
      </div>

      {dirs && (
        <p className="muted" style={{ fontSize: '0.82rem', marginTop: 0 }}>
          SFTP: Eingang <code>{dirs.inbound}</code> · Ausgang <code>{dirs.outbound}</code>
        </p>
      )}
      {error && <div className="error">{error}</div>}

      <div className="panel">
        <div className="table-scroll">
          <table className="table table-compact">
            <thead>
              <tr>
                <th>Nummer</th>
                <th>Tour / Partner</th>
                <th>EUP raus / rein</th>
                <th>Status</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}>
                  <td>
                    <strong className="mono">{r.number}</strong>
                    <span className="meta">
                      {new Date(r.occurredAt).toLocaleString('de-AT')}
                    </span>
                  </td>
                  <td>
                    <div>{r.tourNumber || '—'}</div>
                    <span className="meta">{r.partnerName || '—'}</span>
                    {r.vehiclePlate ? <span className="meta">{r.vehiclePlate}</span> : null}
                  </td>
                  <td>
                    {r.eupOut} / {r.eupIn}
                  </td>
                  <td>
                    <span className={`badge ${r.status === 'SENT' ? 'ok' : ''}`}>
                      {STATUS[r.status] || r.status}
                    </span>
                  </td>
                  <td>
                    <div className="row" style={{ gap: '0.4rem', flexWrap: 'wrap' }}>
                      <Link href={`/lager/lademittelscheine/${r.id}`}>
                        {r.status === 'DRAFT' ? 'Erfassen' : 'Öffnen'}
                      </Link>
                      {r.status !== 'DRAFT' ? (
                        <button type="button" className="btn btn-ghost" onClick={() => void openPdf(r.id)}>
                          PDF
                        </button>
                      ) : null}
                    </div>
                  </td>
                </tr>
              ))}
              {!rows.length && (
                <tr>
                  <td colSpan={5} className="muted">
                    Noch keine Lademittelscheine.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </AppShell>
  );
}
