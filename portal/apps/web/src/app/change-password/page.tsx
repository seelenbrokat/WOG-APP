'use client';

import { FormEvent, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { AppShell } from '@/components/AppShell';
import { AuthLayout } from '@/components/AuthLayout';
import { api, getToken, getUser, setSession } from '@/lib/api';

export default function ChangePasswordPage() {
  const router = useRouter();
  const [ready, setReady] = useState(false);
  const [forced, setForced] = useState(false);
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');

  useEffect(() => {
    if (!getToken()) {
      router.replace('/');
      return;
    }
    const user = getUser();
    setForced(!!user?.mustChangePassword);
    setReady(true);
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

  const form = (
    <form className={forced ? 'auth-card' : 'panel stack'} onSubmit={onSubmit} style={forced ? undefined : { maxWidth: 480 }}>
      {forced ? <h1>Neues Passwort</h1> : <strong>Passwort ändern</strong>}
      <div className="field">
        <label>Aktuelles / Standardpasswort</label>
        <input
          type="password"
          required
          value={currentPassword}
          onChange={(e) => setCurrentPassword(e.target.value)}
        />
      </div>
      <div className="field">
        <label>Neues Passwort</label>
        <input
          type="password"
          minLength={8}
          required
          value={newPassword}
          onChange={(e) => setNewPassword(e.target.value)}
        />
      </div>
      <div className="field">
        <label>Neues Passwort bestätigen</label>
        <input
          type="password"
          minLength={8}
          required
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
        />
      </div>
      {error && <div className="error">{error}</div>}
      {message && <div className="success">{message}</div>}
      <button className="btn btn-primary" type="submit">
        Speichern
      </button>
    </form>
  );

  if (!ready) {
    return (
      <div className="main">
        <p className="muted">Portal wird geladen…</p>
      </div>
    );
  }

  if (forced) {
    return (
      <AuthLayout
        headline="Passwort ändern"
        sub="Beim ersten Login oder nach einem Admin-Reset müssen Sie ein eigenes Passwort setzen."
      >
        {form}
      </AuthLayout>
    );
  }

  return <AppShell title="Passwort ändern">{form}</AppShell>;
}
