/** Häufige Länder für WOG-Transport (ISO-3166-1 alpha-2). */
export const COUNTRIES = [
  { code: 'AT', label: 'Österreich' },
  { code: 'CH', label: 'Schweiz' },
  { code: 'DE', label: 'Deutschland' },
  { code: 'LI', label: 'Liechtenstein' },
  { code: 'IT', label: 'Italien' },
  { code: 'FR', label: 'Frankreich' },
  { code: 'HU', label: 'Ungarn' },
  { code: 'CZ', label: 'Tschechien' },
  { code: 'SK', label: 'Slowakei' },
  { code: 'SI', label: 'Slowenien' },
  { code: 'HR', label: 'Kroatien' },
  { code: 'PL', label: 'Polen' },
  { code: 'NL', label: 'Niederlande' },
  { code: 'BE', label: 'Belgien' },
  { code: 'LU', label: 'Luxemburg' },
  { code: 'ES', label: 'Spanien' },
  { code: 'PT', label: 'Portugal' },
  { code: 'GB', label: 'Großbritannien' },
  { code: 'IE', label: 'Irland' },
  { code: 'DK', label: 'Dänemark' },
  { code: 'SE', label: 'Schweden' },
  { code: 'NO', label: 'Norwegen' },
  { code: 'FI', label: 'Finnland' },
  { code: 'RO', label: 'Rumänien' },
  { code: 'BG', label: 'Bulgarien' },
  { code: 'RS', label: 'Serbien' },
  { code: 'BA', label: 'Bosnien und Herzegowina' },
  { code: 'ME', label: 'Montenegro' },
  { code: 'MK', label: 'Nordmazedonien' },
  { code: 'AL', label: 'Albanien' },
  { code: 'GR', label: 'Griechenland' },
  { code: 'TR', label: 'Türkei' },
  { code: 'UA', label: 'Ukraine' },
] as const;

export type CountryCode = (typeof COUNTRIES)[number]['code'];

export function countryLabel(code?: string | null): string {
  if (!code) return '';
  const c = code.trim().toUpperCase();
  return COUNTRIES.find((x) => x.code === c)?.label || c;
}

/** Einfache PLZ-Muster je Land (Formatprüfung vor Geocoding). */
export function zipPatternForCountry(country?: string | null): RegExp | null {
  const c = String(country || '').trim().toUpperCase();
  switch (c) {
    case 'AT':
    case 'CH':
    case 'LI':
    case 'HU':
    case 'SI':
      return /^\d{4}$/;
    case 'DE':
    case 'IT':
    case 'FR':
    case 'ES':
    case 'FI':
      return /^\d{5}$/;
    case 'NL':
      return /^\d{4}\s?[A-Z]{2}$/i;
    case 'GB':
      return /^[A-Z]{1,2}\d[A-Z\d]?\s*\d[A-Z]{2}$/i;
    case 'PL':
      return /^\d{2}-\d{3}$/;
    case 'CZ':
    case 'SK':
      return /^\d{3}\s?\d{2}$/;
    default:
      return null;
  }
}

/** CH / LI – auch Kennzeichen-Kürzel FL (Fürstentum Liechtenstein). */
export function isSwitzerlandOrLiechtenstein(country?: string | null): boolean {
  const c = String(country || '').trim().toUpperCase();
  return c === 'CH' || c === 'LI' || c === 'FL';
}

/** Bevorzugte Mandanten-Codes für CH/LI-Verzollung („Mandant 2“ = GmbH). */
export const CH_LI_CUSTOMS_MANDANT_CODES = ['GMBH', '2'] as const;

export function isValidZipForCountry(zip?: string | null, country?: string | null): boolean {
  const z = String(zip || '').trim();
  if (!z) return false;
  const re = zipPatternForCountry(country);
  if (!re) return z.length >= 3;
  return re.test(z);
}
