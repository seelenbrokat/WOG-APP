'use client';

import { FormEvent, useEffect, useMemo, useState } from 'react';
import { AppShell } from '@/components/AppShell';
import { ApiError, api, getUser } from '@/lib/api';
import { DocumentsModulePanel } from './DocumentsModulePanel';
import { SftpInboundPanel } from './SftpInboundPanel';

type ContactFeedback = { type: 'ok' | 'err'; text: string };

export default function CustomersPage() {
  const user = getUser();
  const [customers, setCustomers] = useState<any[]>([]);
  const [portalUsers, setPortalUsers] = useState<any[]>([]);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [kind, setKind] = useState<'CUSTOMER' | 'PARTNER'>('CUSTOMER');
  const [busyContactId, setBusyContactId] = useState<string | null>(null);
  const [contactFeedback, setContactFeedback] = useState<Record<string, ContactFeedback>>({});
  const canEdit = user?.role === 'ORG_ADMIN' || user?.role === 'MANDANT_DISPATCHER';
  const isAdmin = user?.role === 'ORG_ADMIN';

  const usersByEmail = useMemo(() => {
    const map = new Map<string, any>();
    for (const u of portalUsers) {
      if (u.email) map.set(String(u.email).toLowerCase(), u);
    }
    return map;
  }, [portalUsers]);

  async function load() {
    const [cust, users] = await Promise.all([
      api<any[]>('/customers'),
      isAdmin ? api<any[]>('/users').catch(() => []) : Promise.resolve([]),
    ]);
    setCustomers(cust);
    setPortalUsers(users);
  }

  useEffect(() => {
    load().catch(console.error);
  }, []);

  async function onImportFile(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError('');
    setMessage('');
    const form = e.currentTarget;
    const fileInput = form.elements.namedItem('file') as HTMLInputElement;
    const file = fileInput.files?.[0];
    if (!file) {
      setError('Bitte PORTALGP BusinessPartner-JSON wählen');
      return;
    }
    const fd = new FormData();
    fd.append('file', file);
    fd.append('kind', kind);
    try {
      const res = await api<any>('/integrations/soloplan/business-partners/import-file', {
        method: 'POST',
        body: fd,
      });
      setMessage(`${res.imported} BusinessPartner importiert`);
      form.reset();
      await load();
    } catch (err: any) {
      setError(err.message);
    }
  }

  function setFeedback(contactId: string, fb: ContactFeedback) {
    setContactFeedback((prev) => ({ ...prev, [contactId]: fb }));
  }

  async function inviteContact(contactId: string) {
    setError('');
    setMessage('');
    setBusyContactId(contactId);
    setFeedback(contactId, { type: 'ok', text: 'Wird angelegt…' });
    try {
      const res = await api<any>('/users/invite-from-contact', {
        method: 'POST',
        body: JSON.stringify({ contactId, role: 'CUSTOMER_USER' }),
      });
      const pwd = res.temporaryPassword ? ` · Passwort: ${res.temporaryPassword}` : '';
      const text = `User angelegt: ${res.email}${pwd}`;
      setFeedback(contactId, { type: 'ok', text });
      setMessage(text);
      await load();
    } catch (err: any) {
      if (err instanceof ApiError && err.status === 409 && err.body?.existingUserId) {
        const text = `${err.message}. Passwort kann zurückgesetzt werden.`;
        setFeedback(contactId, { type: 'err', text });
        setError(text);
        await load();
      } else {
        const text = err?.message || 'Anlegen fehlgeschlagen';
        setFeedback(contactId, { type: 'err', text });
        setError(text);
      }
    } finally {
      setBusyContactId(null);
    }
  }

  async function resetContactUser(contactId: string, userId: string, email: string) {
    setBusyContactId(contactId);
    setFeedback(contactId, { type: 'ok', text: 'Passwort wird zurückgesetzt…' });
    try {
      const res = await api<any>(`/users/${userId}/reset-password`, { method: 'POST' });
      const pwd = res.temporaryPassword ? ` · Passwort: ${res.temporaryPassword}` : '';
      const text = `Passwort für ${email} zurückgesetzt${pwd}`;
      setFeedback(contactId, { type: 'ok', text });
      setMessage(text);
      await load();
    } catch (err: any) {
      const text = err?.message || 'Zurücksetzen fehlgeschlagen';
      setFeedback(contactId, { type: 'err', text });
      setError(text);
    } finally {
      setBusyContactId(null);
    }
  }

  return (
    <AppShell title="Kundenverwaltung">
      <p className="muted" style={{ marginBottom: '1rem' }}>
        Externe Kunden werden über Soloplan als BusinessPartner angelegt. Die BusinessPartnerId
        ist für spätere Aufträge erforderlich. Ansprechpartner-E-Mails aus Soloplan können als Portal-User freigeschaltet werden.
      </p>

      {isAdmin && (
        <form className="panel stack" style={{ marginBottom: '1rem' }} onSubmit={onImportFile}>
          <strong>Soloplan BusinessPartner importieren</strong>
          <p className="muted" style={{ margin: 0 }}>
            Soloplan-JSON: <code>PORTALGP.v1-BusinessPartner_….json</code> oder Tour-Export
            (darin enthaltene BusinessPartner werden automatisch erkannt).
          </p>
          <div className="row">
            <select value={kind} onChange={(e) => setKind(e.target.value as 'CUSTOMER' | 'PARTNER')}>
              <option value="CUSTOMER">Als Kunde</option>
              <option value="PARTNER">Als Partner</option>
            </select>
            <input name="file" type="file" accept="application/json,.json" required />
            <button className="btn btn-primary" type="submit">Importieren</button>
          </div>
        </form>
      )}

      {message && <div className="success" style={{ marginBottom: '1rem' }}>{message}</div>}
      {error && <div className="error" style={{ marginBottom: '1rem' }}>{error}</div>}

      {!canEdit && <p className="muted">Nur Lesezugriff</p>}

      <div className="panel stack">
        {customers.map((c) => (
          <div key={c.id} style={{ borderBottom: '1px solid var(--line)', paddingBottom: '1rem' }}>
            <div className="row" style={{ justifyContent: 'space-between' }}>
              <div>
                <strong>{c.name}</strong>
                <div className="muted">
                  Nr. {c.customerNumber}
                  {c.matchcode ? ` · Matchcode ${c.matchcode}` : ''}
                  {c.soloplanBusinessPartnerId
                    ? ` · BP-ID ${c.soloplanBusinessPartnerId}`
                    : ' · ohne Soloplan-BP'}
                </div>
              </div>
              <div className="row" style={{ gap: '0.4rem' }}>
                {c.documentsModuleEnabled ? (
                  <span className="badge ok">Dokumente</span>
                ) : null}
                {c.sftpInboundEnabled ? (
                  <span className="badge ok">SFTP</span>
                ) : null}
                <span className="badge">{c._count?.addresses ?? c.addresses?.length ?? 0} Adressen</span>
              </div>
            </div>
            {canEdit && (
              <DocumentsModulePanel
                customerId={c.id}
                initialEnabled={Boolean(c.documentsModuleEnabled)}
              />
            )}
            {isAdmin && (
              <SftpInboundPanel
                customerId={c.id}
                initialEnabled={Boolean(c.sftpInboundEnabled)}
              />
            )}
            {(c.contacts?.length || 0) > 0 && (
              <table className="table" style={{ marginTop: '0.75rem' }}>
                <thead>
                  <tr>
                    <th>Ansprechpartner</th>
                    <th>E-Mail</th>
                    <th>Telefon</th>
                    <th>Portal</th>
                  </tr>
                </thead>
                <tbody>
                  {c.contacts.map((ct: any) => {
                    const existing = ct.email
                      ? usersByEmail.get(String(ct.email).toLowerCase())
                      : null;
                    const fb = contactFeedback[ct.id];
                    const busy = busyContactId === ct.id;
                    return (
                      <tr key={ct.id}>
                        <td>{ct.name}{ct.department ? ` (${ct.department})` : ''}</td>
                        <td>{ct.email || '–'}</td>
                        <td>{ct.phone || '–'}</td>
                        <td>
                          <div className="stack" style={{ gap: '0.35rem', alignItems: 'flex-start' }}>
                            {isAdmin && ct.email && !existing && (
                              <button
                                className="btn btn-secondary"
                                type="button"
                                disabled={busy}
                                onClick={() => inviteContact(ct.id)}
                              >
                                {busy ? 'Bitte warten…' : 'User anlegen'}
                              </button>
                            )}
                            {isAdmin && ct.email && existing && (
                              <>
                                <span className="badge ok">User vorhanden</span>
                                <button
                                  className="btn btn-secondary"
                                  type="button"
                                  disabled={busy}
                                  onClick={() => resetContactUser(ct.id, existing.id, existing.email)}
                                >
                                  {busy ? 'Bitte warten…' : 'Passwort zurücksetzen'}
                                </button>
                              </>
                            )}
                            {fb ? (
                              <div
                                className={fb.type === 'ok' ? 'success' : 'error'}
                                style={{ fontSize: '0.85rem', maxWidth: 280 }}
                              >
                                {fb.text}
                              </div>
                            ) : null}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>
        ))}
      </div>
    </AppShell>
  );
}
