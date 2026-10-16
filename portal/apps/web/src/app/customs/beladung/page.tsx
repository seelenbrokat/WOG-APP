'use client';

import { FormEvent, useEffect, useMemo, useState } from 'react';
import {
  VORARLBERG_CH_GOODS_BORDERS,
  COUNTRIES,
  normalizeSmartBorderPlate,
  smartBorderPlateHint,
  type VorarlbergChGoodsBorder,
} from '@wog/shared';
import { AppShell } from '@/components/AppShell';
import { api, getUser } from '@/lib/api';
import { openBlankTabForAsyncWork, openDocumentInNewTab } from '@/lib/download';
import Link from 'next/link';

const BORDER_PRESETS: VorarlbergChGoodsBorder[] = [...VORARLBERG_CH_GOODS_BORDERS];
const BORDER_OTHER = '__other__';

type PendingOrder = {
  id: string;
  externalNumber?: string | null;
  soloplanRef?: string | null;
  absenderFirma: string;
  empfaengerFirma: string;
  packageCount?: number | null;
  weightKg?: number | null;
  goodsDescription?: string | null;
  createdAt: string;
  vehicleDeferred?: boolean;
  customer?: { id: string; name: string; customerNumber: string };
};

function soloplanLabel(ref?: string | null) {
  if (!ref) return null;
  if (ref.startsWith('FILE:') || ref.startsWith('SP-STUB-')) return null;
  return ref;
}

