/**
 * Parser für System Alliance FORTRAS BORD512 (Sendungsdaten, Release 100).
 * Feldpositionen sind 1-basiert inklusiv laut Spec BORD512.
 */

export type Bord512Address = {
  qualifier: string;
  name1: string;
  street: string;
  country: string;
  zip: string;
  city: string;
  customerNumber?: string;
  name2?: string;
  name3?: string;
};

export type Bord512Position = {
  itemNumber: number;
  quantity: number;
  packaging: string;
  content: string;
  marks?: string;
  weightKg?: number;
  lengthM?: number;
  widthM?: number;
  heightM?: number;
  cubicMeter?: number;
  loadingMeters?: number;
  barcodes: string[];
};

export type Bord512FreeText = {
  qualifier: string;
  text: string;
};

export type Bord512Consignment = {
  borderoPosition: number;
  shipper?: Bord512Address;
  consignee?: Bord512Address;
  customsDeliveryPlace?: string;
  positions: Bord512Position[];
  consignmentNumber: string;
  weightKg: number;
  frankatur?: string;
  directDelivery?: string;
  goodsGroup?: string;
  goodsValue?: number;
  goodsCurrency?: string;
  cubicMeter?: number;
  loadingMeters?: number;
  freeTexts: Bord512FreeText[];
};

export type Bord512Bordero = {
  dataType: string;
  release: string;
  borderoNumber: string;
  borderoDate?: string; // ISO date YYYY-MM-DD
  product?: string;
  currency?: string;
  senderId?: string;
  receiverId?: string;
  carrierName?: string;
  carrierCountry?: string;
  carrierZip?: string;
  carrierCity?: string;
  vehiclePlate1?: string;
  loadUnit?: string;
  consignments: Bord512Consignment[];
  sourceFileName?: string;
};

function padLine(line: string, minLen: number): string {
  return line.length >= minLen ? line : line.padEnd(minLen, ' ');
}

/** 1-basierte inklusive Slice, getrimmt */
export function f(line: string, from: number, to: number): string {
  return padLine(line, to).slice(from - 1, to).trim();
}

/** Numerisches Feld mit Dezimalstellen (nur Ziffern, / 10^dez) */
export function num(line: string, from: number, to: number, decimals: number): number | undefined {
  const raw = padLine(line, to).slice(from - 1, to).trim();
  if (!raw || !/^\d+$/.test(raw)) return undefined;
  const n = Number(raw);
  if (!Number.isFinite(n)) return undefined;
  return decimals > 0 ? n / 10 ** decimals : n;
}

function parseDateDdMmYyyy(raw?: string): string | undefined {
  const s = String(raw || '').trim();
  if (!/^\d{8}$/.test(s)) return undefined;
  const dd = s.slice(0, 2);
  const mm = s.slice(2, 4);
  const yyyy = s.slice(4, 8);
  return `${yyyy}-${mm}-${dd}`;
}

function normalizeCountry(code?: string): string {
  const c = String(code || '').trim().toUpperCase();
  if (!c) return '';
  if (c === 'A') return 'AT';
  if (c === 'D') return 'DE';
  if (c === 'CH' || c === 'AT' || c === 'DE' || c === 'IT' || c === 'FR') return c;
  return c.slice(0, 2);
}

function parseAddress(line: string): Bord512Address {
  return {
    qualifier: f(line, 7, 9),
    name1: f(line, 10, 44),
    street: f(line, 45, 79),
    country: normalizeCountry(f(line, 80, 82)),
    zip: f(line, 83, 91),
    city: f(line, 92, 126),
    customerNumber: f(line, 127, 161) || undefined,
    name2: f(line, 162, 196) || undefined,
    name3: f(line, 197, 231) || undefined,
  };
}

function companyName(addr: Bord512Address): string {
  return [addr.name1, addr.name2, addr.name3].filter(Boolean).join(' ').replace(/\s+/g, ' ').trim();
}

export function addressCompany(addr?: Bord512Address): string {
  return addr ? companyName(addr) : '';
}

/** SSCC/NVE aus F00-Barcode normalisieren */
export function normalizeSscc(barcode: string): string | undefined {
  const digits = String(barcode || '').replace(/\D/g, '');
  if (!digits) return undefined;
  // AI (00) + 18-stelliges SSCC
  if (digits.length >= 20 && digits.startsWith('00')) {
    return digits.slice(0, 20);
  }
  if (digits.length === 18) return `00${digits}`;
  if (digits.length >= 14) return digits;
  return digits || undefined;
}

