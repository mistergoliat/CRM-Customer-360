import { createHash } from "node:crypto";
import { safeExecute, safeQueryRows } from "@/lib/db";
import { persistAgentAction, type CrmAgentAction, type PersistAgentActionResult } from "@/lib/brain/commercial/action-queue";
import { buildSandboxAutonomyConfig, evaluateAgentActionForSandbox, normalizeWaIdDigits } from "@/lib/brain/commercial/autonomy-sandbox";
import { executeActionThroughGate, SqlExecutionUnitOfWork, type ExecutionGateResult } from "@/lib/brain/commercial/execution-gate";
import { checkCustomerOptOutStatus } from "@/lib/brain/commercial/optOutStore";
import { claimFailedFollowUpRetry, claimPlannedFollowUp, claimStaleExecutingFollowUp } from "@/lib/brain/commercial/followup/runFollowupTick";
import { buildFollowUpWakeEvent } from "@/lib/brain/commercial/followup-wake/buildFollowUpWakeEvent";
import { recordFollowUpWake } from "@/lib/brain/commercial/followup-wake/sessionEvents";
import { getCommercialWorkByPublicId } from "../repository";
import type { PersistedCommercialWork } from "../persistenceTypes";
import type { CommercialConversationProjection, CommercialObjective, CommercialOpportunityProjection } from "../types";
import {
  buildObjectiveFollowUpMessage,
  buildObjectiveFollowUpSequenceKey,
  deriveObjectiveWaitingReason,
  getObjectiveFollowUpPolicyDefinition,
  isObjectiveFollowUpPolicy,
  mapObjectiveToFollowUpPolicy,
  type ObjectiveFollowUpPolicy,
  type ObjectiveFollowUpWaitingReason
} from "./objectiveFollowUpPolicies";
import {
  evaluateObjectiveFollowUpEligibility,
  type ObjectiveFollowUpEligibilityResult,
  type ObjectiveFollowUpExistingAction
} from "./evaluateObjectiveFollowUpEligibility";

export type ObjectiveAwareFollowUpPayload = {
  kind: "objective_aware_followup";
  schemaVersion: "1.0";
  commercialWorkPublicId: string;
  commercialObjectivePublicId: string;
  followUpPolicy: ObjectiveFollowUpPolicy;
  waitingReason: ObjectiveFollowUpWaitingReason;
  attempt: number;
  scheduledAt: string;
  expectedWorkVersion: number | null;
};

type AgentActionRow = {
  id: number;
  action_id: string;
  idempotency_key: string;
  opportunity_id: number | null;
  conversation_case_id: number | string | null;
  wa_id: string | null;
  channel: string | null;
  action_type: string;
  status: string;
  scheduled_for: string | null;
  attempt_number: number;
  max_attempts: number;
  draft_message: string | null;
  draft_payload_json: unknown;
  created_at: string | null;
  followup_sequence_key: string | null;
};

type ConversationRow = {
  id: number;
  public_id: string | null;
  external_contact_id: string | null;
  status: string | null;
  human_owner_active: number;
  ai_enabled: number;
};

type OpportunityRow = {
  id: number;
  status: string | null;
  wa_id: string | null;
};

export type ScheduleObjectiveAwareFollowUpResult =
  | { status: "scheduled"; action: CrmAgentAction; persistence: PersistAgentActionResult; eligibility: ObjectiveFollowUpEligibilityResult }
  | { status: "already_scheduled"; existingActionId: string | null; eligibility: ObjectiveFollowUpEligibilityResult }
  | { status: "not_eligible" | "stopped"; eligibility: ObjectiveFollowUpEligibilityResult }
  | { status: "failed"; reason: string; eligibility?: ObjectiveFollowUpEligibilityResult };

export type ObjectiveAwareFollowUpDueResult =
  | { status: "sent"; scheduleActionId: string; sendAction: CrmAgentAction; persistence: PersistAgentActionResult; executionGate: ExecutionGateResult }
  | { status: "cancelled"; scheduleActionId: string; reason: string }
  | { status: "skipped"; scheduleActionId: string; reason: string }
  | { status: "legacy_unaffected"; scheduleActionId: string }
  | { status: "failed"; scheduleActionId: string; reason: string };

