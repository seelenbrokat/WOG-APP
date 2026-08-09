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
  const [ezollPrefixesText, setEzollPrefixesText] = useState('131.\n671.');
  const [ezollDefaults, setEzollDefaults] = useState<string[]>(['131.', '671.']);
  const [ezollSaved, setEzollSaved] = useState(false);
  const [ezollBusy, setEzollBusy] = useState(false);
  const [ezollMsg, setEzollMsg] = useState('');
  const [ezollErr, setEzollErr] = useState('');

  useEffect(() => {
    api('/auth/me').then((u: any) => {
      setMe(u);
      const map: Record<string, boolean> = {};
      for (const p of u.notificationPrefs || []) map[p.event] = p.email;
      for (const e of EVENTS) if (map[e.key] === undefined) map[e.key] = true;
      setPrefs(map);
      if (u.role === 'ORG_ADMIN' || u.role === 'MANDANT_DISPATCHER') {
        api('/organizations/me/settings/ezoll-inbound')
          .then((cfg: any) => {
            const list = cfg?.filenameIgnorePrefixes || [];
            setEzollPrefixesText(list.join('\n'));
            if (cfg?.defaults?.length) setEzollDefaults(cfg.defaults);
          })
          .catch(() => null);
      }
    });
    api('/organizations/me').then(setOrg).catch(() => null);
    api('/integrations/soloplan/status').then(setSoloplan).catch(() => null);
  }, []);

  const isCustomer = me?.role === 'CUSTOMER_USER';
  const isAdmin = me?.role === 'ORG_ADMIN';
  const canSeeEzoll = isAdmin || me?.role === 'MANDANT_DISPATCHER';

  async function persistEzollConfig() {
    const prefixes = ezollPrefixesText
      .split(/[\n,;]+/)
      .map((s) => s.trim())
      .filter(Boolean);
    const cfg = await api<{ filenameIgnorePrefixes?: string[] }>(
      '/organizations/me/settings/ezoll-inbound',
      {
        method: 'PATCH',
        body: JSON.stringify({ filenameIgnorePrefixes: prefixes }),
      },
    );
    setEzollPrefixesText((cfg.filenameIgnorePrefixes || []).join('\n'));
    return cfg;
  }

  async function saveEzollConfig() {
    setEzollErr('');
    setEzollMsg('');
    setEzollBusy(true);
    try {
      await persistEzollConfig();
      setEzollSaved(true);
      window.setTimeout(() => setEzollSaved(false), 2000);
    } catch (e: any) {
      setEzollErr(e?.message || 'Speichern fehlgeschlagen');
    } finally {
      setEzollBusy(false);
    }
  }

  async function runEzollIgnoreNow() {
    setEzollErr('');
    setEzollMsg('');
    setEzollBusy(true);
    try {
      await persistEzollConfig();
      const result = await api<{ ignored?: number; pending?: number }>(
        '/customs/ezoll/process-inbound',
        { method: 'POST', body: '{}' },
      );
      setEzollMsg(
        `${result.ignored || 0} Datei(en) ignoriert, ${result.pending || 0} bleiben zur Analyse.`,
      );
    } catch (e: any) {
      setEzollErr(e?.message || 'Verarbeitung fehlgeschlagen');
    } finally {
      setEzollBusy(false);
    }
  }

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

      {canSeeEzoll && (
        <div className="panel stack" style={{ marginTop: '1.25rem' }}>
          <strong>eZoll-Dokumente – Ignore-Präfixe</strong>
          <p className="muted" style={{ margin: 0 }}>
            Dateien im SFTP-Drop <code>inbound/Ezoll-Dokumente/</code>, deren Name mit einem dieser
            Präfixe beginnt, werden nicht analysiert und nach{' '}
            <code>processed/ignored/</code> verschoben. Standard: {ezollDefaults.join(', ')}.
          </p>
          <label className="field">
            Präfixe (ein Eintrag pro Zeile)
            <textarea
              rows={5}
              value={ezollPrefixesText}
              onChange={(e) => setEzollPrefixesText(e.target.value)}
              disabled={!isAdmin || ezollBusy}
              placeholder={'131.\n671.'}
              style={{ fontFamily: 'ui-monospace, monospace' }}
            />
          </label>
          {isAdmin ? (
            <div className="row" style={{ gap: '0.75rem', flexWrap: 'wrap' }}>
              <button className="btn btn-primary" disabled={ezollBusy} onClick={saveEzollConfig}>
                Speichern
              </button>
              <button className="btn btn-ghost" disabled={ezollBusy} onClick={runEzollIgnoreNow}>
                Jetzt auf Drop anwenden
              </button>
              <button
                className="btn btn-ghost"
                type="button"
                disabled={ezollBusy}
                onClick={() => setEzollPrefixesText(ezollDefaults.join('\n'))}
              >
                Standard wiederherstellen
              </button>
            </div>
          ) : (
            <p className="muted" style={{ margin: 0 }}>
              Nur Administratoren können die Präfixe ändern.
            </p>
          )}
          {ezollSaved ? <div className="success">Ignore-Präfixe gespeichert.</div> : null}
          {ezollMsg ? <div className="success">{ezollMsg}</div> : null}
          {ezollErr ? <div className="error">{ezollErr}</div> : null}
        </div>
      )}
    </AppShell>
  );
}