export function parseBord512(content: string | Buffer, sourceFileName?: string): Bord512Bordero {
  const text =
    typeof content === 'string'
      ? content
      : content.toString('latin1');
  const lines = text
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .split('\n')
    .map((l) => l.replace(/\s+$/, ''))
    .filter((l) => l.length > 0);

  const header = lines.find((l) => l.startsWith('@@PH'));
  if (header && !header.includes('BORD512')) {
    throw new Error(`Kein BORD512-Header (gefunden: ${header.slice(0, 40)})`);
  }

  let dataType = '';
  let release = '';
  let borderoNumber = '';
  let borderoDate: string | undefined;
  let product: string | undefined;
  let currency: string | undefined;
  let senderId: string | undefined;
  let receiverId: string | undefined;
  let carrierName: string | undefined;
  let carrierCountry: string | undefined;
  let carrierZip: string | undefined;
  let carrierCity: string | undefined;
  let vehiclePlate1: string | undefined;
  let loadUnit: string | undefined;

  const byPos = new Map<number, Bord512Consignment>();

  const ensure = (pos: number): Bord512Consignment => {
    let c = byPos.get(pos);
    if (!c) {
      c = {
        borderoPosition: pos,
        positions: [],
        consignmentNumber: '',
        weightKg: 0,
        freeTexts: [],
      };
      byPos.set(pos, c);
    }
    return c;
  };

  for (const line of lines) {
    if (line.startsWith('@@')) continue;
    const satz = line.slice(0, 3);

    if (satz === 'A00') {
      dataType = f(line, 4, 6);
      release = f(line, 7, 9);
      borderoNumber = f(line, 10, 44);
      borderoDate = parseDateDdMmYyyy(f(line, 45, 52));
      product = f(line, 56, 58) || undefined;
      currency = f(line, 62, 64) || undefined;
      senderId = f(line, 65, 99) || undefined;
      receiverId = f(line, 100, 134) || undefined;
      carrierName = f(line, 135, 169) || undefined;
      carrierCountry = normalizeCountry(f(line, 170, 172)) || undefined;
      carrierZip = f(line, 173, 181) || undefined;
      carrierCity = f(line, 182, 216) || undefined;
      vehiclePlate1 = f(line, 217, 251) || undefined;
      continue;
    }

    if (satz === 'A10') {
      loadUnit = f(line, 4, 38) || loadUnit;
      continue;
    }

    if (satz === 'B00') {
      const pos = Number(f(line, 4, 6));
      if (!Number.isFinite(pos) || pos <= 0) continue;
      const addr = parseAddress(line);
      const c = ensure(pos);
      if (addr.qualifier === 'SHP') c.shipper = addr;
      else if (addr.qualifier === 'CON') c.consignee = addr;
      continue;
    }

    if (satz === 'C00') {
      const pos = Number(f(line, 4, 6));
      if (!Number.isFinite(pos) || pos <= 0) continue;
      const c = ensure(pos);
      c.customsDeliveryPlace = f(line, 38, 72) || undefined;
      continue;
    }

    if (satz === 'D00') {
      const pos = Number(f(line, 4, 6));
      if (!Number.isFinite(pos) || pos <= 0) continue;
      const c = ensure(pos);
      const itemNumber = Number(f(line, 7, 9)) || c.positions.length + 1;
      c.positions.push({
        itemNumber,
        quantity: Number(f(line, 10, 13)) || 1,
        packaging: f(line, 14, 16),
        content: f(line, 24, 58),
        marks: f(line, 59, 93) || undefined,
        weightKg: num(line, 94, 102, 3),
        lengthM: num(line, 112, 115, 2),
        widthM: num(line, 116, 119, 2),
        heightM: num(line, 120, 123, 2),
        cubicMeter: num(line, 124, 128, 3),
        loadingMeters: num(line, 129, 131, 1),
        barcodes: [],
      });
      continue;
    }

    if (satz === 'F00') {
      const pos = Number(f(line, 4, 6));
      const itemNumber = Number(f(line, 7, 9)) || 1;
      if (!Number.isFinite(pos) || pos <= 0) continue;
      const c = ensure(pos);
      const barcode = f(line, 10, 44);
      if (!barcode) continue;
      let posItem = c.positions.find((p) => p.itemNumber === itemNumber);
      if (!posItem) {
        posItem = {
          itemNumber,
          quantity: 1,
          packaging: '',
          content: '',
          barcodes: [],
        };
        c.positions.push(posItem);
      }
      posItem.barcodes.push(barcode);
      continue;
    }

    if (satz === 'G00') {
      const pos = Number(f(line, 4, 6));
      if (!Number.isFinite(pos) || pos <= 0) continue;
      const c = ensure(pos);
      c.consignmentNumber = f(line, 7, 41);
      c.weightKg = num(line, 42, 50, 3) ?? 0;
      c.frankatur = f(line, 51, 53) || undefined;
      c.directDelivery = f(line, 54, 54) || undefined;
      c.goodsGroup = f(line, 182, 184) || undefined;
      c.goodsValue = num(line, 185, 195, 2);
      c.goodsCurrency = f(line, 196, 198) || undefined;
      c.cubicMeter = num(line, 208, 212, 3);
      c.loadingMeters = num(line, 213, 215, 1);
      continue;
    }

    if (satz === 'H10') {
      const pos = Number(f(line, 4, 6));
      if (!Number.isFinite(pos) || pos <= 0) continue;
      const c = ensure(pos);
      const blocks: Array<[number, number, number, number]> = [
        [7, 9, 10, 79],
        [80, 82, 83, 152],
        [153, 155, 156, 225],
      ];
      for (const [qf, qt, tf, tt] of blocks) {
        const qualifier = f(line, qf, qt);
        const textVal = f(line, tf, tt);
        if (qualifier || textVal) {
          c.freeTexts.push({ qualifier, text: textVal });
        }
      }
      continue;
    }
  }

  const consignments = [...byPos.values()].sort(
    (a, b) => a.borderoPosition - b.borderoPosition,
  );

  if (!borderoNumber) {
    throw new Error('BORD512 ohne A00/Bordero-Nummer');
  }
  if (!consignments.length) {
    throw new Error('BORD512 ohne Sendungen (B00/G00)');
  }

  return {
    dataType,
    release,
    borderoNumber,
    borderoDate,
    product,
    currency,
    senderId,
    receiverId,
    carrierName,
    carrierCountry,
    carrierZip,
    carrierCity,
    vehiclePlate1,
    loadUnit,
    consignments,
    sourceFileName,
  };
}

export function isBord512Content(content: string | Buffer): boolean {
  const head =
    typeof content === 'string'
      ? content.slice(0, 80)
      : content.slice(0, 80).toString('latin1');
  return head.includes('BORD512') || /^[ABCDFGHIZ]00/m.test(head);
}
