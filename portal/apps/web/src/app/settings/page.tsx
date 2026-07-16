'use client';

import { useEffect, useState } from 'react';
import { AppShell } from '@/components/AppShell';
import { api } from '@/lib/api';

const EVENTS = [
  'SHIPMENT_CREATED',
  'STATUS_CHANGED',
  'POD_AVAILABLE',
  'DOCUMENT_RECEIVED',
  'PARTNER_FILE_IMPORTED',
];

export default function SettingsPage() {
  const [me, setMe] = useState<any>(null);
  const [org, setOrg] = useState<any>(null);
  const [soloplan, setSoloplan] = useState<any>(null);
  const [prefs, setPrefs] = useState<Record<string, boolean>>({});

  useEffect(() => {
    api('/auth/me').then((u: any) => {
      setMe(u);
      const map: Record<string, boolean> = {};
      for (const p of u.notificationPrefs || []) map[p.event] = p.email;
      for (const e of EVENTS) if (map[e] === undefined) map[e] = true;
      setPrefs(map);
    });
    api('/organizations/me').then(setOrg).catch(() => null);
    api('/integrations/soloplan/status').then(setSoloplan).catch(() => null);
  }, []);

  return (
    <AppShell title="Einstellungen">
      <div className="grid-2">
        <div className="panel stack">
          <strong>Profil</strong>
          {me && (
            <>
              <div>{me.firstName} {me.lastName}</div>
              <div className="muted">{me.email}</div>
              <div className="muted">{me.role}</div>
            </>
          )}
          {org && (
            <>
              <strong style={{ marginTop: '1rem' }}>Organisation</strong>
              <div>{org.name}</div>
            </>
          )}
          {soloplan && (
            <>
              <strong style={{ marginTop: '1rem' }}>Soloplan</strong>
              <div className="muted">Modus: {soloplan.mode} · {soloplan.enabled ? 'aktiv' : 'Stub'}</div>
            </>
          )}
        </div>
        <div className="panel stack">
          <strong>E-Mail-Benachrichtigungen</strong>
          {EVENTS.map((event) => (
            <label key={event} className="row">
              <input
                type="checkbox"
                checked={!!prefs[event]}
                onChange={(e) => setPrefs({ ...prefs, [event]: e.target.checked })}
              />
              {event}
            </label>
          ))}
          <button
            className="btn btn-primary"
            onClick={async () => {
              await api('/users/me/notification-prefs', {
                method: 'PATCH',
                body: JSON.stringify({
                  prefs: EVENTS.map((event) => ({ event, email: !!prefs[event] })),
                }),
              });
            }}
          >
            Speichern
          </button>
        </div>
      </div>
    </AppShell>
  );
}
