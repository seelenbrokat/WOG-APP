/**
 * Parser für System Alliance FORTRAS STAT512 (Statusdaten, Release 100).
 * Feldpositionen 1-basiert inklusiv (wie BORD512).
 */

import { f } from './bord512.parser';

export type Stat512Q00 = {
  releaseVersion: string;
  codeList: string;
  consignorId: string;
  consigneeId: string;
  causingPartyId: string;
};

export type Stat512Q10 = {
  consignmentNumberSendingDepot: string;
  consignmentNumberReceivingDepot: string;
  pickupOrderNumber: string;
  statusCode: string;
  /** ISO YYYY-MM-DD */
  eventDate?: string;
  /** HH:mm */
  eventTime?: string;
  eventAt?: Date;
  consignmentNumberDeliveringParty: string;
  waitDowntimeMinutes?: number;
  nameOfAcknowledgingParty: string;
  additionalText: string;
  referenceNumber: string;
};

export type Stat512Message = {
  senderMailbox?: string;
  receiverMailbox?: string;
  header?: Stat512Q00;
  events: Stat512Q10[];
  sourceFileName?: string;
};

function padLine(line: string, minLen: number): string {
  return line.length >= minLen ? line : line.padEnd(minLen, ' ');
}

function parseDdMmYyyyHhMm(dateRaw: string, timeRaw: string): Date | undefined {
  const d = String(dateRaw || '').trim();
  const t = String(timeRaw || '').trim().padStart(4, '0');
  if (!/^\d{8}$/.test(d)) return undefined;
  const dd = Number(d.slice(0, 2));
  const mm = Number(d.slice(2, 4));
  const yyyy = Number(d.slice(4, 8));
  const hh = Number(t.slice(0, 2));
  const mi = Number(t.slice(2, 4));
  if (![dd, mm, yyyy, hh, mi].every((n) => Number.isFinite(n))) return undefined;
  // Europa/Zürich-Lokalzeit als naive local → Date (Worker läuft CET/CEST)
  const dt = new Date(yyyy, mm - 1, dd, hh, mi, 0, 0);
  return Number.isNaN(dt.getTime()) ? undefined : dt;
}

function eventDateIso(dateRaw: string): string | undefined {
  const d = String(dateRaw || '').trim();
  if (!/^\d{8}$/.test(d)) return undefined;
  return `${d.slice(4, 8)}-${d.slice(2, 4)}-${d.slice(0, 2)}`;
}

function eventTimeHm(timeRaw: string): string | undefined {
  const t = String(timeRaw || '').trim().padStart(4, '0');
  if (!/^\d{4}$/.test(t)) return undefined;
  return `${t.slice(0, 2)}:${t.slice(2, 4)}`;
}

export function isStat512Content(content: string): boolean {
  return /@@PH\s*STAT512/i.test(content) || /^@@PHSTAT512/im.test(content);
}

function parseQ00(line: string): Stat512Q00 {
  const L = padLine(line, 185);
  return {
    releaseVersion: f(L, 4, 6),
    codeList: f(L, 7, 9),
    consignorId: f(L, 10, 44),
    consigneeId: f(L, 45, 79),
    causingPartyId: f(L, 80, 114),
  };
}

function parseQ10(line: string): Stat512Q10 {
  const L = padLine(line, 280);
  const dateRaw = f(L, 112, 119);
  const timeRaw = f(L, 120, 123);
  const waitRaw = f(L, 159, 162);
  const wait =
    waitRaw && /^\d+$/.test(waitRaw) ? Number(waitRaw) : undefined;
  return {
    consignmentNumberSendingDepot: f(L, 4, 38),
    consignmentNumberReceivingDepot: f(L, 39, 73),
    pickupOrderNumber: f(L, 74, 108),
    statusCode: f(L, 109, 111),
    eventDate: eventDateIso(dateRaw),
    eventTime: eventTimeHm(timeRaw),
    eventAt: parseDdMmYyyyHhMm(dateRaw, timeRaw),
    consignmentNumberDeliveringParty: f(L, 124, 158),
    waitDowntimeMinutes: wait,
    nameOfAcknowledgingParty: f(L, 163, 197),
    additionalText: f(L, 198, 267),
    referenceNumber: f(L, 268, 279),
  };
}

/**
 * Primäre Sendungsnummer für Matching (Versandpartner / Empfang / Zusteller / Abholauftrag).
 */
export function primaryConsignmentNumber(ev: Stat512Q10): string {
  return (
    ev.consignmentNumberSendingDepot ||
    ev.consignmentNumberReceivingDepot ||
    ev.consignmentNumberDeliveringParty ||
    ev.pickupOrderNumber ||
    ''
  ).trim();
}

export function parseStat512(content: string, sourceFileName?: string): Stat512Message {
  const lines = String(content || '')
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .split('\n')
    .map((l) => l.replace(/\u0000/g, ''))
    .filter((l) => l.trim().length > 0);

  if (!lines.length || !isStat512Content(lines[0] + '\n' + (lines[1] || ''))) {
    // Header oft Zeile 1
    const joined = lines.join('\n');
    if (!isStat512Content(joined)) {
      throw new Error('Kein FORTRAS STAT512 (@@PHSTAT512 erwartet)');
    }
  }

  const msg: Stat512Message = {
    events: [],
    sourceFileName,
  };

  const headerLine = lines.find((l) => /^@@PH/i.test(l.trim())) || '';
  // Mailbox nach fester Startadresse 35 / Länge 7 (Standard-Beispiel)
  if (headerLine) {
    const H = padLine(headerLine, 50);
    msg.senderMailbox = f(H, 27, 33) || undefined;
    msg.receiverMailbox = f(H, 34, 40) || undefined;
  }

  for (const raw of lines) {
    const line = raw;
    const rec = f(padLine(line, 3), 1, 3).toUpperCase();
    if (rec === 'Q00') msg.header = parseQ00(line);
    else if (rec === 'Q10') msg.events.push(parseQ10(line));
  }

  return msg;
}
