/**
 * Mapper: Portal-Sendung → Soloplan OrderImportPORTAL v6 File-API JSON
 * Format laut SoloplanOrderImportPORTAL-v6 (header + consignment | order).
 */
import { randomUUID } from 'crypto';

export type SoloplanFileFormat = 'consignment' | 'order';

type AddressLike = {
  company?: string | null;
  street?: string | null;
  zip?: string | null;
  city?: string | null;
  country?: string | null;
};

type BusinessPartnerLike = {
  number?: string | number | null;
  matchcode?: string | null;
  name?: string | null;
  phone?: string | null;
  vatId?: string | null;
  contacts?: Array<{
    itemNumber?: number | null;
    firstName?: string | null;
    lastName?: string | null;
    name?: string | null;
    email?: string | null;
    phone?: string | null;
  }>;
};

type CustomerLike = {
  customerNumber: string;
  name: string;
  phone?: string | null;
  vatId?: string | null;
  soloplanBusinessPartnerId?: string | null;
  matchcode?: string | null;
  contacts?: Array<{
    soloplanContactNumber?: number | null;
    firstName?: string | null;
    lastName?: string | null;
    name?: string | null;
    email?: string | null;
    phone?: string | null;
  }>;
};

export type PortalShipmentForSoloplan = {
  id: string;
  trackingNumber: string;
  reference?: string | null;
  goodsDescription?: string | null;
  packageCount: number;
  weightKg?: number | null;
  volumeM3?: number | null;
  pickupCompany?: string | null;
  pickupStreet?: string | null;
  pickupZip?: string | null;
  pickupCity?: string | null;
  pickupCountry?: string | null;
  pickupDate?: Date | string | null;
  deliveryCompany?: string | null;
  deliveryStreet?: string | null;
  deliveryZip?: string | null;
  deliveryCity?: string | null;
  deliveryCountry?: string | null;
  deliveryDate?: Date | string | null;
  deliveryDateEnd?: Date | string | null;
  notes?: string | null;
  deliveryAvisPhone?: string | null;
  extras?: unknown;
  /**
   * Smart-Border- / Verzollungsfelder (FileAPI OrderImportPORTAL v6).
   * Keys in Soloplan: kennzeichen, kennzeichenAnhänger, grenzübergang, zeitpunktanderGrenze.
   */
  kennzeichen?: string | null;
  kennzeichenAnhaenger?: string | null;
  grenzuebergang?: string | null;
  grenzzollstelle?: string | null;
  zeitpunktGrenze?: Date | string | null;
  /** Explizit Verzollungsauftrag (sonst aus extras.verzollung). */
  verzollungsauftrag?: boolean | null;
  customer: CustomerLike;
  /** Portal-Auftrag inkl. Frachtzahler (order.customer in Soloplan) */
  order?: {
    externalNumber: string;
    freightPayer?: CustomerLike | null;
  } | null;
  positions: Array<{
    description: string;
    quantity: number;
    packaging?: string | null;
    weightKg?: number | null;
    lengthCm?: number | null;
    widthCm?: number | null;
    heightCm?: number | null;
    sscc?: string | null;
  }>;
  colli?: Array<{
    itemNumber: number;
    sscc: string;
    content?: string | null;
    packaging?: string | null;
    quantity: number;
    weightKg?: number | null;
    lengthCm?: number | null;
    widthCm?: number | null;
    heightCm?: number | null;
  }>;
  /** Dokumente für Soloplan documentData (content bereits Base64). */
  documents?: Array<{
    fileName: string;
    /** Soloplan DocumentCategory Matchcode, z. B. ABL */
    category: string;
    contentBase64: string;
  }>;
};

/** Portal DocumentType → Soloplan DocumentCategory Matchcode */
export function soloplanDocumentCategory(type: string): string {
  const map: Record<string, string> = {
    ABLIEFERBELEG: 'ABL',
    POD: 'UNTER',
    LOADING_LIST: 'AUFTRAG',
    CMR: 'TDOK',
    CUSTOMS_PAPER: 'CHBEL',
    INVOICE: 'RG',
    LABEL: 'INFO',
    CUSTOMER_UPLOAD: 'INFO',
  };
  return map[type] || 'INFO';
}

