/**
 * Transformation FORTRAS BORD512 → Soloplan OrderImportPORTAL v6 (order JSON).
 */
import { randomUUID } from 'crypto';
import {
  addressCompany,
  Bord512Address,
  Bord512Bordero,
  Bord512Consignment,
  Bord512FreeText,
  normalizeSscc,
  parseBord512,
} from './bord512.parser';
import { splitStreet } from '../soloplan-order.mapper';

export type SoloplanFreightPayer = {
  number?: string | number | null;
  matchcode?: string | null;
  name?: string | null;
  phone?: string | null;
  vatId?: string | null;
};

export type Bord512TransformOptions = {
  freightPayer?: SoloplanFreightPayer | null;
  /** objectOwner.id – WOG-Mandant in Soloplan, Default 2 */
  objectOwnerId?: number;
  /** Eine Order-Datei pro Bordero (mehrere consignments) – Default true */
  singleOrder?: boolean;
  sourceFileName?: string;
};

function countryIso(code?: string | null): string {
  const c = String(code || 'AT').trim().toUpperCase();
  if (c === 'A') return 'AT';
  if (c === 'D') return 'DE';
  return (c.slice(0, 2) || 'AT').toUpperCase();
}

function formatDateTime(isoDate?: string | null): string {
  const d = isoDate ? new Date(`${isoDate}T08:00:00`) : new Date();
  if (Number.isNaN(d.getTime())) {
    const now = new Date();
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}T${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`;
  }
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

function formatDate(isoDate?: string | null): string {
  return formatDateTime(isoDate).slice(0, 10);
}

/** FORTRAS Verpackung → Soloplan packaging */
export function mapPackaging(code?: string): string {
  const c = String(code || '')
    .trim()
    .toUpperCase();
  const map: Record<string, string> = {
    PA: 'EWP',
    PAL: 'EWP',
    EP: 'EWP',
    EWP: 'EWP',
    KT: 'KRT',
    KRT: 'KRT',
    CT: 'KRT',
    PK: 'KRT',
    COL: 'KRT',
    BX: 'KRT',
    FA: 'FASS',
    FAE: 'FASS',
  };
  return map[c] || (c ? c : 'KRT');
}

function partyFromAddress(addr?: Bord512Address) {
  if (!addr) {
    return {
      name1: '',
      street: '',
      country: 'AT',
      zipCode: '',
      city1: '',
    };
  }
  const fullName = addressCompany(addr);
  const { street, houseNumber } = splitStreet(addr.street);
  return {
    name1: fullName || addr.name1 || '',
    street: street || addr.street || '',
    ...(houseNumber ? { houseNumber } : {}),
    country: countryIso(addr.country),
    zipCode: addr.zip || '',
    city1: addr.city || '',
  };
}

function parseContactPipe(text: string): {
  name?: string;
  email?: string;
  phone?: string;
} {
  const parts = text
    .split('|')
    .map((p) => p.trim())
    .filter((p) => p && p !== '.' && p !== '-');
  if (!parts.length) return {};
  const email = parts.find((p) => p.includes('@'));
  const phone = parts.find(
    (p) => !p.includes('@') && /(\+|^\d)/.test(p.replace(/\s/g, '')),
  );
  const name = parts.find((p) => p !== email && p !== phone);
  return {
    ...(name ? { name } : {}),
    ...(email ? { email } : {}),
    ...(phone ? { phone } : {}),
  };
}

function contactsFromFreeTexts(texts: Bord512FreeText[]) {
  const senderBits: string[] = [];
  const receiverBits: string[] = [];
  for (const t of texts) {
    const q = t.qualifier.toUpperCase();
    // H10: oft Qualifier 000 + Text "Name|Tel" / "Name|Mail|Tel"
    if (!t.text) continue;
    if (q === '000' || !q) {
      // Reihenfolge: erst Absender-Kontakt, dann Empfänger
      if (!senderBits.length) senderBits.push(t.text);
      else receiverBits.push(t.text);
    } else {
      receiverBits.push(t.text);
    }
  }
  // In Quehenberger-Sample stehen beide Kontakte in einem H10-Satz (Text1 + Text2)
  if (texts.length === 1 && texts[0].text) {
    // bereits über Blöcke gesplittet
  }
  const sender = parseContactPipe(senderBits.join('|'));
  const receiver = parseContactPipe(receiverBits.join('|'));
  return { sender, receiver, rawNotes: texts.map((t) => t.text).filter(Boolean) };
}

function buildConsignmentItems(c: Bord512Consignment) {
  const mark = c.consignmentNumber;
  const items: any[] = [];
  let itemNo = 1;

  for (const pos of c.positions) {
    const ssccs = pos.barcodes
      .map(normalizeSscc)
      .filter((x): x is string => Boolean(x));

    if (ssccs.length > 1) {
      const weightEach =
        pos.weightKg != null && ssccs.length
          ? Number((pos.weightKg / ssccs.length).toFixed(3))
          : pos.weightKg;
      for (const sscc of ssccs) {
        items.push({
          itemNumber: itemNo++,
          quantity: 1,
          content1: pos.content || pos.marks || 'Ware',
          ...(weightEach != null
            ? {
                weights: {
                  effectiveWeightInKilogram: weightEach,
                  carrierWeightInKilogram: weightEach,
                },
              }
            : {}),
          mark,
          packaging: mapPackaging(pos.packaging),
          articleQuantity: 1,
          ssccCurrents: [{ code: sscc }],
          ...(pos.cubicMeter != null ? { dimensions: { cubicMeter: pos.cubicMeter } } : {}),
          dangerousGoods: { areDangerToEnvironment: false, limitedAmount: false },
          hazardousMaterial: 0,
          waterHazardClass: 0,
        });
      }
      continue;
    }

    const qty = Math.max(1, Number(pos.quantity) || 1);
    const lengthM = pos.lengthM && pos.lengthM > 0 ? pos.lengthM : undefined;
    const widthM = pos.widthM && pos.widthM > 0 ? pos.widthM : undefined;
    const heightM = pos.heightM && pos.heightM > 0 ? pos.heightM : undefined;
    const cubicMeter = pos.cubicMeter && pos.cubicMeter > 0 ? pos.cubicMeter : undefined;
    items.push({
      itemNumber: itemNo++,
      quantity: qty,
      content1: pos.content || pos.marks || 'Ware',
      ...(pos.weightKg != null
        ? {
            weights: {
              effectiveWeightInKilogram: pos.weightKg,
              carrierWeightInKilogram: pos.weightKg,
            },
          }
        : {}),
      ...(lengthM != null || widthM != null || heightM != null
        ? {
            size: {
              ...(lengthM != null ? { lengthInMeters: lengthM } : {}),
              ...(widthM != null ? { widthInMeters: widthM } : {}),
              ...(heightM != null ? { heightInMeters: heightM } : {}),
            },
          }
        : {}),
      mark,
      packaging: mapPackaging(pos.packaging),
      articleQuantity: qty,
      ...(ssccs[0] ? { ssccCurrents: [{ code: ssccs[0] }] } : {}),
      ...(cubicMeter != null ? { dimensions: { cubicMeter } } : {}),
      dangerousGoods: { areDangerToEnvironment: false, limitedAmount: false },
      hazardousMaterial: 0,
      waterHazardClass: 0,
    });
  }

  if (!items.length) {
    items.push({
      itemNumber: 1,
      quantity: 1,
      content1: 'Ware',
      ...(c.weightKg
        ? {
            weights: {
              effectiveWeightInKilogram: c.weightKg,
              carrierWeightInKilogram: c.weightKg,
            },
          }
        : {}),
      mark,
      packaging: 'KRT',
      articleQuantity: 1,
      dangerousGoods: { areDangerToEnvironment: false, limitedAmount: false },
      hazardousMaterial: 0,
      waterHazardClass: 0,
    });
  }

  return items;
}

function packageCount(c: Bord512Consignment): number {
  const fromPos = c.positions.reduce((s, p) => s + (Number(p.quantity) || 0), 0);
  if (fromPos > 0) return fromPos;
  const barcodes = c.positions.reduce((s, p) => s + p.barcodes.length, 0);
  return Math.max(1, barcodes);
}

function buildConsignmentJson(
  c: Bord512Consignment,
  itemNumber: number,
  bordero: Bord512Bordero,
) {
  const contacts = contactsFromFreeTexts(c.freeTexts);
  const consignmentItems = buildConsignmentItems(c);
  const loadingDate = formatDateTime(bordero.borderoDate);
  const qty = packageCount(c);
  const weight =
    c.weightKg ||
    consignmentItems.reduce(
      (s, it) => s + (it.weights?.effectiveWeightInKilogram || 0),
      0,
    );

  const receiverInfoParts = [
    contacts.receiver.name,
    contacts.receiver.phone ? `Tel: ${contacts.receiver.phone}` : '',
    contacts.receiver.email,
    ...contacts.rawNotes.filter((n) => /von\s+\d/i.test(n)),
  ].filter(Boolean);

  return {
    itemNumber,
    externalNumber: c.consignmentNumber || `${bordero.borderoNumber}-${itemNumber}`,
    sender: partyFromAddress(c.shipper),
    senderContactPerson: contacts.sender.name
      ? {
          lastName: contacts.sender.name,
          ...(contacts.sender.phone ? { telephone: contacts.sender.phone } : {}),
          ...(contacts.sender.email ? { emailAddress: contacts.sender.email } : {}),
        }
      : {},
    receiver: partyFromAddress(c.consignee),
    receiverContactPerson: contacts.receiver.name
      ? {
          lastName: contacts.receiver.name,
          ...(contacts.receiver.phone ? { telephone: contacts.receiver.phone } : {}),
          ...(contacts.receiver.email ? { emailAddress: contacts.receiver.email } : {}),
        }
      : {},
    differentLoadingPoint: {},
    differentDeliveryPoint: {},
    consignmentItems,
    times: {
      loadingDateStart: loadingDate,
      loadingDateEnd: loadingDate,
      deliveryDateStart: loadingDate,
      deliveryDateEnd: loadingDate,
    },
    flatRateCustomer: {},
    flatRateReceiver: {},
    incoterms: 0,
    deliveryTerms: 0,
    pickup: false,
    consignmentRestriction: {},
    loadingDateType: 0,
    deliveryDateType: 0,
    paymentType: 0,
    paymentStatus: 0,
    namedLocation: {},
    quantity: qty,
    ...(weight
      ? {
          weights: {
            effectiveWeightInKilogram: weight,
            carrierWeightInKilogram: weight,
          },
        }
      : {}),
    dimensions: {
      meter: c.loadingMeters ?? 0,
      cubicMeter: c.cubicMeter ?? 0,
    },
    flatRateCarrier: {},
    maximumSize: {},
    containsDangerousGoods: false,
    customFields: {
      consignmentReference2: addressCompany(c.consignee) || undefined,
      customBool10: true,
    },
    isHeavyDutyTransport: false,
    information: {
      ...(contacts.sender.name || contacts.sender.phone
        ? {
            senderInfo1: [contacts.sender.name, contacts.sender.phone]
              .filter(Boolean)
              .join(' | '),
          }
        : {}),
      senderInfo2: [
        addressCompany(c.consignee),
        c.consignee?.country,
        c.consignee?.zip,
        c.consignee?.city,
      ]
        .filter(Boolean)
        .join('-'),
      ...(receiverInfoParts.length
        ? { receiverInfo1: receiverInfoParts.join(' | ') }
        : {}),
      info14: `FORTRAS BORD512 ${bordero.borderoNumber}`,
    },
    airAndSea: {
      isShipperSecure: false,
      transportWay: 0,
      freightType: 0,
      regulatedEntityCategory: 0,
    },
    additionalTimes: {},
    loadType: 0,
  };
}

function freightPayerCustomer(payer?: SoloplanFreightPayer | null) {
  if (!payer) return undefined;
  const numberRaw = payer.number;
  const number =
    numberRaw === null || numberRaw === undefined || numberRaw === ''
      ? undefined
      : Number.isFinite(Number(numberRaw))
        ? Number(numberRaw)
        : undefined;
  return {
    ...(number !== undefined ? { number } : {}),
    ...(payer.matchcode ? { matchcode: payer.matchcode } : {}),
    name1: payer.name || 'Kunde',
    ...(payer.phone ? { phoneNumberHeadOffice: payer.phone } : {}),
    ...(payer.vatId
      ? {
          valueAddedTaxNumber: payer.vatId,
          vATIsoTwoCharacterCountryCode: countryIso(
            String(payer.vatId).toUpperCase().startsWith('CHE') ||
              String(payer.vatId).toUpperCase().startsWith('CH')
              ? 'CH'
              : undefined,
          ),
        }
      : {}),
    senderReceiver: true,
    freightBusinessPartner: true,
  };
}

/**
 * Wandelt ein geparstes Bordero in Soloplan OrderImportPORTAL-v6 JSON um.
 * Standard: eine Order mit allen Sendungen des Borderos.
 */
export function bord512ToSoloplanOrder(
  bordero: Bord512Bordero,
  opts: Bord512TransformOptions = {},
): Record<string, unknown> {
  const consignments = bordero.consignments.map((c, idx) =>
    buildConsignmentJson(c, idx + 1, bordero),
  );
  const orderDate = formatDate(bordero.borderoDate);
  const customer = freightPayerCustomer(opts.freightPayer);

  return {
    header: {
      sendDate: formatDateTime(new Date().toISOString().slice(0, 10)),
      exportItemReference: randomUUID(),
    },
    order: [
      {
        date: orderDate,
        objectOwner: { id: opts.objectOwnerId ?? 2 },
        externalNumber: bordero.borderoNumber,
        orderContext: 0,
        orderDate,
        ...(customer ? { customer } : {}),
        consignments,
      },
    ],
  };
}

export function transformBord512ToSoloplan(
  content: string | Buffer,
  opts: Bord512TransformOptions = {},
): {
  bordero: Bord512Bordero;
  soloplan: Record<string, unknown>;
  fileName: string;
} {
  const bordero = parseBord512(content, opts.sourceFileName);
  const soloplan = bord512ToSoloplanOrder(bordero, opts);
  const safe = bordero.borderoNumber.replace(/[^a-zA-Z0-9._-]+/g, '_');
  const fileName = `order-${safe}.json`;
  return { bordero, soloplan, fileName };
}
