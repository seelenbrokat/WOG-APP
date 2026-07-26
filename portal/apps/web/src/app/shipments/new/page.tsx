'use client';

import { FormEvent, Suspense, useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import {
  CH_LI_CUSTOMS_MANDANT_CODES,
  COUNTRIES,
  PACKAGING_TYPES,
  SHIPMENT_EXTRA_OPTIONS,
  isSwitzerlandOrLiechtenstein,
  isValidZipForCountry,
  type ShipmentExtras,
} from '@wog/shared';
import { AppShell } from '@/components/AppShell';
import {
  AddressBookPicker,
  AddressTypingSuggestions,
} from '@/components/AddressBookPicker';
import { api, getUser } from '@/lib/api';
import {
  combineDateTimeIso,
  defaultDeliveryWindow,
  defaultShipmentSchedule,
} from '@/lib/shipment-dates';

type AddressCheck = {
  status: 'idle' | 'loading' | 'VALID' | 'AMBIGUOUS' | 'INVALID' | 'FORMAT_ERROR';
  message?: string;
  suggestions?: Array<{
    street: string;
    zip: string;
    city: string;
    country: string;
    displayName: string;
  }>;
};

const idleCheck: AddressCheck = { status: 'idle' };

type TabId = 'allgemein' | 'zusatz';

const TABS: { id: TabId; label: string }[] = [
  { id: 'allgemein', label: 'Allgemein' },
  { id: 'zusatz', label: 'Zusatzinformationen' },
];

const EXTRA_GROUPS = Array.from(new Set(SHIPMENT_EXTRA_OPTIONS.map((o) => o.group)));

type Address = {
  id: string;
  label?: string | null;
  company?: string | null;
  street: string;
  zip: string;
  city: string;
  country: string;
  usage: string;
  isDefault?: boolean;
};

type Template = {
  id: string;
  name: string;
  mandantId?: string | null;
  reference?: string | null;
  transportMode?: string | null;
  goodsDescription?: string | null;
  packageCount: number;
  weightKg?: number | null;
  pickupCompany?: string | null;
  pickupStreet?: string | null;
  pickupZip?: string | null;
  pickupCity?: string | null;
  pickupCountry?: string | null;
  deliveryCompany?: string | null;
  deliveryStreet?: string | null;
  deliveryZip?: string | null;
  deliveryCity?: string | null;
  deliveryCountry?: string | null;
  notes?: string | null;
  pickupAddressId?: string | null;
  deliveryAddressId?: string | null;
};

type ColloDraft = {
  description: string;
  packaging: string;
  weightKg: string;
  lengthCm: string;
  widthCm: string;
  heightCm: string;
};

function emptyCollo(description = '', packaging = 'EUP'): ColloDraft {
  return { description, packaging, weightKg: '', lengthCm: '', widthCm: '', heightCm: '' };
}

/** n Colli aus Anzahl + Gesamtgewicht (z. B. 10 EUP / 2000 kg → 10×200 kg). */
function splitColli(opts: {
  count: number;
  packaging: string;
  totalWeightKg: number;
  description: string;
  lengthCm?: string;
  widthCm?: string;
  heightCm?: string;
}): ColloDraft[] {
  const n = Math.max(1, Math.floor(opts.count) || 1);
  const unit =
    opts.totalWeightKg > 0
      ? String(Math.round((opts.totalWeightKg / n) * 1000) / 1000)
      : '';
  return Array.from({ length: n }, () => ({
    description: opts.description,
    packaging: opts.packaging || 'EUP',
    weightKg: unit,
    lengthCm: opts.lengthCm || '',
    widthCm: opts.widthCm || '',
    heightCm: opts.heightCm || '',
  }));
}

type PackagingOption = { code: string; label: string };

type UploadDocType = 'INVOICE' | 'CUSTOMER_UPLOAD' | 'CMR' | 'OTHER';

type PendingDoc = {
  id: string;
  file: File;
  type: UploadDocType;
};

const DOC_TYPE_OPTIONS: { value: UploadDocType; label: string }[] = [
  { value: 'INVOICE', label: 'Rechnung' },
  { value: 'CMR', label: 'CMR / Frachtbrief' },
  { value: 'CUSTOMER_UPLOAD', label: 'Sonstiges Dokument' },
  { value: 'OTHER', label: 'Andere' },
];

function formatBytes(n: number) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

function NewShipmentInner() {
  const router = useRouter();
  const search = useSearchParams();
  const user = getUser();
  const [mandanten, setMandanten] = useState<any[]>([]);
  const [customers, setCustomers] = useState<any[]>([]);
  const [addresses, setAddresses] = useState<Address[]>([]);
  const [templates, setTemplates] = useState<Template[]>([]);
  const [packagingTypes, setPackagingTypes] = useState<PackagingOption[]>([...PACKAGING_TYPES]);
  const [error, setError] = useState('');
  const [tab, setTab] = useState<TabId>('allgemein');
  const [colli, setColli] = useState<ColloDraft[]>([emptyCollo()]);
  const [quick, setQuick] = useState({
    count: '1',
    packaging: 'EUP',
    totalWeightKg: '',
    lengthCm: '',
    widthCm: '',
    heightCm: '',
  });
  const [extras, setExtras] = useState<ShipmentExtras>({});
  const [pendingDocs, setPendingDocs] = useState<PendingDoc[]>([]);
  const [invoiceFile, setInvoiceFile] = useState<File | null>(null);
  const [form, setForm] = useState(() => {
    const schedule = defaultShipmentSchedule();
    return {
      mandantId: '',
      customerId: '',
      reference: '',
      transportMode: 'LKW',
      goodsDescription: '',
      packageCount: 1,
      weightKg: 0,
      pickupAddressId: '',
      deliveryAddressId: '',
      pickupCompany: '',
      pickupStreet: '',
      pickupZip: '',
      pickupCity: '',
      pickupCountry: 'AT',
      pickupDate: schedule.pickup.date,
      pickupTime: schedule.pickup.time,
      deliveryCompany: '',
      deliveryStreet: '',
      deliveryZip: '',
      deliveryCity: '',
      deliveryCountry: 'AT',
      deliveryDate: schedule.deliveryStart.date,
      deliveryTime: schedule.deliveryStart.time,
      deliveryDateEnd: schedule.deliveryEnd.date,
      deliveryTimeEnd: schedule.deliveryEnd.time,
      deliveryAvisPhone: '',
      pickupNotes: '',
      deliveryNotes: '',
      notes: '',
      submit: true,
      savePickupAddress: true,
      saveDeliveryAddress: true,
      saveAsTemplateName: '',
    };
  });
  const [pickupCheck, setPickupCheck] = useState<AddressCheck>(idleCheck);
  const [deliveryCheck, setDeliveryCheck] = useState<AddressCheck>(idleCheck);
  /** Nicht in OSM gefunden / Formatwarnung – trotzdem übernehmen (z. B. Baustelle). */
  const [pickupOverride, setPickupOverride] = useState(false);
  const [deliveryOverride, setDeliveryOverride] = useState(false);

  function toggleExtra(code: keyof ShipmentExtras, checked: boolean) {
    setExtras((prev) => {
      const next = { ...prev, [code]: checked };
      if (!checked && code === 'warenwertVersicherung') {
        delete next.goodsValueEur;
      }
      return next;
    });
    if (code === 'verzollung' && !checked) {
      setInvoiceFile(null);
    }
  }

  /** Mandant 2 für CH/LI-Verzollung: bevorzugt GMBH / Code „2“. */
  function resolveChLiCustomsMandantId(
    list: Array<{ id: string; code?: string; name?: string }>,
  ): string | undefined {
    if (!list.length) return undefined;
    for (const code of CH_LI_CUSTOMS_MANDANT_CODES) {
      const hit = list.find((m) => String(m.code || '').toUpperCase() === code);
      if (hit) return hit.id;
    }
    const byName = list.find((m) => /gmbh|\b2\b/i.test(String(m.name || '')));
    if (byName) return byName.id;
    return list.length >= 2 ? list[1].id : list[0].id;
  }

  /** Zustellung CH/FL: Belege (Verzollung + Begleitpapiere) und Mandant 2 vorauswählen. */
  function applyChLiBelegeDefaults(country: string, list = mandanten) {
    if (!isSwitzerlandOrLiechtenstein(country)) return;
    setExtras((prev) => ({
      ...prev,
      verzollung: true,
      begleitpapiere: true,
    }));
    const mid = resolveChLiCustomsMandantId(list);
    if (mid) {
      setForm((f) => (f.mandantId === mid ? f : { ...f, mandantId: mid }));
    }
  }

  const customerQuery =
    user?.role === 'CUSTOMER_USER'
      ? ''
      : form.customerId
        ? `?customerId=${form.customerId}`
        : '';

  function pickDefaultPickupAddress(list: Address[]): Address | undefined {
    return (
      list.find((a) => a.isDefault && a.usage !== 'DELIVERY') ||
      list.find((a) => a.usage === 'PICKUP' || a.usage === 'BOTH') ||
      list.find((a) => a.usage !== 'DELIVERY') ||
      list[0]
    );
  }

  function applyDefaultPickup(list: Address[], opts?: { force?: boolean }) {
    const def = pickDefaultPickupAddress(list);
    if (!def) return;
    setForm((f) => {
      const pickupEmpty =
        !String(f.pickupStreet || '').trim() &&
        !String(f.pickupZip || '').trim() &&
        !String(f.pickupCity || '').trim();
      if (!opts?.force && !pickupEmpty) return f;
      return {
        ...f,
        pickupAddressId: def.id,
        pickupCompany: def.company || '',
        pickupStreet: def.street,
        pickupZip: def.zip,
        pickupCity: def.city,
        pickupCountry: def.country || 'AT',
      };
    });
    setPickupCheck(idleCheck);
    setPickupOverride(false);
  }

  async function loadAddressBook(customerId?: string, opts?: { forcePickup?: boolean }) {
    const q =
      user?.role === 'CUSTOMER_USER'
        ? ''
        : customerId
          ? `?customerId=${customerId}`
          : '';
    if (user?.role !== 'CUSTOMER_USER' && !customerId) {
      setAddresses([]);
      setTemplates([]);
      return;
    }
    const [a, t] = await Promise.all([
      api<Address[]>(`/customers/me/addresses${q}`),
      api<Template[]>(`/customers/me/templates${q}`),
    ]);
    setAddresses(a);
    setTemplates(t);
    // Abholadresse = Kundenadresse (Standard / erste passende aus dem Adressbuch)
    applyDefaultPickup(a, { force: !!opts?.forcePickup });
  }

  useEffect(() => {
    const presetMandantId = search.get('mandantId') || '';
    const presetCustomerId = search.get('customerId') || '';
    api<any[]>('/mandanten').then((m) => {
      setMandanten(m);
      setForm((f) => ({
        ...f,
        mandantId: presetMandantId || f.mandantId || m[0]?.id || '',
        customerId: presetCustomerId || f.customerId,
      }));
    });
    api<PackagingOption[]>('/integrations/soloplan/packaging-types')
      .then((rows) => {
        if (rows?.length) {
          setPackagingTypes(rows.map((r) => ({ code: r.code, label: r.label || r.code })));
        }
      })
      .catch(() => {
        /* Fallback: PACKAGING_TYPES */
      });
    if (user?.role !== 'CUSTOMER_USER') {
      api<any[]>('/customers').then(setCustomers);
    } else {
      loadAddressBook(undefined, { forcePickup: true });
    }
  }, []);

  useEffect(() => {
    if (user?.role !== 'CUSTOMER_USER' && form.customerId) {
      // Bei Kundenwechsel Abholadresse auf dessen Adresse setzen
      loadAddressBook(form.customerId, { forcePickup: true });
    }
  }, [form.customerId]);

  useEffect(() => {
    applyChLiBelegeDefaults(form.deliveryCountry, mandanten);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [form.deliveryCountry, mandanten]);

  function applyAddress(kind: 'pickup' | 'delivery', addressId: string) {
    const addr = addresses.find((a) => a.id === addressId);
    if (!addr) {
      if (kind === 'pickup') {
        setForm((f) => ({ ...f, pickupAddressId: '' }));
        setPickupOverride(false);
      } else {
        setForm((f) => ({ ...f, deliveryAddressId: '' }));
        setDeliveryOverride(false);
      }
      return;
    }
    if (kind === 'pickup') {
      setForm((f) => ({
        ...f,
        pickupAddressId: addr.id,
        pickupCompany: addr.company || '',
        pickupStreet: addr.street,
        pickupZip: addr.zip,
        pickupCity: addr.city,
        pickupCountry: addr.country || 'AT',
      }));
      setPickupCheck(idleCheck);
      setPickupOverride(false);
    } else {
      setForm((f) => ({
        ...f,
        deliveryAddressId: addr.id,
        deliveryCompany: addr.company || '',
        deliveryStreet: addr.street,
        deliveryZip: addr.zip,
        deliveryCity: addr.city,
        deliveryCountry: addr.country || 'AT',
      }));
      setDeliveryCheck(idleCheck);
      setDeliveryOverride(false);
    }
  }

  async function validateAddress(kind: 'pickup' | 'delivery') {
    const street = kind === 'pickup' ? form.pickupStreet : form.deliveryStreet;
    const zip = kind === 'pickup' ? form.pickupZip : form.deliveryZip;
    const city = kind === 'pickup' ? form.pickupCity : form.deliveryCity;
    const country = kind === 'pickup' ? form.pickupCountry : form.deliveryCountry;
    const company = kind === 'pickup' ? form.pickupCompany : form.deliveryCompany;
    const setCheck = kind === 'pickup' ? setPickupCheck : setDeliveryCheck;

    if (!street.trim() || !zip.trim() || !city.trim() || !country.trim()) {
      setCheck({
        status: 'FORMAT_ERROR',
        message: 'Bitte Straße, PLZ, Ort und Land ausfüllen.',
      });
      return;
    }
    if (!isValidZipForCountry(zip, country)) {
      setCheck({
        status: 'FORMAT_ERROR',
        message: `PLZ-Format für ${country} ungültig.`,
      });
      return;
    }

    setCheck({ status: 'loading', message: 'Adresse wird geprüft…' });
    if (kind === 'pickup') setPickupOverride(false);
    else setDeliveryOverride(false);
    try {
      const res = await api<{
        ok: boolean;
        status: AddressCheck['status'];
        message: string;
        suggestions?: AddressCheck['suggestions'];
      }>('/shipments/validate-address', {
        method: 'POST',
        body: JSON.stringify({ street, zip, city, country, company }),
      });
      setCheck({
        status: res.status || (res.ok ? 'VALID' : 'INVALID'),
        message: res.message,
        suggestions: res.suggestions || [],
      });
    } catch (err: any) {
      setCheck({ status: 'INVALID', message: err.message || 'Prüfung fehlgeschlagen' });
    }
  }

  function applySuggestion(
    kind: 'pickup' | 'delivery',
    s: { street: string; zip: string; city: string; country: string },
  ) {
    if (kind === 'pickup') {
      setForm((f) => ({
        ...f,
        pickupAddressId: '',
        pickupStreet: s.street,
        pickupZip: s.zip,
        pickupCity: s.city,
        pickupCountry: s.country || f.pickupCountry,
      }));
      setPickupCheck({ status: 'VALID', message: 'Vorschlag übernommen.' });
    } else {
      setForm((f) => ({
        ...f,
        deliveryAddressId: '',
        deliveryStreet: s.street,
        deliveryZip: s.zip,
        deliveryCity: s.city,
        deliveryCountry: s.country || f.deliveryCountry,
      }));
      setDeliveryCheck({ status: 'VALID', message: 'Vorschlag übernommen.' });
    }
  }

  function applyTemplate(templateId: string) {
    const t = templates.find((x) => x.id === templateId);
    if (!t) return;
    const count = Math.max(1, t.packageCount || 1);
    setForm((f) => ({
      ...f,
      mandantId: t.mandantId || f.mandantId,
      reference: t.reference || '',
      transportMode: t.transportMode || 'LKW',
      goodsDescription: t.goodsDescription || '',
      packageCount: count,
      weightKg: t.weightKg || 0,
      pickupAddressId: t.pickupAddressId || '',
      deliveryAddressId: t.deliveryAddressId || '',
      pickupCompany: t.pickupCompany || '',
      pickupStreet: t.pickupStreet || '',
      pickupZip: t.pickupZip || '',
      pickupCity: t.pickupCity || '',
      pickupCountry: t.pickupCountry || 'AT',
      deliveryCompany: t.deliveryCompany || '',
      deliveryStreet: t.deliveryStreet || '',
      deliveryZip: t.deliveryZip || '',
      deliveryCity: t.deliveryCity || '',
      deliveryCountry: t.deliveryCountry || 'AT',
      notes: t.notes || '',
    }));
    setPickupCheck(idleCheck);
    setDeliveryCheck(idleCheck);
    const next = splitColli({
      count,
      packaging: quick.packaging,
      totalWeightKg: Number(t.weightKg) || 0,
      description: t.goodsDescription || '',
    });
    setColli(next);
    setQuick((q) => ({
      ...q,
      count: String(count),
      totalWeightKg: t.weightKg ? String(t.weightKg) : '',
    }));
  }

  function updateCollo(index: number, patch: Partial<ColloDraft>) {
    setColli((rows) => rows.map((row, i) => (i === index ? { ...row, ...patch } : row)));
  }

  function applyQuickSplit() {
    const count = Math.max(1, Number(quick.count) || 1);
    const totalWeightKg = Number(quick.totalWeightKg) || 0;
    const next = splitColli({
      count,
      packaging: quick.packaging,
      totalWeightKg,
      description: form.goodsDescription,
      lengthCm: quick.lengthCm,
      widthCm: quick.widthCm,
      heightCm: quick.heightCm,
    });
    setColli(next);
    setForm((f) => ({ ...f, packageCount: count, weightKg: totalWeightKg }));
  }

  function addCollo() {
    const last = colli[colli.length - 1];
    setColli((rows) => [
      ...rows,
      emptyCollo(form.goodsDescription, last?.packaging || quick.packaging || 'EUP'),
    ]);
    setForm((f) => ({ ...f, packageCount: f.packageCount + 1 }));
  }

  function removeCollo(index: number) {
    setColli((rows) => {
      if (rows.length <= 1) return rows;
      const next = rows.filter((_, i) => i !== index);
      setForm((f) => ({ ...f, packageCount: next.length }));
      return next;
    });
  }

  function addPendingDocs(files: FileList | null, defaultType: UploadDocType = 'CUSTOMER_UPLOAD') {
    if (!files?.length) return;
    const next: PendingDoc[] = Array.from(files).map((file) => ({
      id: `${Date.now()}-${file.name}-${Math.random().toString(36).slice(2, 7)}`,
      file,
      type: defaultType,
    }));
    setPendingDocs((prev) => [...prev, ...next]);
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError('');
    try {
      if (extras.verzollung && !invoiceFile) {
        throw new Error('Bei Verzollung muss eine Rechnung hochgeladen werden.');
      }
      if (!form.pickupCountry || !form.deliveryCountry) {
        setTab('allgemein');
        throw new Error('Bitte Land für Abholung und Zustellung wählen.');
      }
      if (!form.pickupStreet.trim() || !form.pickupZip.trim() || !form.pickupCity.trim()) {
        setTab('allgemein');
        throw new Error('Abholadresse unvollständig (Straße, PLZ, Ort, Land).');
      }
      if (!form.deliveryStreet.trim() || !form.deliveryZip.trim() || !form.deliveryCity.trim()) {
        setTab('allgemein');
        throw new Error('Zustelladresse unvollständig (Straße, PLZ, Ort, Land).');
      }
      if (!isValidZipForCountry(form.pickupZip, form.pickupCountry)) {
        setTab('allgemein');
        throw new Error(`Abholung: PLZ-Format für ${form.pickupCountry} ungültig.`);
      }
      if (!isValidZipForCountry(form.deliveryZip, form.deliveryCountry)) {
        setTab('allgemein');
        throw new Error(`Zustellung: PLZ-Format für ${form.deliveryCountry} ungültig.`);
      }
      if (
        (pickupCheck.status === 'INVALID' || pickupCheck.status === 'FORMAT_ERROR') &&
        !pickupOverride
      ) {
        setTab('allgemein');
        throw new Error(
          'Abholadresse prüfen oder „Adresse trotzdem verwenden“ wählen: ' +
            (pickupCheck.message || 'ungültig'),
        );
      }
      if (
        (deliveryCheck.status === 'INVALID' || deliveryCheck.status === 'FORMAT_ERROR') &&
        !deliveryOverride
      ) {
        setTab('allgemein');
        throw new Error(
          'Zustelladresse prüfen oder „Adresse trotzdem verwenden“ wählen: ' +
            (deliveryCheck.message || 'ungültig'),
        );
      }

      // Wenn nur Schnellfassung gesetzt und Colli leer/unbearbeitet: vor Submit aufteilen
      let rows = colli;
      const quickCount = Math.max(1, Number(quick.count) || 1);
      const quickTotal = Number(quick.totalWeightKg) || 0;
      const untouched =
        rows.length === 1 &&
        !rows[0].weightKg &&
        !rows[0].description &&
        quickCount > 1 &&
        quickTotal > 0;
      if (untouched) {
        rows = splitColli({
          count: quickCount,
          packaging: quick.packaging,
          totalWeightKg: quickTotal,
          description: form.goodsDescription,
          lengthCm: quick.lengthCm,
          widthCm: quick.widthCm,
          heightCm: quick.heightCm,
        });
        setColli(rows);
      }

      const positions = rows.map((c) => {
        const weightKg = Number(c.weightKg);
        const lengthCm = Number(c.lengthCm);
        const widthCm = Number(c.widthCm);
        const heightCm = Number(c.heightCm);
        return {
          description: c.description.trim() || form.goodsDescription || c.packaging || 'Collo',
          quantity: 1,
          packaging: c.packaging || undefined,
          weightKg: Number.isFinite(weightKg) && weightKg > 0 ? weightKg : undefined,
          lengthCm: Number.isFinite(lengthCm) && lengthCm > 0 ? lengthCm : undefined,
          widthCm: Number.isFinite(widthCm) && widthCm > 0 ? widthCm : undefined,
          heightCm: Number.isFinite(heightCm) && heightCm > 0 ? heightCm : undefined,
        };
      });
      const totalWeight = positions.reduce((sum, p) => sum + (p.weightKg || 0), 0);
      const volumeM3 = positions.reduce((sum, p) => {
        if (!p.lengthCm || !p.widthCm || !p.heightCm) return sum;
        return sum + (p.lengthCm * p.widthCm * p.heightCm) / 1_000_000;
      }, 0);
      const goodsDescription =
        form.goodsDescription.trim() ||
        positions.map((p) => p.description).filter(Boolean).join('; ') ||
        undefined;

      const extrasPayload: ShipmentExtras = { ...extras };
      if (extrasPayload.warenwertVersicherung && extras.goodsValueEur != null) {
        extrasPayload.goodsValueEur = Number(extras.goodsValueEur) || undefined;
      }
      if (form.notes.trim()) {
        extrasPayload.extrasNote = form.notes.trim();
      }
      if (form.pickupNotes.trim()) extrasPayload.pickupNote = form.pickupNotes.trim();
      if (form.deliveryNotes.trim()) extrasPayload.deliveryNote = form.deliveryNotes.trim();
      // leere Flags entfernen
      Object.keys(extrasPayload).forEach((k) => {
        const key = k as keyof ShipmentExtras;
        if (extrasPayload[key] === false || extrasPayload[key] === '' || extrasPayload[key] == null) {
          delete extrasPayload[key];
        }
      });

      const {
        pickupNotes: _pickupNotes,
        deliveryNotes: _deliveryNotes,
        pickupTime: _pickupTime,
        deliveryTime: _deliveryTime,
        deliveryTimeEnd: _deliveryTimeEnd,
        ...formFields
      } = form;

      if (!form.pickupDate || !form.deliveryDate) {
        throw new Error('Bitte Abhol- und Zustelldatum angeben.');
      }

      const created = await api<any>('/shipments', {
        method: 'POST',
        body: JSON.stringify({
          ...formFields,
          customerId: form.customerId || undefined,
          pickupAddressId: form.pickupAddressId || undefined,
          deliveryAddressId: form.deliveryAddressId || undefined,
          pickupDate: combineDateTimeIso(form.pickupDate, form.pickupTime || '00:00'),
          deliveryDate: combineDateTimeIso(form.deliveryDate, form.deliveryTime || '00:00'),
          deliveryDateEnd: form.deliveryDateEnd
            ? combineDateTimeIso(form.deliveryDateEnd, form.deliveryTimeEnd || '00:00')
            : combineDateTimeIso(form.deliveryDate, form.deliveryTime || '00:00'),
          deliveryAvisPhone: form.deliveryAvisPhone.trim() || undefined,
          packageCount: positions.length,
          weightKg: totalWeight || Number(form.weightKg) || undefined,
          volumeM3: volumeM3 > 0 ? Math.round(volumeM3 * 1000) / 1000 : undefined,
          goodsDescription,
          notes: form.notes.trim() || undefined,
          extras: Object.keys(extrasPayload).length ? extrasPayload : undefined,
          saveAsTemplateName: form.saveAsTemplateName || undefined,
          savePickupAddress: form.savePickupAddress !== false,
          saveDeliveryAddress: form.saveDeliveryAddress !== false,
          positions,
        }),
      });

      // Dokumente nach Create hochladen (Rechnung zuerst bei Verzollung)
      const uploads: Array<{ file: File; type: UploadDocType }> = [];
      if (invoiceFile) uploads.push({ file: invoiceFile, type: 'INVOICE' });
      for (const d of pendingDocs) {
        // Rechnung nicht doppelt, wenn separat gewählt
        if (invoiceFile && d.file === invoiceFile) continue;
        if (invoiceFile && d.type === 'INVOICE' && d.file.name === invoiceFile.name) continue;
        uploads.push({ file: d.file, type: d.type });
      }
      for (const u of uploads) {
        const fd = new FormData();
        fd.append('file', u.file);
        await api(`/documents/upload?shipmentId=${created.id}&type=${u.type}`, {
          method: 'POST',
          body: fd,
        });
      }

      router.push(`/shipments/${created.id}?handover=1`);
    } catch (err: any) {
      setError(err.message);
      const msg = String(err.message || '').toLowerCase();
      // Papiere sind immer sichtbar; bei Adressfehlern zurück zu Allgemein
      if (
        !msg.includes('rechnung') &&
        !msg.includes('verzoll') &&
        !msg.includes('dokument')
      ) {
        setTab('allgemein');
      }
    }
  }

  const pickupAddresses = addresses.filter((a) => a.usage !== 'DELIVERY');
  const deliveryAddresses = addresses.filter((a) => a.usage !== 'PICKUP');

  return (
    <AppShell title="Neuer Auftrag">
      <form className="panel stack" onSubmit={onSubmit}>
        <div className="row" style={{ justifyContent: 'space-between' }}>
          <p className="muted" style={{ margin: 0 }}>
            Ein Auftrag = eine Sendung. Adressen und Vorlagen aus dem Adressbuch vorausfüllen.
            Begleitpapiere unten direkt in der Erfassung anhängen.
          </p>
          <Link href="/addresses">Adressbuch verwalten</Link>
        </div>

        <div className="tabs" role="tablist" aria-label="Auftragserfassung">
          {TABS.map((t) => (
            <button
              key={t.id}
              type="button"
              role="tab"
              aria-selected={tab === t.id}
              className={tab === t.id ? 'active' : ''}
              onClick={() => setTab(t.id)}
            >
              {t.label}
            </button>
          ))}
        </div>

        {tab === 'allgemein' && (user?.role === 'CUSTOMER_USER' || form.customerId) && templates.length > 0 && (
          <div className="field">
            <label>Vorlage laden</label>
            <select defaultValue="" onChange={(e) => applyTemplate(e.target.value)}>
              <option value="">– Vorlage wählen –</option>
              {templates.map((t) => (
                <option key={t.id} value={t.id}>{t.name} ({t.pickupCity || '?'} → {t.deliveryCity || '?'})</option>
              ))}
            </select>
          </div>
        )}

        {tab === 'allgemein' && (
          <>
        <div className="grid-2">
            <div className="field">
              <label>Mandant</label>
              <select
                required
                value={form.mandantId}
                onChange={(e) => setForm({ ...form, mandantId: e.target.value })}
              >
                {mandanten.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.name}
                    {String(m.code || '').toUpperCase() === 'GMBH' ? ' (Mandant 2)' : ''}
                  </option>
                ))}
              </select>
              {isSwitzerlandOrLiechtenstein(form.deliveryCountry) ? (
                <p className="muted" style={{ margin: '0.35rem 0 0', fontSize: '0.85rem' }}>
                  Zustellung CH/LI: Verzollungsbelege und Mandant 2 (GmbH) automatisch vorausgewählt.
                </p>
              ) : null}
            </div>
          {user?.role !== 'CUSTOMER_USER' && (
            <div className="field">
              <label>Kunde</label>
              <select
                required
                value={form.customerId}
                onChange={(e) => setForm({ ...form, customerId: e.target.value })}
              >
                <option value="">Bitte wählen</option>
                {customers.map((c) => <option key={c.id} value={c.id}>{c.name} ({c.customerNumber})</option>)}
              </select>
            </div>
          )}
          <div className="field">
            <label>Referenz</label>
            <input value={form.reference} onChange={(e) => setForm({ ...form, reference: e.target.value })} />
          </div>
        </div>

        <div className="grid-2">
          <div className="stack">
            <strong>Abholung</strong>
            <AddressBookPicker
              addresses={pickupAddresses}
              selectedId={form.pickupAddressId}
              onSelect={(id) => applyAddress('pickup', id)}
              emptyHint="Noch keine Abholadressen gespeichert – nach dem ersten Auftrag erscheinen sie hier."
            />
            <input
              placeholder="Firma"
              value={form.pickupCompany}
              onChange={(e) => {
                setForm({ ...form, pickupCompany: e.target.value, pickupAddressId: '' });
                setPickupCheck(idleCheck);
                setPickupOverride(false);
              }}
            />
            <input
              required
              placeholder="Straße"
              value={form.pickupStreet}
              onChange={(e) => {
                setForm({ ...form, pickupStreet: e.target.value, pickupAddressId: '' });
                setPickupCheck(idleCheck);
                setPickupOverride(false);
              }}
            />
            <div className="row">
              <input
                required
                placeholder="PLZ"
                value={form.pickupZip}
                onChange={(e) => {
                  setForm({ ...form, pickupZip: e.target.value, pickupAddressId: '' });
                  setPickupCheck(idleCheck);
                  setPickupOverride(false);
                }}
              />
              <input
                required
                placeholder="Ort"
                value={form.pickupCity}
                onChange={(e) => {
                  setForm({ ...form, pickupCity: e.target.value, pickupAddressId: '' });
                  setPickupCheck(idleCheck);
                  setPickupOverride(false);
                }}
              />
            </div>
            <div className="field">
              <label>Land</label>
              <select
                required
                value={form.pickupCountry}
                onChange={(e) => {
                  setForm({ ...form, pickupCountry: e.target.value, pickupAddressId: '' });
                  setPickupCheck(idleCheck);
                  setPickupOverride(false);
                }}
              >
                {COUNTRIES.map((c) => (
                  <option key={c.code} value={c.code}>
                    {c.label} ({c.code})
                  </option>
                ))}
              </select>
            </div>
            <div className="row">
              <div className="field" style={{ flex: 1 }}>
                <label>Abholdatum</label>
                <input
                  required
                  type="date"
                  value={form.pickupDate}
                  onChange={(e) => {
                    const pickupDate = e.target.value;
                    const window = pickupDate
                      ? defaultDeliveryWindow(pickupDate)
                      : null;
                    setForm({
                      ...form,
                      pickupDate,
                      ...(window
                        ? {
                            deliveryDate: window.start.date,
                            deliveryTime: window.start.time,
                            deliveryDateEnd: window.end.date,
                            deliveryTimeEnd: window.end.time,
                          }
                        : {}),
                    });
                  }}
                />
              </div>
              <div className="field" style={{ flex: 1 }}>
                <label>Abholzeit</label>
                <input
                  required
                  type="time"
                  value={form.pickupTime}
                  onChange={(e) => setForm({ ...form, pickupTime: e.target.value })}
                />
              </div>
            </div>
            {!form.pickupAddressId ? (
              <AddressTypingSuggestions
                addresses={pickupAddresses}
                company={form.pickupCompany}
                onPick={(id) => applyAddress('pickup', id)}
              />
            ) : null}
            <div className="row" style={{ gap: '0.5rem', alignItems: 'center' }}>
              <button
                type="button"
                className="btn btn-secondary"
                disabled={pickupCheck.status === 'loading'}
                onClick={() => void validateAddress('pickup')}
              >
                {pickupCheck.status === 'loading' ? 'Prüfe…' : 'Adresse prüfen'}
              </button>
              {pickupCheck.status === 'VALID' && (
                <span style={{ color: 'var(--ok)', fontSize: '0.9rem' }}>✓ geprüft</span>
              )}
              {pickupOverride && (
                <span style={{ color: 'var(--warn, #b78103)', fontSize: '0.9rem' }}>
                  manuell übernommen
                </span>
              )}
            </div>
            {pickupCheck.message && pickupCheck.status !== 'idle' && pickupCheck.status !== 'loading' ? (
              <p
                className={
                  pickupCheck.status === 'VALID'
                    ? 'success'
                    : pickupCheck.status === 'AMBIGUOUS' || pickupOverride
                      ? 'muted'
                      : 'error'
                }
                style={{
                  margin: 0,
                  fontSize: '0.85rem',
                  color:
                    pickupCheck.status === 'VALID'
                      ? 'var(--ok, #2f9e62)'
                      : pickupCheck.status === 'AMBIGUOUS' || pickupOverride
                        ? 'var(--warn, #b78103)'
                        : undefined,
                }}
              >
                {pickupCheck.message}
              </p>
            ) : null}
            {pickupCheck.status === 'INVALID' || pickupCheck.status === 'FORMAT_ERROR' ? (
              <label className="row" style={{ alignItems: 'flex-start', gap: '0.5rem' }}>
                <input
                  type="checkbox"
                  checked={pickupOverride}
                  onChange={(e) => setPickupOverride(e.target.checked)}
                />
                <span style={{ fontSize: '0.85rem' }}>
                  Adresse trotzdem verwenden (z.&nbsp;B. neue Baustelle / nicht in Karte gefunden)
                </span>
              </label>
            ) : null}
            {pickupCheck.suggestions && pickupCheck.suggestions.length > 0 ? (
              <div className="stack" style={{ gap: '0.35rem' }}>
                {pickupCheck.suggestions.slice(0, 3).map((s, i) => (
                  <button
                    key={`${s.displayName}-${i}`}
                    type="button"
                    className="btn btn-ghost"
                    style={{ textAlign: 'left', justifyContent: 'flex-start' }}
                    onClick={() => {
                      applySuggestion('pickup', s);
                      setPickupOverride(false);
                    }}
                  >
                    Übernehmen: {s.street}, {s.zip} {s.city} ({s.country})
                  </button>
                ))}
              </div>
            ) : null}
            <div className="field">
              <label>Info Ladestelle</label>
              <textarea
                rows={2}
                value={form.pickupNotes}
                onChange={(e) => setForm({ ...form, pickupNotes: e.target.value })}
                placeholder="z. B. Tor 3, Öffnungszeiten, Ansprechpartner"
              />
            </div>
            <label className="row">
              <input type="checkbox" checked={form.savePickupAddress} onChange={(e) => setForm({ ...form, savePickupAddress: e.target.checked })} />
              Abholung im Adressbuch speichern
            </label>
            <p className="muted" style={{ margin: 0, fontSize: '0.8rem' }}>
              Beim Anlegen wird die Adresse automatisch gespeichert und steht künftig in der Suche.
            </p>
          </div>
          <div className="stack">
            <strong>Zustellung</strong>
            <AddressBookPicker
              addresses={deliveryAddresses}
              selectedId={form.deliveryAddressId}
              onSelect={(id) => applyAddress('delivery', id)}
              emptyHint="Noch keine Zustelladressen gespeichert – nach dem ersten Auftrag erscheinen sie hier."
            />
            <input
              placeholder="Firma"
              value={form.deliveryCompany}
              onChange={(e) => {
                setForm({ ...form, deliveryCompany: e.target.value, deliveryAddressId: '' });
                setDeliveryCheck(idleCheck);
                setDeliveryOverride(false);
              }}
            />
            <input
              required
              placeholder="Straße"
              value={form.deliveryStreet}
              onChange={(e) => {
                setForm({ ...form, deliveryStreet: e.target.value, deliveryAddressId: '' });
                setDeliveryCheck(idleCheck);
                setDeliveryOverride(false);
              }}
            />
            <div className="row">
              <input
                required
                placeholder="PLZ"
                value={form.deliveryZip}
                onChange={(e) => {
                  setForm({ ...form, deliveryZip: e.target.value, deliveryAddressId: '' });
                  setDeliveryCheck(idleCheck);
                  setDeliveryOverride(false);
                }}
              />
              <input
                required
                placeholder="Ort"
                value={form.deliveryCity}
                onChange={(e) => {
                  setForm({ ...form, deliveryCity: e.target.value, deliveryAddressId: '' });
                  setDeliveryCheck(idleCheck);
                  setDeliveryOverride(false);
                }}
              />
            </div>
            <div className="field">
              <label>Land</label>
              <select
                required
                value={form.deliveryCountry}
                onChange={(e) => {
                  setForm({ ...form, deliveryCountry: e.target.value, deliveryAddressId: '' });
                  setDeliveryCheck(idleCheck);
                  setDeliveryOverride(false);
                }}
              >
                {COUNTRIES.map((c) => (
                  <option key={c.code} value={c.code}>
                    {c.label} ({c.code})
                  </option>
                ))}
              </select>
            </div>
            <div className="row">
              <div className="field" style={{ flex: 1 }}>
                <label>Zustelldatum (von)</label>
                <input
                  required
                  type="date"
                  value={form.deliveryDate}
                  onChange={(e) => setForm({ ...form, deliveryDate: e.target.value })}
                />
              </div>
              <div className="field" style={{ flex: 1 }}>
                <label>Zustellzeit (von)</label>
                <input
                  required
                  type="time"
                  value={form.deliveryTime}
                  onChange={(e) => setForm({ ...form, deliveryTime: e.target.value })}
                />
              </div>
            </div>
            <div className="row">
              <div className="field" style={{ flex: 1 }}>
                <label>Zustelldatum (bis)</label>
                <input
                  required
                  type="date"
                  value={form.deliveryDateEnd}
                  onChange={(e) => setForm({ ...form, deliveryDateEnd: e.target.value })}
                />
              </div>
              <div className="field" style={{ flex: 1 }}>
                <label>Zustellzeit (bis)</label>
                <input
                  required
                  type="time"
                  value={form.deliveryTimeEnd}
                  onChange={(e) => setForm({ ...form, deliveryTimeEnd: e.target.value })}
                />
              </div>
            </div>
            {!form.deliveryAddressId ? (
              <AddressTypingSuggestions
                addresses={deliveryAddresses}
                company={form.deliveryCompany}
                onPick={(id) => applyAddress('delivery', id)}
              />
            ) : null}
            <div className="row" style={{ gap: '0.5rem', alignItems: 'center' }}>
              <button
                type="button"
                className="btn btn-secondary"
                disabled={deliveryCheck.status === 'loading'}
                onClick={() => void validateAddress('delivery')}
              >
                {deliveryCheck.status === 'loading' ? 'Prüfe…' : 'Adresse prüfen'}
              </button>
              {deliveryCheck.status === 'VALID' && (
                <span style={{ color: 'var(--ok)', fontSize: '0.9rem' }}>✓ geprüft</span>
              )}
              {deliveryOverride && (
                <span style={{ color: 'var(--warn, #b78103)', fontSize: '0.9rem' }}>
                  manuell übernommen
                </span>
              )}
            </div>
            {deliveryCheck.message && deliveryCheck.status !== 'idle' && deliveryCheck.status !== 'loading' ? (
              <p
                className={
                  deliveryCheck.status === 'VALID'
                    ? 'success'
                    : deliveryCheck.status === 'AMBIGUOUS' || deliveryOverride
                      ? 'muted'
                      : 'error'
                }
                style={{
                  margin: 0,
                  fontSize: '0.85rem',
                  color:
                    deliveryCheck.status === 'VALID'
                      ? 'var(--ok, #2f9e62)'
                      : deliveryCheck.status === 'AMBIGUOUS' || deliveryOverride
                        ? 'var(--warn, #b78103)'
                        : undefined,
                }}
              >
                {deliveryCheck.message}
              </p>
            ) : null}
            {deliveryCheck.status === 'INVALID' || deliveryCheck.status === 'FORMAT_ERROR' ? (
              <label className="row" style={{ alignItems: 'flex-start', gap: '0.5rem' }}>
                <input
                  type="checkbox"
                  checked={deliveryOverride}
                  onChange={(e) => setDeliveryOverride(e.target.checked)}
                />
                <span style={{ fontSize: '0.85rem' }}>
                  Adresse trotzdem verwenden (z.&nbsp;B. neue Baustelle / nicht in Karte gefunden)
                </span>
              </label>
            ) : null}
            {deliveryCheck.suggestions && deliveryCheck.suggestions.length > 0 ? (
              <div className="stack" style={{ gap: '0.35rem' }}>
                {deliveryCheck.suggestions.slice(0, 3).map((s, i) => (
                  <button
                    key={`${s.displayName}-${i}`}
                    type="button"
                    className="btn btn-ghost"
                    style={{ textAlign: 'left', justifyContent: 'flex-start' }}
                    onClick={() => {
                      applySuggestion('delivery', s);
                      setDeliveryOverride(false);
                    }}
                  >
                    Übernehmen: {s.street}, {s.zip} {s.city} ({s.country})
                  </button>
                ))}
              </div>
            ) : null}
            <div className="field">
              <label>Avis-Telefon Zustellung</label>
              <input
                type="tel"
                placeholder="+43 … / +41 …"
                value={form.deliveryAvisPhone}
                onChange={(e) => setForm({ ...form, deliveryAvisPhone: e.target.value })}
              />
              <p className="muted" style={{ margin: '0.25rem 0 0', fontSize: '0.8rem' }}>
                Nummer, unter der die Zustellung avisiert werden kann.
              </p>
            </div>
            <div className="field">
              <label>Info Entladestelle</label>
              <textarea
                rows={2}
                value={form.deliveryNotes}
                onChange={(e) => setForm({ ...form, deliveryNotes: e.target.value })}
                placeholder="z. B. Hintereingang, Gabelstapler nötig"
              />
            </div>
            <label className="row">
              <input
                type="checkbox"
                checked={form.saveDeliveryAddress}
                onChange={(e) => setForm({ ...form, saveDeliveryAddress: e.target.checked })}
              />
              Zustellung im Adressbuch speichern
            </label>
            <p className="muted" style={{ margin: 0, fontSize: '0.8rem' }}>
              Beim Anlegen wird die Adresse automatisch gespeichert und steht künftig in der Suche.
            </p>
          </div>
        </div>

        <div className="stack">
          <strong>Colli</strong>
          <div className="field">
            <label>Warenbeschreibung (gesamt, optional)</label>
            <input
              value={form.goodsDescription}
              onChange={(e) => setForm({ ...form, goodsDescription: e.target.value })}
              placeholder="z. B. Heiztechnik / Mischsendung"
            />
          </div>

          <div
            className="stack"
            style={{
              background: 'var(--wog-green-soft, #eef7f1)',
              border: '1px solid var(--line)',
              borderRadius: 'var(--radius, 8px)',
              padding: '0.85rem 1rem',
            }}
          >
            <strong style={{ fontSize: '0.95rem' }}>Schnellfassung</strong>
            <p className="muted" style={{ margin: 0, fontSize: '0.85rem' }}>
              z. B. 10 EUP / 2000 kg → wird zu 10 einzelnen Colli à 200 kg aufgeteilt.
            </p>
            <div className="grid-3">
              <div className="field">
                <label>Anzahl</label>
                <input
                  type="number"
                  min={1}
                  value={quick.count}
                  onChange={(e) => setQuick({ ...quick, count: e.target.value })}
                />
              </div>
              <div className="field">
                <label>Verpackungsart</label>
                <select
                  value={quick.packaging}
                  onChange={(e) => setQuick({ ...quick, packaging: e.target.value })}
                >
                  {packagingTypes.map((p) => (
                    <option key={p.code} value={p.code}>{p.label}</option>
                  ))}
                </select>
              </div>
              <div className="field">
                <label>Gesamtgewicht (kg)</label>
                <input
                  type="number"
                  min={0}
                  step="0.1"
                  value={quick.totalWeightKg}
                  onChange={(e) => setQuick({ ...quick, totalWeightKg: e.target.value })}
                  placeholder="2000"
                />
              </div>
            </div>
            <div className="field">
              <label>Abmessungen je Collo L × B × H (cm, optional)</label>
              <div className="row">
                <input
                  type="number"
                  min={0}
                  placeholder="L"
                  value={quick.lengthCm}
                  onChange={(e) => setQuick({ ...quick, lengthCm: e.target.value })}
                />
                <input
                  type="number"
                  min={0}
                  placeholder="B"
                  value={quick.widthCm}
                  onChange={(e) => setQuick({ ...quick, widthCm: e.target.value })}
                />
                <input
                  type="number"
                  min={0}
                  placeholder="H"
                  value={quick.heightCm}
                  onChange={(e) => setQuick({ ...quick, heightCm: e.target.value })}
                />
              </div>
            </div>
            <button className="btn btn-secondary" type="button" onClick={applyQuickSplit}>
              Aufteilen in einzelne Colli
            </button>
          </div>

          {colli.map((c, index) => (
            <div key={index} className="stack" style={{ borderTop: '1px solid var(--line)', paddingTop: '0.75rem' }}>
              <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center' }}>
                <strong style={{ fontSize: '0.95rem' }}>Collo {index + 1}</strong>
                {colli.length > 1 && (
                  <button
                    type="button"
                    className="btn btn-ghost"
                    onClick={() => removeCollo(index)}
                    aria-label={`Collo ${index + 1} entfernen`}
                    title="Collo entfernen"
                  >
                    −
                  </button>
                )}
              </div>
              <div className="grid-2">
                <div className="field">
                  <label>Verpackungsart</label>
                  <select
                    value={c.packaging}
                    onChange={(e) => updateCollo(index, { packaging: e.target.value })}
                  >
                    {packagingTypes.map((p) => (
                      <option key={p.code} value={p.code}>{p.label}</option>
                    ))}
                  </select>
                </div>
                <div className="field">
                  <label>Inhalt</label>
                  <input
                    value={c.description}
                    onChange={(e) => updateCollo(index, { description: e.target.value })}
                    placeholder={form.goodsDescription || 'Inhalt / Packstück'}
                  />
                </div>
              </div>
              <div className="grid-2">
                <div className="field">
                  <label>Gewicht (kg)</label>
                  <input
                    type="number"
                    min={0}
                    step="0.1"
                    value={c.weightKg}
                    onChange={(e) => updateCollo(index, { weightKg: e.target.value })}
                  />
                </div>
                <div className="field">
                  <label>Abmessungen L × B × H (cm)</label>
                  <div className="row">
                    <input
                      type="number"
                      min={0}
                      step="1"
                      placeholder="L"
                      value={c.lengthCm}
                      onChange={(e) => updateCollo(index, { lengthCm: e.target.value })}
                      aria-label={`Collo ${index + 1} Länge cm`}
                    />
                    <input
                      type="number"
                      min={0}
                      step="1"
                      placeholder="B"
                      value={c.widthCm}
                      onChange={(e) => updateCollo(index, { widthCm: e.target.value })}
                      aria-label={`Collo ${index + 1} Breite cm`}
                    />
                    <input
                      type="number"
                      min={0}
                      step="1"
                      placeholder="H"
                      value={c.heightCm}
                      onChange={(e) => updateCollo(index, { heightCm: e.target.value })}
                      aria-label={`Collo ${index + 1} Höhe cm`}
                    />
                  </div>
                </div>
              </div>
            </div>
          ))}

          <button
            type="button"
            className="btn btn-secondary"
            onClick={addCollo}
            aria-label="Collo hinzufügen"
            style={{ alignSelf: 'flex-start' }}
          >
            + Collo hinzufügen
          </button>
          <p className="muted" style={{ margin: 0, fontSize: '0.85rem' }}>
            Verpackung, Maße und Gewicht je Collo fließen in Etiketten und Soloplan-Export ein.
          </p>
        </div>
          </>
        )}

        {tab === 'zusatz' && (
          <div className="stack">
            <strong>Zusatzinformationen</strong>
            <p className="muted" style={{ margin: 0, fontSize: '0.9rem' }}>
              Zusatzleistungen und Hinweise für Disposition, Fahrer und Aviso.
            </p>
            {EXTRA_GROUPS.map((group) => (
              <div key={group} className="stack" style={{ borderTop: '1px solid var(--line)', paddingTop: '0.75rem' }}>
                <strong style={{ fontSize: '0.95rem' }}>{group}</strong>
                <div className="extras-grid">
                  {SHIPMENT_EXTRA_OPTIONS.filter((o) => o.group === group).map((opt) => (
                    <label key={opt.code} className="row">
                      <input
                        type="checkbox"
                        checked={Boolean(extras[opt.code])}
                        onChange={(e) => toggleExtra(opt.code, e.target.checked)}
                      />
                      <span>{opt.label}</span>
                    </label>
                  ))}
                </div>
              </div>
            ))}
            {extras.warenwertVersicherung && (
              <div className="field">
                <label>Warenwert (EUR)</label>
                <input
                  type="number"
                  min={0}
                  step="0.01"
                  value={extras.goodsValueEur ?? ''}
                  onChange={(e) =>
                    setExtras((prev) => ({
                      ...prev,
                      goodsValueEur: e.target.value === '' ? undefined : Number(e.target.value),
                    }))
                  }
                  placeholder="z. B. 15000"
                />
              </div>
            )}

            <div className="field">
              <label>Hinweise / Bemerkungen</label>
              <textarea
                rows={3}
                value={form.notes}
                onChange={(e) => setForm({ ...form, notes: e.target.value })}
                placeholder="z. B. Anfahrtshinweise, Öffnungszeiten, Ansprechpartner"
              />
            </div>
          </div>
        )}

        {/* Papiere immer in der Erfassung – nicht erst in der Sendungsübersicht */}
        <div
          className="stack"
          style={{
            borderTop: '1px solid var(--line)',
            paddingTop: '1rem',
            marginTop: '0.25rem',
          }}
        >
          <strong style={{ fontSize: '0.95rem' }}>Papiere / Dokumente</strong>
          <p className="muted" style={{ margin: 0, fontSize: '0.9rem' }}>
            Begleitpapiere hier direkt mit dem Auftrag anhängen (PDF, Bilder). Sie werden beim
            Übermitteln mitgesendet – nicht erst später in der Sendungsübersicht.
            {extras.verzollung || extras.begleitpapiere
              ? ' Bei Verzollung bzw. Begleitpapieren bitte die Unterlagen jetzt auswählen.'
              : ''}
          </p>

          {(extras.verzollung || isSwitzerlandOrLiechtenstein(form.deliveryCountry)) && (
            <div
              className="field"
              style={{
                padding: '0.85rem 1rem',
                border: '1px solid var(--line)',
                borderRadius: 8,
                background: 'var(--soft, #f4f7f5)',
              }}
            >
              <label>
                Rechnung{' '}
                {extras.verzollung ? (
                  <span style={{ color: 'var(--danger, #b42318)' }}>*</span>
                ) : null}
              </label>
              <p className="muted" style={{ margin: 0, fontSize: '0.85rem' }}>
                {extras.verzollung
                  ? 'Verzollung erfordert eine Rechnung (Dokumenttyp Rechnung).'
                  : 'Für Zustellung CH/FL empfohlen – bei Verzollung Pflicht.'}
              </p>
              <input
                type="file"
                required={Boolean(extras.verzollung)}
                accept=".pdf,.png,.jpg,.jpeg,.tif,.tiff,application/pdf,image/*"
                onChange={(e) => setInvoiceFile(e.target.files?.[0] || null)}
              />
              {invoiceFile && (
                <div className="muted" style={{ fontSize: '0.85rem' }}>
                  Ausgewählt: {invoiceFile.name} ({formatBytes(invoiceFile.size)})
                </div>
              )}
            </div>
          )}

          <div className="field">
            <label>Begleitpapiere anhängen</label>
            <input
              type="file"
              multiple
              accept=".pdf,.png,.jpg,.jpeg,.tif,.tiff,.xml,.zip,application/pdf,image/*"
              onChange={(e) => {
                addPendingDocs(e.target.files, 'CUSTOMER_UPLOAD');
                e.target.value = '';
              }}
            />
          </div>

          {pendingDocs.length > 0 && (
            <div className="stack" style={{ gap: '0.5rem' }}>
              {pendingDocs.map((d) => (
                <div
                  key={d.id}
                  className="row"
                  style={{
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    gap: '0.75rem',
                    flexWrap: 'wrap',
                    padding: '0.5rem 0',
                    borderBottom: '1px solid var(--line)',
                  }}
                >
                  <span style={{ flex: '1 1 12rem' }}>
                    {d.file.name}{' '}
                    <span className="muted">({formatBytes(d.file.size)})</span>
                  </span>
                  <select
                    value={d.type}
                    onChange={(e) =>
                      setPendingDocs((prev) =>
                        prev.map((x) =>
                          x.id === d.id ? { ...x, type: e.target.value as UploadDocType } : x,
                        ),
                      )
                    }
                    style={{ minWidth: '10rem' }}
                  >
                    {DOC_TYPE_OPTIONS.map((o) => (
                      <option key={o.value} value={o.value}>
                        {o.label}
                      </option>
                    ))}
                  </select>
                  <button
                    type="button"
                    className="btn btn-ghost"
                    onClick={() => setPendingDocs((prev) => prev.filter((x) => x.id !== d.id))}
                  >
                    Entfernen
                  </button>
                </div>
              ))}
            </div>
          )}

          {(invoiceFile || pendingDocs.length > 0) && (
            <p className="muted" style={{ margin: 0, fontSize: '0.85rem' }}>
              {invoiceFile ? 1 : 0} Rechnung
              {pendingDocs.length > 0
                ? ` · ${pendingDocs.length} weitere Datei${pendingDocs.length === 1 ? '' : 'en'}`
                : ''}{' '}
              bereit zum Mitversenden.
            </p>
          )}
        </div>

        {tab === 'allgemein' && (
          <div className="field">
            <label>Als Vorlage speichern (optional)</label>
            <input
              placeholder="Name der Vorlage"
              value={form.saveAsTemplateName}
              onChange={(e) => setForm({ ...form, saveAsTemplateName: e.target.value })}
            />
          </div>
        )}

        {error && <div className="error">{error}</div>}
        <div className="shipment-form-actions row" style={{ justifyContent: 'space-between' }}>
          <div className="row">
            {tab === 'zusatz' && (
              <button
                type="button"
                className="btn btn-ghost"
                onClick={() => setTab('allgemein')}
              >
                Zurück
              </button>
            )}
            {tab === 'allgemein' && (
              <button
                type="button"
                className="btn btn-secondary"
                onClick={() => setTab('zusatz')}
              >
                Weiter zu Zusatzinfos
              </button>
            )}
          </div>
          <button className="btn btn-primary" type="submit">
            Auftrag inkl. Papiere übermitteln
          </button>
        </div>
      </form>
    </AppShell>
  );
}


export default function NewShipmentPage() {
  return (
    <Suspense fallback={<AppShell title="Neuer Auftrag">Laden…</AppShell>}>
      <NewShipmentInner />
    </Suspense>
  );
}
