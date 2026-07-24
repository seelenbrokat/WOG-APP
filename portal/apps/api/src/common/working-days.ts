/** Werktag-Logik (Europe/Zurich) – Proforma am Vortag → WE am nächsten Werktag. */

const TZ = 'Europe/Zurich';

function pad(n: number) {
  return String(n).padStart(2, '0');
}

/** Aktuelles Kalenderdatum in Europe/Zurich (YYYY-MM-DD). */
export function zurichDateStr(now: Date = new Date()): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(now);
  const get = (type: Intl.DateTimeFormatPartTypes) =>
    Number(parts.find((p) => p.type === type)?.value || 0);
  return `${get('year')}-${pad(get('month'))}-${pad(get('day'))}`;
}

function parseYmd(dateStr: string): { y: number; m: number; d: number } {
  const [y, m, d] = dateStr.split('-').map(Number);
  return { y, m, d };
}

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
 * Wareneingangs-Datum für eine Proforma:
 * Proforma kommt i. d. R. am Vortag → Session/Übersicht für den nächsten Werktag.
 */
export function proformaGoodsReceiptDate(now: Date = new Date()): string {
  return nextWorkingDay(zurichDateStr(now));
}
