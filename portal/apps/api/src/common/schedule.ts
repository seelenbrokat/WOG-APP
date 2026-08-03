import { zurichDayKey } from './zurich-date';

const WEEKDAY_MAP: Record<string, number> = {
  Mon: 1,
  Tue: 2,
  Wed: 3,
  Thu: 4,
  Fri: 5,
  Sat: 6,
  Sun: 7,
};

export function parseWeekdays(raw?: string | null): number[] {
  if (!raw?.trim()) return [1, 2, 3, 4, 5];
  const days = raw
    .split(',')
    .map((x) => Number(x.trim()))
    .filter((n) => Number.isInteger(n) && n >= 1 && n <= 7);
  return days.length ? [...new Set(days)].sort((a, b) => a - b) : [1, 2, 3, 4, 5];
}

export function zurichWeekday(d: Date = new Date()): number {
  const short = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Europe/Zurich',
    weekday: 'short',
  }).format(d);
  return WEEKDAY_MAP[short] || 1;
}

/** Nächster Lauf ab `after` (exklusiv): DAILY = Folgetag, WEEKLY = nächster Wochentag. */
export function computeNextRun(
  after: Date,
  freq: string,
  weekdays?: string | null,
): Date {
  const base = new Date(after.getTime() + 60_000);
  if (freq === 'WEEKLY') {
    const wanted = parseWeekdays(weekdays);
    for (let i = 0; i < 14; i++) {
      const candidate = new Date(base.getTime() + i * 24 * 60 * 60 * 1000);
      if (wanted.includes(zurichWeekday(candidate))) {
        return zurichMorning(candidate);
      }
    }
  }
  return zurichMorning(new Date(base.getTime() + 24 * 60 * 60 * 1000));
}

function zurichMorning(d: Date): Date {
  const key = zurichDayKey(d);
  const [y, m, day] = key.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, day, 4, 0, 0));
}
