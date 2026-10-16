'use client';

import Link from 'next/link';
import { FormEvent, useState } from 'react';
import { AuthLayout } from '@/components/AuthLayout';
import { api } from '@/lib/api';

export default function RegisterPage() {
  const [form, setForm] = useState({
    email: '',
    password: '',
    firstName: '',
    lastName: '',
    customerNumber: '',
  });
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError('');
    setMessage('');
    try {
      const res = await api<{ message: string }>('/auth/register', {
        method: 'POST',
        auth: false,
        body: JSON.stringify({
          ...form,
          customerNumber: form.customerNumber || undefined,
        }),
      });
      setMessage(res.message);
    } catch (err: any) {
      setError(err.message);
    }
  }

  return (
    <AuthLayout
      headline="Konto für Kunden anlegen"
      sub="Registrierung mit E-Mail-Bestätigung für Kunden der WOG AG und WOG GmbH."
    >
      <form className="auth-card" onSubmit={onSubmit}>
        <h1>Registrieren</h1>
        <div className="grid-2">
          <div className="field">
            <label>Vorname</label>
            <input required value={form.firstName} onChange={(e) => setForm({ ...form, firstName: e.target.value })} />
          </div>
          <div className="field">
            <label>Nachname</label>
            <input required value={form.lastName} onChange={(e) => setForm({ ...form, lastName: e.target.value })} />
          </div>
        </div>
        <div className="field">
          <label>E-Mail</label>
          <input type="email" required value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
        </div>
        <div className="field">
          <label>Passwort</label>
          <input type="password" minLength={8} required value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} />
        </div>
        <div className="field">
          <label>Kundennummer (optional)</label>
          <input value={form.customerNumber} onChange={(e) => setForm({ ...form, customerNumber: e.target.value })} placeholder="z.B. K-10001" />
        </div>
        {error && <div className="error">{error}</div>}
        {message && <div className="success">{message}</div>}
        <button className="btn btn-primary" type="submit">Konto anlegen</button>
        <Link href="/">Zurück zum Login</Link>
      </form>
    </AuthLayout>
  );
}
