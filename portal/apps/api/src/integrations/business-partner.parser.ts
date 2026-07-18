/**
 * Parser für Soloplan PORTALGP.v1-BusinessPartner Exporte
 * und eingebettete OriginalBusinessPartner-Objekte aus Tour-JSON.
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
  const email = str(raw.EmailAddress, raw.email, raw.Email, raw.EMail).toLowerCase();
  const firstName = str(raw.FirstName, raw.firstName, raw.Vorname);
  const lastName = str(raw.LastName, raw.lastName, raw.Nachname, raw.Name);
  const name = str(
    [firstName, lastName].filter(Boolean).join(' '),
    raw.Name,
    raw.name,
    email,
  );
  if (!email && !name) return null;
  const numberRaw = raw.Number ?? raw.number ?? raw.ContactNumber;
  const number = numberRaw !== undefined && numberRaw !== null && `${numberRaw}` !== ''
    ? Number(numberRaw)
    : undefined;
  return {
    number: Number.isFinite(number as number) ? (number as number) : undefined,
    firstName: firstName || name.split(/\s+/)[0] || 'Portal',
    lastName: lastName || name.split(/\s+/).slice(1).join(' ') || 'User',
    name: name || email,
    email: email || undefined,
    phone: str(raw.Telephone, raw.Phone, raw.phone, raw.Mobile) || undefined,
    role: str(raw.Role, raw.role, raw.Address, raw.Salutation) || undefined,
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
    bp.ContactPersons,
    bp.Contacts,
    bp.Ansprechpartner,
    bp.contactPersons,
    bp.contacts,
  ];
  for (const list of lists) {
    if (!Array.isArray(list)) continue;
    for (const item of list) {
      const rec = asRecord(item);
      if (rec) push(pickContact(rec));
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

export function parseBusinessPartnerNode(
  node: unknown,
  forcedKind?: 'CUSTOMER' | 'PARTNER',
): ParsedBusinessPartner | null {
  const bp = asRecord(node);
  if (!bp) return null;

  // Sometimes wrapped
  const inner =
    asRecord(bp.BusinessPartner) ||
    asRecord(bp.OriginalBusinessPartner) ||
    asRecord(bp.businessPartner) ||
    bp;

  const businessPartnerId = str(
    inner.BusinessPartnerId,
    inner.businessPartnerId,
    inner.Id,
    inner.id,
  );
  const matchcode = str(inner.Matchcode, inner.matchcode, inner.Code, inner.code);
  const name = str(inner.Name1, inner.name1, inner.Name, inner.name, matchcode);
  if (!businessPartnerId && !matchcode) return null;
  if (!name) return null;

  const addr = asRecord(inner.MainAddress) || asRecord(inner.Address) || {};
  const country = asRecord(addr.Country) || {};

  return {
    businessPartnerId: businessPartnerId || matchcode,
    matchcode: matchcode || businessPartnerId,
    name,
    name2: str(inner.Name2, inner.name2) || undefined,
    email: str(inner.Email, inner.EmailAddress, inner.email).toLowerCase() || undefined,
    phone: str(inner.PhoneNumberHeadOffice, inner.Phone, inner.phone) || undefined,
    vatId: str(inner.VATNumber, inner.VatNumber, inner.vatId) || undefined,
    street: str(
      [str(addr.Street, addr.street), str(addr.HouseNumber, addr.houseNumber)].filter(Boolean).join(' '),
    ) || undefined,
    zip: str(addr.ZipCode, addr.zip, addr.Zip) || undefined,
    city: str(addr.Location1, addr.City, addr.city, addr.Location2) || undefined,
    country: str(
      country.IsoTwoCharacterCountryCode,
      country.CountryId,
      addr.CountryCode,
      addr.country,
    ) || undefined,
    kind: detectKind(inner, forcedKind),
    contacts: collectContacts(inner),
    raw: inner,
  };
}

/** Extrahiert BusinessPartner aus PORTALGP-Datei oder Array/Wrapper. */
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

  if (Array.isArray(data)) {
    data.forEach(push);
    return out;
  }

  const root = asRecord(data);
  if (!root) return out;

  // Direct BP
  if (root.BusinessPartnerId || root.Matchcode || root.businessPartnerId) {
    push(root);
  }

  const candidates = [
    root.BusinessPartners,
    root.businessPartners,
    root.Items,
    root.items,
    root.Data,
    root.data,
    root.Partners,
    root.Customers,
  ];
  for (const c of candidates) {
    if (Array.isArray(c)) c.forEach(push);
    else if (asRecord(c)) push(c);
  }

  // Nested single
  if (root.BusinessPartner) push(root.BusinessPartner);
  if (root.OriginalBusinessPartner) push(root.OriginalBusinessPartner);

  return out;
}
