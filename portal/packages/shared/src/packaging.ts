/** Häufige Verpackungsarten im WOG-/Soloplan-Kontext */
export const PACKAGING_TYPES = [
  { code: 'EUP', label: 'Europalette (EUP)' },
  { code: 'EP', label: 'Einwegpalette' },
  { code: 'FP', label: 'Industriepalette' },
  { code: 'GTB', label: 'Gitterbox' },
  { code: 'KRT', label: 'Karton' },
  { code: 'COL', label: 'Colli / Stück' },
  { code: 'ROL', label: 'Rolle' },
  { code: 'FAS', label: 'Fass' },
  { code: 'BAG', label: 'BigBag / Sack' },
  { code: 'BDL', label: 'Bund' },
] as const;

export type PackagingCode = (typeof PACKAGING_TYPES)[number]['code'];

export function packagingLabel(code?: string | null): string {
  if (!code) return '–';
  const hit = PACKAGING_TYPES.find((p) => p.code === code);
  return hit ? hit.label : code;
}
