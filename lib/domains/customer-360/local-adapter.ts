import { getColumns, hasTable, safeQueryRows } from "@/lib/db";
import type { CustomerAddress } from "@/lib/domains/customer-addresses";
import { normalizePlatformOrigin } from "@/lib/domains/customers/platform-origin";
import type {
  AddressBookPort,
  AddressBookPortResult,
  Customer360ActionItem,
  Customer360AddressItem,
  Customer360CommercialEventItem,
  Customer360Completeness,
  Customer360ConversationItem,
  Customer360Freshness,
  Customer360Identity,
  Customer360LinkedIdentity,
  Customer360MessageItem,
  Customer360OpportunityItem,
  Customer360OrderItem,
  Customer360OutcomeItem,
  Customer360ProfileItem,
  Customer360ProfileProjection,
  Customer360ProfileSummary,
  Customer360QuoteItem,
  Customer360Section,
  Customer360SectionState,
  CustomerProfilePort,
  CustomerProfilePortResult,
  Customer360SummaryCounts
} from "./types";

type DbLikeRow = Record<string, unknown>;

function asText(value: unknown): string | null {
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
  }
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  if (typeof value === "bigint") return value.toString();
  return null;
}

function asNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "bigint") return Number(value);
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function asBool(value: unknown): boolean {
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value !== 0;
  if (typeof value === "string") return value === "1" || value.toLowerCase() === "true";
  return false;
}

function asIso(value: unknown): string | null {
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value.toISOString();
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) return null;
    const parsed = new Date(trimmed.includes("T") ? trimmed : `${trimmed.replace(" ", "T")}Z`);
    return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
  }
  return null;
}

function asJsonArray(value: unknown): unknown[] {
  if (Array.isArray(value)) return value;
  if (typeof value === "string" && value.trim()) {
    try {
      const parsed = JSON.parse(value);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }
  return [];
}

function asJsonObject<T extends Record<string, unknown>>(value: unknown): T | null {
  if (value && typeof value === "object" && !Array.isArray(value)) return value as T;
  if (typeof value === "string" && value.trim()) {
    try {
      const parsed = JSON.parse(value);
      return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as T) : null;
    } catch {
      return null;
    }
  }
  return null;
}

function mapAddressRow(row: DbLikeRow): CustomerAddress {
  return {
    contractName: "CustomerAddress",
    schemaVersion: "1.0.0",
    addressId: asText(row.address_id) ?? "",
    customerId: asNumber(row.customer_id) ?? 0,
    createdByActionId: asText(row.created_by_action_id),
    addressLabel: asText(row.address_label),
    recipientName: asText(row.recipient_name),
    recipientPhone: asText(row.recipient_phone),
    streetName: asText(row.street_name) ?? "",
    streetNumber: asText(row.street_number) ?? "",
    unit: asText(row.unit),
    commune: asText(row.commune) ?? "",
    city: asText(row.city),
    region: asText(row.region) ?? "",
    postalCode: asText(row.postal_code),
    deliveryNotes: asText(row.delivery_notes),
    isDefault: asBool(row.is_default),
    isActive: asBool(row.is_active),
    createdAt: asIso(row.created_at) ?? "",
    updatedAt: asIso(row.updated_at) ?? ""
  };
}

function emptySection<T>(source: string, warnings: string[] = []): Customer360Section<T> {
  return {
    state: warnings.length > 0 ? "partial" : "real",
    source,
    lastUpdatedAt: null,
    warnings,
    total: 0,
    items: []
  };
}

function mapSection<T>(input: {
  source: string;
  rows: DbLikeRow[];
  mapper: (row: DbLikeRow) => T;
  warnings?: string[];
}): Customer360Section<T> {
  const rows = input.rows;
  const lastUpdatedAt = rows
    .map((row) => asIso(row.updated_at) ?? asIso(row.created_at) ?? asIso(row.occurred_at) ?? asIso(row.last_activity_at) ?? null)
    .filter((value): value is string => Boolean(value))
    .sort()
    .at(-1) ?? null;

  return {
    state: input.warnings && input.warnings.length > 0 ? "partial" : "real",
    source: input.source,
    lastUpdatedAt,
    warnings: input.warnings ?? [],
    total: rows.length,
    items: rows.map((row) => input.mapper(row))
  };
}

function summarizeLastActivity(...timestamps: Array<string | null | undefined>) {
  return timestamps
    .filter((value): value is string => Boolean(value))
    .sort()
    .at(-1) ?? null;
}

function formatMoney(value: unknown) {
  const amount = asNumber(value);
  if (amount === null) return null;
  return `CLP ${new Intl.NumberFormat("es-CL", { maximumFractionDigits: 0 }).format(amount)}`;
}

