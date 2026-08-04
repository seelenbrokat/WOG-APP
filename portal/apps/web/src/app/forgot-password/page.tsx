'use client';

import { FormEvent, useState } from 'react';
import Link from 'next/link';
import { api } from '@/lib/api';

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState('');
  const [message, setMessage] = useState('');

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    const res = await api<{ message: string }>('/auth/forgot-password', {
      method: 'POST',
      auth: false,
      body: JSON.stringify({ email }),
    });
    setMessage(res.message);
  }

  return (
    <div className="hero">
      <section className="hero-brand">
        <h1 className="brand-mark">WOG</h1>
      </section>
      <section className="hero-panel">
        <form className="auth-card" onSubmit={onSubmit}>
          <h1>Passwort vergessen</h1>
          <div className="field">
            <label>E-Mail</label>
            <input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
          </div>
          {message && <div className="success">{message}</div>}
          <button className="btn btn-primary" type="submit">Link senden</button>
          <Link href="/">Zurück</Link>
        </form>
      </section>
    </div>
  );
}
