'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { AppShell } from '@/components/AppShell';
import { api } from '@/lib/api';

const ROLE_LABEL: Record<string, string> = {
  ORG_ADMIN: 'Administrator',
  MANDANT_DISPATCHER: 'Disposition',
  CUSTOMER_USER: 'Kunde',
  PARTNER: 'Partner',
};

const EVENTS: Array<{ key: string; label: string }> = [
  { key: 'SHIPMENT_CREATED', label: 'Sendung erstellt' },
  { key: 'STATUS_CHANGED', label: 'Status geändert' },
  { key: 'POD_AVAILABLE', label: 'Ablieferbeleg (POD) verfügbar' },
  { key: 'DOCUMENT_RECEIVED', label: 'Dokument eingegangen' },
  { key: 'PARTNER_FILE_IMPORTED', label: 'Partnerdatei importiert' },
];

export default function SettingsPage() {
  const [me, setMe] = useState<any>(null);
  const [org, setOrg] = useState<any>(null);
  const [soloplan, setSoloplan] = useState<any>(null);
  const [prefs, setPrefs] = useState<Record<string, boolean>>({});
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    api('/auth/me').then((u: any) => {
      setMe(u);
      const map: Record<string, boolean> = {};
      for (const p of u.notificationPrefs || []) map[p.event] = p.email;
      for (const e of EVENTS) if (map[e.key] === undefined) map[e.key] = true;
      setPrefs(map);
    });
    api('/organizations/me').then(setOrg).catch(() => null);
    api('/integrations/soloplan/status').then(setSoloplan).catch(() => null);
  }, []);

  const isCustomer = me?.role === 'CUSTOMER_USER';

  return (
    <AppShell title="Einstellungen">
      <div className="grid-2">
        <div className="panel stack">
          <strong>Profil</strong>
          {me && (
            <>
              <div>
                {me.firstName} {me.lastName}
              </div>
              <div className="muted">{me.email}</div>
              <div className="muted">{ROLE_LABEL[me.role] || me.role}</div>
            </>
          )}
          {org && (
            <>
              <strong style={{ marginTop: '1rem' }}>Organisation</strong>
              <div>{org.name}</div>
            </>
          )}
          {!isCustomer && soloplan && (
            <>
              <strong style={{ marginTop: '1rem' }}>Soloplan</strong>
              <div className="muted">
                Modus: {soloplan.mode} · {soloplan.enabled ? 'aktiv' : 'nicht aktiv'}
              </div>
            </>
          )}
          <div style={{ marginTop: '1rem' }}>
            <Link className="btn btn-ghost" href="/change-password">
              Passwort ändern
            </Link>
          </div>
        </div>
        <div className="panel stack">
          <strong>E-Mail-Benachrichtigungen</strong>
          <p className="muted" style={{ margin: 0 }}>
            Wählen Sie, zu welchen Ereignissen Sie eine E-Mail erhalten möchten.
          </p>
          {EVENTS.map((event) => (
            <label key={event.key} className="row">
              <input
                type="checkbox"
                checked={!!prefs[event.key]}
                onChange={(e) => setPrefs({ ...prefs, [event.key]: e.target.checked })}
              />
              {event.label}
            </label>
          ))}
          <button
            className="btn btn-primary"
            onClick={async () => {
              await api('/users/me/notification-prefs', {
                method: 'PATCH',
                body: JSON.stringify({
                  prefs: EVENTS.map((event) => ({ event: event.key, email: !!prefs[event.key] })),
                }),
              });
              setSaved(true);
              window.setTimeout(() => setSaved(false), 2000);
            }}
          >
            Speichern
          </button>
          {saved ? <div className="success">Einstellungen gespeichert.</div> : null}
        </div>
      </div>
    </AppShell>
  );
}
