import { COMMERCIAL_INTENTS, COMMERCIAL_PRIORITIES, COMMERCIAL_TEMPERATURES, OPPORTUNITY_STAGES, OPPORTUNITY_STATUSES } from "../constants";
import { sanitizeCommercialObject } from "../context/adapters";
import type {
  CommercialContextBuilderResult,
  CommercialIntent,
  CommercialPriority,
  CommercialSignal,
  CommercialTemperature,
  OpportunityObjection,
  OpportunityProductInterest,
  OpportunityRequirement,
  OpportunityStage,
  OpportunityStatus
} from "../types";
import { queryRows } from "../../../db";
import { buildCommercialIdentityHints } from "./resolveOpportunityIdentity";
import type {
  CommercialOperationalIdentityHints,
  CommercialOperationalLoadInput,
  CommercialOperationalLoadStateResult,
  CommercialOperationalState,
  CommercialOperationalDecisionRecord
} from "./types";
import {
  COMMERCIAL_OPERATIONAL_LOOP_NEXT_ACTION_TYPES,
  COMMERCIAL_OPERATIONAL_LOOP_WARNING_VALUES,
  COMMERCIAL_OPERATIONAL_LOOP_VERSION
} from "./constants";
import type { CommercialOperationalLoopWarning } from "./constants";

type DbLikeRow = Record<string, unknown>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asText(value: unknown): string | null {
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
  }
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  if (typeof value === "bigint") return value.toString();
  return null;
}

function asId(value: unknown): string | number | null {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
  }
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "bigint") return value.toString();
  return null;
}

function asBoolean(value: unknown, fallback = false): boolean {
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value !== 0;
  if (typeof value === "string") return value.trim().toLowerCase() === "true";
  return fallback;
}

function toIso(value: unknown, fallback: string): string {
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value.toISOString();
  if (typeof value === "string" || typeof value === "number" || typeof value === "bigint") {
    const parsed = new Date(typeof value === "bigint" ? Number(value) : value);
    if (!Number.isNaN(parsed.getTime())) return parsed.toISOString();
  }
  return fallback;
}

function parseJson(value: unknown): unknown {
  if (value === null || value === undefined) return null;
  if (typeof value === "object") return value;
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  try {
    return JSON.parse(trimmed);
  } catch {
    return null;
  }
}

function parseJsonArray<T>(value: unknown): T[] {
  const parsed = parseJson(value);
  return Array.isArray(parsed) ? (parsed as T[]) : [];
}

function parseJsonRecord(value: unknown): Record<string, unknown> {
  const parsed = parseJson(value);
  return isRecord(parsed) ? parsed : {};
}

function uniqueStrings(values: Array<string | null | undefined>): string[] {
  return [...new Set(values.filter((value): value is string => typeof value === "string" && value.trim().length > 0))];
}

function normalizeWarnings(values: unknown): CommercialOperationalLoopWarning[] {
  const list = parseJsonArray<string>(values);
  return uniqueStrings(list).filter((value): value is CommercialOperationalLoopWarning =>
    (COMMERCIAL_OPERATIONAL_LOOP_WARNING_VALUES as readonly string[]).includes(value)
  );
}

function normalizeNextActionType(value: unknown): CommercialOperationalDecisionRecord["nextAction"]["type"] {
  const text = asText(value);
  if (text && (COMMERCIAL_OPERATIONAL_LOOP_NEXT_ACTION_TYPES as readonly string[]).includes(text)) {
    return text as CommercialOperationalDecisionRecord["nextAction"]["type"];
  }
  return "no_action";
}

function isTerminalStatus(status: OpportunityStatus) {
  return status === "won" || status === "lost" || status === "cancelled" || status === "archived";
}

function normalizeOpportunityStatus(value: unknown): OpportunityStatus {
  const text = asText(value);
  if (text && (OPPORTUNITY_STATUSES as readonly string[]).includes(text)) return text as OpportunityStatus;
  return "new";
}

function normalizeOpportunityStage(value: unknown): OpportunityStage | null {
  const text = asText(value);
  if (text && (OPPORTUNITY_STAGES as readonly string[]).includes(text)) return text as OpportunityStage;
  return null;
}

