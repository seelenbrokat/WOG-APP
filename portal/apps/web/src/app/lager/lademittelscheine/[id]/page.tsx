'use client';

import { FormEvent, useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { AppShell } from '@/components/AppShell';
import { SignaturePad } from '@/components/SignaturePad';
import { api, getToken } from '@/lib/api';

type Schein = {
  id: string;
  number: string;
  status: string;
  companyEntity: string;
  tourNumber?: string | null;
  partnerName?: string | null;
  partnerEmail?: string | null;
  vehiclePlate?: string | null;
  driverName?: string | null;
  reference?: string | null;
  locationText?: string | null;
  eupOut: number;
  rahmenOut: number;
  deckelOut: number;
  gitterboxOut: number;
  otherOut?: string | null;
  eupIn: number;
  rahmenIn: number;
  deckelIn: number;
  gitterboxIn: number;
  otherIn?: string | null;
  noExchangeNoStock: boolean;
  noExchangeDriverRefuse: boolean;
  documentId?: string | null;
};

function Stepper({
  label,
  value,
  onChange,
}: {
  label: string;
  value: number;
  onChange: (n: number) => void;
}) {
  return (
    <div className="lms-stepper">
      <span>{label}</span>
      <div className="lms-stepper-controls">
        <button type="button" onClick={() => onChange(Math.max(0, value - 1))}>
          −
        </button>
        <input
          type="number"
          min={0}
          value={value}
          onChange={(e) => onChange(Math.max(0, Number(e.target.value) || 0))}
        />
        <button type="button" onClick={() => onChange(value + 1)}>
          +
        </button>
      </div>
    </div>
  );
}

export default function LademittelscheinDetailPage() {
  const params = useParams<{ id: string }>();
  const id = params.id;
  const [row, setRow] = useState<Schein | null>(null);
  const [error, setError] = useState('');
  const [info, setInfo] = useState('');
  const [busy, setBusy] = useState(false);
  const [wogSig, setWogSig] = useState<string | null>(null);
  const [partnerSig, setPartnerSig] = useState<string | null>(null);
  const [wogName, setWogName] = useState('');
  const [partnerName, setPartnerName] = useState('');
  const [form, setForm] = useState({
    companyEntity: 'AG',
    eupOut: 0,
    rahmenOut: 0,
    deckelOut: 0,
    gitterboxOut: 0,
    otherOut: '',
    eupIn: 0,
    rahmenIn: 0,
    deckelIn: 0,
    gitterboxIn: 0,
    otherIn: '',
    noExchangeNoStock: false,
    noExchangeDriverRefuse: false,
    partnerEmail: '',
    partnerName: '',
    vehiclePlate: '',
    driverName: '',
    reference: '',
    locationText: '',
  });

  async function load() {
    const data = await api<Schein>(`/lager/lademittelscheine/${id}`);
    setRow(data);
    setForm({
      companyEntity: data.companyEntity || 'AG',
      eupOut: data.eupOut || 0,
      rahmenOut: data.rahmenOut || 0,
      deckelOut: data.deckelOut || 0,
      gitterboxOut: data.gitterboxOut || 0,
      otherOut: data.otherOut || '',
      eupIn: data.eupIn || 0,
      rahmenIn: data.rahmenIn || 0,
      deckelIn: data.deckelIn || 0,
      gitterboxIn: data.gitterboxIn || 0,
      otherIn: data.otherIn || '',
      noExchangeNoStock: !!data.noExchangeNoStock,
      noExchangeDriverRefuse: !!data.noExchangeDriverRefuse,
      partnerEmail: data.partnerEmail || '',
      partnerName: data.partnerName || '',
      vehiclePlate: data.vehiclePlate || '',
      driverName: data.driverName || '',
      reference: data.reference || '',
      locationText: data.locationText || '',
    });
    setPartnerName(data.partnerName || '');
  }

  useEffect(() => {
    load().catch((e: any) => setError(e?.message || 'Laden fehlgeschlagen'));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  async function openPdf() {
    const res = await fetch(`${process.env.NEXT_PUBLIC_API_URL || '/api'}/lager/lademittelscheine/${id}/pdf`, {
      headers: { Authorization: `Bearer ${getToken()}` },
    });
    if (!res.ok) throw new Error('PDF nicht verfügbar');
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    window.open(url, '_blank');
  }

  async function onComplete(e: FormEvent) {
    e.preventDefault();
    if (!wogSig || !partnerSig) {
      setError('Beide Unterschriften sind erforderlich');
      return;
    }
    setBusy(true);
    setError('');
    setInfo('');
    try {
      await api(`/lager/lademittelscheine/${id}/complete`, {
        method: 'POST',
        body: JSON.stringify({
          ...form,
          wogSignedByName: wogName || 'WOG Lager',
          partnerSignedByName: partnerName || form.partnerName || 'Partner',
          wogSignatureDataUrl: wogSig,
          partnerSignatureDataUrl: partnerSig,
          sendEmail: true,
        }),
      });
      setInfo('Schein abgeschlossen · PDF erzeugt · Mail an Partner (falls E-Mail hinterlegt)');
      await load();
      await openPdf();
    } catch (err: any) {
      setError(err?.message || 'Abschließen fehlgeschlagen');
    } finally {
      setBusy(false);
    }
  }

  if (!row) {
    return (
      <AppShell title="Lademittelschein" eyebrow="Lager">
        {error ? <div className="error">{error}</div> : <p className="muted">Laden…</p>}
      </AppShell>
    );
  }

  const readonly = row.status !== 'DRAFT';

  return (
    <AppShell title={`Lademittelschein ${row.number}`} eyebrow="Lager · Tablet">
      <div className="row" style={{ marginBottom: '0.75rem', gap: '0.5rem', flexWrap: 'wrap' }}>
        <Link href="/lager/lademittelscheine">← Übersicht</Link>
        {readonly ? (
          <button type="button" className="btn btn-secondary" onClick={() => void openPdf()}>
            PDF / Drucken
          </button>
        ) : null}
      </div>

      {error && <div className="error">{error}</div>}
      {info && <div className="success">{info}</div>}

      <form className="lager-tablet stack" onSubmit={onComplete}>
        <div className="panel stack">
          <strong>Kopfdaten</strong>
          <div className="lms-entity">
            <label>
              <input
                type="radio"
                name="entity"
                checked={form.companyEntity === 'GMBH'}
                disabled={readonly}
                onChange={() => setForm({ ...form, companyEntity: 'GMBH' })}
              />
              WOG Logistics GmbH, Hohenems
            </label>
            <label>
              <input
                type="radio"
                name="entity"
                checked={form.companyEntity === 'AG'}
                disabled={readonly}
                onChange={() => setForm({ ...form, companyEntity: 'AG' })}
              />
              WOG Logistics AG, Diepoldsau
            </label>
          </div>
          <div className="grid-2">
            <div className="field">
              <label>Firma / Partner</label>
              <input
                value={form.partnerName}
                disabled={readonly}
                onChange={(e) => setForm({ ...form, partnerName: e.target.value })}
              />
            </div>
            <div className="field">
              <label>Partner-E-Mail</label>
              <input
                type="email"
                value={form.partnerEmail}
                disabled={readonly}
                onChange={(e) => setForm({ ...form, partnerEmail: e.target.value })}
                placeholder="für Versand nach Abschluss"
              />
            </div>
            <div className="field">
              <label>LKW Nr.</label>
              <input
                value={form.vehiclePlate}
                disabled={readonly}
                onChange={(e) => setForm({ ...form, vehiclePlate: e.target.value })}
              />
            </div>
            <div className="field">
              <label>Fahrer</label>
              <input
                value={form.driverName}
                disabled={readonly}
                onChange={(e) => setForm({ ...form, driverName: e.target.value })}
              />
            </div>
            <div className="field">
              <label>Referenz / Tour</label>
              <input
                value={form.reference || row.tourNumber || ''}
                disabled={readonly}
                onChange={(e) => setForm({ ...form, reference: e.target.value })}
              />
            </div>
            <div className="field">
              <label>Ort</label>
              <input
                value={form.locationText}
                disabled={readonly}
                onChange={(e) => setForm({ ...form, locationText: e.target.value })}
              />
            </div>
          </div>
          <label className="row">
            <input
              type="checkbox"
              checked={form.noExchangeNoStock}
              disabled={readonly}
              onChange={(e) => setForm({ ...form, noExchangeNoStock: e.target.checked })}
            />
            Keine Lademittel zum Tausch vorhanden
          </label>
          <label className="row">
            <input
              type="checkbox"
              checked={form.noExchangeDriverRefuse}
              disabled={readonly}
              onChange={(e) => setForm({ ...form, noExchangeDriverRefuse: e.target.checked })}
            />
            Fahrer wollte nicht tauschen
          </label>
        </div>

        <div className="panel">
          <strong>WOG übergibt Ihnen</strong>
          <div className="lms-grid">
            <Stepper label="Euro-Paletten" value={form.eupOut} onChange={(n) => !readonly && setForm({ ...form, eupOut: n })} />
            <Stepper label="Rahmen" value={form.rahmenOut} onChange={(n) => !readonly && setForm({ ...form, rahmenOut: n })} />
            <Stepper label="Deckel" value={form.deckelOut} onChange={(n) => !readonly && setForm({ ...form, deckelOut: n })} />
            <Stepper label="Gitterboxen" value={form.gitterboxOut} onChange={(n) => !readonly && setForm({ ...form, gitterboxOut: n })} />
          </div>
        </div>

        <div className="panel">
          <strong>WOG übernimmt von Ihnen</strong>
          <div className="lms-grid">
            <Stepper label="Euro-Paletten" value={form.eupIn} onChange={(n) => !readonly && setForm({ ...form, eupIn: n })} />
            <Stepper label="Rahmen" value={form.rahmenIn} onChange={(n) => !readonly && setForm({ ...form, rahmenIn: n })} />
            <Stepper label="Deckel" value={form.deckelIn} onChange={(n) => !readonly && setForm({ ...form, deckelIn: n })} />
            <Stepper label="Gitterboxen" value={form.gitterboxIn} onChange={(n) => !readonly && setForm({ ...form, gitterboxIn: n })} />
          </div>
        </div>

        {!readonly && (
          <div className="panel stack">
            <strong>Unterschriften</strong>
            <div className="grid-2">
              <div className="field">
                <label>Name WOG Lager</label>
                <input value={wogName} onChange={(e) => setWogName(e.target.value)} placeholder="z. B. Daniel" />
              </div>
              <div className="field">
                <label>Name Partner / Fahrer</label>
                <input value={partnerName} onChange={(e) => setPartnerName(e.target.value)} />
              </div>
            </div>
            <div className="lms-sigs">
              <SignaturePad label="Unterschrift WOG" onChange={setWogSig} />
              <SignaturePad label="Unterschrift Partner / Fahrer" onChange={setPartnerSig} />
            </div>
            <button className="btn btn-primary" type="submit" disabled={busy} style={{ minHeight: '3.2rem', fontSize: '1.05rem' }}>
              {busy ? 'Speichern…' : 'Abschließen · PDF · Mail an Partner'}
            </button>
          </div>
        )}
      </form>
    </AppShell>
  );
}
