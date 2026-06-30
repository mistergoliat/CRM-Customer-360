import { createHash } from "node:crypto";
import type { PoolConnection, RowDataPacket } from "mysql2/promise";
import { auditLog } from "@/lib/audit";
import { queryRows, safeQueryRows, withTransaction } from "@/lib/db";
import { createMasterCustomer } from "@/lib/integrations/customer-master/customer-repository";
import { normalizeMasterCustomerEmail } from "@/lib/integrations/customer-master/mappers";
import { findDistinctCustomersByNormalizedValue, findExternalIdentityByNormalizedValue, findExternalIdentityByProviderExternalId, upsertExternalIdentity } from "@/lib/integrations/customer-external-identity";
import {
  loadCommercialEventByDedupeKey,
  normalizeMetaWhatsAppInboundCommercialEvent,
  normalizeMetaWhatsAppStatusCommercialEvent,
  recordCommercialEvent
} from "@/lib/brain/commercial/events";
import { normalizeWhatsAppRecipientDigits } from "@/lib/brain/messaging/whatsapp-transport/constants";
import { appendConversationMessage } from "@/lib/brain/local-ai-sdr/repository";
import { createPrestashopProductRepository, createSalesConsultativeOperationsRepository, runSalesConsultativeService } from "@/lib/brain/commercial/sales-consultative";
import { maybeRunCommercialAgentForInboundTurn } from "@/lib/brain/commercial/agent-runtime/wireToNativeInbound";
import type {
  SalesConsultativeCustomerContext,
  SalesConsultativeInteraction,
  SalesConsultativeOpportunity,
  SalesConsultativeStage,
  SalesConsultativeProductRepository,
  SalesNeedProfile
} from "@/lib/brain/commercial/sales-consultative/types";
import type { SalesConsultativeResult } from "@/lib/brain/commercial/sales-consultative/types";
import { isDbWriteEnabled } from "@/lib/write-access";
import { normalizePlatformOrigin } from "@/lib/domains/customers/platform-origin";

type NativeConversationRow = {
  id: number;
  public_id: string;
  channel: string;
  provider: string;
  channel_account_id: string;
  external_contact_id: string;
  external_thread_id: string | null;
  customer_id: number | null;
  status: string;
  owner_type: string;
  owner_id: string | null;
  ai_enabled: number | string;
  human_owner_active: number | string;
  last_message_at: string | null;
  last_inbound_at: string | null;
  last_outbound_at: string | null;
  created_at: string;
  updated_at: string;
};

type NativeConversationMessageRow = {
  id: number;
  public_id: string;
  conversation_id: number;
  provider: string;
  provider_message_id: string | null;
  direction: string;
  sender_type: string;
  message_type: string;
  body: string | null;
  status: string | null;
  provider_timestamp: string | null;
  created_at: string;
  updated_at: string;
};

type NativeOpportunityRow = {
  id: number;
  opportunity_key: string;
  customer_candidate_id: string | null;
  customer_master_id: string | null;
  lead_id: string | null;
  conversation_case_id: string | null;
  wa_id: string | null;
  channel: string;
  primary_intent: string;
  status: string;
  stage: string | null;
  temperature: string;
  priority: string;
  current_summary: string | null;
  requirements_json: unknown;
  missing_requirements_json: unknown;
  product_interests_json: unknown;
  objections_json: unknown;
  signals_json: unknown;
  last_customer_message_id: string | null;
  last_agent_decision_id: string | null;
  waiting_for: string | null;
  next_action_type: string | null;
  next_action_due_at: string | null;
  human_owner_active: number | string;
  ai_blocked: number | string;
  version: number | string;
  created_at: string;
  updated_at: string;
  last_activity_at: string;
  closed_at: string | null;
};

type NativeProfileRow = {
  id: number;
  profile_key: string;
  opportunity_id: number | null;
  opportunity_key: string;
  conversation_case_id: string | null;
  wa_id: string | null;
  customer_master_id: string | null;
  customer_candidate_id: string | null;
  lead_id: string | null;
  use_case: string | null;
  customer_type: string | null;
  goals_json: unknown;
  required_features_json: unknown;
  preferred_features_json: unknown;
  budget_min: string | number | null;
  budget_max: string | number | null;
  available_space_json: unknown;
  location_json: unknown;
  delivery_deadline: string | null;
  experience_level: string | null;
  purchase_urgency: string | null;
  decision_readiness: string | null;
  missing_information_json: unknown;
  source_message_id: string | null;
  last_message_text: string | null;
  profile_json: unknown;
  profile_version: number | string;
  created_at: string;
  updated_at: string;
};

type NativeDecisionRow = {
  id: number;
  decision_id: string;
  opportunity_id: number;
  correlation_id: string;
  process_inbound_run_id: string | null;
  sales_agent_run_id: string | null;
  message_id: string | null;
  previous_status: string | null;
  next_status: string;
  previous_stage: string | null;
  next_stage: string | null;
  detected_signals_json: unknown;
  state_changes_json: unknown;
  missing_information_json: unknown;
  next_action_json: unknown;
  policy_status: string;
  risk_level: string;
  approval_requirement: string;
  decision_status: string;
  rationale: string;
  warnings_json: unknown;
  contract_version: string | null;
  policy_version: string | null;
  runtime_version: string | null;
  created_at: string;
};

