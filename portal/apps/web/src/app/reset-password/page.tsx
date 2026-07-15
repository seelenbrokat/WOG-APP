'use client';

import { FormEvent, useState, Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { api } from '@/lib/api';

function ResetInner() {
  const params = useSearchParams();
  const [token, setToken] = useState(params.get('token') || '');
  const [password, setPassword] = useState('');
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    try {
      const res = await api<{ message: string }>('/auth/reset-password', {
        method: 'POST',
        auth: false,
        body: JSON.stringify({ token, password }),
      });
      setMessage(res.message);
      setError('');
    } catch (err: any) {
      setError(err.message);
    }
  }

  return (
    <form className="auth-card" onSubmit={onSubmit}>
      <h1>Passwort setzen</h1>
      <div className="field">
        <label>Token</label>
        <input value={token} onChange={(e) => setToken(e.target.value)} required />
      </div>
      <div className="field">
        <label>Neues Passwort</label>
        <input type="password" minLength={8} value={password} onChange={(e) => setPassword(e.target.value)} required />
      </div>
      {error && <div className="error">{error}</div>}
      {message && <div className="success">{message}</div>}
      <button className="btn btn-primary" type="submit">Speichern</button>
      <Link href="/">Zum Login</Link>
    </form>
  );
}

export default function ResetPasswordPage() {
  return (
    <div className="hero">
      <section className="hero-brand">
        <h1 className="brand-mark">WOG</h1>
      </section>
      <section className="hero-panel">
        <Suspense>
          <ResetInner />
        </Suspense>
      </section>
    </div>
  );
}
