/** Zusatzoptionen bei der Auftragserfassung (Checkboxen). */
export type ShipmentExtraSite = 'pickup' | 'delivery' | 'both';

export const SHIPMENT_EXTRA_OPTIONS = [
  // Ladestelle (Abholung)
  { code: 'hebebuehneAbholung', label: 'Hebebühne', group: 'Fahrzeug', site: 'pickup' },
  { code: 'fahrerAvisoAbholung', label: 'Fahrer-Aviso', group: 'Aviso', site: 'pickup' },
  { code: 'telefonAvisoAbholung', label: 'Telefon-Aviso', group: 'Aviso', site: 'pickup' },
  { code: 'smsAvisoAbholung', label: 'SMS-Aviso', group: 'Aviso', site: 'pickup' },
  { code: 'fixAvisAbholung', label: 'Fixtermin-Aviso', group: 'Aviso', site: 'pickup' },
  { code: 'zeitfensterAbholung', label: 'Zeitfenster', group: 'Service', site: 'pickup' },
  { code: 'tauschpaletteAbholung', label: 'Tauschpalette', group: 'Service', site: 'pickup' },

  // Entladestelle (Zustellung)
  { code: 'hebebuehneZustellung', label: 'Hebebühne', group: 'Fahrzeug', site: 'delivery' },
  { code: 'fahrerAviso', label: 'Fahrer-Aviso', group: 'Aviso', site: 'delivery' },
  { code: 'smsAviso', label: 'SMS-Aviso', group: 'Aviso', site: 'delivery' },
  { code: 'emailAviso', label: 'E-Mail-Aviso', group: 'Aviso', site: 'delivery' },
  { code: 'telefonAviso', label: 'Telefon-Aviso', group: 'Aviso', site: 'delivery' },
  { code: 'fixAvis', label: 'Fixtermin-Aviso', group: 'Aviso', site: 'delivery' },
  { code: 'samstagszustellung', label: 'Samstagszustellung', group: 'Service', site: 'delivery' },
  { code: 'zeitfenster', label: 'Zeitfensterzustellung', group: 'Service', site: 'delivery' },
  { code: 'privatadresse', label: 'Privatadresse / Haushalt', group: 'Service', site: 'delivery' },
  { code: 'innenzustellung', label: 'Innenzustellung', group: 'Service', site: 'delivery' },
  { code: 'tauschpalette', label: 'Tauschpalette', group: 'Service', site: 'delivery' },
  { code: 'zweiMannHandling', label: '2-Mann-Handling', group: 'Service', site: 'delivery' },

  // Beide Stellen / Auftrag
  { code: 'gefahrgut', label: 'Gefahrgut', group: 'Ware', site: 'both' },
  { code: 'warenwertVersicherung', label: 'Warenwertversicherung', group: 'Ware', site: 'both' },
  { code: 'temperaturgefuehrt', label: 'Temperaturgeführt', group: 'Ware', site: 'both' },
  { code: 'express', label: 'Express', group: 'Service', site: 'both' },
  { code: 'nachnahme', label: 'Nachnahme', group: 'Service', site: 'both' },
  { code: 'verzollung', label: 'Verzollung erforderlich', group: 'Zoll', site: 'both' },
  { code: 'begleitpapiere', label: 'Begleitpapiere beilegen', group: 'Zoll', site: 'both' },
] as const;

export type ShipmentExtraCode = (typeof SHIPMENT_EXTRA_OPTIONS)[number]['code'];

export type ShipmentExtras = Partial<Record<ShipmentExtraCode, boolean>> & {
  /** Warenwert in EUR (bei Versicherung) */
  goodsValueEur?: number | null;
  /** @deprecated kombiniert – bitte pickupNote / deliveryNote nutzen */
  extrasNote?: string | null;
  /** Freitext Hinweise Ladestelle */
  pickupNote?: string | null;
  /** Freitext Hinweise Entladestelle */
  deliveryNote?: string | null;
  /** Avis-Telefon Ladestelle */
  pickupAvisPhone?: string | null;
};

export function shipmentExtrasForSite(site: 'pickup' | 'delivery') {
  return SHIPMENT_EXTRA_OPTIONS.filter((o) => o.site === site || o.site === 'both');
}

export function shipmentExtrasLabels(extras?: ShipmentExtras | null): string[] {
  if (!extras) return [];
  return SHIPMENT_EXTRA_OPTIONS.filter((o) => extras[o.code]).map((o) => {
    if (o.site === 'pickup') return `${o.label} (Ladestelle)`;
    if (o.site === 'delivery') return `${o.label} (Entladestelle)`;
    return o.label;
  });
}

export function shipmentExtrasLabelsForSite(
  extras: ShipmentExtras | null | undefined,
  site: 'pickup' | 'delivery',
): string[] {
  if (!extras) return [];
  return shipmentExtrasForSite(site)
    .filter((o) => extras[o.code])
    .map((o) => o.label);
}
