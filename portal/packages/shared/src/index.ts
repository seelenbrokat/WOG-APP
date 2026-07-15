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
  OTHER = 'OTHER',
}

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
