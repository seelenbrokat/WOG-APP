'use client';

import { FormEvent, useEffect, useState } from 'react';
import { AppShell } from '@/components/AppShell';
import { api, getUser } from '@/lib/api';

export default function PartnersPage() {
  const user = getUser();
  const [partners, setPartners] = useState<any[]>([]);
  const [jobs, setJobs] = useState<any[]>([]);
  const [createdKey, setCreatedKey] = useState('');
  const [form, setForm] = useState({ name: '', code: '', sftpUsername: '' });

  async function load() {
    setPartners(await api('/partners'));
    setJobs(await api('/partners/jobs'));
  }

  useEffect(() => {
    load().catch(console.error);
  }, []);

  async function onCreate(e: FormEvent) {
    e.preventDefault();
    const res = await api<any>('/partners', { method: 'POST', body: JSON.stringify(form) });
    setCreatedKey(res.apiKey || '');
    setForm({ name: '', code: '', sftpUsername: '' });
    await load();
  }

  return (
    <AppShell title="Partner-Drehscheibe">
      <p className="muted">SFTP/FTP-Kanäle und API-Keys für Partnerschnittstellen. Inbound-Dateien landen unter data/sftp/inbound.</p>
      {user?.role === 'ORG_ADMIN' && (
        <form className="panel stack" style={{ margin: '1rem 0' }} onSubmit={onCreate}>
          <strong>Partner anlegen</strong>
          <div className="grid-3">
            <input required placeholder="Name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
            <input required placeholder="Code" value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value })} />
            <input placeholder="SFTP-User" value={form.sftpUsername} onChange={(e) => setForm({ ...form, sftpUsername: e.target.value })} />
          </div>
          <button className="btn btn-primary" type="submit">Anlegen</button>
          {createdKey && <div className="success">API-Key (nur einmal sichtbar): {createdKey}</div>}
        </form>
      )}
      <div className="grid-2">
        <div className="panel">
          <strong>Partner</strong>
          <table className="table">
            <thead>
              <tr><th>Code</th><th>Name</th><th>SFTP</th></tr>
            </thead>
            <tbody>
              {partners.map((p) => (
                <tr key={p.id}>
                  <td>{p.code}</td>
                  <td>{p.name}</td>
                  <td>{p.sftpUsername || '–'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="panel">
          <strong>Import-/Export-Jobs</strong>
          <table className="table">
            <thead>
              <tr><th>Datei</th><th>Partner</th><th>Status</th></tr>
            </thead>
            <tbody>
              {jobs.map((j) => (
                <tr key={j.id}>
                  <td>{j.fileName}</td>
                  <td>{j.partner?.code}</td>
                  <td><span className="badge">{j.status}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </AppShell>
  );
}
