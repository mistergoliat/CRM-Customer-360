import type { CustomerAddress } from "@/lib/domains/customer-addresses";

export const CUSTOMER_360_CONTRACT_NAME = "Customer360Snapshot" as const;
export const CUSTOMER_360_SCHEMA_VERSION = "1.0.0" as const;
export const CUSTOMER_360_SNAPSHOT_VERSION = 1 as const;

export type Customer360SectionState = "real" | "partial" | "unavailable" | "error";

export type Customer360LinkedIdentity = {
  type: string;
  value: string;
  source: string;
  verified: boolean;
};

export type Customer360Identity = {
  state: "provisional" | "resolved" | "partial" | "conflicted" | "unknown";
  source: string;
  sourceRecordId: string | null;
  customerKey: string | null;
  displayName: string;
  firstname: string | null;
  lastname: string | null;
  email: string | null;
  platformOrigin: string | null;
  linkedIdentities: Customer360LinkedIdentity[];
};

export type Customer360SummaryCounts = {
  conversations: number;
  messages: number;
  opportunities: number;
  profiles: number;
  actions: number;
  outcomes: number;
  quotes: number;
  orders: number;
  addresses: number;
  commercialEvents: number;
};

export type Customer360ProfileSummary = {
  source: string;
  state: Customer360SectionState;
  warnings: string[];
  customerId: string;
  displayName: string;
  linkedIdentitiesCount: number;
  counts: Customer360SummaryCounts;
  lastActivityAt: string | null;
};

export type Customer360Freshness = {
  source: string;
  lastActivityAt: string | null;
  lastRefreshedAt: string;
  state: "fresh" | "stale" | "unknown";
};

export type Customer360Completeness = {
  state: "complete" | "partial" | "minimal" | "insufficient";
  score: number;
  missing: string[];
};

export type Customer360Metadata = {
  source: string;
  freshness: Customer360Freshness;
  completeness: Customer360Completeness;
  warnings: string[];
};

export type Customer360Section<TItem> = {
  state: Customer360SectionState;
  source: string;
  lastUpdatedAt: string | null;
  warnings: string[];
  total: number;
  items: TItem[];
};

export type Customer360ConversationItem = {
  conversationId: string;
  publicId: string;
  channel: string;
  provider: string;
  externalContactId: string;
  status: string;
  aiEnabled: boolean;
  humanOwnerActive: boolean;
  lastMessageAt: string | null;
  lastInboundAt: string | null;
  lastOutboundAt: string | null;
  lastMessagePreview: string | null;
  messageCount: number;
};

export type Customer360MessageItem = {
  messageId: string;
  conversationId: string;
  publicId: string;
  direction: string;
  senderType: string;
  messageType: string;
  status: string;
  bodyPreview: string | null;
  occurredAt: string | null;
  providerMessageId: string | null;
};

export type Customer360OpportunityItem = {
  opportunityId: string;
  opportunityKey: string;
  status: string;
  stage: string | null;
  primaryIntent: string;
  priority: string;
  temperature: string;
  nextActionType: string | null;
  nextActionDueAt: string | null;
  lastActivityAt: string | null;
  currentSummary: string | null;
  sourceRef: string | null;
};

export type Customer360ProfileItem = {
  profileId: string;
  profileKey: string;
  opportunityKey: string;
  useCase: string | null;
  customerType: string | null;
  decisionReadiness: string | null;
  purchaseUrgency: string | null;
  budgetMin: string | null;
  budgetMax: string | null;
  missingInformation: string[];
  lastUpdatedAt: string | null;
  sourceRef: string | null;
};

export type Customer360ActionItem = {
  actionId: string;
  actionType: string;
  status: string;
  riskLevel: string;
  approvalRequirement: string;
  scheduledFor: string | null;
  expiresAt: string | null;
  finalMessage: string | null;
  draftMessage: string | null;
  sourceRef: string | null;
};

export type Customer360OutcomeItem = {
  outcomeId: string;
  actionId: string;
  outcomeType: string;
  occurredAt: string;
  recordedAt: string | null;
  providerMessageId: string | null;
  sourceRef: string | null;
};

export type Customer360QuoteItem = {
  quoteId: string;
  requestId: string;
  status: string;
  version: number;
  opportunityId: string | null;
  customerId: string | null;
  total: string | null;
  currency: string | null;
  createdAt: string;
  sentAt: string | null;
  decidedAt: string | null;
  expiryAt: string | null;
  sourceRef: string | null;
};

