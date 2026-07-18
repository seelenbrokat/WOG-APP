/**
 * Parser für Soloplan PORTALGP.v1-BusinessPartner Exporte,
 * eingebettete OriginalBusinessPartner-Objekte und Tour-JSON.
 */

export type ParsedContact = {
  number?: number;
  firstName: string;
  lastName: string;
  name: string;
  email?: string;
  phone?: string;
  role?: string;
  department?: string;
};

export type ParsedBusinessPartner = {
  businessPartnerId: string;
  matchcode: string;
  name: string;
  name2?: string;
  email?: string;
  phone?: string;
  vatId?: string;
  street?: string;
  zip?: string;
  city?: string;
  country?: string;
  kind: 'CUSTOMER' | 'PARTNER';
  contacts: ParsedContact[];
  raw: Record<string, unknown>;
};

function asRecord(v: unknown): Record<string, unknown> | null {
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
}

function str(...vals: unknown[]): string {
  for (const v of vals) {
    if (v === null || v === undefined) continue;
    const s = String(v).trim();
    if (s) return s;
  }
  return '';
}

function pickContact(raw: Record<string, unknown>): ParsedContact | null {
  // Soloplan PORTALGP nutzt camelCase (emailAddress), Tour-JSON oft PascalCase (EmailAddress).
  const email = str(
    raw.emailAddress,
    raw.EmailAddress,
    raw.email,
    raw.Email,
    raw.EMail,
    raw.eMail,
  ).toLowerCase();
  const firstName = str(raw.firstName, raw.FirstName, raw.Vorname);
  const lastName = str(raw.lastName, raw.LastName, raw.Nachname, raw.Name, raw.name);
  const name = str(
    [firstName, lastName].filter(Boolean).join(' '),
    raw.Name,
    raw.name,
    email,
  );
  if (!email && !name) return null;
  const numberRaw = raw.Number ?? raw.number ?? raw.ContactNumber;
  const number =
    numberRaw !== undefined && numberRaw !== null && `${numberRaw}` !== ''
      ? Number(numberRaw)
      : undefined;
  return {
    number: Number.isFinite(number as number) ? (number as number) : undefined,
    firstName: firstName || 'Portal',
    lastName: lastName || name.split(/\s+/).slice(1).join(' ') || (email ? email.split('@')[0] : 'User'),
    name: name || email,
    email: email || undefined,
    phone: str(raw.Telephone, raw.telephone, raw.Phone, raw.phone, raw.Mobile, raw.mobile) || undefined,
    role: str(raw.Role, raw.role, raw.position, raw.Position, raw.Address, raw.title, raw.Title, raw.Salutation) || undefined,
    department: str(raw.Department, raw.department) || undefined,
  };
}

function collectContacts(bp: Record<string, unknown>): ParsedContact[] {
  const out: ParsedContact[] = [];
  const seen = new Set<string>();

  const push = (c: ParsedContact | null) => {
    if (!c) return;
    const key = (c.email || c.name).toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    out.push(c);
  };

  push(pickContact(asRecord(bp.MainContactPerson) || {}));

  const lists = [
    bp.contactPersons,
    bp.ContactPersons,
    bp.Contacts,
    bp.contacts,
    bp.Ansprechpartner,
    bp.mainContactPerson,
    bp.MainContactPerson,
  ];
  for (const list of lists) {
    if (Array.isArray(list)) {
      for (const item of list) {
        const rec = asRecord(item);
        if (rec) push(pickContact(rec));
      }
    } else {
      const rec = asRecord(list);
      if (rec) push(pickContact(rec));
    }
  }

  // PORTALGP: Firmen-E-Mail als Kontakt, falls keine Ansprechpartner-Mails
  if (!out.some((c) => c.email)) {
    const companyEmail = str(
      bp.email,
      bp.Email,
      bp.emailForInvoiceDispatch,
      bp.EmailForInvoiceDispatch,
    ).toLowerCase();
    if (companyEmail) {
      push(
        pickContact({
          emailAddress: companyEmail,
          firstName: 'Portal',
          lastName: str(bp.name1, bp.Name1, bp.name, 'Kontakt'),
        }),
      );
    }
  }
  return out;
}