function normalizeCommercialIntent(value: unknown): CommercialIntent {
  const text = asText(value);
  if (text && (COMMERCIAL_INTENTS as readonly string[]).includes(text)) return text as CommercialIntent;
  return "unknown";
}

function normalizePriority(value: unknown): CommercialPriority {
  const text = asText(value);
  if (text && (COMMERCIAL_PRIORITIES as readonly string[]).includes(text)) return text as CommercialPriority;
  return "normal";
}

function normalizeTemperature(value: unknown): CommercialTemperature {
  const text = asText(value);
  if (text && (COMMERCIAL_TEMPERATURES as readonly string[]).includes(text)) return text as CommercialTemperature;
  return "unknown";
}

function normalizeSignalList(value: unknown): CommercialSignal[] {
  const list = parseJsonArray<unknown>(value);
  return list
    .map((item) => asText(item))
    .filter((item): item is CommercialSignal => Boolean(item));
}

function normalizeRequirements(value: unknown): OpportunityRequirement[] {
  return parseJsonArray<OpportunityRequirement>(value);
}

function normalizeProductInterests(value: unknown): OpportunityProductInterest[] {
  return parseJsonArray<OpportunityProductInterest>(value);
}

function normalizeObjections(value: unknown): OpportunityObjection[] {
  return parseJsonArray<OpportunityObjection>(value);
}

function normalizeDecision(row: DbLikeRow): CommercialOperationalDecisionRecord {
  const createdAt = toIso(row.created_at ?? row.createdAt, new Date(0).toISOString());
  const stateChanges = parseJsonRecord(row.state_changes_json);
  const detectedSignals = parseJsonArray<CommercialSignal>(row.detected_signals_json);
  const missingInformation = parseJsonArray<string>(row.missing_information_json);
  const warnings = normalizeWarnings(row.warnings_json);
  const nextActionRecord = parseJsonRecord(row.next_action_json);

  return {
    decisionId: asText(row.decision_id) ?? `decision-${asText(row.id) ?? "unknown"}`,
    opportunityId: asId(row.opportunity_id) ?? asText(row.opportunity_id) ?? "unknown",
    opportunityKey: asText(row.opportunity_key) ?? asText(row.opportunityKey) ?? `opportunity-${asText(row.opportunity_id) ?? "unknown"}`,
    correlationId: asText(row.correlation_id) ?? "unknown",
    processInboundRunId: asText(row.process_inbound_run_id ?? row.processInboundRunId),
    salesAgentRunId: asText(row.sales_agent_run_id ?? row.salesAgentRunId),
    messageId: asText(row.message_id ?? row.messageId),
    previousStatus: normalizeOpportunityStatus(row.previous_status ?? row.previousStatus),
    nextStatus: normalizeOpportunityStatus(row.next_status ?? row.nextStatus),
    previousStage: normalizeOpportunityStage(row.previous_stage ?? row.previousStage),
    nextStage: normalizeOpportunityStage(row.next_stage ?? row.nextStage),
    detectedSignals,
    stateChanges: {
      opportunityKey: asText(stateChanges.opportunityKey) ?? asText(row.opportunity_key) ?? "unknown",
      previousStatus: normalizeOpportunityStatus(stateChanges.previousStatus ?? row.previous_status ?? row.previousStatus),
      nextStatus: normalizeOpportunityStatus(stateChanges.nextStatus ?? row.next_status ?? row.nextStatus),
      previousStage: normalizeOpportunityStage(stateChanges.previousStage ?? row.previous_stage ?? row.previousStage),
      nextStage: normalizeOpportunityStage(stateChanges.nextStage ?? row.next_stage ?? row.nextStage),
      statusChanged: asBoolean(stateChanges.statusChanged),
      stageChanged: asBoolean(stateChanges.stageChanged),
      summaryChanged: asBoolean(stateChanges.summaryChanged),
      waitingForChanged: asBoolean(stateChanges.waitingForChanged),
      nextActionChanged: asBoolean(stateChanges.nextActionChanged),
      changedFields: parseJsonArray<string>(stateChanges.changedFields),
      addedSignals: parseJsonArray<CommercialSignal>(stateChanges.addedSignals),
      removedSignals: parseJsonArray<CommercialSignal>(stateChanges.removedSignals),
      addedRequirements: parseJsonArray<string>(stateChanges.addedRequirements),
      removedRequirements: parseJsonArray<string>(stateChanges.removedRequirements),
      addedObjections: parseJsonArray<string>(stateChanges.addedObjections),
      removedObjections: parseJsonArray<string>(stateChanges.removedObjections)
    },
    missingInformation,
    nextAction: {
      type: normalizeNextActionType(nextActionRecord.type),
      reason: asText(nextActionRecord.reason) ?? "No decision available.",
      confidence: (asText(nextActionRecord.confidence) ?? "low") as CommercialOperationalDecisionRecord["nextAction"]["confidence"],
      riskLevel: (asText(nextActionRecord.riskLevel) ?? "blocked") as CommercialOperationalDecisionRecord["nextAction"]["riskLevel"],
      approvalRequirement: (asText(nextActionRecord.approvalRequirement) ?? "blocked") as CommercialOperationalDecisionRecord["nextAction"]["approvalRequirement"],
      recommendedChannel: (asText(nextActionRecord.recommendedChannel) ?? "unknown") as CommercialOperationalDecisionRecord["nextAction"]["recommendedChannel"],
      draftMessage: asText(nextActionRecord.draftMessage),
      requiredInformation: parseJsonArray<string>(nextActionRecord.requiredInformation),
      blockedReasons: parseJsonArray<string>(nextActionRecord.blockedReasons),
      executable: false
    },
    policyStatus: (asText(row.policy_status) ?? "blocked") as CommercialOperationalDecisionRecord["policyStatus"],
    riskLevel: (asText(row.risk_level) ?? "blocked") as CommercialOperationalDecisionRecord["riskLevel"],
    approvalRequirement: (asText(row.approval_requirement) ?? "blocked") as CommercialOperationalDecisionRecord["approvalRequirement"],
    decisionStatus: (asText(row.decision_status) ?? "recorded") as CommercialOperationalDecisionRecord["decisionStatus"],
    rationale: asText(row.rationale) ?? "Operational decision recorded.",
    warnings,
    contractVersion: asText(row.contract_version ?? row.contractVersion),
    policyVersion: asText(row.policy_version ?? row.policyVersion),
    runtimeVersion: asText(row.runtime_version ?? row.runtimeVersion),
    createdAt
  };
}

