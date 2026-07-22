/**
 * GS1 SSCC-18 Generierung
 * Format: Extension(1) + CompanyPrefix + Serial + CheckDigit = 18 Ziffern
 * Beispiel WOG: 091201014196177304 → Ext 0, Prefix 9120101, Serial …
 */

export function gs1CheckDigit(body17: string): number {
  if (!/^\d{17}$/.test(body17)) {
    throw new Error(`SSCC-Body muss 17 Ziffern haben, got ${body17.length}`);
  }
  let sum = 0;
  const digits = body17.split('').map(Number).reverse();
  for (let i = 0; i < digits.length; i++) {
    sum += i % 2 === 0 ? digits[i] * 3 : digits[i];
  }
  return (10 - (sum % 10)) % 10;
}

export function buildSscc(opts: {
  extensionDigit?: string | number;
  companyPrefix: string;
  serial: number;
}): string {
  const ext = String(opts.extensionDigit ?? '0').slice(0, 1);
  const prefix = String(opts.companyPrefix).replace(/\D/g, '');
  if (prefix.length < 4 || prefix.length > 12) {
    throw new Error('SSCC_GS1_COMPANY_PREFIX muss 4–12 Ziffern haben');
  }
  const serialLen = 16 - prefix.length; // 17 ohne Prüfziffer = 1 Ext + 16 Nutzdaten
  if (serialLen < 1) throw new Error('Company-Prefix zu lang für SSCC');
  const maxSerial = 10 ** serialLen - 1;
  if (opts.serial < 1 || opts.serial > maxSerial) {
    throw new Error(`SSCC-Serial außerhalb 1..${maxSerial}`);
  }
  const serial = String(opts.serial).padStart(serialLen, '0');
  const body17 = `${ext}${prefix}${serial}`;
  return `${body17}${gs1CheckDigit(body17)}`;
}

/** AI (00) + SSCC für GS1-128 Human Readable / Barcode-Daten */
export function ssccAiData(sscc: string): string {
  const digits = String(sscc).replace(/\D/g, '');
  if (digits.length !== 18) throw new Error('SSCC muss 18 Ziffern haben');
  return `(00)${digits}`;
}

/** True wenn 18 Ziffern und GS1-Prüfziffer korrekt. */
export function isValidSscc(sscc: string | null | undefined): boolean {
  const digits = normalizeSsccDigits(sscc);
  if (!digits) return false;
  try {
    return gs1CheckDigit(digits.slice(0, 17)) === Number(digits[17]);
  } catch {
    return false;
  }
}

/**
 * Normalisiert Scan-/Eingabewerte auf 18 SSCC-Ziffern.
 * Akzeptiert z. B. "(00)0912…", "000912…", "91…" mit Leerzeichen.
 */
export function normalizeSsccDigits(raw: string | null | undefined): string | null {
  let digits = String(raw || '').replace(/\D/g, '');
  if (!digits) return null;
  // GS1 Application Identifier (00) oft als führende 00 im Rohscan
  if (digits.length === 20 && digits.startsWith('00')) {
    digits = digits.slice(2);
  }
  if (digits.length > 18 && digits.startsWith('00')) {
    digits = digits.slice(-18);
  }
  if (digits.length !== 18) return null;
  return digits;
}

/** Scan-Rohwert → gültige GS1-SSCC oder null. */
export function parseSsccFromScan(raw: string | null | undefined): string | null {
  const digits = normalizeSsccDigits(raw);
  if (!digits || !isValidSscc(digits)) return null;
  return digits;
}

/**
 * Soloplan/Intouch-SSCC (z. B. IKU516494298) oder GS1-18.
 * Für Lager-Scan wenn kein reines GS1-Barcode vorliegt.
 */
export function normalizeScanCode(raw: string | null | undefined): string | null {
  const gs1 = parseSsccFromScan(raw);
  if (gs1) return gs1;

  let digits = String(raw || '').replace(/\D/g, '');
  if (digits.length === 20 && digits.startsWith('00')) digits = digits.slice(2);
  // Wareneingang liefert oft 18 Ziffern ohne gültige Prüfziffer – trotzdem suchen
  if (digits.length === 18) return digits;
  if (digits.length >= 12 && digits.length <= 22 && /^\d+$/.test(digits)) return digits;

  const cleaned = String(raw || '')
    .trim()
    .replace(/^\]C1/i, '')
    .replace(/\s+/g, '')
    .toUpperCase();
  if (!cleaned) return null;
  if (/^[A-Z0-9-]{6,32}$/i.test(cleaned)) return cleaned;
  return null;
}

/** Wareneingang-/Soloplan-Code für Speicherung (Barcode auf Collo). */
export function normalizeIncomingSscc(raw: string | null | undefined): string | null {
  const cleaned = String(raw || '').trim();
  if (!cleaned) return null;
  let digits = cleaned.replace(/\D/g, '');
  if (digits.length === 20 && digits.startsWith('00')) digits = digits.slice(2);
  if (digits.length === 18) return digits;
  if (/^[A-Z0-9-]{6,32}$/i.test(cleaned.replace(/\s+/g, ''))) {
    return cleaned.replace(/\s+/g, '').toUpperCase();
  }
  if (digits.length >= 12) return digits;
  return cleaned;
}