function detectKind(bp: Record<string, unknown>, forced?: 'CUSTOMER' | 'PARTNER'): 'CUSTOMER' | 'PARTNER' {
  if (forced) return forced;
  const role = str(bp.Kind, bp.Type, bp.Role, bp.PartnerType, bp.BusinessPartnerType).toUpperCase();
  if (/(PARTNER|CARRIER|SPEDITEUR|FORWARDER)/.test(role)) return 'PARTNER';
  if (/(CUSTOMER|KUNDE|CLIENT|SHIPPER)/.test(role)) return 'CUSTOMER';
  if (bp.IsPartner === true || bp.isPartner === true) return 'PARTNER';
  if (bp.IsCustomer === false && bp.IsCarrier === true) return 'PARTNER';
  return 'CUSTOMER';
}

/** Erkennt Soloplan-BusinessPartner-Objekte auch tief verschachtelt. */
export function looksLikeBusinessPartner(node: unknown): boolean {
  const bp = asRecord(node);
  if (!bp) return false;
  const id = str(
    bp.BusinessPartnerId,
    bp.businessPartnerId,
    bp.BusinessPartnerID,
    bp.Id,
    bp.id,
  );
  const matchcode = str(bp.Matchcode, bp.matchcode, bp.Code, bp.code);
  const name = str(bp.Name1, bp.name1, bp.Name, bp.name);
  // Tour-Root etc. haben Id/Name, aber keine BP-Felder
  const hasBpSignal =
    bp.BusinessPartnerId !== undefined ||
    bp.businessPartnerId !== undefined ||
    bp.BusinessPartnerID !== undefined ||
    bp.Matchcode !== undefined ||
    bp.matchcode !== undefined ||
    bp.MainAddress !== undefined ||
    bp.MainContactPerson !== undefined ||
    bp.mainContactPerson !== undefined ||
    bp.contactPersons !== undefined ||
    bp.ContactPersons !== undefined ||
    bp.VATNumber !== undefined ||
    bp.vatNumber !== undefined ||
    bp.PhoneNumberHeadOffice !== undefined ||
    bp.email !== undefined ||
    bp.emailForInvoiceDispatch !== undefined ||
    bp.name1 !== undefined ||
    bp.Name1 !== undefined;
  if (!hasBpSignal) return false;
  if (id && (matchcode || name)) return true;
  if (matchcode && name) return true;
  return false;
}

export function parseBusinessPartnerNode(
  node: unknown,
  forcedKind?: 'CUSTOMER' | 'PARTNER',
): ParsedBusinessPartner | null {
  const bp = asRecord(node);
  if (!bp) return null;

  // Einzelnen BP aus Wrapper holen (nicht businessPartner[] – das ist die PORTALGP-Liste)
  const inner =
    asRecord(bp.OriginalBusinessPartner) ||
    (Array.isArray(bp.businessPartner) || Array.isArray(bp.BusinessPartner)
      ? null
      : asRecord(bp.BusinessPartner) || asRecord(bp.businessPartner)) ||
    bp;

  if (!looksLikeBusinessPartner(inner) && !looksLikeBusinessPartner(bp)) {
    return null;
  }

  const source = looksLikeBusinessPartner(inner) ? inner : bp;

  const businessPartnerId = str(
    source.BusinessPartnerId,
    source.businessPartnerId,
    source.BusinessPartnerID,
    source.Id,
    source.id,
  );
  const matchcode = str(
    source.Matchcode,
    source.matchcode,
    source.externalNumber,
    source.ExternalNumber,
    source.Code,
    source.code,
  );
  const name = str(source.Name1, source.name1, source.Name, source.name, matchcode);
  if (!businessPartnerId && !matchcode) return null;
  if (!name) return null;

  // Adresse: Tour-JSON verschachtelt (MainAddress) oder PORTALGP flach am BP
  const addr = asRecord(source.MainAddress) || asRecord(source.Address) || source;
  const country = asRecord(addr.Country) || asRecord(source.VATCountry) || {};

  return {
    businessPartnerId: businessPartnerId || matchcode,
    matchcode: matchcode || businessPartnerId,
    name,
    name2: str(source.Name2, source.name2) || undefined,
    email:
      str(
        source.email,
        source.Email,
        source.emailAddress,
        source.EmailAddress,
        source.emailForInvoiceDispatch,
        source.EmailForInvoiceDispatch,
      ).toLowerCase() || undefined,
    phone: str(source.PhoneNumberHeadOffice, source.Phone, source.phone, source.telephone) || undefined,
    vatId: str(source.VATNumber, source.VatNumber, source.vatNumber, source.vatId) || undefined,
    street:
      str(
        [
          str(addr.Street, addr.street),
          str(addr.HouseNumber, addr.houseNumber),
        ]
          .filter(Boolean)
          .join(' '),
      ) || undefined,
    zip: str(addr.ZipCode, addr.zipCode, addr.zip, addr.Zip) || undefined,
    city: str(addr.Location1, addr.location1, addr.City, addr.city, addr.Location2) || undefined,
    country:
      str(
        addr.isoTwoCharacterCountryCode,
        addr.IsoTwoCharacterCountryCode,
        country.IsoTwoCharacterCountryCode,
        country.CountryId,
        addr.CountryCode,
        addr.country,
        source.isoTwoCharacterCountryCode,
      ) || undefined,
    kind: detectKind(source, forcedKind),
    contacts: collectContacts(source),
    raw: source,
  };
}

