/** Übliche Frankaturen / Incoterms für V–CH Warenverkehr */
export const FRANKATUREN = [
  'Unfrei',
  'Franco Empfänger',
  'Franco Grenze',
  'Frei Haus',
  'EXW – Ab Werk',
  'FCA – Frei Frachtführer',
  'CPT – Frachtfrei',
  'CIP – Frachtfrei versichert',
  'DAP – Geliefert benannter Ort',
  'DPU – Geliefert entladen',
  'DDP – Geliefert verzollt',
] as const;

export type Frankatur = (typeof FRANKATUREN)[number];

export function isFrankatur(value: string): boolean {
  return (FRANKATUREN as readonly string[]).includes(value);
}