function toIso(value: string | Date | null | undefined): string | null {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function parseJson(value: unknown): unknown {
  if (value === null || value === undefined) return null;
  if (typeof value === "object") return value;
  if (typeof value !== "string") return null;
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseObjectiveAwarePayload(value: unknown): ObjectiveAwareFollowUpPayload | null {
  const parsed = parseJson(value);
  if (!isRecord(parsed)) return null;
  if (parsed.kind !== "objective_aware_followup" || parsed.schemaVersion !== "1.0") return null;
  if (typeof parsed.commercialWorkPublicId !== "string") return null;
  if (typeof parsed.commercialObjectivePublicId !== "string") return null;
  const followUpPolicy = typeof parsed.followUpPolicy === "string" ? parsed.followUpPolicy : null;
  if (!isObjectiveFollowUpPolicy(followUpPolicy)) return null;
  if (typeof parsed.waitingReason !== "string") return null;
  const attempt = Number(parsed.attempt);
  return {
    kind: "objective_aware_followup",
    schemaVersion: "1.0",
    commercialWorkPublicId: parsed.commercialWorkPublicId,
    commercialObjectivePublicId: parsed.commercialObjectivePublicId,
    followUpPolicy,
    waitingReason: parsed.waitingReason as ObjectiveFollowUpWaitingReason,
    attempt: Number.isInteger(attempt) && attempt > 0 ? attempt : 1,
    scheduledAt: typeof parsed.scheduledAt === "string" ? parsed.scheduledAt : new Date(0).toISOString(),
    expectedWorkVersion: typeof parsed.expectedWorkVersion === "number" ? parsed.expectedWorkVersion : null
  };
}

function digestId(prefix: string, seed: unknown, length = 24) {
  const digest = createHash("sha256").update(JSON.stringify(seed)).digest("hex");
  return `${prefix}-${digest.slice(0, length)}`;
}

function objectiveById(work: PersistedCommercialWork, objectivePublicId: string): CommercialObjective | null {
  return work.objectives.find((objective) => objective.objectiveId === objectivePublicId) ?? null;
}

async function loadConversation(conversationId: number): Promise<CommercialConversationProjection & { waId: string | null; publicId: string | null }> {
  const result = await safeQueryRows<ConversationRow>(
    `SELECT id, public_id, external_contact_id, status, human_owner_active, ai_enabled FROM conversation WHERE id = ? LIMIT 1`,
    [conversationId]
  );
  const row = result.ok ? result.rows[0] : null;
  return {
    id: row?.id ?? conversationId,
    publicId: row?.public_id ?? null,
    waId: row?.external_contact_id ?? null,
    status: row?.status ?? null,
    humanOwnerActive: Number(row?.human_owner_active ?? 0) === 1,
    aiEnabled: Number(row?.ai_enabled ?? 1) === 1
  };
}

async function loadOpportunity(opportunityId: number | null): Promise<CommercialOpportunityProjection & { waId: string | null }> {
  if (opportunityId === null) return { id: null, status: null, waId: null };
  const result = await safeQueryRows<OpportunityRow>(`SELECT id, status, wa_id FROM crm_opportunities WHERE id = ? LIMIT 1`, [opportunityId]);
  const row = result.ok ? result.rows[0] : null;
  return { id: row?.id ?? opportunityId, status: row?.status ?? null, waId: row?.wa_id ?? null };
}

async function loadExistingObjectiveFollowUps(sequenceKey: string): Promise<ObjectiveFollowUpExistingAction[]> {
  const result = await safeQueryRows<Pick<AgentActionRow, "status" | "attempt_number" | "draft_payload_json">>(
    `SELECT status, attempt_number, draft_payload_json
      FROM crm_agent_actions
      WHERE action_type = 'schedule_followup' AND followup_sequence_key = ?
      ORDER BY id DESC LIMIT 50`,
    [sequenceKey]
  );
  if (!result.ok) return [];
  return result.rows.flatMap((row) => {
    const payload = parseObjectiveAwarePayload(row.draft_payload_json);
    if (!payload) return [];
    return [{
      policy: payload.followUpPolicy,
      commercialWorkPublicId: payload.commercialWorkPublicId,
      commercialObjectivePublicId: payload.commercialObjectivePublicId,
      attempt: Number(row.attempt_number ?? payload.attempt),
      status: String(row.status ?? "")
    }];
  });
}

async function loadActiveActionIdForSequence(sequenceKey: string): Promise<string | null> {
  const result = await safeQueryRows<{ action_id: string }>(
    `SELECT action_id FROM crm_agent_actions
      WHERE action_type = 'schedule_followup' AND followup_sequence_key = ? AND status IN ('planned', 'requires_review', 'executing')
      ORDER BY id DESC LIMIT 1`,
    [sequenceKey]
  );
  return result.ok ? result.rows[0]?.action_id ?? null : null;
}

function addMinutes(iso: string, minutes: number): string {
  return new Date(new Date(iso).getTime() + minutes * 60_000).toISOString();
}

function buildScheduleAction(input: {
  work: PersistedCommercialWork;
  objective: CommercialObjective;
  conversation: Awaited<ReturnType<typeof loadConversation>>;
  opportunity: Awaited<ReturnType<typeof loadOpportunity>>;
  policy: ObjectiveFollowUpPolicy;
  waitingReason: ObjectiveFollowUpWaitingReason;
  attempt: number;
  maxAttempts: number;
  now: string;
  scheduledFor: string;
  sequenceKey: string;
}): CrmAgentAction {
  const payload: ObjectiveAwareFollowUpPayload = {
    kind: "objective_aware_followup",
    schemaVersion: "1.0",
    commercialWorkPublicId: input.work.publicId,
    commercialObjectivePublicId: input.objective.objectiveId,
    followUpPolicy: input.policy,
    waitingReason: input.waitingReason,
    attempt: input.attempt,
    scheduledAt: input.now,
    expectedWorkVersion: input.work.version
  };
  const message = buildObjectiveFollowUpMessage({ policy: input.policy, waitingReason: input.waitingReason, objective: input.objective });
  const seed = { kind: "objective-aware-followup-schedule", sequenceKey: input.sequenceKey, attempt: input.attempt };
  const id = digestId("crm-agent-action", seed);
  return {
    id: null,
    actionId: id,
    idempotencyKey: `objective-aware-followup:${createHash("sha256").update(JSON.stringify(seed)).digest("hex")}`,
    opportunityId: input.work.opportunityId,
    decisionId: null,
    decisionRowId: null,
    conversationCaseId: input.work.conversationId,
    messageId: null,
    waId: input.conversation.waId ?? input.opportunity.waId,
    channel: "whatsapp",
    actionType: "schedule_followup",
    status: "planned",
    riskLevel: "low",
    approvalRequirement: "none",
    draftPayload: payload,
    finalPayload: null,
    executionPayload: null,
    draftMessage: message,
    finalMessage: null,
    scheduledFor: input.scheduledFor,
    expiresAt: null,
    attemptNumber: input.attempt,
    maxAttempts: input.maxAttempts,
    followUpSequenceKey: input.sequenceKey,
    followUpConfigurationSource: null,
    followUpConfigurationId: null,
    followUpConfigurationVersion: null,
    followUpConfigurationHash: null,
    blockReasons: [],
    cancelReason: null,
    failureReason: null,
    policyStatus: "allowed",
    policyNotes: [`objective_followup_policy:${input.policy}`],
    source: "system",
    createdBy: "system",
    approvedBy: null,
    approvedAt: null,
    executedAt: null,
    cancelledAt: null,
    outboxMessageId: null,
    lifecycleVersion: "brain.commercial.action-lifecycle.v1",
    policyVersion: "objective-followup-policy.v1",
    runtimeVersion: "sales-agent-r2-a07",
    createdAt: input.now,
    updatedAt: null
  };
}

export async function scheduleObjectiveAwareFollowUp(input: {
  workPublicId: string;
  objectivePublicId: string;
  policy?: ObjectiveFollowUpPolicy | null;
  expectedWorkVersion?: number | null;
  now?: string | Date;
}): Promise<ScheduleObjectiveAwareFollowUpResult> {
  const now = toIso(input.now ?? new Date()) ?? new Date().toISOString();
  const work = await getCommercialWorkByPublicId(input.workPublicId);
  if (!work) return { status: "failed", reason: "commercial_work_not_found" };
  if (input.expectedWorkVersion !== null && input.expectedWorkVersion !== undefined && work.version !== input.expectedWorkVersion) {
    return { status: "failed", reason: "commercial_work_version_conflict" };
  }
  const objective = objectiveById(work, input.objectivePublicId);
  const policy = input.policy ?? (objective ? mapObjectiveToFollowUpPolicy(objective) : null);
  if (!policy) {
    const eligibility = evaluateObjectiveFollowUpEligibility({
      work,
      objective,
      conversation: await loadConversation(work.conversationId),
      opportunity: await loadOpportunity(work.opportunityId),
      currentTime: now,
      policy: null,
      commercialWorkPublicId: work.publicId
    });
    return { status: "not_eligible", eligibility };
  }

  const sequenceKey = buildObjectiveFollowUpSequenceKey({
    commercialWorkPublicId: work.publicId,
    commercialObjectivePublicId: input.objectivePublicId,
    policy
  });
  const [conversation, opportunity, existing] = await Promise.all([
    loadConversation(work.conversationId),
    loadOpportunity(work.opportunityId),
    loadExistingObjectiveFollowUps(sequenceKey)
  ]);
  const waId = conversation.waId ?? opportunity.waId ?? null;
  const optOut = waId ? await checkCustomerOptOutStatus(waId) : "not_opted_out";
  if (optOut === "unavailable") return { status: "failed", reason: "opt_out_status_unavailable" };

  const eligibility = evaluateObjectiveFollowUpEligibility({
    work,
    objective,
    conversation,
    opportunity,
    existingFollowUpActions: existing,
    currentTime: now,
    customerOptedOut: optOut === "opted_out",
    policy,
    commercialWorkPublicId: work.publicId
  });

  if (eligibility.status === "ALREADY_SCHEDULED") {
    return { status: "already_scheduled", existingActionId: await loadActiveActionIdForSequence(sequenceKey), eligibility };
  }
  if (eligibility.status === "STOPPED") return { status: "stopped", eligibility };
  if (eligibility.status !== "ELIGIBLE" || !objective || !eligibility.nextAttempt) return { status: "not_eligible", eligibility };

  const definition = getObjectiveFollowUpPolicyDefinition(policy);
  const delay = definition.delaySequenceMinutes[eligibility.nextAttempt - 1];
  if (delay === undefined) return { status: "stopped", eligibility: { ...eligibility, status: "STOPPED", reason: "max_attempts_reached" } };
  const waitingReason = deriveObjectiveWaitingReason(objective);
  const action = buildScheduleAction({
    work,
    objective,
    conversation,
    opportunity,
    policy,
    waitingReason,
    attempt: eligibility.nextAttempt,
    maxAttempts: definition.maxAttempts,
    now,
    scheduledFor: addMinutes(now, delay),
    sequenceKey
  });
  const persistence = await persistAgentAction({
    action,
    currentTime: now,
    featureFlags: { queueEnabled: true, persistenceEnabled: true }
  });
  if (persistence.status === "inserted" || persistence.status === "updated_existing") {
    return { status: "scheduled", action: persistence.action, persistence, eligibility };
  }
  if (persistence.status === "duplicate_ignored") {
    return { status: "already_scheduled", existingActionId: persistence.action.actionId, eligibility };
  }
  return { status: "failed", reason: persistence.error ?? persistence.status, eligibility };
}

async function loadAction(actionId: string): Promise<AgentActionRow | null> {
  const result = await safeQueryRows<AgentActionRow>(
    `SELECT id, action_id, idempotency_key, opportunity_id, conversation_case_id, wa_id, channel, action_type, status,
        scheduled_for, attempt_number, max_attempts, draft_message, draft_payload_json, created_at, followup_sequence_key
      FROM crm_agent_actions WHERE action_id = ? LIMIT 1`,
    [actionId]
  );
  return result.ok ? result.rows[0] ?? null : null;
}

async function abortScheduleAction(actionId: string, reason: string): Promise<void> {
  await safeExecute(
    `UPDATE crm_agent_actions
      SET status = 'cancelled', cancel_reason = ?, cancelled_at = CURRENT_TIMESTAMP(3), updated_at = CURRENT_TIMESTAMP(3)
      WHERE action_id = ? AND status = 'executing'`,
    [reason, actionId]
  );
}

async function markScheduleExecuted(actionId: string): Promise<void> {
  await safeExecute(
    `UPDATE crm_agent_actions
      SET status = 'executed', executed_at = CURRENT_TIMESTAMP(3), updated_at = CURRENT_TIMESTAMP(3)
      WHERE action_id = ? AND status = 'executing'`,
    [actionId]
  );
}

async function hasInboundAfterSchedule(action: AgentActionRow): Promise<boolean> {
  if (!action.conversation_case_id || !action.created_at) return false;
  const result = await safeQueryRows<{ id: number }>(
    `SELECT cm.id FROM conversation_message cm
      WHERE cm.conversation_id = ? AND cm.direction = 'inbound' AND cm.created_at > ?
      ORDER BY cm.id ASC LIMIT 1`,
    [action.conversation_case_id, action.created_at]
  );
  return result.ok && result.rows.length > 0;
}

async function revalidateObjectiveAwareFollowUp(action: AgentActionRow, payload: ObjectiveAwareFollowUpPayload): Promise<{
  ok: true;
  work: PersistedCommercialWork;
  objective: CommercialObjective;
  conversation: Awaited<ReturnType<typeof loadConversation>>;
  opportunity: Awaited<ReturnType<typeof loadOpportunity>>;
  message: string;
} | { ok: false; reason: string }> {
  const work = await getCommercialWorkByPublicId(payload.commercialWorkPublicId);
  if (!work) return { ok: false, reason: "commercial_work_not_found" };
  const objective = objectiveById(work, payload.commercialObjectivePublicId);
  if (!objective) return { ok: false, reason: "objective_not_found" };
  const [conversation, opportunity] = await Promise.all([loadConversation(work.conversationId), loadOpportunity(work.opportunityId)]);
  const waId = action.wa_id ?? conversation.waId ?? opportunity.waId;
  if (!waId) return { ok: false, reason: "missing_wa_id" };
  const optOut = await checkCustomerOptOutStatus(waId);
  if (optOut === "unavailable") return { ok: false, reason: "opt_out_status_unavailable" };
  if (optOut === "opted_out") return { ok: false, reason: "customer_opted_out" };
  if (await hasInboundAfterSchedule(action)) return { ok: false, reason: "customer_replied_since_schedule" };

  const eligibility = evaluateObjectiveFollowUpEligibility({
    work,
    objective,
    conversation,
    opportunity,
    existingFollowUpActions: [],
    currentTime: new Date().toISOString(),
    customerOptedOut: false,
    policy: payload.followUpPolicy,
    commercialWorkPublicId: work.publicId
  });
  if (eligibility.status !== "ELIGIBLE") return { ok: false, reason: eligibility.reason };

  const currentWaitingReason = deriveObjectiveWaitingReason(objective);
  if (currentWaitingReason !== payload.waitingReason) return { ok: false, reason: "waiting_reason_changed" };

  const definition = getObjectiveFollowUpPolicyDefinition(payload.followUpPolicy);
  if (payload.attempt > definition.maxAttempts || Number(action.attempt_number) > definition.maxAttempts) {
    return { ok: false, reason: "max_attempts_reached" };
  }

  return {
    ok: true,
    work,
    objective,
    conversation,
    opportunity,
    message: buildObjectiveFollowUpMessage({ policy: payload.followUpPolicy, waitingReason: currentWaitingReason, objective })
  };
}

function buildSendAction(input: {
  scheduleAction: AgentActionRow;
  payload: ObjectiveAwareFollowUpPayload;
  work: PersistedCommercialWork;
  conversation: Awaited<ReturnType<typeof loadConversation>>;
  opportunity: Awaited<ReturnType<typeof loadOpportunity>>;
  message: string;
  now: string;
}): CrmAgentAction {
  const waId = input.scheduleAction.wa_id ?? input.conversation.waId ?? input.opportunity.waId;
  const seed = { kind: "objective-aware-followup-send", scheduleActionId: input.scheduleAction.action_id, attempt: input.payload.attempt };
  const digest = createHash("sha256").update(JSON.stringify(seed)).digest("hex");
  return {
    id: null,
    actionId: `crm-agent-action-${digest.slice(0, 24)}`,
    idempotencyKey: `objective-aware-followup-send:${digest}`,
    opportunityId: input.work.opportunityId,
    decisionId: null,
    decisionRowId: null,
    conversationCaseId: input.work.conversationId,
    messageId: null,
    waId,
    channel: "whatsapp",
    actionType: "send_whatsapp_reply",
    status: "planned",
    riskLevel: "low",
    approvalRequirement: "none",
    draftPayload: {
      kind: "objective_aware_followup_send",
      schemaVersion: "1.0",
      scheduleActionId: input.scheduleAction.action_id,
      commercialWorkPublicId: input.payload.commercialWorkPublicId,
      commercialObjectivePublicId: input.payload.commercialObjectivePublicId,
      followUpPolicy: input.payload.followUpPolicy,
      attempt: input.payload.attempt
    },
    finalPayload: null,
    executionPayload: null,
    draftMessage: input.message,
    finalMessage: null,
    scheduledFor: null,
    expiresAt: null,
    attemptNumber: 1,
    maxAttempts: 1,
    followUpSequenceKey: null,
    followUpConfigurationSource: null,
    followUpConfigurationId: null,
    followUpConfigurationVersion: null,
    followUpConfigurationHash: null,
    blockReasons: [],
    cancelReason: null,
    failureReason: null,
    policyStatus: "allowed",
    policyNotes: [`objective_followup_policy:${input.payload.followUpPolicy}`],
    source: "system",
    createdBy: "system",
    approvedBy: null,
    approvedAt: null,
    executedAt: null,
    cancelledAt: null,
    outboxMessageId: null,
    lifecycleVersion: "brain.commercial.action-lifecycle.v1",
    policyVersion: "objective-followup-policy.v1",
    runtimeVersion: "sales-agent-r2-a07",
    createdAt: input.now,
    updatedAt: null
  };
}

async function claimAction(row: AgentActionRow): Promise<boolean> {
  if (row.status === "planned") return claimPlannedFollowUp(row.action_id);
  if (row.status === "failed") return claimFailedFollowUpRetry(row.action_id);
  if (row.status === "executing") return claimStaleExecutingFollowUp(row.action_id);
  return false;
}

export async function processObjectiveAwareFollowUpDue(input: {
  actionId: string;
  now?: string | Date;
  gateConfig?: { executionGateEnabled: boolean; outboxBridgeEnabled: boolean; sandboxModeRequired: boolean };
}): Promise<ObjectiveAwareFollowUpDueResult> {
  const now = toIso(input.now ?? new Date()) ?? new Date().toISOString();
  const row = await loadAction(input.actionId);
  if (!row) return { status: "failed", scheduleActionId: input.actionId, reason: "action_not_found" };
  const payload = parseObjectiveAwarePayload(row.draft_payload_json);
  if (!payload) return { status: "legacy_unaffected", scheduleActionId: row.action_id };
  if (row.action_type !== "schedule_followup") return { status: "skipped", scheduleActionId: row.action_id, reason: "not_schedule_followup" };
  const scheduledFor = toIso(row.scheduled_for);
  if (scheduledFor && new Date(scheduledFor).getTime() > new Date(now).getTime()) {
    return { status: "skipped", scheduleActionId: row.action_id, reason: "not_due" };
  }

  const claimed = await claimAction(row);
  if (!claimed) return { status: "skipped", scheduleActionId: row.action_id, reason: "already_claimed" };

  // SALES-AGENT-R3-A05. row.status/row.attempt_number are the PRE-claim
  // values (claimAction reuses runFollowupTick.ts's own CAS primitives,
  // which bump attempt_number for the 'executing'/'failed' origins as part
  // of the same claim) - buildFollowUpWakeEvent mirrors that arithmetic, so
  // this wakeId matches what claimAction actually persisted. conversationId/
  // opportunityId come from the durable row itself, never from the
  // objective-aware payload (which has no such fields).
  const conversationIdForWake =
    row.conversation_case_id === null || row.conversation_case_id === undefined ? null : Number(row.conversation_case_id);
  const wakeCorrelationId = `followup:${row.action_id}:${Date.now()}`;
  const wakeEvent =
    conversationIdForWake !== null && Number.isFinite(conversationIdForWake)
      ? buildFollowUpWakeEvent({
          actionPublicId: row.action_id,
          statusPreClaim: row.status,
          attemptNumberPreClaim: row.attempt_number,
          conversationId: conversationIdForWake,
          opportunityId: row.opportunity_id,
          correlationId: wakeCorrelationId,
          scheduledFor: row.scheduled_for,
          firedAt: now
        })
      : null;

  const claimedRow = (await loadAction(input.actionId)) ?? row;
  const revalidation = await revalidateObjectiveAwareFollowUp(claimedRow, payload);
  if (!revalidation.ok) {
    await abortScheduleAction(row.action_id, revalidation.reason);
    if (wakeEvent) await recordFollowUpWake(wakeEvent, { status: "cancelled", reason: revalidation.reason });
    return { status: "cancelled", scheduleActionId: row.action_id, reason: revalidation.reason };
  }

  const sendAction = buildSendAction({
    scheduleAction: claimedRow,
    payload,
    work: revalidation.work,
    conversation: revalidation.conversation,
    opportunity: revalidation.opportunity,
    message: revalidation.message,
    now
  });
  const persistence = await persistAgentAction({
    action: sendAction,
    currentTime: now,
    featureFlags: { queueEnabled: true, persistenceEnabled: true }
  });
  if (!(persistence.status === "inserted" || persistence.status === "updated_existing" || persistence.status === "duplicate_ignored")) {
    await abortScheduleAction(row.action_id, "send_action_persistence_failed");
    if (wakeEvent) {
      await recordFollowUpWake(wakeEvent, { status: "technical_failure", reason: persistence.error ?? persistence.status });
    }
    return { status: "failed", scheduleActionId: row.action_id, reason: persistence.error ?? persistence.status };
  }

  const waId = normalizeWaIdDigits(persistence.action.waId);
  const sandboxEvaluation = evaluateAgentActionForSandbox(
    persistence.action,
    {
      now,
      caseId: String(revalidation.work.conversationId),
      caseStatus: revalidation.conversation.status ?? null,
      lifecycleStatus: revalidation.conversation.status ?? null,
      humanOwnerActive: revalidation.conversation.humanOwnerActive,
      aiBlocked: !revalidation.conversation.aiEnabled,
      requiresHuman: false,
      policyStatus: "allowed",
      conflictingActionExists: false
    },
    buildSandboxAutonomyConfig({
      sandboxEnabled: true,
      autonomousReplyEnabled: true,
      whitelistedWaIds: waId ? [waId] : [],
      allowedActionTypes: ["send_whatsapp_reply"],
      maxRiskLevel: "low"
    })
  );
  const executionGate = await executeActionThroughGate(
    {
      now,
      action: persistence.action,
      config: input.gateConfig ?? { executionGateEnabled: true, outboxBridgeEnabled: true, sandboxModeRequired: true },
      context: {
        caseId: String(revalidation.work.conversationId),
        caseStatus: revalidation.conversation.status ?? null,
        lifecycleStatus: revalidation.conversation.status ?? null,
        humanOwnerActive: revalidation.conversation.humanOwnerActive,
        aiBlocked: !revalidation.conversation.aiEnabled,
        requiresHuman: false,
        policyStatus: "allowed",
        conflictingActionExists: false
      },
      sandboxEvaluation
    },
    { unitOfWork: new SqlExecutionUnitOfWork() }
  );

  if (executionGate.allowed || executionGate.status === "duplicate") {
    await markScheduleExecuted(row.action_id);
    if (wakeEvent) await recordFollowUpWake(wakeEvent, { status: "executed" });
    return { status: "sent", scheduleActionId: row.action_id, sendAction: persistence.action, persistence, executionGate };
  }

  const blockedReason = `dispatch_blocked:${executionGate.blockReasons[0] ?? executionGate.status}`;
  await abortScheduleAction(row.action_id, blockedReason);
  if (wakeEvent) await recordFollowUpWake(wakeEvent, { status: "cancelled", reason: blockedReason });
  return { status: "cancelled", scheduleActionId: row.action_id, reason: blockedReason };
}

export async function cancelObjectiveAwareFollowUps(input: {
  workPublicId: string;
  objectivePublicId: string;
  policy?: ObjectiveFollowUpPolicy | null;
  reason: string;
}): Promise<{ cancelled: number }> {
  const policies = input.policy ? [input.policy] : [...(["MISSING_INFORMATION", "SELECTION_INACTIVE", "QUOTE_PENDING"] as const)];
  let cancelled = 0;
  for (const policy of policies) {
    const sequenceKey = buildObjectiveFollowUpSequenceKey({
      commercialWorkPublicId: input.workPublicId,
      commercialObjectivePublicId: input.objectivePublicId,
      policy
    });
    const result = await safeExecute(
      `UPDATE crm_agent_actions
        SET status = 'cancelled', cancel_reason = ?, cancelled_at = CURRENT_TIMESTAMP(3), updated_at = CURRENT_TIMESTAMP(3)
        WHERE action_type = 'schedule_followup' AND followup_sequence_key = ? AND status IN ('planned', 'failed', 'requires_review')`,
      [input.reason, sequenceKey]
    );
    if (result.ok) cancelled += result.affectedRows;
  }
  return { cancelled };
}