function unwrapJson(data: unknown): unknown {
  if (typeof data !== 'string') return data;
  const trimmed = data.replace(/^\uFEFF/, '').trim();
  if (!trimmed) return data;
  try {
    return JSON.parse(trimmed);
  } catch {
    return data;
  }
}

/** Kurze Diagnose für Fehlermeldungen. */
export function describeImportPayload(data: unknown): string {
  const root = unwrapJson(data);
  if (Array.isArray(root)) return `Array mit ${root.length} Einträgen`;
  const rec = asRecord(root);
  if (!rec) return `Typ ${typeof root}`;
  const keys = Object.keys(rec).slice(0, 12).join(', ');
  const action = str(rec.ActionAttribute, rec.actionAttribute);
  return action ? `ActionAttribute=${action}; Keys: ${keys}` : `Keys: ${keys}`;
}

/** Extrahiert BusinessPartner aus PORTALGP-, Tour- oder Array/Wrapper-JSON. */
export function extractBusinessPartners(
  data: unknown,
  forcedKind?: 'CUSTOMER' | 'PARTNER',
): ParsedBusinessPartner[] {
  const out: ParsedBusinessPartner[] = [];
  const seen = new Set<string>();

  const push = (node: unknown) => {
    const parsed = parseBusinessPartnerNode(node, forcedKind);
    if (!parsed) return;
    const key = `${parsed.businessPartnerId}:${parsed.matchcode}`;
    if (seen.has(key)) return;
    seen.add(key);
    out.push(parsed);
  };

  const walk = (node: unknown, depth = 0) => {
    if (node === null || node === undefined || depth > 30) return;
    node = unwrapJson(node);

    if (Array.isArray(node)) {
      for (const item of node) walk(item, depth + 1);
      return;
    }

    const rec = asRecord(node);
    if (!rec) return;

    // .NET / Newtonsoft $values
    if (Array.isArray(rec.$values)) {
      walk(rec.$values, depth + 1);
    }

    // Explizite BP-Container zuerst
    for (const key of [
      'OriginalBusinessPartner',
      'BusinessPartner',
      'businessPartner',
      'BusinessPartners',
      'businessPartners',
      'Items',
      'items',
      'Data',
      'data',
      'Partners',
      'Customers',
      'Content',
      'Payload',
      'Body',
      'Entity',
      'Value',
      'value',
    ]) {
      if (rec[key] !== undefined) walk(rec[key], depth + 1);
    }

    if (looksLikeBusinessPartner(rec)) {
      push(rec);
    }

    // Tiefe Suche in Touren (TransportOrders, TourStops, Organisation, …)
    for (const [key, value] of Object.entries(rec)) {
      if (
        key === 'OriginalBusinessPartner' ||
        key === 'BusinessPartner' ||
        key === 'businessPartner' ||
        key === '$values'
      ) {
        continue; // bereits oben
      }
      if (value && typeof value === 'object') {
        walk(value, depth + 1);
      }
    }
  };

  walk(data);
  return out;
}
