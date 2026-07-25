'use client';

import { useEffect, useState } from 'react';
import { AppShell } from '@/components/AppShell';
import { api, getToken } from '@/lib/api';

type Schein = {
  id: string;
  number: string;
  status: string;
  tourNumber?: string | null;
  vehiclePlate?: string | null;
  occurredAt: string;
  eupOut: number;
  eupIn: number;
};

export default function PartnerLademittelscheinePage() {
  const [rows, setRows] = useState<Schein[]>([]);
  const [error, setError] = useState('');

  useEffect(() => {
    api<Schein[]>('/lager/lademittelscheine/partner')
      .then(setRows)
      .catch((e: any) => setError(e?.message || 'Laden fehlgeschlagen'));
  }, []);

  async function openPdf(id: string) {
    const res = await fetch(`${process.env.NEXT_PUBLIC_API_URL || '/api'}/lager/lademittelscheine/${id}/pdf`, {
      headers: { Authorization: `Bearer ${getToken()}` },
    });
    if (!res.ok) throw new Error('PDF nicht verfügbar');
    const blob = await res.blob();
    window.open(URL.createObjectURL(blob), '_blank');
  }

  return (
    <AppShell title="Lademittelscheine" eyebrow="Partner">
      <p className="muted" style={{ marginTop: 0 }}>
        Abgeschlossene Scheine zu Ihren Touren – per E-Mail zugestellt und hier zum Download.
      </p>
      {error && <div className="error">{error}</div>}
      <div className="panel">
        <table className="table">
          <thead>
            <tr>
              <th>Nummer</th>
              <th>Tour</th>
              <th>EUP raus / rein</th>
              <th>Datum</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id}>
                <td><strong>{r.number}</strong></td>
                <td>{r.tourNumber || '—'}{r.vehiclePlate ? ` · ${r.vehiclePlate}` : ''}</td>
                <td>{r.eupOut} / {r.eupIn}</td>
                <td>{new Date(r.occurredAt).toLocaleString('de-AT')}</td>
                <td>
                  <button type="button" className="btn btn-secondary" onClick={() => void openPdf(r.id)}>
                    PDF
                  </button>
                </td>
              </tr>
            ))}
            {!rows.length && (
              <tr>
                <td colSpan={5} className="muted">Noch keine Scheine.</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </AppShell>
  );
}
