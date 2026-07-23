'use client';

import { useMemo, useState } from 'react';

export type BookAddress = {
  id: string;
  label?: string | null;
  company?: string | null;
  street: string;
  zip: string;
  city: string;
  country: string;
  usage: string;
};

function addressHaystack(a: BookAddress) {
  return [a.label, a.company, a.street, a.zip, a.city, a.country]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
}

function addressTitle(a: BookAddress) {
  return a.label || a.company || a.street;
}

function addressMeta(a: BookAddress) {
  return `${a.street}, ${a.zip} ${a.city} (${a.country})`;
}

type Props = {
  addresses: BookAddress[];
  selectedId: string;
  onSelect: (addressId: string) => void;
  emptyHint?: string;
};

/** Durchsuchbare Adressbuch-Auswahl für Auftragserfassung. */
export function AddressBookPicker({
  addresses,
  selectedId,
  onSelect,
  emptyHint = 'Keine Adressen im Adressbuch.',
}: Props) {
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return addresses.slice(0, 40);
    return addresses.filter((a) => addressHaystack(a).includes(q)).slice(0, 40);
  }, [addresses, query]);

  const selected = addresses.find((a) => a.id === selectedId);

  return (
    <div className="stack" style={{ gap: '0.35rem', position: 'relative' }}>
      <label className="muted" style={{ fontSize: '0.8rem', margin: 0 }}>
        Aus Adressbuch
      </label>
      {selected ? (
        <div
          className="row"
          style={{
            gap: '0.5rem',
            alignItems: 'flex-start',
            justifyContent: 'space-between',
            padding: '0.45rem 0.55rem',
            border: '1px solid var(--border, #ddd)',
            borderRadius: 6,
            background: 'var(--surface-2, #f7f7f5)',
          }}
        >
          <div style={{ minWidth: 0 }}>
            <div style={{ fontWeight: 600, fontSize: '0.9rem' }}>{addressTitle(selected)}</div>
            <div className="muted" style={{ fontSize: '0.8rem' }}>
              {addressMeta(selected)}
            </div>
          </div>
          <button
            type="button"
            className="btn btn-ghost"
            style={{ flexShrink: 0 }}
            onClick={() => {
              onSelect('');
              setQuery('');
              setOpen(false);
            }}
          >
            Entfernen
          </button>
        </div>
      ) : null}
      <input
        type="search"
        placeholder="Suchen: Firma, Straße, PLZ, Ort…"
        value={query}
        onChange={(e) => {
          setQuery(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        autoComplete="off"
      />
      {open ? (
        <div
          style={{
            maxHeight: 220,
            overflowY: 'auto',
            border: '1px solid var(--border, #ddd)',
            borderRadius: 6,
            background: 'var(--surface, #fff)',
          }}
        >
          {!addresses.length ? (
            <p className="muted" style={{ margin: '0.6rem', fontSize: '0.85rem' }}>
              {emptyHint}
            </p>
          ) : filtered.length === 0 ? (
            <p className="muted" style={{ margin: '0.6rem', fontSize: '0.85rem' }}>
              Keine Treffer für „{query.trim()}“.
            </p>
          ) : (
            filtered.map((a) => (
              <button
                key={a.id}
                type="button"
                className="btn btn-ghost"
                style={{
                  display: 'block',
                  width: '100%',
                  textAlign: 'left',
                  borderRadius: 0,
                  borderBottom: '1px solid var(--border, #eee)',
                  padding: '0.5rem 0.65rem',
                }}
                onClick={() => {
                  onSelect(a.id);
                  setQuery('');
                  setOpen(false);
                }}
              >
                <div style={{ fontWeight: 600, fontSize: '0.9rem' }}>{addressTitle(a)}</div>
                <div className="muted" style={{ fontSize: '0.8rem' }}>
                  {addressMeta(a)}
                </div>
              </button>
            ))
          )}
        </div>
      ) : null}
      {!open && !selected ? (
        <button
          type="button"
          className="btn btn-ghost"
          style={{ alignSelf: 'flex-start', fontSize: '0.85rem' }}
          onClick={() => setOpen(true)}
        >
          Adressbuch öffnen ({addresses.length})
        </button>
      ) : null}
    </div>
  );
}

type SuggestProps = {
  addresses: BookAddress[];
  company: string;
  street: string;
  zip: string;
  city: string;
  onPick: (addressId: string) => void;
  excludeId?: string;
};

/** Vorschläge während der Eingabe (Firma/Straße/Ort). */
export function AddressTypingSuggestions({
  addresses,
  company,
  street,
  zip,
  city,
  onPick,
  excludeId,
}: SuggestProps) {
  const needle = [company, street, zip, city].map((s) => s.trim()).filter(Boolean);
  if (needle.length === 0 || addresses.length === 0) return null;

  const q = needle.join(' ').toLowerCase();
  const tokens = needle.map((s) => s.toLowerCase()).filter((t) => t.length >= 2);
  if (tokens.length === 0) return null;

  const hits = addresses
    .filter((a) => a.id !== excludeId)
    .filter((a) => {
      const hay = addressHaystack(a);
      // mind. ein Token muss matchen; bei längerer Eingabe stärker filtern
      const matched = tokens.filter((t) => hay.includes(t)).length;
      if (tokens.length === 1) return matched >= 1;
      return matched >= Math.min(2, tokens.length) || hay.includes(q);
    })
    .slice(0, 5);

  if (!hits.length) return null;

  return (
    <div className="stack" style={{ gap: '0.25rem' }}>
      <span className="muted" style={{ fontSize: '0.8rem' }}>
        Vorschläge aus dem Adressbuch
      </span>
      {hits.map((a) => (
        <button
          key={a.id}
          type="button"
          className="btn btn-ghost"
          style={{ textAlign: 'left', justifyContent: 'flex-start' }}
          onClick={() => onPick(a.id)}
        >
          {addressTitle(a)} · {addressMeta(a)}
        </button>
      ))}
    </div>
  );
}
