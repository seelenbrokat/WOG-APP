'use client';

import { FormEvent, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { AppShell } from '@/components/AppShell';
import { api } from '@/lib/api';

type Customer = { id: string; name: string; customerNumber: string };
type Location = {
  id: string;
  code: string;
  kind: string;
  freeSlots: number;
  capacitySlots: number;
  usedSlots: number;
  label?: string | null;
};
type Meta = {
  palletTypes: Array<{ code: string; label: string; defaultSlotUnits: number }>;
};

export default function EinlagernPage() {
  const router = useRouter();
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [locations, setLocations] = useState<Location[]>([]);
  const [meta, setMeta] = useState<Meta | null>(null);
  const [customerId, setCustomerId] = useState('');
  const [locationId, setLocationId] = useState('');
  const [palletType, setPalletType] = useState('EURO');
  const [articleName, setArticleName] = useState('');
  const [serialNumber, setSerialNumber] = useState('');
  const [sscc, setSscc] = useState('');
  const [externalRef, setExternalRef] = useState('');
  const [notes, setNotes] = useState('');
  const [locFilter, setLocFilter] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    Promise.all([
      api<Customer[]>('/warehouse/customers'),
      api<Location[]>('/warehouse/locations?freeOnly=1'),
      api<Meta>('/warehouse/meta'),
    ])
      .then(([c, l, m]) => {
        setCustomers(c);
        setLocations(l);
        setMeta(m);
        if (c[0]) setCustomerId(c[0].id);
        if (m.palletTypes[0]) setPalletType(m.palletTypes[0].code);
      })
      .catch((e) => setError(e.message));
  }, []);

  const filteredLocs = useMemo(() => {
    const q = locFilter.trim().toLowerCase();
    if (!q) return locations.slice(0, 80);
    return locations.filter((l) => `${l.code} ${l.label || ''}`.toLowerCase().includes(q)).slice(0, 80);
  }, [locations, locFilter]);

  const needSlots =
    meta?.palletTypes.find((p) => p.code === palletType)?.defaultSlotUnits ?? 1;

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      await api('/warehouse/inbound', {
        method: 'POST',
        body: JSON.stringify({
          customerId,
          locationId,
          palletType,
          articleName: articleName || undefined,
          serialNumber: serialNumber || undefined,
          sscc: sscc || undefined,
          externalRef: externalRef || undefined,
          notes: notes || undefined,
        }),
      });
      router.push('/lager/bestand');
    } catch (err: any) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <AppShell title="Einlagern" eyebrow="Lagerverwaltung">
      <p className="muted" style={{ marginTop: 0 }}>
        Palette aufnehmen: Kunde, Platz, Typ, optional Artikel &amp; Seriennummer.
        Nur Kunden mit Checkbox <strong>Lagerkunde</strong>.
      </p>
      {error ? <p className="error">{error}</p> : null}
      {!customers.length && !error ? (
        <p className="muted">
          Keine Lagerkunden – unter{' '}
          <a href="/customers">Kunden</a> die Checkbox „Lagerkunde“ setzen.
        </p>
      ) : null}

      <form className="panel stack" onSubmit={onSubmit} style={{ maxWidth: 640 }}>
        <div className="field">
          <label>Kunde</label>
          <select required value={customerId} onChange={(e) => setCustomerId(e.target.value)}>
            {customers.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name} ({c.customerNumber})
              </option>
            ))}
          </select>
        </div>

        <div className="field">
          <label>Palettentyp</label>
          <select value={palletType} onChange={(e) => setPalletType(e.target.value)}>
            {(meta?.palletTypes || []).map((p) => (
              <option key={p.code} value={p.code}>
                {p.label} ({p.defaultSlotUnits} Stellplatz)
              </option>
            ))}
          </select>
        </div>

        <div className="field">
          <label>Lagerplatz (frei ≥ {needSlots})</label>
          <div className="row" style={{ gap: '0.5rem', flexWrap: 'wrap', marginBottom: 6 }}>
            <input
              placeholder="Platz suchen (z. B. R01-E2…)"
              value={locFilter}
              onChange={(e) => setLocFilter(e.target.value)}
              style={{ flex: 1, minWidth: 180 }}
            />
            <button
              className="btn btn-ghost"
              type="button"
              disabled={busy}
              onClick={async () => {
                try {
                  const res = await api<{ location: Location | null }>(
                    `/warehouse/locations/suggest?palletType=${encodeURIComponent(palletType)}`,
                  );
                  if (!res.location) {
                    setError('Kein freier Platz für diesen Palettentyp');
                    return;
                  }
                  setError('');
                  setLocationId(res.location.id);
                  setLocFilter(res.location.code);
                } catch (e: any) {
                  setError(e.message);
                }
              }}
            >
              Nächsten freien vorschlagen
            </button>
          </div>
          <select
            required
            value={locationId}
            onChange={(e) => setLocationId(e.target.value)}
            size={8}
            style={{ width: '100%' }}
          >
            <option value="">– Platz wählen –</option>
            {filteredLocs
              .filter((l) => l.freeSlots + 0.001 >= needSlots)
              .map((l) => (
                <option key={l.id} value={l.id}>
                  {l.code} · frei {l.freeSlots}/{l.capacitySlots}
                  {l.kind === 'BLOCK' ? ' (Block)' : ''}
                </option>
              ))}
          </select>
        </div>

        <div className="field">
          <label>Artikelbezeichnung</label>
          <input value={articleName} onChange={(e) => setArticleName(e.target.value)} />
        </div>
        <div className="field">
          <label>Seriennummer</label>
          <input value={serialNumber} onChange={(e) => setSerialNumber(e.target.value)} />
        </div>
        <div className="field">
          <label>SSCC / Collonummer (optional)</label>
          <input value={sscc} onChange={(e) => setSscc(e.target.value)} />
        </div>
        <div className="field">
          <label>Externe Ref. / Sendungsnr. (optional)</label>
          <input value={externalRef} onChange={(e) => setExternalRef(e.target.value)} />
        </div>
        <div className="field">
          <label>Notiz</label>
          <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} />
        </div>

        <button className="btn btn-primary" type="submit" disabled={busy || !locationId}>
          {busy ? 'Speichern…' : 'Einlagern'}
        </button>
      </form>
    </AppShell>
  );
}
