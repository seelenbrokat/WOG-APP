'use client';

import { FormEvent, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { AuthLayout } from '@/components/AuthLayout';
import { api, getToken, getUser, setSession } from '@/lib/api';

export default function ChangePasswordPage() {
  const router = useRouter();
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');

  useEffect(() => {
    if (!getToken()) router.replace('/');
  }, [router]);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError('');
    setMessage('');
    if (newPassword !== confirm) {
      setError('Passwörter stimmen nicht überein');
      return;
    }
    try {
      await api('/auth/change-password', {
        method: 'POST',
        body: JSON.stringify({ currentPassword, newPassword }),
      });
      const user = getUser();
      if (user) {
        setSession(getToken()!, { ...user, mustChangePassword: false });
      }
      setMessage('Passwort geändert.');
      setTimeout(() => router.push('/dashboard'), 800);
    } catch (err: any) {
      setError(err.message);
    }
  }

  return (
    <AuthLayout
      headline="Passwort ändern"
      sub="Beim ersten Login oder nach einem Admin-Reset müssen Sie ein eigenes Passwort setzen."
    >
      <form className="auth-card" onSubmit={onSubmit}>
        <h1>Neues Passwort</h1>
        <div className="field">
          <label>Aktuelles / Standardpasswort</label>
          <input type="password" required value={currentPassword} onChange={(e) => setCurrentPassword(e.target.value)} />
        </div>
        <div className="field">
          <label>Neues Passwort</label>
          <input type="password" minLength={8} required value={newPassword} onChange={(e) => setNewPassword(e.target.value)} />
        </div>
        <div className="field">
          <label>Neues Passwort bestätigen</label>
          <input type="password" minLength={8} required value={confirm} onChange={(e) => setConfirm(e.target.value)} />
        </div>
        {error && <div className="error">{error}</div>}
        {message && <div className="success">{message}</div>}
        <button className="btn btn-primary" type="submit">Speichern</button>
      </form>
    </AuthLayout>
  );
}
