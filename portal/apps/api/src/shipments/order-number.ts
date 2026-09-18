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

/** Minimaler Prisma-Ausschnitt für die VLB-Vergabe (TransportOrder + CustomsOrder). */
export type VlbNumberDb = {
  transportOrder: {
    findMany: (args: {
      where: { organizationId: string; externalNumber: { startsWith: string } };
      select: { externalNumber: true };
      orderBy: { externalNumber: 'desc' };
      take: number;
    }) => Promise<Array<{ externalNumber: string }>>;
  };
  customsOrder: {
    findMany: (args: {
      where: { organizationId: string; externalNumber: { startsWith: string } };
      select: { externalNumber: true };
      orderBy: { externalNumber: 'desc' };
      take: number;
    }) => Promise<Array<{ externalNumber: string | null }>>;
  };
};

/**
 * Nächste freie VLB-Nummer für die Organisation (Tagessequenz).
 * Berücksichtigt TransportOrder und CustomsOrder gemeinsam.
 */
export async function allocateVlbExternalNumber(
  db: VlbNumberDb,
  organizationId: string,
  date: Date = new Date(),
): Promise<string> {
  const prefix = vlbOrderPrefix(date);
  const [orders, customs] = await Promise.all([
    db.transportOrder.findMany({
      where: { organizationId, externalNumber: { startsWith: prefix } },
      select: { externalNumber: true },
      orderBy: { externalNumber: 'desc' },
      take: 50,
    }),
    db.customsOrder.findMany({
      where: { organizationId, externalNumber: { startsWith: prefix } },
      select: { externalNumber: true },
      orderBy: { externalNumber: 'desc' },
      take: 50,
    }),
  ]);
  const existing = [
    ...orders.map((e) => e.externalNumber),
    ...customs.map((e) => e.externalNumber).filter((n): n is string => Boolean(n)),
  ];
  return formatVlbOrderNumber(nextSeqFromExisting(existing, date), date);
}
