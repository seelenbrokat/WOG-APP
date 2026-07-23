/** Zusatzoptionen bei der Auftragserfassung (Checkboxen). */
export const SHIPMENT_EXTRA_OPTIONS = [
  { code: 'hebebuehneZustellung', label: 'Hebebühne Zustellung', group: 'Fahrzeug' },
  { code: 'hebebuehneAbholung', label: 'Hebebühne Abholung', group: 'Fahrzeug' },
  { code: 'fahrerAviso', label: 'Fahrer-Aviso', group: 'Aviso' },
  { code: 'smsAviso', label: 'SMS-Aviso', group: 'Aviso' },
  { code: 'emailAviso', label: 'E-Mail-Aviso', group: 'Aviso' },
  { code: 'telefonAviso', label: 'Telefon-Aviso', group: 'Aviso' },
  { code: 'gefahrgut', label: 'Gefahrgut', group: 'Ware' },
  { code: 'warenwertVersicherung', label: 'Warenwertversicherung', group: 'Ware' },
  { code: 'temperaturgefuehrt', label: 'Temperaturgeführt', group: 'Ware' },
  { code: 'express', label: 'Express', group: 'Service' },
  { code: 'samstagszustellung', label: 'Samstagszustellung', group: 'Service' },
  { code: 'zeitfenster', label: 'Zeitfensterzustellung', group: 'Service' },
  { code: 'privatadresse', label: 'Privatadresse / Haushalt', group: 'Service' },
  { code: 'innenzustellung', label: 'Innenzustellung', group: 'Service' },
  { code: 'tauschpalette', label: 'Tauschpalette', group: 'Service' },
  { code: 'nachnahme', label: 'Nachnahme', group: 'Service' },
  { code: 'verzollung', label: 'Verzollung erforderlich', group: 'Zoll' },
  { code: 'begleitpapiere', label: 'Begleitpapiere beilegen', group: 'Zoll' },
  { code: 'fixAvis', label: 'Fixtermin-Aviso', group: 'Aviso' },
  { code: 'zweiMannHandling', label: '2-Mann-Handling', group: 'Service' },
] as const;

export type ShipmentExtraCode = (typeof SHIPMENT_EXTRA_OPTIONS)[number]['code'];

export type ShipmentExtras = Partial<Record<ShipmentExtraCode, boolean>> & {
  /** Warenwert in EUR (bei Versicherung) */
  goodsValueEur?: number | null;
  /** Freitext zu Zusatzinfos (Register) */
  extrasNote?: string | null;
  /** Hinweis direkt unter der Ladestellen-Adresse */
  pickupNote?: string | null;
  /** Hinweis direkt unter der Entladestellen-Adresse */
  deliveryNote?: string | null;
};

export function shipmentExtrasLabels(extras?: ShipmentExtras | null): string[] {
  if (!extras) return [];
  return SHIPMENT_EXTRA_OPTIONS.filter((o) => extras[o.code]).map((o) => o.label);
}
