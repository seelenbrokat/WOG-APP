/**
 * VIP eLogistics Auftragsdatei (K/L[/I]-Sätze, Semikolon, CR/LF).
 *
 * Preise werden bewusst NICHT übermittelt:
 * - K.37 VBET (Versicherungswert) → leer
 * - K.38 NNBET (Nachnahme) → leer
 * - I.245 WARENWERT / I.246 Währung → leer (I-Satz entfällt daher)
 */
import type { VipBuildOptions, VipGoodsLine, VipShipmentInput } from './vip.types';

const K_FIELD_COUNT = 111;
const L_FIELD_COUNT = 142;

function clean(v: unknown, maxLen?: number): string {
  let s = String(v ?? '')
    .replace(/;/g, ',')
    .replace(/[\r\n]+/g, ' ')
    .trim();
  if (maxLen != null && s.length > maxLen) s = s.slice(0, maxLen);
  return s;
}

function numStr(v: number | undefined | null, decimals?: number): string {
  if (v == null || !Number.isFinite(v)) return '';
  if (decimals != null) return v.toFixed(decimals);
  return String(v);
}

/** VIP-Datum JJJJ.MM.TT */
export function formatVipDate(d?: Date | null): string {
  if (!d || Number.isNaN(d.getTime())) return '';
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}.${m}.${day}`;
}

/** VIP-Zeit HHMM */
export function formatVipTime(d?: Date | null): string {
  if (!d || Number.isNaN(d.getTime())) return '';
  const h = String(d.getHours()).padStart(2, '0');
  const min = String(d.getMinutes()).padStart(2, '0');
  return `${h}${min}`;
}

/** Soloplan-Land (A/D/CH/…) → ISO-ähnlich für VIP */
export function mapVipCountry(raw?: string | null): string {
  const s = String(raw || '')
    .trim()
    .toUpperCase();
  if (!s) return '';
  const map: Record<string, string> = {
    A: 'AT',
    AT: 'AT',
    AUT: 'AT',
    D: 'DE',
    DE: 'DE',
    DEU: 'DE',
    CH: 'CH',
    CHE: 'CH',
    I: 'IT',
    IT: 'IT',
    ITA: 'IT',
    F: 'FR',
    FR: 'FR',
    FRA: 'FR',
    LI: 'LI',
    LIE: 'LI',
  };
  return map[s] || s.slice(0, 4);
}

/** Einheit für GUTEH – Absprache mit ebele; sinnvolle Defaults. */
export function mapVipUnit(raw?: string | null): string {
  const s = String(raw || '')
    .trim()
    .toLowerCase();
  if (!s) return 'Col';
  if (/^(ep|eur|euro|palette|pal|plt)$/.test(s)) return 'Pal';
  if (/^(col|colli|pkt|paket|pck|pkg|stück|stk|st)$/.test(s)) return 'Col';
  if (/^(kg|kilo)/.test(s)) return 'kg';
  return clean(raw, 4) || 'Col';
}

function joinFields(fields: string[], count: number): string {
  const out: string[] = [];
  for (let i = 0; i < count; i += 1) out.push(fields[i] ?? '');
  // Trailing leere Felder kürzen bis zum letzten gesetzten Wert (VIP erlaubt variabel),
  // aber mind. Pflichtkern behalten – Spec: unbenutzte mit ';' angeben.
  // Wir schreiben volle Breite laut Spec-Version, damit Parser stabil bleiben.
  return out.join(';');
}

function streetLine(street?: string, house?: string): string {
  return [street, house].filter(Boolean).join(' ').trim();
}

export function buildVipKLine(shipment: VipShipmentInput, opts: VipBuildOptions): string {
  const f: string[] = new Array(K_FIELD_COUNT).fill('');
  const anr = clean(opts.anr, 20);
  const auftnr = clean(shipment.orderNumber, 50);
  if (!anr) throw new Error('VIP ANR (Auftraggebernummer) fehlt');
  if (!auftnr) throw new Error('VIP AUFTNR fehlt');

  const sender = shipment.sender || {};
  const receiver = shipment.receiver || {};

  f[0] = 'K'; // 1 SATZ
  f[1] = anr; // 2 ANR
  f[2] = auftnr; // 3 AUFTNR
  f[3] = clean(shipment.deliveryNote || auftnr, 80); // 4 LSR
  f[4] = formatVipDate(shipment.orderDate || shipment.loadingFrom || new Date()); // 5 ADAT
  f[5] = clean(sender.phone, 25); // 6 LAVIS1
  f[6] = clean(sender.contactName, 30); // 7 LAVIS2
  f[7] = clean(shipment.loadingRemark1, 50); // 8 BEM1
  f[8] = clean(shipment.loadingRemark2, 50); // 9 BEM2
  f[9] = formatVipDate(shipment.loadingFrom); // 10 BDAT1
  f[10] = formatVipDate(shipment.loadingUntil || shipment.loadingFrom); // 11 BDAT2
  f[11] = formatVipTime(shipment.loadingFrom); // 12 BTIM1
  f[12] = formatVipTime(shipment.loadingUntil); // 13 BTIM2
  f[13] = clean(sender.name, 30); // 14 VNAME
  f[14] = clean(sender.street, 30); // 15 VSTR
  f[15] = mapVipCountry(sender.country); // 16 VLAND
  f[16] = clean(sender.zip, 10); // 17 VPLZ
  f[17] = clean(sender.city, 30); // 18 VORT
  f[18] = clean(receiver.phone, 25); // 19 AAVIS1
  f[19] = clean(receiver.contactName, 30); // 20 AAVIS2
  f[20] = clean(shipment.unloadingRemark1, 50); // 21 BEM3
  f[21] = clean(shipment.unloadingRemark2, 50); // 22 BEM4
  f[22] = formatVipDate(shipment.unloadingFrom); // 23 TDAT1
  f[23] = formatVipDate(shipment.unloadingUntil || shipment.unloadingFrom); // 24 TDAT2
  f[24] = formatVipTime(shipment.unloadingFrom); // 25 TTIM1
  f[25] = formatVipTime(shipment.unloadingUntil); // 26 TTIM2
  f[26] = clean(receiver.name, 30); // 27 EMPF
  f[27] = clean(receiver.street, 30); // 28 ESTR
  f[28] = mapVipCountry(receiver.country); // 29 ELAND
  f[29] = clean(receiver.zip, 10); // 30 EPLZ
  f[30] = clean(receiver.city, 30); // 31 EORT
  // 32–34 Reserve
  f[34] = '0'; // 35 ADR – kein Gefahrengut default; ggf. aus Goods überschreiben
  // 36 VCODE leer
  // 37 VBET – PREIS: bewusst leer
  // 38 NNBET – PREIS: bewusst leer
  f[41] = clean(receiver.name2, 30); // 42 EMPF2
  f[42] = clean(sender.name2, 30); // 43 VNAME2

  const hasDg = shipment.goods.some((g) => g.dangerousGoods);
  if (hasDg) f[34] = '1';

  const pal =
    shipment.palletCount ??
    shipment.goods
      .filter((g) => mapVipUnit(g.unit) === 'Pal')
      .reduce((sum, g) => sum + (g.quantity || 0), 0);
  if (pal) f[58] = String(Math.round(pal)); // 59 PAL

  if (shipment.storagePlaces != null) f[65] = numStr(shipment.storagePlaces, 2); // 66 STELLPLATZ
  else if (shipment.loadingMeter != null) f[65] = numStr(shipment.loadingMeter, 2);

  // 91 eLog = 2 (Konvert) laut Spec
  f[90] = '2';

  return joinFields(f, K_FIELD_COUNT);
}

export function buildVipLLine(
  shipment: VipShipmentInput,
  line: VipGoodsLine,
  opts: VipBuildOptions,
): string {
  const f: string[] = new Array(L_FIELD_COUNT).fill('');
  f[0] = 'L';
  f[1] = clean(opts.anr, 20);
  f[2] = clean(shipment.orderNumber, 50);
  f[3] = String(line.position || 1); // 104 LPOS
  f[4] = clean(line.articleNumber, 30); // 105 GUTART
  f[5] = numStr(line.quantity, 2); // 106 GUTANZ
  f[6] = mapVipUnit(line.unit); // 107 GUTEH
  // 108–111 ADR…
  f[11] = '0'; // 112 GUTFREI
  f[12] = numStr(line.lengthCm, 2); // 113 GUTL
  f[13] = numStr(line.widthCm, 2); // 114 GUTB
  f[14] = numStr(line.heightCm, 2); // 115 GUTH
  f[15] = clean(line.content, 30); // 116 GUTINH
  // 117 Reserve
  f[17] = numStr(line.weightKg, 3); // 118 GUTKG
  f[18] = numStr(line.volumeM3, 3); // 119 GUTVOL
  f[21] = clean(line.packaging, 4); // 122 GUTVER
  f[25] = clean(line.barcodeNve, 120); // 126 GUTZIFFZEICH / NVE
  return joinFields(f, L_FIELD_COUNT);
}

/**
 * Baut eine VIP-Auftragsdatei (eine oder mehrere Sendungen).
 * Enthält keine Preis-/Warenwert-Felder.
 */
export function buildVipFile(shipments: VipShipmentInput[], opts: VipBuildOptions): string {
  const eol = opts.lineEnding || '\r\n';
  const lines: string[] = [];
  for (const shipment of shipments) {
    lines.push(buildVipKLine(shipment, opts));
    const goods =
      shipment.goods?.length > 0
        ? shipment.goods
        : [{ position: 1, quantity: 1, unit: 'Col', content: 'Sendung' }];
    for (const g of goods) {
      lines.push(buildVipLLine(shipment, g, opts));
    }
  }
  return lines.join(eol) + eol;
}

/** Prüft, dass keine Preis-Felder gesetzt wurden (Regressionsschutz). */
export function assertNoVipPrices(content: string): void {
  for (const raw of content.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    const parts = line.split(';');
    const kind = parts[0];
    if (kind === 'K') {
      const vbet = (parts[36] || '').trim();
      const nnbet = (parts[37] || '').trim();
      if (vbet && vbet !== '0' && vbet !== '0.00') {
        throw new Error(`VIP Preis-Leak VBET=${vbet}`);
      }
      if (nnbet && nnbet !== '0' && nnbet !== '0.00') {
        throw new Error(`VIP Preis-Leak NNBET=${nnbet}`);
      }
      // Auch 0.00 vermeiden – Spec erlaubt leer; wir wollen keine Beträge
      if (vbet || nnbet) {
        throw new Error('VIP Preis-Felder VBET/NNBET müssen leer sein');
      }
    }
    if (kind === 'I') {
      const warenwert = (parts[244] || '').trim(); // Feld 245 (0-basiert Index 244)
      if (warenwert) throw new Error(`VIP Preis-Leak WARENWERT=${warenwert}`);
    }
  }
}

export function partnerStreet(street?: string, houseNumber?: string): string {
  return streetLine(street, houseNumber);
}
