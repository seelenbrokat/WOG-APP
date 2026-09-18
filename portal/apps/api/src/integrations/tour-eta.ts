/**
 * Live-ETA aus Zustellapp (strukturierter Endpoint, Chat-Text oder Location-Information).
 *
 * Beispiel-Text:
 *   Erwartete Zustellung Tour 184200: ca. 23:41 (Fahrzeit 2 Std. 4 Min + 2×15 Min Stop)
 */

export type ParsedEtaMessage = {
  tourNumber: string;
  etaAt: Date;
  text: string;
  /** Uhrzeit HH:MM aus Freitext (Europe/Zurich Kalendertag) */
  timeLabel: string;
};

const ETA_RE =
  /Erwartete\s+Zustellung\s+Tour\s+(\d+)\s*:\s*ca\.\s*(\d{1,2}):(\d{2})(?:\s*\(([^)]*)\))?/i;

/** Aktuelles Kalenderdatum in Europe/Zurich als YYYY-MM-DD */
function zurichYmd(now = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Zurich',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);
}

/**
 * Wandzeit Europe/Zurich (Y-M-D HH:MM) → Date.
 * Nutzt den Offset am Zieltag (CET/CEST).
 */
function zurichWallTimeToDate(ymd: string, hour: number, minute: number): Date {
  // Probiere Sommerzeit (+02:00) und Winterzeit (+01:00)
  for (const offset of ['+02:00', '+01:00']) {
    const iso = `${ymd}T${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}:00${offset}`;
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) continue;
    const check = new Intl.DateTimeFormat('en-GB', {
      timeZone: 'Europe/Zurich',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }).format(d);
    const [h, m] = check.split(':').map(Number);
    if (h === hour && m === minute) return d;
  }
  // Fallback UTC
  return new Date(`${ymd}T${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}:00Z`);
}

export function parseEtaMessage(text: string, now = new Date()): ParsedEtaMessage | null {
  const raw = String(text || '').trim();
  if (!raw) return null;
  const m = raw.match(ETA_RE);
  if (!m) return null;
  const tourNumber = m[1];
  const hour = Number(m[2]);
  const minute = Number(m[3]);
  if (!Number.isFinite(hour) || !Number.isFinite(minute) || hour > 23 || minute > 59) return null;

  let ymd = zurichYmd(now);
  let etaAt = zurichWallTimeToDate(ymd, hour, minute);
  // Wenn ETA mehr als 2h in der Vergangenheit → nächster Zurich-Tag
  if (etaAt.getTime() < now.getTime() - 2 * 3600_000) {
    const next = new Date(now.getTime() + 24 * 3600_000);
    ymd = zurichYmd(next);
    etaAt = zurichWallTimeToDate(ymd, hour, minute);
  }

  const timeLabel = `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
  return {
    tourNumber,
    etaAt,
    text: raw,
    timeLabel,
  };
}

export function isEtaText(text: string): boolean {
  return ETA_RE.test(String(text || '').trim());
}

export type TourEtaView = {
  etaAt: string | null;
  etaText: string | null;
  etaUpdatedAt: string | null;
  etaSource: string | null;
  tourNumber: string | null;
};

export function toTourEtaView(tour: {
  tourNumber?: string | null;
  etaAt?: Date | null;
  etaText?: string | null;
  etaUpdatedAt?: Date | null;
  etaSource?: string | null;
} | null): TourEtaView | null {
  if (!tour?.etaAt && !tour?.etaText) return null;
  return {
    tourNumber: tour.tourNumber ?? null,
    etaAt: tour.etaAt ? tour.etaAt.toISOString() : null,
    etaText: tour.etaText ?? null,
    etaUpdatedAt: tour.etaUpdatedAt ? tour.etaUpdatedAt.toISOString() : null,
    etaSource: tour.etaSource ?? null,
  };
}

/**
 * Text für Soloplan Sendungsinformation Feld 5.
 * Nur die Zustellzeit (keine Fahrzeit/Stopps/Tournummer).
 */
export function formatEtaForSoloplanInfo5(opts: {
  etaText?: string | null;
  etaAt?: Date | null;
  tourNumber?: string | null;
}): string {
  if (opts.etaAt && !Number.isNaN(opts.etaAt.getTime())) {
    const time = new Intl.DateTimeFormat('de-CH', {
      timeZone: 'Europe/Zurich',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }).format(opts.etaAt);
    return `ETA ca. ${time}`;
  }

  // Fallback: Uhrzeit aus Freitext „… ca. HH:MM …“
  const m = String(opts.etaText || '').match(/ca\.\s*(\d{1,2}):(\d{2})/i);
  if (m) {
    const hour = Number(m[1]);
    const minute = Number(m[2]);
    if (Number.isFinite(hour) && Number.isFinite(minute) && hour <= 23 && minute <= 59) {
      return `ETA ca. ${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
    }
  }

  return '';
}
