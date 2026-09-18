import { CustomerDocCategory, DocumentType } from '@prisma/client';

export const CUSTOMER_DOC_CATEGORY_LABELS: Record<CustomerDocCategory, string> = {
  [CustomerDocCategory.INVOICE]: 'Rechnung',
  [CustomerDocCategory.CUSTOMS_EXIT]: 'Austrittsbestätigung Verzollung',
  [CustomerDocCategory.POD]: 'Abliefernachweis / POD',
  [CustomerDocCategory.CMR]: 'CMR',
  [CustomerDocCategory.OTHER]: 'Sonstiges Dokument',
};

/** Aliase in Dateinamen (SFTP) → Kategorie */
const CATEGORY_ALIASES: Record<string, CustomerDocCategory> = {
  INVOICE: CustomerDocCategory.INVOICE,
  RECHNUNG: CustomerDocCategory.INVOICE,
  RG: CustomerDocCategory.INVOICE,
  INV: CustomerDocCategory.INVOICE,
  CUSTOMS_EXIT: CustomerDocCategory.CUSTOMS_EXIT,
  AUSTRITT: CustomerDocCategory.CUSTOMS_EXIT,
  AUSTRITTSBESTAETIGUNG: CustomerDocCategory.CUSTOMS_EXIT,
  AUSTRITTSBESTÄTIGUNG: CustomerDocCategory.CUSTOMS_EXIT,
  EXIT: CustomerDocCategory.CUSTOMS_EXIT,
  CHBEL: CustomerDocCategory.CUSTOMS_EXIT,
  ZOLL: CustomerDocCategory.CUSTOMS_EXIT,
  POD: CustomerDocCategory.POD,
  ABLIEFERBELEG: CustomerDocCategory.POD,
  ABLIEFERNACHWEIS: CustomerDocCategory.POD,
  CMR: CustomerDocCategory.CMR,
  OTHER: CustomerDocCategory.OTHER,
  SONSTIG: CustomerDocCategory.OTHER,
  SONSTIGES: CustomerDocCategory.OTHER,
};

export function parseCustomerDocCategory(raw: string | null | undefined): CustomerDocCategory | null {
  const key = String(raw || '')
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9ÄÖÜ]/gi, '_');
  if (!key) return null;
  if (CATEGORY_ALIASES[key]) return CATEGORY_ALIASES[key];
  // Teiltreffer
  if (key.includes('AUSTRITT') || key.includes('EXIT')) return CustomerDocCategory.CUSTOMS_EXIT;
  if (key.includes('RECHNUNG') || key === 'RG') return CustomerDocCategory.INVOICE;
  if (key.includes('ABLIEFER') || key === 'POD') return CustomerDocCategory.POD;
  if (key === 'CMR') return CustomerDocCategory.CMR;
  return null;
}

export function documentTypeForCategory(category: CustomerDocCategory): DocumentType {
  switch (category) {
    case CustomerDocCategory.INVOICE:
      return DocumentType.INVOICE;
    case CustomerDocCategory.CUSTOMS_EXIT:
      return DocumentType.CUSTOMS_PAPER;
    case CustomerDocCategory.POD:
      return DocumentType.POD;
    case CustomerDocCategory.CMR:
      return DocumentType.CMR;
    default:
      return DocumentType.OTHER;
  }
}

export function allCustomerDocCategories(): CustomerDocCategory[] {
  return Object.values(CustomerDocCategory);
}
