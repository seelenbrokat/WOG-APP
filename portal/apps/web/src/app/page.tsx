'use client';

import Link from 'next/link';
import { FormEvent, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { AuthLayout } from '@/components/AuthLayout';
import { api, getToken, setSession, SessionUser } from '@/lib/api';

function safeRedirect(path?: string) {
  if (!path || !path.startsWith('/') || path.startsWith('//') || path.includes('://')) {
    return '/dashboard';
  }
  return path;
}

export default function HomePage() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [qrBusy, setQrBusy] = useState(false);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const emailParam = params.get('email');
    if (emailParam && emailParam.includes('@')) {
      setEmail(emailParam.trim());
    }
    const qr = params.get('qr');
    if (qr) {
      setQrBusy(true);
      setError('');
      void (async () => {
        try {
          const res = await api<{
            accessToken: string;
            user: SessionUser;
            mustChangePassword?: boolean;
            redirectPath?: string;
          }>('/auth/qr-login', {
            method: 'POST',
            auth: false,
            body: JSON.stringify({ token: qr }),
          });
          const user = {
            ...res.user,
            mustChangePassword: res.mustChangePassword ?? res.user.mustChangePassword,
          };
          setSession(res.accessToken, user);
          // QR-Token aus der URL entfernen
          window.history.replaceState({}, '', '/');
          router.replace(
            user.mustChangePassword ? '/change-password' : safeRedirect(res.redirectPath),
          );
        } catch (err: any) {
          setError(err.message || 'QR-Login fehlgeschlagen');
          setQrBusy(false);
          window.history.replaceState({}, '', '/');
        }
      })();
      return;
    }
    if (getToken()) router.replace('/dashboard');
  }, [router]);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError('');
    try {
      const res = await api<{ accessToken: string; user: SessionUser; mustChangePassword?: boolean }>('/auth/login', {
        method: 'POST',
        auth: false,
        body: JSON.stringify({ email, password }),
      });
      const user = {
        ...res.user,
        mustChangePassword: res.mustChangePassword ?? res.user.mustChangePassword,
      };
      setSession(res.accessToken, user);
      router.push(user.mustChangePassword ? '/change-password' : '/dashboard');
    } catch (err: any) {
      setError(err.message || 'Login fehlgeschlagen');
    } finally {
      setLoading(false);
    }
  }

  return (
    <AuthLayout
      showTrackCta
      headline="Grün. Global. Verbunden."
      sub="Sendungen erfassen, verfolgen und Dokumente austauschen – für Kunden und Partner von World of Green Logistics."
    >
      <form className="auth-card" onSubmit={onSubmit}>
        <h1>Anmelden</h1>
        <p>
          {qrBusy
            ? 'QR-Login wird ausgeführt…'
            : 'Zugang für Kunden, Disposition und Partner'}
        </p>
        <div className="field">
          <label>E-Mail</label>
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            disabled={qrBusy}
          />
        </div>
        <div className="field">
          <label>Passwort</label>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            disabled={qrBusy}
          />
        </div>
        {error && <div className="error">{error}</div>}
        <button className="btn btn-primary" disabled={loading || qrBusy} type="submit">
          {qrBusy ? 'QR-Login…' : loading ? 'Anmeldung…' : 'Einloggen'}
        </button>
        <div className="row">
          <Link href="/register">Registrieren</Link>
          <Link href="/forgot-password">Passwort vergessen</Link>
        </div>
      </form>
    </AuthLayout>
  );
}
