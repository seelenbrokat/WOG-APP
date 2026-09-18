/** Werktag-Logik für Abhol-/Zustellvorbelegung (Europe/Zurich). */

const TZ = 'Europe/Zurich';

export type DateTimeParts = {
  date: string; // YYYY-MM-DD
  time: string; // HH:mm
};

function pad(n: number) {
  return String(n).padStart(2, '0');
}

/** Aktuelles Datum/Uhrzeit in Europe/Zurich. */
export function zurichNow(now: Date = new Date()): {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  dateStr: string;
} {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(now);
  const get = (type: Intl.DateTimeFormatPartTypes) =>
    Number(parts.find((p) => p.type === type)?.value || 0);
  const year = get('year');
  const month = get('month');
  const day = get('day');
  let hour = get('hour');
  // en-CA kann 24:00 liefern → 0
  if (hour === 24) hour = 0;
  const minute = get('minute');
  return {
    year,
    month,
    day,
    hour,
    minute,
    dateStr: `${year}-${pad(month)}-${pad(day)}`,
  };
}

function parseYmd(dateStr: string): { y: number; m: number; d: number } {
  const [y, m, d] = dateStr.split('-').map(Number);
  return { y, m, d };
}

/** Wochentag 0=So … 6=Sa für ein Kalenderdatum (ohne TZ-Shift). */
function weekdayUtc(dateStr: string): number {
  const { y, m, d } = parseYmd(dateStr);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

export function isWorkingDay(dateStr: string): boolean {
  const wd = weekdayUtc(dateStr);
  return wd !== 0 && wd !== 6;
}

function addDays(dateStr: string, days: number): string {
  const { y, m, d } = parseYmd(dateStr);
  const dt = new Date(Date.UTC(y, m - 1, d + days));
  return `${dt.getUTCFullYear()}-${pad(dt.getUTCMonth() + 1)}-${pad(dt.getUTCDate())}`;
}

/** Nächster Werktag nach dem angegebenen Datum (nicht inklusive). */
export function nextWorkingDay(dateStr: string): string {
  let cur = addDays(dateStr, 1);
  while (!isWorkingDay(cur)) cur = addDays(cur, 1);
  return cur;
}

/**
 * Abholung: heute (Werktag), wenn Erfassung bis 11:30 Uhr (Europe/Zurich);
 * sonst nächster Werktag. Uhrzeit immer 00:00.
 */
export function defaultPickupDateTime(now: Date = new Date()): DateTimeParts {
  const z = zurichNow(now);
  const cutoffMinutes = 11 * 60 + 30;
  const nowMinutes = z.hour * 60 + z.minute;
  let date = z.dateStr;
  if (!(isWorkingDay(date) && nowMinutes <= cutoffMinutes)) {
    date = nextWorkingDay(date);
  }
  return { date, time: '00:00' };
}

/**
 * Zustellung: nächster Werktag nach Abholung bis übernächster Werktag.
 * Uhrzeiten jeweils 00:00.
 */
export function defaultDeliveryWindow(pickupDateStr: string): {
  start: DateTimeParts;
  end: DateTimeParts;
} {
  const startDate = nextWorkingDay(pickupDateStr);
  const endDate = nextWorkingDay(startDate);
  return {
    start: { date: startDate, time: '00:00' },
    end: { date: endDate, time: '00:00' },
  };
}

/** Kombiniert Datum+Zeit zu ISO (UTC-Kalenderzeit = Anzeige 00:00 in Soloplan auf UTC-Server). */
export function combineDateTimeIso(date: string, time: string): string {
  const { y, m, d } = parseYmd(date);
  const [hh, mm] = time.split(':').map((x) => Number(x) || 0);
  return new Date(Date.UTC(y, m - 1, d, hh, mm, 0)).toISOString();
}

export function defaultShipmentSchedule(now: Date = new Date()) {
  const pickup = defaultPickupDateTime(now);
  const delivery = defaultDeliveryWindow(pickup.date);
  return { pickup, deliveryStart: delivery.start, deliveryEnd: delivery.end };
}
