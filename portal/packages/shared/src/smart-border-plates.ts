/**
 * Smart Border Austria – Richtlinien zur Eingabe von Kfz-Kennzeichen
 * (BMF, DE v1.1 Stand 09.03.2026)
 *
 * Grundsätzlich: Buchstaben und Ziffern, keine Leerzeichen.
 * AT/DE: Regionskürzel–Identifikator mit Bindestrich (z. B. W-12345T, MÜ-A1234).
 * CH: nur Buchstaben/Ziffern, keine Bindestriche und keine Punkte.
 * IT/NL/HR u. a.: nur Buchstaben/Ziffern (HR: Sonderzeichen ersetzen).
 */

/** ISO-3166-1-alpha-2 Codes, für die SBA landesspezifische Kennzeichenregeln nennt. */
export const SMART_BORDER_PLATE_COUNTRIES = [
  'AT',
  'DE',
  'GR',
  'IT',
  'HR',
  'NL',
  'CH',
  'RS',
  'SK',
  'SI',
  'CZ',
  'UA',
  'HU',
  'BY',
] as const;

const HR_SPECIAL: Record<string, string> = {
  Č: 'C',
  Ć: 'C',
  Š: 'S',
  Ž: 'Z',
  Đ: 'D',
  č: 'C',
  ć: 'C',
  š: 'S',
  ž: 'Z',
  đ: 'D',
};

/** Leerzeichen entfernen, HR-Sonderzeichen ersetzen, Uppercase; AT/DE Bindestrich ergänzen. */
export function normalizeSmartBorderPlate(raw: string, zulassungsland?: string | null): string {
  const country = String(zulassungsland || '').trim().toUpperCase();
  let s = String(raw || '').trim();

  // AT/DE: „MÜ A1234“ / „W 12345T“ → Regionskürzel–Identifikator
  if ((country === 'AT' || country === 'DE') && s && !s.includes('-')) {
    const spaced = s.match(/^([A-Za-zÄÖÜäöü]{1,3})[\s]+(.+)$/);
    if (spaced) {
      s = `${spaced[1]}-${spaced[2].replace(/\s+/g, '')}`;
    }
  }

  s = s.replace(/\s+/g, '');
  if (country === 'HR') {
    s = s.replace(/[ČĆŠŽĐčćšžđ]/g, (ch) => HR_SPECIAL[ch] || ch);
  }
  // CH: Punkte und Bindestriche entfernen
  if (country === 'CH' || country === 'LI' || country === 'FL') {
    s = s.replace(/[.\-]/g, '');
  }
  s = s.toUpperCase();

  // AT/DE ohne Bindestrich: führende Buchstaben = Regionskürzel, Rest beginnt mit Ziffer
  // (z. B. W12345T → W-12345T, GAP850 → GAP-850). Bei Buchstaben-Identifikator bitte „MÜ-A1234“ eingeben.
  if ((country === 'AT' || country === 'DE') && s && !s.includes('-')) {
    const m = s.match(/^([A-ZÄÖÜ]{1,3})(\d[A-ZÄÖÜ0-9]*)$/i);
    if (m) s = `${m[1]}-${m[2]}`;
  }
  return s;
}

/**
 * Prüft Kennzeichen nach SBA-Eingaberichtlinie.
 * Unbekannte Zulassungsländer: Buchstaben/Ziffern, optional Bindestrich, keine Leerzeichen.
 */
export function isValidSmartBorderPlate(
  raw: string,
  zulassungsland?: string | null,
): boolean {
  const plate = normalizeSmartBorderPlate(raw, zulassungsland);
  if (plate.length < 2 || plate.length > 20) return false;
  if (/\s/.test(plate)) return false;

  const country = String(zulassungsland || '').trim().toUpperCase();

  switch (country) {
    case 'AT':
    case 'DE':
      // Regionskürzel-Identifikator, Bindestrich erlaubt, Umlaute erlaubt
      return /^[A-ZÄÖÜ]{1,3}-[A-ZÄÖÜ0-9]{1,8}$/i.test(plate);
    case 'CH':
    case 'LI':
    case 'FL':
      return /^[A-Z0-9]{2,12}$/i.test(plate);
    case 'IT':
    case 'NL':
    case 'HR':
    case 'RS':
    case 'SK':
    case 'SI':
    case 'CZ':
    case 'UA':
    case 'HU':
    case 'BY':
      return /^[A-Z0-9]{2,15}$/i.test(plate);
    case 'GR':
      // Buchstaben/Ziffern; Bindestriche laut Richtlinie zulässig (Beispiele mit Bindestrich)
      return /^[A-Z0-9-]{2,15}$/i.test(plate) && !/\s/.test(plate);
    default:
      return /^[A-ZÄÖÜ0-9-]{2,20}$/i.test(plate);
  }
}

export function smartBorderPlateHint(zulassungsland?: string | null): string {
  const country = String(zulassungsland || '').trim().toUpperCase();
  switch (country) {
    case 'AT':
      return 'Smart Border Austria: Regionskürzel–Identifikator, z. B. W-12345T – keine Leerzeichen.';
    case 'DE':
      return 'Smart Border Austria: Regionskürzel–Identifikator, z. B. MÜ-A1234 – keine Leerzeichen.';
    case 'CH':
    case 'LI':
    case 'FL':
      return 'Smart Border Austria: nur Buchstaben und Ziffern, z. B. SG197052 – keine Leerzeichen, Bindestriche oder Punkte.';
    case 'IT':
      return 'Smart Border Austria: nur Buchstaben und Ziffern, z. B. BE586AT – keine Leerzeichen oder Bindestriche.';
    case 'NL':
      return 'Smart Border Austria: nur Buchstaben und Ziffern, z. B. 9945DX – keine Leerzeichen oder Bindestriche.';
    default:
      return 'Smart Border Austria: Kennzeichen ohne Leerzeichen (Buchstaben/Ziffern; landesspezifisch Bindestrich).';
  }
}
