export const CUSTOMER_IDENTITY_TYPES = [
  "email",
  "wa_id",
  "phone",
  "prestashop_customer_id",
  "order_id",
  "invoice_number",
  "rut",
  "appsheet_customer_id",
] as const;

export type CustomerIdentityType = (typeof CUSTOMER_IDENTITY_TYPES)[number];

export const CUSTOMER_IDENTITY_SOURCES = [
  "brain",
  "whatsapp",
  "n8n",
  "prestashop",
  "mariadb",
  "appsheet",
  "hub_operator",
  "import",
  "unknown",
] as const;

export type CustomerIdentitySource = (typeof CUSTOMER_IDENTITY_SOURCES)[number];

export const CUSTOMER_IDENTITY_CONFIDENCE_LEVELS = ["high", "medium", "low"] as const;

export type CustomerIdentityConfidence = (typeof CUSTOMER_IDENTITY_CONFIDENCE_LEVELS)[number];

export const CUSTOMER_IDENTITY_RESOLUTION_STATUSES = [
  "resolved_existing",
  "created_provisional",
  "linked_identity",
  "conflict_needs_review",
  "not_enough_identity",
  "skipped_read_only",
] as const;

export type CustomerIdentityResolutionStatus =
  (typeof CUSTOMER_IDENTITY_RESOLUTION_STATUSES)[number];

export const CUSTOMER_LIFECYCLE_STAGES = [
  "provisional",
  "lead",
  "customer",
  "repeat_customer",
  "inactive",
  "blocked",
  "unknown",
] as const;

export type CustomerLifecycleStage = (typeof CUSTOMER_LIFECYCLE_STAGES)[number];

export type CustomerIdentityResolutionInput = {
  waId?: string | null;
  email?: string | null;
  phone?: string | null;
  idCustomer?: string | number | null;
  idOrder?: string | number | null;
  invoiceNumber?: string | null;
  conversationCaseId?: string | number | null;
  messageId?: string | null;
  source?: CustomerIdentitySource;
  options?: {
    readOnly?: boolean;
    allowProvisional?: boolean;
    debug?: boolean;
  };
};

export type CustomerMasterReadModel = {
  customerMasterId: string;
  primaryIdentityType: CustomerIdentityType | null;
  primaryIdentityValue: string | null;
  lifecycleStage: CustomerLifecycleStage;
  identityState: "resolved" | "provisional" | "conflicted" | "unknown";
  mergeState: "none" | "pending" | "merged" | "conflict";
  reviewState: "clear" | "needs_review";
  confidence: CustomerIdentityConfidence;
  sourceSystem: CustomerIdentitySource | null;
  createdAt?: string | null;
  updatedAt?: string | null;
};

export type CustomerIdentityReadModel = {
  customerIdentityId: string;
  customerMasterId: string;
  identityType: CustomerIdentityType;
  identityValue: string;
  isPrimary: boolean;
  isVerified: boolean;
  confidence: CustomerIdentityConfidence;
  source: CustomerIdentitySource;
  sourceRecordId: string | number | null;
  lifecycleStage: CustomerLifecycleStage;
  createdAt?: string | null;
  updatedAt?: string | null;
};

export type CustomerTimelineSeed = {
  eventType: string;
  eventSource: CustomerIdentitySource;
  eventRefType: "message_id" | "conversation_case_id" | "order_id" | "invoice_number" | "identity";
  eventRefId: string | number;
  confidence: CustomerIdentityConfidence;
  payload?: Record<string, unknown>;
};

export type CustomerResolutionMode = "read_only_composite" | "future_write_enabled";

export type CustomerSourceMatch = {
  source: CustomerIdentitySource;
  matchedBy: string;
  confidence: CustomerIdentityConfidence;
  sourceRecordId: string | number | null;
  identityType: CustomerIdentityType | null;
  identityValue: string | null;
  customerKey: string | null;
  notes: string[];
};

export type CustomerWritePolicy = {
  canCreateCustomerMaster: boolean;
  canAttachIdentity: boolean;
  canAppendTimelineEvent: boolean;
  canMerge: boolean;
  reason: string;
};

export type CustomerResolutionMetadata = {
  resolverVersion: string;
  resolutionMode: CustomerResolutionMode;
  readOnly: boolean;
  allowProvisional: boolean;
  source: CustomerIdentitySource;
  matchedBy: CustomerIdentityType | null;
  candidateCount: number;
  syntheticCustomerId: string | null;
  sourceMatchesCount: number;
  resolvedAt?: string | null;
  notes?: string[] | null;
};

export type CustomerIdentityResolutionReason =
  | "strong_match"
  | "weak_match"
  | "provisional_candidate"
  | "conflict"
  | "insufficient_identity"
  | "read_only";

export type CustomerIdentityResolution = {
  status: CustomerIdentityResolutionStatus;
  confidence: CustomerIdentityConfidence;
  needsReview: boolean;
  readOnly: boolean;
  reason: CustomerIdentityResolutionReason;
  matchedBy: CustomerIdentityType | null;
  conflictReasons: string[];
  candidateCustomerIds: string[];
};

export type CustomerIdentityResolutionResult = {
  customer: CustomerMasterReadModel | null;
  identities: CustomerIdentityReadModel[];
  resolution: CustomerIdentityResolution;
  timelineSeed?: CustomerTimelineSeed | null;
  warnings: string[];
  metadata: CustomerResolutionMetadata;
  sourceMatches: CustomerSourceMatch[];
  writePolicy: CustomerWritePolicy;
};