export type Customer360OrderItem = {
  orderId: string;
  reference: string | null;
  status: string | null;
  currentStateId: string | null;
  stateName: string | null;
  invoiceNumber: string | null;
  totalPaid: string | null;
  createdAt: string | null;
  sourceRef: string | null;
};

export type Customer360AddressItem = CustomerAddress & {
  confirmationState: "unknown";
};

export type Customer360CommercialEventItem = {
  eventId: string;
  eventType: string;
  source: string;
  occurredAt: string;
  correlationId: string;
  conversationId: string | null;
  opportunityId: string | null;
  sourceRef: string | null;
  summary: string;
};

export type CustomerLifecycleEvent = {
  contractName: string;
  schemaVersion: "1.0.0";
  eventId: string;
  eventType: string;
  source: string;
  entityType: string;
  entityId: string;
  customerId: string;
  occurredAt: string;
  summary: string;
  severity: "low" | "medium" | "high";
  metadata: Record<string, unknown>;
};

export type CustomerLifecycleSection = Customer360Section<CustomerLifecycleEvent>;

export type Customer360Sections = {
  conversations: Customer360Section<Customer360ConversationItem>;
  messages: Customer360Section<Customer360MessageItem>;
  opportunities: Customer360Section<Customer360OpportunityItem>;
  profiles: Customer360Section<Customer360ProfileItem>;
  actions: Customer360Section<Customer360ActionItem>;
  outcomes: Customer360Section<Customer360OutcomeItem>;
  quotes: Customer360Section<Customer360QuoteItem>;
  orders: Customer360Section<Customer360OrderItem>;
  addresses: Customer360Section<Customer360AddressItem>;
  commercialEvents: Customer360Section<Customer360CommercialEventItem>;
};

export type Customer360Snapshot = {
  contractName: typeof CUSTOMER_360_CONTRACT_NAME;
  schemaVersion: typeof CUSTOMER_360_SCHEMA_VERSION;
  snapshotVersion: typeof CUSTOMER_360_SNAPSHOT_VERSION;
  customerId: string;
  identity: Customer360Identity;
  profile: Customer360ProfileSummary;
  sections: Customer360Sections;
  lifecycle: CustomerLifecycleSection;
  metadata: Customer360Metadata;
};

export type Customer360ProfileProjection = {
  identity: Customer360Identity;
  profile: Customer360ProfileSummary;
  sections: Omit<Customer360Sections, "addresses">;
  freshness: Customer360Freshness;
  completeness: Customer360Completeness;
  warnings: string[];
};

export type Customer360PortResultState = Customer360SectionState;

export type CustomerProfilePortResult = {
  state: Customer360PortResultState;
  source: string;
  warnings: string[];
  profile: Customer360ProfileProjection | null;
};

export type AddressBookPortResult = {
  state: Customer360PortResultState;
  source: string;
  warnings: string[];
  addresses: Customer360Section<Customer360AddressItem> | null;
};

export interface CustomerProfilePort {
  loadCustomerProfile(customerId: string): Promise<CustomerProfilePortResult>;
}

export interface AddressBookPort {
  loadAddressBook(customerId: string): Promise<AddressBookPortResult>;
}

export type Customer360ProfileSectionName = keyof Omit<Customer360Sections, "addresses">;

export type Customer360QueryServiceDependencies = {
  profilePort?: CustomerProfilePort;
  addressBookPort?: AddressBookPort;
  lifecycleEventAssembler?: LifecycleEventAssembler;
  now?: () => Date;
};

export type LifecycleEventAssemblerInput = {
  customerId: string;
  profile: Customer360ProfileProjection;
  addresses: Customer360Section<Customer360AddressItem>;
  now: Date;
};

export type LifecycleEventAssembler = (input: LifecycleEventAssemblerInput) => CustomerLifecycleSection;

// Additive result for ACS-R1-04-T05: getByCustomerId() alone collapses "no
// such customer" and "profile source unavailable" into the same `null`. This
// preserves that public contract while giving loadAutonomousCustomerContext
// (lib/brain/commercial/context) a way to tell the two apart, per
// docs/data/customer-360-contract.md and ADR-008's failure model.
export type Customer360LoadResult =
  | { status: "found"; snapshot: Customer360Snapshot; warnings: string[] }
  | { status: "not_found"; snapshot: null; warnings: string[] }
  | { status: "unavailable"; snapshot: null; warnings: string[] };

export type Customer360QueryService = {
  getByCustomerId(customerId: string): Promise<Customer360Snapshot | null>;
  loadByCustomerId(customerId: string): Promise<Customer360LoadResult>;
};