function normalizeState(row: DbLikeRow): CommercialOperationalState {
  const createdAt = toIso(row.created_at ?? row.createdAt, new Date(0).toISOString());
  const updatedAt = toIso(row.updated_at ?? row.updatedAt, createdAt);
  const lastActivityAt = toIso(row.last_activity_at ?? row.lastActivityAt ?? row.updated_at ?? row.updatedAt, updatedAt);
  const opportunityId = asId(row.id ?? row.opportunity_id ?? row.opportunityId);
  const previousDecisionId = asText(row.last_agent_decision_id ?? row.lastAgentDecisionId);

  return {
    opportunityId,
    opportunityKey: asText(row.opportunity_key ?? row.opportunityKey) ?? `opportunity-${opportunityId ?? "unknown"}`,
    customerCandidateId: asId(row.customer_candidate_id ?? row.customerCandidateId),
    customerMasterId: asId(row.customer_master_id ?? row.customerMasterId),
    leadId: asId(row.lead_id ?? row.leadId),
    conversationCaseId: asId(row.conversation_case_id ?? row.conversationCaseId),
    waId: asText(row.wa_id ?? row.waId),
    channel: (asText(row.channel) ?? "unknown") as CommercialOperationalState["channel"],
    primaryIntent: normalizeCommercialIntent(row.primary_intent),
    status: normalizeOpportunityStatus(row.status),
    stage: normalizeOpportunityStage(row.stage),
    temperature: normalizeTemperature(row.temperature),
    priority: normalizePriority(row.priority),
    currentSummary: asText(row.current_summary ?? row.currentSummary),
    requirements: normalizeRequirements(row.requirements_json),
    missingRequirements: normalizeRequirements(row.missing_requirements_json),
    productInterests: normalizeProductInterests(row.product_interests_json),
    objections: normalizeObjections(row.objections_json),
    signals: normalizeSignalList(row.signals_json),
    lastCustomerMessageId: asId(row.last_customer_message_id ?? row.lastCustomerMessageId),
    lastAgentDecisionId: asId(row.last_agent_decision_id ?? row.lastAgentDecisionId),
    waitingFor: asText(row.waiting_for ?? row.waitingFor),
    nextActionType: asText(row.next_action_type ?? row.nextActionType) as CommercialOperationalState["nextActionType"] | null,
    nextActionDueAt: toIso(row.next_action_due_at ?? row.nextActionDueAt, lastActivityAt),
    humanOwnerActive: asBoolean(row.human_owner_active ?? row.humanOwnerActive),
    aiBlocked: asBoolean(row.ai_blocked ?? row.aiBlocked),
    version: Number.isFinite(Number(row.version)) ? Number(row.version) : 1,
    createdAt,
    updatedAt,
    lastActivityAt,
    closedAt: row.closed_at === null || row.closed_at === undefined ? null : toIso(row.closed_at, createdAt),
    previousDecision: previousDecisionId
      ? {
          decisionId: previousDecisionId,
          decisionStatus: "recorded",
          createdAt: updatedAt
        }
      : null
  };
}