export default function CustomsBeladungPage() {
  const user = getUser();
  const isStaff = user?.role === 'ORG_ADMIN' || user?.role === 'MANDANT_DISPATCHER';
  const [pending, setPending] = useState<PendingOrder[]>([]);
  const [selected, setSelected] = useState<Record<string, boolean>>({});
  const [error, setError] = useState('');
  const [info, setInfo] = useState('');
  const [busy, setBusy] = useState(false);
  const [borderPreset, setBorderPreset] = useState<string>(BORDER_PRESETS[0]);
  const [borderCustom, setBorderCustom] = useState('');
  const [form, setForm] = useState({
    kennzeichen: '',
    zulassungsland: 'AT',
    kennzeichenAnhaenger: '',
    zulassungslandAnhaenger: 'AT',
    zeit: '',
    notes: '',
  });

  const grenzuebergang =
    borderPreset === BORDER_OTHER ? borderCustom.trim() : borderPreset;

  const selectedIds = useMemo(
    () => Object.entries(selected).filter(([, v]) => v).map(([id]) => id),
    [selected],
  );

  async function load() {
    const list = await api<PendingOrder[]>('/customs/loading/pending');
    setPending(list);
    setSelected({});
  }

  useEffect(() => {
    const now = new Date();
    now.setMinutes(now.getMinutes() - now.getTimezoneOffset());
    setForm((f) => ({ ...f, zeit: now.toISOString().slice(0, 16) }));
    load().catch((e) => setError(e.message || 'Laden fehlgeschlagen'));
  }, []);

  function toggle(id: string) {
    setSelected((prev) => ({ ...prev, [id]: !prev[id] }));
  }

  function toggleAll(on: boolean) {
    const next: Record<string, boolean> = {};
    for (const o of pending) next[o.id] = on;
    setSelected(next);
  }

  async function onRelease(e: FormEvent) {
    e.preventDefault();
    setError('');
    setInfo('');
    if (!selectedIds.length) {
      setError('Bitte mindestens eine Sendung auswählen');
      return;
    }
    if (!grenzuebergang) {
      setError('Grenzübergang bitte angeben');
      return;
    }
    setBusy(true);
    const win = openBlankTabForAsyncWork();
    try {
      const kennzeichen = normalizeSmartBorderPlate(form.kennzeichen, form.zulassungsland);
      const res = await api<any>('/customs/loading/release', {
        method: 'POST',
        body: JSON.stringify({
          orderIds: selectedIds,
          kennzeichen,
          zulassungsland: form.zulassungsland,
          kennzeichenAnhaenger: form.kennzeichenAnhaenger.trim() || undefined,
          zulassungslandAnhaenger: form.kennzeichenAnhaenger.trim()
            ? form.zulassungslandAnhaenger
            : undefined,
          grenzuebergang,
          zeit: new Date(form.zeit).toISOString(),
          notes: form.notes.trim() || undefined,
        }),
      });
      if (res.document?.id) {
        await openDocumentInNewTab(res.document.id, res.document.fileName, { targetWin: win });
      } else {
        try {
          win?.close();
        } catch {
          /* ignore */
        }
      }
      setInfo(
        `Beladung freigegeben: ${res.orderCount} Sendung(en), LKW ${res.kennzeichen}. ` +
          `Ankunftsaviso an ${res.avisoTo}. Soloplan aktualisiert.`,
      );
      setForm((f) => ({ ...f, kennzeichen: '', kennzeichenAnhaenger: '', notes: '' }));
      await load();
    } catch (err: any) {
      try {
        win?.close();
      } catch {
        /* ignore */
      }
      setError(err?.message || 'Freigabe fehlgeschlagen');
    } finally {
      setBusy(false);
    }
  }

  return (
    <AppShell title="Beladung Verzollung">
      <p className="muted" style={{ marginBottom: '1rem' }}>
        Selbstfahrer (z. B. ERVO): Sendungen zuerst erfassen und nach Soloplan schicken.
        Hier per Checkbox auswählen, welche definitiv geladen werden – erst dann Kennzeichen,
        Grenze und Ladeliste. Keine Dispo durch WOG. Aviso geht an zoll@worldofgreen.at.
        {' '}
        <Link href="/customs">Zurück zur Erfassung</Link>
      </p>

      {error ? <p className="error">{error}</p> : null}
      {info ? <p className="ok">{info}</p> : null}

      <div className="panel stack" style={{ marginBottom: '1.25rem' }}>
        <div className="row" style={{ justifyContent: 'space-between', gap: '1rem', flexWrap: 'wrap' }}>
          <strong>Offene Sendungen ({pending.length})</strong>
          <div className="row" style={{ gap: '0.5rem' }}>
            <button type="button" className="secondary" onClick={() => toggleAll(true)}>
              Alle
            </button>
            <button type="button" className="secondary" onClick={() => toggleAll(false)}>
              Keine
            </button>
            <button type="button" className="secondary" onClick={() => load().catch(() => null)}>
              Aktualisieren
            </button>
          </div>
        </div>
        {!pending.length ? (
          <p className="muted">Keine Sendungen mit „LKW später“ in der Warteschlange.</p>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table>
              <thead>
                <tr>
                  <th></th>
                  <th>Auftrag</th>
                  <th>Soloplan</th>
                  {isStaff ? <th>Kunde</th> : null}
                  <th>Absender → Empfänger</th>
                  <th>Colli / kg</th>
                </tr>
              </thead>
              <tbody>
                {pending.map((o) => (
                  <tr key={o.id}>
                    <td>
                      <input
                        type="checkbox"
                        checked={!!selected[o.id]}
                        onChange={() => toggle(o.id)}
                      />
                    </td>
                    <td className="mono">{o.externalNumber || '–'}</td>
                    <td className="mono">{soloplanLabel(o.soloplanRef) || '–'}</td>
                    {isStaff ? (
                      <td>
                        {o.customer?.name}
                        {o.customer?.customerNumber ? ` (${o.customer.customerNumber})` : ''}
                      </td>
                    ) : null}
                    <td>
                      {o.absenderFirma} → {o.empfaengerFirma}
                    </td>
                    <td>
                      {o.packageCount ?? '–'} / {o.weightKg ?? '–'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <form className="panel stack" style={{ maxWidth: 720 }} onSubmit={onRelease}>
        <strong>Beladung freigeben ({selectedIds.length} ausgewählt)</strong>
        <div className="grid-2">
          <div className="field">
            <label>Kennzeichen</label>
            <input
              required
              value={form.kennzeichen}
              onChange={(e) => setForm({ ...form, kennzeichen: e.target.value })}
              onBlur={() =>
                setForm((f) => ({
                  ...f,
                  kennzeichen: normalizeSmartBorderPlate(f.kennzeichen, f.zulassungsland),
                }))
              }
              placeholder="z. B. W-12345T"
              autoCapitalize="characters"
              spellCheck={false}
            />
            <span className="muted" style={{ fontSize: '0.8rem' }}>
              {smartBorderPlateHint(form.zulassungsland)}
            </span>
          </div>
          <div className="field">
            <label>Zulassungsland</label>
            <select
              required
              value={form.zulassungsland}
              onChange={(e) => setForm({ ...form, zulassungsland: e.target.value })}
            >
              {COUNTRIES.map((c) => (
                <option key={c.code} value={c.code}>
                  {c.code} – {c.label}
                </option>
              ))}
            </select>
          </div>
        </div>
        <div className="grid-2">
          <div className="field">
            <label>Kennzeichen Anhänger</label>
            <input
              value={form.kennzeichenAnhaenger}
              onChange={(e) => setForm({ ...form, kennzeichenAnhaenger: e.target.value })}
              placeholder="optional"
            />
          </div>
          <div className="field">
            <label>Zulassungsland Anhänger</label>
            <select
              value={form.zulassungslandAnhaenger}
              onChange={(e) => setForm({ ...form, zulassungslandAnhaenger: e.target.value })}
              disabled={!form.kennzeichenAnhaenger.trim()}
            >
              {COUNTRIES.map((c) => (
                <option key={c.code} value={c.code}>
                  {c.code}
                </option>
              ))}
            </select>
          </div>
        </div>
        <div className="field">
          <label>Grenzübergang</label>
          <select value={borderPreset} onChange={(e) => setBorderPreset(e.target.value)}>
            {BORDER_PRESETS.map((b) => (
              <option key={b} value={b}>
                {b}
              </option>
            ))}
            <option value={BORDER_OTHER}>Andere…</option>
          </select>
          {borderPreset === BORDER_OTHER ? (
            <input
              style={{ marginTop: 8 }}
              required
              value={borderCustom}
              onChange={(e) => setBorderCustom(e.target.value)}
              placeholder="Grenzübergang Freitext"
            />
          ) : null}
        </div>
        <div className="field">
          <label>Zeitpunkt Grenze</label>
          <input
            required
            type="datetime-local"
            value={form.zeit}
            onChange={(e) => setForm({ ...form, zeit: e.target.value })}
          />
        </div>
        <div className="field">
          <label>Notiz (optional)</label>
          <input
            value={form.notes}
            onChange={(e) => setForm({ ...form, notes: e.target.value })}
          />
        </div>
        <button type="submit" disabled={busy || !selectedIds.length}>
          {busy
            ? 'Wird freigegeben…'
            : `Freigeben · Ladeliste · Aviso (${selectedIds.length})`}
        </button>
      </form>
    </AppShell>
  );
}
