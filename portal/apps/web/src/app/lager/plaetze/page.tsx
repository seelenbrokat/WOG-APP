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

type Customer = { id: string; name: string; customerNumber: string };
type Article = {
  id: string;
  name: string;
  articleNumber?: string | null;
  palletType: string;
  slotUnits: number;
};
type Meta = {
  palletTypes: Array<{ code: string; label: string; defaultSlotUnits: number }>;
};
type Unit = {
  id: string;
  palletType: string;
  slotUnits: number;
  articleName?: string | null;
  serialNumber?: string | null;
  storedAt: string;
  status: string;
  customer: { id: string; name: string; customerNumber: string };
};

const PALLET: Record<string, string> = {
  EURO: 'Euro',
  HALF: 'Halb',
  OVERSIZE: 'Übergroß',
  CUSTOM: 'Individuell/EWP',
};

function slotColor(s: { freeSlots: number; occupied: boolean }) {
  if (s.freeSlots <= 0.001) return '#b42318';
  if (s.occupied) return '#b54708';
  return '#027a48';
}

function toLocalInputValue(d = new Date()) {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function fmtDateTime(iso?: string | null) {
  if (!iso) return '–';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '–';
  return d.toLocaleString('de-AT', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
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

  const [activeLoc, setActiveLoc] = useState<Location | null>(null);
  const [units, setUnits] = useState<Unit[]>([]);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [articles, setArticles] = useState<Article[]>([]);
  const [meta, setMeta] = useState<Meta | null>(null);
  const [panelTab, setPanelTab] = useState<'stock' | 'in'>('stock');
  const [customerId, setCustomerId] = useState('');
  const [articleId, setArticleId] = useState('');
  const [palletType, setPalletType] = useState('EURO');
  const [slotUnits, setSlotUnits] = useState('1');
  const [articleName, setArticleName] = useState('');
  const [serialNumber, setSerialNumber] = useState('');
  const [storedAt, setStoredAt] = useState(toLocalInputValue);
  const [outboundId, setOutboundId] = useState<string | null>(null);
  const [outboundAt, setOutboundAt] = useState(toLocalInputValue);

  async function load() {
    const qs = new URLSearchParams();
    if (kind) qs.set('kind', kind);
    if (q.trim()) qs.set('q', q.trim());
    const [locs, occupancy, cust, m] = await Promise.all([
      api<Location[]>(`/warehouse/locations?${qs}`),
      api<OccupancyMap>('/warehouse/layout/map'),
      api<Customer[]>('/warehouse/customers'),
      api<Meta>('/warehouse/meta'),
    ]);
    setLocations(locs);
    setMap(occupancy);
    setCustomers(cust);
    setMeta(m);
    if (selectedAisle == null && occupancy.aisles[0]) {
      setSelectedAisle(occupancy.aisles[0].aisle);
    }
    if (!customerId && cust[0]) setCustomerId(cust[0].id);
    if (m.palletTypes[0] && palletType === 'EURO') {
      setPalletType(m.palletTypes[0].code);
      setSlotUnits(String(m.palletTypes[0].defaultSlotUnits));
    }
  }

  useEffect(() => {
    load().catch((e) => setError(e.message));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!customerId) {
      setArticles([]);
      return;
    }
    api<Article[]>(`/warehouse/articles?customerId=${encodeURIComponent(customerId)}`)
      .then(setArticles)
      .catch(() => setArticles([]));
  }, [customerId]);

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

  async function openLocation(loc: {
    id: string;
    code: string;
    freeSlots?: number;
    usedSlots?: number;
    capacitySlots?: number;
    unitCount?: number;
    kind?: string;
    label?: string | null;
  }) {
    setError('');
    setMessage('');
    setOutboundId(null);
    const full =
      locations.find((l) => l.id === loc.id) ||
      ({
        id: loc.id,
        code: loc.code,
        kind: loc.kind || 'RACK',
        capacitySlots: loc.capacitySlots ?? 1,
        usedSlots: loc.usedSlots ?? 0,
        freeSlots: loc.freeSlots ?? 0,
        unitCount: loc.unitCount ?? 0,
        label: loc.label,
      } as Location);
    setActiveLoc(full);
    setPanelTab(full.unitCount > 0 ? 'stock' : 'in');
    setStoredAt(toLocalInputValue());
    try {
      const list = await api<Unit[]>(
        `/warehouse/stock?locationId=${encodeURIComponent(loc.id)}&status=STORED`,
      );
      setUnits(list);
      // refresh free/used from map after open
      const refreshed = await api<Location[]>(`/warehouse/locations?q=${encodeURIComponent(loc.code)}`);
      const match = refreshed.find((l) => l.id === loc.id);
      if (match) setActiveLoc(match);
    } catch (e: any) {
      setError(e.message);
    }
  }

  async function refreshActive() {
    if (!activeLoc) return;
    await load();
    const list = await api<Unit[]>(
      `/warehouse/stock?locationId=${encodeURIComponent(activeLoc.id)}&status=STORED`,
    );
    setUnits(list);
    const refreshed = await api<Location[]>(
      `/warehouse/locations?q=${encodeURIComponent(activeLoc.code)}`,
    );
    const match = refreshed.find((l) => l.id === activeLoc.id);
    if (match) setActiveLoc(match);
  }

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
        res.skipped ? res.message || 'Nichts hinzugefügt' : `${res.created} neue Plätze ergänzt`,
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

  function applyArticle(id: string) {
    setArticleId(id);
    if (!id) return;
    const a = articles.find((x) => x.id === id);
    if (!a) return;
    setPalletType(a.palletType);
    setSlotUnits(String(a.slotUnits));
    setArticleName([a.articleNumber, a.name].filter(Boolean).join(' · '));
  }

  function onPalletChange(code: string) {
    setPalletType(code);
    if (articleId) return;
    const def = meta?.palletTypes.find((p) => p.code === code)?.defaultSlotUnits ?? 1;
    if (code !== 'CUSTOM') setSlotUnits(String(def));
  }

  async function inboundHere(e: FormEvent) {
    e.preventDefault();
    if (!activeLoc) return;
    setBusy(true);
    setError('');
    setMessage('');
    try {
      await api('/warehouse/inbound', {
        method: 'POST',
        body: JSON.stringify({
          customerId,
          locationId: activeLoc.id,
          articleId: articleId || undefined,
          palletType,
          slotUnits: Number(slotUnits) || undefined,
          articleName: articleName || undefined,
          serialNumber: serialNumber || undefined,
          storedAt: storedAt || undefined,
        }),
      });
      setMessage(`Eingelagert auf ${activeLoc.code}`);
      setSerialNumber('');
      setArticleId('');
      await refreshActive();
      setPanelTab('stock');
    } catch (err: any) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function confirmOutbound() {
    if (!outboundId) return;
    setBusy(true);
    setError('');
    try {
      await api(`/warehouse/units/${outboundId}/outbound`, {
        method: 'POST',
        body: JSON.stringify({ releasedAt: outboundAt || undefined }),
      });
      setMessage('Ausgelagert');
      setOutboundId(null);
      await refreshActive();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  const needSlots = Number(slotUnits) || 1;
  const canInbound = activeLoc && activeLoc.freeSlots + 0.001 >= needSlots;

  return (
    <AppShell title="Lagerplätze" eyebrow="Lagerverwaltung">
      <p className="muted" style={{ marginTop: 0 }}>
        Belegungskarte: Platz antippen → Artikel einlagern oder auslagern.
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

      {activeLoc ? (
        <div
          className="panel stack"
          style={{ marginBottom: '1rem', border: '2px solid var(--wog-green, #1b7a4a)' }}
        >
          <div
            className="row"
            style={{ justifyContent: 'space-between', gap: '0.75rem', flexWrap: 'wrap' }}
          >
            <div>
              <strong style={{ fontSize: '1.1rem' }}>{activeLoc.code}</strong>
              <div className="muted" style={{ fontSize: '0.85rem' }}>
                {activeLoc.label || (activeLoc.kind === 'BLOCK' ? 'Blocklager' : 'Regalplatz')} ·
                belegt {activeLoc.usedSlots.toFixed(1)}/{activeLoc.capacitySlots} · frei{' '}
                {activeLoc.freeSlots.toFixed(1)}
              </div>
            </div>
            <button className="btn btn-ghost" type="button" onClick={() => setActiveLoc(null)}>
              Schließen
            </button>
          </div>

          <div className="row" style={{ gap: '0.5rem' }}>
            <button
              type="button"
              className={panelTab === 'stock' ? 'btn btn-primary' : 'btn btn-ghost'}
              onClick={() => setPanelTab('stock')}
            >
              Bestand ({units.length})
            </button>
            <button
              type="button"
              className={panelTab === 'in' ? 'btn btn-primary' : 'btn btn-ghost'}
              onClick={() => setPanelTab('in')}
              disabled={activeLoc.freeSlots < 0.1}
              title={activeLoc.freeSlots < 0.1 ? 'Platz voll' : undefined}
            >
              Einlagern
            </button>
          </div>

          {panelTab === 'stock' ? (
            <>
              {outboundId ? (
                <div className="stack" style={{ gap: '0.5rem', maxWidth: 360 }}>
                  <strong>Auslagern</strong>
                  <label className="stack" style={{ gap: 2, fontSize: '0.85rem' }}>
                    Auslagerungsdatum
                    <input
                      type="datetime-local"
                      value={outboundAt}
                      onChange={(e) => setOutboundAt(e.target.value)}
                    />
                  </label>
                  <div className="row" style={{ gap: '0.5rem' }}>
                    <button
                      className="btn btn-primary"
                      type="button"
                      disabled={busy}
                      onClick={confirmOutbound}
                    >
                      Bestätigen
                    </button>
                    <button
                      className="btn btn-ghost"
                      type="button"
                      onClick={() => setOutboundId(null)}
                    >
                      Abbrechen
                    </button>
                  </div>
                </div>
              ) : null}
              <div style={{ overflowX: 'auto' }}>
                <table className="table">
                  <thead>
                    <tr>
                      <th>Kunde</th>
                      <th>Artikel</th>
                      <th>Typ</th>
                      <th>Einlagerung</th>
                      <th></th>
                    </tr>
                  </thead>
                  <tbody>
                    {units.map((u) => (
                      <tr key={u.id}>
                        <td>{u.customer.name}</td>
                        <td>
                          {u.articleName || '–'}
                          {u.serialNumber ? (
                            <div className="muted" style={{ fontSize: '0.8rem' }}>
                              SN {u.serialNumber}
                            </div>
                          ) : null}
                        </td>
                        <td>
                          {PALLET[u.palletType] || u.palletType} ({u.slotUnits})
                        </td>
                        <td>{fmtDateTime(u.storedAt)}</td>
                        <td>
                          <button
                            className="btn btn-ghost"
                            type="button"
                            disabled={busy}
                            onClick={() => {
                              setOutboundId(u.id);
                              setOutboundAt(toLocalInputValue());
                            }}
                          >
                            Auslagern
                          </button>
                        </td>
                      </tr>
                    ))}
                    {!units.length ? (
                      <tr>
                        <td colSpan={5} className="muted">
                          Kein Bestand auf diesem Platz.
                        </td>
                      </tr>
                    ) : null}
                  </tbody>
                </table>
              </div>
            </>
          ) : (
            <form className="stack" onSubmit={inboundHere} style={{ maxWidth: 520 }}>
              <div className="field">
                <label>Kunde</label>
                <select
                  required
                  value={customerId}
                  onChange={(e) => {
                    setCustomerId(e.target.value);
                    setArticleId('');
                  }}
                >
                  {customers.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name} ({c.customerNumber})
                    </option>
                  ))}
                </select>
              </div>
              <div className="field">
                <label>Artikel (Stamm)</label>
                <select value={articleId} onChange={(e) => applyArticle(e.target.value)}>
                  <option value="">– manuell –</option>
                  {articles.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.articleNumber ? `${a.articleNumber} · ` : ''}
                      {a.name} ({a.slotUnits} SP)
                    </option>
                  ))}
                </select>
              </div>
              <div className="row" style={{ gap: '0.75rem', flexWrap: 'wrap' }}>
                <div className="field" style={{ flex: 2, minWidth: 140 }}>
                  <label>Palettentyp</label>
                  <select value={palletType} onChange={(e) => onPalletChange(e.target.value)}>
                    {(meta?.palletTypes || []).map((p) => (
                      <option key={p.code} value={p.code}>
                        {p.label}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="field" style={{ flex: 1, minWidth: 100 }}>
                  <label>Stellplätze</label>
                  <input
                    type="number"
                    min={0.1}
                    step={0.1}
                    required
                    value={slotUnits}
                    onChange={(e) => setSlotUnits(e.target.value)}
                  />
                </div>
              </div>
              <div className="field">
                <label>Einlagerungsdatum</label>
                <input
                  type="datetime-local"
                  required
                  value={storedAt}
                  onChange={(e) => setStoredAt(e.target.value)}
                />
              </div>
              <div className="field">
                <label>Artikelbezeichnung</label>
                <input value={articleName} onChange={(e) => setArticleName(e.target.value)} />
              </div>
              <div className="field">
                <label>Seriennummer</label>
                <input value={serialNumber} onChange={(e) => setSerialNumber(e.target.value)} />
              </div>
              {!canInbound ? (
                <p className="error">
                  Platz zu voll für {needSlots} Stellplatz(e) (frei {activeLoc.freeSlots.toFixed(1)}
                  ).
                </p>
              ) : null}
              <button className="btn btn-primary" type="submit" disabled={busy || !canInbound}>
                {busy ? 'Speichern…' : `Auf ${activeLoc.code} einlagern`}
              </button>
            </form>
          )}
        </div>
      ) : null}

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
                <span style={{ color: '#b42318' }}>●</span> voll · Klick = öffnen
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
                              {bay.slots.map((s) => {
                                const selected = activeLoc?.id === s.id;
                                return (
                                  <button
                                    key={s.id}
                                    type="button"
                                    title={`${s.code}: ${s.usedSlots}/${s.capacitySlots}${
                                      s.unitCount ? ` · ${s.unitCount} Pos.` : ''
                                    } – klicken`}
                                    onClick={() => openLocation(s)}
                                    style={{
                                      width: 32,
                                      height: 32,
                                      borderRadius: 4,
                                      border: selected ? '2px solid #111' : 'none',
                                      background: slotColor(s),
                                      color: '#fff',
                                      fontSize: 11,
                                      fontWeight: 600,
                                      cursor: 'pointer',
                                      padding: 0,
                                    }}
                                  >
                                    {s.slot}
                                  </button>
                                );
                              })}
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
                      const selected = activeLoc?.id === b.id;
                      return (
                        <button
                          key={b.id}
                          type="button"
                          title={`${b.code}: ${b.usedSlots}/${b.capacitySlots} – klicken`}
                          onClick={() => openLocation({ ...b, kind: 'BLOCK' })}
                          style={{
                            minWidth: 110,
                            border: selected ? `3px solid #111` : `2px solid ${color}`,
                            borderRadius: 6,
                            padding: '0.4rem 0.55rem',
                            fontSize: '0.85rem',
                            background: 'var(--bg-panel, #fff)',
                            cursor: 'pointer',
                            textAlign: 'left',
                          }}
                        >
                          <strong>{b.code}</strong>
                          <div className="muted" style={{ fontSize: '0.75rem' }}>
                            {b.usedSlots.toFixed(1)} / {b.capacitySlots}
                          </div>
                        </button>
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
              <th></th>
            </tr>
          </thead>
          <tbody>
            {locations.slice(0, 200).map((l) => (
              <tr
                key={l.id}
                style={{
                  background: activeLoc?.id === l.id ? 'var(--wog-green-soft, #e8f5ee)' : undefined,
                }}
              >
                <td>
                  <strong>{l.code}</strong>
                </td>
                <td>{l.kind === 'BLOCK' ? 'Block' : 'Regal'}</td>
                <td>
                  {l.usedSlots.toFixed(1)} / {l.capacitySlots}
                </td>
                <td>{l.unitCount}</td>
                <td className="muted">{l.label || '–'}</td>
                <td>
                  <button className="btn btn-ghost" type="button" onClick={() => openLocation(l)}>
                    Öffnen
                  </button>
                </td>
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
