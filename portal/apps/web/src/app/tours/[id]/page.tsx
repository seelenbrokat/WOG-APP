'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import { AppShell } from '@/components/AppShell';
import { api, getToken } from '@/lib/api';

type TourDetail = {
  id: string;
  tourNumber: string;
  status: string;
  telematicsStatus: string | null;
  lastStatusAt: string | null;
  lastLatitude: number | null;
  lastLongitude: number | null;
  lastAction: string | null;
  caption: string | null;
  infoText: string | null;
  driverName: string | null;
  dispatcherName: string | null;
  targetStart: string | null;
  targetEnd: string | null;
  targetLoadKm: number | null;
  etaAt: string | null;
  etaText: string | null;
  etaUpdatedAt: string | null;
  etaSource: string | null;
  lastSendDate: string | null;
  lastFileName: string | null;
  vehicle: {
    id: string;
    number: string | null;
    licensePlate: string | null;
    matchcode: string | null;
    lastLatitude?: number | null;
    lastLongitude?: number | null;
    lastLocationAt?: string | null;
  } | null;
  stops: Array<{
    id: string;
    sequence: number;
    stopType: string | null;
    transportOrderNumber: string | null;
    name: string | null;
    street: string | null;
    zip: string | null;
    city: string | null;
    country: string | null;
    targetStart: string | null;
    targetEnd: string | null;
    activityDescription: string | null;
  }>;
  consignments: Array<{
    id: string;
    soloplanOrderNumber: string;
    externalConsignmentNumber: string | null;
    senderName: string | null;
    senderBpNumber: string | null;
    receiverName: string | null;
    status: string | null;
    statusText: string | null;
    lastStatusAt: string | null;
  }>;
  events: Array<{
    id: string;
    kind: string;
    status: string | null;
    statusText: string | null;
    transportOrderNumber: string | null;
    eventAt: string | null;
  }>;
  documents: Array<{
    id: string;
    fileName: string;
    mimeType: string;
    sizeBytes: number;
    transportOrderNumber: string | null;
    createdAt: string;
  }>;
};

const TOUR_STATUS: Record<string, string> = {
  PLANNED: 'Geplant',
  ACTIVE: 'Aktiv',
  COMPLETED: 'Abgeschlossen',
  CANCELLED: 'Storniert',
};

const TO_STATUS: Record<string, string> = {
  LoadingStart: 'Beladung Start',
  LoadingFinished: 'Beladung Ende',
  LoadingPlaceLeft: 'Beladestelle verlassen',
  UnloadingStart: 'Entladung Start',
  UnloadingFinished: 'Entladung Ende',
  UnloadingPlaceLeft: 'Entladestelle verlassen',
  Started: 'Gestartet',
  Finished: 'Beendet',
  Pending: 'An Gerät ausstehend',
  Sent: 'An Gerät gesendet',
  Arrived: 'Auf Gerät angekommen',
};

