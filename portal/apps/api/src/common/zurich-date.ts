/** Kalender-Helfer für Dispo/Lademittel in Europe/Zurich. */

export const ZURICH_TZ = 'Europe/Zurich';

export function zurichDayKey(d: Date = new Date()): string {
  return d.toLocaleDateString('en-CA', { timeZone: ZURICH_TZ });
}

/**
 * Soloplan-StatusDate / LocationDate: lokale Zurich-Zeit ohne Z-Suffix
 * (wie Soloplan-Beispiele; UTC-Z würde in der Anzeige oft +2h wirken).
 */
export function formatZurichStatusDate(d: Date = new Date()): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: ZURICH_TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).formatToParts(d);
  const get = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((p) => p.type === type)?.value || '00';
  const hour = get('hour') === '24' ? '00' : get('hour');
  const ms = String(d.getMilliseconds()).padStart(3, '0');
  return `${get('year')}-${get('month')}-${get('day')}T${hour}:${get('minute')}:${get('second')}.${ms}`;
}

/** Dateiname-Stempel in Europe/Zurich (statt UTC). */
export function formatZurichFileStamp(d: Date = new Date()): string {
  return formatZurichStatusDate(d).replace(/[:.]/g, '-');
}

function zurichOffsetMinutes(instant: Date): number {
  const tz =
    new Intl.DateTimeFormat('en-US', {
      timeZone: ZURICH_TZ,
      timeZoneName: 'shortOffset',
      hour: '2-digit',
    })
      .formatToParts(instant)
      .find((p) => p.type === 'timeZoneName')?.value || 'GMT+0';
  const m = /([+-])(\d{1,2})(?::?(\d{2}))?/.exec(tz);
  if (!m) return 0;
  const sign = m[1] === '-' ? -1 : 1;
  return sign * (Number(m[2]) * 60 + Number(m[3] || 0));
}

/**
 * Zeitstempel ohne Zone als Europe/Zurich interpretieren.
 * Mit Z / Offset unverändert über `Date` parsen.
 */
export function parseTelematicsDateTime(raw: string): Date | undefined {
  const s = String(raw || '').trim();
  if (!s) return undefined;
  if (/[zZ]$|[+-]\d{2}:?\d{2}$/.test(s)) {
    const d = new Date(s);
    return Number.isNaN(d.getTime()) ? undefined : d;
  }
  const m = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,6}))?)?/.exec(s);
  if (!m) {
    const d = new Date(s);
    return Number.isNaN(d.getTime()) ? undefined : d;
  }
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const day = Number(m[3]);
  const hh = Number(m[4]);
  const mi = Number(m[5]);
  const ss = Number(m[6] || '0');
  const frac = (m[7] || '0').padEnd(3, '0').slice(0, 3);
  const ms = Number(frac);
  const utcGuess = new Date(Date.UTC(y, mo - 1, day, hh, mi, ss, ms));
  const offsetMin = zurichOffsetMinutes(utcGuess);
  const instant = new Date(utcGuess.getTime() - offsetMin * 60_000);
  // Offset an der korrekten Instant nochmals prüfen (MESZ/MEZ-Grenze)
  const offset2 = zurichOffsetMinutes(instant);
  if (offset2 !== offsetMin) {
    return new Date(utcGuess.getTime() - offset2 * 60_000);
  }
  return instant;
}

export function zurichMonthKey(d: Date = new Date()): string {
  return zurichDayKey(d).slice(0, 7);
}

/** UTC-Grenzen mit Puffer; Feinfilterung ggf. per dayKey. */
export function zurichMonthRange(month: string): { from: Date; to: Date } {
  const m = /^(\d{4})-(\d{2})$/.exec(month);
  if (!m) return zurichMonthRange(zurichMonthKey(new Date()));
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const from = new Date(Date.UTC(y, mo - 1, 1, 0, 0, 0) - 2 * 3600 * 1000);
  const to = new Date(Date.UTC(y, mo, 1, 0, 0, 0) + 24 * 3600 * 1000);
  return { from, to };
}

export function zurichDayRange(day: string): { from: Date; to: Date } {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(day);
  if (!m) return zurichDayRange(zurichDayKey(new Date()));
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  const from = new Date(Date.UTC(y, mo - 1, d, 0, 0, 0) - 2 * 3600 * 1000);
  const to = new Date(Date.UTC(y, mo - 1, d + 1, 0, 0, 0) + 24 * 3600 * 1000);
  return { from, to };
}