function normalizeItems(values: unknown[]) {
  return values.map((value) => (typeof value === "string" ? value : String(value))).filter((value) => value.trim().length > 0);
}

async function loadCustomerRow(customerId: string) {
  if (!(await hasTable("master_customer"))) {
    return { row: null, warnings: ["master_customer_unavailable"] };
  }
  const result = await safeQueryRows<DbLikeRow>("SELECT id, firstname, lastname, email, platform_origin FROM master_customer WHERE id = ? LIMIT 1", [customerId]);
  if (!result.ok) {
    return { row: null, warnings: [result.error] };
  }
  return { row: result.rows[0] ?? null, warnings: [] };
}

async function loadExternalIdentities(customerId: string) {
  if (!(await hasTable("customer_external_identity"))) {
    return { rows: [] as DbLikeRow[], warnings: ["customer_external_identity_unavailable"] };
  }
  const result = await safeQueryRows<DbLikeRow>(
    `SELECT provider, identity_type, external_id, normalized_value, is_verified, created_at, updated_at
       FROM customer_external_identity
      WHERE customer_id = ?
      ORDER BY updated_at DESC, id DESC`,
    [customerId]
  );
  return result.ok ? { rows: result.rows, warnings: [] } : { rows: [], warnings: [result.error] };
}

async function loadConversationRows(customerId: string, waIds: string[]) {
  if (!(await hasTable("conversation"))) {
    return { rows: [] as DbLikeRow[], warnings: ["conversation_unavailable"] };
  }

  const clauses = ["customer_id = ?"];
  const params: unknown[] = [customerId];
  if (waIds.length > 0) {
    clauses.push(`external_contact_id IN (${waIds.map(() => "?").join(",")})`);
    params.push(...waIds);
  }

  const result = await safeQueryRows<DbLikeRow>(
    `SELECT id, public_id, channel, provider, channel_account_id, external_contact_id, status, owner_type, owner_id, ai_enabled, human_owner_active, last_message_at, last_inbound_at, last_outbound_at, created_at, updated_at
       FROM conversation
      WHERE ${clauses.join(" OR ")}
      ORDER BY COALESCE(last_message_at, updated_at, created_at) DESC, id DESC`,
    params
  );
  return result.ok ? { rows: result.rows, warnings: [] } : { rows: [], warnings: [result.error] };
}

async function loadConversationMessages(conversationIds: string[]) {
  if (conversationIds.length === 0 || !(await hasTable("conversation_message"))) {
    return { rows: [] as DbLikeRow[], warnings: conversationIds.length === 0 ? [] : ["conversation_message_unavailable"] };
  }

  const result = await safeQueryRows<DbLikeRow>(
    `SELECT id, public_id, conversation_id, provider, provider_message_id, direction, sender_type, message_type, body, status, provider_timestamp, created_at, updated_at
       FROM conversation_message
      WHERE conversation_id IN (${conversationIds.map(() => "?").join(",")})
      ORDER BY COALESCE(provider_timestamp, created_at) DESC, id DESC
      LIMIT 120`,
    conversationIds
  );
  return result.ok ? { rows: result.rows, warnings: [] } : { rows: [], warnings: [result.error] };
}

async function loadOpportunityRows(customerId: string, waIds: string[]) {
  if (!(await hasTable("crm_opportunities"))) {
    return { rows: [] as DbLikeRow[], warnings: ["crm_opportunities_unavailable"] };
  }

  const clauses = ["customer_master_id = ?"];
  const params: unknown[] = [customerId];
  if (waIds.length > 0) {
    clauses.push(`wa_id IN (${waIds.map(() => "?").join(",")})`);
    params.push(...waIds);
  }

  const result = await safeQueryRows<DbLikeRow>(
    `SELECT id, opportunity_key, customer_candidate_id, customer_master_id, lead_id, conversation_case_id, wa_id, channel, primary_intent, status, stage, temperature, priority, current_summary, next_action_type, next_action_due_at, human_owner_active, ai_blocked, version, created_at, updated_at, last_activity_at, closed_at
       FROM crm_opportunities
      WHERE ${clauses.join(" OR ")}
      ORDER BY COALESCE(last_activity_at, updated_at, created_at) DESC, id DESC`,
    params
  );
  return result.ok ? { rows: result.rows, warnings: [] } : { rows: [], warnings: [result.error] };
}

