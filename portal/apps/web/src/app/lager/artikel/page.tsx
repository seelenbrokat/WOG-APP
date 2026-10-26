'use client';

import { FormEvent, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { AppShell } from '@/components/AppShell';
import { api, getToken } from '@/lib/api';

const API_URL = process.env.NEXT_PUBLIC_API_URL || '/api';

type Customer = { id: string; name: string; customerNumber: string };
type Meta = {
  palletTypes: Array<{ code: string; label: string; defaultSlotUnits: number }>;
};
type Article = {
  id: string;
  name: string;
  articleNumber?: string | null;
  palletType: string;
  slotUnits: number;
  notes?: string | null;
  active: boolean;
  customer: Customer;
};

const empty = {
  customerId: '',
  name: '',
  articleNumber: '',
  palletType: 'EURO',
  slotUnits: '1',
  notes: '',
};

export default function LagerArtikelPage() {
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [articles, setArticles] = useState<Article[]>([]);
  const [meta, setMeta] = useState<Meta | null>(null);
  const [filterCustomerId, setFilterCustomerId] = useState('');
  const [form, setForm] = useState(empty);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [showInactive, setShowInactive] = useState(false);

  async function load() {
    const qs = new URLSearchParams();
    if (filterCustomerId) qs.set('customerId', filterCustomerId);
    if (showInactive) qs.set('all', '1');
    const [c, a, m] = await Promise.all([
      api<Customer[]>('/warehouse/customers'),
      api<Article[]>(`/warehouse/articles?${qs}`),
      api<Meta>('/warehouse/meta'),
    ]);
    setCustomers(c);
    setArticles(a);
    setMeta(m);
    setForm((f) => {
      if (editingId) return f;
      return {
        ...f,
        customerId: f.customerId || filterCustomerId || c[0]?.id || '',
        palletType: f.palletType || m.palletTypes[0]?.code || 'EURO',
        slotUnits:
          f.slotUnits ||
          String(m.palletTypes.find((p) => p.code === (f.palletType || 'EURO'))?.defaultSlotUnits ?? 1),
      };
    });
  }

  useEffect(() => {
    load().catch((e) => setError(e.message));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filterCustomerId, showInactive]);

  const palletLabel = useMemo(() => {
    const map: Record<string, string> = {};
    for (const p of meta?.palletTypes || []) map[p.code] = p.label;
    return map;
  }, [meta]);

  function onPalletChange(code: string) {
    const def = meta?.palletTypes.find((p) => p.code === code)?.defaultSlotUnits ?? 1;
    setForm((f) => ({
      ...f,
      palletType: code,
      slotUnits: code === 'CUSTOM' ? f.slotUnits : String(def),
    }));
  }

  function startEdit(a: Article) {
    setEditingId(a.id);
    setError('');
    setMessage('');
    setForm({
      customerId: a.customer.id,
      name: a.name,
      articleNumber: a.articleNumber || '',
      palletType: a.palletType || 'EURO',
      slotUnits: String(a.slotUnits ?? 1),
      notes: a.notes || '',
    });
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function cancelEdit() {
    setEditingId(null);
    setForm((f) => ({
      ...empty,
      customerId: filterCustomerId || f.customerId || customers[0]?.id || '',
      palletType: meta?.palletTypes[0]?.code || 'EURO',
      slotUnits: String(meta?.palletTypes[0]?.defaultSlotUnits ?? 1),
    }));
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError('');
    setMessage('');
    try {
      if (editingId) {
        await api(`/warehouse/articles/${editingId}`, {
          method: 'PATCH',
          body: JSON.stringify({
            name: form.name,
            articleNumber: form.articleNumber || null,
            palletType: form.palletType,
            slotUnits: Number(form.slotUnits) || 1,
            notes: form.notes || null,
          }),
        });
        setMessage('Artikel aktualisiert');
        setEditingId(null);
        setForm((f) => ({
          ...empty,
          customerId: f.customerId,
          palletType: f.palletType,
          slotUnits: f.slotUnits,
        }));
      } else {
        await api('/warehouse/articles', {
          method: 'POST',
          body: JSON.stringify({
            customerId: form.customerId,
            name: form.name,
            articleNumber: form.articleNumber || undefined,
            palletType: form.palletType,
            slotUnits: Number(form.slotUnits) || 1,
            notes: form.notes || undefined,
          }),
        });
        setMessage('Artikel angelegt');
        setForm((f) => ({
          ...empty,
          customerId: f.customerId,
          palletType: f.palletType,
          slotUnits: f.slotUnits,
        }));
      }
      await load();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function toggleActive(a: Article) {
    setBusy(true);
    setError('');
    try {
      await api(`/warehouse/articles/${a.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ active: !a.active }),
      });
      if (editingId === a.id && a.active) {
        // deaktiviert während Bearbeitung – Formular zurücksetzen
        cancelEdit();
      }
      await load();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function printLabel(a: Article, format: 'a6' | 'a4') {
    setError('');
    setMessage('');
    try {
      const res = await fetch(`${API_URL}/warehouse/articles/${a.id}/label?format=${format}`, {
        headers: { Authorization: `Bearer ${getToken()}` },
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ message: res.statusText }));
        throw new Error(err.message || `Fehler ${res.status}`);
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      window.open(url, '_blank', 'noopener,noreferrer');
      setMessage(`Etikett ${format.toUpperCase()} geöffnet – bitte im Dialog drucken.`);
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
    } catch (err: any) {
      setError(err.message || 'Labeldruck fehlgeschlagen');
    }
  }

  return (
    <AppShell title="Lagerartikel" eyebrow="Lagerverwaltung">
      <p className="muted" style={{ marginTop: 0 }}>
        Artikel je Lagerkunde mit vordefinierter Palettengröße. Für EWP/Sondermaß Typ{' '}
        <strong>Individuell / EWP</strong> und eigene Stellplätze setzen. Labeldruck:{' '}
        <strong>A6</strong> (Etikettendrucker) oder <strong>A4</strong> (Blatt).
      </p>

      <div className="row" style={{ gap: '0.75rem', flexWrap: 'wrap', marginBottom: '1rem' }}>
        <Link className="btn btn-ghost" href="/lager/uebersicht">
          Übersicht
        </Link>
        <Link className="btn btn-primary" href="/lager/einlagern">
          Einlagern
        </Link>
        <Link className="btn btn-ghost" href="/customers">
          Kunden
        </Link>
      </div>

      {error ? <p className="error">{error}</p> : null}
      {message ? <p className="ok">{message}</p> : null}

      <form className="panel stack" onSubmit={onSubmit} style={{ marginBottom: '1rem', maxWidth: 720 }}>
        <strong>{editingId ? 'Artikel bearbeiten' : 'Artikel anlegen'}</strong>
        <div className="field">
          <label>Lagerkunde</label>
          <select
            required
            disabled={!!editingId}
            value={form.customerId}
            onChange={(e) => setForm((f) => ({ ...f, customerId: e.target.value }))}
          >
            <option value="">– wählen –</option>
            {customers.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name} ({c.customerNumber})
              </option>
            ))}
          </select>
          {editingId ? (
            <span className="muted" style={{ fontSize: '0.85rem' }}>
              Kunde kann beim Bearbeiten nicht gewechselt werden.
            </span>
          ) : null}
        </div>
        <div className="row" style={{ gap: '0.75rem', flexWrap: 'wrap' }}>
          <div className="field" style={{ flex: 1, minWidth: 160 }}>
            <label>Artikel-Nr. (optional)</label>
            <input
              value={form.articleNumber}
              onChange={(e) => setForm((f) => ({ ...f, articleNumber: e.target.value }))}
              placeholder="z. B. ART-1001"
            />
          </div>
          <div className="field" style={{ flex: 2, minWidth: 200 }}>
            <label>Bezeichnung</label>
            <input
              required
              value={form.name}
              onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
              placeholder="Artikelname"
            />
          </div>
        </div>
        <div className="row" style={{ gap: '0.75rem', flexWrap: 'wrap' }}>
          <div className="field" style={{ flex: 2, minWidth: 180 }}>
            <label>Palettentyp</label>
            <select value={form.palletType} onChange={(e) => onPalletChange(e.target.value)}>
              {(meta?.palletTypes || []).map((p) => (
                <option key={p.code} value={p.code}>
                  {p.label} (Default {p.defaultSlotUnits})
                </option>
              ))}
            </select>
          </div>
          <div className="field" style={{ flex: 1, minWidth: 120 }}>
            <label>Stellplätze</label>
            <input
              type="number"
              min={0.1}
              step={0.1}
              required
              value={form.slotUnits}
              onChange={(e) => setForm((f) => ({ ...f, slotUnits: e.target.value }))}
              title="Individuelle Stellplatz-Einheiten"
            />
          </div>
        </div>
        <div className="field">
          <label>Notiz (optional)</label>
          <input
            value={form.notes}
            onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
          />
        </div>
        <div className="row" style={{ gap: '0.5rem', flexWrap: 'wrap' }}>
          <button className="btn btn-primary" type="submit" disabled={busy || !form.customerId}>
            {busy ? 'Speichern…' : editingId ? 'Änderungen speichern' : 'Artikel speichern'}
          </button>
          {editingId ? (
            <button className="btn btn-ghost" type="button" disabled={busy} onClick={cancelEdit}>
              Abbrechen
            </button>
          ) : null}
        </div>
      </form>

      <div className="row" style={{ gap: '0.5rem', marginBottom: '0.75rem', flexWrap: 'wrap' }}>
        <select
          value={filterCustomerId}
          onChange={(e) => setFilterCustomerId(e.target.value)}
          style={{ minWidth: 220 }}
        >
          <option value="">Alle Lagerkunden</option>
          {customers.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
        <label className="row" style={{ gap: 6, alignItems: 'center', margin: 0 }}>
          <input
            type="checkbox"
            checked={showInactive}
            onChange={(e) => setShowInactive(e.target.checked)}
          />
          Inaktive anzeigen
        </label>
      </div>

      <div className="panel" style={{ overflowX: 'auto' }}>
        <table className="table">
          <thead>
            <tr>
              <th>Kunde</th>
              <th>Nr.</th>
              <th>Artikel</th>
              <th>Palette</th>
              <th>Stellplätze</th>
              <th>Status</th>
              <th>Label</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {articles.map((a) => (
              <tr
                key={a.id}
                style={{
                  opacity: a.active ? 1 : 0.55,
                  outline: editingId === a.id ? '2px solid var(--accent, #1a6b3c)' : undefined,
                }}
              >
                <td>{a.customer.name}</td>
                <td className="muted">{a.articleNumber || '–'}</td>
                <td>
                  <strong>{a.name}</strong>
                  {a.notes ? (
                    <div className="muted" style={{ fontSize: '0.8rem' }}>
                      {a.notes}
                    </div>
                  ) : null}
                </td>
                <td>{palletLabel[a.palletType] || a.palletType}</td>
                <td>{a.slotUnits}</td>
                <td>{a.active ? 'aktiv' : 'inaktiv'}</td>
                <td>
                  <div className="row" style={{ gap: 4, flexWrap: 'wrap' }}>
                    <button
                      className="btn btn-secondary"
                      type="button"
                      title="Etikett A6 (105×148 mm)"
                      onClick={() => printLabel(a, 'a6')}
                    >
                      A6
                    </button>
                    <button
                      className="btn btn-ghost"
                      type="button"
                      title="Etikett auf A4-Blatt"
                      onClick={() => printLabel(a, 'a4')}
                    >
                      A4
                    </button>
                  </div>
                </td>
                <td>
                  <div className="row" style={{ gap: 4, flexWrap: 'wrap' }}>
                    <button
                      className="btn btn-secondary"
                      type="button"
                      disabled={busy}
                      onClick={() => startEdit(a)}
                    >
                      Bearbeiten
                    </button>
                    <button
                      className="btn btn-ghost"
                      type="button"
                      disabled={busy}
                      onClick={() => toggleActive(a)}
                    >
                      {a.active ? 'Deaktivieren' : 'Aktivieren'}
                    </button>
                  </div>
                </td>
              </tr>
            ))}
            {!articles.length ? (
              <tr>
                <td colSpan={8} className="muted">
                  Noch keine Artikel – oben anlegen.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </AppShell>
  );
}
