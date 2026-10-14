'use client';

import { FormEvent, useEffect, useMemo, useState } from 'react';
import { AppShell } from '@/components/AppShell';
import { api } from '@/lib/api';

type Location = {
  id: string;
  code: string;
  kind: string;
  aisle?: number | null;
  level?: number | null;
  bay?: number | null;
  slot?: number | null;
  label?: string | null;
  capacitySlots: number;
  usedSlots: number;
  freeSlots: number;
  unitCount: number;
};

export default function LagerPlaetzePage() {
  const [locations, setLocations] = useState<Location[]>([]);
  const [q, setQ] = useState('');
  const [kind, setKind] = useState('');
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [newCode, setNewCode] = useState('');
  const [newKind, setNewKind] = useState<'RACK' | 'BLOCK'>('BLOCK');
  const [newCap, setNewCap] = useState('10');

  async function load() {
    const qs = new URLSearchParams();
    if (kind) qs.set('kind', kind);
    if (q.trim()) qs.set('q', q.trim());
    setLocations(await api<Location[]>(`/warehouse/locations?${qs}`));
  }

  useEffect(() => {
    load().catch((e) => setError(e.message));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const stats = useMemo(() => {
    const rack = locations.filter((l) => l.kind === 'RACK');
    const block = locations.filter((l) => l.kind === 'BLOCK');
    const used = locations.reduce((s, l) => s + l.usedSlots, 0);
    const cap = locations.reduce((s, l) => s + l.capacitySlots, 0);
    return { rack: rack.length, block: block.length, used, cap, occupied: locations.filter((l) => l.unitCount > 0).length };
  }, [locations]);

  async function seedDefault() {
    setBusy(true);
    setError('');
    setMessage('');
    try {
      const res = await api<{ created: number; skipped: boolean; message?: string }>(
        '/warehouse/layout/ensure-default',
        { method: 'POST', body: '{}' },
      );
      setMessage(
        res.skipped
          ? res.message || 'Bereits vorhanden'
          : `${res.created} Plätze angelegt (10×3×4×3 + Blocklager)`,
      );
      await load();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  async function addLocation(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      await api('/warehouse/locations', {
        method: 'POST',
        body: JSON.stringify({
          code: newCode,
          kind: newKind,
          capacitySlots: Number(newCap) || 1,
          label: newCode,
        }),
      });
      setNewCode('');
      setMessage('Platz angelegt');
      await load();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <AppShell title="Lagerplätze" eyebrow="Lagerverwaltung">
      <p className="muted" style={{ marginTop: 0 }}>
        Hochregal &amp; Blocklager – Layout anpassbar. Standard: 10 Reihen × 3 Ebenen × 4 Fächer × 3
        Stellplätze.
      </p>

      <div className="row" style={{ gap: '0.75rem', flexWrap: 'wrap', marginBottom: '1rem' }}>
        <button className="btn btn-primary" type="button" disabled={busy} onClick={seedDefault}>
          Standard-Regal anlegen
        </button>
        <span className="muted" style={{ fontSize: '0.85rem' }}>
          {stats.rack} Regalplätze · {stats.block} Block · belegt {stats.used.toFixed(1)}/{stats.cap.toFixed(1)} ·{' '}
          {stats.occupied} Plätze mit Ware
        </span>
      </div>

      {error ? <p className="error">{error}</p> : null}
      {message ? <p className="ok">{message}</p> : null}

      <form className="panel stack" onSubmit={addLocation} style={{ marginBottom: '1rem', maxWidth: 520 }}>
        <strong>Platz hinzufügen</strong>
        <div className="row" style={{ gap: '0.5rem', flexWrap: 'wrap' }}>
          <input
            required
            placeholder="Code (z. B. BLOCK-05)"
            value={newCode}
            onChange={(e) => setNewCode(e.target.value)}
          />
          <select value={newKind} onChange={(e) => setNewKind(e.target.value as 'RACK' | 'BLOCK')}>
            <option value="BLOCK">Blocklager</option>
            <option value="RACK">Regal</option>
          </select>
          <input
            type="number"
            min={0.5}
            step={0.5}
            style={{ width: 100 }}
            value={newCap}
            onChange={(e) => setNewCap(e.target.value)}
            title="Kapazität Stellplätze"
          />
          <button className="btn btn-primary" type="submit" disabled={busy}>
            Anlegen
          </button>
        </div>
      </form>

      <form
        className="row"
        style={{ gap: '0.5rem', marginBottom: '0.75rem' }}
        onSubmit={(e) => {
          e.preventDefault();
          load().catch((err) => setError(err.message));
        }}
      >
        <input
          placeholder="Filter Code…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          style={{ flex: 1 }}
        />
        <select value={kind} onChange={(e) => setKind(e.target.value)}>
          <option value="">Alle</option>
          <option value="RACK">Regal</option>
          <option value="BLOCK">Block</option>
        </select>
        <button className="btn btn-ghost" type="submit">
          Filter
        </button>
      </form>

      <div className="panel" style={{ overflowX: 'auto' }}>
        <table className="table">
          <thead>
            <tr>
              <th>Code</th>
              <th>Art</th>
              <th>Belegung</th>
              <th>Positionen</th>
              <th>Label</th>
            </tr>
          </thead>
          <tbody>
            {locations.slice(0, 200).map((l) => (
              <tr key={l.id}>
                <td>
                  <strong>{l.code}</strong>
                </td>
                <td>{l.kind === 'BLOCK' ? 'Block' : 'Regal'}</td>
                <td>
                  {l.usedSlots.toFixed(1)} / {l.capacitySlots}
                </td>
                <td>{l.unitCount}</td>
                <td className="muted">{l.label || '–'}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {locations.length > 200 ? (
          <p className="muted">Erste 200 von {locations.length} – bitte Filter nutzen.</p>
        ) : null}
      </div>
    </AppShell>
  );
}
