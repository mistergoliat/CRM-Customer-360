import { createHash } from "node:crypto";
import type { ResultSetHeader, RowDataPacket } from "mysql2/promise";
import { auditLog } from "@/lib/audit";
import { createOutboxPlannedRecord } from "@/lib/brain/messaging";
import { getColumns, queryRows, safeQueryRows, withConnection } from "@/lib/db";
import { isDbWriteEnabled } from "@/lib/write-access";
import { COMMERCIAL_ACTION_LIFECYCLE_VERSION } from "../action-lifecycle";
import { planCommercialFollowUp } from "../follow-up-planner";
import { COMMERCIAL_POLICY_VERSION } from "../policy/policyConstants";
import {
  buildFollowUpPlanningInput,
  isFollowUpActiveStatus,
  isFollowUpAttemptConsumingStatus,
  mapFollowUpPlanStatusToActionStatus,
  mapFollowUpPlanStatusToPolicyStatus
} from "./followUpPlanAdapter";
import type {
  SalesConsultativeActionType,
  SalesConsultativeOperationsRepository,
  SalesConsultativeOpportunity,
  SalesConsultativeProduct,
  SalesConsultativeStage,
  SalesNeedProfile
} from "./types";

function toIsoString(value: string | Date) {
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? new Date(0).toISOString() : date.toISOString();
}

function toMysqlDateTime(value: string | Date) {
  return toIsoString(value).slice(0, 19).replace("T", " ");
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

function asNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function asId(value: unknown): string | number | null {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "bigint") return value.toString();
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) return null;
    const numeric = Number(trimmed);
    if (Number.isSafeInteger(numeric) && String(numeric) === trimmed) return numeric;
    return trimmed;
  }
  return null;
}