async function loadProfileRows(customerId: string, opportunityKeys: string[], waIds: string[]) {
  if (!(await hasTable("crm_sales_need_profiles"))) {
    return { rows: [] as DbLikeRow[], warnings: ["crm_sales_need_profiles_unavailable"] };
  }

  const clauses = ["customer_master_id = ?"];
  const params: unknown[] = [customerId];
  if (opportunityKeys.length > 0) {
    clauses.push(`opportunity_key IN (${opportunityKeys.map(() => "?").join(",")})`);
    params.push(...opportunityKeys);
  }
  if (waIds.length > 0) {
    clauses.push(`wa_id IN (${waIds.map(() => "?").join(",")})`);
    params.push(...waIds);
  }

  const result = await safeQueryRows<DbLikeRow>(
    `SELECT id, profile_key, opportunity_id, opportunity_key, conversation_case_id, wa_id, customer_master_id, customer_candidate_id, lead_id, use_case, customer_type, goals_json, required_features_json, preferred_features_json, budget_min, budget_max, available_space_json, location_json, delivery_deadline, experience_level, purchase_urgency, decision_readiness, missing_information_json, source_message_id, last_message_text, profile_json, profile_version, created_at, updated_at
       FROM crm_sales_need_profiles
      WHERE ${clauses.join(" OR ")}
      ORDER BY updated_at DESC, id DESC`,
    params
  );
  return result.ok ? { rows: result.rows, warnings: [] } : { rows: [], warnings: [result.error] };
}

async function loadActionRows(opportunityIds: string[], waIds: string[]) {
  if (!(await hasTable("crm_agent_actions"))) {
    return { rows: [] as DbLikeRow[], warnings: ["crm_agent_actions_unavailable"] };
  }

  const clauses: string[] = [];
  const params: unknown[] = [];
  if (opportunityIds.length > 0) {
    clauses.push(`opportunity_id IN (${opportunityIds.map(() => "?").join(",")})`);
    params.push(...opportunityIds);
  }
  if (waIds.length > 0) {
    clauses.push(`wa_id IN (${waIds.map(() => "?").join(",")})`);
    params.push(...waIds);
  }
  if (clauses.length === 0) {
    return { rows: [] as DbLikeRow[], warnings: [] };
  }

  const result = await safeQueryRows<DbLikeRow>(
    `SELECT id, action_id, idempotency_key, opportunity_id, decision_id, decision_row_id, conversation_case_id, message_id, wa_id, channel, action_type, status, risk_level, approval_requirement, draft_payload_json, final_payload_json, execution_payload_json, draft_message, final_message, scheduled_for, expires_at, attempt_number, max_attempts, block_reasons_json, cancel_reason, failure_reason, policy_status, policy_notes_json, source, created_by, approved_by, approved_at, executed_at, cancelled_at, outbox_message_id, lifecycle_version, policy_version, runtime_version, created_at, updated_at
       FROM crm_agent_actions
      WHERE ${clauses.join(" OR ")}
      ORDER BY COALESCE(scheduled_for, updated_at, created_at) DESC, id DESC`,
    params
  );
  return result.ok ? { rows: result.rows, warnings: [] } : { rows: [], warnings: [result.error] };
}

async function loadOutcomeRows(input: { actionIds: string[]; actionRowIds: string[] }) {
  if ((input.actionIds.length === 0 && input.actionRowIds.length === 0) || !(await hasTable("crm_action_outcomes"))) {
    return { rows: [] as DbLikeRow[], warnings: input.actionIds.length === 0 && input.actionRowIds.length === 0 ? [] : ["crm_action_outcomes_unavailable"] };
  }

  const result = await safeQueryRows<DbLikeRow>(
    `SELECT id, outcome_id, action_id, action_row_id, execution_id, outbox_message_id, provider_message_id, outcome_type, occurred_at, recorded_at, provider_event_json, metadata_json, created_at, updated_at
       FROM crm_action_outcomes
      WHERE action_id IN (${input.actionIds.map(() => "?").join(",")})
         OR action_row_id IN (${input.actionRowIds.map(() => "?").join(",")})
      ORDER BY occurred_at DESC, id DESC`,
    [...input.actionIds, ...input.actionRowIds]
  );
  return result.ok ? { rows: result.rows, warnings: [] } : { rows: [], warnings: [result.error] };
}

async function loadQuoteRows(customerId: string, opportunityIds: string[]) {
  if (!(await hasTable("crm_quotes"))) {
    return { rows: [] as DbLikeRow[], warnings: ["crm_quotes_unavailable"] };
  }

  const clauses = ["customer_id = ?"];
  const params: unknown[] = [customerId];
  if (opportunityIds.length > 0) {
    clauses.push(`opportunity_id IN (${opportunityIds.map(() => "?").join(",")})`);
    params.push(...opportunityIds);
  }

  const result = await safeQueryRows<DbLikeRow>(
    `SELECT id, quote_id, request_id, conversation_id, opportunity_id, customer_id, created_by_action_id, version, status, items_json, totals_json, address_snapshot_json, expiry_at, created_at, updated_at, sent_at, decided_at
       FROM crm_quotes
      WHERE ${clauses.join(" OR ")}
      ORDER BY created_at DESC, version DESC, id DESC`,
    params
  );
  return result.ok ? { rows: result.rows, warnings: [] } : { rows: [], warnings: [result.error] };
}