async function safeHasTable(tableName: string): Promise<boolean> {
  try {
    const rows = await queryRows<{ table_exists?: number }>(
      `SELECT 1 AS table_exists FROM information_schema.tables WHERE table_schema = DATABASE() AND table_name = ? LIMIT 1`,
      [tableName]
    );
    return rows.length > 0;
  } catch {
    return false;
  }
}

function buildCandidateWhereClause(hints: CommercialOperationalIdentityHints) {
  const identityClauses: string[] = [];
  const params: Array<string | number> = [];

  const addIdentityClause = (column: string, value: string | number | null) => {
    if (value === null || value === undefined || value === "") return;
    identityClauses.push(`\`${column}\` = ?`);
    params.push(value);
  };

  addIdentityClause("wa_id", hints.waId);
  addIdentityClause("customer_candidate_id", hints.customerCandidateId);
  addIdentityClause("customer_master_id", hints.customerMasterId);
  addIdentityClause("lead_id", hints.leadId);
  addIdentityClause("conversation_case_id", hints.conversationCaseId);

  // Channel is a FILTER, never an identity anchor: OR-ing `channel = 'whatsapp'`
  // matched every WhatsApp opportunity in the table and bled state across
  // unrelated customers (identity must never come from the channel alone).
  if (identityClauses.length === 0) {
    return { where: "", params: [] as Array<string | number> };
  }

  let where = `WHERE (${identityClauses.join(" OR ")})`;
  if (hints.channel !== "unknown") {
    where += " AND `channel` = ?";
    params.push(hints.channel);
  }

  return { where, params };
}

async function loadLatestDecision(opportunityId: string | number) {
  try {
    const rows = await queryRows<DbLikeRow>(
      `SELECT * FROM crm_agent_decisions WHERE opportunity_id = ? ORDER BY created_at DESC, id DESC LIMIT 1`,
      [opportunityId]
    );
    const row = rows[0];
    if (row) return normalizeDecision(row);
  } catch {
    // fall back to no decision
  }

  return null;
}