function toNumberId(value: unknown): number | null {
  const id = asId(value);
  if (typeof id === "number") return id;
  if (typeof id === "string" && id.trim()) {
    const parsed = Number(id);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asStringArray(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value
      .map((item) => asText(item))
      .filter((item): item is string => Boolean(item));
  }

  if (typeof value === "string" && value.trim()) {
    try {
      const parsed = JSON.parse(value);
      return asStringArray(parsed);
    } catch {
      return [];
    }
  }

  return [];
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

function asRecord(value: unknown): Record<string, unknown> | null {
  if (isRecord(value)) return value;
  if (typeof value === "string" && value.trim()) {
    try {
      const parsed = JSON.parse(value);
      return isRecord(parsed) ? parsed : null;
    } catch {
      return null;
    }
  }
  return null;
}

function serializeJson(value: unknown) {
  return JSON.stringify(value ?? null);
}

function uniqueStrings(values: Array<string | null | undefined>) {
  return [...new Set(values.filter((value): value is string => typeof value === "string" && value.trim().length > 0))];
}

function stableHash(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

function opportunityKeyFor(input: {
  opportunity: SalesConsultativeOpportunity | null;
  customerContext: {
    waId: string | null;
    phoneNumberId: string | null;
    email: string | null;
    phone: string | null;
    idCustomer: string | number | null;
    idOrder: string | number | null;
    invoiceNumber: string | number | null;
    contactId: string | number | null;
  };
  currentTime: string;
}) {
  if (input.opportunity?.opportunityKey) return input.opportunity.opportunityKey;
  const seed = [
    input.customerContext.waId ?? "wa",
    input.customerContext.phoneNumberId ?? "phone",
    input.customerContext.idCustomer ?? "customer",
    input.customerContext.idOrder ?? "order",
    input.currentTime.slice(0, 10)
  ].join("|");
  return `sales-consultative:${stableHash(seed).slice(0, 24)}`;
}

async function tableExists(tableName: string) {
  const columns = await getColumns(tableName);
  return columns.length > 0;
}

function buildProfileJson(profile: SalesNeedProfile) {
  return {
    ...profile,
    goals: [...profile.goals],
    requiredFeatures: [...profile.requiredFeatures],
    preferredFeatures: [...profile.preferredFeatures],
    missingInformation: [...profile.missingInformation],
    availableSpace: profile.availableSpace ? { ...profile.availableSpace } : null,
    location: profile.location ? { ...profile.location } : null
  };
}

function isTerminalStatus(status: string) {
  return ["won", "lost", "cancelled", "archived"].includes(status);
}

function mapConsultativeActionToQueueType(actionType: SalesConsultativeActionType) {
  switch (actionType) {
    case "ask_qualification_question":
      return "request_more_context";
    case "recommend_product":
    case "recommend_alternative":
    case "offer_bundle":
    case "provide_price":
    case "check_shipping":
    case "provide_checkout_link":
      return "send_whatsapp_reply";
    case "prepare_quote":
      return "prepare_quote_draft";
    case "schedule_follow_up":
      return "schedule_followup";
    case "wait_for_customer":
      return "pause_ai";
    case "handoff_to_human":
      return "take_over_case";
    case "close_lost":
      return "mark_lost_candidate";
    case "close_won":
    default:
      return "create_internal_task";
  }
}

function buildDeterministicQuoteId(opportunityKey: string, currentTime: string) {
  return `quote-${stableHash(`${opportunityKey}:${currentTime}`).slice(0, 24)}`;
}

type AgentActionRow = {
  action_id: string;
  idempotency_key: string;
  opportunity_id: string | number | null;
  decision_id: string | null;
  decision_row_id: number | null;
  conversation_case_id: string | number | null;
  message_id: string | null;
  wa_id: string | null;
  channel: string;
  action_type: string;
  status: string;
  risk_level: string;
  approval_requirement: string;
  draft_payload_json: string;
  final_payload_json: string | null;
  execution_payload_json: string | null;
  draft_message: string | null;
  final_message: string | null;
  scheduled_for: string | null;
  expires_at: string | null;
  attempt_number: number;
  max_attempts: number;
  block_reasons_json: string;
  cancel_reason: string | null;
  failure_reason: string | null;
  policy_status: string;
  policy_notes_json: string;
  source: string;
  created_by: string;
  approved_by: string | null;
  approved_at: string | null;
  executed_at: string | null;
  cancelled_at: string | null;
  outbox_message_id: number | null;
  lifecycle_version: string | null;
  policy_version: string | null;
  runtime_version: string | null;
  created_at: string;
  updated_at: string;
};

async function insertAgentActionRow(action: AgentActionRow) {
  await withConnection(async (connection) => {
    const [insertResult] = await connection.execute<ResultSetHeader>(
      `
        INSERT INTO crm_agent_actions (
          action_id,
          idempotency_key,
          opportunity_id,
          decision_id,
          decision_row_id,
          conversation_case_id,
          message_id,
          wa_id,
          channel,
          action_type,
          status,
          risk_level,
          approval_requirement,
          draft_payload_json,
          final_payload_json,
          execution_payload_json,
          draft_message,
          final_message,
          scheduled_for,
          expires_at,
          attempt_number,
          max_attempts,
          block_reasons_json,
          cancel_reason,
          failure_reason,
          policy_status,
          policy_notes_json,
          source,
          created_by,
          approved_by,
          approved_at,
          executed_at,
          cancelled_at,
          outbox_message_id,
          lifecycle_version,
          policy_version,
          runtime_version,
          created_at,
          updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
      [
        action.action_id,
        action.idempotency_key,
        action.opportunity_id,
        action.decision_id,
        action.decision_row_id,
        action.conversation_case_id,
        action.message_id,
        action.wa_id,
        action.channel,
        action.action_type,
        action.status,
        action.risk_level,
        action.approval_requirement,
        action.draft_payload_json,
        action.final_payload_json,
        action.execution_payload_json,
        action.draft_message,
        action.final_message,
        action.scheduled_for,
        action.expires_at,
        action.attempt_number,
        action.max_attempts,
        action.block_reasons_json,
        action.cancel_reason,
        action.failure_reason,
        action.policy_status,
        action.policy_notes_json,
        action.source,
        action.created_by,
        action.approved_by,
        action.approved_at,
        action.executed_at,
        action.cancelled_at,
        action.outbox_message_id,
        action.lifecycle_version,
        action.policy_version,
        action.runtime_version,
        action.created_at,
        action.updated_at
      ]
    );

    if (insertResult.affectedRows > 0 && insertResult.insertId > 0) {
      return insertResult.insertId;
    }

    return null;
  });

  const inserted = await safeQueryRows<{ id: number }>("SELECT id FROM crm_agent_actions WHERE idempotency_key = ? LIMIT 1", [action.idempotency_key]);
  return { ok: inserted.ok, rowId: inserted.ok ? inserted.rows[0]?.id ?? null : null, warning: inserted.ok ? null : inserted.error };
}

type FollowUpActiveRowIdentity = {
  id: number;
  status: string;
  attemptNumber: number;
  planId: string | null;
  intent: string | null;
};

function extractFollowUpDraftIdentity(value: unknown): { planId: string | null; intent: string | null } {
  const record = asRecord(value);
  return {
    planId: asText(record?.planId),
    intent: asText(record?.intent)
  };
}

// Scope rules (ACS-R1-05-T01.1 correction, section 4):
// 1. opportunity_id present -> scope EXCLUSIVELY to that opportunity_id.
//    Never falls back to wa_id when an opportunity is already known, so two
//    opportunities sharing the same wa_id never mix attempt/active state.
// 2. opportunity_id absent -> prefer an exact conversation_case_id match
//    among rows that also have no opportunity_id; only fall back to wa_id
//    for rows with no opportunity_id either. A row that already belongs to
//    a different, identified opportunity is never consumed.
// 3. Always scoped to action_type = 'schedule_followup'.
async function loadFollowUpActionHistory(input: {
  opportunityId: string | number | null;
  conversationCaseId: string | number | null;
  waId: string | null;
}) {
  const available = await tableExists("crm_agent_actions");
  if (!available) {
    return { ok: false as const, warning: "crm_agent_actions unavailable", activeRow: null, maxConsumedAttemptNumber: 0 };
  }

  const params: Array<string | number> = [];
  let sql = "SELECT id, status, attempt_number, draft_payload_json FROM crm_agent_actions WHERE action_type = 'schedule_followup'";
  if (input.opportunityId !== null) {
    sql += " AND opportunity_id = ?";
    params.push(input.opportunityId);
  } else if (input.conversationCaseId !== null) {
    sql += " AND opportunity_id IS NULL AND conversation_case_id = ?";
    params.push(input.conversationCaseId);
  } else if (input.waId) {
    sql += " AND opportunity_id IS NULL AND wa_id = ?";
    params.push(input.waId);
  } else {
    return { ok: true as const, warning: null, activeRow: null as FollowUpActiveRowIdentity | null, maxConsumedAttemptNumber: 0 };
  }
  sql += " ORDER BY id DESC LIMIT 50";

  const result = await safeQueryRows<{ id: number; status: string; attempt_number: number; draft_payload_json: unknown }>(sql, params);
  if (!result.ok) {
    return { ok: false as const, warning: result.error, activeRow: null, maxConsumedAttemptNumber: 0 };
  }

  const activeRawRow = result.rows.find((row) => isFollowUpActiveStatus(row.status));
  const activeRow: FollowUpActiveRowIdentity | null = activeRawRow
    ? {
        id: activeRawRow.id,
        status: activeRawRow.status,
        attemptNumber: asNumber(activeRawRow.attempt_number) ?? 0,
        ...extractFollowUpDraftIdentity(activeRawRow.draft_payload_json)
      }
    : null;

  const maxConsumedAttemptNumber = result.rows.reduce((max, row) => {
    if (!isFollowUpAttemptConsumingStatus(row.status)) return max;
    return Math.max(max, asNumber(row.attempt_number) ?? 0);
  }, 0);

  return { ok: true as const, warning: null, activeRow, maxConsumedAttemptNumber };
}

async function upsertFollowUpActionRow(input: {
  opportunity: SalesConsultativeOpportunity | null;
  dueAt: string | null;
  messageText: string;
  currentTime: string;
  opportunityId: string | number | null;
  waId: string | null;
  metadata?: Record<string, unknown> | null;
}) {
  const conversationCaseId = asId(input.metadata?.conversationId ?? input.opportunity?.conversationCaseId ?? null);

  const history = await loadFollowUpActionHistory({
    opportunityId: input.opportunityId,
    conversationCaseId,
    waId: input.waId
  });
  if (!history.ok) {
    return { ok: false, rowId: null, warning: history.warning };
  }

  // attemptNumber only advances past rows that actually consumed a
  // commercial attempt (executing/executed/failed); recomputed regardless of
  // whether an active row exists, so the exact-retry vs conflicting-plan
  // comparison below has a real plan to compare against.
  const plan = planCommercialFollowUp(
    buildFollowUpPlanningInput({
      opportunity: input.opportunity,
      draftMessage: input.messageText,
      dueAt: input.dueAt,
      currentTime: input.currentTime,
      priorAttemptNumber: history.maxConsumedAttemptNumber
    })
  );

  if (history.activeRow) {
    const isExactRetry =
      history.activeRow.planId === plan.planId &&
      history.activeRow.intent === plan.intent &&
      history.activeRow.attemptNumber === plan.attemptNumber;

    if (isExactRetry) {
      return { ok: true, rowId: history.activeRow.id, warning: "existing_action_reused" };
    }

    // A different logical plan (planId/intent/attemptNumber changed) while an
    // action is still active: T01 does not implement supersession or
    // automatic cancellation, so this is reported, never silently applied.
    return { ok: true, rowId: history.activeRow.id, warning: "active_followup_exists" };
  }

  const status = mapFollowUpPlanStatusToActionStatus(plan.status);
  const policyStatus = mapFollowUpPlanStatusToPolicyStatus(plan.status);
  if (!status || !policyStatus) {
    return { ok: true, rowId: null, warning: `follow_up_plan_not_persisted:${plan.status}` };
  }

  const existingByKey = await safeQueryRows<{ id: number }>(
    "SELECT id FROM crm_agent_actions WHERE idempotency_key = ? LIMIT 1",
    [plan.idempotencyKey]
  );
  if (!existingByKey.ok) {
    return { ok: false, rowId: null, warning: existingByKey.error };
  }
  if (existingByKey.rows[0]?.id) {
    return { ok: true, rowId: existingByKey.rows[0].id, warning: "existing_action_reused" };
  }

  const rowActionId = `sales-followup-${stableHash(plan.idempotencyKey).slice(0, 28)}`;

  return insertAgentActionRow({
    action_id: rowActionId,
    idempotency_key: plan.idempotencyKey,
    opportunity_id: input.opportunityId,
    decision_id: plan.decisionId,
    decision_row_id: null,
    conversation_case_id: conversationCaseId,
    message_id: plan.messageId,
    wa_id: input.waId,
    channel: "whatsapp",
    action_type: "schedule_followup",
    status,
    risk_level: plan.riskLevel,
    approval_requirement: plan.approvalRequirement,
    draft_payload_json: serializeJson({
      planId: plan.planId,
      intent: plan.intent,
      status: plan.status,
      attemptNumber: plan.attemptNumber,
      maxAttempts: plan.maxAttempts,
      scheduledFor: plan.scheduledFor,
      rationale: plan.rationale
    }),
    final_payload_json: null,
    execution_payload_json: null,
    draft_message: plan.draftMessage,
    final_message: null,
    scheduled_for: plan.scheduledFor ? toMysqlDateTime(plan.scheduledFor) : null,
    expires_at: null,
    attempt_number: plan.attemptNumber,
    max_attempts: plan.maxAttempts,
    block_reasons_json: serializeJson(plan.blockReasons),
    cancel_reason: plan.cancelReason,
    failure_reason: null,
    policy_status: policyStatus,
    policy_notes_json: serializeJson(plan.policyNotes),
    source: "ai_sdr",
    created_by: "ai",
    approved_by: null,
    approved_at: null,
    executed_at: null,
    cancelled_at: null,
    outbox_message_id: null,
    lifecycle_version: COMMERCIAL_ACTION_LIFECYCLE_VERSION,
    policy_version: COMMERCIAL_POLICY_VERSION,
    runtime_version: "brain.commercial.sales-consultative.v1",
    created_at: toMysqlDateTime(input.currentTime),
    updated_at: toMysqlDateTime(input.currentTime)
  });
}

async function upsertActionRow(input: {
  opportunity: SalesConsultativeOpportunity | null;
  actionType: SalesConsultativeActionType;
  dueAt: string | null;
  messageText: string;
  currentTime: string;
  metadata?: Record<string, unknown> | null;
}) {
  const available = await tableExists("crm_agent_actions");
  if (!available) {
    return { ok: false, rowId: null, warning: "crm_agent_actions unavailable" };
  }

  const opportunityId = asId(input.opportunity?.id ?? null);
  const waId = asText(input.opportunity?.waId ?? null);
  const actionType = mapConsultativeActionToQueueType(input.actionType);

  if (actionType === "schedule_followup") {
    return upsertFollowUpActionRow({
      opportunity: input.opportunity,
      dueAt: input.dueAt,
      messageText: input.messageText,
      currentTime: input.currentTime,
      opportunityId,
      waId,
      metadata: input.metadata
    });
  }

  const rowActionId = `sales-action-${stableHash([
    input.opportunity?.opportunityKey ?? "none",
    actionType,
    input.currentTime,
    input.messageText
  ].join("|")).slice(0, 24)}`;
  const idempotencyKey = `sales-action:${input.opportunity?.opportunityKey ?? waId ?? "none"}:${actionType}`;

  const existing = await safeQueryRows<{ id: number }>("SELECT id FROM crm_agent_actions WHERE idempotency_key = ? LIMIT 1", [idempotencyKey]);
  if (!existing.ok) {
    return { ok: false, rowId: null, warning: existing.error };
  }
  if (existing.rows[0]?.id) {
    return { ok: true, rowId: existing.rows[0].id, warning: "existing_action_reused" };
  }

  const status =
    actionType === "send_whatsapp_reply"
      ? "proposed"
      : actionType === "take_over_case"
        ? "requires_review"
        : actionType === "pause_ai"
          ? "blocked"
          : "planned";

  return insertAgentActionRow({
    action_id: rowActionId,
    idempotency_key: idempotencyKey,
    opportunity_id: opportunityId,
    decision_id: null,
    decision_row_id: null,
    conversation_case_id: asId(input.metadata?.conversationId ?? input.opportunity?.conversationCaseId ?? null),
    message_id: null,
    wa_id: waId,
    channel: "whatsapp",
    action_type: actionType,
    status,
    risk_level: actionType === "take_over_case" ? "high" : "low",
    approval_requirement: actionType === "take_over_case" ? "operator_review" : "none",
    draft_payload_json: serializeJson({
      consultativeActionType: input.actionType,
      mappedActionType: actionType,
      messageText: input.messageText,
      metadata: input.metadata ?? null
    }),
    final_payload_json: null,
    execution_payload_json: null,
    draft_message: input.messageText,
    final_message: null,
    scheduled_for: input.dueAt,
    expires_at: null,
    attempt_number: 1,
    max_attempts: 1,
    block_reasons_json: serializeJson([]),
    cancel_reason: null,
    failure_reason: null,
    policy_status: "allowed",
    policy_notes_json: serializeJson([]),
    source: "ai_sdr",
    created_by: "ai",
    approved_by: null,
    approved_at: null,
    executed_at: null,
    cancelled_at: null,
    outbox_message_id: null,
    lifecycle_version: "brain.commercial.sales-consultative.v1",
    policy_version: "brain.commercial.policy.v1",
    runtime_version: "brain.commercial.sales-consultative.v1",
    created_at: toMysqlDateTime(input.currentTime),
    updated_at: toMysqlDateTime(input.currentTime)
  });
}

async function upsertOpportunityArrayField(input: {
  opportunityId: number | string;
  field: "product_interests_json" | "objections_json";
  value: unknown;
  currentTime: string;
}) {
  const available = await tableExists("crm_opportunities");
  if (!available) {
    return { ok: false, warning: "crm_opportunities unavailable" };
  }

  const rows = await safeQueryRows<Record<string, unknown>>(`SELECT ${input.field} FROM crm_opportunities WHERE id = ? LIMIT 1`, [input.opportunityId]);
  if (!rows.ok) return { ok: false, warning: rows.error };
  const current = rows.rows[0];
  if (!current) return { ok: false, warning: "missing_opportunity" };

  const existing = asJsonArray(current[input.field]);
  const next = [...existing, input.value];

  await queryRows(
    `UPDATE crm_opportunities SET ${input.field} = ?, updated_at = ?, last_activity_at = ? WHERE id = ?`,
    [serializeJson(next), toMysqlDateTime(input.currentTime), toMysqlDateTime(input.currentTime), input.opportunityId]
  );

  return { ok: true as const, warning: null };
}

async function loadOpportunityByKey(opportunityKey: string) {
  const result = await safeQueryRows<Record<string, unknown>>("SELECT * FROM crm_opportunities WHERE opportunity_key = ? LIMIT 1", [opportunityKey]);
  if (!result.ok) return null;
  return result.rows[0] ?? null;
}

function mapOpportunityRow(row: Record<string, unknown>): SalesConsultativeOpportunity {
  return {
    id: asId(row.id ?? row.opportunity_id),
    opportunityKey: asText(row.opportunity_key) ?? "",
    status: asText(row.status) ?? "new",
    stage: asText(row.stage),
    primaryIntent: asText(row.primary_intent) ?? "unknown",
    currentSummary: asText(row.current_summary),
    nextActionType: asText(row.next_action_type),
    nextActionDueAt: asText(row.next_action_due_at),
    waitingFor: asText(row.waiting_for),
    humanOwnerActive: Boolean(asNumber(row.human_owner_active)),
    aiBlocked: Boolean(asNumber(row.ai_blocked)),
    customerCandidateId: asId(row.customer_candidate_id),
    customerMasterId: asId(row.customer_master_id),
    leadId: asId(row.lead_id),
    conversationCaseId: asId(row.conversation_case_id),
    waId: asText(row.wa_id),
    requirements: asJsonArray(row.requirements_json),
    missingRequirements: asJsonArray(row.missing_requirements_json),
    productInterests: asJsonArray(row.product_interests_json),
    objections: asJsonArray(row.objections_json) as SalesConsultativeOpportunity["objections"],
    signals: asStringArray(row.signals_json),
    version: Number(row.version ?? 1),
    lastActivityAt: asText(row.last_activity_at ?? row.updated_at) ?? new Date(0).toISOString(),
    closedAt: asText(row.closed_at)
  };
}

async function saveSalesNeedProfileRecord(input: {
  opportunity: SalesConsultativeOpportunity | null;
  profile: SalesNeedProfile;
  currentTime: string;
  messageText: string;
  metadata?: Record<string, unknown> | null;
}) {
  const available = await tableExists("crm_sales_need_profiles");
  if (!available) {
    return { ok: false, profileId: null, warning: "crm_sales_need_profiles unavailable" };
  }

  const opportunityKey = opportunityKeyFor({
    opportunity: input.opportunity,
    customerContext: {
      waId: input.opportunity?.waId ?? null,
      phoneNumberId: null,
      email: null,
      phone: null,
      idCustomer: input.opportunity?.customerMasterId ?? null,
      idOrder: null,
      invoiceNumber: null,
      contactId: null
    },
    currentTime: input.currentTime
  });
  const profileKey = `sales-need:${opportunityKey}`;
  const payload = buildProfileJson(input.profile);

  await queryRows(
    `
      INSERT INTO crm_sales_need_profiles (
        profile_key,
        opportunity_id,
        opportunity_key,
        conversation_case_id,
        wa_id,
        customer_master_id,
        customer_candidate_id,
        lead_id,
        use_case,
        customer_type,
        goals_json,
        required_features_json,
        preferred_features_json,
        budget_min,
        budget_max,
        available_space_json,
        location_json,
        delivery_deadline,
        experience_level,
        purchase_urgency,
        decision_readiness,
        missing_information_json,
        source_message_id,
        last_message_text,
        profile_json,
        profile_version,
        created_at,
        updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON DUPLICATE KEY UPDATE
        opportunity_id = VALUES(opportunity_id),
        opportunity_key = VALUES(opportunity_key),
        conversation_case_id = VALUES(conversation_case_id),
        wa_id = VALUES(wa_id),
        customer_master_id = VALUES(customer_master_id),
        customer_candidate_id = VALUES(customer_candidate_id),
        lead_id = VALUES(lead_id),
        use_case = VALUES(use_case),
        customer_type = VALUES(customer_type),
        goals_json = VALUES(goals_json),
        required_features_json = VALUES(required_features_json),
        preferred_features_json = VALUES(preferred_features_json),
        budget_min = VALUES(budget_min),
        budget_max = VALUES(budget_max),
        available_space_json = VALUES(available_space_json),
        location_json = VALUES(location_json),
        delivery_deadline = VALUES(delivery_deadline),
        experience_level = VALUES(experience_level),
        purchase_urgency = VALUES(purchase_urgency),
        decision_readiness = VALUES(decision_readiness),
        missing_information_json = VALUES(missing_information_json),
        source_message_id = VALUES(source_message_id),
        last_message_text = VALUES(last_message_text),
        profile_json = VALUES(profile_json),
        profile_version = profile_version + 1,
        updated_at = VALUES(updated_at)
    `,
    [
      profileKey,
      input.opportunity?.id ?? null,
      opportunityKey,
      input.metadata?.conversationId ?? input.opportunity?.conversationCaseId ?? null,
      input.opportunity?.waId ?? null,
      input.opportunity?.customerMasterId ?? null,
      input.opportunity?.customerCandidateId ?? null,
      input.opportunity?.leadId ?? null,
      input.profile.useCase,
      input.profile.customerType,
      serializeJson(input.profile.goals),
      serializeJson(input.profile.requiredFeatures),
      serializeJson(input.profile.preferredFeatures),
      input.profile.budgetMin,
      input.profile.budgetMax,
      serializeJson(input.profile.availableSpace),
      serializeJson(input.profile.location),
      input.profile.deliveryDeadline,
      input.profile.experienceLevel,
      input.profile.purchaseUrgency,
      input.profile.decisionReadiness,
      serializeJson(input.profile.missingInformation),
      input.metadata?.sourceMessageId ?? null,
      input.messageText,
      serializeJson(payload),
      1,
      toMysqlDateTime(input.currentTime),
      toMysqlDateTime(input.currentTime)
    ]
  );

  const loaded = await safeQueryRows<{ id: number }>("SELECT id FROM crm_sales_need_profiles WHERE profile_key = ? LIMIT 1", [profileKey]);
  return { ok: loaded.ok, profileId: loaded.ok ? toNumberId(loaded.rows[0]?.id) : null, warning: loaded.ok ? null : loaded.error };
}

async function createOrUpdateOpportunityRecord(input: {
  opportunity: SalesConsultativeOpportunity | null;
  profile: SalesNeedProfile;
  stage: SalesConsultativeStage;
  status: string;
  summary: string;
  nextActionType: SalesConsultativeActionType;
  nextActionDueAt: string | null;
  currentTime: string;
  customerContext: {
    waId: string | null;
    phoneNumberId: string | null;
    email: string | null;
    phone: string | null;
    idCustomer: string | number | null;
    idOrder: string | number | null;
    invoiceNumber: string | number | null;
    contactId: string | number | null;
  };
  metadata?: Record<string, unknown> | null;
}) {
  const key = opportunityKeyFor({
    opportunity: input.opportunity,
    customerContext: input.customerContext,
    currentTime: input.currentTime
  });
  const existingRow = await loadOpportunityByKey(key);
  if (existingRow && isTerminalStatus(asText(existingRow.status) ?? "new") && input.metadata?.allowTerminalReopen !== true) {
    return {
      ok: true,
      opportunityId: toNumberId(existingRow.id),
      opportunityKey: key,
      warning: "terminal_opportunity_not_reopened"
    };
  }

  const now = toMysqlDateTime(input.currentTime);
  const rowValues = {
    opportunity_key: key,
    customer_candidate_id: input.opportunity?.customerCandidateId ?? null,
    customer_master_id: input.opportunity?.customerMasterId ?? null,
    lead_id: input.opportunity?.leadId ?? null,
    conversation_case_id: input.metadata?.conversationId ?? input.opportunity?.conversationCaseId ?? null,
    wa_id: input.customerContext.waId ?? input.opportunity?.waId ?? null,
    channel: "whatsapp",
    primary_intent: input.opportunity?.primaryIntent ?? "product_recommendation",
    status: input.status,
    stage: input.stage,
    temperature: input.stage === "purchase_intent" || input.stage === "checkout_support" ? "hot" : "warm",
    priority: "normal",
    current_summary: input.summary,
    requirements_json: serializeJson(input.opportunity?.requirements ?? []),
    missing_requirements_json: serializeJson(input.profile.missingInformation),
    product_interests_json: serializeJson(input.opportunity?.productInterests ?? []),
    objections_json: serializeJson(input.opportunity?.objections ?? []),
    signals_json: serializeJson(input.opportunity?.signals ?? []),
    last_customer_message_id: input.metadata?.lastCustomerMessageId ?? null,
    last_agent_decision_id: input.metadata?.lastAgentDecisionId ?? null,
    waiting_for: input.nextActionType === "wait_for_customer" ? "customer_reply" : input.opportunity?.waitingFor ?? null,
    next_action_type: input.nextActionType,
    next_action_due_at: input.nextActionDueAt,
    human_owner_active: input.opportunity?.humanOwnerActive ? 1 : 0,
    ai_blocked: input.opportunity?.aiBlocked ? 1 : 0,
    version: (input.opportunity?.version ?? 0) + 1,
    created_at: input.opportunity?.lastActivityAt ?? now,
    updated_at: now,
    last_activity_at: now,
    closed_at: input.status === "won" || input.status === "lost" ? now : null
  };

  if (existingRow?.id) {
    await queryRows(
      `
        UPDATE crm_opportunities SET
          customer_candidate_id = ?,
          customer_master_id = ?,
          lead_id = ?,
          conversation_case_id = ?,
          wa_id = ?,
          channel = ?,
          primary_intent = ?,
          status = ?,
          stage = ?,
          temperature = ?,
          priority = ?,
          current_summary = ?,
          requirements_json = ?,
          missing_requirements_json = ?,
          product_interests_json = ?,
          objections_json = ?,
          signals_json = ?,
          last_customer_message_id = ?,
          last_agent_decision_id = ?,
          waiting_for = ?,
          next_action_type = ?,
          next_action_due_at = ?,
          human_owner_active = ?,
          ai_blocked = ?,
          version = ?,
          updated_at = ?,
          last_activity_at = ?,
          closed_at = ?
        WHERE opportunity_key = ?
      `,
      [
        rowValues.customer_candidate_id,
        rowValues.customer_master_id,
        rowValues.lead_id,
        rowValues.conversation_case_id,
        rowValues.wa_id,
        rowValues.channel,
        rowValues.primary_intent,
        rowValues.status,
        rowValues.stage,
        rowValues.temperature,
        rowValues.priority,
        rowValues.current_summary,
        rowValues.requirements_json,
        rowValues.missing_requirements_json,
        rowValues.product_interests_json,
        rowValues.objections_json,
        rowValues.signals_json,
        rowValues.last_customer_message_id,
        rowValues.last_agent_decision_id,
        rowValues.waiting_for,
        rowValues.next_action_type,
        rowValues.next_action_due_at,
        rowValues.human_owner_active,
        rowValues.ai_blocked,
        rowValues.version,
        rowValues.updated_at,
        rowValues.last_activity_at,
        rowValues.closed_at,
        key
      ]
    );
  } else {
    await queryRows(
      `
        INSERT INTO crm_opportunities (
          opportunity_key,
          customer_candidate_id,
          customer_master_id,
          lead_id,
          conversation_case_id,
          wa_id,
          channel,
          primary_intent,
          status,
          stage,
          temperature,
          priority,
          current_summary,
          requirements_json,
          missing_requirements_json,
          product_interests_json,
          objections_json,
          signals_json,
          last_customer_message_id,
          last_agent_decision_id,
          waiting_for,
          next_action_type,
          next_action_due_at,
          human_owner_active,
          ai_blocked,
          version,
          created_at,
          updated_at,
          last_activity_at,
          closed_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
      [
        rowValues.opportunity_key,
        rowValues.customer_candidate_id,
        rowValues.customer_master_id,
        rowValues.lead_id,
        rowValues.conversation_case_id,
        rowValues.wa_id,
        rowValues.channel,
        rowValues.primary_intent,
        rowValues.status,
        rowValues.stage,
        rowValues.temperature,
        rowValues.priority,
        rowValues.current_summary,
        rowValues.requirements_json,
        rowValues.missing_requirements_json,
        rowValues.product_interests_json,
        rowValues.objections_json,
        rowValues.signals_json,
        rowValues.last_customer_message_id,
        rowValues.last_agent_decision_id,
        rowValues.waiting_for,
        rowValues.next_action_type,
        rowValues.next_action_due_at,
        rowValues.human_owner_active,
        rowValues.ai_blocked,
        rowValues.version,
        rowValues.created_at,
        rowValues.updated_at,
        rowValues.last_activity_at,
        rowValues.closed_at
      ]
    );
  }

  const loaded = await loadOpportunityByKey(key);
  return { ok: Boolean(loaded), opportunityId: loaded ? toNumberId(loaded.id) : null, opportunityKey: key, warning: null };
}

async function recordProductInterestRecord(input: {
  opportunity: SalesConsultativeOpportunity | null;
  profile: SalesNeedProfile;
  recommendation: { main: { product: SalesConsultativeProduct } | null; alternative: { product: SalesConsultativeProduct } | null };
  currentTime: string;
}) {
  if (!input.opportunity?.id) return { ok: false, warning: "missing_opportunity" };
  const payload = {
    profile: input.profile,
    recommendation: {
      mainProductId: input.recommendation.main?.product.id ?? null,
      alternativeProductId: input.recommendation.alternative?.product.id ?? null
    },
    currentTime: input.currentTime
  };
  const result = await upsertOpportunityArrayField({
    opportunityId: input.opportunity.id,
    field: "product_interests_json",
    value: payload,
    currentTime: input.currentTime
  });
  if (!result.ok) return result;
  await auditLog({
    action: "ai_sdr.decision.created",
    entityType: "crm_opportunity_product_interest",
    entityId: input.opportunity.id,
    after: payload
  });
  return { ok: true, warning: null };
}

async function recordObjectionRecord(input: {
  opportunity: SalesConsultativeOpportunity | null;
  objection: unknown;
  currentTime: string;
}) {
  if (!input.opportunity?.id) return { ok: false, warning: "missing_opportunity" };
  const result = await upsertOpportunityArrayField({
    opportunityId: input.opportunity.id,
    field: "objections_json",
    value: input.objection,
    currentTime: input.currentTime
  });
  if (!result.ok) return result;
  await auditLog({
    action: "ai_sdr.decision.created",
    entityType: "crm_opportunity_objection",
    entityId: input.opportunity.id,
    after: input.objection
  });
  return { ok: true, warning: null };
}

async function createFollowUpActionRecord(input: {
  opportunity: SalesConsultativeOpportunity | null;
  actionType: SalesConsultativeActionType;
  dueAt: string | null;
  messageText: string;
  currentTime: string;
  metadata?: Record<string, unknown> | null;
}) {
  if (!isDbWriteEnabled()) {
    return { ok: false, actionId: null, warning: "db_write_disabled" };
  }
  const result = await upsertActionRow(input);
  return { ok: result.ok, actionId: result.rowId ?? null, warning: result.warning ?? null };
}

async function cancelFollowUpActionRecord(input: {
  opportunity: SalesConsultativeOpportunity | null;
  reason: string;
  currentTime: string;
}) {
  if (!input.opportunity?.id && !input.opportunity?.waId) {
    return { ok: false, warning: "missing_opportunity" };
  }
  const available = await tableExists("crm_agent_actions");
  if (!available) return { ok: false, warning: "crm_agent_actions unavailable" };

  const params: Array<string | number> = [];
  let sql = "SELECT id FROM crm_agent_actions WHERE status IN ('proposed', 'planned', 'scheduled') AND action_type = 'schedule_followup'";
  if (input.opportunity?.id) {
    sql += " AND opportunity_id = ?";
    params.push(input.opportunity.id);
  } else if (input.opportunity?.waId) {
    sql += " AND wa_id = ?";
    params.push(input.opportunity.waId);
  }
  sql += " ORDER BY scheduled_for DESC, id DESC LIMIT 1";

  const latest = await safeQueryRows<{ id: number }>(sql, params);
  if (!latest.ok) return { ok: false, warning: latest.error };
  const actionId = latest.rows[0]?.id;
  if (!actionId) return { ok: true, warning: "no_followup_to_cancel" };

  await queryRows(
    `UPDATE crm_agent_actions SET status = 'cancelled', cancelled_at = ?, cancel_reason = ?, updated_at = ? WHERE id = ?`,
    [toMysqlDateTime(input.currentTime), input.reason, toMysqlDateTime(input.currentTime), actionId]
  );
  return { ok: true, warning: null };
}

async function prepareQuoteRecord(input: {
  opportunity: SalesConsultativeOpportunity | null;
  recommendation: { summary: string };
  currentTime: string;
}) {
  const quoteId = buildDeterministicQuoteId(input.opportunity?.opportunityKey ?? "none", input.currentTime);
  await auditLog({
    action: "ai_sdr.decision.created",
    entityType: "crm_quote_draft",
    entityId: input.opportunity?.id ?? null,
    after: {
      quoteId,
      summary: input.recommendation.summary,
      currentTime: input.currentTime
    }
  });
  return { ok: true, quoteId, warning: null };
}

async function queueCustomerMessageRecord(input: {
  opportunity: SalesConsultativeOpportunity | null;
  messageText: string;
  currentTime: string;
  metadata?: Record<string, unknown> | null;
}) {
  if (!isDbWriteEnabled()) return { ok: false, queued: false, outboxId: null, warning: "db_write_disabled" };
  const outbox = await createOutboxPlannedRecord({
    dedupeKeyInput: {
      source: "brain",
      actionType: "send_whatsapp_message",
      channel: "whatsapp",
      waId: input.opportunity?.waId ?? undefined,
      phoneNumberId: undefined,
      conversationCaseId: asId(input.metadata?.conversationId ?? input.opportunity?.conversationCaseId ?? null) ?? undefined,
      messageText: input.messageText,
      sourceRequestId: input.opportunity?.opportunityKey ?? undefined
    },
    status: "planned",
    source: "brain",
    sourceRequestId: input.opportunity?.opportunityKey ?? null,
    sourceAgentName: "sales-consultative",
    sourceAgentVersion: "brain.commercial.sales-consultative.v1",
    waId: input.opportunity?.waId ?? null,
    phoneNumberId: null,
    conversationCaseId: asId(input.metadata?.conversationId ?? input.opportunity?.conversationCaseId ?? null),
    messageText: input.messageText,
    metaPayloadJson: {
      model_version: "brain.commercial.sales-consultative.v1",
      currentTime: input.currentTime,
      metadata: input.metadata ?? null
    }
  });
  if (!outbox.ok) {
    return { ok: false, queued: false, outboxId: null, warning: outbox.warning };
  }

  return {
    ok: true,
    queued: true,
    outboxId: outbox.row?.id ?? null,
    warning: outbox.warning ?? null
  };
}

async function requestHumanHandoffRecord(input: {
  opportunity: SalesConsultativeOpportunity | null;
  reason: string;
  currentTime: string;
}) {
  if (!input.opportunity?.id) return { ok: false, warning: "missing_opportunity" };
  if (!isDbWriteEnabled()) return { ok: false, warning: "db_write_disabled" };

  const now = toMysqlDateTime(input.currentTime);
  await queryRows(
    `
      UPDATE crm_opportunities SET
        status = 'stalled',
        stage = 'handoff',
        human_owner_active = 1,
        ai_blocked = 1,
        next_action_type = 'handoff_to_human',
        waiting_for = 'human_operator',
        updated_at = ?,
        last_activity_at = ?
      WHERE id = ?
    `,
    [now, now, input.opportunity.id]
  );

  await auditLog({
    action: "ai_sdr.handoff.requested",
    entityType: "crm_opportunity",
    entityId: input.opportunity.id,
    after: {
      reason: input.reason,
      currentTime: input.currentTime
    }
  });

  return { ok: true, warning: null };
}

async function writeAuditRecord(input: {
  action: string;
  entityType: string;
  entityId: string | number | null;
  after?: unknown;
  before?: unknown;
}) {
  await auditLog({
    action: input.action as never,
    entityType: input.entityType,
    entityId: input.entityId,
    before: input.before,
    after: input.after
  });
}

export function createSalesConsultativeOperationsRepository(): SalesConsultativeOperationsRepository {
  return {
    async saveSalesNeedProfile(input) {
      if (!isDbWriteEnabled()) return { ok: false, profileId: null, warning: "db_write_disabled" };
      return saveSalesNeedProfileRecord(input);
    },
    async createOrUpdateOpportunity(input) {
      if (!isDbWriteEnabled()) {
        return {
          ok: false,
          opportunityId: null,
          opportunityKey: opportunityKeyFor({
            opportunity: input.opportunity,
            customerContext: input.customerContext,
            currentTime: input.currentTime
          }),
          warning: "db_write_disabled"
        };
      }
      return createOrUpdateOpportunityRecord(input);
    },
    async recordProductInterest(input) {
      if (!isDbWriteEnabled()) return { ok: false, warning: "db_write_disabled" };
      return recordProductInterestRecord(input);
    },
    async recordObjection(input) {
      if (!isDbWriteEnabled()) return { ok: false, warning: "db_write_disabled" };
      return recordObjectionRecord(input);
    },
    async createFollowUpAction(input) {
      return createFollowUpActionRecord(input);
    },
    async cancelFollowUpAction(input) {
      if (!isDbWriteEnabled()) return { ok: false, warning: "db_write_disabled" };
      return cancelFollowUpActionRecord(input);
    },
    async prepareQuote(input) {
      if (!isDbWriteEnabled()) return { ok: false, quoteId: null, warning: "db_write_disabled" };
      return prepareQuoteRecord(input);
    },
    async queueCustomerMessage(input) {
      return queueCustomerMessageRecord(input);
    },
    async requestHumanHandoff(input) {
      return requestHumanHandoffRecord(input);
    },
    async writeAudit(input) {
      return writeAuditRecord(input);
    }
  };
}
