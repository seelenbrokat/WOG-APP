/**
 * VIP Statusrückmeldung (ebele / gpANLAGE).
 *
 * Beispiel:
 *   890037;B001-G0030;2026.03.11;0832;1772680;SPL19973;LS-500296-007;;0;;
 *
 * Felder (beobachtet):
 *   1 ANR | 2 Statuscode | 3 Datum | 4 Zeit | 5 Ref1 | 6 Ref2 | 7 LSR | …
 */
import type { VipStatusEvent } from './vip.types';

const STATUS_LINE =
  /^\s*\d+\s*;\s*[A-Za-z0-9][A-Za-z0-9._-]{1,40}\s*;\s*\d{4}[.-]\d{2}[.-]\d{2}\s*;/;

export function isVipStatusContent(content: string): boolean {
  const lines = String(content || '')
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  if (!lines.length) return false;
  // Mindestens eine Statuszeile, keine FORTRAS/XML-Marker
  const head = lines.slice(0, 5).join('\n');
  if (/@@PHSTAT512/i.test(head) || /<status[\s>]/i.test(head)) return false;
  return lines.some((l) => STATUS_LINE.test(l));
}

function parseVipDateTime(dateRaw: string, timeRaw: string): Date | undefined {
  const d = String(dateRaw || '')
    .trim()
    .replace(/-/g, '.');
  const t = String(timeRaw || '')
    .trim()
    .replace(':', '');
  const dm = /^(\d{4})\.(\d{2})\.(\d{2})$/.exec(d);
  if (!dm) return undefined;
  let hh = 0;
  let mm = 0;
  let ss = 0;
  if (/^\d{4}$/.test(t)) {
    hh = Number(t.slice(0, 2));
    mm = Number(t.slice(2, 4));
  } else if (/^\d{6}$/.test(t)) {
    hh = Number(t.slice(0, 2));
    mm = Number(t.slice(2, 4));
    ss = Number(t.slice(4, 6));
  } else if (/^\d{1,2}:\d{2}/.test(timeRaw)) {
    const parts = String(timeRaw).split(':');
    hh = Number(parts[0]);
    mm = Number(parts[1]);
  }
  const iso = `${dm[1]}-${dm[2]}-${dm[3]}T${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}:${String(ss).padStart(2, '0')}`;
  const dt = new Date(iso);
  return Number.isNaN(dt.getTime()) ? undefined : dt;
}

export function parseVipStatus(content: string, _fileName?: string): { events: VipStatusEvent[] } {
  const events: VipStatusEvent[] = [];
  for (const raw of String(content || '').split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#') || !line.includes(';')) continue;
    if (!STATUS_LINE.test(line) && !/^[A-Za-z0-9]+;B001-/i.test(line)) continue;
    const p = line.split(';');
    if (p.length < 3) continue;
    const statusCode = String(p[1] || '').trim().toUpperCase();
    if (!statusCode) continue;
    events.push({
      anr: String(p[0] || '').trim() || undefined,
      statusCode,
      eventAt: parseVipDateTime(p[2] || '', p[3] || ''),
      ref1: String(p[4] || '').trim() || undefined,
      ref2: String(p[5] || '').trim() || undefined,
      deliveryNote: String(p[6] || '').trim() || undefined,
      rawLine: line,
    });
  }
  return { events };
}

/** Match-Schlüssel für TourConsignment / Shipment. */
export function vipStatusMatchKeys(ev: VipStatusEvent): string[] {
  const keys: string[] = [];
  const push = (v?: string | null) => {
    const s = String(v || '').trim();
    if (s && !keys.includes(s)) keys.push(s);
  };
  push(ev.ref1);
  push(ev.ref2);
  push(ev.deliveryNote);
  // LS-500296-007 → 500296 falls hilfreich
  if (ev.deliveryNote?.includes('-')) {
    const parts = ev.deliveryNote.split('-').filter(Boolean);
    for (const part of parts) {
      if (/^\d{5,}$/.test(part)) push(part);
    }
  }
  return keys;
}