function fmt(value?: string | null) {
  if (!value) return '—';
  return new Date(value).toLocaleString('de-CH', {
    timeZone: 'Europe/Zurich',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function stopTypeLabel(t?: string | null) {
  if (!t) return '—';
  const lower = t.toLowerCase();
  if (lower.includes('load') || lower.includes('belad')) return 'Beladung';
  if (lower.includes('unload') || lower.includes('entlad')) return 'Entladung';
  return t;
}

function isSignatureDoc(fileName: string) {
  const n = fileName.toUpperCase();
  return (
    n.includes('UNTERSCHRI') ||
    n.includes('SIGNATURE') ||
    n.includes('UNTERSCHRIFT') ||
    n.includes('POD') ||
    n.includes('EMPFANG')
  );
}

/** Blob im neuen Tab öffnen (Safari: Object-URL nicht sofort revoke). */
function openBlobInNewTab(blob: Blob, fileName: string, mimeHint?: string) {
  const type =
    blob.type && blob.type !== 'application/octet-stream'
      ? blob.type
      : mimeHint ||
        (fileName.toLowerCase().endsWith('.pdf')
          ? 'application/pdf'
          : fileName.toLowerCase().match(/\.(png|jpe?g|gif|webp)$/)
            ? `image/${fileName.toLowerCase().endsWith('.jpg') || fileName.toLowerCase().endsWith('.jpeg') ? 'jpeg' : fileName.split('.').pop()}`
            : 'application/octet-stream');
  const typed = blob.type === type ? blob : new Blob([blob], { type });
  const url = URL.createObjectURL(typed);
  const opened = window.open(url, '_blank', 'noopener,noreferrer');
  if (!opened) {
    // Popup blockiert → Download als Fallback
    const a = document.createElement('a');
    a.href = url;
    a.download = fileName;
    a.rel = 'noopener';
    document.body.appendChild(a);
    a.click();
    a.remove();
  }
  window.setTimeout(() => URL.revokeObjectURL(url), 120_000);
}

async function openDocument(docId: string, fileName: string) {
  const res = await fetch(`${process.env.NEXT_PUBLIC_API_URL || '/api'}/tours/documents/${docId}/download`, {
    headers: { Authorization: `Bearer ${getToken()}` },
  });
  if (!res.ok) throw new Error('Download fehlgeschlagen');
  const blob = await res.blob();
  openBlobInNewTab(blob, fileName, res.headers.get('content-type') || undefined);
}

async function openZustellnachweis(docId: string) {
  const res = await fetch(
    `${process.env.NEXT_PUBLIC_API_URL || '/api'}/tours/documents/${docId}/zustellnachweis`,
    { headers: { Authorization: `Bearer ${getToken()}` } },
  );
  if (!res.ok) throw new Error('Zustellnachweis konnte nicht erzeugt werden');
  const blob = await res.blob();
  openBlobInNewTab(blob, 'Ablieferbeleg.pdf', 'application/pdf');
}

export default function TourDetailPage() {
  const params = useParams<{ id: string }>();
  const [tour, setTour] = useState<TourDetail | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!params.id) return;
    void api<TourDetail>(`/tours/${params.id}`)
      .then(setTour)
      .catch((e: any) => setError(e.message || 'Laden fehlgeschlagen'));
  }, [params.id]);

  if (error) {
    return (
      <AppShell title="Tour">
        <p>
          <Link href="/tours">← Touren</Link>
        </p>
        <div className="error">{error}</div>
      </AppShell>
    );
  }

  if (!tour) {
    return (
      <AppShell title="Tour">
        <p className="muted">Laden…</p>
      </AppShell>
    );
  }

  return (
    <AppShell title={`Tour ${tour.tourNumber}`}>
      <p style={{ marginBottom: '1rem' }}>
        <Link href="/tours">← Touren</Link>
        {' · '}
        <Link href="/tours/map">Kartenmonitor</Link>
      </p>

      <div className="grid-3" style={{ marginBottom: '1rem' }}>
        <div className="stat">
          <div className="label">Status</div>
          <div className="value" style={{ fontSize: '1.15rem' }}>
            {TOUR_STATUS[tour.status] || tour.status}
          </div>
          <div className="muted">
            Telematics: {tour.telematicsStatus || '—'}
            {tour.lastStatusAt ? ` · ${fmt(tour.lastStatusAt)}` : ''}
          </div>
        </div>
        <div className="stat">
          <div className="label">Fahrzeug</div>
          <div className="value" style={{ fontSize: '1.15rem' }}>
            {tour.vehicle?.licensePlate || tour.vehicle?.number || '—'}
          </div>
          <div className="muted">
            {tour.vehicle?.lastLatitude != null && tour.vehicle?.lastLongitude != null
              ? `${tour.vehicle.lastLatitude.toFixed(4)}, ${tour.vehicle.lastLongitude.toFixed(4)}`
              : [tour.vehicle?.number, tour.vehicle?.matchcode].filter(Boolean).join(' · ') || '—'}
          </div>
        </div>
        <div className="stat">
          <div className="label">Fahrer / Disponent</div>
          <div className="value" style={{ fontSize: '1.15rem' }}>
            {tour.driverName || '—'}
          </div>
          <div className="muted">{tour.dispatcherName || '—'}</div>
        </div>
      </div>

      <div className="panel" style={{ marginBottom: '1rem' }}>
        <div className="row" style={{ flexWrap: 'wrap', gap: '1.5rem' }}>
          <div>
            <div className="muted">Ziel-Start</div>
            <strong>{fmt(tour.targetStart)}</strong>
          </div>
          <div>
            <div className="muted">Ziel-Ende</div>
            <strong>{fmt(tour.targetEnd)}</strong>
          </div>
          <div>
            <div className="muted">Live-ETA Zustellung</div>
            <strong style={{ color: tour.etaAt ? 'var(--wog-green, #1a6b3c)' : undefined }}>
              {fmt(tour.etaAt)}
            </strong>
            {tour.etaText ? (
              <div className="muted" style={{ maxWidth: 360, marginTop: 4 }}>
                {tour.etaText}
              </div>
            ) : null}
            {tour.etaUpdatedAt ? (
              <div className="muted" style={{ fontSize: '0.8rem' }}>
                aktualisiert {fmt(tour.etaUpdatedAt)}
                {tour.etaSource ? ` · ${tour.etaSource}` : ''}
              </div>
            ) : null}
          </div>
          <div>
            <div className="muted">km (Soll)</div>
            <strong>{tour.targetLoadKm ?? '—'}</strong>
          </div>
          <div>
            <div className="muted">Plan-Import</div>
            <strong>{fmt(tour.lastSendDate)}</strong>
          </div>
        </div>
      </div>

      <h2 style={{ marginBottom: '0.5rem' }}>Stops ({tour.stops.length})</h2>
      <div className="panel" style={{ overflowX: 'auto', marginBottom: '1.25rem' }}>
        <table className="table">
          <thead>
            <tr>
              <th>#</th>
              <th>Art</th>
              <th>TO</th>
              <th>Adresse</th>
              <th>Ankunft</th>
              <th>Abfahrt</th>
            </tr>
          </thead>
          <tbody>
            {tour.stops.map((s) => (
              <tr key={s.id}>
                <td>{s.sequence}</td>
                <td>{stopTypeLabel(s.stopType)}</td>
                <td>
                  <code>{s.transportOrderNumber || '—'}</code>
                </td>
                <td>
                  <strong>{s.name || '—'}</strong>
                  <div className="muted">
                    {[s.street, [s.zip, s.city].filter(Boolean).join(' '), s.country]
                      .filter(Boolean)
                      .join(', ')}
                  </div>
                </td>
                <td style={{ whiteSpace: 'nowrap' }}>{fmt(s.targetStart)}</td>
                <td style={{ whiteSpace: 'nowrap' }}>{fmt(s.targetEnd)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <h2 style={{ marginBottom: '0.5rem' }}>Transportaufträge ({tour.consignments.length})</h2>
      <div className="panel" style={{ overflowX: 'auto', marginBottom: '1.25rem' }}>
        <table className="table">
          <thead>
            <tr>
              <th>TO-Nr.</th>
              <th>Status</th>
              <th>Ort</th>
              <th>Absender</th>
              <th>Empfänger</th>
            </tr>
          </thead>
          <tbody>
            {tour.consignments.map((c) => (
              <tr key={c.id}>
                <td>
                  <code>{c.soloplanOrderNumber}</code>
                </td>
                <td>
                  <span className="badge">{TO_STATUS[c.status || ''] || c.status || '—'}</span>
                  {c.lastStatusAt ? <div className="muted">{fmt(c.lastStatusAt)}</div> : null}
                </td>
                <td>{c.statusText || '—'}</td>
                <td>
                  {c.senderName || '—'}
                  {c.senderBpNumber ? <div className="muted">BP {c.senderBpNumber}</div> : null}
                </td>
                <td>{c.receiverName || '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <h2 style={{ marginBottom: '0.5rem' }}>Dokumente ({tour.documents?.length || 0})</h2>
      <div className="panel" style={{ overflowX: 'auto', marginBottom: '1.25rem' }}>
        <table className="table">
          <thead>
            <tr>
              <th>Datei</th>
              <th>TO</th>
              <th>Größe</th>
              <th>Empfangen</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {(tour.documents || []).length === 0 ? (
              <tr>
                <td colSpan={5} className="muted">
                  Keine Retour-Dokumente.
                </td>
              </tr>
            ) : (
              tour.documents.map((d) => (
                <tr key={d.id}>
                  <td>{d.fileName}</td>
                  <td>
                    <code>{d.transportOrderNumber || '—'}</code>
                  </td>
                  <td>{Math.round(d.sizeBytes / 1024)} KB</td>
                  <td>{fmt(d.createdAt)}</td>
                  <td style={{ whiteSpace: 'nowrap' }}>
                    <button
                      type="button"
                      className="btn btn-ghost"
                      onClick={() => void openDocument(d.id, d.fileName).catch((e) => alert(e.message))}
                    >
                      Öffnen
                    </button>
                    {isSignatureDoc(d.fileName) || d.mimeType.startsWith('image/') ? (
                      <button
                        type="button"
                        className="btn btn-ghost"
                        style={{ marginLeft: '0.35rem' }}
                        onClick={() => void openZustellnachweis(d.id).catch((e) => alert(e.message))}
                      >
                        Zustellnachweis
                      </button>
                    ) : null}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <h2 style={{ marginBottom: '0.5rem' }}>Statusmeldungen ({tour.events?.length || 0})</h2>
      <div className="panel" style={{ overflowX: 'auto' }}>
        <table className="table">
          <thead>
            <tr>
              <th>Zeit</th>
              <th>Art</th>
              <th>Status</th>
              <th>Detail</th>
              <th>TO</th>
            </tr>
          </thead>
          <tbody>
            {(tour.events || []).length === 0 ? (
              <tr>
                <td colSpan={5} className="muted">
                  Noch keine Telematics-Events für diese Tour.
                </td>
              </tr>
            ) : (
              tour.events.map((e) => (
                <tr key={e.id}>
                  <td style={{ whiteSpace: 'nowrap' }}>{fmt(e.eventAt)}</td>
                  <td>{e.kind}</td>
                  <td>{TO_STATUS[e.status || ''] || e.status || '—'}</td>
                  <td>{e.statusText || '—'}</td>
                  <td>
                    <code>{e.transportOrderNumber || '—'}</code>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </AppShell>
  );
}
