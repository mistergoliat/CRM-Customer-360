import {
  CUSTOMER_IDENTITY_CONFIDENCE_LEVELS,
  CUSTOMER_IDENTITY_RESOLUTION_STATUSES,
  CUSTOMER_IDENTITY_SOURCES,
  CUSTOMER_IDENTITY_TYPES,
  CUSTOMER_LIFECYCLE_STAGES,
  type CustomerIdentityConfidence,
  type CustomerIdentityResolutionStatus,
  type CustomerIdentitySource,
  type CustomerIdentityType,
} from "./types";

export const CUSTOMER_IDENTITY_PRECEDENCE = [
  "prestashop_customer_id",
  "email",
  "order_id",
  "invoice_number",
  "phone",
  "wa_id",
] as const satisfies readonly CustomerIdentityType[];

export const CUSTOMER_STRONG_IDENTITY_TYPES = [
  "prestashop_customer_id",
  "email",
  "order_id",
  "invoice_number",
] as const satisfies readonly CustomerIdentityType[];

export const CUSTOMER_PROVISIONAL_IDENTITY_TYPES = [
  "wa_id",
  "phone",
  "rut",
  "appsheet_customer_id",
] as const satisfies readonly CustomerIdentityType[];

export const CUSTOMER_NO_MERGE_REASONS = [
  "emails_distinct_strong",
  "prestashop_customer_id_distinct",
  "phone_or_wa_id_ambiguous",
  "invoice_or_order_assigned_elsewhere",
] as const;

export const CUSTOMER_DEFAULT_READ_ONLY_OPTIONS = {
  readOnly: true,
  allowProvisional: true,
  debug: false,
} as const;

export const CUSTOMER_DEFAULT_RESOLUTION_STATUS: CustomerIdentityResolutionStatus =
  CUSTOMER_IDENTITY_RESOLUTION_STATUSES[4];

export const CUSTOMER_DEFAULT_IDENTITY_SOURCE: CustomerIdentitySource = "unknown";

export const CUSTOMER_DEFAULT_IDENTITY_CONFIDENCE: CustomerIdentityConfidence = "medium";

export {
  CUSTOMER_IDENTITY_TYPES,
  CUSTOMER_IDENTITY_SOURCES,
  CUSTOMER_IDENTITY_CONFIDENCE_LEVELS,
  CUSTOMER_IDENTITY_RESOLUTION_STATUSES,
  CUSTOMER_LIFECYCLE_STAGES,
};
