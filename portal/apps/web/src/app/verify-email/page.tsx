'use client';

import { FormEvent, useState, Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { AuthLayout } from '@/components/AuthLayout';
import { api } from '@/lib/api';

function VerifyInner() {
  const params = useSearchParams();
  const [token, setToken] = useState(params.get('token') || '');
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    try {
      const res = await api<{ message: string }>('/auth/verify-email', {
        method: 'POST',
        auth: false,
        body: JSON.stringify({ token }),
      });
      setMessage(res.message);
      setError('');
    } catch (err: any) {
      setError(err.message);
    }
  }

  return (
    <form className="auth-card" onSubmit={onSubmit}>
      <h1>E-Mail bestätigen</h1>
      <div className="field">
        <label>Token</label>
        <input value={token} onChange={(e) => setToken(e.target.value)} required />
      </div>
      {error && <div className="error">{error}</div>}
      {message && <div className="success">{message}</div>}
      <button className="btn btn-primary" type="submit">Bestätigen</button>
      <Link href="/">Zum Login</Link>
    </form>
  );
}

export default function VerifyPage() {
  return (
    <AuthLayout
      headline="E-Mail verifizieren"
      sub="Bestätigen Sie Ihre Adresse, um das WOG-Portal freizuschalten."
    >
      <Suspense>
        <VerifyInner />
      </Suspense>
    </AuthLayout>
  );
}