export function toSoloplanDocumentData(
  documents?: PortalShipmentForSoloplan['documents'],
): Array<{ name: string; category: string; content: string }> {
  return (documents || [])
    .filter((d) => d?.fileName && d?.contentBase64)
    .map((d) => ({
      name: d.fileName,
      category: d.category || 'INFO',
      content: d.contentBase64,
    }));
}

function customerToBp(customer: CustomerLike): BusinessPartnerLike {
  // Soloplan BP-Nummer: bevorzugt soloplanBusinessPartnerId, sonst numerische customerNumber
  const bpNumber =
    customer.soloplanBusinessPartnerId ||
    (/^\d+$/.test(String(customer.customerNumber || '')) ? customer.customerNumber : undefined);
  return {
    number: bpNumber,
    matchcode: customer.matchcode || undefined,
    name: customer.name,
    phone: customer.phone,
    vatId: customer.vatId,
    contacts: (customer.contacts || []).map((c) => ({
      itemNumber: c.soloplanContactNumber,
      firstName: c.firstName,
      lastName: c.lastName,
      name: c.name,
      email: c.email,
      phone: c.phone,
    })),
  };
}

function formatSoloplanDateTime(value?: Date | string | null): string | undefined {
  if (!value) return undefined;
  const d = typeof value === 'string' ? new Date(value) : value;
  if (Number.isNaN(d.getTime())) return undefined;
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

function formatSoloplanDate(value?: Date | string | null): string | undefined {
  const dt = formatSoloplanDateTime(value);
  return dt ? dt.slice(0, 10) : undefined;
}

/** Trennt Straßenname und Hausnummer (z. B. "Chipf 5" → street/houseNumber). */
export function splitStreet(street?: string | null): { street: string; houseNumber?: string } {
  const raw = String(street || '').trim();
  if (!raw) return { street: '' };
  const m = raw.match(/^(.*?)[,\s]+(\d+[a-zA-Z\-\/]*)$/);
  if (m && m[1].trim()) return { street: m[1].trim(), houseNumber: m[2] };
  return { street: raw };
}

function countryCode(country?: string | null): string {
  const c = String(country || 'AT').trim().toUpperCase();
  if (c === 'A') return 'AT';
  if (c === 'D') return 'DE';
  return c.slice(0, 2) || 'AT';
}

function toMasterDataBp(bp: BusinessPartnerLike) {
  const numberRaw = bp.number;
  const number =
    numberRaw === null || numberRaw === undefined || numberRaw === ''
      ? undefined
      : Number.isFinite(Number(numberRaw))
        ? Number(numberRaw)
        : undefined;

  const contactPersons = (bp.contacts || [])
    .map((c, idx) => {
      const lastName = c.lastName || c.name || '';
      if (!lastName && !c.email) return null;
      return {
        itemNumber: c.itemNumber || idx + 1,
        ...(c.firstName ? { firstName: c.firstName } : {}),
        lastName: lastName || 'Kontakt',
        ...(c.email ? { emailAddress: c.email } : {}),
        ...(c.phone ? { telephone: c.phone } : {}),
      };
    })
    .filter(Boolean);

  return {
    ...(number !== undefined ? { number } : {}),
    ...(bp.matchcode ? { matchcode: bp.matchcode } : {}),
    name1: bp.name || '',
    ...(bp.phone ? { phoneNumberHeadOffice: bp.phone } : {}),
    ...(contactPersons.length ? { contactPersons } : {}),
    ...(bp.vatId
      ? {
          valueAddedTaxNumber: bp.vatId,
          vATIsoTwoCharacterCountryCode: countryCode(
            bp.vatId?.startsWith('E') ? 'CH' : undefined,
          ),
        }
      : {}),
    senderReceiver: true,
  };
}

function toAddressParty(addr: AddressLike, bp?: BusinessPartnerLike | null) {
  const { street, houseNumber } = splitStreet(addr.street);
  const party: Record<string, unknown> = {
    name1: addr.company || '',
    street: street || addr.street || '',
    ...(houseNumber ? { houseNumber } : {}),
    country: countryCode(addr.country),
    zipCode: addr.zip || '',
    city1: addr.city || '',
  };
  if (bp && (bp.number || bp.matchcode || bp.name)) {
    party.masterDataBusinessPartner = toMasterDataBp({
      ...bp,
      name: bp.name || addr.company || '',
    });
  }
  return party;
}

function buildConsignmentItems(shipment: PortalShipmentForSoloplan) {
  const mark = shipment.reference || shipment.trackingNumber;

  // Prefer Portal-Colli (SSCC) wenn vorhanden
  if (shipment.colli?.length) {
    return shipment.colli.map((c) => {
      const lengthInMeters = c.lengthCm != null ? c.lengthCm / 100 : undefined;
      const widthInMeters = c.widthCm != null ? c.widthCm / 100 : undefined;
      const heightInMeters = c.heightCm != null ? c.heightCm / 100 : undefined;
      const cubicMeter =
        lengthInMeters != null && widthInMeters != null && heightInMeters != null
          ? Number((lengthInMeters * widthInMeters * heightInMeters).toFixed(5))
          : undefined;
      return {
        itemNumber: c.itemNumber,
        quantity: Number(c.quantity || 1),
        content1: c.content || shipment.goodsDescription || 'Ware',
        ...(c.weightKg != null
          ? {
              weights: {
                effectiveWeightInKilogram: c.weightKg,
                carrierWeightInKilogram: c.weightKg,
              },
            }
          : {}),
        ...(lengthInMeters != null || widthInMeters != null || heightInMeters != null
          ? {
              size: {
                ...(lengthInMeters != null ? { lengthInMeters } : {}),
                ...(widthInMeters != null ? { widthInMeters } : {}),
                ...(heightInMeters != null ? { heightInMeters } : {}),
              },
            }
          : {}),
        mark,
        packaging: c.packaging || 'KRT',
        articleQuantity: Number(c.quantity || 1),
        ssccCurrents: [{ code: c.sscc }],
        ...(cubicMeter != null ? { dimensions: { cubicMeter } } : {}),
        dangerousGoods: { areDangerToEnvironment: false, limitedAmount: false },
        hazardousMaterial: 0,
        waterHazardClass: 0,
      };
    });
  }

  if (shipment.positions?.length) {
    return shipment.positions.map((pos, idx) => {
      const lengthInMeters = pos.lengthCm != null ? pos.lengthCm / 100 : undefined;
      const widthInMeters = pos.widthCm != null ? pos.widthCm / 100 : undefined;
      const heightInMeters = pos.heightCm != null ? pos.heightCm / 100 : undefined;
      const cubicMeter =
        lengthInMeters != null && widthInMeters != null && heightInMeters != null
          ? Number((lengthInMeters * widthInMeters * heightInMeters).toFixed(5))
          : undefined;
      return {
        itemNumber: idx + 1,
        quantity: Number(pos.quantity || 1),
        content1: pos.description || shipment.goodsDescription || 'Ware',
        ...(pos.weightKg != null
          ? {
              weights: {
                effectiveWeightInKilogram: pos.weightKg,
                carrierWeightInKilogram: pos.weightKg,
              },
            }
          : {}),
        ...(lengthInMeters != null || widthInMeters != null || heightInMeters != null
          ? {
              size: {
                ...(lengthInMeters != null ? { lengthInMeters } : {}),
                ...(widthInMeters != null ? { widthInMeters } : {}),
                ...(heightInMeters != null ? { heightInMeters } : {}),
              },
            }
          : {}),
        mark,
        packaging: pos.packaging || 'KRT',
        articleQuantity: Number(pos.quantity || 1),
        ...(pos.sscc ? { ssccCurrents: [{ code: pos.sscc }] } : {}),
        ...(cubicMeter != null ? { dimensions: { cubicMeter } } : {}),
        dangerousGoods: { areDangerToEnvironment: false, limitedAmount: false },
        hazardousMaterial: 0,
        waterHazardClass: 0,
      };
    });
  }

  return [
    {
      itemNumber: 1,
      quantity: Number(shipment.packageCount || 1),
      content1: shipment.goodsDescription || 'Ware',
      ...(shipment.weightKg != null
        ? {
            weights: {
              effectiveWeightInKilogram: shipment.weightKg,
              carrierWeightInKilogram: shipment.weightKg,
            },
          }
        : {}),
      mark,
      packaging: 'KRT',
      articleQuantity: Number(shipment.packageCount || 1),
      ...(shipment.volumeM3 != null ? { dimensions: { cubicMeter: shipment.volumeM3 } } : {}),
      dangerousGoods: { areDangerToEnvironment: false, limitedAmount: false },
      hazardousMaterial: 0,
      waterHazardClass: 0,
    },
  ];
}

function buildConsignment(
  shipment: PortalShipmentForSoloplan,
  opts: {
    defaultSender?: (BusinessPartnerLike & AddressLike) | null;
    trackingUrl?: string;
  } = {},
) {
  const customerBp: BusinessPartnerLike | null = shipment.customer.soloplanBusinessPartnerId
    ? {
        number: shipment.customer.soloplanBusinessPartnerId,
        matchcode: shipment.customer.matchcode,
        name: shipment.customer.name,
        phone: shipment.customer.phone,
        vatId: shipment.customer.vatId,
        contacts: (shipment.customer.contacts || []).map((c) => ({
          itemNumber: c.soloplanContactNumber,
          firstName: c.firstName,
          lastName: c.lastName,
          name: c.name,
          email: c.email,
          phone: c.phone,
        })),
      }
    : null;

  const senderBp = opts.defaultSender || customerBp;
  const pickup: AddressLike = {
    company: shipment.pickupCompany,
    street: shipment.pickupStreet,
    zip: shipment.pickupZip,
    city: shipment.pickupCity,
    country: shipment.pickupCountry,
  };
  const delivery: AddressLike = {
    company: shipment.deliveryCompany,
    street: shipment.deliveryStreet,
    zip: shipment.deliveryZip,
    city: shipment.deliveryCity,
    country: shipment.deliveryCountry,
  };

  // Wenn Default-Sender gesetzt und Pickup vorhanden → Pickup als differentLoadingPoint
  const useDifferentLoading =
    Boolean(opts.defaultSender) && Boolean(pickup.company || pickup.street || pickup.city);

  const senderAddress: AddressLike = opts.defaultSender
    ? {
        company: opts.defaultSender.name || opts.defaultSender.company || 'WOG Logistics AG',
        street: opts.defaultSender.street || 'Wildenaustraße 22',
        zip: opts.defaultSender.zip || '9444',
        city: opts.defaultSender.city || 'Diepoldsau',
        country: opts.defaultSender.country || 'CH',
      }
    : pickup.company || pickup.street
      ? pickup
      : {
          company: shipment.customer.name,
          street: shipment.pickupStreet,
          zip: shipment.pickupZip,
          city: shipment.pickupCity,
          country: shipment.pickupCountry,
        };

  const loadingDate = formatSoloplanDateTime(shipment.pickupDate) || formatSoloplanDateTime(new Date());
  const deliveryDateStart =
    formatSoloplanDateTime(shipment.deliveryDate) ||
    formatSoloplanDateTime(shipment.pickupDate) ||
    loadingDate;
  const deliveryDateEnd =
    formatSoloplanDateTime(shipment.deliveryDateEnd) || deliveryDateStart;

  const consignmentItems = buildConsignmentItems(shipment);
  const totalWeight =
    shipment.weightKg ??
    consignmentItems.reduce(
      (sum, item: any) => sum + (item.weights?.effectiveWeightInKilogram || 0),
      0,
    );

  return {
    itemNumber: 1,
    externalNumber: shipment.reference || shipment.trackingNumber,
    sender: toAddressParty(senderAddress, senderBp),
    senderContactPerson: {},
    receiver: toAddressParty(delivery),
    receiverContactPerson: {},
    ...(useDifferentLoading
      ? { differentLoadingPoint: toAddressParty(pickup) }
      : { differentLoadingPoint: {} }),
    differentDeliveryPoint: {},
    consignmentItems,
    times: {
      loadingDateStart: loadingDate,
      loadingDateEnd: loadingDate,
      deliveryDateStart,
      deliveryDateEnd,
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
    quantity: Number(shipment.packageCount || 1),
    ...(totalWeight
      ? {
          weights: {
            effectiveWeightInKilogram: totalWeight,
            carrierWeightInKilogram: totalWeight,
          },
        }
      : {}),
    ...(shipment.volumeM3 != null
      ? { dimensions: { cubicMeter: shipment.volumeM3 } }
      : { dimensions: { meter: 0, cubicMeter: 0 } }),
    flatRateCarrier: {},
    maximumSize: {},
    containsDangerousGoods: Boolean(
      shipment.extras &&
        typeof shipment.extras === 'object' &&
        !Array.isArray(shipment.extras) &&
        (shipment.extras as Record<string, unknown>).gefahrgut,
    ),
    customFields: {
      consignmentReference2: shipment.deliveryCompany || undefined,
      customBool10: true,
    },
    isHeavyDutyTransport: false,
    information: (() => {
      const extras =
        shipment.extras && typeof shipment.extras === 'object' && !Array.isArray(shipment.extras)
          ? (shipment.extras as Record<string, unknown>)
          : {};
      const pickupNote = String(extras.pickupNote || '').trim();
      const deliveryNote = String(extras.deliveryNote || '').trim();
      const senderInfo1 = pickupNote || (shipment.notes ? String(shipment.notes) : '');
      const receiverParts = [
        shipment.deliveryAvisPhone ? `Avis-Tel: ${shipment.deliveryAvisPhone}` : '',
        deliveryNote,
      ].filter(Boolean);
      return {
        ...(senderInfo1 ? { senderInfo1 } : {}),
        senderInfo2: [
          shipment.deliveryCompany,
          shipment.deliveryCountry,
          shipment.deliveryZip,
          shipment.deliveryCity,
        ]
          .filter(Boolean)
          .join('-'),
        ...(receiverParts.length ? { receiverInfo1: receiverParts.join(' | ') } : {}),
        ...(opts.trackingUrl ? { info14: opts.trackingUrl } : {}),
      };
    })(),
    airAndSea: {
      isShipperSecure: false,
      transportWay: 0,
      freightType: 0,
      regulatedEntityCategory: 0,
    },
    additionalTimes: {},
    loadType: 0,
    documentData: toSoloplanDocumentData(shipment.documents),
  };
}

function soloplanHeader() {
  return {
    sendDate: formatSoloplanDateTime(new Date())!,
    exportItemReference: randomUUID(),
  };
}

function consignmentExternalNumber(shipment: PortalShipmentForSoloplan): string {
  return shipment.reference || shipment.trackingNumber;
}

function orderExternalNumber(shipment: PortalShipmentForSoloplan): string {
  return shipment.order?.externalNumber || shipment.reference || shipment.trackingNumber;
}

function extrasRecord(extras: unknown): Record<string, unknown> {
  if (extras && typeof extras === 'object' && !Array.isArray(extras)) {
    return extras as Record<string, unknown>;
  }
  return {};
}

/** Verzollungsauftrag: explizites Flag oder extras.verzollung. */
export function isVerzollungsauftrag(shipment: PortalShipmentForSoloplan): boolean {
  if (shipment.verzollungsauftrag === true) return true;
  return extrasRecord(shipment.extras).verzollung === true;
}

/** Kennzeichen / Grenze / Zeitpunkt aus Sendung oder extras lesen. */
export function resolveCustomsFileApiFields(shipment: PortalShipmentForSoloplan) {
  const extras = extrasRecord(shipment.extras);
  const kennzeichen =
    String(shipment.kennzeichen || extras.kennzeichen || '')
      .trim() || undefined;
  const kennzeichenAnhaenger =
    String(shipment.kennzeichenAnhaenger || extras.kennzeichenAnhaenger || '')
      .trim() || undefined;
  const grenzuebergang =
    String(shipment.grenzuebergang || extras.grenzuebergang || '')
      .trim() || undefined;
  const grenzzollstelle =
    String(shipment.grenzzollstelle || extras.grenzzollstelle || '')
      .trim() || undefined;
  const zeitRaw =
    shipment.zeitpunktGrenze ||
    extras.zeitpunktanderGrenze ||
    extras.zeitpunktGrenze ||
    extras.zeitGrenze ||
    null;
  const zeitpunktanderGrenze = formatSoloplanDateTime(
    zeitRaw as Date | string | null | undefined,
  );
  return {
    kennzeichen,
    kennzeichenAnhaenger,
    grenzuebergang,
    grenzzollstelle,
    zeitpunktanderGrenze,
  };
}

/** Consignment-Zusatzfelder laut SoloplanOrderImportPORTAL FileAPI (exakte Schreibweise). */
function applyCustomsConsignmentFields(
  consignment: Record<string, unknown>,
  shipment: PortalShipmentForSoloplan,
) {
  const fields = resolveCustomsFileApiFields(shipment);
  if (fields.kennzeichen) consignment.kennzeichen = fields.kennzeichen;
  // FileAPI-Feldname mit Umlaut
  if (fields.kennzeichenAnhaenger) consignment['kennzeichenAnhänger'] = fields.kennzeichenAnhaenger;
  if (fields.grenzuebergang) consignment['grenzübergang'] = fields.grenzuebergang;
  if (fields.grenzzollstelle) {
    const info = (consignment.information as Record<string, unknown>) || {};
    info.senderInfo3 = `Grenzzollstelle: ${fields.grenzzollstelle}`;
    consignment.information = info;
  }
  if (fields.zeitpunktanderGrenze) {
    consignment.zeitpunktanderGrenze = fields.zeitpunktanderGrenze;
  }
  return consignment;
}

/**
 * Update-Export: keine Sendungsinfos erneut senden.
 * Nur externe Auftrags-/Sendungsnummer (+ documentData zum Ablegen in Soloplan).
 */
export function buildSoloplanUpdatePayload(
  shipment: PortalShipmentForSoloplan,
  opts: {
    format?: SoloplanFileFormat;
    objectOwnerId?: number;
    orderShipments?: PortalShipmentForSoloplan[];
  } = {},
) {
  const format: SoloplanFileFormat = opts.format || 'order';
  const header = soloplanHeader();
  const siblings =
    opts.orderShipments && opts.orderShipments.length > 0 ? opts.orderShipments : [shipment];

  const consignments = siblings.map((s, idx) => {
    const documentData = toSoloplanDocumentData(s.documents);
    return {
      itemNumber: idx + 1,
      actionAttribute: 'update',
      externalNumber: consignmentExternalNumber(s),
      ...(documentData.length ? { documentData } : {}),
    };
  });

  if (format === 'order') {
    const orderDocuments = toSoloplanDocumentData(
      siblings
        .flatMap((s) => s.documents || [])
        .filter((d) => d.category === 'ABL' || d.category === 'AUFABL' || d.category === 'RG'),
    );
    return {
      header,
      order: [
        {
          actionAttribute: 'update',
          externalNumber: orderExternalNumber(shipment),
          ...(opts.objectOwnerId ? { objectOwner: { id: opts.objectOwnerId } } : {}),
          consignments,
          ...(orderDocuments.length ? { documentData: orderDocuments } : {}),
        },
      ],
    };
  }

  return {
    header,
    consignment: consignments,
  };
}

export function buildSoloplanFilePayload(
  shipment: PortalShipmentForSoloplan,
  opts: {
    format?: SoloplanFileFormat;
    defaultSender?: (BusinessPartnerLike & AddressLike) | null;
    trackingBaseUrl?: string;
    objectOwnerId?: number;
    /** Alle Sendungen desselben Auftrags (1:n) → kumulierte consignments */
    orderShipments?: PortalShipmentForSoloplan[];
    /** true = nur externe Nummern, keine Sendungsinfos */
    update?: boolean;
  } = {},
) {
  if (opts.update) {
    return buildSoloplanUpdatePayload(shipment, opts);
  }

  // Soloplan braucht mindestens einen Auftrag mit Sendung – Default: order
  const format: SoloplanFileFormat = opts.format || 'order';
  const header = soloplanHeader();

  const siblings =
    opts.orderShipments && opts.orderShipments.length > 0 ? opts.orderShipments : [shipment];

  const anyVerzollung = siblings.some((s) => isVerzollungsauftrag(s));

  const consignments = siblings.map((s, idx) => {
    const trackingUrl = opts.trackingBaseUrl
      ? `${opts.trackingBaseUrl.replace(/\/$/, '')}/track?tn=${encodeURIComponent(s.trackingNumber)}`
      : undefined;
    const consignment = buildConsignment(s, {
      defaultSender: opts.defaultSender,
      trackingUrl,
    });
    return applyCustomsConsignmentFields(
      { ...consignment, itemNumber: idx + 1 },
      s,
    );
  });

  if (format === 'order') {
    const freightPayer = shipment.order?.freightPayer || shipment.customer;
    const externalNumber = orderExternalNumber(shipment);
    // Auftragsweite Dokumente (z. B. Ablieferbeleg) zusätzlich auf Order-Ebene
    const orderDocuments = toSoloplanDocumentData(
      siblings.flatMap((s) => s.documents || []).filter((d) => d.category === 'ABL' || d.category === 'AUFABL'),
    );
    return {
      header,
      order: [
        {
          date: formatSoloplanDate(shipment.pickupDate) || formatSoloplanDate(new Date()),
          ...(opts.objectOwnerId ? { objectOwner: { id: opts.objectOwnerId } } : {}),
          externalNumber,
          orderContext: 0,
          orderDate: formatSoloplanDate(new Date()),
          // Immer: Auftrag kommt aus dem VLB-Portal
          erstelltviaVLBPortal: true,
          // FileAPI: verzollungsauftrag = true wenn Verzollung
          verzollungsauftrag: anyVerzollung,
          // Frachtzahler = eingeloggter Kunde / order.freightPayer
          customer: toMasterDataBp(customerToBp(freightPayer)),
          consignments,
          documentData: orderDocuments,
        },
      ],
    };
  }

  return {
    header,
    consignment: consignments,
  };
}

/** Basisnummer ohne Präfix/Suffix, z. B. VLB210700003 */
export function soloplanOrderBaseName(
  shipment: PortalShipmentForSoloplan,
  format: SoloplanFileFormat = 'order',
): string {
  return (
    (format === 'order' ? shipment.order?.externalNumber : null) ||
    shipment.reference ||
    shipment.trackingNumber ||
    shipment.id
  ).replace(/[^\w.\-]+/g, '_');
}

/**
 * Outbound-Dateiname.
 * Erstexport: order-VLB210700003.json
 * Update:     order-VLB210700003-update-20260721T193024.json
 */
export function soloplanOutboundFileName(
  shipment: PortalShipmentForSoloplan,
  format: SoloplanFileFormat,
  opts?: { update?: boolean; at?: Date },
) {
  const base = soloplanOrderBaseName(shipment, format);
  if (!opts?.update) {
    return format === 'order' ? `order-${base}.json` : `${base}.json`;
  }
  const d = opts.at || new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  const stamp = `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}T${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
  return format === 'order'
    ? `order-${base}-update-${stamp}.json`
    : `${base}-update-${stamp}.json`;
}
