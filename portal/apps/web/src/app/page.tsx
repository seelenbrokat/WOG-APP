'use client';

import Link from 'next/link';
import { FormEvent, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { api, getToken, setSession, SessionUser } from '@/lib/api';

export default function HomePage() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (getToken()) router.replace('/dashboard');
  }, [router]);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError('');
    try {
      const res = await api<{ accessToken: string; user: SessionUser }>('/auth/login', {
        method: 'POST',
        auth: false,
        body: JSON.stringify({ email, password }),
      });
      setSession(res.accessToken, res.user);
      router.push('/dashboard');
    } catch (err: any) {
      setError(err.message || 'Login fehlgeschlagen');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="hero">
      <section className="hero-brand">
        <p className="muted" style={{ color: 'rgba(255,255,255,0.65)', letterSpacing: '0.18em', textTransform: 'uppercase', fontSize: '0.8rem' }}>
          Kunden- & Partnerportal
        </p>
        <h1 className="brand-mark">WOG</h1>
        <p className="brand-sub">
          Sendungserfassung, Track & Trace und Dokumentenaustausch – die Drehscheibe für Kunden und Partner der WOG Logistics.
        </p>
        <div className="row" style={{ marginTop: '1.5rem' }}>
          <Link className="btn btn-primary" href="/track">
            Sendung verfolgen
          </Link>
        </div>
      </section>
      <section className="hero-panel">
        <form className="auth-card" onSubmit={onSubmit}>
          <h1>Anmelden</h1>
          <p>Zugang für Kunden, Disposition und Partner.</p>
          <div className="field">
            <label>E-Mail</label>
            <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
          </div>
          <div className="field">
            <label>Passwort</label>
            <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required />
          </div>
          {error && <div className="error">{error}</div>}
          <button className="btn btn-primary" disabled={loading} type="submit">
            {loading ? 'Anmeldung…' : 'Einloggen'}
          </button>
          <div className="row">
            <Link href="/register">Registrieren</Link>
            <Link href="/forgot-password">Passwort vergessen</Link>
          </div>
        </form>
      </section>
    </div>
  );
}
