/**
 * Mobilnummern für SmartBorder / LinkMobility email2sms.
 * Ziel: E.164 ohne Leerzeichen (z. B. +436769075070).
 */

/** Normalisiert Roh-Eingabe zu E.164 (+…); null wenn ungültig/leer. */
export function normalizePhoneE164(raw: string | null | undefined): string | null {
  let s = String(raw || '').trim();
  if (!s) return null;
  s = s.replace(/[\s\-()./]/g, '');
  if (s.startsWith('00')) s = `+${s.slice(2)}`;
  if (/^0[1-9]\d{6,13}$/.test(s)) {
    // AT-Lokal ohne Ländervorwahl → +43
    s = `+43${s.slice(1)}`;
  }
  if (!s.startsWith('+') && /^\d{8,15}$/.test(s)) {
    s = `+${s}`;
  }
  if (!/^\+[1-9]\d{7,14}$/.test(s)) return null;
  return s;
}

/** Ziffern ohne + für LinkMobility: 436769075070 */
export function phoneDigitsForSmsGateway(e164: string): string | null {
  const n = normalizePhoneE164(e164);
  if (!n) return null;
  return n.replace(/^\+/, '');
}

/**
 * LinkMobility email2sms-Adresse.
 * Domain konfigurierbar, Default: email2sms.linkmobility.eu
 */
export function linkMobilitySmsAddress(
  e164: string,
  domain = 'email2sms.linkmobility.eu',
): string | null {
  const digits = phoneDigitsForSmsGateway(e164);
  if (!digits) return null;
  return `${digits}@${domain}`;
}

export function isValidPhoneE164(raw: string | null | undefined): boolean {
  return normalizePhoneE164(raw) != null;
}
