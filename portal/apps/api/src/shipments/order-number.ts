/**
 * Externe Auftragsnummer: VLB + Tag(TT) + Monat(MM) + 5-stellige laufende Nummer
 * Beispiel: VLB200700001 (20.07. → VLB2007 + 00001)
 */
export function vlbOrderPrefix(date: Date = new Date()): string {
  const dd = String(date.getDate()).padStart(2, '0');
  const mm = String(date.getMonth() + 1).padStart(2, '0');
  return `VLB${dd}${mm}`;
}

export function formatVlbOrderNumber(seq: number, date: Date = new Date()): string {
  if (seq < 1 || seq > 99999) {
    throw new Error(`Auftrags-Sequenz außerhalb 1..99999: ${seq}`);
  }
  return `${vlbOrderPrefix(date)}${String(seq).padStart(5, '0')}`;
}

/** Liest die höchste 5-stellige Sequenz aus bestehenden Nummern mit gleichem Tages-Präfix. */
export function nextSeqFromExisting(externalNumbers: string[], date: Date = new Date()): number {
  const prefix = vlbOrderPrefix(date);
  let max = 0;
  for (const n of externalNumbers) {
    if (!n.startsWith(prefix)) continue;
    const tail = n.slice(prefix.length);
    if (/^\d{5}$/.test(tail)) {
      max = Math.max(max, Number(tail));
    }
  }
  return max + 1;
}
