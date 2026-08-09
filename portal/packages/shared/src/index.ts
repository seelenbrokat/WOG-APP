export enum UserRole {
  ORG_ADMIN = 'ORG_ADMIN',
  MANDANT_DISPATCHER = 'MANDANT_DISPATCHER',
  CUSTOMER_USER = 'CUSTOMER_USER',
  PARTNER = 'PARTNER',
}

export enum ShipmentStatus {
  DRAFT = 'DRAFT',
  SUBMITTED = 'SUBMITTED',
  ACCEPTED = 'ACCEPTED',
  PICKED_UP = 'PICKED_UP',
  IN_TRANSIT = 'IN_TRANSIT',
  OUT_FOR_DELIVERY = 'OUT_FOR_DELIVERY',
  DELIVERED = 'DELIVERED',
  EXCEPTION = 'EXCEPTION',
  CANCELLED = 'CANCELLED',
}

export enum DocumentType {
  POD = 'POD',
  ABLIEFERBELEG = 'ABLIEFERBELEG',
  CMR = 'CMR',
  INVOICE = 'INVOICE',
  CUSTOMER_UPLOAD = 'CUSTOMER_UPLOAD',
  PARTNER_FILE = 'PARTNER_FILE',
  CUSTOMS_PAPER = 'CUSTOMS_PAPER',
  LABEL = 'LABEL',
  LOADING_LIST = 'LOADING_LIST',
  WAREHOUSE_PHOTO = 'WAREHOUSE_PHOTO',
  ENTLADEBERICHT = 'ENTLADEBERICHT',
  LADEMITTELSCHEIN = 'LADEMITTELSCHEIN',
  OTHER = 'OTHER',
}

/** Freischaltbare Kategorien im Kunden-Dokumente-Modul */
export enum CustomerDocCategory {
  INVOICE = 'INVOICE',
  CUSTOMS_EXIT = 'CUSTOMS_EXIT',
  POD = 'POD',
  CMR = 'CMR',
  OTHER = 'OTHER',
}

export const CUSTOMER_DOC_CATEGORY_LABELS: Record<CustomerDocCategory, string> = {
  [CustomerDocCategory.INVOICE]: 'Rechnung',
  [CustomerDocCategory.CUSTOMS_EXIT]: 'Austrittsbestätigung Verzollung',
  [CustomerDocCategory.POD]: 'Abliefernachweis / POD',
  [CustomerDocCategory.CMR]: 'CMR',
  [CustomerDocCategory.OTHER]: 'Sonstiges Dokument',
};

export enum NotificationEvent {
  SHIPMENT_CREATED = 'SHIPMENT_CREATED',
  STATUS_CHANGED = 'STATUS_CHANGED',
  POD_AVAILABLE = 'POD_AVAILABLE',
  DOCUMENT_RECEIVED = 'DOCUMENT_RECEIVED',
  PARTNER_FILE_IMPORTED = 'PARTNER_FILE_IMPORTED',
}

export enum PartnerJobStatus {
  PENDING = 'PENDING',
  PROCESSING = 'PROCESSING',
  SUCCESS = 'SUCCESS',
  FAILED = 'FAILED',
}

export const SHIPMENT_STATUS_LABELS: Record<ShipmentStatus, string> = {
  [ShipmentStatus.DRAFT]: 'Entwurf',
  [ShipmentStatus.SUBMITTED]: 'Übermittelt',
  [ShipmentStatus.ACCEPTED]: 'Angenommen',
  [ShipmentStatus.PICKED_UP]: 'Abgeholt',
  [ShipmentStatus.IN_TRANSIT]: 'Unterwegs',
  [ShipmentStatus.OUT_FOR_DELIVERY]: 'In Zustellung',
  [ShipmentStatus.DELIVERED]: 'Zugestellt',
  [ShipmentStatus.EXCEPTION]: 'Störung',
  [ShipmentStatus.CANCELLED]: 'Storniert',
};

export const ROLE_LABELS: Record<UserRole, string> = {
  [UserRole.ORG_ADMIN]: 'Organisations-Admin',
  [UserRole.MANDANT_DISPATCHER]: 'Disponent',
  [UserRole.CUSTOMER_USER]: 'Kunde',
  [UserRole.PARTNER]: 'Partner',
};

export {
  VORARLBERG_CH_GOODS_BORDERS,
  isValidGrenzuebergang,
  isVorarlbergChGoodsBorder,
} from './borders';
export type { VorarlbergChGoodsBorder } from './borders';

export { FRANKATUREN, isFrankatur } from './frankatur';
export type { Frankatur } from './frankatur';

export { PACKAGING_TYPES, packagingLabel } from './packaging';
export type { PackagingCode } from './packaging';

export { SHIPMENT_EXTRA_OPTIONS, shipmentExtrasLabels } from './shipment-extras';
export type { ShipmentExtraCode, ShipmentExtras } from './shipment-extras';

export {
  normalizeSmartBorderPlate,
  isValidSmartBorderPlate,
  smartBorderPlateHint,
  SMART_BORDER_PLATE_COUNTRIES,
} from './smart-border-plates';

export {
  COUNTRIES,
  countryLabel,
  zipPatternForCountry,
  isValidZipForCountry,
  isSwitzerlandOrLiechtenstein,
  requiresChLiCustomsDocuments,
  CH_LI_CUSTOMS_MANDANT_CODES,
} from './countries';
export type { CountryCode } from './countries';

export {
  EZOLL_FILENAME_IGNORE_PREFIXES_KEY,
  DEFAULT_EZOLL_FILENAME_IGNORE_PREFIXES,
  normalizeFilenameIgnorePrefixes,
  matchesFilenameIgnorePrefix,
} from './ezoll-ignore';

export {
  detectEzollDocType,
  parseSoloplanMatchFromFilename,
  parseSoloplanMatchFromLrn,
  soloplanMatchKey,
  extractMrnFromPdfText,
  extractLrnFromPdfText,
  extractTotalItemsFromPdfText,
  extractEur1NumberFromPdfText,
  extractCc529FieldsFromPdfText,
  extractCc529FieldsFromXml,
  isCc529Xml,
} from './ezoll-doc-types';
export type { EzollDocType, EzollSoloplanMatch, EzollCc529Fields } from './ezoll-doc-types';