async function loadCommercialEventRows(customerId: string, conversationIds: string[], opportunityIds: string[]) {
  if (!(await hasTable("commercial_event"))) {
    return { rows: [] as DbLikeRow[], warnings: ["commercial_event_unavailable"] };
  }

  const clauses = ["customer_id = ?"];
  const params: unknown[] = [customerId];
  if (conversationIds.length > 0) {
    clauses.push(`conversation_id IN (${conversationIds.map(() => "?").join(",")})`);
    params.push(...conversationIds);
  }
  if (opportunityIds.length > 0) {
    clauses.push(`opportunity_id IN (${opportunityIds.map(() => "?").join(",")})`);
    params.push(...opportunityIds);
  }

  const result = await safeQueryRows<DbLikeRow>(
    `SELECT id, contract_name, schema_version, event_type, source, source_event_id, dedupe_key, correlation_id, causation_id, customer_id, conversation_id, opportunity_id, channel, provider, occurred_at, received_at, payload_json, metadata_json, created_at
       FROM commercial_event
      WHERE ${clauses.join(" OR ")}
      ORDER BY occurred_at DESC, id DESC
      LIMIT 120`,
    params
  );
  return result.ok ? { rows: result.rows, warnings: [] } : { rows: [], warnings: [result.error] };
}

