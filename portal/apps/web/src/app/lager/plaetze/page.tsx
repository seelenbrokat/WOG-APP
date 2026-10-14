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
  occupied?: boolean;
};

type MapSlot = {
  id: string;
  code: string;
  slot: number;
  usedSlots: number;
  capacitySlots: number;
  freeSlots: number;
  occupied: boolean;
  unitCount: number;
};

type OccupancyMap = {
  summary: {
    rackSlots: number;
    blockZones: number;
    usedSlots: number;
    capacitySlots: number;
    freeSlots: number;
    occupiedSlots: number;
  };
  aisles: Array<{
    aisle: number;
    levels: Array<{
      level: number;
      bays: Array<{ bay: number; slots: MapSlot[] }>;
    }>;
  }>;
  blocks: Array<{
    id: string;
    code: string;
    label?: string | null;
    usedSlots: number;
    capacitySlots: number;
    freeSlots: number;
    occupied: boolean;
    unitCount: number;
  }>;
};

function slotColor(s: MapSlot) {
  if (s.freeSlots <= 0.001) return '#b42318';
  if (s.occupied) return '#b54708';
  return '#027a48';
}

export default function LagerPlaetzePage() {
  const [locations, setLocations] = useState<Location[]>([]);
  const [map, setMap] = useState<OccupancyMap | null>(null);
  const [q, setQ] = useState('');
  const [kind, setKind] = useState('');
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [newCode, setNewCode] = useState('');
  const [newKind, setNewKind] = useState<'RACK' | 'BLOCK'>('BLOCK');
  const [newCap, setNewCap] = useState('10');
  const [aisles, setAisles] = useState('10');
  const [levels, setLevels] = useState('3');
  const [bays, setBays] = useState('4');
  const [slotsPerBay, setSlotsPerBay] = useState('3');
  const [blockZones, setBlockZones] = useState('4');
  const [selectedAisle, setSelectedAisle] = useState<number | null>(null);
  const [showMap, setShowMap] = useState(true);

  async function load() {
    const qs = new URLSearchParams();
    if (kind) qs.set('kind', kind);
    if (q.trim()) qs.set('q', q.trim());
    const [locs, occupancy] = await Promise.all([
      api<Location[]>(`/warehouse/locations?${qs}`),
      api<OccupancyMap>('/warehouse/layout/map'),
    ]);
    setLocations(locs);
    setMap(occupancy);
    if (selectedAisle == null && occupancy.aisles[0]) {
      setSelectedAisle(occupancy.aisles[0].aisle);
    }
  }

  useEffect(() => {
    load().catch((e) => setError(e.message));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const layoutBody = useMemo(
    () => ({
      aisles: Number(aisles) || 10,
      levels: Number(levels) || 3,
      bays: Number(bays) || 4,
      slotsPerBay: Number(slotsPerBay) || 3,
      blockZones: Number(blockZones) || 0,
    }),
    [aisles, levels, bays, slotsPerBay, blockZones],
  );

  const stats = useMemo(() => {
    if (map) {
      return {
        rack: map.summary.rackSlots,
        block: map.summary.blockZones,
        used: map.summary.usedSlots,
        cap: map.summary.capacitySlots,
        occupied: map.summary.occupiedSlots,
      };
    }
    const rack = locations.filter((l) => l.kind === 'RACK');
    const block = locations.filter((l) => l.kind === 'BLOCK');
    const used = locations.reduce((s, l) => s + l.usedSlots, 0);
    const cap = locations.reduce((s, l) => s + l.capacitySlots, 0);
    return {
      rack: rack.length,
      block: block.length,
      used,
      cap,
      occupied: locations.filter((l) => l.unitCount > 0).length,
    };
  }, [locations, map]);

  const activeAisle = useMemo(
    () => map?.aisles.find((a) => a.aisle === selectedAisle) || map?.aisles[0] || null,
    [map, selectedAisle],
  );

  async function seedDefault() {
    setBusy(true);
    setError('');
    setMessage('');
    try {
      const res = await api<{ created: number; skipped: boolean; message?: string }>(
        '/warehouse/layout/ensure-default',
        { method: 'POST', body: JSON.stringify(layoutBody) },
      );
      setMessage(
        res.skipped
          ? res.message || 'Bereits vorhanden'
          : `${res.created} Plätze angelegt (${layoutBody.aisles}×${layoutBody.levels}×${layoutBody.bays}×${layoutBody.slotsPerBay} + Blocklager)`,
      );
      await load();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  async function extendLayout() {
    setBusy(true);
    setError('');
    setMessage('');
    try {
      const res = await api<{ created: number; skipped: boolean; message?: string }>(
        '/warehouse/layout/extend',
        { method: 'POST', body: JSON.stringify(layoutBody) },
      );
      setMessage(
        res.skipped
          ? res.message || 'Nichts hinzugefügt'
          : `${res.created} neue Plätze ergänzt`,
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
        Hochregal &amp; Blocklager – Layout jederzeit erweiterbar. Standard: 10 Reihen × 3 Ebenen × 4
        Fächer × 3 Stellplätze.
      </p>

      <div className="panel stack" style={{ marginBottom: '1rem', maxWidth: 720 }}>
        <strong>Regal-Layout</strong>
        <div className="row" style={{ gap: '0.5rem', flexWrap: 'wrap', alignItems: 'end' }}>
          <label className="stack" style={{ gap: 2, fontSize: '0.8rem' }}>
            Reihen
            <input
              type="number"
              min={1}
              max={50}
              style={{ width: 72 }}
              value={aisles}
              onChange={(e) => setAisles(e.target.value)}
            />
          </label>
          <label className="stack" style={{ gap: 2, fontSize: '0.8rem' }}>
            Ebenen
            <input
              type="number"
              min={1}
              max={10}
              style={{ width: 72 }}
              value={levels}
              onChange={(e) => setLevels(e.target.value)}
            />
          </label>
          <label className="stack" style={{ gap: 2, fontSize: '0.8rem' }}>
            Fächer
            <input
              type="number"
              min={1}
              max={20}
              style={{ width: 72 }}
              value={bays}
              onChange={(e) => setBays(e.target.value)}
            />
          </label>
          <label className="stack" style={{ gap: 2, fontSize: '0.8rem' }}>
            Plätze/Fach
            <input
              type="number"
              min={1}
              max={10}
              style={{ width: 72 }}
              value={slotsPerBay}
              onChange={(e) => setSlotsPerBay(e.target.value)}
            />
          </label>
          <label className="stack" style={{ gap: 2, fontSize: '0.8rem' }}>
            Blockzonen
            <input
              type="number"
              min={0}
              max={50}
              style={{ width: 72 }}
              value={blockZones}
              onChange={(e) => setBlockZones(e.target.value)}
            />
          </label>
          <button className="btn btn-primary" type="button" disabled={busy} onClick={seedDefault}>
            Standard anlegen
          </button>
          <button className="btn btn-ghost" type="button" disabled={busy} onClick={extendLayout}>
            Erweitern
          </button>
        </div>
        <span className="muted" style={{ fontSize: '0.85rem' }}>
          {stats.rack} Regalplätze · {stats.block} Block · belegt {stats.used.toFixed(1)}/
          {stats.cap.toFixed(1)} · {stats.occupied} Plätze mit Ware
        </span>
      </div>

      {error ? <p className="error">{error}</p> : null}
      {message ? <p className="ok">{message}</p> : null}

      {map && map.aisles.length > 0 ? (
        <div className="panel" style={{ marginBottom: '1rem' }}>
          <div
            className="row"
            style={{
              justifyContent: 'space-between',
              alignItems: 'center',
              gap: '0.75rem',
              flexWrap: 'wrap',
              marginBottom: showMap ? '0.75rem' : 0,
            }}
          >
            <strong>Belegungskarte</strong>
            <div className="row" style={{ gap: '0.5rem', flexWrap: 'wrap', alignItems: 'center' }}>
              <span className="muted" style={{ fontSize: '0.8rem' }}>
                <span style={{ color: '#027a48' }}>●</span> frei{' '}
                <span style={{ color: '#b54708' }}>●</span> teilweise{' '}
                <span style={{ color: '#b42318' }}>●</span> voll
              </span>
              <button className="btn btn-ghost" type="button" onClick={() => setShowMap((v) => !v)}>
                {showMap ? 'Karte ausblenden' : 'Karte zeigen'}
              </button>
            </div>
          </div>

          {showMap ? (
            <>
              <div className="row" style={{ gap: '0.35rem', flexWrap: 'wrap', marginBottom: '0.75rem' }}>
                {map.aisles.map((a) => (
                  <button
                    key={a.aisle}
                    type="button"
                    className={selectedAisle === a.aisle ? 'btn btn-primary' : 'btn btn-ghost'}
                    style={{ padding: '0.35rem 0.65rem', fontSize: '0.85rem' }}
                    onClick={() => setSelectedAisle(a.aisle)}
                  >
                    Reihe {a.aisle}
                  </button>
                ))}
              </div>

              {activeAisle ? (
                <div style={{ overflowX: 'auto' }}>
                  {activeAisle.levels.map((lv) => (
                    <div key={lv.level} style={{ marginBottom: '0.65rem' }}>
                      <div className="muted" style={{ fontSize: '0.8rem', marginBottom: 4 }}>
                        Ebene {lv.level}
                      </div>
                      <div className="row" style={{ gap: '0.5rem', flexWrap: 'wrap' }}>
                        {lv.bays.map((bay) => (
                          <div
                            key={bay.bay}
                            style={{
                              border: '1px solid var(--border, #d5dbe3)',
                              borderRadius: 6,
                              padding: '0.35rem 0.4rem',
                              background: 'var(--bg-panel, #fff)',
                            }}
                          >
                            <div
                              className="muted"
                              style={{ fontSize: '0.7rem', marginBottom: 4, textAlign: 'center' }}
                            >
                              Fach {bay.bay}
                            </div>
                            <div className="row" style={{ gap: 4 }}>
                              {bay.slots.map((s) => (
                                <div
                                  key={s.id}
                                  title={`${s.code}: ${s.usedSlots}/${s.capacitySlots}${
                                    s.unitCount ? ` · ${s.unitCount} Pos.` : ''
                                  }`}
                                  style={{
                                    width: 28,
                                    height: 28,
                                    borderRadius: 4,
                                    background: slotColor(s),
                                    color: '#fff',
                                    fontSize: 11,
                                    fontWeight: 600,
                                    display: 'flex',
                                    alignItems: 'center',
                                    justifyContent: 'center',
                                    cursor: 'default',
                                  }}
                                >
                                  {s.slot}
                                </div>
                              ))}
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              ) : null}

              {map.blocks.length > 0 ? (
                <div style={{ marginTop: '0.75rem' }}>
                  <div className="muted" style={{ fontSize: '0.8rem', marginBottom: 4 }}>
                    Blocklager
                  </div>
                  <div className="row" style={{ gap: '0.5rem', flexWrap: 'wrap' }}>
                    {map.blocks.map((b) => {
                      const ratio = b.capacitySlots > 0 ? b.usedSlots / b.capacitySlots : 0;
                      const color =
                        ratio >= 0.99 ? '#b42318' : ratio > 0 ? '#b54708' : '#027a48';
                      return (
                        <div
                          key={b.id}
                          title={`${b.code}: ${b.usedSlots}/${b.capacitySlots}`}
                          style={{
                            minWidth: 110,
                            border: `2px solid ${color}`,
                            borderRadius: 6,
                            padding: '0.4rem 0.55rem',
                            fontSize: '0.85rem',
                          }}
                        >
                          <strong>{b.code}</strong>
                          <div className="muted" style={{ fontSize: '0.75rem' }}>
                            {b.usedSlots.toFixed(1)} / {b.capacitySlots}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              ) : null}
            </>
          ) : null}
        </div>
      ) : null}

      <form className="panel stack" onSubmit={addLocation} style={{ marginBottom: '1rem', maxWidth: 520 }}>
        <strong>Einzelnen Platz hinzufügen</strong>
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