type NativeActionRow = {
  id: number;
  action_id: string;
  idempotency_key: string;
  opportunity_id: number | null;
  decision_id: string | null;
  decision_row_id: number | null;
  conversation_case_id: number | null;
  message_id: string | null;
  wa_id: string | null;
  channel: string;
  action_type: string;
  status: string;
  scheduled_for: string | null;
  final_message: string | null;
  draft_message: string | null;
  created_at: string;
  updated_at: string;
};

export type NativeWhatsAppProcessDependencies = {
  productRepository?: SalesConsultativeProductRepository;
  commercialEventRecorder?: typeof recordCommercialEvent;
};

type NativeCustomerRow = {
  id: number;
  firstname: string;
  lastname: string;
  email: string;
  platform_origin: string | null;
};

function nowIso() {
  return new Date().toISOString();
}

function toMysqlDateTime(value: string | Date) {
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? new Date().toISOString().slice(0, 23).replace("T", " ") : date.toISOString().slice(0, 23).replace("T", " ");
}

function asText(value: unknown) {
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
  }
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  if (typeof value === "bigint") return value.toString();
  return null;
}

function asNumber(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value.trim());
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function parseJsonArray(value: unknown): unknown[] {
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

function parseJsonObject(value: unknown): Record<string, unknown> | null {
  if (value && typeof value === "object" && !Array.isArray(value)) return value as Record<string, unknown>;
  if (typeof value === "string" && value.trim()) {
    try {
      const parsed = JSON.parse(value);
      return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : null;
    } catch {
      return null;
    }
  }
  return null;
}

function shouldProjectDeliveryStatus(currentStatus: string | null, nextStatus: "sent" | "delivered" | "read" | "failed") {
  const current = currentStatus?.toLowerCase().trim() ?? null;
  if (!current) return true;
  if (current === nextStatus) return false;
  if (current === "read") return false;
  if (current === "delivered") return nextStatus === "read";
  if (current === "sent") return nextStatus === "delivered" || nextStatus === "read" || nextStatus === "failed";
  if (current === "failed") return false;
  return true;
}

function stableId(parts: string[]) {
  return createHash("sha256").update(parts.join("|")).digest("hex").slice(0, 24);
}

function buildProvisionalCustomerNames(senderName: string | null, externalId: string) {
  const cleaned = senderName?.trim() ?? "";
  if (cleaned) {
    const tokens = cleaned.split(/\s+/).filter(Boolean);
    if (tokens.length >= 2) {
      return { firstname: tokens[0].slice(0, 191), lastname: tokens.slice(1).join(" ").slice(0, 191) };
    }
    return { firstname: cleaned.slice(0, 191), lastname: "WhatsApp" };
  }
  const suffix = externalId.slice(-6) || "nuevo";
  return { firstname: "Cliente", lastname: `WhatsApp ${suffix}`.slice(0, 191) };
}

async function loadCustomerById(customerId: number | null): Promise<NativeCustomerRow | null> {
  if (!customerId) return null;
  const result = await safeQueryRows<NativeCustomerRow>("SELECT id, firstname, lastname, email, platform_origin FROM master_customer WHERE id = ? LIMIT 1", [customerId]);
  if (!result.ok) return null;
  return result.rows[0] ?? null;
}

type NativeIdentityConflict = {
  type: "divergent_identity_links" | "customer_conversation_mismatch";
  provider: string;
  normalizedValue: string;
  candidateCustomerIds: number[];
  detectedAt: string;
};

async function resolveOrCreateNativeCustomer(input: {
  provider: string;
  identityType: string;
  externalId: string;
  normalizedValue: string;
  senderName: string | null;
}) {
  const existingIdentity = await findExternalIdentityByProviderExternalId(input.provider, input.externalId);
  if (existingIdentity.ok && existingIdentity.row) {
    const customer = await loadCustomerById(existingIdentity.row.customer_id);
    return {
      customer,
      externalIdentityId: existingIdentity.row.id,
      warnings: [] as string[],
      created: false,
      identityConflict: null as NativeIdentityConflict | null
    };
  }

  const distinctCustomers = await findDistinctCustomersByNormalizedValue(input.provider, input.normalizedValue);
  if (distinctCustomers.ok && distinctCustomers.customerIds.length > 1) {
    // PR-03A: do not silently pick a winner when the same normalized identity
    // (e.g. phone number) is already linked to more than one distinct customer.
    return {
      customer: null,
      externalIdentityId: null,
      warnings: ["identity_conflict_divergent_customers"] as string[],
      created: false,
      identityConflict: {
        type: "divergent_identity_links",
        provider: input.provider,
        normalizedValue: input.normalizedValue,
        candidateCustomerIds: distinctCustomers.customerIds,
        detectedAt: nowIso()
      } as NativeIdentityConflict | null
    };
  }

  const normalizedLookup = await findExternalIdentityByNormalizedValue(input.provider, input.normalizedValue);
  if (normalizedLookup.ok && normalizedLookup.row) {
    const customer = await loadCustomerById(normalizedLookup.row.customer_id);
    if (customer) {
      const identity = await upsertExternalIdentity({
        customerId: customer.id,
        provider: input.provider,
        identityType: input.identityType,
        externalId: input.externalId,
        normalizedValue: input.normalizedValue,
        isVerified: false
      });
      return {
        customer,
        externalIdentityId: identity.ok && identity.row ? identity.row.id : normalizedLookup.row.id,
        warnings: identity.ok ? [] : [identity.error ?? "external_identity_upsert_failed"],
        created: false,
        identityConflict: null as NativeIdentityConflict | null
      };
    }
  }

  const { firstname, lastname } = buildProvisionalCustomerNames(input.senderName, input.externalId);
  const email = normalizeMasterCustomerEmail(`wa-${input.normalizedValue}@local.invalid`);
  const customerResult = await createMasterCustomer({
    firstname,
    lastname,
    email,
    platformOrigin: normalizePlatformOrigin("whatsapp")
  });
  if (!customerResult.ok) {
    throw new Error(customerResult.error);
  }

  const identity = await upsertExternalIdentity({
    customerId: Number(customerResult.data.id),
    provider: input.provider,
    identityType: input.identityType,
    externalId: input.externalId,
    normalizedValue: input.normalizedValue,
    isVerified: false
  });

  return {
    customer: {
      id: Number(customerResult.data.id),
      firstname: customerResult.data.firstname,
      lastname: customerResult.data.lastname,
      email: customerResult.data.email,
      platform_origin: customerResult.data.platform_origin
    },
    externalIdentityId: identity.ok && identity.row ? identity.row.id : null,
    warnings: identity.ok ? [] : [identity.error ?? "external_identity_upsert_failed"],
    created: true,
    identityConflict: null as NativeIdentityConflict | null
  };
}

async function createOrUpdateNativeConversation(input: {
  customerId: number | null;
  phoneNumberId: string;
  externalContactId: string;
  externalThreadId: string | null;
  occurredAt: string;
  aiEnabled?: boolean;
  humanOwnerActive?: boolean;
}, connection?: PoolConnection) {
  const publicId = `conv-${stableId([input.phoneNumberId, input.externalContactId])}`;
  const now = toMysqlDateTime(input.occurredAt);
  const params = [
    publicId,
    "whatsapp",
    "meta",
    input.phoneNumberId,
    input.externalContactId,
    input.externalThreadId ?? input.externalContactId,
    input.customerId,
    "open",
    "ai_sdr",
    "native_whatsapp",
    input.aiEnabled === false ? 0 : 1,
    input.humanOwnerActive ? 1 : 0,
    null,
    null,
    null,
    now,
    now
  ];
  const sql = `
      INSERT INTO conversation (
        public_id,
        channel,
        provider,
        channel_account_id,
        external_contact_id,
        external_thread_id,
        customer_id,
        status,
        owner_type,
        owner_id,
        ai_enabled,
        human_owner_active,
        last_message_at,
        last_inbound_at,
        last_outbound_at,
        created_at,
        updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON DUPLICATE KEY UPDATE
        customer_id = COALESCE(VALUES(customer_id), customer_id),
        external_thread_id = COALESCE(VALUES(external_thread_id), external_thread_id),
        ai_enabled = VALUES(ai_enabled),
        human_owner_active = VALUES(human_owner_active),
        updated_at = VALUES(updated_at)
    `;
  if (connection) {
    await connection.execute(sql, params);
  } else {
    await queryRows(sql, params);
  }

  let row: NativeConversationRow | null = null;
  if (connection) {
    const [rows] = await connection.execute<RowDataPacket[]>(
      "SELECT * FROM conversation WHERE public_id = ? LIMIT 1",
      [publicId]
    );
    row = (rows[0] as NativeConversationRow | undefined) ?? null;
  } else {
    const rowResult = await safeQueryRows<NativeConversationRow>("SELECT * FROM conversation WHERE public_id = ? LIMIT 1", [publicId]);
    if (!rowResult.ok) {
      throw new Error(rowResult.error);
    }
    row = rowResult.rows[0] ?? null;
  }
  if (!row) {
    throw new Error("conversation_not_found");
  }
  return row;
}

async function touchConversationAfterInbound(conversationId: number, occurredAt: string, customerId: number | null, connection?: PoolConnection) {
  const sql = `
      UPDATE conversation
      SET
        customer_id = COALESCE(?, customer_id),
        last_message_at = ?,
        last_inbound_at = ?,
        updated_at = ?
      WHERE id = ?
    `;
  const params = [
    customerId,
    toMysqlDateTime(occurredAt),
    toMysqlDateTime(occurredAt),
    toMysqlDateTime(occurredAt),
    conversationId
  ];
  if (connection) {
    await connection.execute(sql, params);
    return;
  }
  await queryRows(sql, params);
}

async function touchConversationAfterOutbound(conversationId: number, occurredAt: string, aiEnabled?: boolean, humanOwnerActive?: boolean) {
  await queryRows(
    `
      UPDATE conversation
      SET
        ai_enabled = COALESCE(?, ai_enabled),
        human_owner_active = COALESCE(?, human_owner_active),
        last_message_at = ?,
        last_outbound_at = ?,
        updated_at = ?
      WHERE id = ?
    `,
    [
      aiEnabled === undefined ? null : aiEnabled ? 1 : 0,
      humanOwnerActive === undefined ? null : humanOwnerActive ? 1 : 0,
      toMysqlDateTime(occurredAt),
      toMysqlDateTime(occurredAt),
      toMysqlDateTime(occurredAt),
      conversationId
    ]
  );
}

async function loadConversationByPublicId(publicId: string) {
  const result = await safeQueryRows<NativeConversationRow>("SELECT * FROM conversation WHERE public_id = ? LIMIT 1", [publicId]);
  if (!result.ok) return null;
  return result.rows[0] ?? null;
}

async function loadConversationById(conversationId: number) {
  const result = await safeQueryRows<NativeConversationRow>("SELECT * FROM conversation WHERE id = ? LIMIT 1", [conversationId]);
  if (!result.ok) return null;
  return result.rows[0] ?? null;
}

async function loadConversationMessageByProviderMessageId(provider: string, providerMessageId: string) {
  const result = await safeQueryRows<NativeConversationMessageRow>(
    "SELECT * FROM conversation_message WHERE provider = ? AND provider_message_id = ? LIMIT 1",
    [provider, providerMessageId]
  );
  if (!result.ok) return null;
  return result.rows[0] ?? null;
}

async function loadConversationMessageById(messageId: number) {
  const result = await safeQueryRows<NativeConversationMessageRow>("SELECT * FROM conversation_message WHERE id = ? LIMIT 1", [messageId]);
  if (!result.ok) return null;
  return result.rows[0] ?? null;
}

async function loadOutboxByProviderMessageId(providerMessageId: string) {
  const result = await safeQueryRows<Record<string, unknown>>(
    "SELECT provider_status FROM brain_message_outbox WHERE provider_message_id = ? LIMIT 1",
    [providerMessageId]
  );
  if (!result.ok) return null;
  return result.rows[0] ?? null;
}

async function loadActiveOpportunity(conversationCaseId: string) {
  const result = await safeQueryRows<NativeOpportunityRow>(
    `
      SELECT *
      FROM crm_opportunities
      WHERE conversation_case_id = ?
      ORDER BY updated_at DESC, id DESC
      LIMIT 1
    `,
    [conversationCaseId]
  );
  if (!result.ok) return null;
  return result.rows[0] ?? null;
}

async function loadActiveProfile(conversationCaseId: string, opportunityId: number | null) {
  const queries: Array<{ sql: string; params: Array<string | number> }> = [];
  queries.push({ sql: "SELECT * FROM crm_sales_need_profiles WHERE conversation_case_id = ? ORDER BY updated_at DESC, id DESC LIMIT 1", params: [conversationCaseId] });
  if (opportunityId) {
    queries.push({ sql: "SELECT * FROM crm_sales_need_profiles WHERE opportunity_id = ? ORDER BY updated_at DESC, id DESC LIMIT 1", params: [opportunityId] });
  }
  for (const query of queries) {
    const result = await safeQueryRows<NativeProfileRow>(query.sql, query.params);
    if (result.ok && result.rows[0]) return result.rows[0];
  }
  return null;
}

async function loadLatestDecision(opportunityId: number | null) {
  if (!opportunityId) return null;
  const result = await safeQueryRows<NativeDecisionRow>(
    "SELECT * FROM crm_agent_decisions WHERE opportunity_id = ? ORDER BY created_at DESC, id DESC LIMIT 1",
    [opportunityId]
  );
  if (!result.ok) return null;
  return result.rows[0] ?? null;
}

async function loadRecentActions(opportunityId: number | null) {
  if (!opportunityId) return [];
  const result = await safeQueryRows<NativeActionRow>(
    `
      SELECT id, action_id, idempotency_key, opportunity_id, decision_id, decision_row_id, conversation_case_id, message_id, wa_id, channel, action_type, status, scheduled_for, final_message, draft_message, created_at, updated_at
      FROM crm_agent_actions
      WHERE opportunity_id = ?
      ORDER BY created_at DESC, id DESC
      LIMIT 10
    `,
    [opportunityId]
  );
  if (!result.ok) return [];
  return result.rows;
}

function mapOpportunityRow(row: NativeOpportunityRow | null): SalesConsultativeOpportunity | null {
  if (!row) return null;
  return {
    id: row.id,
    opportunityKey: row.opportunity_key,
    status: row.status,
    stage: row.stage,
    primaryIntent: row.primary_intent,
    currentSummary: row.current_summary,
    nextActionType: row.next_action_type,
    nextActionDueAt: row.next_action_due_at,
    waitingFor: row.waiting_for,
    humanOwnerActive: Boolean(asNumber(row.human_owner_active)),
    aiBlocked: Boolean(asNumber(row.ai_blocked)),
    customerCandidateId: row.customer_candidate_id,
    customerMasterId: row.customer_master_id,
    leadId: row.lead_id,
    conversationCaseId: row.conversation_case_id,
    waId: row.wa_id,
    requirements: parseJsonArray(row.requirements_json),
    missingRequirements: parseJsonArray(row.missing_requirements_json),
    productInterests: parseJsonArray(row.product_interests_json),
    objections: parseJsonArray(row.objections_json) as SalesConsultativeResult["objections"],
    signals: parseJsonArray(row.signals_json).map((item) => (typeof item === "string" ? item : "")).filter(Boolean),
    version: Number(row.version ?? 1),
    lastActivityAt: row.last_activity_at,
    closedAt: row.closed_at
  };
}

function mapProfileRow(row: NativeProfileRow | null): SalesNeedProfile | null {
  if (!row) return null;
  const profile = parseJsonObject(row.profile_json);
  return {
    useCase: row.use_case ?? (typeof profile?.useCase === "string" ? profile.useCase : null),
    customerType: row.customer_type ?? (typeof profile?.customerType === "string" ? profile.customerType : null),
    goals: parseJsonArray(row.goals_json).map((item) => (typeof item === "string" ? item : "")).filter(Boolean),
    requiredFeatures: parseJsonArray(row.required_features_json).map((item) => (typeof item === "string" ? item : "")).filter(Boolean),
    preferredFeatures: parseJsonArray(row.preferred_features_json).map((item) => (typeof item === "string" ? item : "")).filter(Boolean),
    budgetMin: row.budget_min === null ? null : Number(row.budget_min),
    budgetMax: row.budget_max === null ? null : Number(row.budget_max),
    availableSpace: parseJsonObject(row.available_space_json) as SalesNeedProfile["availableSpace"],
    location: parseJsonObject(row.location_json) as SalesNeedProfile["location"],
    deliveryDeadline: row.delivery_deadline,
    experienceLevel: row.experience_level,
    purchaseUrgency: row.purchase_urgency,
    decisionReadiness: row.decision_readiness,
    missingInformation: parseJsonArray(row.missing_information_json).map((item) => (typeof item === "string" ? item : "")).filter(Boolean),
    lastUpdatedAt: row.updated_at
  };
}

async function persistConsultativeDecision(input: {
  conversation: NativeConversationRow;
  messageId: number;
  opportunity: SalesConsultativeOpportunity | null;
  result: SalesConsultativeResult;
  correlationId: string;
  currentTime: string;
}) {
  if (!input.opportunity?.id) {
    return { ok: false as const, decisionId: null as string | null, warning: "missing_opportunity" };
  }

  const decisionId = `decision-${stableId([
    input.conversation.public_id,
    String(input.messageId),
    input.result.nextBestAction,
    input.result.stage
  ])}`;
  const nextStatus = input.result.opportunityStatus;
  const nextStage = input.result.opportunityStage;
  const warnings = input.result.warnings ?? [];
  const detectedSignals = {
    stage: input.result.stage,
    nextBestAction: input.result.nextBestAction,
    responseText: input.result.responseText,
    warnings
  };
  const stateChanges = {
    opportunityStatus: nextStatus,
    opportunityStage: nextStage,
    nextAction: input.result.action,
    followUp: input.result.followUp
  };

  await queryRows(
    `
      INSERT INTO crm_agent_decisions (
        decision_id,
        opportunity_id,
        correlation_id,
        process_inbound_run_id,
        sales_agent_run_id,
        message_id,
        previous_status,
        next_status,
        previous_stage,
        next_stage,
        detected_signals_json,
        state_changes_json,
        missing_information_json,
        next_action_json,
        policy_status,
        risk_level,
        approval_requirement,
        decision_status,
        rationale,
        warnings_json,
        contract_version,
        policy_version,
        runtime_version,
        created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())
      ON DUPLICATE KEY UPDATE
        opportunity_id = VALUES(opportunity_id),
        correlation_id = VALUES(correlation_id),
        process_inbound_run_id = VALUES(process_inbound_run_id),
        sales_agent_run_id = VALUES(sales_agent_run_id),
        message_id = VALUES(message_id),
        previous_status = VALUES(previous_status),
        next_status = VALUES(next_status),
        previous_stage = VALUES(previous_stage),
        next_stage = VALUES(next_stage),
        detected_signals_json = VALUES(detected_signals_json),
        state_changes_json = VALUES(state_changes_json),
        missing_information_json = VALUES(missing_information_json),
        next_action_json = VALUES(next_action_json),
        policy_status = VALUES(policy_status),
        risk_level = VALUES(risk_level),
        approval_requirement = VALUES(approval_requirement),
        decision_status = VALUES(decision_status),
        rationale = VALUES(rationale),
        warnings_json = VALUES(warnings_json),
        contract_version = VALUES(contract_version),
        policy_version = VALUES(policy_version),
        runtime_version = VALUES(runtime_version)
    `,
    [
      decisionId,
      input.opportunity.id,
      input.correlationId,
      input.correlationId,
      null,
      String(input.messageId),
      input.opportunity.status,
      nextStatus,
      input.opportunity.stage,
      nextStage,
      JSON.stringify(detectedSignals),
      JSON.stringify(stateChanges),
      JSON.stringify(input.result.recommendation.missingInformation),
      JSON.stringify(input.result.action),
      "allowed",
      input.result.action?.requiresHuman ? "medium" : "low",
      input.result.action?.requiresHuman ? "operator_review" : "none",
      "applied",
      input.result.responseText,
      JSON.stringify(warnings),
      "brain.commercial.sales-consultative.v1",
      "brain.commercial.policy.v1",
      "brain.commercial.sales-consultative.v1"
    ]
  );

  return { ok: true as const, decisionId, warning: null };
}

async function updateOpportunityHandoffState(conversationId: number, result: SalesConsultativeResult) {
  if (result.action?.type !== "handoff_to_human") return;
  await queryRows(
    "UPDATE conversation SET ai_enabled = 0, human_owner_active = 1, updated_at = NOW(3) WHERE id = ?",
    [conversationId]
  );
}

function wrapOperationsRepository(input: { blockedByConversationState: boolean }) {
  const base = createSalesConsultativeOperationsRepository();
  return {
    ...base,
    async queueCustomerMessage(queueInput: Parameters<typeof base.queueCustomerMessage>[0]) {
      if (input.blockedByConversationState) {
        return { ok: true, queued: false, outboxId: null, warning: "conversation_ai_disabled_or_handoff_active" };
      }
      return base.queueCustomerMessage(queueInput);
    }
  };
}

async function buildRecentInteractions(conversationId: number): Promise<SalesConsultativeInteraction[]> {
  const result = await safeQueryRows<Record<string, unknown>>(
    `
      SELECT id, direction, body, provider_timestamp, provider, created_at
      FROM conversation_message
      WHERE conversation_id = ?
      ORDER BY created_at DESC, id DESC
      LIMIT 12
    `,
    [conversationId]
  );
  if (!result.ok) return [];
  return result.rows.map((row) => ({
    id: asNumber(row.id) ?? asText(row.id),
    direction: (typeof row.direction === "string" ? row.direction : "unknown") as SalesConsultativeInteraction["direction"],
    text: asText(row.body),
    occurredAt: asText(row.provider_timestamp ?? row.created_at),
    source: asText(row.provider)
  }));
}

export async function processSalesInbound(input: {
  conversationId: number;
  messageId: number;
  correlationId: string;
}, dependencies: NativeWhatsAppProcessDependencies = {}) {
  const conversation = await loadConversationById(input.conversationId);
  if (!conversation) {
    throw new Error("conversation_not_found");
  }

  const customer = await loadCustomerById(conversation.customer_id);
  const opportunityRow = await loadActiveOpportunity(String(conversation.id));
  const opportunity = mapOpportunityRow(opportunityRow);
  const profile = mapProfileRow(await loadActiveProfile(String(conversation.id), opportunity?.id ? Number(opportunity.id) : null));
  const recentInteractions = await buildRecentInteractions(conversation.id);
  const aiBlocked = !Boolean(asNumber(conversation.ai_enabled)) || Boolean(asNumber(conversation.human_owner_active));
  const customerContext: SalesConsultativeCustomerContext = {
    waId: conversation.external_contact_id,
    phoneNumberId: conversation.channel_account_id,
    email: customer?.email ?? null,
    phone: conversation.external_contact_id,
    idCustomer: customer?.id ?? null,
    idOrder: null,
    invoiceNumber: null,
    contactId: conversation.external_contact_id
  };

  const inboundMessage = await loadConversationMessageById(input.messageId);
  const consultativeResult = await runSalesConsultativeService(
    {
      currentTime: nowIso(),
      messageText: inboundMessage?.body ?? recentInteractions.find((message) => message.id === input.messageId)?.text ?? "",
      customerContext,
      opportunity,
      existingProfile: profile,
      recentInteractions,
      productRepository: dependencies.productRepository ?? createPrestashopProductRepository(),
      operationsRepository: wrapOperationsRepository({ blockedByConversationState: aiBlocked }),
      currentStageHint: (opportunity?.stage as SalesConsultativeStage | null) ?? null,
      metadata: {
        conversationId: conversation.id,
        conversationPublicId: conversation.public_id,
        messageId: input.messageId,
        correlationId: input.correlationId,
        aiBlocked
      }
    },
    { requestId: input.correlationId }
  );

  const persistedOpportunity = mapOpportunityRow(await loadActiveOpportunity(String(conversation.id))) ?? opportunity;
  const decision = await persistConsultativeDecision({
    conversation,
    messageId: input.messageId,
    opportunity: persistedOpportunity,
    result: consultativeResult.result,
    correlationId: input.correlationId,
    currentTime: nowIso()
  });

  await updateOpportunityHandoffState(conversation.id, consultativeResult.result);

  return {
    result: consultativeResult.result,
    dispatchResult: consultativeResult.dispatchResult,
    dispatchWarnings: consultativeResult.dispatchWarnings,
    decision,
    blockedByConversationState: aiBlocked
  };
}

export async function processNativeWhatsAppInbound(input: {
  providerMessageId: string;
  phoneNumberId: string;
  externalSenderId: string;
  senderPhone: string | null;
  senderName: string | null;
  messageType: string;
  text: string;
  occurredAt: string;
  rawPayload: unknown;
}, dependencies: NativeWhatsAppProcessDependencies = {}) {
  if (!isDbWriteEnabled()) {
    throw new Error("DB_WRITE_DISABLED");
  }

  const safeExternalId = input.externalSenderId.trim() || stableId([input.providerMessageId, input.phoneNumberId, input.senderPhone ?? "external"]);
  const normalizedSenderPhone = normalizeWhatsAppRecipientDigits(input.senderPhone) ?? normalizeWhatsAppRecipientDigits(input.externalSenderId) ?? safeExternalId;
  const normalizedExternalId = normalizeWhatsAppRecipientDigits(input.externalSenderId) ?? normalizedSenderPhone;
  const correlationId = `native-whatsapp:${stableId([input.providerMessageId, input.phoneNumberId, normalizedExternalId])}`;
  const dedupeKey = `meta:whatsapp:inbound:${input.providerMessageId.trim()}`;

  const duplicate = await loadConversationMessageByProviderMessageId("meta", input.providerMessageId);
  if (duplicate) {
    const conversation = await loadConversationById(duplicate.conversation_id);
    const commercialEvent = await loadCommercialEventByDedupeKey(dedupeKey);
    return {
      duplicate: true,
      correlationId,
      customerId: conversation?.customer_id ?? null,
      externalIdentityId: null,
      conversationId: duplicate.conversation_id,
      conversationPublicId: conversation?.public_id ?? null,
      messageId: duplicate.id,
      messagePublicId: duplicate.public_id,
      commercialEvent,
      commercialEventStatus: commercialEvent ? "duplicate" : "missing"
    };
  }

  const identity = await resolveOrCreateNativeCustomer({
    provider: "whatsapp",
    identityType: "phone_number",
    externalId: normalizedExternalId,
    normalizedValue: normalizedSenderPhone,
    senderName: input.senderName
  });

  // PR-03A: if this conversation already has a confirmed customer link, never
  // let a fresh resolution silently swap it. Detect the mismatch, keep the
  // existing link (createOrUpdateNativeConversation's COALESCE preserves it
  // when customerId is null here), and surface it instead of guessing.
  const existingConversationPublicId = `conv-${stableId([input.phoneNumberId, normalizedExternalId])}`;
  const existingConversation = await loadConversationByPublicId(existingConversationPublicId);
  let resolvedCustomer = identity.customer;
  let identityConflict = identity.identityConflict;
  const identityWarnings = [...identity.warnings];
  if (
    existingConversation?.customer_id &&
    resolvedCustomer &&
    Number(existingConversation.customer_id) !== Number(resolvedCustomer.id)
  ) {
    identityConflict = {
      type: "customer_conversation_mismatch",
      provider: "whatsapp",
      normalizedValue: normalizedSenderPhone,
      candidateCustomerIds: [Number(existingConversation.customer_id), Number(resolvedCustomer.id)],
      detectedAt: nowIso()
    };
    identityWarnings.push("identity_conflict_customer_conversation_mismatch");
    resolvedCustomer = null;
  }

  const result = await withTransaction(async (connection) => {
    const conversation = await createOrUpdateNativeConversation(
      {
        customerId: resolvedCustomer ? Number(resolvedCustomer.id) : null,
        phoneNumberId: input.phoneNumberId,
        externalContactId: normalizedExternalId,
        externalThreadId: normalizedExternalId,
        occurredAt: input.occurredAt,
        aiEnabled: true,
        humanOwnerActive: false
      },
      connection
    );

    const appendResult = await appendConversationMessage(
      {
        conversationPublicId: conversation.public_id,
        provider: "meta",
        providerMessageId: input.providerMessageId,
        direction: "inbound",
        senderType: "customer",
        messageType: input.messageType || "text",
        body: input.text,
        status: "received",
        occurredAt: input.occurredAt
      },
      connection
    );
    if (!appendResult.ok) {
      throw new Error(appendResult.error);
    }

    const commercialEvent = normalizeMetaWhatsAppInboundCommercialEvent({
      providerMessageId: input.providerMessageId,
      phoneNumberId: input.phoneNumberId,
      externalSenderId: normalizedExternalId,
      senderPhone: normalizedSenderPhone,
      senderName: input.senderName,
      messageType: input.messageType || "text",
      text: input.text,
      occurredAt: input.occurredAt,
      receivedAt: nowIso(),
      customerId: resolvedCustomer ? Number(resolvedCustomer.id) : null,
      conversationId: conversation.id,
      opportunityId: null,
      messageId: appendResult.messageId,
      correlationId,
      causationId: null,
      metadata: {
        conversationPublicId: conversation.public_id,
        customerCreated: identity.created,
        externalIdentityId: identity.externalIdentityId,
        senderName: input.senderName,
        senderPhone: normalizedSenderPhone,
        identityConflict
      }
    });

    const commercialEventResult = await (dependencies.commercialEventRecorder ?? recordCommercialEvent)(commercialEvent, connection);
    if (!commercialEventResult.ok) {
      throw new Error(commercialEventResult.warning);
    }

    await touchConversationAfterInbound(
      conversation.id,
      input.occurredAt,
      resolvedCustomer ? Number(resolvedCustomer.id) : conversation.customer_id,
      connection
    );

    return {
      duplicate: false as const,
      correlationId,
      customerId: resolvedCustomer ? Number(resolvedCustomer.id) : null,
      customer: resolvedCustomer,
      externalIdentityId: identity.externalIdentityId,
      conversationId: conversation.id,
      conversationPublicId: conversation.public_id,
      messageId: appendResult.messageId,
      messagePublicId: appendResult.messagePublicId,
      commercialEvent: commercialEventResult.event,
      commercialEventStatus: commercialEventResult.status,
      identityWarnings,
      identityConflict
    };
  });

  await auditLog({
    action: identityConflict ? "customer.identity_conflict" : identity.created ? "customer.created" : "customer.linked",
    entityType: "conversation",
    entityId: result.conversationId,
    after: {
      providerMessageId: input.providerMessageId,
      correlationId: result.correlationId,
      customerId: result.customerId,
      externalIdentityId: result.externalIdentityId,
      messageId: result.messageId,
      messagePublicId: result.messagePublicId,
      commercialEventId: result.commercialEvent?.id ?? null,
      commercialEventStatus: result.commercialEventStatus,
      identityWarnings: result.identityWarnings,
      identityConflict: result.identityConflict
    }
  });

  if (process.env.BRAIN_COMMERCIAL_AGENT_ENABLED?.trim().toLowerCase() === "true") {
    try {
      await maybeRunCommercialAgentForInboundTurn({
        conversationId: result.conversationId,
        conversationPublicId: result.conversationPublicId as string,
        customerMasterId: result.customerId,
        waId: normalizedExternalId,
        messageText: input.text,
        messageId: result.messageId,
        correlationId: result.correlationId,
        currentTime: nowIso()
      });
    } catch (error) {
      console.error("commercial_agent_turn_failed", error instanceof Error ? error.message : String(error));
    }
  }

  return result;
}

export async function applyMetaDeliveryStatus(input: {
  providerMessageId: string;
  status: "sent" | "delivered" | "read" | "failed";
  occurredAt: string;
  rawPayload: unknown;
}) {
  const message = await loadConversationMessageByProviderMessageId("meta", input.providerMessageId);
  if (!message) {
    return { ok: false as const, warning: "message_not_found" };
  }

  const conversation = await loadConversationById(message.conversation_id);
  if (!conversation) {
    return { ok: false as const, warning: "conversation_not_found" };
  }

  if (shouldProjectDeliveryStatus(message.status, input.status)) {
    await queryRows(
      `
        UPDATE conversation_message
        SET status = ?, metadata_json = ?, updated_at = ?
        WHERE id = ?
      `,
      [
        input.status,
        JSON.stringify({
          provider_status: input.status,
          raw_payload: input.rawPayload
        }),
        toMysqlDateTime(input.occurredAt),
        message.id
      ]
    );
  }

  const currentOutbox = await loadOutboxByProviderMessageId(input.providerMessageId);
  if (shouldProjectDeliveryStatus((typeof currentOutbox?.provider_status === "string" ? currentOutbox.provider_status : null), input.status)) {
    await queryRows(
      `
        UPDATE brain_message_outbox
        SET provider_status = ?, provider_status_updated_at = ?, updated_at = ?
        WHERE provider_message_id = ?
      `,
      [input.status, toMysqlDateTime(input.occurredAt), toMysqlDateTime(input.occurredAt), input.providerMessageId]
    );
  }

  const deliveryEvent = normalizeMetaWhatsAppStatusCommercialEvent({
    providerMessageId: input.providerMessageId,
    status: input.status,
    occurredAt: input.occurredAt,
    customerId: conversation.customer_id,
    conversationId: conversation.id,
    opportunityId: null,
    messageId: message.id,
    metadata: {
      conversationPublicId: conversation.public_id,
      messagePublicId: message.public_id,
      providerStatus: input.status
    }
  });

  await recordCommercialEvent(deliveryEvent);

  await auditLog({
    action: "whatsapp.delivery_status.applied",
    entityType: "conversation_message",
    entityId: message.id,
    after: {
      providerMessageId: input.providerMessageId,
      status: input.status,
      conversationId: conversation.id
    }
  });

  return { ok: true as const, warning: null, conversationId: conversation.id, messageId: message.id };
}

export async function loadNativeConversationDetailByPublicId(publicId: string) {
  const conversation = await loadConversationByPublicId(publicId);
  if (!conversation) return null;
  const customer = await loadCustomerById(conversation.customer_id);
  const messagesResult = await safeQueryRows<NativeConversationMessageRow>(
    "SELECT * FROM conversation_message WHERE conversation_id = ? ORDER BY created_at ASC, id ASC",
    [conversation.id]
  );
  const opportunity = mapOpportunityRow(await loadActiveOpportunity(String(conversation.id)));
  const profile = mapProfileRow(await loadActiveProfile(String(conversation.id), opportunity?.id ? Number(opportunity.id) : null));
  const lastDecisionRow = await loadLatestDecision(opportunity?.id ? Number(opportunity.id) : null);
  const actions = await loadRecentActions(opportunity?.id ? Number(opportunity.id) : null);
  return {
    conversation,
    customer,
    messages: messagesResult.ok ? messagesResult.rows : [],
    opportunity,
    profile,
    lastDecision: lastDecisionRow
      ? {
          id: lastDecisionRow.id,
          decisionId: lastDecisionRow.decision_id,
          nextStatus: lastDecisionRow.next_status,
          nextStage: lastDecisionRow.next_stage,
          rationale: lastDecisionRow.rationale,
          createdAt: lastDecisionRow.created_at,
          warnings: parseJsonArray(lastDecisionRow.warnings_json).map((item) => (typeof item === "string" ? item : "")).filter(Boolean)
        }
      : null,
    actions: actions.map((action) => ({
      id: action.id,
      actionId: action.action_id,
      actionType: action.action_type,
      status: action.status,
      scheduledFor: action.scheduled_for,
      finalMessage: action.final_message,
      draftMessage: action.draft_message,
      createdAt: action.created_at,
      updatedAt: action.updated_at
    }))
  };
}