async function loadOrders(_customerId: string, email: string | null, prestashopCustomerIds: string[]) {
  if (!(await hasTable("ps_orders"))) {
    return { rows: [] as DbLikeRow[], warnings: ["ps_orders_unavailable"] };
  }

  const columns = await getColumns("ps_orders");
  const clauses: string[] = [];
  const params: unknown[] = [];

  if (prestashopCustomerIds.length > 0 && columns.includes("id_customer")) {
    clauses.push(`id_customer IN (${prestashopCustomerIds.map(() => "?").join(",")})`);
    params.push(...prestashopCustomerIds);
  }

  if (email && columns.includes("email")) {
    clauses.push("LOWER(email) = ?");
    params.push(email.toLowerCase());
  }

  if (clauses.length === 0) {
    return { rows: [] as DbLikeRow[], warnings: ["ps_orders_no_matchable_columns"] };
  }

  const selectColumns = [
    "id_order",
    "reference",
    "current_state",
    "total_paid",
    "date_add",
    columns.includes("id_customer") ? "id_customer" : null,
    columns.includes("invoice_number") ? "invoice_number" : null,
    columns.includes("status") ? "status" : null,
    columns.includes("email") ? "email" : null
  ].filter((value): value is string => Boolean(value));

  const result = await safeQueryRows<DbLikeRow>(
    `SELECT ${selectColumns.map((column) => `\`${column}\``).join(", ")}
       FROM ps_orders
      WHERE ${clauses.join(" OR ")}
      ORDER BY id_order DESC
      LIMIT 40`,
    params
  );
  return result.ok ? { rows: result.rows, warnings: [] } : { rows: [], warnings: [result.error] };
}

function mapCustomerIdentity(row: DbLikeRow, customerId: string, linkedIdentities: Customer360LinkedIdentity[]): Customer360Identity {
  const firstname = asText(row.firstname);
  const lastname = asText(row.lastname);
  const displayName = `${firstname ?? ""} ${lastname ?? ""}`.trim() || asText(row.email) || `Customer ${customerId}`;
  return {
    state: "provisional",
    source: "master_customer",
    sourceRecordId: asText(row.id),
    customerKey: `master_customer:${customerId}`,
    displayName,
    firstname,
    lastname,
    email: asText(row.email),
    platformOrigin: normalizePlatformOrigin(asText(row.platform_origin)),
    linkedIdentities
  };
}

function mapConversationRow(row: DbLikeRow, messageByConversationId: Map<string, DbLikeRow[]>): Customer360ConversationItem {
  const conversationId = asText(row.id) ?? asText(row.public_id) ?? "";
  const messages = messageByConversationId.get(conversationId) ?? [];
  const latest = messages[0] ?? null;
  return {
    conversationId,
    publicId: asText(row.public_id) ?? conversationId,
    channel: asText(row.channel) ?? "unknown",
    provider: asText(row.provider) ?? "unknown",
    externalContactId: asText(row.external_contact_id) ?? "unknown",
    status: asText(row.status) ?? "unknown",
    aiEnabled: asBool(row.ai_enabled),
    humanOwnerActive: asBool(row.human_owner_active),
    lastMessageAt: asIso(row.last_message_at),
    lastInboundAt: asIso(row.last_inbound_at),
    lastOutboundAt: asIso(row.last_outbound_at),
    lastMessagePreview: asText(latest?.body) ?? null,
    messageCount: messages.length
  };
}

function mapMessageRow(row: DbLikeRow): Customer360MessageItem {
  return {
    messageId: asText(row.id) ?? asText(row.public_id) ?? "",
    conversationId: asText(row.conversation_id) ?? "",
    publicId: asText(row.public_id) ?? asText(row.id) ?? "",
    direction: asText(row.direction) ?? "unknown",
    senderType: asText(row.sender_type) ?? "unknown",
    messageType: asText(row.message_type) ?? "unknown",
    status: asText(row.status) ?? "unknown",
    bodyPreview: asText(row.body),
    occurredAt: asIso(row.provider_timestamp) ?? asIso(row.created_at),
    providerMessageId: asText(row.provider_message_id)
  };
}

function mapOpportunityRow(row: DbLikeRow): Customer360OpportunityItem {
  return {
    opportunityId: asText(row.id) ?? asText(row.opportunity_key) ?? "",
    opportunityKey: asText(row.opportunity_key) ?? "",
    status: asText(row.status) ?? "unknown",
    stage: asText(row.stage),
    primaryIntent: asText(row.primary_intent) ?? "unknown",
    priority: asText(row.priority) ?? "unknown",
    temperature: asText(row.temperature) ?? "unknown",
    nextActionType: asText(row.next_action_type),
    nextActionDueAt: asIso(row.next_action_due_at),
    lastActivityAt: asIso(row.last_activity_at) ?? asIso(row.updated_at) ?? asIso(row.created_at),
    currentSummary: asText(row.current_summary),
    sourceRef: asText(row.conversation_case_id) ?? asText(row.wa_id)
  };
}

function mapProfileRow(row: DbLikeRow): Customer360ProfileItem {
  return {
    profileId: asText(row.id) ?? asText(row.profile_key) ?? "",
    profileKey: asText(row.profile_key) ?? "",
    opportunityKey: asText(row.opportunity_key) ?? "",
    useCase: asText(row.use_case),
    customerType: asText(row.customer_type),
    decisionReadiness: asText(row.decision_readiness),
    purchaseUrgency: asText(row.purchase_urgency),
    budgetMin: formatMoney(row.budget_min),
    budgetMax: formatMoney(row.budget_max),
    missingInformation: normalizeItems(asJsonArray(row.missing_information_json)),
    lastUpdatedAt: asIso(row.updated_at) ?? asIso(row.created_at),
    sourceRef: asText(row.source_message_id)
  };
}

function mapActionRow(row: DbLikeRow): Customer360ActionItem {
  return {
    actionId: asText(row.action_id) ?? asText(row.id) ?? "",
    actionType: asText(row.action_type) ?? "unknown",
    status: asText(row.status) ?? "unknown",
    riskLevel: asText(row.risk_level) ?? "unknown",
    approvalRequirement: asText(row.approval_requirement) ?? "unknown",
    scheduledFor: asIso(row.scheduled_for),
    expiresAt: asIso(row.expires_at),
    finalMessage: asText(row.final_message),
    draftMessage: asText(row.draft_message),
    sourceRef: asText(row.message_id) ?? asText(row.conversation_case_id)
  };
}

function mapOutcomeRow(row: DbLikeRow): Customer360OutcomeItem {
  return {
    outcomeId: asText(row.outcome_id) ?? asText(row.id) ?? "",
    actionId: asText(row.action_id) ?? "",
    outcomeType: asText(row.outcome_type) ?? "unknown",
    occurredAt: asIso(row.occurred_at) ?? asIso(row.recorded_at) ?? asIso(row.created_at) ?? new Date(0).toISOString(),
    recordedAt: asIso(row.recorded_at) ?? asIso(row.created_at),
    providerMessageId: asText(row.provider_message_id),
    sourceRef: asText(row.outbox_message_id)
  };
}

function mapQuoteRow(row: DbLikeRow): Customer360QuoteItem {
  const totals = asJsonObject<{ total?: unknown; currency?: unknown }>(row.totals_json);
  return {
    quoteId: asText(row.quote_id) ?? "",
    requestId: asText(row.request_id) ?? "",
    status: asText(row.status) ?? "unknown",
    version: asNumber(row.version) ?? 1,
    opportunityId: asText(row.opportunity_id),
    customerId: asText(row.customer_id),
    total: formatMoney(totals?.total ?? null),
    currency: asText(totals?.currency) ?? "CLP",
    createdAt: asIso(row.created_at) ?? new Date(0).toISOString(),
    sentAt: asIso(row.sent_at),
    decidedAt: asIso(row.decided_at),
    expiryAt: asIso(row.expiry_at),
    sourceRef: asText(row.created_by_action_id)
  };
}

function mapOrderRow(row: DbLikeRow): Customer360OrderItem {
  return {
    orderId: asText(row.id_order) ?? "",
    reference: asText(row.reference),
    status: asText(row.status),
    currentStateId: asText(row.current_state),
    stateName: asText(row.state_name),
    invoiceNumber: asText(row.invoice_number),
    totalPaid: formatMoney(row.total_paid),
    createdAt: asIso(row.date_add),
    sourceRef: asText(row.id_customer)
  };
}

function mapCommercialEventRow(row: DbLikeRow): Customer360CommercialEventItem {
  const payload = asJsonObject<Record<string, unknown>>(row.payload_json);
  const metadata = asJsonObject<Record<string, unknown>>(row.metadata_json);
  const summary = asText(payload?.summary) ?? asText(metadata?.summary) ?? asText(row.event_type) ?? "commercial_event";
  return {
    eventId: asText(row.id) ?? "",
    eventType: asText(row.event_type) ?? "unknown",
    source: asText(row.source) ?? "unknown",
    occurredAt: asIso(row.occurred_at) ?? asIso(row.received_at) ?? new Date(0).toISOString(),
    correlationId: asText(row.correlation_id) ?? "",
    conversationId: asText(row.conversation_id),
    opportunityId: asText(row.opportunity_id),
    sourceRef: asText(row.source_event_id),
    summary
  };
}

function buildCounts(input: {
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
}): Customer360SummaryCounts {
  return {
    conversations: input.conversations.total,
    messages: input.messages.total,
    opportunities: input.opportunities.total,
    profiles: input.profiles.total,
    actions: input.actions.total,
    outcomes: input.outcomes.total,
    quotes: input.quotes.total,
    orders: input.orders.total,
    addresses: input.addresses.total,
    commercialEvents: input.commercialEvents.total
  };
}

function computeCompleteness(input: {
  customerFound: boolean;
  sections: Array<{ name: string; state: Customer360SectionState }>;
}): Customer360Completeness {
  if (!input.customerFound) {
    return { state: "insufficient", score: 0, missing: ["customer"] };
  }

  const total = input.sections.length;
  const available = input.sections.filter((section) => section.state === "real" || section.state === "partial").length;
  const unavailable = input.sections.filter((section) => section.state === "unavailable" || section.state === "error");
  const score = Math.round((available / total) * 100);

  if (available === total) {
    return { state: "complete", score, missing: [] };
  }
  if (available === 0) {
    return { state: "minimal", score, missing: ["profile", ...unavailable.map((section) => section.name)] };
  }
  return {
    state: "partial",
    score,
    missing: unavailable.length > 0 ? unavailable.map((section) => section.name) : []
  };
}

function computeFreshness(input: { lastActivityAt: string | null; now: Date; source: string }): Customer360Freshness {
  if (!input.lastActivityAt) {
    return {
      source: input.source,
      lastActivityAt: null,
      lastRefreshedAt: input.now.toISOString(),
      state: "unknown"
    };
  }

  const ageMs = input.now.getTime() - Date.parse(input.lastActivityAt);
  return {
    source: input.source,
    lastActivityAt: input.lastActivityAt,
    lastRefreshedAt: input.now.toISOString(),
    state: Number.isFinite(ageMs) && ageMs <= 1000 * 60 * 60 * 24 * 7 ? "fresh" : "stale"
  };
}

function buildProfileSummary(input: {
  customerId: string;
  displayName: string;
  source: string;
  warnings: string[];
  linkedIdentitiesCount: number;
  counts: Customer360SummaryCounts;
  lastActivityAt: string | null;
}): Customer360ProfileSummary {
  return {
    source: input.source,
    state: input.warnings.length > 0 ? "partial" : "real",
    warnings: input.warnings,
    customerId: input.customerId,
    displayName: input.displayName,
    linkedIdentitiesCount: input.linkedIdentitiesCount,
    counts: input.counts,
    lastActivityAt: input.lastActivityAt
  };
}

export type LocalCustomerProfileAdapter = CustomerProfilePort;

export function createLocalCustomerProfileAdapter(): LocalCustomerProfileAdapter {
  return {
    async loadCustomerProfile(customerId: string): Promise<CustomerProfilePortResult> {
      const [customerResult, identityResult] = await Promise.all([loadCustomerRow(customerId), loadExternalIdentities(customerId)]);
      const warnings = [...customerResult.warnings, ...identityResult.warnings];
      if (!customerResult.row) {
        return {
          state: warnings.length > 0 ? "partial" : "unavailable",
          source: "local_native_mariadb",
          warnings: [...new Set([...warnings, "customer_not_found"])],
          profile: null
        };
      }

      const linkedIdentities: Customer360LinkedIdentity[] = identityResult.rows.map((row) => ({
        type: asText(row.identity_type) ?? "unknown",
        value: asText(row.external_id) ?? asText(row.normalized_value) ?? "unknown",
        source: asText(row.provider) ?? "unknown",
        verified: asBool(row.is_verified)
      }));

      const waIds = linkedIdentities.filter((identity) => identity.type === "wa_id").map((identity) => identity.value);
      const externalCustomerIds = linkedIdentities
        .filter((identity) => identity.type === "prestashop_customer_id")
        .map((identity) => identity.value);

      const [conversationResult, opportunityResult] = await Promise.all([loadConversationRows(customerId, waIds), loadOpportunityRows(customerId, waIds)]);
      const conversations = conversationResult.rows;
      const opportunitySection = mapSection<Customer360OpportunityItem>({
        source: "crm_opportunities",
        rows: opportunityResult.rows,
        warnings: opportunityResult.warnings,
        mapper: mapOpportunityRow
      });
      const opportunityKeys = opportunitySection.items.map((item) => item.opportunityKey).filter((value): value is string => Boolean(value));
      const opportunityIds = opportunitySection.items.map((item) => item.opportunityId).filter((value): value is string => Boolean(value));
      const conversationIds = conversations.map((row) => asText(row.id) ?? "").filter((value): value is string => Boolean(value));

      const [messageResult, profileRowsResult, actionResult, quoteResult, commercialEventResult, orderResult] = await Promise.all([
        loadConversationMessages(conversationIds),
        loadProfileRows(customerId, opportunityKeys, waIds),
        loadActionRows(opportunityIds, waIds),
        loadQuoteRows(customerId, opportunityIds),
        loadCommercialEventRows(customerId, conversationIds, opportunityIds),
        loadOrders(customerId, asText(customerResult.row.email), externalCustomerIds)
      ]);

      const conversationItems = mapSection<Customer360ConversationItem>({
        source: "conversation",
        rows: conversations,
        warnings: conversationResult.warnings,
        mapper: (row) => mapConversationRow(row, new Map())
      });
      const messageItems = mapSection<Customer360MessageItem>({
        source: "conversation_message",
        rows: messageResult.rows,
        warnings: messageResult.warnings,
        mapper: mapMessageRow
      });
      const messagesByConversationId = new Map<string, DbLikeRow[]>();
      for (const row of messageResult.rows) {
        const conversationId = asText(row.conversation_id) ?? "";
        if (!conversationId) continue;
        const bucket = messagesByConversationId.get(conversationId) ?? [];
        bucket.push(row);
        messagesByConversationId.set(conversationId, bucket);
      }
      conversationItems.items = conversations.map((row) => mapConversationRow(row, messagesByConversationId));
      conversationItems.total = conversations.length;
      conversationItems.lastUpdatedAt = summarizeLastActivity(...conversationItems.items.map((item) => item.lastMessageAt ?? item.lastInboundAt ?? item.lastOutboundAt));

      const profileItems = mapSection<Customer360ProfileItem>({
        source: "crm_sales_need_profiles",
        rows: profileRowsResult.rows,
        warnings: profileRowsResult.warnings,
        mapper: mapProfileRow
      });
      const actionItems = mapSection<Customer360ActionItem>({
        source: "crm_agent_actions",
        rows: actionResult.rows,
        warnings: actionResult.warnings,
        mapper: mapActionRow
      });
      const outcomeResult = await loadOutcomeRows({
        actionIds: actionItems.items.map((item) => item.actionId),
        actionRowIds: actionResult.rows.map((row) => asText(row.id) ?? "").filter((value): value is string => Boolean(value))
      });
      const outcomeItems = mapSection<Customer360OutcomeItem>({
        source: "crm_action_outcomes",
        rows: outcomeResult.rows,
        warnings: outcomeResult.warnings,
        mapper: mapOutcomeRow
      });
      const quoteItems = mapSection<Customer360QuoteItem>({
        source: "crm_quotes",
        rows: quoteResult.rows,
        warnings: quoteResult.warnings,
        mapper: mapQuoteRow
      });
      const orderItems = mapSection<Customer360OrderItem>({
        source: "ps_orders",
        rows: orderResult.rows,
        warnings: orderResult.warnings,
        mapper: mapOrderRow
      });
      const commercialEventItems = mapSection<Customer360CommercialEventItem>({
        source: "commercial_event",
        rows: commercialEventResult.rows,
        warnings: commercialEventResult.warnings,
        mapper: mapCommercialEventRow
      });

      const addresses = emptySection<Customer360AddressItem>("customer_addresses");
      const counts = buildCounts({
        conversations: conversationItems,
        messages: messageItems,
        opportunities: opportunitySection,
        profiles: profileItems,
        actions: actionItems,
        outcomes: outcomeItems,
        quotes: quoteItems,
        orders: orderItems,
        addresses,
        commercialEvents: commercialEventItems
      });
      const lastActivityAt = summarizeLastActivity(conversationItems.lastUpdatedAt, messageItems.lastUpdatedAt, opportunitySection.lastUpdatedAt, profileItems.lastUpdatedAt, actionItems.lastUpdatedAt, outcomeItems.lastUpdatedAt, quoteItems.lastUpdatedAt, orderItems.lastUpdatedAt, commercialEventItems.lastUpdatedAt);
      const completeness = computeCompleteness({
        customerFound: true,
        sections: [
          { name: "conversations", state: conversationItems.state },
          { name: "messages", state: messageItems.state },
          { name: "opportunities", state: opportunitySection.state },
          { name: "profiles", state: profileItems.state },
          { name: "actions", state: actionItems.state },
          { name: "outcomes", state: outcomeItems.state },
          { name: "quotes", state: quoteItems.state },
          { name: "orders", state: orderItems.state },
          { name: "commercialEvents", state: commercialEventItems.state }
        ]
      });
      const freshness = computeFreshness({ lastActivityAt, now: new Date(), source: "local_native_mariadb" });
      const displayName = `${asText(customerResult.row.firstname) ?? ""} ${asText(customerResult.row.lastname) ?? ""}`.trim() || asText(customerResult.row.email) || `Customer ${customerId}`;
      const identity = mapCustomerIdentity(customerResult.row, customerId, linkedIdentities);
      const summary = buildProfileSummary({
        customerId,
        displayName,
        source: "local_native_mariadb",
        warnings,
        linkedIdentitiesCount: linkedIdentities.length,
        counts,
        lastActivityAt
      });

      const profile: Customer360ProfileProjection = {
        identity,
        profile: summary,
        sections: {
          conversations: conversationItems,
          messages: messageItems,
          opportunities: opportunitySection,
          profiles: profileItems,
          actions: actionItems,
          outcomes: outcomeItems,
          quotes: quoteItems,
          orders: orderItems,
          commercialEvents: commercialEventItems
        },
        freshness,
        completeness,
        warnings
      };

      return {
        state: warnings.length > 0 ? "partial" : "real",
        source: "local_native_mariadb",
        warnings,
        profile
      };
    }
  };
}

export type LocalAddressBookAdapter = AddressBookPort;

export function createLocalAddressBookAdapter(): LocalAddressBookAdapter {
  return {
    async loadAddressBook(customerId: string): Promise<AddressBookPortResult> {
      const numericCustomerId = Number(customerId);
      if (!Number.isFinite(numericCustomerId)) {
        return {
          state: "error",
          source: "customer_addresses",
          warnings: ["invalid_customer_id"],
          addresses: null
        };
      }

      if (!(await hasTable("customer_addresses"))) {
        return {
          state: "unavailable",
          source: "customer_addresses",
          warnings: ["customer_addresses_unavailable"],
          addresses: null
        };
      }

      const result = await safeQueryRows<DbLikeRow>(
        `SELECT address_id, customer_id, created_by_action_id, address_label, recipient_name, recipient_phone, street_name, street_number, unit, commune, city, region, postal_code, delivery_notes, is_default, is_active, created_at, updated_at
           FROM customer_addresses
          WHERE customer_id = ?
          ORDER BY is_default DESC, updated_at DESC`,
        [numericCustomerId]
      );
      if (!result.ok) {
        return {
          state: "error",
          source: "customer_addresses",
          warnings: [result.error],
          addresses: null
        };
      }

      const addresses = result.rows.map((row) => mapAddressRow(row));
      const section: Customer360Section<Customer360AddressItem> = {
        state: "real",
        source: "customer_addresses",
        lastUpdatedAt: addresses.map((address) => address.updatedAt).sort().at(-1) ?? null,
        warnings: [],
        total: addresses.length,
        items: addresses.map((address) => ({
          ...address,
          confirmationState: "unknown" as const
        }))
      };

      return {
        state: "real",
        source: "customer_addresses",
        warnings: [],
        addresses: section
      };
    }
  };
}
