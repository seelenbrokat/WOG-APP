'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { AppShell } from '@/components/AppShell';
import { api, getUser } from '@/lib/api';

type TourRow = {
  id: string;
  name: string;
  date: string;
  mandant: { code: string; name: string };
  _count: { shipments: number; notesList: number };
};

export default function LagerPage() {
  const user = getUser();
  const allowed =
    user?.role === 'ORG_ADMIN' ||
    user?.role === 'MANDANT_DISPATCHER' ||
    user?.role === 'WAREHOUSE_STAFF';
  const [tours, setTours] = useState<TourRow[]>([]);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!allowed) return;
    api<TourRow[]>('/warehouse/tours')
      .then(setTours)
      .catch((e) => setError(e.message));
  }, [allowed]);

  if (!allowed) {
    return (
      <AppShell title="Lager">
        <div className="panel">Kein Zugriff – nur für interne WOG-Mitarbeiter.</div>
      </AppShell>
    );
  }

  const today = new Date().toISOString().slice(0, 10);

  return (
    <AppShell title="Lager">
      <p className="muted" style={{ marginBottom: '1rem' }}>
        Touren der letzten 10 Werktage inkl. heute sowie 2 Werktage in die Zukunft.
        Tour öffnen, Sendungen einsehen, Fotos und Kommentare hinterlassen.
      </p>
      {error && <div className="error">{error}</div>}
      <div className="panel">
        <table className="table">
          <thead>
            <tr>
              <th>Datum</th>
              <th>Tour</th>
              <th>Mandant</th>
              <th>Sendungen</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {tours.map((t) => {
              const d = t.date.slice(0, 10);
              const isToday = d === today;
              return (
                <tr key={t.id} style={isToday ? { background: 'rgba(0,0,0,0.03)' } : undefined}>
                  <td>
                    {new Date(d + 'T12:00:00').toLocaleDateString('de-AT', {
                      weekday: 'short',
                      day: '2-digit',
                      month: '2-digit',
                      year: 'numeric',
                    })}
                    {isToday && <span className="badge" style={{ marginLeft: 8 }}>heute</span>}
                  </td>
                  <td><strong>{t.name}</strong></td>
                  <td>{t.mandant?.name}</td>
                  <td>{t._count?.shipments ?? 0}</td>
                  <td>
                    <Link className="btn btn-secondary" href={`/lager/${t.id}`}>
                      Öffnen
                    </Link>
                  </td>
                </tr>
              );
            })}
            {!tours.length && !error && (
              <tr><td colSpan={5} className="muted">Keine Touren im Zeitraum.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </AppShell>
  );
}
