/** Kalender-Helfer für Dispo/Lademittel in Europe/Zurich. */

export const ZURICH_TZ = 'Europe/Zurich';

export function zurichDayKey(d: Date = new Date()): string {
  return d.toLocaleDateString('en-CA', { timeZone: ZURICH_TZ });
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
