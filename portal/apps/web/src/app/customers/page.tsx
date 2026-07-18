'use client';

import { FormEvent, useEffect, useState } from 'react';
import { AppShell } from '@/components/AppShell';
import { api, getUser } from '@/lib/api';

export default function CustomersPage() {
  const user = getUser();
  const [customers, setCustomers] = useState<any[]>([]);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [kind, setKind] = useState<'CUSTOMER' | 'PARTNER'>('CUSTOMER');
  const canEdit = user?.role === 'ORG_ADMIN' || user?.role === 'MANDANT_DISPATCHER';
  const isAdmin = user?.role === 'ORG_ADMIN';

  async function load() {
    setCustomers(await api('/customers'));
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

  async function inviteContact(contactId: string) {
    setError('');
    setMessage('');
    try {
      const res = await api<any>('/users/invite-from-contact', {
        method: 'POST',
        body: JSON.stringify({ contactId, role: 'CUSTOMER_USER' }),
      });
      setMessage(`User angelegt: ${res.email} (Standardpasswort per E-Mail)`);
    } catch (err: any) {
      setError(err.message);
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
              <span className="badge">{c.addresses?.length || 0} Adressen</span>
            </div>
            {(c.contacts?.length || 0) > 0 && (
              <table className="table" style={{ marginTop: '0.75rem' }}>
                <thead>
                  <tr>
                    <th>Ansprechpartner</th>
                    <th>E-Mail</th>
                    <th>Telefon</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {c.contacts.map((ct: any) => (
                    <tr key={ct.id}>
                      <td>{ct.name}{ct.department ? ` (${ct.department})` : ''}</td>
                      <td>{ct.email || '–'}</td>
                      <td>{ct.phone || '–'}</td>
                      <td>
                        {isAdmin && ct.email && (
                          <button className="btn btn-secondary" type="button" onClick={() => inviteContact(ct.id)}>
                            User anlegen
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        ))}
      </div>
    </AppShell>
  );
}
