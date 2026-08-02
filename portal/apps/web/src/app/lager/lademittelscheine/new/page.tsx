'use client';

import { FormEvent, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { AppShell } from '@/components/AppShell';
import { api } from '@/lib/api';

type TourRow = {
  id: string;
  tourNumber: string;
  driverName?: string | null;
  driverFirstName?: string | null;
  driverLastName?: string | null;
  vehicle?: { licensePlate?: string | null; number?: string | null } | null;
  stops?: Array<{ name?: string | null; city?: string | null }>;
};

export default function NewLademittelscheinPage() {
  const router = useRouter();
  const [tours, setTours] = useState<TourRow[]>([]);
  const [tourId, setTourId] = useState('');
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api<TourRow[]>(`/tours?date=${date}`)
      .then(setTours)
      .catch((e: any) => setError(e?.message || 'Touren laden fehlgeschlagen'));
  }, [date]);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (!tourId) {
      setError('Bitte Tour wählen');
      return;
    }
    setBusy(true);
    setError('');
    try {
      const row = await api<{ id: string }>('/lager/lademittelscheine/from-tour', {
        method: 'POST',
        body: JSON.stringify({ tourId }),
      });
      router.replace(`/lager/lademittelscheine/${row.id}`);
    } catch (err: any) {
      setError(err?.message || 'Anlegen fehlgeschlagen');
      setBusy(false);
    }
  }

  return (
    <AppShell title="Neuer Lademittelschein" eyebrow="Lager · Tablet">
      <form className="panel stack lager-tablet" onSubmit={onSubmit}>
        <p className="muted" style={{ margin: 0 }}>
          Tour aus Soloplan wählen – Kopfdaten (Partner, LKW, Fahrer) werden übernommen.
          Mengen und Unterschriften folgen auf dem nächsten Bildschirm.
        </p>
        <div className="field">
          <label>Datum</label>
          <input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        </div>
        <div className="field">
          <label>Tour</label>
          <select
            required
            value={tourId}
            onChange={(e) => setTourId(e.target.value)}
            style={{ fontSize: '1.05rem', minHeight: '3rem' }}
          >
            <option value="">– Tour wählen –</option>
            {tours.map((t) => {
              const driver =
                [t.driverFirstName, t.driverLastName].filter(Boolean).join(' ') ||
                t.driverName ||
                '';
              const plate = t.vehicle?.licensePlate || t.vehicle?.number || '';
              const partner = t.stops?.[0]?.name || t.stops?.[0]?.city || '';
              return (
                <option key={t.id} value={t.id}>
                  {t.tourNumber}
                  {plate ? ` · ${plate}` : ''}
                  {driver ? ` · ${driver}` : ''}
                  {partner ? ` · ${partner}` : ''}
                </option>
              );
            })}
          </select>
        </div>
        {error && <div className="error">{error}</div>}
        <button className="btn btn-primary" type="submit" disabled={busy} style={{ minHeight: '3rem' }}>
          {busy ? 'Anlegen…' : 'Schein starten'}
        </button>
      </form>
    </AppShell>
  );
}
