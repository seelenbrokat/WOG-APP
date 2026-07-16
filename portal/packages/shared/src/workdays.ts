/** Werktage Mo–Fr (ohne Feiertagskalender). Datum als UTC-Mitternacht. */

function toUtcDateOnly(d: Date): Date {
  return new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
}

function isWeekend(d: Date): boolean {
  const day = d.getUTCDay();
  return day === 0 || day === 6;
}

export function formatDateOnly(d: Date): string {
  return toUtcDateOnly(d).toISOString().slice(0, 10);
}

export function todayDateOnly(now = new Date()): Date {
  return toUtcDateOnly(now);
}

/**
 * Fenster: die letzten `past` Werktage (inkl. heute falls Werktag)
 * plus `future` Werktage in die Zukunft.
 */
export function workdayWindow(opts: {
  past?: number;
  future?: number;
  from?: Date;
}): Date[] {
  const past = opts.past ?? 10;
  const future = opts.future ?? 2;
  const from = todayDateOnly(opts.from ?? new Date());

  const pastDays: Date[] = [];
  const cursor = new Date(from);
  while (pastDays.length < past) {
    if (!isWeekend(cursor)) pastDays.push(new Date(cursor));
    cursor.setUTCDate(cursor.getUTCDate() - 1);
  }
  pastDays.reverse();

  const futureDays: Date[] = [];
  const ahead = new Date(from);
  ahead.setUTCDate(ahead.getUTCDate() + 1);
  while (futureDays.length < future) {
    if (!isWeekend(ahead)) futureDays.push(new Date(ahead));
    ahead.setUTCDate(ahead.getUTCDate() + 1);
  }

  return [...pastDays, ...futureDays];
}
