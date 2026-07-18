'use client';

import { FormEvent, useState } from 'react';
import Link from 'next/link';
import { BrandLogo } from '@/components/BrandLogo';
import { api, statusLabel } from '@/lib/api';

export default function TrackPage() {
  const [tn, setTn] = useState('WOGDEMO0001');
  const [pin, setPin] = useState('');
  const [result, setResult] = useState<any>(null);
  const [error, setError] = useState('');

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError('');
    try {
      const q = new URLSearchParams({ tn });
      if (pin) q.set('pin', pin);
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
          <BrandLogo variant="full" className="brand-logo track-logo" />
          <p className="brand-sub" style={{ marginTop: '0.5rem' }}>
            Öffentliches Track & Trace für Ihre WOG-Sendung.
          </p>
        </div>
      </div>
      <div className="track-body">
        <form className="panel stack" onSubmit={onSubmit}>
          <div className="grid-2">
            <div className="field">
              <label>Sendungsnummer</label>
              <input value={tn} onChange={(e) => setTn(e.target.value)} required />
            </div>
            <div className="field">
              <label>PIN (optional)</label>
              <input value={pin} onChange={(e) => setPin(e.target.value)} />
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
