'use client';

import { FormEvent, useState } from 'react';
import Link from 'next/link';
import { BrandLogo } from '@/components/BrandLogo';
import { api, statusLabel } from '@/lib/api';

export default function TrackPage() {
  const [tn, setTn] = useState('');
  const [pin, setPin] = useState('');
  const [result, setResult] = useState<any>(null);
  const [error, setError] = useState('');

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError('');
    try {
      const q = new URLSearchParams({ tn: tn.trim(), pin: pin.trim() });
      const data = await api(`/tracking?${q.toString()}`, { auth: false });
      setResult(data);
    } catch (err: any) {
      setError(err.message);
      setResult(null);
    }
  }

  return (
    <div className="track-page">
      <div className="track-hero">
        <div className="track-hero-inner">
          <Link href="/" className="track-back">← Portal</Link>
          <div className="track-logo-wrap">
            <BrandLogo variant="full" />
          </div>
          <h1 className="brand-headline" style={{ marginTop: '0.85rem' }}>
            Track & Trace
          </h1>
          <p className="brand-sub">
            Sendungsstatus öffentlich abrufen – mit Sendungsnummer und PIN.
          </p>
        </div>
      </div>
      <div className="track-body">
        <form className="panel stack" onSubmit={onSubmit}>
          <div className="grid-2">
            <div className="field">
              <label>Sendungsnummer</label>
              <input
                value={tn}
                onChange={(e) => setTn(e.target.value)}
                required
                autoComplete="off"
              />
            </div>
            <div className="field">
              <label>PIN</label>
              <input
                value={pin}
                onChange={(e) => setPin(e.target.value)}
                required
                inputMode="numeric"
                autoComplete="off"
              />
            </div>
          </div>
          {error && <div className="error">{error}</div>}
          <button className="btn btn-primary" type="submit">Verfolgen</button>
        </form>
        {result && (
          <div className="panel" style={{ marginTop: '1rem' }}>
            <div className="row" style={{ justifyContent: 'space-between' }}>
              <strong>{result.trackingNumber}</strong>
              <span className="badge ok">{statusLabel(result.status)}</span>
            </div>
            <div className="muted">{result.mandant?.name} · {result.pickupCity} → {result.deliveryCity}</div>
            {result.eta?.etaAt || result.eta?.etaText ? (
              <div
                className="panel"
                style={{
                  marginTop: '1rem',
                  background: 'rgba(26,107,60,0.08)',
                  border: '1px solid rgba(26,107,60,0.25)',
                }}
              >
                <div className="muted">Erwartete Zustellung</div>
                <strong style={{ fontSize: '1.2rem' }}>
                  {result.eta.etaAt
                    ? new Date(result.eta.etaAt).toLocaleString('de-CH', {
                        timeZone: 'Europe/Zurich',
                        day: '2-digit',
                        month: '2-digit',
                        year: 'numeric',
                        hour: '2-digit',
                        minute: '2-digit',
                      })
                    : '—'}
                </strong>
                {result.eta.etaText ? (
                  <div className="muted" style={{ marginTop: '0.35rem' }}>
                    {result.eta.etaText}
                  </div>
                ) : null}
                {result.eta.tourNumber ? (
                  <div className="muted" style={{ fontSize: '0.8rem', marginTop: '0.25rem' }}>
                    Tour {result.eta.tourNumber}
                  </div>
                ) : null}
              </div>
            ) : null}
            <ul className="timeline" style={{ marginTop: '1.25rem' }}>
              {result.events?.map((e: any, idx: number) => (
                <li key={idx}>
                  <div><strong>{statusLabel(e.status)}</strong></div>
                  <div className="muted">{e.message}</div>
                  <div className="muted" style={{ fontSize: '0.8rem' }}>{new Date(e.createdAt).toLocaleString('de-AT')}</div>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </div>
  );
}