export async function loadCommercialState(input: CommercialOperationalLoadInput): Promise<CommercialOperationalLoadStateResult> {
  const currentTime = typeof input.currentTime === "string" ? input.currentTime : input.currentTime.toISOString();
  const hints = buildCommercialIdentityHints({
    inboundMessage: input.inboundMessage,
    brainContext: input.brainContext,
    commercialContext: input.commercialContext
  });

  if (!hints.hasCommercialSignal && !hints.hasExplicitCommercialState) {
    return {
      status: "not_found",
      candidates: [],
      activeState: null,
      latestDecision: null,
      warnings: ["commercial_state_missing"],
      metadata: {
        version: COMMERCIAL_OPERATIONAL_LOOP_VERSION,
        currentTime,
        correlationId: input.correlationId,
        hint: hints,
        reason: "No commercial signal was found."
      }
    };
  }

  const opportunitiesTableExists = await safeHasTable("crm_opportunities");
  const decisionsTableExists = await safeHasTable("crm_agent_decisions");
  if (!opportunitiesTableExists || !decisionsTableExists) {
    return {
      status: "not_found",
      candidates: [],
      activeState: null,
      latestDecision: null,
      warnings: ["commercial_state_missing"],
      metadata: {
        version: COMMERCIAL_OPERATIONAL_LOOP_VERSION,
        currentTime,
        correlationId: input.correlationId,
        hint: hints,
        reason: "Commercial state tables are not available."
      }
    };
  }

  const { where, params } = buildCandidateWhereClause(hints);
  if (!where) {
    return {
      status: "not_found",
      candidates: [],
      activeState: null,
      latestDecision: null,
      warnings: ["commercial_state_missing"],
      metadata: {
        version: COMMERCIAL_OPERATIONAL_LOOP_VERSION,
        currentTime,
        correlationId: input.correlationId,
        hint: hints,
        reason: "No identity hints were available."
      }
    };
  }

  try {
    const rows = await queryRows<DbLikeRow>(
      `
        SELECT
          id,
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
        FROM crm_opportunities
        ${where}
        ORDER BY updated_at DESC, last_activity_at DESC, id DESC
        LIMIT 25
      `,
      params
    );

    const candidates = rows.map((row) => normalizeState(row));
    // Bugfix: an "unknown" intent hint (most continuation turns that don't
    // restate the topic) keeps the legacy behavior of considering every
    // identity-matched candidate. A specific, known intent narrows relevance to
    // opportunities that share it, so a candidate about a different topic never
    // gets reused or counted as a conflict just for existing. In both cases,
    // terminal candidates are excluded from "active" and from the conflict
    // count - a closed opportunity (even a very recent one) must never be
    // silently reused, nor make an unrelated new topic look ambiguous.
    const relevantCandidates = hints.primaryIntent === "unknown" ? candidates : candidates.filter((state) => state.primaryIntent === hints.primaryIntent);
    const nonTerminalRelevant = relevantCandidates.filter((state) => !isTerminalStatus(state.status));
    const activeState = nonTerminalRelevant.find((state) => !state.humanOwnerActive && !state.aiBlocked) ?? nonTerminalRelevant[0] ?? null;
    const latestDecision = activeState ? await loadLatestDecision(activeState.opportunityId ?? activeState.opportunityKey) : null;
    const warnings = uniqueStrings([
      nonTerminalRelevant.length > 1 ? "commercial_state_conflict" : null,
      candidates.some((candidate) => candidate.humanOwnerActive) ? "commercial_state_human_owner_active" : null,
      candidates.some((candidate) => candidate.aiBlocked) ? "commercial_state_ai_blocked" : null,
      candidates.some((candidate) => candidate.status === "stalled") ? "commercial_state_no_action" : null,
      candidates.some((candidate) => candidate.status === "archived" || candidate.status === "cancelled" || candidate.status === "lost" || candidate.status === "won") ? "commercial_state_terminal" : null
    ]);

    return {
      status: "loaded",
      candidates,
      activeState,
      latestDecision,
      warnings: warnings as CommercialOperationalLoopWarning[],
      metadata: {
        version: COMMERCIAL_OPERATIONAL_LOOP_VERSION,
        currentTime,
        correlationId: input.correlationId,
        hint: hints,
        rowCount: rows.length,
        sanitized: Boolean(sanitizedCommercialSummary(input.commercialContext))
      }
    };
  } catch (error) {
    return {
      status: "error",
      candidates: [],
      activeState: null,
      latestDecision: null,
      warnings: ["commercial_state_missing"],
      metadata: {
        version: COMMERCIAL_OPERATIONAL_LOOP_VERSION,
        currentTime,
        correlationId: input.correlationId,
        hint: hints,
        error: error instanceof Error ? error.message : String(error)
      }
    };
  }
}

function sanitizedCommercialSummary(commercialContext: CommercialContextBuilderResult | null | undefined) {
  if (!commercialContext) return null;
  const summary = sanitizeCommercialObject({
    status: commercialContext.status,
    completeness: commercialContext.completeness,
    warnings: commercialContext.warnings,
    sourceSummary: commercialContext.sourceSummary
  });
  return summary.value;
}
